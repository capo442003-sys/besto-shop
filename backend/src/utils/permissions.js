import pool from '../db/pool.js';

const ROLE_PRIORITY = [
  'administrateur',
  'gestionnaire',
  'responsable_zone',
  'comptable',
  'controleur',
  'vendeur',
  'caissier',
  'assistant',
];

export function pickPrimaryRole(roles = []) {
  if (!roles.length) return 'vendeur';
  for (const r of ROLE_PRIORITY) {
    if (roles.includes(r)) return r;
  }
  return roles[0];
}

export function hasRole(userOrRoles, role) {
  const roles = Array.isArray(userOrRoles) ? userOrRoles : userOrRoles?.roles || [userOrRoles?.role];
  return roles.includes(role);
}

export function isAdmin(userOrRoles) {
  return hasRole(userOrRoles, 'administrateur');
}

export async function getUserRoles(userId) {
  const { rows } = await pool.query(
    `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`,
    [userId]
  );
  if (rows.length) return rows.map((r) => r.role);
  const fallback = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
  return fallback.rows[0] ? [fallback.rows[0].role] : [];
}

export async function setUserRoles(userId, roles, client = pool) {
  const unique = [...new Set(roles)];
  if (!unique.length) throw new Error('Au moins un rôle est requis');
  const db = client.query ? client : pool;
  await db.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
  for (const role of unique) {
    await db.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [userId, role]);
  }
  const primary = pickPrimaryRole(unique);
  await db.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [primary, userId]);
  return { roles: unique, role: primary };
}

export async function getMergedPermissions(roles) {
  if (roles.includes('administrateur')) {
    return [{ module_code: 'all', can_view: true, can_create: true, can_edit: true, can_delete: true, can_print: true }];
  }
  const { rows } = await pool.query(
    `SELECT rp.module_code,
            BOOL_OR(rp.can_view) AS can_view,
            BOOL_OR(rp.can_create) AS can_create,
            BOOL_OR(rp.can_edit) AS can_edit,
            BOOL_OR(rp.can_delete) AS can_delete,
            BOOL_OR(rp.can_print) AS can_print
     FROM role_permissions rp
     JOIN roles r ON r.id = rp.role_id
     WHERE r.code = ANY($1::text[])
     GROUP BY rp.module_code`,
    [roles]
  );
  return rows;
}
