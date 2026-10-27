import pool from '../db/pool.js';

export const COMPTOIR_CODE = 'COMPTOIR';
export const COMPTOIR_NAME = 'Client Comptoir';

/** Client comptoir du point de vente — un par PV */
export async function ensureComptoirClient(deliveryPointId = null) {
  let pvId = parseInt(deliveryPointId, 10);
  if (Number.isNaN(pvId)) {
    const { rows: activePvs } = await pool.query(
      'SELECT id FROM delivery_points WHERE is_active = TRUE ORDER BY id LIMIT 1'
    );
    pvId = activePvs[0]?.id || null;
  }
  if (!pvId) throw new Error('Aucun point de vente actif pour créer le client comptoir');
  const existing = await pool.query(
    `SELECT * FROM clients
     WHERE code = $1 AND delivery_point_id = $2
     LIMIT 1`,
    [COMPTOIR_CODE, pvId]
  );
  if (existing.rows.length) return existing.rows[0];

  const { rows } = await pool.query(
    `INSERT INTO clients (name, code, client_type, delivery_point_id)
     VALUES ($1, $2, 'particulier', $3)
     RETURNING *`,
    [COMPTOIR_NAME, COMPTOIR_CODE, pvId]
  );
  return rows[0];
}

export async function ensureComptoirClientsForActivePvs() {
  const { rows } = await pool.query(
    'SELECT id FROM delivery_points WHERE is_active = TRUE ORDER BY id'
  );
  const clients = [];
  for (const pv of rows) {
    clients.push(await ensureComptoirClient(pv.id));
  }
  return clients;
}
