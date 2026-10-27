import { Router } from 'express';
import multer from 'multer';
import pool from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { generateProductReference, isPgUniqueViolation } from '../utils/codes.js';
import { emitEvent, EVENTS } from '../socket/index.js';
import { logAudit } from '../middleware/audit.js';
import {
  stockSqlForPv,
  posAvailableStockSql,
  setStock,
  addStock,
  getActiveDeliveryPoints,
  getStock,
} from '../utils/stockSync.js';
import { applyPvScope, resolveDeliveryPointId } from '../utils/pvScope.js';
import { computeWeightedPurchasePrice } from '../utils/purchasePrice.js';
import { isPlaceholderProductName } from '../utils/saleLineSql.js';
import { syncProductCatalogPvAssignments } from '../utils/productCatalogPv.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

let catalogSyncPromise = null;
async function ensureCatalogSynced() {
  catalogSyncPromise = syncProductCatalogPvAssignments().catch((err) => {
    console.warn('Sync catalogue PV:', err.message);
    return null;
  });
  await catalogSyncPromise;
  catalogSyncPromise = null;
}

function assertValidProductName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    const err = new Error('Le nom du produit est requis');
    err.status = 400;
    throw err;
  }
  if (isPlaceholderProductName(trimmed)) {
    const err = new Error(
      '« SOLDE » n\'est pas un nom d\'article. Saisissez le nom réel (ex. Jean slim Femme 38, Baskets 42).'
    );
    err.status = 400;
    throw err;
  }
  return trimmed;
}

async function syncSaleLineSnapshotsForProduct(dbClient, productId, name, reference, previousName) {
  await dbClient.query(
    `UPDATE sale_lines sl SET
       product_name_snapshot = $1,
       product_reference_snapshot = $2
     WHERE sl.product_id = $3
       AND (
         sl.product_name_snapshot IS NULL
         OR TRIM(sl.product_name_snapshot) = ''
         OR UPPER(TRIM(sl.product_name_snapshot)) IN ('SOLDE', 'SOLDE A PAYER', 'RESTE')
         OR sl.product_name_snapshot = $4
       )`,
    [name, reference, productId, previousName || '']
  );
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function resolveStockPvId(user, query = {}) {
  return resolveDeliveryPointId(user, query.delivery_point_id);
}

function stockSqlForRequest(user, query = {}) {
  return stockSqlForPv(resolveStockPvId(user, query));
}

/** Produit visible à un PV uniquement si explicitement rattaché (delivery_point_id). */
function pvProductListSqlClause(pvId, paramIndex, { inStockOnly = false } = {}) {
  if (pvId == null) return { sql: '', params: [] };
  const pvParam = `$${paramIndex}`;
  if (inStockOnly) {
    return {
      sql: ` AND p.delivery_point_id = ${pvParam}
        AND EXISTS (
          SELECT 1 FROM product_stock ps
          INNER JOIN delivery_points dp ON dp.id = ps.delivery_point_id AND dp.is_active = TRUE
          WHERE ps.product_id = p.id AND ps.delivery_point_id = ${pvParam} AND ps.quantity > 0
        )`,
      params: [pvId],
    };
  }
  return {
    sql: ` AND p.delivery_point_id = ${pvParam}`,
    params: [pvId],
  };
}

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  await ensureCatalogSynced();
  const scopedQuery = applyPvScope(req.user, req.query);
  const { search, page, limit } = scopedQuery;
  const stockSql = stockSqlForRequest(req.user, scopedQuery);
  const pvId = resolveStockPvId(req.user, scopedQuery);
  const atPvOnly = scopedQuery.at_pv_only === 'true'
    || scopedQuery.pos === 'true'
    || pvId != null;
  const inStockOnly = scopedQuery.in_stock === 'true' || scopedQuery.pos === 'true';
  const posStockSql = scopedQuery.pos === 'true' && pvId != null
    ? posAvailableStockSql(pvId)
    : null;
  const usePagination = scopedQuery.page != null && scopedQuery.page !== '';
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(200, Math.max(20, parseInt(limit, 10) || 100));
  const offset = (pageNum - 1) * pageSize;

  let q = `SELECT p.*, c.name AS category_name,
           ${stockSql} AS total_stock${posStockSql ? `,\n           ${posStockSql} AS pos_available` : ''},
           (p.retail_price - p.purchase_price) AS margin_detail
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = TRUE`;
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    q += ` AND (p.name ILIKE $${params.length} OR p.reference ILIKE $${params.length})`;
  }
  if (atPvOnly && pvId != null) {
    const pvClause = pvProductListSqlClause(pvId, params.length + 1, { inStockOnly });
    q += pvClause.sql;
    params.push(...pvClause.params);
  }
  q += ' ORDER BY p.name';

  if (!usePagination) {
    const summaryParams = search ? [`%${search}%`] : [];
    const summaryWhere = search
      ? ' AND (p.name ILIKE $1 OR p.reference ILIKE $1)'
      : '';
    const [listRes, summaryRes] = await Promise.all([
      pool.query(`${q} LIMIT 500`, params),
      pool.query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(SUM(${stockSql}), 0)::float AS total_stock
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.is_active = TRUE${summaryWhere}`,
        summaryParams
      ),
    ]);
    const summary = summaryRes.rows[0] || { count: 0, total_stock: 0 };
    return res.json({
      items: listRes.rows,
      summary,
      truncated: listRes.rows.length < (summary.count || 0),
    });
  }

  const countQ = `SELECT COUNT(*)::int AS total FROM products p
    LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = TRUE${
      search ? ' AND (p.name ILIKE $1 OR p.reference ILIKE $1)' : ''
    }`;
  params.push(pageSize, offset);
  q += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const [{ rows }, countRes] = await Promise.all([
    pool.query(q, params),
    pool.query(countQ, search ? [`%${search}%`] : []),
  ]);
  res.json({
    items: rows,
    total: countRes.rows[0]?.total ?? rows.length,
    page: pageNum,
    limit: pageSize,
  });
}));

router.get('/reorder-suggestions', asyncHandler(async (req, res) => {
  const scopedQuery = applyPvScope(req.user, req.query);
  const stockSql = stockSqlForRequest(req.user, scopedQuery);
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.reference, p.min_stock,
            ${stockSql} AS total_stock
     FROM products p WHERE p.is_active = TRUE ORDER BY p.name`
  );
  const low = rows
    .filter((r) => parseFloat(r.total_stock) <= parseFloat(r.min_stock))
    .map((r) => ({
      ...r,
      qty_suggested: Math.max(0, parseFloat(r.min_stock) - parseFloat(r.total_stock || 0)),
    }))
    .slice(0, 50);
  res.json(low);
}));

