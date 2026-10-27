import { deleteUser } from './userDelete.js';

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Supprime définitivement un employé et détache les enregistrements liés.
 * @param {import('pg').PoolClient} client
 * @param {number} employeeId
 * @param {{ actingUserId?: number }} options
 */
export async function deleteEmployee(client, employeeId, { actingUserId } = {}) {
  const { rows } = await client.query(
    'SELECT id, matricule, name, function FROM employees WHERE id = $1',
    [employeeId]
  );
  if (!rows.length) throw httpError('Employé introuvable', 404);
  if (rows[0].function === 'dg') {
    throw httpError('Le Directeur général (DG) ne peut pas être supprimé.');
  }

  const { rows: linkedUsers } = await client.query(
    'SELECT id FROM users WHERE employee_id = $1',
    [employeeId]
  );
  for (const user of linkedUsers) {
    if (actingUserId && user.id === actingUserId) {
      throw httpError('Impossible de supprimer la fiche liée à votre propre compte');
    }
    await deleteUser(client, user.id);
  }

  await client.query('DELETE FROM salary_payments WHERE employee_id = $1', [employeeId]);
  await client.query('DELETE FROM work_schedules WHERE employee_id = $1', [employeeId]);
  await client.query('UPDATE sales_carts SET seller_id = NULL WHERE seller_id = $1', [employeeId]);
  await client.query('DELETE FROM employees WHERE id = $1', [employeeId]);

  return rows[0];
}
