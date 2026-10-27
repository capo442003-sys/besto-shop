import pool from '../db/pool.js';
import { generateCartNumber, generateProformaNumber, generateCollectionBatchRef } from '../utils/codes.js';
import { getStock, OPEN_CART_STALE_HOURS, sqlReservedInOpenCarts } from '../utils/stockSync.js';
import { deductStock, restoreStockFromSale } from './stockService.js';
import { emitEvent, EVENTS } from '../socket/index.js';
import { logAudit } from '../middleware/audit.js';
import {
  SALE_LINE_PRODUCT_NAME_SQL,
  SALE_LINE_PRODUCT_REFERENCE_SQL,
} from '../utils/saleLineSql.js';
import { balanceDueGnf, isFullyPaidGnf, normalizeInstallmentGnf, roundGnf } from '../utils/money.js';
import {
  CART_BALANCE_DUE_SQL,
  CLIENT_CART_BALANCE_WHERE,
  EXTERNAL_CREANCE_SETTLEMENT_TYPES,
  CLIENT_RECEIVABLE_SETTLEMENT_TYPES,
  clientCartBalanceSubquery,
  clientExternalBalanceSubquery,
  clientSettlementBalanceSubquery,
  clientAdvanceBalanceSubquery,
  CLIENT_ADVANCE_SETTLEMENT_TYPE,
  clientTotalBalanceSql,
} from '../utils/cartBalanceSql.js';
import { friendlyDbError } from '../utils/dbErrors.js';
import { coerceBoolean } from '../middleware/validate.js';
import { pvCartSqlClause, pvSettlementSqlClause, pvClientSqlClause, pvReceiptSqlClause, receiptEffectivePvSql } from '../utils/pvScope.js';

export { CART_BALANCE_DUE_SQL } from '../utils/cartBalanceSql.js';

/** Paniers ouverts non modifiés depuis N h → annulés (libère les réservations stock) */
const STALE_OPEN_CART_HOURS = OPEN_CART_STALE_HOURS;

async function cancelEmptyOpenCartsAtPv(db, deliveryPointId, { excludeCartId = null } = {}) {
  const pvId = parseInt(deliveryPointId, 10);
  if (!pvId) return { cancelled: 0, carts: [] };

  const params = [pvId];
  let excludeSql = '';
  if (excludeCartId) {
    params.push(parseInt(excludeCartId, 10));
    excludeSql = ` AND sc.id != $${params.length}`;
  }

  const { rows } = await db.query(
    `UPDATE sales_carts sc
     SET status = 'annule', updated_at = NOW()
     WHERE sc.status = 'en_cours'
       AND sc.delivery_point_id = $1
       AND NOT EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)
       ${excludeSql}
     RETURNING sc.id, sc.cart_number`,
    params,
  );
  return { cancelled: rows.length, carts: rows };
}

async function cancelStaleOpenCartsAtPv(db, deliveryPointId, { excludeCartId = null } = {}) {
  const pvId = parseInt(deliveryPointId, 10);
  if (!pvId) return { cancelled: 0, carts: [] };

  const params = [pvId, STALE_OPEN_CART_HOURS];
  let excludeSql = '';
  if (excludeCartId) {
    params.push(parseInt(excludeCartId, 10));
    excludeSql = ` AND sc.id != $${params.length}`;
  }

  const { rows } = await db.query(
    `UPDATE sales_carts sc
     SET status = 'annule', updated_at = NOW()
     WHERE sc.status = 'en_cours'
       AND sc.delivery_point_id = $1
       AND sc.updated_at < NOW() - ($2 || ' hours')::interval
       ${excludeSql}
     RETURNING sc.id, sc.cart_number`,
    params,
  );
  return { cancelled: rows.length, carts: rows };
}

/** Annule paniers vides et paniers ouverts abandonnés (tous les PV actifs). */
export async function cancelAbandonedOpenCartsGlobally(db = pool) {
  const { rows: pvs } = await db.query(
    'SELECT id FROM delivery_points WHERE is_active = TRUE ORDER BY id',
  );
  let cancelled = 0;
  const carts = [];
  for (const pv of pvs) {
    const empty = await cancelEmptyOpenCartsAtPv(db, pv.id);
    const stale = await cancelStaleOpenCartsAtPv(db, pv.id);
    cancelled += empty.cancelled + stale.cancelled;
    carts.push(...empty.carts, ...stale.carts);
  }
  return { cancelled, carts };
}

export { sqlReservedInOpenCarts } from '../utils/stockSync.js';

/** Exécute une requête dans un SAVEPOINT — évite d'abandonner toute la transaction si ignorée */
async function withSavepoint(client, fn, { ignoreCodes = [] } = {}) {
  await client.query('SAVEPOINT bmb_tx_sp');
  try {
    await fn();
    await client.query('RELEASE SAVEPOINT bmb_tx_sp');
    return true;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT bmb_tx_sp');
    if (ignoreCodes.includes(err.code)) return false;
    throw err;
  }
}

const BUSINESS_TZ = process.env.BUSINESS_TZ || 'Africa/Conakry';

/** Jour calendaire métier (aligné tableau de bord / fuseau magasin). */
function saleCalendarDateExpr(dateColumnExpr) {
  return `((${dateColumnExpr}) AT TIME ZONE '${BUSINESS_TZ}')::date`;
}

function appendDateRangeFilters(query, filters, dateColumnExpr, params, startIndex) {
  let i = startIndex;
  const saleDay = saleCalendarDateExpr(dateColumnExpr);
  if (filters.date_from) {
    query += ` AND ${saleDay} >= $${i++}::date`;
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    query += ` AND ${saleDay} <= $${i++}::date`;
    params.push(filters.date_to);
  }
  return { query, nextIndex: i };
}

/** Filtres communs liste inventaire / règlement des paniers */
function appendCartListFilters(query, filters, params, startIndex) {
  let i = startIndex;
  query += ` WHERE sc.status != 'annule'`;

  if (filters.inventaire === 'true') {
    query += ` AND EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)`;
    if (!filters.status) {
      query += ` AND sc.status = 'finalise'`;
    }
  }

  if (filters.status) {
    query += ` AND sc.status = $${i++}`;
    params.push(filters.status);
  }

  if (filters.only_with_lines === 'true' || filters.reglement === 'true') {
    query += ` AND EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)
               AND COALESCE(sc.total_amount, 0) > 0`;
  }
  if (filters.balance_due === 'true') {
    query += ` AND (${CART_BALANCE_DUE_SQL}) > 0.005`;
  }
  if (filters.balance_paid === 'true') {
    query += ` AND (${CART_BALANCE_DUE_SQL}) <= 0.005`;
  }
  ({ query, nextIndex: i } = appendDateRangeFilters(
    query,
    filters,
    'COALESCE(sc.validated_at, sc.created_at)',
    params,
    i
  ));
  const clientId = parseOptionalInt(filters.client_id);
  if (clientId != null) {
    query += ` AND sc.client_id = $${i++}`;
    params.push(clientId);
  }
  const sellerId = parseOptionalInt(filters.seller_id);
  if (sellerId != null) {
    query += ` AND sc.seller_id = $${i++}`;
    params.push(sellerId);
  }
  if (filters.user) {
    const pv = pvReceiptSqlClause(
      filters.user,
      { paymentAlias: null, cartAlias: 'sc', clientAlias: 'c' },
      i,
      filters.delivery_point_id,
    );
    query += pv.sql;
    params.push(...pv.params);
    i += pv.params.length;
  } else {
    const deliveryPointId = parseOptionalInt(filters.delivery_point_id);
    if (deliveryPointId != null) {
      query += ` AND sc.delivery_point_id = $${i++}`;
      params.push(deliveryPointId);
    }
  }
  return { query, nextIndex: i };
}

/** Filtres communs inventaire ventes par produit */
function appendSalesByProductFilters(query, filters, params, startIndex) {
  let i = startIndex;
  query += ` WHERE sc.status != 'annule'`;

  if (filters.inventaire === 'true' && !filters.status) {
    query += ` AND sc.status = 'finalise'`;
  }

  if (filters.status === 'finalise' || filters.status === 'en_cours') {
    query += ` AND sc.status = $${i++}`;
    params.push(filters.status);
  }

  if (filters.product_id) {
    const productId = parseOptionalInt(filters.product_id);
    if (productId != null) {
      query += ` AND sl.product_id = $${i++}`;
      params.push(productId);
    }
  }
  const sellerId = parseOptionalInt(filters.seller_id);
  if (sellerId != null) {
    query += ` AND sc.seller_id = $${i++}`;
    params.push(sellerId);
  }
  if (filters.user) {
    const pv = pvReceiptSqlClause(
      filters.user,
      { paymentAlias: null, cartAlias: 'sc', clientAlias: 'c' },
      i,
      filters.delivery_point_id,
    );
    query += pv.sql;
    params.push(...pv.params);
    i += pv.params.length;
  } else {
    const deliveryPointId = parseOptionalInt(filters.delivery_point_id);
    if (deliveryPointId != null) {
      query += ` AND sc.delivery_point_id = $${i++}`;
      params.push(deliveryPointId);
    }
  }
  ({ query, nextIndex: i } = appendDateRangeFilters(
    query,
    filters,
    'COALESCE(sc.validated_at, sc.created_at)',
    params,
    i
  ));
  return { query, nextIndex: i };
}

function parseOptionalInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function parseListPagination(filters = {}) {
  if (filters.page === undefined && filters.limit === undefined) return null;
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(filters.limit, 10) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

async function assertClientMatchesDeliveryPoint(clientId, deliveryPointId, db = pool) {
  if (!clientId || !deliveryPointId) return;
  const { rows } = await db.query(
    'SELECT delivery_point_id FROM clients WHERE id = $1',
    [clientId]
  );
  if (!rows.length) throw new Error('Client introuvable');
  const clientPv = rows[0].delivery_point_id;
  if (clientPv != null && String(clientPv) !== String(deliveryPointId)) {
    throw new Error('Ce client appartient à un autre point de vente');
  }
}

export async function createCart(data, userId) {
  if (!data.delivery_point_id) throw new Error('Point de livraison requis');
  if (!data.seller_id) throw new Error('Vendeur requis');
  const { rows: sellerRows } = await pool.query(
    'SELECT delivery_point_id FROM employees WHERE id = $1 AND is_active = TRUE',
    [data.seller_id]
  );
  if (!sellerRows.length) throw new Error('Vendeur introuvable');
  if (sellerRows[0].delivery_point_id != null
    && String(sellerRows[0].delivery_point_id) !== String(data.delivery_point_id)) {
    throw new Error('Ce vendeur n\'appartient pas à ce point de vente');
  }
  if (!data.sale_type || !['detail', 'gros'].includes(data.sale_type)) {
    throw new Error('Type de vente invalide');
  }
  if (data.client_id) {
    await assertClientMatchesDeliveryPoint(data.client_id, data.delivery_point_id);
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const client = await pool.connect();
  let cartId;
  try {
    await client.query('BEGIN');

    await cancelStaleOpenCartsAtPv(client, data.delivery_point_id);

    const { rows: dpRows } = await client.query(
      'SELECT code FROM delivery_points WHERE id = $1',
      [data.delivery_point_id]
    );
    const pvPrefix = dpRows[0]?.code ? `${dpRows[0].code}-` : '';
    const prefix = `${pvPrefix}PAN-${today}-`;

    await client.query(
      `UPDATE sales_carts SET status = 'annule', updated_at = NOW()
       WHERE cart_number LIKE $1 AND status = 'en_cours'
         AND NOT EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sales_carts.id)`,
      [`${prefix}%`]
    );

    const { rows: cancelled } = await client.query(
      `SELECT id FROM sales_carts
       WHERE cart_number LIKE $1 AND status = 'annule'
         AND NOT EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sales_carts.id)
       ORDER BY cart_number ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [`${prefix}%`]
    );

    if (cancelled.length) {
      cartId = cancelled[0].id;
      await client.query('DELETE FROM sale_lines WHERE cart_id = $1', [cartId]);
      await withSavepoint(
        client,
        () => client.query('DELETE FROM cart_payments WHERE cart_id = $1', [cartId]),
        { ignoreCodes: ['42P01'] },
      );
      await client.query(
        `UPDATE sales_carts SET
           sale_type = $1, client_id = $2, seller_id = $3, delivery_point_id = $4,
           status = 'en_cours', total_amount = 0, amount_paid = 0, change_amount = 0,
           payment_mode = NULL, validated_at = NULL, created_by = $5, updated_at = NOW()
         WHERE id = $6`,
        [data.sale_type, data.client_id || null, data.seller_id, data.delivery_point_id, userId, cartId]
      );
    } else {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        const cartNumber = await generateCartNumber(client, data.delivery_point_id);
        try {
          const { rows } = await client.query(
            `INSERT INTO sales_carts (cart_number, sale_type, client_id, seller_id, delivery_point_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [cartNumber, data.sale_type, data.client_id || null, data.seller_id || null, data.delivery_point_id, userId]
          );
          cartId = rows[0].id;
          break;
        } catch (err) {
          if (err.code === '23505' && attempt < 24) continue;
          throw err;
        }
      }
      if (!cartId) throw new Error('Impossible de créer un panier unique — réessayez');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const cart = await getCartById(cartId);
  emitEvent(EVENTS.CART_UPDATED, cart);
  return cart;
}

export async function updateCart(cartId, data) {
  const cart = await getCartById(cartId);
  if (!cart) throw new Error('Panier introuvable');
  if (cart.status !== 'en_cours') throw new Error('Panier non modifiable');

  const hasLines = (cart.lines?.length || 0) > 0;
  if (data.sale_type && data.sale_type !== cart.sale_type && hasLines) {
    throw new Error('Impossible de changer le type de vente : le panier contient déjà des produits');
  }

  const fields = [];
  const params = [];
  let i = 1;

  if (data.sale_type !== undefined) {
    if (!['detail', 'gros'].includes(data.sale_type)) throw new Error('Type de vente invalide');
    fields.push(`sale_type = $${i++}`);
    params.push(data.sale_type);
  }
  if (data.client_id !== undefined) {
    const targetPv = data.delivery_point_id ?? cart.delivery_point_id;
    if (data.client_id) {
      await assertClientMatchesDeliveryPoint(data.client_id, targetPv);
    }
    fields.push(`client_id = $${i++}`);
    params.push(data.client_id || null);
  }
  if (data.delivery_point_id !== undefined) {
    if (!data.delivery_point_id) throw new Error('Point de livraison requis');
    if (data.client_id !== undefined && data.client_id) {
      await assertClientMatchesDeliveryPoint(data.client_id, data.delivery_point_id);
    } else if (cart.client_id) {
      await assertClientMatchesDeliveryPoint(cart.client_id, data.delivery_point_id);
    }
    fields.push(`delivery_point_id = $${i++}`);
    params.push(data.delivery_point_id);
  }
  if (data.seller_id !== undefined) {
    if (!data.seller_id) throw new Error('Vendeur requis');
    fields.push(`seller_id = $${i++}`);
    params.push(data.seller_id);
  }

  if (!fields.length) return cart;

  params.push(cartId);
  await pool.query(
    `UPDATE sales_carts SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i}`,
    params
  );
  const updated = await getCartById(cartId);
  emitEvent(EVENTS.CART_UPDATED, updated);
  return updated;
}

export async function cancelCart(cartId, userId) {
  const cart = await getCartById(cartId);
  if (!cart) throw new Error('Panier introuvable');
  if (cart.status !== 'en_cours') throw new Error('Seuls les paniers en cours peuvent être annulés');

  await pool.query(
    `UPDATE sales_carts SET status = 'annule', updated_at = NOW() WHERE id = $1`,
    [cartId]
  );
  emitEvent(EVENTS.CART_UPDATED, { id: cartId, status: 'annule' });
  await logAudit(userId, 'cancel', 'sales_cart', cartId, { cart_number: cart.cart_number });
  return { message: 'Panier annulé' };
}

async function getCartProductStockInfo(cartId, productId, deliveryPointId, db = pool) {
  await cancelEmptyOpenCartsAtPv(db, deliveryPointId, { excludeCartId: cartId });
  await cancelStaleOpenCartsAtPv(db, deliveryPointId, { excludeCartId: cartId });

  const available = await getStock(productId, deliveryPointId, db);
  const reservedRes = await db.query(
    `SELECT COALESCE(SUM(sl.quantity), 0) AS qty,
            COUNT(DISTINCT sc.id)::int AS open_carts
     FROM sale_lines sl
     JOIN sales_carts sc ON sc.id = sl.cart_id
     WHERE sl.product_id = $1
       AND sc.status = 'en_cours'
       AND sc.delivery_point_id = $2
       AND sc.updated_at >= NOW() - ($3 || ' hours')::interval`,
    [productId, deliveryPointId, STALE_OPEN_CART_HOURS]
  );
  const reservedAllCarts = parseFloat(reservedRes.rows[0]?.qty ?? 0);
  const reservedOpenCarts = parseInt(reservedRes.rows[0]?.open_carts ?? 0, 10);
  const cartQtyRes = await db.query(
    `SELECT COALESCE(SUM(quantity), 0) AS qty FROM sale_lines
     WHERE cart_id = $1 AND product_id = $2`,
    [cartId, productId]
  );
  const alreadyInCart = parseFloat(cartQtyRes.rows[0]?.qty ?? 0);
  const reservedOthers = Math.max(0, reservedAllCarts - alreadyInCart);
  const effectivelyAvailable = Math.max(0, available - reservedOthers);
  return {
    available,
    in_cart: alreadyInCart,
    reserved_others: reservedOthers,
    reserved_open_carts: reservedOpenCarts,
    remaining: effectivelyAvailable,
    effectively_available: effectivelyAvailable,
  };
}

async function assertStockAvailable(cartId, productId, deliveryPointId, addQty, db = pool) {
  const stockInfo = await getCartProductStockInfo(cartId, productId, deliveryPointId, db);
  const { available, in_cart: alreadyInCart, reserved_others: reservedOthers, effectively_available: effectivelyAvailable } = stockInfo;
  const requested = alreadyInCart + addQty;

  if (requested > effectivelyAvailable + 0.0001) {
    const prod = await db.query('SELECT name, reference FROM products WHERE id = $1', [productId]);
    const label = prod.rows[0]?.name || 'Produit';
    throw new Error(
      `Stock insuffisant pour « ${label} » : disponible caisse ${Math.round(effectivelyAvailable)}, ` +
      `déjà ${Math.round(alreadyInCart)} dans ce panier, vous ajoutez ${addQty}` +
      (reservedOthers > 0.0001
        ? ` (${Math.round(reservedOthers)} réservé(s) dans d'autres paniers ouverts au même point de vente)`
        : '') +
      (available > effectivelyAvailable + 0.0001
        ? ` — stock magasin ${Math.round(available)} au point de vente`
        : '')
    );
  }
}

export async function addLineToCart(cartId, line) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cartRes = await client.query(
      'SELECT status, delivery_point_id FROM sales_carts WHERE id = $1 FOR UPDATE',
      [cartId]
    );
    if (!cartRes.rows.length) throw new Error('Panier introuvable');
    if (cartRes.rows[0].status !== 'en_cours') throw new Error('Ce panier ne peut plus être modifié');

    if (!line.product_id) throw new Error('Produit requis');

    const qty = parseFloat(line.quantity);
    if (!qty || qty <= 0) throw new Error('Quantité invalide');

    const unitPrice = parseFloat(line.unit_price);
    if (Number.isNaN(unitPrice) || unitPrice < 0) throw new Error('Prix unitaire invalide');

    const discount = parseFloat(line.discount || 0);
    if (Number.isNaN(discount) || discount < 0) throw new Error('Remise invalide');
    if (discount > unitPrice + 0.0001) throw new Error('La remise ne peut pas dépasser le prix unitaire');

    const deliveryPointId = cartRes.rows[0].delivery_point_id;
    await cancelStaleOpenCartsAtPv(client, deliveryPointId, { excludeCartId: cartId });

    await client.query(
      `SELECT id FROM product_stock
       WHERE product_id = $1 AND delivery_point_id = $2
       FOR UPDATE`,
      [line.product_id, deliveryPointId]
    );

    await assertStockAvailable(cartId, line.product_id, deliveryPointId, qty, client);

    const lineTotal = roundGnf((unitPrice - discount) * qty);
    if (lineTotal < -0.0001) throw new Error('Total de ligne invalide');

    const prodRes = await client.query(
      `SELECT p.name, p.reference, p.purchase_price
       FROM products p
       WHERE p.id = $1`,
      [line.product_id]
    );
    if (!prodRes.rows.length) throw new Error('Produit introuvable');
    const prod = prodRes.rows[0];
    const purchasePriceSnapshot = parseFloat(prod.purchase_price || 0);

    const { rows } = await client.query(
      `INSERT INTO sale_lines (
         cart_id, product_id, unit_price, discount, quantity, line_total,
         product_name_snapshot, product_reference_snapshot, purchase_price_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [cartId, line.product_id, unitPrice, discount, qty, lineTotal, prod.name, prod.reference, purchasePriceSnapshot]
    );

    await recalculateCartTotal(cartId, client);
    await client.query('COMMIT');

    const cart = await getCartById(cartId);
    emitEvent(EVENTS.CART_UPDATED, cart);
    return { line: rows[0], cart };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function removeLineFromCart(lineId, cartId, userId) {
  const { rows: lineRows } = await pool.query(
    `SELECT sl.id, sl.quantity, sc.cart_number, p.reference, p.name AS product_name
     FROM sale_lines sl
     JOIN sales_carts sc ON sc.id = sl.cart_id
     JOIN products p ON p.id = sl.product_id
     WHERE sl.id = $1 AND sl.cart_id = $2`,
    [lineId, cartId]
  );
  if (!lineRows.length) {
    const err = new Error('Ligne introuvable');
    err.status = 404;
    throw err;
  }
  const line = lineRows[0];
  await pool.query('DELETE FROM sale_lines WHERE id = $1 AND cart_id = $2', [lineId, cartId]);
  await recalculateCartTotal(cartId);
  const cart = await getCartById(cartId);
  if (userId) {
    await logAudit(userId, 'delete', 'sale_line', parseInt(lineId, 10), {
      cart_number: line.cart_number,
      reference: line.reference,
      product_name: line.product_name,
      quantity: line.quantity,
    });
  }
  emitEvent(EVENTS.CART_UPDATED, cart);
  return cart;
}

async function recalculateCartTotal(cartId, db = pool) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(line_total), 0) AS total FROM sale_lines WHERE cart_id = $1`,
    [cartId]
  );
  const total = roundGnf(rows[0].total);
  await db.query(
    `UPDATE sales_carts SET total_amount = $1, updated_at = NOW() WHERE id = $2`,
    [total, cartId]
  );
  return total;
}

async function getCartPayments(cartId) {
  try {
    const { rows } = await pool.query(
      `SELECT cp.*, u.username AS created_by_name
       FROM cart_payments cp
       LEFT JOIN users u ON u.id = cp.created_by
       WHERE cp.cart_id = $1 ORDER BY cp.created_at`,
      [cartId]
    );
    return rows;
  } catch (e) {
    if (e.code === '42P01') return [];
    throw e;
  }
}

export async function getCartById(cartId) {
  const cartRes = await pool.query(
    `SELECT sc.*,
            c.name AS client_name, c.code AS client_code,
            c.address AS client_address, c.contact AS client_contact, c.client_type,
            c.delivery_point_id AS client_delivery_point_id,
            e.name AS seller_name, e.matricule AS seller_matricule,
            e.delivery_point_id AS seller_delivery_point_id,
            dp.code AS delivery_point_code, dp.name AS delivery_point_name
     FROM sales_carts sc
     LEFT JOIN clients c ON c.id = sc.client_id
     LEFT JOIN employees e ON e.id = sc.seller_id
     LEFT JOIN delivery_points dp ON dp.id = sc.delivery_point_id
     WHERE sc.id = $1`,
    [cartId]
  );
  if (!cartRes.rows.length) return null;

  const linesRes = await pool.query(
    `SELECT sl.id, sl.cart_id, sl.product_id, sl.unit_price, sl.discount, sl.quantity, sl.line_total, sl.created_at,
            sl.product_name_snapshot, sl.product_reference_snapshot,
            ${SALE_LINE_PRODUCT_NAME_SQL} AS product_name,
            ${SALE_LINE_PRODUCT_REFERENCE_SQL} AS product_reference
     FROM sale_lines sl
     JOIN products p ON p.id = sl.product_id
     WHERE sl.cart_id = $1 ORDER BY sl.id`,
    [cartId]
  );

  const payments = await getCartPayments(cartId);
  const total = roundGnf(cartRes.rows[0].total_amount || 0);
  const paid = roundGnf(cartRes.rows[0].amount_paid || 0);

  return {
    ...cartRes.rows[0],
    lines: linesRes.rows,
    payments,
    balance_due: balanceDueGnf(total, paid),
  };
}

async function createSalesDebtSettlement(dbClient, cart, balanceDue, userId) {
  const due = balanceDueGnf(balanceDue, 0);
  if (!cart.client_id || due <= 0) return;

  const existing = await dbClient.query(
    `SELECT id FROM settlements
     WHERE reference_id = $1 AND settlement_type = 'creance_commerciale' LIMIT 1`,
    [cart.id]
  );
  if (existing.rows.length) return;

  const total = roundGnf(cart.total_amount || 0);
  const paid = Math.max(0, total - due);
  const settlementNumber = `CRE-${cart.cart_number}`;
  await dbClient.query(
    `INSERT INTO settlements (
       settlement_number, settlement_type, reference_id, client_id,
       amount, amount_paid, balance, status, notes, created_by
     ) VALUES ($1, 'creance_commerciale', $2, $3, $4, $5, $6, 'en_cours', $7, $8)`,
    [
      settlementNumber,
      cart.id,
      cart.client_id,
      total,
      paid,
      due,
      `Dette vente ${cart.cart_number}`,
      userId,
    ]
  );
}

async function ensureSalesDebtSettlementForCart(dbClient, cartId, userId) {
  const cartRes = await dbClient.query(
    `SELECT id, cart_number, client_id, total_amount, amount_paid, status, created_by
     FROM sales_carts WHERE id = $1`,
    [cartId]
  );
  if (!cartRes.rows.length) return null;

  const cart = cartRes.rows[0];
  if (!cart.client_id) return null;

  const balanceDue = balanceDueGnf(cart.total_amount, cart.amount_paid);

  const settRes = await dbClient.query(
    `SELECT id FROM settlements
     WHERE reference_id = $1 AND settlement_type = 'creance_commerciale' LIMIT 1`,
    [cartId]
  );

  if (!settRes.rows.length && balanceDue > 0 && cart.status === 'finalise') {
    await createSalesDebtSettlement(dbClient, cart, balanceDue, userId);
  }

  return syncLinkedSettlementFromCart(dbClient, cartId);
}

export async function syncLinkedSettlementFromCart(dbClient, cartId) {
  const cartRes = await dbClient.query(
    `SELECT id, total_amount, amount_paid FROM sales_carts WHERE id = $1`,
    [cartId]
  );
  if (!cartRes.rows.length) return null;

  const total = roundGnf(cartRes.rows[0].total_amount || 0);
  const paid = roundGnf(cartRes.rows[0].amount_paid || 0);
  const balanceDue = balanceDueGnf(total, paid);

  const settRes = await dbClient.query(
    `SELECT id FROM settlements
     WHERE reference_id = $1 AND settlement_type = 'creance_commerciale'
       AND COALESCE(status, 'en_cours') != 'annule'`,
    [cartId]
  );
  if (!settRes.rows.length) return balanceDue;

  for (const settlement of settRes.rows) {
    await dbClient.query(
      `UPDATE settlements SET
         amount = $1::numeric,
         amount_paid = $2::numeric,
         balance = $3::numeric,
         status = CASE WHEN $3::numeric <= 0 THEN 'solde' ELSE 'en_cours' END,
         updated_at = NOW()
       WHERE id = $4::int`,
      [total, paid, balanceDue, settlement.id]
    );
  }

  return balanceDue;
}

/** Corrige les paniers encaissés en totalité mais encore affichés avec un reste (arrondis GNF). */
export async function reconcileMisreportedCartBalances({ date = null } = {}) {
  const params = [];
  let dateClause = '';
  if (date) {
    dateClause = 'AND DATE(COALESCE(sc.validated_at, sc.created_at)) = $1::date';
    params.push(date);
  }

  const { rows } = await pool.query(
    `SELECT sc.id, sc.cart_number, sc.total_amount, sc.amount_paid,
            COALESCE((
              SELECT SUM(cp.amount) FROM cart_payments cp WHERE cp.cart_id = sc.id
            ), 0) AS payments_sum
     FROM sales_carts sc
     WHERE sc.status != 'annule'
       AND COALESCE(sc.total_amount, 0) > 0
       ${dateClause}`,
    params
  );

  const fixed = [];
  for (const row of rows) {
    const total = roundGnf(row.total_amount);
    const paid = roundGnf(row.amount_paid);
    const paymentsSum = roundGnf(row.payments_sum);
    const cashReceived = Math.max(paid, paymentsSum);
    const due = balanceDueGnf(total, paid);
    if (due <= 0) continue;

    const shouldFix = isFullyPaidGnf(total, cashReceived)
      || (due <= 1 && cashReceived >= total - 1);
    if (!shouldFix) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE sales_carts
         SET amount_paid = $1,
             change_amount = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [total, Math.max(0, cashReceived - total), row.id]
      );
      await syncLinkedSettlementFromCart(client, row.id);
      await client.query('COMMIT');
      fixed.push({
        id: row.id,
        cart_number: row.cart_number,
        total,
        was_due: due,
        was_paid: paid,
        now_paid: total,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return fixed;
}

/**
 * Corrige les paniers d'une date validés avec encaissement partiel enregistré
 * alors que le client a soldé la totalité (montant reçu non resynchronisé).
 */
export async function forceSettlePaidInFullCarts({ date, userId = null } = {}) {
  if (!date) throw new Error('Date requise');
  const actorId = Number.isFinite(Number(userId)) ? Number(userId) : 1;

  const { rows } = await pool.query(
    `SELECT sc.id, sc.cart_number, sc.total_amount, sc.amount_paid, sc.client_id,
            c.name AS client_name
     FROM sales_carts sc
     LEFT JOIN clients c ON c.id = sc.client_id
     WHERE sc.status = 'finalise'
       AND DATE(COALESCE(sc.validated_at, sc.created_at)) = $1::date
       AND COALESCE(sc.amount_paid, 0) > 0
       AND GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0)) > 0`,
    [date]
  );

  const fixed = [];
  for (const row of rows) {
    const total = roundGnf(row.total_amount);
    const paid = roundGnf(row.amount_paid);
    const remainder = balanceDueGnf(total, paid);
    if (remainder <= 0) continue;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE sales_carts
         SET amount_paid = $1::numeric,
             change_amount = 0,
             updated_at = NOW()
         WHERE id = $2::int`,
        [total, row.id]
      );

      const clientLabel = row.client_name ? ` — ${row.client_name}` : '';
      await client.query(
        `INSERT INTO cash_transactions (cash_date, transaction_type, amount, description, reference_type, reference_id, created_by)
         VALUES (CURRENT_DATE, 'recette', $1::numeric, $2, 'sales_cart', $3::int, $4::int)`,
        [
          remainder,
          `Correction encaissement ${row.cart_number}${clientLabel}`,
          row.id,
          actorId,
        ]
      );

      await syncLinkedSettlementFromCart(client, row.id);
      await client.query('COMMIT');

      fixed.push({
        cart_number: row.cart_number,
        total,
        was_paid: paid,
        added: remainder,
        now_paid: total,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  return fixed;
}

export async function syncMissingSalesDebtSettlements() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const fixed = await reconcileMisreportedCartBalances({ date: today });
    if (fixed.length) {
      console.log(`Réconciliation soldes paniers (${today}) : ${fixed.length} corrigé(s)`);
    }
  } catch (err) {
    console.error('Réconciliation soldes paniers:', err.message);
  }

  const { rows } = await pool.query(
    `SELECT sc.id, sc.cart_number, sc.client_id, sc.created_by,
            sc.total_amount, sc.amount_paid,
            (${CART_BALANCE_DUE_SQL}) AS balance_due
     FROM sales_carts sc
     WHERE sc.status = 'finalise'
       AND sc.client_id IS NOT NULL
       AND (${CART_BALANCE_DUE_SQL}) > 0.005
       AND NOT EXISTS (
         SELECT 1 FROM settlements s
         WHERE s.reference_id = sc.id AND s.settlement_type = 'creance_commerciale'
       )`
  );

  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await createSalesDebtSettlement(client, row, parseFloat(row.balance_due), row.created_by);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code !== '23505') throw err;
    } finally {
      client.release();
    }
  }

  const linked = await pool.query(
    `SELECT DISTINCT reference_id AS cart_id FROM settlements
     WHERE reference_id IS NOT NULL AND settlement_type = 'creance_commerciale'`
  );
  for (const row of linked.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await syncLinkedSettlementFromCart(client, row.cart_id);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.warn('Sync règlement lié (cart', row.cart_id, '):', err.message);
    } finally {
      client.release();
    }
  }
}

async function ensureProformaInvoiceForCart(client, cartId, clientId, total, deliveryPointId = null) {
  const existing = await client.query(
    'SELECT id FROM proforma_invoices WHERE cart_id = $1 LIMIT 1',
    [cartId]
  );
  if (existing.rows.length) return;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const invoiceNumber = await generateProformaNumber(client, deliveryPointId);
    try {
      await client.query(
        `INSERT INTO proforma_invoices (invoice_number, cart_id, client_id, total_amount)
         VALUES ($1, $2, $3, $4)`,
        [invoiceNumber, cartId, clientId, total]
      );
      return;
    } catch (err) {
      if (err.code !== '23505') throw err;
      const detail = String(err.constraint || err.detail || '').toLowerCase();
      if (detail.includes('cart_id')) return;
      if (detail.includes('invoice_number') || detail.includes('proforma')) continue;
      throw err;
    }
  }
  throw Object.assign(new Error('Numéro de facture temporairement indisponible — réessayez'), { status: 409 });
}

async function finalizeCart(cartId, userId, paymentData = null) {
  const { isInventoryLocked } = await import('../utils/inventoryLock.js');
  if (await isInventoryLocked()) {
    throw Object.assign(new Error('Inventaire physique en cours — les ventes sont suspendues'), { status: 423 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cartRes = await client.query(
      `SELECT sc.*, c.name AS client_name
       FROM sales_carts sc
       LEFT JOIN clients c ON c.id = sc.client_id
       WHERE sc.id = $1
       FOR UPDATE OF sc`,
      [cartId]
    );
    if (!cartRes.rows.length) throw new Error('Panier introuvable');
    const cart = cartRes.rows[0];

    if (cart.status !== 'en_cours') {
      if (cart.status === 'finalise') {
        await client.query('ROLLBACK');
        return getCartById(cartId);
      }
      throw Object.assign(new Error('Ce panier ne peut plus être validé'), { status: 400 });
    }

    const { rows: lines } = await client.query(
      'SELECT * FROM sale_lines WHERE cart_id = $1 ORDER BY product_id, id',
      [cartId]
    );
    if (!lines.length) throw new Error('Le panier est vide');
    if (!cart.client_id) throw new Error('Sélectionnez un client avant de valider la vente');

    if (paymentData) {
      const resteBeforePay = balanceDueGnf(cart.total_amount, cart.amount_paid);
      const useAdvance = coerceBoolean(paymentData.use_advance);
      const installment = normalizeInstallmentGnf(
        resteBeforePay,
        paymentData.amount_paid ?? paymentData.amount ?? 0,
      );
      if (resteBeforePay > 0.005 && (installment > 0.005 || useAdvance)) {
        await applyCartInstallmentInTx(
          client,
          cart,
          installment,
          paymentData.payment_mode || 'especes',
          userId,
          { useAdvance },
        );
      }
    }

    const total = roundGnf(cart.total_amount);
    let amountPaid = roundGnf(cart.amount_paid || 0);
    if (isFullyPaidGnf(total, amountPaid)) {
      amountPaid = total;
    }
    const changeAmount = Math.max(0, amountPaid - total);

    for (const line of lines) {
      await deductStock(
        line.product_id,
        cart.delivery_point_id,
        parseFloat(line.quantity),
        'sales_cart',
        cartId,
        userId,
        client
      );
    }

    const updateRes = await client.query(
      `UPDATE sales_carts SET
         status = 'finalise',
         amount_paid = $1,
         change_amount = $2,
         validated_at = NOW(),
         updated_at = NOW()
       WHERE id = $3 AND status = 'en_cours'`,
      [amountPaid, changeAmount, cartId]
    );
    if (updateRes.rowCount === 0) {
      const statusRes = await client.query('SELECT status FROM sales_carts WHERE id = $1', [cartId]);
      if (statusRes.rows[0]?.status === 'finalise') {
        await client.query('ROLLBACK');
        return getCartById(cartId);
      }
      throw Object.assign(
        new Error('Ce panier vient d\'être modifié par un autre utilisateur — actualisez la caisse'),
        { status: 409 }
      );
    }

    await ensureProformaInvoiceForCart(client, cartId, cart.client_id, total, cart.delivery_point_id);

    const balanceDue = balanceDueGnf(total, amountPaid);
    if (balanceDue > 0) {
      await createSalesDebtSettlement(client, { ...cart, id: cartId, lines }, balanceDue, userId);
    } else {
      await syncLinkedSettlementFromCart(client, cartId);
    }

    await client.query('COMMIT');

    const validated = await getCartById(cartId);
    emitEvent(EVENTS.CART_VALIDATED, validated);
    emitEvent(EVENTS.DASHBOARD_REFRESH, {});
    await logAudit(userId, 'validate', 'sales_cart', cartId, {
      cart_number: cart.cart_number,
      total,
      amount_paid: amountPaid,
      balance_due: balanceDueGnf(total, amountPaid),
    });

    return validated;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.status) throw err;
    const message = friendlyDbError(err, err.message);
    const status = err.code === '23505' || err.code === '40P01' || err.code === '55P03' ? 409 : 500;
    throw Object.assign(new Error(message), { status });
  } finally {
    client.release();
  }
}

async function resolveCartSalePv(dbClient, cartId) {
  const { rows } = await dbClient.query(
    `SELECT sc.delivery_point_id AS cart_pv,
            c.delivery_point_id AS client_pv,
            e.delivery_point_id AS seller_pv
     FROM sales_carts sc
     LEFT JOIN clients c ON c.id = sc.client_id
     LEFT JOIN employees e ON e.id = sc.seller_id
     WHERE sc.id = $1`,
    [cartId]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return r.client_pv ?? r.cart_pv ?? r.seller_pv ?? null;
}

async function syncCartSalePv(dbClient, cartId) {
  const pv = await resolveCartSalePv(dbClient, cartId);
  if (pv == null) return null;
  await dbClient.query(
    'UPDATE sales_carts SET delivery_point_id = $1, updated_at = NOW() WHERE id = $2',
    [pv, cartId]
  );
  return pv;
}

async function insertCartPaymentRow(dbClient, cartId, installment, paymentMode, userId, batchRef = null, deliveryPointId = null) {
  const pv = deliveryPointId ?? await resolveCartSalePv(dbClient, cartId);
  if (pv != null) {
    await syncCartSalePv(dbClient, cartId);
  }
  const baseParams = [cartId, installment, paymentMode, userId];
  const sqlWithPvBatch = `INSERT INTO cart_payments (cart_id, amount, payment_mode, created_by, batch_ref, delivery_point_id)
     VALUES ($1, $2, $3, $4, $5, $6)`;
  const sqlWithPv = `INSERT INTO cart_payments (cart_id, amount, payment_mode, created_by, delivery_point_id)
     VALUES ($1, $2, $3, $4, $5)`;
  const sqlWithBatch = `INSERT INTO cart_payments (cart_id, amount, payment_mode, created_by, batch_ref)
     VALUES ($1, $2, $3, $4, $5)`;
  const sqlBasic = `INSERT INTO cart_payments (cart_id, amount, payment_mode, created_by)
     VALUES ($1, $2, $3, $4)`;

  const attempts = [];
  if (pv != null && batchRef) {
    attempts.push({ sql: sqlWithPvBatch, params: [...baseParams, batchRef, pv] });
  }
  if (pv != null) {
    attempts.push({ sql: sqlWithPv, params: [...baseParams, pv] });
  }
  attempts.push({
    sql: batchRef ? sqlWithBatch : sqlBasic,
    params: batchRef ? [...baseParams, batchRef] : baseParams,
  });

  for (let i = 0; i < attempts.length; i += 1) {
    const { sql, params } = attempts[i];
    const isLast = i === attempts.length - 1;
    const ok = await withSavepoint(
      dbClient,
      () => dbClient.query(sql, params),
      { ignoreCodes: isLast ? ['42P01'] : ['42703', '42P01'] },
    );
    if (ok) return;
  }
}

async function applyCartInstallmentInTx(
  dbClient,
  lockedCart,
  installment,
  paymentMode,
  userId,
  { batchRef = null, skipCashTx = false, useAdvance = false } = {}
) {
  const cartId = lockedCart.id;
  const alreadyPaid = roundGnf(lockedCart.amount_paid || 0);
  const total = roundGnf(lockedCart.total_amount || 0);
  const reste = balanceDueGnf(total, alreadyPaid);

  let cashPart = roundGnf(installment);
  let advancePart = 0;

  if (useAdvance && lockedCart.client_id && reste > 0.005) {
    advancePart = await consumeClientAdvanceInTx(
      dbClient,
      lockedCart.client_id,
      reste,
      userId,
      { cart_number: lockedCart.cart_number, cart_id: cartId },
    );
    // Après déduction de l'avance, n'encaisser en espèces que le reliquat (jamais d'erreur si le champ contient encore le total).
    const maxCashAfterAdvance = Math.max(0, reste - advancePart);
    cashPart = Math.min(cashPart, maxCashAfterAdvance);
  }

  const newPaid = alreadyPaid + advancePart + cashPart;
  if (advancePart > 0.005) {
    // Mode espèces pour l'enum DB ; la trace « Utilisation avance » est sur le settlement.
    await insertCartPaymentRow(dbClient, cartId, advancePart, paymentMode || 'especes', userId, batchRef);
  }
  if (cashPart > 0.005) {
    await insertCartPaymentRow(dbClient, cartId, cashPart, paymentMode, userId, batchRef);
  }
  if (advancePart <= 0.005 && cashPart <= 0.005) {
    if (useAdvance) {
      throw new Error('Aucun crédit d\'avance disponible pour ce client');
    }
    return alreadyPaid;
  }

  await dbClient.query(
    `UPDATE sales_carts SET amount_paid = $1, payment_mode = $2, updated_at = NOW() WHERE id = $3`,
    [newPaid, paymentMode, cartId]
  );

  if (!skipCashTx && cashPart > 0.005) {
    const clientLabel = lockedCart.client_name ? ` — ${lockedCart.client_name}` : '';
    const cashDescription = lockedCart.status === 'finalise'
      ? `Règlement dette ${lockedCart.cart_number}${clientLabel}`
      : `Encaissement panier ${lockedCart.cart_number}${clientLabel}`;
    await dbClient.query(
      `INSERT INTO cash_transactions (cash_date, transaction_type, amount, description, reference_type, reference_id, created_by)
       VALUES (CURRENT_DATE, 'recette', $1, $2, 'sales_cart', $3, $4)`,
      [cashPart, cashDescription, cartId, userId]
    );
  }

  if (lockedCart.client_id) {
    await ensureSalesDebtSettlementForCart(dbClient, cartId, userId);
  }
  lockedCart.amount_paid = newPaid;
  return newPaid;
}

async function getClientAdvanceBalanceInTx(dbClient, clientId) {
  const clientIdNum = parseInt(clientId, 10);
  if (!clientIdNum) return 0;
  const { rows } = await dbClient.query(
    `SELECT COALESCE(SUM(balance), 0)::float AS total
     FROM settlements
     WHERE client_id = $1
       AND settlement_type = $2
       AND status = 'en_cours'
       AND balance > 0.005`,
    [clientIdNum, CLIENT_ADVANCE_SETTLEMENT_TYPE]
  );
  return roundGnf(rows[0]?.total || 0);
}

async function consumeClientAdvanceInTx(dbClient, clientId, amountNeeded, userId, context = {}) {
  const clientIdNum = parseInt(clientId, 10);
  const target = roundGnf(amountNeeded);
  if (!clientIdNum || target <= 0.005) return 0;

  const { rows } = await dbClient.query(
    `SELECT id, settlement_number, amount, amount_paid, balance
     FROM settlements
     WHERE client_id = $1
       AND settlement_type = $2
       AND status = 'en_cours'
       AND balance > 0.005
     ORDER BY created_at ASC
     FOR UPDATE`,
    [clientIdNum, CLIENT_ADVANCE_SETTLEMENT_TYPE]
  );

  let remaining = target;
  let totalUsed = 0;

  for (const adv of rows) {
    if (remaining <= 0.005) break;
    const bal = roundGnf(adv.balance);
    const use = normalizeInstallmentGnf(bal, Math.min(remaining, bal));
    if (use <= 0) continue;

    const newAmountPaid = roundGnf(adv.amount_paid || 0) + use;
    const newBalance = Math.max(0, roundGnf(adv.amount) - newAmountPaid);
    const newStatus = newBalance <= 0.005 ? 'solde' : 'en_cours';
    const note = context.cart_number
      ? `Utilisation avance — panier ${context.cart_number}`
      : 'Utilisation avance client';

    await dbClient.query(
      `UPDATE settlements
       SET amount_paid = $1, balance = $2, status = $3, updated_at = NOW()
       WHERE id = $4`,
      [newAmountPaid, newBalance, newStatus, adv.id]
    );
    await dbClient.query(
      `INSERT INTO settlement_payments (settlement_id, amount, payment_mode, notes, created_by)
       VALUES ($1, $2, 'especes', $3, $4)`,
      [adv.id, use, note, userId]
    );

    remaining -= use;
    totalUsed += use;
  }

  return totalUsed;
}

export async function listClientAdvances(clientId) {
  const clientIdNum = parseInt(clientId, 10);
  if (!clientIdNum) throw new Error('Client invalide');
  const { rows } = await pool.query(
    `SELECT id, settlement_number, amount, amount_paid, balance, notes, created_at
     FROM settlements
     WHERE client_id = $1
       AND settlement_type = $2
       AND balance > 0.005
       AND status = 'en_cours'
     ORDER BY created_at ASC`,
    [clientIdNum, CLIENT_ADVANCE_SETTLEMENT_TYPE]
  );
  const advance_balance = rows.reduce((s, r) => s + roundGnf(r.balance), 0);
  return { advances: rows, advance_balance, advance_count: rows.length };
}

export async function getClientEncaissementAccount(clientId) {
  const clientIdNum = parseInt(clientId, 10);
  if (!clientIdNum) throw new Error('Client invalide');

  const [cartsData, advancesData, settlementsData, balanceRes] = await Promise.all([
    listClientUnpaidCarts(clientId),
    listClientAdvances(clientId),
    listClientUnpaidSettlements(clientId),
    pool.query(
      `SELECT
         ${clientCartBalanceSubquery('$1')}::float AS cart_balance_due,
         ${clientSettlementBalanceSubquery('$1')}::float AS settlement_balance_due,
         ${clientTotalBalanceSql('$1')}::float AS total_balance_due`,
      [clientIdNum],
    ),
  ]);

  const totalBalance = parseFloat(balanceRes.rows[0]?.total_balance_due || 0);

  return {
    ...cartsData,
    ...advancesData,
    settlements: settlementsData.settlements,
    settlement_count: settlementsData.settlement_count,
    cart_balance_due: parseFloat(balanceRes.rows[0]?.cart_balance_due || cartsData.total_due || 0),
    settlement_balance_due: parseFloat(balanceRes.rows[0]?.settlement_balance_due || 0),
    total_due: totalBalance,
  };
}

export async function recordClientAdvancePayment(clientId, paymentData, userId) {
  const clientIdNum = parseInt(clientId, 10);
  if (!clientIdNum) throw new Error('Client invalide');

  const clientRes = await pool.query(
    `SELECT id, name, code FROM clients WHERE id = $1 AND is_active = TRUE`,
    [clientIdNum]
  );
  if (!clientRes.rows.length) throw new Error('Client introuvable');
  const clientInfo = clientRes.rows[0];

  const installment = normalizeInstallmentGnf(
    Number.MAX_SAFE_INTEGER,
    paymentData.amount_paid ?? paymentData.amount ?? 0
  );
  if (!installment || installment <= 0) {
    throw new Error('Montant d\'avance invalide');
  }

  const paymentMode = paymentData.payment_mode || 'especes';
  const notes = paymentData.notes?.trim() || null;
  const settlementNumber = `AVC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    const { rows } = await dbClient.query(
      `INSERT INTO settlements (
         settlement_number, settlement_type, client_id,
         amount, amount_paid, balance, status, notes, created_by
       ) VALUES ($1, $2, $3, $4, 0, $4, 'en_cours', $5, $6)
       RETURNING id, settlement_number, amount, balance, created_at`,
      [settlementNumber, CLIENT_ADVANCE_SETTLEMENT_TYPE, clientIdNum, installment, notes, userId]
    );
    const settlement = rows[0];

    await dbClient.query(
      `INSERT INTO settlement_payments (settlement_id, amount, payment_mode, notes, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [settlement.id, installment, paymentMode, 'Versement avance client', userId]
    );

    await dbClient.query(
      `INSERT INTO cash_transactions (cash_date, transaction_type, amount, description, reference_type, reference_id, created_by)
       VALUES (CURRENT_DATE, 'recette', $1, $2, 'settlement', $3, $4)`,
      [
        installment,
        `Avance client — ${clientInfo.name}${clientInfo.code ? ` (${clientInfo.code})` : ''}`,
        settlement.id,
        userId,
      ]
    );

    await dbClient.query('COMMIT');

    const advance_balance = await getClientAdvanceBalanceInTx(dbClient, clientIdNum);

    await logAudit(userId, 'payment', 'settlement', settlement.id, {
      settlement_number: settlement.settlement_number,
      settlement_type: CLIENT_ADVANCE_SETTLEMENT_TYPE,
      amount: installment,
      client_id: clientIdNum,
    });

    return {
      settlement_id: settlement.id,
      settlement_number: settlement.settlement_number,
      amount: installment,
      advance_balance,
      message: `Avance de ${installment.toLocaleString('fr-FR')} GNF enregistrée pour ${clientInfo.name}`,
    };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function listClientUnpaidCarts(clientId) {
  const clientIdNum = parseInt(clientId, 10);
  if (!clientIdNum) throw new Error('Client invalide');
  const { rows } = await pool.query(
    `SELECT sc.id, sc.cart_number, sc.status, sc.total_amount, sc.amount_paid,
            (${CART_BALANCE_DUE_SQL}) AS balance_due,
            sc.validated_at, sc.created_at, e.name AS seller_name
     FROM sales_carts sc
     LEFT JOIN employees e ON e.id = sc.seller_id
     WHERE sc.client_id = $1
       AND sc.status IN ('finalise', 'en_cours')
       AND (${CART_BALANCE_DUE_SQL}) > 0.005
     ORDER BY COALESCE(sc.validated_at, sc.created_at) ASC`,
    [clientIdNum]
  );
  const totalDue = rows.reduce((s, c) => s + balanceDueGnf(c.total_amount, c.amount_paid), 0);
  return { carts: rows, total_due: totalDue, cart_count: rows.length };
}

async function listClientUnpaidSettlements(clientId, db = pool) {
  const clientIdNum = parseInt(clientId, 10);
  if (!clientIdNum) throw new Error('Client invalide');
  const { rows } = await db.query(
    `SELECT id, settlement_number, settlement_type, amount, amount_paid, balance, notes, due_date, created_at
     FROM settlements
     WHERE client_id = $1
       AND reference_id IS NULL
       AND status = 'en_cours'
       AND balance > 0.005
       AND settlement_type IN ${CLIENT_RECEIVABLE_SETTLEMENT_TYPES}
     ORDER BY created_at ASC`,
    [clientIdNum]
  );
  const totalDue = rows.reduce((s, r) => s + roundGnf(r.balance), 0);
  return { settlements: rows, settlement_due: totalDue, settlement_count: rows.length };
}

async function applySettlementInstallmentInTx(dbClient, settlement, pay, paymentMode, userId) {
  await dbClient.query(
    `INSERT INTO settlement_payments (settlement_id, amount, payment_mode, notes, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [settlement.id, pay, paymentMode, 'Encaissement global client', userId]
  );
  await dbClient.query(
    `UPDATE settlements SET amount_paid = amount_paid + $1,
     balance = amount - (amount_paid + $1),
     status = CASE WHEN amount <= (amount_paid + $1) + 0.005 THEN 'solde' ELSE 'en_cours' END,
     updated_at = NOW() WHERE id = $2`,
    [pay, settlement.id]
  );
}

export async function recordClientBulkPayment(clientId, paymentData, userId) {
  const clientIdNum = parseInt(clientId, 10);
  if (!clientIdNum) throw new Error('Client invalide');

  const clientRes = await pool.query(
    `SELECT id, name, code, contact, address, client_type FROM clients WHERE id = $1 AND is_active = TRUE`,
    [clientIdNum]
  );
  if (!clientRes.rows.length) throw new Error('Client introuvable');
  const clientInfo = clientRes.rows[0];

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    const cartsRes = await dbClient.query(
      `SELECT sc.id, sc.cart_number, sc.status, sc.total_amount, sc.amount_paid, sc.client_id,
              c.name AS client_name
       FROM sales_carts sc
       LEFT JOIN clients c ON c.id = sc.client_id
       WHERE sc.client_id = $1
         AND sc.status IN ('finalise', 'en_cours')
         AND (${CART_BALANCE_DUE_SQL}) > 0.005
       ORDER BY COALESCE(sc.validated_at, sc.created_at) ASC
       FOR UPDATE OF sc`,
      [clientIdNum]
    );
    const settlementsRes = await dbClient.query(
      `SELECT id, settlement_number, settlement_type, amount, amount_paid, balance, notes, created_at
       FROM settlements
       WHERE client_id = $1
         AND reference_id IS NULL
         AND status = 'en_cours'
         AND balance > 0.005
         AND settlement_type IN ${CLIENT_RECEIVABLE_SETTLEMENT_TYPES}
       ORDER BY created_at ASC
       FOR UPDATE`,
      [clientIdNum]
    );
    const carts = cartsRes.rows;
    const settlements = settlementsRes.rows;
    const cartDue = carts.reduce((s, c) => s + balanceDueGnf(c.total_amount, c.amount_paid), 0);
    const settlementDue = settlements.reduce((s, r) => s + roundGnf(r.balance), 0);
    const totalDue = cartDue + settlementDue;
    if (totalDue <= 0.005) throw new Error('Aucune dette pour ce client');

    const installment = normalizeInstallmentGnf(
      totalDue,
      paymentData.amount_paid ?? paymentData.amount ?? totalDue
    );
    if (!installment || installment <= 0) throw new Error('Montant d\'encaissement invalide');
    if (installment > totalDue + 1) {
      throw new Error(`Montant trop élevé. Dette totale : ${totalDue.toLocaleString('fr-FR')} GNF`);
    }

    const batchRef = await generateCollectionBatchRef(dbClient);
    const paymentMode = paymentData.payment_mode || 'especes';
    let remaining = installment;
    const allocations = [];

    for (const cart of carts) {
      if (remaining <= 0.005) break;
      const due = balanceDueGnf(cart.total_amount, cart.amount_paid);
      if (due <= 0) continue;
      const pay = normalizeInstallmentGnf(due, Math.min(remaining, due));
      if (pay <= 0) continue;

      await applyCartInstallmentInTx(dbClient, cart, pay, paymentMode, userId, {
        batchRef,
        skipCashTx: true,
      });

      allocations.push({
        cart_id: cart.id,
        cart_number: cart.cart_number,
        amount: pay,
        balance_before: due,
        balance_after: balanceDueGnf(cart.total_amount, cart.amount_paid),
      });
      remaining -= pay;
    }

    for (const settlement of settlements) {
      if (remaining <= 0.005) break;
      const due = roundGnf(settlement.balance);
      if (due <= 0) continue;
      const pay = normalizeInstallmentGnf(due, Math.min(remaining, due));
      if (pay <= 0) continue;

      await applySettlementInstallmentInTx(dbClient, settlement, pay, paymentMode, userId);

      allocations.push({
        settlement_id: settlement.id,
        settlement_number: settlement.settlement_number,
        amount: pay,
        balance_before: due,
        balance_after: Math.max(0, due - pay),
      });
      remaining -= pay;
    }

    const paidItems = allocations.length;
    const clientLabel = clientInfo.name ? ` — ${clientInfo.name}` : '';
    await dbClient.query(
      `INSERT INTO cash_transactions (cash_date, transaction_type, amount, description, reference_type, reference_id, created_by)
       VALUES (CURRENT_DATE, 'recette', $1, $2, 'client', $3, $4)`,
      [
        installment,
        `Encaissement global ${batchRef}${clientLabel} (${paidItems} élément${paidItems > 1 ? 's' : ''})`,
        clientIdNum,
        userId,
      ]
    );

    await dbClient.query('COMMIT');

    emitEvent(EVENTS.DASHBOARD_REFRESH, {});
    for (const a of allocations) {
      emitEvent(EVENTS.CART_UPDATED, { id: a.cart_id });
    }

    await logAudit(userId, 'bulk_payment', 'client', clientIdNum, {
      batch_ref: batchRef,
      amount: installment,
      cart_count: allocations.length,
    });

    const balanceDueAfter = Math.max(0, totalDue - installment);
    return {
      batch_ref: batchRef,
      client: clientInfo,
      amount_paid: installment,
      payment_mode: paymentMode,
      total_due_before: totalDue,
      balance_due_after: balanceDueAfter,
      allocations,
      paid_at: new Date().toISOString(),
      message: balanceDueAfter <= 0.005
        ? `Dette soldée — ${installment.toLocaleString('fr-FR')} GNF encaissés`
        : `Versement enregistré — reste ${balanceDueAfter.toLocaleString('fr-FR')} GNF`,
    };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

export async function listPaymentReceipts(filters = {}) {
  const params = [];
  let i = 1;
  let dateFilter = '';
  if (filters.date_from) {
    dateFilter += ` AND cp.created_at >= $${i++}::date`;
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    dateFilter += ` AND cp.created_at < ($${i++}::date + interval '1 day')`;
    params.push(filters.date_to);
  }
  let clientFilter = '';
  const clientId = parseOptionalInt(filters.client_id);
  if (clientId != null) {
    clientFilter += ` AND sc.client_id = $${i++}`;
    params.push(clientId);
  }

  const enforcedPvId = parseOptionalInt(filters.enforced_pv_id);
  const pvCol = 'COALESCE(cp.delivery_point_id, c.delivery_point_id, sc.delivery_point_id)';
  if (enforcedPvId != null) {
    clientFilter += ` AND ${pvCol} = $${i++}`;
    params.push(enforcedPvId);
  } else {
    const deliveryPointId = parseOptionalInt(filters.delivery_point_id);
    if (deliveryPointId != null) {
      clientFilter += ` AND ${pvCol} = $${i++}`;
      params.push(deliveryPointId);
    }
  }

  const receiptFrom = `
         FROM cart_payments cp
         JOIN sales_carts sc ON sc.id = cp.cart_id
         LEFT JOIN clients c ON c.id = sc.client_id`;

  const runList = async (includeBulk) => {
    if (!includeBulk) {
      const { rows } = await pool.query(
        `SELECT 'single'::text AS receipt_type,
                sc.cart_number AS reference,
                cp.id AS payment_id,
                sc.id AS cart_id,
                cp.created_at,
                cp.amount::float AS amount_paid,
                cp.payment_mode::text AS payment_mode,
                1 AS cart_count,
                c.id AS client_id,
                c.name AS client_name,
                c.code AS client_code,
                NULL::text AS batch_ref
         ${receiptFrom}
         WHERE 1=1 ${dateFilter} ${clientFilter}
         ORDER BY cp.created_at DESC
         LIMIT 300`,
        params
      );
      return rows;
    }

    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT 'bulk'::text AS receipt_type,
                cp.batch_ref AS reference,
                NULL::int AS payment_id,
                NULL::int AS cart_id,
                MIN(cp.created_at) AS created_at,
                SUM(cp.amount)::float AS amount_paid,
                MAX(cp.payment_mode::text) AS payment_mode,
                COUNT(DISTINCT cp.cart_id)::int AS cart_count,
                MAX(c.id) AS client_id,
                MAX(c.name) AS client_name,
                MAX(c.code) AS client_code,
                cp.batch_ref
         ${receiptFrom}
         WHERE cp.batch_ref IS NOT NULL AND TRIM(cp.batch_ref) <> ''
         ${dateFilter} ${clientFilter}
         GROUP BY cp.batch_ref
         UNION ALL
         SELECT 'single'::text AS receipt_type,
                sc.cart_number AS reference,
                cp.id AS payment_id,
                sc.id AS cart_id,
                cp.created_at,
                cp.amount::float AS amount_paid,
                cp.payment_mode::text AS payment_mode,
                1 AS cart_count,
                c.id AS client_id,
                c.name AS client_name,
                c.code AS client_code,
                NULL::text AS batch_ref
         ${receiptFrom}
         WHERE (cp.batch_ref IS NULL OR TRIM(cp.batch_ref) = '')
         ${dateFilter} ${clientFilter}
       ) r
       ORDER BY created_at DESC
       LIMIT 300`,
      params
    );
    return rows;
  };

  try {
    return await runList(true);
  } catch (e) {
    if (e.code === '42703') return runList(false);
    throw e;
  }
}

export async function getBulkPaymentReceipt(batchRef) {
  const ref = String(batchRef || '').trim();
  if (!ref) throw new Error('Référence de reçu invalide');

  const { rows } = await pool.query(
    `SELECT cp.amount, cp.payment_mode, cp.created_at,
            sc.id AS cart_id, sc.cart_number, sc.total_amount, sc.amount_paid,
            c.id AS client_id, c.name, c.code, c.contact, c.address, c.client_type
     FROM cart_payments cp
     JOIN sales_carts sc ON sc.id = cp.cart_id
     JOIN clients c ON c.id = sc.client_id
     WHERE cp.batch_ref = $1
     ORDER BY cp.created_at, sc.cart_number`,
    [ref]
  );
  if (!rows.length) throw new Error('Reçu introuvable');

  const client = {
    id: rows[0].client_id,
    name: rows[0].name,
    code: rows[0].code,
    contact: rows[0].contact,
    address: rows[0].address,
    client_type: rows[0].client_type,
  };
  const allocations = rows.map((r) => {
    const amount = parseFloat(r.amount);
    return {
      cart_id: r.cart_id,
      cart_number: r.cart_number,
      amount,
      balance_after: balanceDueGnf(r.total_amount, r.amount_paid),
    };
  });
  const amountPaid = allocations.reduce((s, a) => s + a.amount, 0);
  const balanceDueAfter = allocations.reduce((s, a) => s + a.balance_after, 0);

  return {
    batch_ref: ref,
    client,
    amount_paid: amountPaid,
    payment_mode: rows[0].payment_mode,
    total_due_before: amountPaid + balanceDueAfter,
    balance_due_after: balanceDueAfter,
    allocations,
    paid_at: rows[0].created_at,
  };
}

export async function getSinglePaymentReceipt(paymentId) {
  const id = parseInt(paymentId, 10);
  if (!id) throw new Error('Reçu invalide');

  const { rows } = await pool.query(
    `SELECT cp.* FROM cart_payments cp WHERE cp.id = $1`,
    [id]
  );
  if (!rows.length) throw new Error('Reçu introuvable');

  const payment = rows[0];
  const cart = await getCartById(payment.cart_id);
  if (!cart) throw new Error('Panier introuvable');
  return { cart, payment };
}

export async function recordCartPayment(cartId, paymentData, userId) {
  const cart = await getCartById(cartId);
  if (!cart) throw new Error('Panier introuvable');
  if (!cart.lines?.length) throw new Error('Le panier est vide');

  const total = roundGnf(cart.total_amount);
  const alreadyPaid = roundGnf(cart.amount_paid || 0);
  const reste = balanceDueGnf(total, alreadyPaid);

  if (cart.status === 'finalise') {
    if (reste <= 0) {
      throw new Error('Ce panier est déjà entièrement encaissé');
    }
  } else if (cart.status !== 'en_cours') {
    throw new Error('Seuls les paniers en cours peuvent être encaissés ici');
  }

  if (reste <= 0) {
    throw new Error('Ce panier est déjà entièrement encaissé');
  }

  let installment = normalizeInstallmentGnf(
    reste,
    paymentData.amount_paid ?? paymentData.amount ?? 0
  );
  const useAdvance = coerceBoolean(paymentData.use_advance);
  if ((!installment || installment <= 0) && !useAdvance) {
    throw new Error('Montant du versement invalide');
  }
  installment = installment > 0 ? installment : 0;

  if (installment > reste + 1) {
    throw new Error(
      `Montant trop élevé. Reste à payer : ${reste.toLocaleString('fr-FR')} GNF`
    );
  }

  const paymentMode = paymentData.payment_mode || 'especes';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lockRes = await client.query(
      `SELECT sc.id, sc.status, sc.total_amount, sc.amount_paid, sc.cart_number, sc.client_id,
              c.name AS client_name
       FROM sales_carts sc
       LEFT JOIN clients c ON c.id = sc.client_id
       WHERE sc.id = $1
       FOR UPDATE OF sc`,
      [cartId]
    );
    if (!lockRes.rows.length) throw new Error('Panier introuvable');
    const lockedCart = lockRes.rows[0];
    if (lockedCart.status === 'finalise') {
      const lockedReste = balanceDueGnf(lockedCart.total_amount, lockedCart.amount_paid);
      if (lockedReste <= 0) throw new Error('Ce panier est déjà entièrement encaissé');
    } else if (lockedCart.status !== 'en_cours') {
      throw new Error('Seuls les paniers en cours peuvent être encaissés ici');
    }

    await applyCartInstallmentInTx(client, lockedCart, installment, paymentMode, userId, {
      useAdvance,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  emitEvent(EVENTS.CART_UPDATED, { id: cartId });
  emitEvent(EVENTS.DASHBOARD_REFRESH, {});

  const updated = await getCartById(cartId);
  const newPaid = roundGnf(updated.amount_paid || 0);
  await logAudit(userId, 'payment', 'sales_cart', cartId, {
    cart_number: cart.cart_number,
    installment,
    amount_paid: newPaid,
    use_advance: useAdvance,
  });

  const balanceDue = balanceDueGnf(total, newPaid);
  const hadDebt = cart.status === 'finalise';
  return {
    ...updated,
    finalized: cart.status === 'finalise',
    message: balanceDue > 0
      ? `Versement enregistré — reste ${balanceDue.toLocaleString('fr-FR')} GNF`
      : hadDebt
        ? 'Versement enregistré — dette soldée'
        : 'Versement enregistré — panier soldé',
  };
}

export async function finalizeZeroTotalCart(cartId, userId) {
  const cart = await getCartById(cartId);
  if (!cart) throw new Error('Panier introuvable');
  if (cart.status !== 'en_cours') throw new Error('Ce panier est déjà finalisé');
  if (!cart.lines?.length) throw new Error('Le panier est vide');
  const total = parseFloat(cart.total_amount || 0);
  if (total > 0.005) {
    throw new Error('Utilisez la validation standard pour ce panier');
  }
  return finalizeCart(cartId, userId);
}

export async function validateCart(cartId, userId, paymentData = null) {
  return finalizeCart(cartId, userId, paymentData);
}

export async function getClientReceivablesSummary(filters = {}) {
  return getCartListSummary({
    inventaire: 'true',
    status: 'finalise',
    ...filters,
  });
}

export async function getClientsReceivablesAggregate({
  search,
  debt_only,
  delivery_point_id,
  user,
  requestedPvId,
} = {}) {
  const pvId = parseOptionalInt(delivery_point_id);
  const cartPv = user
    ? pvCartSqlClause(user, 'sc', 1, requestedPvId ?? delivery_point_id)
    : { sql: pvId != null ? ' AND sc.delivery_point_id = $1' : '', params: pvId != null ? [pvId] : [] };
  const clientPv = user
    ? pvClientSqlClause(user, 'c', 1, requestedPvId ?? delivery_point_id)
    : { sql: pvId != null ? ' AND c.delivery_point_id = $1' : '', params: pvId != null ? [pvId] : [] };

  if (!search && !debt_only) {
    const [cartRes, extRes, clientsCountRes] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM((${CART_BALANCE_DUE_SQL})), 0)::float AS total_cart_balance_due
         FROM sales_carts sc
         WHERE ${CLIENT_CART_BALANCE_WHERE}${cartPv.sql}`,
        cartPv.params,
      ),
      pool.query(
        `SELECT COALESCE(SUM(s.balance), 0)::float AS total_external_balance_due
         FROM settlements s
         LEFT JOIN clients c ON c.id = s.client_id
         LEFT JOIN sales_carts sc ON sc.id = s.reference_id
         WHERE s.reference_id IS NULL
           AND s.status = 'en_cours'
           AND s.balance > 0.005
           AND s.settlement_type IN ${CLIENT_RECEIVABLE_SETTLEMENT_TYPES}
           ${clientPv.sql}`,
        clientPv.params,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS clients_with_debt
         FROM clients c
         WHERE c.is_active = TRUE
           ${clientPv.sql}
           AND (${clientTotalBalanceSql('c.id')}) > 0.005`,
        clientPv.params,
      ),
    ]);
    const totalCart = parseFloat(cartRes.rows[0]?.total_cart_balance_due || 0);
    const totalExt = parseFloat(extRes.rows[0]?.total_external_balance_due || 0);
    return {
      total_balance_due: totalCart + totalExt,
      total_cart_balance_due: totalCart,
      total_external_balance_due: totalExt,
      clients_with_debt: clientsCountRes.rows[0]?.clients_with_debt || 0,
    };
  }

  const params = [...clientPv.params];
  let clientFilter = 'WHERE c.is_active = TRUE';
  if (clientPv.sql) clientFilter += clientPv.sql;
  if (search) {
    params.push(`%${search}%`);
    clientFilter += ` AND (c.name ILIKE $${params.length} OR c.code ILIKE $${params.length} OR c.contact ILIKE $${params.length})`;
  }
  if (debt_only) {
    clientFilter += ` AND (${clientTotalBalanceSql('c.id')}) > 0.005`;
  }
  const { rows } = await pool.query(
    `WITH balances AS (
       SELECT c.id,
         ${clientCartBalanceSubquery('c.id')}::float AS cart_balance_due,
         ${clientExternalBalanceSubquery('c.id')}::float AS external_balance_due
       FROM clients c
       ${clientFilter}
     )
     SELECT
       COALESCE(SUM(cart_balance_due + external_balance_due), 0)::float AS total_balance_due,
       COALESCE(SUM(cart_balance_due), 0)::float AS total_cart_balance_due,
       COALESCE(SUM(external_balance_due), 0)::float AS total_external_balance_due,
       COUNT(*) FILTER (WHERE cart_balance_due + external_balance_due > 0.005)::int AS clients_with_debt
     FROM balances`,
    params,
  );
  return rows[0] || {
    total_balance_due: 0,
    total_cart_balance_due: 0,
    total_external_balance_due: 0,
    clients_with_debt: 0,
  };
}

export async function getSettlementCreancesSummary(filters = {}) {
  const legacySeller = typeof filters === 'number' ? filters : null;
  const opts = legacySeller != null ? { seller_id: legacySeller } : (filters || {});

  const params = [];
  let i = 1;
  let q = `SELECT COALESCE(SUM(s.balance), 0)::float AS total, COUNT(*)::int AS nb
           FROM settlements s
           LEFT JOIN sales_carts sc ON sc.id = s.reference_id
           LEFT JOIN clients c ON c.id = s.client_id
           WHERE s.settlement_type = 'creance_commerciale'
             AND s.status = 'en_cours' AND s.balance > 0.005`;

  const sellerId = parseOptionalInt(opts.seller_id);
  if (sellerId != null) {
    q += ` AND sc.seller_id = $${i++}`;
    params.push(sellerId);
  }

  const deliveryPointId = parseOptionalInt(opts.delivery_point_id);
  if (deliveryPointId != null) {
    q += ` AND (sc.delivery_point_id = $${i} OR c.delivery_point_id = $${i})`;
    params.push(deliveryPointId);
    i += 1;
  } else if (opts.user) {
    const pv = pvSettlementSqlClause(opts.user, {}, i, opts.requestedPvId ?? opts.delivery_point_id);
    q += pv.sql;
    params.push(...pv.params);
  }

  const { rows } = await pool.query(q, params);
  return rows[0] || { total: 0, nb: 0 };
}


export async function listCarts(filters = {}) {
  let query = `
    SELECT sc.*, c.name AS client_name, c.delivery_point_id AS client_delivery_point_id, e.name AS seller_name,
           (SELECT COUNT(*)::int FROM sale_lines sl WHERE sl.cart_id = sc.id) AS line_count,
           (${CART_BALANCE_DUE_SQL}) AS balance_due
    FROM sales_carts sc
    LEFT JOIN clients c ON c.id = sc.client_id
    LEFT JOIN employees e ON e.id = sc.seller_id`;
  const params = [];
  ({ query } = appendCartListFilters(query, filters, params, 1));

  query += ' ORDER BY COALESCE(sc.validated_at, sc.created_at) DESC';
  // Inventaire : tous les paniers filtrés (tableau scrollable côté UI).
  // Règlement : plafond haut. Autres appels : garde-fou 500.
  if (filters.inventaire !== 'true') {
    const listLimit = filters.reglement === 'true' ? 5000 : 500;
    query += ` LIMIT ${listLimit}`;
  }
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getInventaireCartSummary(filters = {}) {
  return getCartListSummary(filters);
}

export async function getCartListSummary(filters = {}) {
  let query = `
    SELECT
      COUNT(*)::int AS cart_count,
      COUNT(*) FILTER (WHERE (${CART_BALANCE_DUE_SQL}) > 0.005)::int AS unpaid_cart_count,
      COALESCE(SUM((SELECT COUNT(*)::int FROM sale_lines sl2 WHERE sl2.cart_id = sc.id)), 0)::int AS line_count,
      COALESCE(SUM(sc.total_amount), 0)::float AS total_amount,
      COALESCE(SUM(sc.amount_paid), 0)::float AS amount_paid,
      COALESCE(SUM((${CART_BALANCE_DUE_SQL})), 0)::float AS balance_due
    FROM sales_carts sc
    LEFT JOIN clients c ON c.id = sc.client_id`;
  const params = [];
  ({ query } = appendCartListFilters(query, filters, params, 1));
  const { rows } = await pool.query(query, params);
  return rows[0] || {
    cart_count: 0,
    unpaid_cart_count: 0,
    line_count: 0,
    total_amount: 0,
    amount_paid: 0,
    balance_due: 0,
  };
}

export async function listSalesByProduct(filters = {}) {
  let query = `
    SELECT sl.*,
           ${SALE_LINE_PRODUCT_NAME_SQL} AS product_name,
           ${SALE_LINE_PRODUCT_REFERENCE_SQL} AS reference,
           sc.cart_number, sc.sale_type, sc.validated_at, sc.created_at AS cart_date,
           c.name AS client_name
    FROM sale_lines sl
    JOIN sales_carts sc ON sc.id = sl.cart_id
    JOIN products p ON p.id = sl.product_id
    LEFT JOIN clients c ON c.id = sc.client_id`;
  const params = [];
  ({ query } = appendSalesByProductFilters(query, filters, params, 1));

  query += ' ORDER BY COALESCE(sc.validated_at, sc.created_at) DESC';
  // Inventaire : toutes les lignes filtrées (tableau scrollable côté UI).
  if (filters.inventaire !== 'true') {
    query += ' LIMIT 1000';
  }
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function listSalesByProductPaginated(filters = {}) {
  let baseFrom = `
    FROM sale_lines sl
    JOIN sales_carts sc ON sc.id = sl.cart_id
    JOIN products p ON p.id = sl.product_id
    LEFT JOIN clients c ON c.id = sc.client_id`;
  let selectQuery = `
    SELECT sl.*,
           ${SALE_LINE_PRODUCT_NAME_SQL} AS product_name,
           ${SALE_LINE_PRODUCT_REFERENCE_SQL} AS reference,
           sc.cart_number, sc.sale_type, sc.validated_at, sc.created_at AS cart_date,
           c.name AS client_name
    ${baseFrom}`;
  const params = [];
  ({ query: selectQuery } = appendSalesByProductFilters(selectQuery, filters, params, 1));

  const pagination = parseListPagination(filters);
  if (!pagination) {
    return { items: await listSalesByProduct(filters) };
  }

  let countQuery = `SELECT COUNT(*)::int AS total ${baseFrom}`;
  const countParams = [];
  ({ query: countQuery } = appendSalesByProductFilters(countQuery, filters, countParams, 1));

  const [{ rows: countRows }, { rows }] = await Promise.all([
    pool.query(countQuery, countParams),
    pool.query(
      `${selectQuery} ORDER BY COALESCE(sc.validated_at, sc.created_at) DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pagination.limit, pagination.offset]
    ),
  ]);
  return {
    items: rows,
    total: countRows[0]?.total || 0,
    page: pagination.page,
    limit: pagination.limit,
  };
}

export async function getInventaireProductSummary(filters = {}) {
  let query = `
    SELECT
      COUNT(*)::int AS line_count,
      COUNT(DISTINCT sl.product_id)::int AS product_count,
      COALESCE(SUM(sl.quantity), 0)::float AS quantity,
      COALESCE(SUM(sl.line_total), 0)::float AS line_total
    FROM sale_lines sl
    JOIN sales_carts sc ON sc.id = sl.cart_id
    JOIN products p ON p.id = sl.product_id
    LEFT JOIN clients c ON c.id = sc.client_id`;
  const params = [];
  ({ query } = appendSalesByProductFilters(query, filters, params, 1));
  const { rows } = await pool.query(query, params);
  return rows[0] || { line_count: 0, product_count: 0, quantity: 0, line_total: 0 };
}

export async function listInventaireByProductGrouped(filters = {}) {
  let query = `
    SELECT sl.product_id,
           MAX(${SALE_LINE_PRODUCT_NAME_SQL}) AS product_name,
           MAX(${SALE_LINE_PRODUCT_REFERENCE_SQL}) AS reference,
           COALESCE(SUM(sl.quantity), 0)::float AS quantity,
           COALESCE(SUM(sl.line_total), 0)::float AS line_total,
           COUNT(DISTINCT sl.cart_id)::int AS sales_count
    FROM sale_lines sl
    JOIN sales_carts sc ON sc.id = sl.cart_id
    JOIN products p ON p.id = sl.product_id
    LEFT JOIN clients c ON c.id = sc.client_id`;
  const params = [];
  ({ query } = appendSalesByProductFilters(query, filters, params, 1));
  query += `
    GROUP BY sl.product_id
    ORDER BY line_total DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getProductStockAtPv(productId, deliveryPointId) {
  const quantity = await getStock(productId, deliveryPointId);
  return { quantity };
}

export async function getCartProductStock(cartId, productId, deliveryPointId) {
  return getCartProductStockInfo(cartId, productId, deliveryPointId);
}

export async function voidFinalizedSale(cartId, userId) {
  const { isInventoryLocked } = await import('../utils/inventoryLock.js');
  if (await isInventoryLocked()) {
    throw Object.assign(new Error('Inventaire physique en cours — les annulations sont suspendues'), { status: 423 });
  }

  const cart = await getCartById(cartId);
  if (!cart) {
    const err = new Error('Vente introuvable');
    err.status = 404;
    throw err;
  }
  if (cart.status !== 'finalise') {
    throw new Error('Seules les ventes validées peuvent être supprimées');
  }
  if (!cart.lines?.length) {
    throw new Error('Cette vente ne contient aucune ligne');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const line of cart.lines) {
      await restoreStockFromSale(
        line.product_id,
        cart.delivery_point_id,
        parseFloat(line.quantity),
        'sales_cart',
        cartId,
        userId,
        client
      );
    }

    const cashRes = await client.query(
      `SELECT id, amount, description FROM cash_transactions
       WHERE reference_type = 'sales_cart' AND reference_id = $1 AND transaction_type = 'recette'`,
      [cartId]
    );
    for (const tx of cashRes.rows) {
      const amt = parseFloat(tx.amount);
      if (amt <= 0.005) continue;
      await client.query(
        `INSERT INTO cash_transactions (cash_date, transaction_type, amount, description, reference_type, reference_id, created_by)
         VALUES (CURRENT_DATE, 'depense', $1, $2, 'sales_cart_void', $3, $4)`,
        [amt, `Annulation vente ${cart.cart_number} — ${tx.description || 'encaissement'}`, cartId, userId]
      );
    }

    await client.query(
      `UPDATE settlements SET status = 'annule', balance = 0, amount_paid = 0, updated_at = NOW()
       WHERE reference_id = $1 AND settlement_type = 'creance_commerciale'`,
      [cartId]
    );

    await client.query('DELETE FROM proforma_invoices WHERE cart_id = $1', [cartId]);

    await client.query(
      `UPDATE sales_carts SET status = 'annule', updated_at = NOW() WHERE id = $1`,
      [cartId]
    );

    await client.query('COMMIT');

    emitEvent(EVENTS.CART_UPDATED, { id: cartId, status: 'annule', cart_number: cart.cart_number });
    emitEvent(EVENTS.DASHBOARD_REFRESH, {});
    await logAudit(userId, 'void', 'sales_cart', cartId, {
      cart_number: cart.cart_number,
      total: parseFloat(cart.total_amount || 0),
      amount_paid: parseFloat(cart.amount_paid || 0),
    });

    return { message: `Vente ${cart.cart_number} supprimée`, cart_number: cart.cart_number };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function appendDailyPaymentDateFilter(dateColumnExpr, date, params, startIndex) {
  const day = saleCalendarDateExpr(dateColumnExpr);
  return {
    sql: ` AND ${day} = $${startIndex}::date`,
    params: [date],
    nextIndex: startIndex + 1,
  };
}

function appendPeriodPaymentDateFilter(dateColumnExpr, dateFrom, dateTo, startIndex) {
  const day = saleCalendarDateExpr(dateColumnExpr);
  const params = [];
  let i = startIndex;
  let sql = '';
  if (dateFrom) {
    sql += ` AND ${day} >= $${i++}::date`;
    params.push(dateFrom);
  }
  if (dateTo) {
    sql += ` AND ${day} <= $${i++}::date`;
    params.push(dateTo);
  }
  return { sql, params, nextIndex: i };
}

function monthDateBounds(monthStr) {
  const [y, m] = monthStr.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || m < 1 || m > 12) {
    throw Object.assign(new Error('Mois invalide (YYYY-MM)'), { status: 400 });
  }
  const date_from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const date_to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { date_from, date_to };
}

const DETTE_SETTLEMENT_TYPES = new Set(['dette_commerciale', 'dette_externe']);
const CREANCE_SETTLEMENT_TYPES = new Set(['creance_commerciale', 'creance_externe']);

function cartBalanceDueValue(cart) {
  if (cart?.balance_due != null) return parseFloat(cart.balance_due) || 0;
  return Math.max(0, parseFloat(cart?.total_amount || 0) - parseFloat(cart?.amount_paid || 0));
}

function appendDailyReportPvFilter(filters, { paymentAlias, cartAlias, clientAlias }, params, startIndex) {
  if (filters.user) {
    const pv = pvReceiptSqlClause(
      filters.user,
      { paymentAlias, cartAlias, clientAlias },
      startIndex,
      filters.delivery_point_id,
    );
    return { sql: pv.sql, params: pv.params, nextIndex: startIndex + pv.params.length };
  }
  const deliveryPointId = parseOptionalInt(filters.delivery_point_id);
  if (deliveryPointId != null) {
    const col = paymentAlias
      ? receiptEffectivePvSql({ paymentAlias, cartAlias, clientAlias })
      : `${cartAlias}.delivery_point_id`;
    return {
      sql: ` AND ${col} = $${startIndex}`,
      params: [deliveryPointId],
      nextIndex: startIndex + 1,
    };
  }
  return { sql: '', params: [], nextIndex: startIndex };
}

async function getPeriodEncaissements(dateFrom, dateTo, filters = {}) {
  const cartParams = [];
  let i = 1;
  const cartPv = appendDailyReportPvFilter(
    filters,
    { paymentAlias: 'cp', cartAlias: 'sc', clientAlias: 'c' },
    cartParams,
    i,
  );
  const cartPvSql = cartPv.sql;
  cartParams.push(...cartPv.params);
  i = cartPv.nextIndex;

  const cartDate = appendPeriodPaymentDateFilter('cp.created_at', dateFrom, dateTo, i);
  cartParams.push(...cartDate.params);

  const settlementParams = [];
  let si = 1;
  const settlementPv = pvSettlementSqlClause(
    filters.user,
    { clientAlias: 'c', cartAlias: 'sc' },
    si,
    filters.delivery_point_id,
  );
  const settlementPvSql = settlementPv.sql;
  settlementParams.push(...settlementPv.params);
  si += settlementPv.params.length;

  const settlementDate = appendPeriodPaymentDateFilter('sp.paid_at', dateFrom, dateTo, si);
  settlementParams.push(...settlementDate.params);

  const [cartPaymentsRes, settlementPaymentsRes] = await Promise.all([
    pool.query(
      `SELECT cp.id, cp.amount::float AS amount, cp.payment_mode::text AS payment_mode,
              cp.created_at, sc.cart_number, c.name AS client_name, 'vente'::text AS source
       FROM cart_payments cp
       INNER JOIN sales_carts sc ON sc.id = cp.cart_id AND sc.status != 'annule'
       LEFT JOIN clients c ON c.id = sc.client_id
       WHERE 1=1 ${cartDate.sql} ${cartPvSql}
       ORDER BY cp.created_at ASC
       LIMIT 300`,
      cartParams,
    ),
    pool.query(
      `SELECT sp.id, sp.amount::float AS amount, sp.payment_mode::text AS payment_mode,
              sp.paid_at AS created_at, s.settlement_number, s.settlement_type::text AS settlement_type,
              c.name AS client_name, 'reglement'::text AS source
       FROM settlement_payments sp
       JOIN settlements s ON s.id = sp.settlement_id AND s.status != 'annule'
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN sales_carts sc ON sc.id = s.reference_id
       WHERE 1=1 ${settlementDate.sql} ${settlementPvSql}
       ORDER BY sp.paid_at ASC
       LIMIT 300`,
      settlementParams,
    ),
  ]);

  const cartPayments = cartPaymentsRes.rows;
  const settlementPayments = settlementPaymentsRes.rows;
  const cartTotal = cartPayments.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
  const settlementTotal = settlementPayments.reduce((s, r) => s + parseFloat(r.amount || 0), 0);

  const modeMap = new Map();
  for (const row of [...cartPayments, ...settlementPayments]) {
    const mode = row.payment_mode || 'especes';
    const prev = modeMap.get(mode) || { payment_mode: mode, total_amount: 0, payment_count: 0 };
    prev.total_amount += parseFloat(row.amount || 0);
    prev.payment_count += 1;
    modeMap.set(mode, prev);
  }
  const paymentModes = [...modeMap.values()].sort((a, b) => b.total_amount - a.total_amount);

  return {
    cart_payments: cartPayments,
    settlement_payments: settlementPayments,
    payment_modes: paymentModes,
    summary: {
      cart_payment_count: cartPayments.length,
      settlement_payment_count: settlementPayments.length,
      cart_collected: cartTotal,
      settlement_collected: settlementTotal,
      total_collected: cartTotal + settlementTotal,
    },
  };
}

async function getDailyEncaissements(date, filters = {}) {
  return getPeriodEncaissements(date, date, filters);
}

async function getPeriodDebtsCreances(dateFrom, dateTo, filters = {}, carts = []) {
  await syncMissingSalesDebtSettlements();

  const params = [dateFrom, dateTo];
  const createdDay = saleCalendarDateExpr('s.created_at');
  let i = 3;
  let query = `
    SELECT s.id, s.settlement_number, s.settlement_type::text AS settlement_type,
           s.amount::float AS amount, s.amount_paid::float AS amount_paid,
           s.balance::float AS balance, s.created_at, s.due_date,
           c.name AS client_name, sc.cart_number AS sale_cart_number
    FROM settlements s
    LEFT JOIN clients c ON c.id = s.client_id
    LEFT JOIN sales_carts sc ON sc.id = s.reference_id
    WHERE s.status != 'annule'
      AND ${createdDay} >= $1::date AND ${createdDay} <= $2::date`;
  const pv = pvSettlementSqlClause(
    filters.user,
    { clientAlias: 'c', cartAlias: 'sc' },
    i,
    filters.delivery_point_id,
  );
  query += pv.sql;
  params.push(...pv.params);
  query += ' ORDER BY s.created_at ASC LIMIT 500';

  const { rows: created } = await pool.query(query, params);

  const salesCredits = carts
    .filter((c) => cartBalanceDueValue(c) > 0.005)
    .map((c) => ({
      cart_id: c.id,
      cart_number: c.cart_number,
      client_name: c.client_name,
      total_amount: parseFloat(c.total_amount || 0),
      amount_paid: parseFloat(c.amount_paid || 0),
      balance_due: cartBalanceDueValue(c),
      validated_at: c.validated_at || c.created_at,
      settlement_type: 'credit_vente',
    }));

  let dettesCreated = 0;
  let dettesAmount = 0;
  let creancesCreated = 0;
  let creancesAmount = 0;
  for (const s of created) {
    if (DETTE_SETTLEMENT_TYPES.has(s.settlement_type)) {
      dettesCreated += 1;
      dettesAmount += parseFloat(s.amount || 0);
    } else if (CREANCE_SETTLEMENT_TYPES.has(s.settlement_type)) {
      creancesCreated += 1;
      creancesAmount += parseFloat(s.amount || 0);
    }
  }

  const salesCreditAmount = salesCredits.reduce((sum, c) => sum + c.balance_due, 0);

  return {
    summary: {
      dettes_created_count: dettesCreated,
      dettes_created_amount: dettesAmount,
      creances_created_count: creancesCreated,
      creances_created_amount: creancesAmount,
      sales_credit_count: salesCredits.length,
      sales_credit_amount: salesCreditAmount,
    },
    created,
    sales_credits: salesCredits,
  };
}

/** Rapport ventes + encaissements + dettes/créances sur une période. */
export async function getPeriodSalesReport(filters = {}) {
  const date_from = filters.date_from || filters.date;
  const date_to = filters.date_to || filters.date;
  if (!date_from || !date_to) {
    throw Object.assign(new Error('Période requise (date_from / date_to)'), { status: 400 });
  }

  const periodFilters = {
    ...filters,
    date_from,
    date_to,
    inventaire: 'true',
    status: filters.status || 'finalise',
  };
  delete periodFilters.date;
  delete periodFilters.month;

  const typeQueryParts = (() => {
    let query = `
      SELECT
        COUNT(*) FILTER (WHERE sc.sale_type = 'detail')::int AS detail_count,
        COUNT(*) FILTER (WHERE sc.sale_type = 'gros')::int AS gros_count
      FROM sales_carts sc
      LEFT JOIN clients c ON c.id = sc.client_id`;
    const params = [];
    ({ query } = appendCartListFilters(query, periodFilters, params, 1));
    return { query, params };
  })();

  const productLimit = date_from === date_to ? 20 : 40;

  const [salesSummary, salesByTypeRes, carts, products, encaissements] = await Promise.all([
    getCartListSummary(periodFilters),
    pool.query(typeQueryParts.query, typeQueryParts.params),
    listCarts(periodFilters),
    listInventaireByProductGrouped(periodFilters).then((rows) => rows.slice(0, productLimit)),
    getPeriodEncaissements(date_from, date_to, filters),
  ]);

  const debts_creances = await getPeriodDebtsCreances(date_from, date_to, filters, carts);

  const byType = salesByTypeRes.rows[0] || { detail_count: 0, gros_count: 0 };

  return {
    date_from,
    date_to,
    date: date_from === date_to ? date_from : null,
    period: date_from === date_to ? 'day' : 'range',
    delivery_point_id: parseOptionalInt(filters.delivery_point_id),
    sales: {
      ...salesSummary,
      detail_count: byType.detail_count || 0,
      gros_count: byType.gros_count || 0,
    },
    carts,
    products,
    encaissements,
    debts_creances,
  };
}

export function getMonthDateBounds(monthStr) {
  return monthDateBounds(monthStr);
}

/** Rapport journalier ventes + encaissements pour une date (inventaire ventes). */
export async function getDailySalesReport(filters = {}) {
  const date = filters.date;
  if (!date) throw Object.assign(new Error('Date requise (YYYY-MM-DD)'), { status: 400 });
  return getPeriodSalesReport({ ...filters, date_from: date, date_to: date });
}

/** Rapport mensuel ventes + encaissements + dettes/créances. */
export async function getMonthlySalesReport(filters = {}) {
  const month = filters.month;
  if (!month) throw Object.assign(new Error('Mois requis (YYYY-MM)'), { status: 400 });
  const { date_from, date_to } = monthDateBounds(month);
  const report = await getPeriodSalesReport({ ...filters, date_from, date_to });
  return { ...report, month, period: 'month' };
}
