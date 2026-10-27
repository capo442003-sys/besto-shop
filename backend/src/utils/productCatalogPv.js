import pool from '../db/pool.js';

const INTENTIONAL_PV_NOTES = [
  'Affectation au point de vente',
  'Stock initial à la création',
];

export async function ensureProductHomePvColumn(db = pool) {
  await db.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS delivery_point_id INTEGER REFERENCES delivery_points(id)
  `).catch(() => {});
}

export async function getDeliveryPointIdByCode(code, db = pool) {
  const { rows } = await db.query(
    `SELECT id FROM delivery_points WHERE is_active = TRUE AND UPPER(code) = $1 LIMIT 1`,
    [String(code || '').toUpperCase()]
  );
  return rows[0]?.id ?? null;
}

/** Corrige le catalogue : tout au PV1 sauf produits volontairement créés sur un autre PV. */
export async function syncProductCatalogPvAssignments(db = pool) {
  await ensureProductHomePvColumn(db);
  const pv1Id = await getDeliveryPointIdByCode('PV1', db);
  if (!pv1Id) return { pv1Id: null, pv2Id: null };

  const pv2Id = await getDeliveryPointIdByCode('PV2', db);
  const intentionalNotes = INTENTIONAL_PV_NOTES;

  if (pv2Id) {
    await db.query(
      `UPDATE products p SET delivery_point_id = $1, updated_at = NOW()
       WHERE p.is_active = TRUE
         AND p.delivery_point_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM stock_movements sm
           WHERE sm.product_id = p.id AND sm.delivery_point_id = $2
             AND sm.notes = ANY($3::text[])
         )`,
      [pv1Id, pv2Id, intentionalNotes]
    );
    await db.query(
      `DELETE FROM stock_movements sm
       WHERE sm.delivery_point_id = $1
         AND sm.movement_type = 'affectation'
         AND sm.notes NOT IN ('Affectation au point de vente', 'Stock initial à la création')`,
      [pv2Id]
    );
    await db.query(
      `DELETE FROM product_stock ps
       WHERE ps.delivery_point_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM products p
           WHERE p.id = ps.product_id AND p.delivery_point_id = $1 AND p.is_active = TRUE
         )`,
      [pv2Id]
    );
  }

  await db.query(
    `UPDATE products SET delivery_point_id = $1, updated_at = NOW()
     WHERE is_active = TRUE AND delivery_point_id IS NULL`,
    [pv1Id]
  );

  return { pv1Id, pv2Id };
}
