import pool from '../db/pool.js';
import { ensureAdminDgEmployee } from './dgEmployee.js';
import { loadUserDeliveryPointIds } from './userDeliveryPoints.js';
import { hasRole } from './permissions.js';

export async function loadUserEmployeeProfile(userId, employeeId, roles = []) {
  const linked = await ensureAdminDgEmployee(userId);
  if (linked) {
    return {
      employee_id: linked.id,
      employee_name: linked.name,
      employee_matricule: linked.matricule,
      delivery_point_id: linked.delivery_point_id || null,
      delivery_point_code: linked.delivery_point_code || null,
      delivery_point_name: linked.delivery_point_name || null,
      allowed_delivery_point_ids: [],
      allowed_delivery_points: [],
    };
  }

  let resolvedEmployeeId = employeeId;
  if (!resolvedEmployeeId) {
    const userRes = await pool.query(
      'SELECT employee_id FROM users WHERE id = $1',
      [userId]
    );
    resolvedEmployeeId = userRes.rows[0]?.employee_id || null;
  }

  if (!resolvedEmployeeId) {
    const zonePvs = hasRole(roles, 'responsable_zone')
      ? await loadUserDeliveryPointIds(userId, roles)
      : [];
    return {
      employee_id: null,
      employee_name: null,
      employee_matricule: null,
      delivery_point_id: null,
      delivery_point_code: null,
      delivery_point_name: null,
      allowed_delivery_point_ids: zonePvs.map((r) => r.delivery_point_id),
      allowed_delivery_points: zonePvs.map((r) => ({
        id: r.delivery_point_id,
        code: r.code,
        name: r.name,
      })),
    };
  }
  const { rows } = await pool.query(
    `SELECT e.id, e.name, e.matricule, e.delivery_point_id,
            dp.code AS delivery_point_code, dp.name AS delivery_point_name
     FROM employees e
     LEFT JOIN delivery_points dp ON dp.id = e.delivery_point_id
     WHERE e.id = $1 AND e.is_active = TRUE`,
    [resolvedEmployeeId]
  );
  if (!rows.length) {
    return {
      employee_id: null,
      employee_name: null,
      employee_matricule: null,
      delivery_point_id: null,
      delivery_point_code: null,
      delivery_point_name: null,
    };
  }
  return {
    employee_id: rows[0].id,
    employee_name: rows[0].name,
    employee_matricule: rows[0].matricule,
    delivery_point_id: rows[0].delivery_point_id || null,
    delivery_point_code: rows[0].delivery_point_code || null,
    delivery_point_name: rows[0].delivery_point_name || null,
    allowed_delivery_point_ids: hasRole(roles, 'responsable_zone')
      ? (await loadUserDeliveryPointIds(userId, roles)).map((r) => r.delivery_point_id)
      : [],
    allowed_delivery_points: hasRole(roles, 'responsable_zone')
      ? (await loadUserDeliveryPointIds(userId, roles)).map((r) => ({
        id: r.delivery_point_id,
        code: r.code,
        name: r.name,
      }))
      : [],
  };
}

export function profileToAuthFields(profile) {
  return {
    employee_id: profile.employee_id || null,
    employee_name: profile.employee_name || null,
    employee_matricule: profile.employee_matricule || null,
    delivery_point_id: profile.delivery_point_id || null,
    delivery_point_code: profile.delivery_point_code || null,
    delivery_point_name: profile.delivery_point_name || null,
    allowed_delivery_point_ids: profile.allowed_delivery_point_ids || [],
    allowed_delivery_points: profile.allowed_delivery_points || [],
  };
}