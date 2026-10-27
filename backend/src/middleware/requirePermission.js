import { getMergedPermissions, isAdmin, pickPrimaryRole } from '../utils/permissions.js';
import pool from '../db/pool.js';

const ACTION_KEYS = {
  view: 'can_view',
  create: 'can_create',
  edit: 'can_edit',
  delete: 'can_delete',
  print: 'can_print',
};

export async function loadUserPermissions(user) {
  if (!user?.id) return [];
  if (isAdmin(user)) return [{ module_code: 'all', can_view: true, can_create: true, can_edit: true, can_delete: true, can_print: true }];
  const roles = user.roles || [user.role];
  return getMergedPermissions(roles);
}

export function checkPermission(permissions, module, action = 'view') {
  const key = ACTION_KEYS[action] || ACTION_KEYS.view;
  const perm = permissions.find((p) => p.module_code === module || p.module_code === 'all');
  return Boolean(perm?.[key]);
}

export function requirePermission(module, action = 'view') {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (isAdmin(req.user)) return next();
    const perms = req.user.permissions || await loadUserPermissions(req.user);
    req.user.permissions = perms;
    if (checkPermission(perms, module, action)) return next();
    return res.status(403).json({ message: 'Action non autorisée pour votre rôle' });
  };
}

export function requireAnyPermission(module, actions = ['view']) {
  const list = Array.isArray(actions) ? actions : [actions];
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (isAdmin(req.user)) return next();
    const perms = req.user.permissions || await loadUserPermissions(req.user);
    req.user.permissions = perms;
    if (list.some((action) => checkPermission(perms, module, action))) return next();
    return res.status(403).json({ message: 'Action non autorisée pour votre rôle' });
  };
}

export async function attachPermissions(req, _res, next) {
  if (req.user && !req.user.permissions) {
    req.user.permissions = await loadUserPermissions(req.user);
  }
  next();
}
