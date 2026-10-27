import pool from '../db/pool.js';
import { isAdmin, hasRole } from './permissions.js';
import { logAudit } from '../middleware/audit.js';

/** Seul l'administrateur voit tous les points de vente */
export function canAccessAllPvs(user) {
  return isAdmin(user);
}

/** Tout utilisateur non-admin doit être isolé par PV (quel que soit le rôle) */
export function requiresPvIsolation(user) {
  return !canAccessAllPvs(user);
}

export function attachPvUserToFilters(user, filters = {}) {
  const next = { ...filters };
  if (requiresPvIsolation(user)) {
    next.user = user;
  }
  return next;
}

export function isZoneManager(user) {
  return hasRole(user, 'responsable_zone');
}

export function getAllowedPvIds(user) {
  if (isZoneManager(user)) {
    return (user.allowed_delivery_point_ids || []).map((id) => parseInt(id, 10)).filter((n) => !Number.isNaN(n));
  }
  if (user?.delivery_point_id) return [parseInt(user.delivery_point_id, 10)];
  return [];
}

function allowedPvIds(user) {
  return getAllowedPvIds(user);
}

/** Employé ou responsable de zone — accès limité à un ou plusieurs PV */
export function isPvScoped(user) {
  if (canAccessAllPvs(user)) return false;
  if (isZoneManager(user)) return allowedPvIds(user).length > 0;
  return Boolean(user?.delivery_point_id);
}

export function resolveDeliveryPointId(user, requestedId) {
  if (canAccessAllPvs(user)) {
    if (requestedId === undefined || requestedId === null || requestedId === '') return null;
    const n = parseInt(requestedId, 10);
    return Number.isNaN(n) ? null : n;
  }
  if (isZoneManager(user)) {
    const allowed = allowedPvIds(user);
    if (!allowed.length) return null;
    const n = parseInt(requestedId, 10);
    if (!Number.isNaN(n) && allowed.includes(n)) return n;
    return null;
  }
  if (user?.delivery_point_id) return parseInt(user.delivery_point_id, 10);
  return null;
}

export function applyPvScope(user, query = {}) {
  const q = { ...query };
  const pvId = resolveDeliveryPointId(user, q.delivery_point_id);
  if (pvId != null) {
    q.delivery_point_id = String(pvId);
  } else {
    delete q.delivery_point_id;
  }
  return q;
}

export async function logPvAccessDenied(user, details = {}) {
  if (!user?.id) return;
  await logAudit(user.id, 'pv_access_denied', 'delivery_point', details.entity_id || null, {
    path: details.path,
    entity_type: details.entity_type,
    entity_id: details.entity_id,
    entity_pv: details.entity_pv,
    user_pv: user.delivery_point_id,
    allowed_pvs: user.allowed_delivery_point_ids,
    message: details.message,
  });
}

function effectiveEntityPv(entity) {
  if (!entity) return null;
  const pv = entity.client_delivery_point_id
    ?? entity.payment_delivery_point_id
    ?? entity.delivery_point_id
    ?? entity.seller_delivery_point_id;
  return pv == null ? null : pv;
}

export function assertPvAccess(user, entity, auditContext = {}) {
  if (!entity || canAccessAllPvs(user)) return;
  const entityPv = effectiveEntityPv(entity);
  if (entityPv == null) {
    if (requiresPvIsolation(user)) {
      const err = new Error('Accès refusé — document sans point de vente');
      err.status = 403;
      throw err;
    }
    return;
  }

  let denied = false;
  if (isZoneManager(user)) {
    const allowed = allowedPvIds(user);
    denied = !allowed.includes(parseInt(entityPv, 10));
  } else if (user?.delivery_point_id) {
    denied = String(entityPv) !== String(user.delivery_point_id);
  } else if (!canAccessAllPvs(user)) {
    denied = true;
  }

  if (denied) {
    logPvAccessDenied(user, {
      entity_type: auditContext.entity_type || 'entity',
      entity_id: entity.id,
      entity_pv: entityPv,
      message: auditContext.message,
      path: auditContext.path,
    }).catch(() => {});
    const err = new Error('Accès refusé — ce document appartient à un autre point de vente');
    err.status = 403;
    throw err;
  }
}

