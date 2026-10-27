import pool from '../db/pool.js';

export async function isInventoryLocked() {
  const { rows } = await pool.query('SELECT inventory_lock FROM store_settings LIMIT 1');
  return Boolean(rows[0]?.inventory_lock);
}
