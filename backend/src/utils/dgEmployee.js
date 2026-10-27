import pool from '../db/pool.js';
import { generateEmployeeMatricule } from './codes.js';
import { getUserRoles, isAdmin } from './permissions.js';

export const DG_UNIQUE_MESSAGE =
  'La fonction DG est unique et réservée au compte administrateur.';

/** Employé DG actif (un seul autorisé). */
export async function findActiveDgEmployee(db = pool, excludeId = null) {
  const params = [];
  let q = `SELECT id, name, matricule FROM employees
           WHERE function = 'dg' AND is_active = TRUE`;
  if (excludeId != null) {
    params.push(excludeId);
    q += ` AND id != $${params.length}`;
  }
  q += ' LIMIT 1';
  const { rows } = await db.query(q, params);
  return rows[0] || null;
}

/** Interdit d'attribuer DG via le formulaire employés (réservé à l'admin). */
export function assertManualDgNotAllowed(fn, currentFn = null) {
  if (fn !== 'dg') return;
  if (currentFn === 'dg') return;
  const err = new Error(DG_UNIQUE_MESSAGE);
  err.status = 400;
  throw err;
}

/** Interdit de retirer la fonction DG du compte administrateur. */
export async function assertDgNotRemoved(employeeId, newFn, db = pool) {
  if (newFn === 'dg') return;
  const { rows } = await db.query(
    `SELECT e.function, u.username
     FROM employees e
     JOIN users u ON u.employee_id = e.id AND u.is_active = TRUE
     JOIN user_roles ur ON ur.user_id = u.id AND ur.role = 'administrateur'
     WHERE e.id = $1 AND e.is_active = TRUE
     LIMIT 1`,
    [employeeId]
  );
  if (rows.length && rows[0].function === 'dg') {
    const err = new Error('Impossible de retirer la fonction DG du compte administrateur.');
    err.status = 400;
    throw err;
  }
}

/**
 * Garantit une seule fiche DG, liée au compte administrateur (login admin de préférence).
 */
export async function ensureAdminDgEmployee(userId) {
  const { rows } = await pool.query(
    `SELECT id, username, full_name, employee_id FROM users WHERE id = $1 AND is_active = TRUE`,
    [userId]
  );
  if (!rows.length) return null;
  const user = rows[0];
  const roles = await getUserRoles(userId);
  if (!isAdmin({ roles })) return null;

  const existingDg = await findActiveDgEmployee(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (existingDg) {
      await client.query(
        'UPDATE users SET employee_id = $1, updated_at = NOW() WHERE id = $2',
        [existingDg.id, userId]
      );
      await client.query(
        `UPDATE employees SET name = $1, function = 'dg', is_active = TRUE, updated_at = NOW() WHERE id = $2`,
        [(user.full_name || user.username || 'Administrateur').trim(), existingDg.id]
      );
      await client.query('COMMIT');
      return existingDg;
    }

    if (user.employee_id) {
      const { rows: emp } = await client.query(
        'SELECT id, name, matricule FROM employees WHERE id = $1',
        [user.employee_id]
      );
      if (emp.length) {
        await client.query(
          `UPDATE employees SET name = $1, function = 'dg', is_active = TRUE, updated_at = NOW() WHERE id = $2`,
          [(user.full_name || user.username || 'Administrateur').trim(), emp[0].id]
        );
        await client.query('COMMIT');
        return { ...emp[0], name: user.full_name || emp[0].name };
      }
    }

    const name = (user.full_name || user.username || 'Administrateur').trim();
    const matricule = await generateEmployeeMatricule(client, '');
    const { rows: ins } = await client.query(
      `INSERT INTO employees (name, matricule, function, hire_date)
       VALUES ($1, $2, 'dg', CURRENT_DATE) RETURNING id, name, matricule`,
      [name, matricule]
    );
    await client.query(
      'UPDATE users SET employee_id = $1, updated_at = NOW() WHERE id = $2',
      [ins[0].id, userId]
    );
    await client.query('COMMIT');
    return ins[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