/** Clause SQL AND pour filtrer les clients (ou entités) par PV */
export function pvClientSqlClause(user, alias = 'c', paramIndex = 1, requestedPvId = null) {
  const adminFilter = canAccessAllPvs(user) ? parseOptionalPv(requestedPvId) : null;
  if (adminFilter != null) {
    return { sql: ` AND ${alias}.delivery_point_id = $${paramIndex}`, params: [adminFilter] };
  }
  if (!isPvScoped(user)) {
    if (!canAccessAllPvs(user)) {
      return { sql: ' AND FALSE', params: [] };
    }
    return { sql: '', params: [] };
  }

  if (isZoneManager(user)) {
    const ids = allowedPvIds(user);
    if (!ids.length) return { sql: ' AND FALSE', params: [] };
    const filter = parseOptionalPv(requestedPvId);
    if (filter != null && ids.includes(filter)) {
      return { sql: ` AND ${alias}.delivery_point_id = $${paramIndex}`, params: [filter] };
    }
    return {
      sql: ` AND ${alias}.delivery_point_id = ANY($${paramIndex}::int[])`,
      params: [ids],
    };
  }

  return {
    sql: ` AND ${alias}.delivery_point_id IS NOT NULL AND ${alias}.delivery_point_id = $${paramIndex}`,
    params: [user.delivery_point_id],
  };
}

export function pvCartSqlClause(user, alias = 'sc', paramIndex = 1, requestedPvId = null) {
  return pvClientSqlClause(user, alias, paramIndex, requestedPvId);
}

/** Filtre règlements / dettes — PV effectif panier ou client */
export function pvSettlementSqlClause(
  user,
  { clientAlias = 'c', cartAlias = 'sc' } = {},
  paramIndex = 1,
  requestedPvId = null,
) {
  const pvCol = `CASE WHEN ${cartAlias}.id IS NOT NULL THEN ${cartAlias}.delivery_point_id ELSE ${clientAlias}.delivery_point_id END`;
  const adminFilter = canAccessAllPvs(user) ? parseOptionalPv(requestedPvId) : null;
  if (adminFilter != null) {
    return { sql: ` AND ${pvCol} = $${paramIndex}`, params: [adminFilter] };
  }
  if (!isPvScoped(user)) {
    if (!canAccessAllPvs(user)) {
      return { sql: ' AND FALSE', params: [] };
    }
    return { sql: '', params: [] };
  }

  if (isZoneManager(user)) {
    const ids = allowedPvIds(user);
    if (!ids.length) return { sql: ' AND FALSE', params: [] };
    const filter = parseOptionalPv(requestedPvId);
    if (filter != null && ids.includes(filter)) {
      return { sql: ` AND ${pvCol} = $${paramIndex}`, params: [filter] };
    }
    return {
      sql: ` AND ${pvCol} = ANY($${paramIndex}::int[])`,
      params: [ids],
    };
  }

  return {
    sql: ` AND ${pvCol} = $${paramIndex}`,
    params: [user.delivery_point_id],
  };
}

function pvCashMatchSql(column, paramIndex, mode) {
  if (mode === 'any') return `${column} = ANY($${paramIndex}::int[])`;
  return `${column} = $${paramIndex}`;
}

function pvCashAttributableSql(alias, paramIndex, mode) {
  const scPvCol = 'sc.delivery_point_id';
  const scPv = pvCashMatchSql(scPvCol, paramIndex, mode);
  const cPv = pvCashMatchSql('c.delivery_point_id', paramIndex, mode);
  return `(
    (${alias}.reference_type IN ('sales_cart', 'sales_cart_void') AND EXISTS (
      SELECT 1 FROM sales_carts sc
      WHERE sc.id = ${alias}.reference_id AND ${scPv}
    ))
    OR (${alias}.reference_type = 'purchase_order' AND EXISTS (
      SELECT 1 FROM purchase_orders po JOIN clients c ON c.id = po.client_id
      WHERE po.id = ${alias}.reference_id AND ${cPv}
    ))
  )`;
}