router.get('/:id/price-history', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT h.*, u.full_name AS changed_by_name
     FROM product_price_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.product_id = $1 ORDER BY h.created_at DESC LIMIT 50`,
    [req.params.id]
  );
  res.json(rows);
}));

router.get('/stock/overview', asyncHandler(async (req, res) => {
  await ensureCatalogSynced();
  const scopedQuery = applyPvScope(req.user, req.query);
  const { filter } = scopedQuery;
  const stockSql = stockSqlForRequest(req.user, scopedQuery);
  const pvId = resolveStockPvId(req.user, scopedQuery);
  const params = [];
  let q = `
    SELECT p.id, p.name, p.reference, p.min_stock,
           ${stockSql} AS total_stock,
           c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.is_active = TRUE`;
  if (pvId != null) {
    const pvClause = pvProductListSqlClause(pvId, params.length + 1);
    q += pvClause.sql;
    params.push(...pvClause.params);
  }
  const { rows } = await pool.query(q, params);
  let result = rows;
  if (filter === 'epuise') result = rows.filter((r) => parseFloat(r.total_stock) <= 0);
  if (filter === 'alerte') result = rows.filter((r) => parseFloat(r.total_stock) <= parseFloat(r.min_stock));
  res.json(result);
}));

router.get('/stock/by-pv', asyncHandler(async (req, res) => {
  const scopedQuery = applyPvScope(req.user, req.query);
  const pvId = resolveStockPvId(req.user, scopedQuery);
  const params = [];
  let pvFilter = '';
  if (pvId != null) {
    params.push(pvId);
    pvFilter = ` AND dp.id = $${params.length}`;
  }
  const { rows } = await pool.query(`
    SELECT dp.code, dp.name, p.id AS product_id, p.name AS product_name, p.reference,
           ps.quantity, p.min_stock,
           CASE WHEN ps.quantity <= p.min_stock THEN TRUE ELSE FALSE END AS alert
    FROM delivery_points dp
    CROSS JOIN products p
    LEFT JOIN product_stock ps ON ps.product_id = p.id AND ps.delivery_point_id = dp.id
    WHERE p.is_active = TRUE AND dp.is_active = TRUE${pvFilter}
    ORDER BY dp.code, p.name
  `, params);
  res.json(rows);
}));

router.post('/import', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Fichier Excel requis' });
  try {
    const { importProductsFromBuffer } = await import('../services/dataImportService.js');
    const result = await importProductsFromBuffer(req.file.buffer, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}));

router.post('/inventory/count', requireAdmin, asyncHandler(async (req, res) => {
  const { items, notes, delivery_point_id } = req.body;
  const pvId = resolveDeliveryPointId(req.user, delivery_point_id);
  if (!pvId) return res.status(400).json({ message: 'Point de vente requis' });
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ message: 'Liste de comptage requise' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const adjustments = [];
    for (const item of items) {
      const productId = parseInt(item.product_id, 10);
      const counted = parseFloat(item.counted_quantity);
      if (!productId || !Number.isFinite(counted) || counted < 0) continue;
      const before = await getStock(productId, pvId, client);
      if (Math.abs(before - counted) < 0.0001) continue;
      await setStock(productId, pvId, counted, {
        client,
        userId: req.user.id,
        movementType: 'ajustement',
        notes: notes || `Inventaire physique (était ${before})`,
      });
      adjustments.push({ product_id: productId, before, after: counted });
    }
    await client.query('COMMIT');
    await logAudit(req.user.id, 'inventory', 'products', null, { count: adjustments.length });
    res.json({ message: `${adjustments.length} produit(s) ajusté(s)`, adjustments });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: e.message });
  } finally {
    client.release();
  }
}));

router.get('/stock/history', asyncHandler(async (req, res) => {
  const scopedQuery = applyPvScope(req.user, req.query);
  const { product_id, movement_type, date_from, date_to } = scopedQuery;
  const pvId = resolveStockPvId(req.user, scopedQuery);
  const limit = Math.min(Math.max(parseInt(scopedQuery.limit, 10) || 100, 1), 1000);
  let q = `SELECT sm.*, p.name AS product_name, p.reference AS product_reference, dp.code AS pv_code
           FROM stock_movements sm
           JOIN products p ON p.id = sm.product_id
           LEFT JOIN delivery_points dp ON dp.id = sm.delivery_point_id
           WHERE 1=1`;
  const params = [];
  if (product_id) { params.push(product_id); q += ` AND sm.product_id = $${params.length}`; }
  if (pvId != null) { params.push(pvId); q += ` AND sm.delivery_point_id = $${params.length}`; }
  if (movement_type) {
    const types = String(movement_type).split(',').map((t) => t.trim()).filter(Boolean);
    if (types.length) {
      params.push(types);
      q += ` AND sm.movement_type = ANY($${params.length}::text[])`;
    }
  }
  if (date_from) { params.push(date_from); q += ` AND sm.created_at >= $${params.length}::date`; }
  if (date_to) { params.push(date_to); q += ` AND sm.created_at < ($${params.length}::date + INTERVAL '1 day')`; }
  q += ` ORDER BY sm.created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const {
    name, category_id, purchase_price, wholesale_price, retail_price, min_stock,
    initial_quantity, stock_by_pv,
  } = req.body;

  let productName;
  try {
    productName = assertValidProductName(name);
  } catch (e) {
    return res.status(e.status || 400).json({ message: e.message });
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reference = await generateProductReference(client);
      const pvs = await getActiveDeliveryPoints(client);
      const targetPvId = resolveDeliveryPointId(req.user, req.body.delivery_point_id)
        || pvs[0]?.id;
      const defaultQty = Math.max(0, parseFloat(initial_quantity) || 0);
      const { rows } = await client.query(
        `INSERT INTO products (name, reference, category_id, purchase_price, wholesale_price, retail_price, min_stock, delivery_point_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [productName, reference, category_id, purchase_price || 0, wholesale_price || 0, retail_price || 0, min_stock || 0, targetPvId || null]
      );
      const productId = rows[0].id;
      if (targetPvId) {
        await setStock(productId, targetPvId, defaultQty, {
          client,
          userId: req.user.id,
          movementType: 'affectation',
          notes: defaultQty > 0 ? 'Stock initial à la création' : 'Affectation au point de vente',
        });
      }
      await client.query('COMMIT');
      await logAudit(req.user.id, 'create', 'product', productId, {
        reference: rows[0].reference,
        name: rows[0].name,
      });
      emitEvent(EVENTS.PRODUCT_UPDATED, rows[0]);
      return res.status(201).json(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      if (isPgUniqueViolation(e) && attempt < 4) continue;
      return res.status(500).json({ message: e.message });
    } finally {
      client.release();
    }
  }
  return res.status(500).json({ message: 'Impossible de générer une référence produit unique' });
}));

router.put('/:id', async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const {
    name, category_id, purchase_price, wholesale_price, retail_price, min_stock,
    stock_quantity, initial_quantity, quantity, delivery_point_id,
  } = req.body;
  const stockQtyRaw = stock_quantity ?? initial_quantity ?? quantity;
  const hasStockUpdate = stockQtyRaw !== undefined && stockQtyRaw !== null && stockQtyRaw !== '';
  let productName;
  try {
    productName = assertValidProductName(name);
  } catch (e) {
    return res.status(e.status || 400).json({ message: e.message });
  }
  const before = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
  if (!before.rows.length) return res.status(404).json({ message: 'Produit introuvable' });
  const prev = before.rows[0];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE products SET name=$1, category_id=$2, purchase_price=$3, wholesale_price=$4, retail_price=$5, min_stock=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [
        productName,
        category_id,
        purchase_price,
        wholesale_price ?? prev.wholesale_price,
        retail_price ?? prev.retail_price,
        min_stock,
        productId,
      ]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Produit introuvable' });
    }
    if (productName !== prev.name || rows[0].reference !== prev.reference) {
      await syncSaleLineSnapshotsForProduct(
        client,
        productId,
        rows[0].name,
        rows[0].reference,
        prev.name
      );
    }
    if (hasStockUpdate) {
      const pvId = resolveDeliveryPointId(req.user, delivery_point_id);
      if (!pvId) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Point de vente requis pour modifier le stock' });
      }
      const newQty = Math.max(0, parseFloat(stockQtyRaw) || 0);
      const stockBefore = await getStock(productId, pvId, client);
      if (Math.abs(stockBefore - newQty) >= 0.0001) {
        await setStock(productId, pvId, newQty, {
          client,
          userId: req.user.id,
          movementType: 'ajustement',
          notes: `Modification fiche produit (était ${stockBefore})`,
        });
      }
    }
    await client.query('COMMIT');
    const { logProductPriceChanges } = await import('../utils/priceHistory.js');
    await logProductPriceChanges(productId, before.rows[0], rows[0], req.user.id);
    await logAudit(req.user.id, 'update', 'product', productId, {
      reference: rows[0].reference,
      name: rows[0].name,
    });
    emitEvent(EVENTS.PRODUCT_UPDATED, rows[0]);
    if (hasStockUpdate) emitEvent(EVENTS.STOCK_UPDATED, { productId });
    return res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: e.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const { rows } = await pool.query(
    'SELECT id, reference, name FROM products WHERE id = $1',
    [productId]
  );
  if (!rows.length) return res.status(404).json({ message: 'Produit introuvable' });
  await pool.query('UPDATE products SET is_active = FALSE WHERE id = $1', [productId]);
  await logAudit(req.user.id, 'delete', 'product', productId, {
    reference: rows[0].reference,
    name: rows[0].name,
    action_label: 'produit désactivé',
  });
  res.json({ message: 'Produit désactivé' });
}));

router.post('/:id/stock-restock', asyncHandler(async (req, res) => {
  const { quantity_add, notes, purchase_unit_price, delivery_point_id } = req.body;
  const addQty = parseFloat(quantity_add);
  if (!Number.isFinite(addQty) || addQty <= 0) {
    return res.status(400).json({ message: 'Quantité à ajouter (> 0) requis' });
  }
  const pvId = resolveDeliveryPointId(req.user, delivery_point_id);
  if (!pvId) return res.status(400).json({ message: 'Point de vente requis' });
  const incomingPrice = purchase_unit_price != null && purchase_unit_price !== ''
    ? parseFloat(purchase_unit_price)
    : null;
  if (incomingPrice != null && (!Number.isFinite(incomingPrice) || incomingPrice < 0)) {
    return res.status(400).json({ message: 'Prix d\'achat unitaire invalide' });
  }

  const productId = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: prodRows } = await client.query(
      'SELECT id, purchase_price FROM products WHERE id = $1 AND is_active = TRUE',
      [productId]
    );
    if (!prodRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Produit introuvable' });
    }

    const qtyBefore = await getStock(productId, pvId, client);
    const oldPrice = parseFloat(prodRows[0].purchase_price) || 0;
    const deliveryPrice = incomingPrice != null ? incomingPrice : oldPrice;
    const newPrice = computeWeightedPurchasePrice(qtyBefore, oldPrice, addQty, deliveryPrice);

    const result = await addStock(productId, pvId, addQty, {
      client,
      userId: req.user.id,
      notes: notes || 'Ravitaillement',
      purchaseUnitPrice: deliveryPrice,
    });

    let priceUpdated = false;
    if (Math.abs(newPrice - oldPrice) >= 0.005) {
      const { rows: updated } = await client.query(
        `UPDATE products SET purchase_price = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [newPrice, productId]
      );
      priceUpdated = true;
      const { logProductPriceChanges } = await import('../utils/priceHistory.js');
      await logProductPriceChanges(productId, prodRows[0], updated[0], req.user.id);
      emitEvent(EVENTS.PRODUCT_UPDATED, updated[0]);
    }

    await client.query('COMMIT');
    await logAudit(req.user.id, 'restock', 'product', productId, {
      addQty,
      quantity: result.quantity,
      purchase_unit_price: deliveryPrice,
      purchase_price_avg: newPrice,
    });
    emitEvent(EVENTS.STOCK_UPDATED, { productId });

    const priceMsg = priceUpdated
      ? ` — prix achat moyen : ${Math.round(oldPrice).toLocaleString('fr-FR')} → ${Math.round(newPrice).toLocaleString('fr-FR')} GNF`
      : '';

    res.json({
      added: addQty,
      quantity: result.quantity,
      purchase_unit_price: deliveryPrice,
      purchase_price: newPrice,
      purchase_price_updated: priceUpdated,
      message: `Stock : ${result.quantity_before} → ${result.quantity} (+${addQty})${priceMsg}`,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: e.message });
  } finally {
    client.release();
  }
}));

