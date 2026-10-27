import pool from '../db/pool.js';

export async function getActiveDeliveryPoints(client = pool) {
  const { rows } = await client.query(
    'SELECT id, code FROM delivery_points WHERE is_active = TRUE ORDER BY code'
  );
  return rows;
}

/** Stock à un point de vente donné */
export async function getStock(productId, deliveryPointId, client = pool) {
  if (!deliveryPointId) return 0;
  const { rows } = await client.query(
    `SELECT COALESCE(ps.quantity, 0) AS qty
     FROM product_stock ps
     JOIN delivery_points dp ON dp.id = ps.delivery_point_id AND dp.is_active = TRUE
     WHERE ps.product_id = $1 AND ps.delivery_point_id = $2`,
    [productId, deliveryPointId]
  );
  return parseFloat(rows[0]?.qty ?? 0);
}

export async function setStock(productId, deliveryPointId, newQty, {
  client = pool, userId, movementType, notes, purchaseUnitPrice,
} = {}) {
  if (!deliveryPointId) throw new Error('Point de vente requis pour le stock');

  const qty = Math.max(0, parseFloat(newQty));
  const qtyBefore = await getStock(productId, deliveryPointId, client);

  const stockRes = await client.query(
    'SELECT id FROM product_stock WHERE product_id = $1 AND delivery_point_id = $2',
    [productId, deliveryPointId]
  );
  if (stockRes.rows.length) {
    await client.query(
      'UPDATE product_stock SET quantity = $1, updated_at = NOW() WHERE id = $2',
      [qty, stockRes.rows[0].id]
    );
  } else {
    await client.query(
      'INSERT INTO product_stock (product_id, delivery_point_id, quantity) VALUES ($1, $2, $3)',
      [productId, deliveryPointId, qty]
    );
  }

  if (movementType) {
    const delta = qty - qtyBefore;
    const unitPrice = purchaseUnitPrice != null && Number.isFinite(parseFloat(purchaseUnitPrice))
      ? parseFloat(purchaseUnitPrice)
      : null;
    await client.query(
      `INSERT INTO stock_movements (product_id, delivery_point_id, movement_type, quantity, quantity_before, quantity_after, notes, user_id, purchase_unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [productId, deliveryPointId, movementType, delta, qtyBefore, qty, notes || movementType, userId, unitPrice]
    );
  }

  return { quantity: qty, quantity_before: qtyBefore };
}

export async function addStock(productId, deliveryPointId, addQty, options = {}) {
  const current = await getStock(productId, deliveryPointId, options.client);
  const newQty = current + parseFloat(addQty);
  return setStock(productId, deliveryPointId, newQty, {
    ...options,
    movementType: options.movementType || 'ravitaillement',
    notes: options.notes || 'Ravitaillement',
  });
}

/** SQL fragment — stock d'un PV ou somme (admin sans filtre) */
export function stockSqlForPv(deliveryPointId = null, productAlias = 'p') {
  if (deliveryPointId != null && deliveryPointId !== '') {
    const id = parseInt(deliveryPointId, 10);
    if (!Number.isNaN(id)) {
      return `COALESCE(
        (SELECT ps.quantity FROM product_stock ps
         INNER JOIN delivery_points dp ON dp.id = ps.delivery_point_id AND dp.is_active = TRUE
         WHERE ps.product_id = ${productAlias}.id AND ps.delivery_point_id = ${id}),
        0
      )`;
    }
  }
  return `COALESCE(
    (SELECT SUM(ps.quantity) FROM product_stock ps
     INNER JOIN delivery_points dp ON dp.id = ps.delivery_point_id AND dp.is_active = TRUE
     WHERE ps.product_id = ${productAlias}.id),
    0
  )`;
}

/** @deprecated Utiliser getStock(productId, deliveryPointId) */
export async function getUnifiedStock(productId, client = pool) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(ps.quantity), 0) AS qty
     FROM product_stock ps
     JOIN delivery_points dp ON dp.id = ps.delivery_point_id AND dp.is_active = TRUE
     WHERE ps.product_id = $1`,
    [productId]
  );
  return parseFloat(rows[0]?.qty ?? 0);
}

/** @deprecated Utiliser setStock — met à jour tous les PV actifs (legacy) */
export async function setUnifiedStock(productId, newQty, options = {}) {
  const pvs = await getActiveDeliveryPoints(options.client);
  if (!pvs.length) throw new Error('Aucun point de vente actif');
  const qtyBefore = await getUnifiedStock(productId, options.client);
  const qty = Math.max(0, parseFloat(newQty));
  for (const pv of pvs) {
    await setStock(productId, pv.id, qty, { ...options, movementType: null });
  }
  if (options.movementType) {
    const pvId = options.referencePvId || pvs[0].id;
    const delta = qty - qtyBefore;
    const unitPrice = options.purchaseUnitPrice != null && Number.isFinite(parseFloat(options.purchaseUnitPrice))
      ? parseFloat(options.purchaseUnitPrice)
      : null;
    await (options.client || pool).query(
      `INSERT INTO stock_movements (product_id, delivery_point_id, movement_type, quantity, quantity_before, quantity_after, notes, user_id, purchase_unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [productId, pvId, options.movementType, delta, qtyBefore, qty, options.notes || options.movementType, options.userId, unitPrice]
    );
  }
  return { quantity: qty, quantity_before: qtyBefore };
}

/** @deprecated Utiliser addStock */
export async function addUnifiedStock(productId, addQty, options = {}) {
  const pvs = await getActiveDeliveryPoints(options.client);
  if (!pvs.length) throw new Error('Aucun point de vente actif');
  return addStock(productId, options.referencePvId || pvs[0].id, addQty, options);
}

export const UNIFIED_STOCK_SQL = stockSqlForPv(null);

/** Paniers ouverts récents : réservation stock au même point de vente */
export const OPEN_CART_STALE_HOURS = Math.max(
  1,
  parseInt(process.env.OPEN_CART_STALE_HOURS || '1', 10) || 1,
);

/** Qté réservée dans les paniers ouverts actifs d'un PV (fragment SQL) */
export function sqlReservedInOpenCarts(productIdCol, deliveryPointId, staleHours = OPEN_CART_STALE_HOURS) {
  const pvId = parseInt(deliveryPointId, 10);
  if (!pvId) return '0';
  const hours = Math.max(1, parseInt(staleHours, 10) || OPEN_CART_STALE_HOURS);
  return `(SELECT COALESCE(SUM(sl.quantity), 0)::float
    FROM sale_lines sl
    JOIN sales_carts sc ON sc.id = sl.cart_id
    WHERE sl.product_id = ${productIdCol}
      AND sc.status = 'en_cours'
      AND sc.delivery_point_id = ${pvId}
      AND sc.updated_at >= NOW() - (${hours} || ' hours')::interval)`;
}

/** Stock caisse = stock magasin PV − réservations autres paniers ouverts */
export function posAvailableStockSql(deliveryPointId, productAlias = 'p') {
  const pvId = parseInt(deliveryPointId, 10);
  if (!pvId) return stockSqlForPv(null, productAlias);
  const stock = stockSqlForPv(pvId, productAlias);
  const reserved = sqlReservedInOpenCarts(`${productAlias}.id`, pvId);
  return `GREATEST(0, (${stock})::float - (${reserved})::float)`;
}