/** Filtre transactions caisse — PV-scoped users ne voient pas les écritures manuelles globales */
export function pvCashSqlClause(user, alias = 'ct', paramIndex = 1, requestedPvId = null) {
  const adminFilter = canAccessAllPvs(user) ? parseOptionalPv(requestedPvId) : null;
  if (adminFilter != null) {
    return {
      sql: ` AND ${pvCashAttributableSql(alias, paramIndex, 'single')}`,
      params: [adminFilter],
    };
  }
  if (!isPvScoped(user)) {
    if (!canAccessAllPvs(user)) {
      return { sql: ' AND FALSE', params: [] };
    }
    return { sql: '', params: [] };
  }

  if (isZoneManager(user)) {
    const ids = allowedPvIds(user);
    if (!ids.length) return { sql: ' AND FALSE', params: [] };
    const filter = parseOptionalPv(requestedPvId);
    if (filter != null && ids.includes(filter)) {
      return {
        sql: ` AND ${pvCashAttributableSql(alias, paramIndex, 'single')}`,
        params: [filter],
      };
    }
    return {
      sql: ` AND ${pvCashAttributableSql(alias, paramIndex, 'any')}`,
      params: [ids],
    };
  }

  return {
    sql: ` AND ${pvCashAttributableSql(alias, paramIndex, 'single')}`,
    params: [user.delivery_point_id],
  };
}

/** Filtre employés par PV (liste vendeurs dashboard, stats) */
export function pvEmployeeSqlClause(user, alias = 'e', paramIndex = 1, requestedPvId = null) {
  return pvClientSqlClause(user, alias, paramIndex, requestedPvId);
}

/** PV effectif d'un reçu / panier (client prime sur panier pour comptoir multi-PV) */
export function receiptEffectivePvSql({ paymentAlias = 'cp', cartAlias = 'sc', clientAlias = 'c' } = {}) {
  const parts = [];
  if (paymentAlias) parts.push(`${paymentAlias}.delivery_point_id`);
  if (clientAlias) parts.push(`${clientAlias}.delivery_point_id`);
  parts.push(`${cartAlias}.delivery_point_id`);
  return `COALESCE(${parts.join(', ')})`;
}

/** Reçus d'encaissement — PV effectif (paiement > client > panier) */
export function pvReceiptSqlClause(
  user,
  { paymentAlias = 'cp', cartAlias = 'sc', clientAlias = 'c' } = {},
  paramIndex = 1,
  requestedPvId = null,
) {
  const pvCol = receiptEffectivePvSql({ paymentAlias, cartAlias, clientAlias });
  const adminFilter = canAccessAllPvs(user) ? parseOptionalPv(requestedPvId) : null;
  if (adminFilter != null) {
    return { sql: ` AND ${pvCol} = $${paramIndex}`, params: [adminFilter] };
  }
  if (!isPvScoped(user)) {
    if (!canAccessAllPvs(user)) {
      return { sql: ' AND FALSE', params: [] };
    }
    return { sql: '', params: [] };
  }

  if (isZoneManager(user)) {
    const ids = allowedPvIds(user);
    if (!ids.length) return { sql: ' AND FALSE', params: [] };
    const filter = parseOptionalPv(requestedPvId);
    if (filter != null && ids.includes(filter)) {
      return { sql: ` AND ${pvCol} = $${paramIndex}`, params: [filter] };
    }
    return {
      sql: ` AND ${pvCol} = ANY($${paramIndex}::int[])`,
      params: [ids],
    };
  }

  return {
    sql: ` AND ${pvCol} IS NOT NULL AND ${pvCol} = $${paramIndex}`,
    params: [user.delivery_point_id],
  };
}

function parseOptionalPv(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

export async function loadClientForAccess(db, clientId) {
  const { rows } = await db.query(
    'SELECT id, code, name, delivery_point_id FROM clients WHERE id = $1',
    [clientId]
  );
  return rows[0] || null;
}

export async function assertClientPvAccess(user, clientOrId, db = pool, auditContext = {}) {
  let client = clientOrId;
  if (!clientOrId || typeof clientOrId !== 'object') {
    client = await loadClientForAccess(db, clientOrId);
  }
  if (!client) {
    const err = new Error('Client introuvable');
    err.status = 404;
    throw err;
  }
  assertPvAccess(user, client, { entity_type: 'client', ...auditContext });
  return client;
}

export async function assertEmployeePvAccess(user, employeeOrId, db = pool, auditContext = {}) {
  let employee = employeeOrId;
  if (!employeeOrId || typeof employeeOrId !== 'object') {
    const { rows } = await db.query(
      'SELECT id, name, delivery_point_id FROM employees WHERE id = $1',
      [employeeOrId]
    );
    employee = rows[0] || null;
  }
  if (!employee) {
    const err = new Error('Employé introuvable');
    err.status = 404;
    throw err;
  }
  assertPvAccess(user, employee, { entity_type: 'employee', ...auditContext });
  return employee;
}
