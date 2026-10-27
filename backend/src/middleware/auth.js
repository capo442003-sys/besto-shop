import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { isAdmin, hasRole, getUserRoles, pickPrimaryRole } from '../utils/permissions.js';
import { canAccessAllPvs } from '../utils/pvScope.js';
import { loadUserEmployeeProfile, profileToAuthFields } from '../utils/userEmployee.js';

export async function hydrateUserPvScope(req, _res, next) {
  if (!req.user) return next();
  try {
    const roles = await getUserRoles(req.user.id);
    req.user.roles = roles;
    req.user.role = pickPrimaryRole(roles);
    if (canAccessAllPvs(req.user)) return next();
    const profile = await loadUserEmployeeProfile(req.user.id, req.user.employee_id, roles);
    Object.assign(req.user, profileToAuthFields(profile));
  } catch (err) {
    console.error('hydrateUserPvScope:', err.message);
  }
  return next();
}

export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentification requise' });
  }
  try {
    const token = header.slice(7);
    req.user = jwt.verify(token, config.jwt.secret);
    if (!req.user.roles) req.user.roles = [req.user.role];
    hydrateUserPvScope(req, res, next);
  } catch {
    return res.status(401).json({ message: 'Session expirée ou invalide' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Non authentifié' });
    if (isAdmin(req.user)) return next();
    const userRoles = req.user.roles || [req.user.role];
    if (!roles.some((r) => userRoles.includes(r))) {
      return res.status(403).json({ message: 'Accès refusé pour votre rôle' });
    }
    next();
  };
}

export function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) {
    return res.status(403).json({ message: 'Seul l\'administrateur peut effectuer cette action' });
  }
  next();
}