router.post('/:id/stock-adjust', asyncHandler(async (req, res) => {
  const { quantity, notes, delivery_point_id } = req.body;
  const productId = req.params.id;
  const qtyAfter = parseFloat(quantity);
  if (!Number.isFinite(qtyAfter) || qtyAfter < 0) {
    return res.status(400).json({ message: 'Quantité invalide' });
  }
  const pvId = resolveDeliveryPointId(req.user, delivery_point_id);
  if (!pvId) return res.status(400).json({ message: 'Point de vente requis' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await setStock(productId, pvId, qtyAfter, {
      client,
      userId: req.user.id,
      movementType: 'ajustement',
      notes: notes || 'Ajustement stock',
    });
    await client.query('COMMIT');
    emitEvent(EVENTS.STOCK_UPDATED, { productId });
    res.json({ quantity: result.quantity });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: e.message });
  } finally {
    client.release();
  }
}));

router.get('/:id/stock', asyncHandler(async (req, res) => {
  const scopedQuery = applyPvScope(req.user, req.query);
  const pvId = resolveStockPvId(req.user, scopedQuery);
  const params = [req.params.id];
  let pvFilter = '';
  if (pvId != null) {
    params.push(pvId);
    pvFilter = ` AND ps.delivery_point_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT ps.*, dp.code, dp.name FROM product_stock ps
     JOIN delivery_points dp ON dp.id = ps.delivery_point_id
     WHERE ps.product_id = $1${pvFilter}`,
    params
  );
  res.json(rows);
}));

export default router;
