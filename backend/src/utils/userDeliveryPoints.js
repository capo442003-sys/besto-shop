import pool from '../db/pool.js';
import { hasRole } from './permissions.js';

export async function loadUserDeliveryPointIds(userId, roles = []) {
  if (!hasRole(roles, 'responsable_zone')) return [];
  const { rows } = await pool.query(
    `SELECT udp.delivery_point_id, dp.code, dp.name
     FROM user_delivery_points udp
     JOIN delivery_points dp ON dp.id = udp.delivery_point_id
     WHERE udp.user_id = $1 AND dp.is_active = TRUE
     ORDER BY dp.code`,
    [userId]
  );
  return rows;
}

export async function setUserDeliveryPoints(userId, deliveryPointIds, client = pool) {
  const db = client.query ? client : pool;
  const unique = [...new Set((deliveryPointIds || []).map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n)))];
  await db.query('DELETE FROM user_delivery_points WHERE user_id = $1', [userId]);
  for (const pvId of unique) {
    await db.query(
      'INSERT INTO user_delivery_points (user_id, delivery_point_id) VALUES ($1, $2)',
      [userId, pvId]
    );
  }
  return unique;
}
