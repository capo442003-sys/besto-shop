import { normalizeRoles } from './roles';

export function canAccessAllPvs(user) {
  if (!user) return false;
  const roles = normalizeRoles(user.roles, user.role);
  return roles.includes('administrateur');
}

export function isZoneManager(user) {
  if (!user) return false;
  const roles = normalizeRoles(user.roles, user.role);
  return roles.includes('responsable_zone');
}

export function isPvScoped(user) {
  if (canAccessAllPvs(user)) return false;
  if (isZoneManager(user)) return (user.allowed_delivery_point_ids?.length || 0) > 0;
  if (!user?.delivery_point_id) return false;
  return true;
}

export function resolveDeliveryPointId(user, requestedId) {
  if (isPvScoped(user) && !isZoneManager(user)) return user.delivery_point_id ? String(user.delivery_point_id) : '';
  if (isZoneManager(user)) {
    const allowed = user.allowed_delivery_point_ids || [];
    const req = String(requestedId || '');
    if (req && allowed.map(String).includes(req)) return req;
    return requestedId === undefined || requestedId === null || requestedId === '' ? '' : '';
  }
  if (requestedId === undefined || requestedId === null || requestedId === '') return '';
  return String(requestedId);
}

export function pvDisplayLabel(user) {
  if (isZoneManager(user) && user.allowed_delivery_points?.length) {
    return user.allowed_delivery_points.map((p) => p.code).join(', ');
  }
  if (!user?.delivery_point_id) return '';
  const code = user.delivery_point_code || '';
  const name = user.delivery_point_name || '';
  return code && name ? `${code} — ${name}` : code || name || `PV #${user.delivery_point_id}`;
}

export function stockQueryParams(user, selectedPvId = '') {
  const delivery_point_id = resolveDeliveryPointId(user, selectedPvId);
  return delivery_point_id ? { delivery_point_id, at_pv_only: 'true' } : {};
}
