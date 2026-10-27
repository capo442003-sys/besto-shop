import pool from '../db/pool.js';

const PRICE_FIELDS = ['purchase_price', 'wholesale_price', 'retail_price'];

export async function logProductPriceChanges(productId, before, after, userId) {
  for (const field of PRICE_FIELDS) {
    const oldV = parseFloat(before[field]);
    const newV = parseFloat(after[field]);
    if (!Number.isFinite(oldV) && !Number.isFinite(newV)) continue;
    if (Math.abs((oldV || 0) - (newV || 0)) < 0.005) continue;
    await pool.query(
      `INSERT INTO product_price_history (product_id, field_name, old_value, new_value, changed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [productId, field, oldV || 0, newV || 0, userId]
    );
  }
}
