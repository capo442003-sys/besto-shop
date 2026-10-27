import pool from '../db/pool.js';

export async function logAudit(userId, action, entityType, entityId, details = {}) {
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, entityType, entityId, JSON.stringify(details)]
    );
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}
