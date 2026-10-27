import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { generateClientCode } from '../utils/codes.js';
import { emitEvent, EVENTS } from '../socket/index.js';
import { logAudit } from '../middleware/audit.js';
import {
  syncMissingSalesDebtSettlements,
  getClientsReceivablesAggregate,
} from '../services/salesService.js';
import {
  CART_BALANCE_DUE_SQL,
  CLIENT_CART_BALANCE_WHERE,
  clientAdvanceBalanceSubquery,
  clientCartBalanceSubquery,
  clientExternalBalanceSubquery,
  clientTotalBalanceSql,
} from '../utils/cartBalanceSql.js';

const CLIENTS_LIST_LIMIT = 5000;
import { ensureComptoirClient } from '../utils/comptoirClient.js';
import {
  resolveDeliveryPointId,
  pvClientSqlClause,
  assertClientPvAccess,
} from '../utils/pvScope.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
router.use(authenticate);

router.get('/comptoir', asyncHandler(async (req, res) => {
  try {
    const pvId = resolveDeliveryPointId(req.user, req.query.delivery_point_id);
    if (!pvId) {
      return res.status(400).json({ message: 'Point de vente requis' });
    }
    const client = await ensureComptoirClient(pvId);
    res.json(client);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}));

router.get('/', asyncHandler(async (req, res) => {
  const { search, debt_only } = req.query;
  try {
    await syncMissingSalesDebtSettlements();
  } catch (err) {
    console.error('Sync créances (clients):', err.message);
  }

  const params = [];
  let where = 'WHERE c.is_active = TRUE';
  const deliveryPointId = resolveDeliveryPointId(req.user, req.query.delivery_point_id);
  const pvFilter = pvClientSqlClause(req.user, 'c', params.length + 1, deliveryPointId);
  if (pvFilter.sql) {
    where += pvFilter.sql;
    params.push(...pvFilter.params);
  }
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (c.name ILIKE $${params.length} OR c.code ILIKE $${params.length} OR c.contact ILIKE $${params.length})`;
  }
  if (debt_only === 'true') {
    where += ` AND (${clientTotalBalanceSql('c.id')}) > 0.005`;
  }

  const [listRes, summary] = await Promise.all([
    pool.query(
      `SELECT c.*,
        dp.code AS delivery_point_code,
        dp.name AS delivery_point_name,
        ${clientCartBalanceSubquery('c.id')}::float AS cart_balance_due,
        ${clientExternalBalanceSubquery('c.id')}::float AS external_balance_due,
        ${clientAdvanceBalanceSubquery('c.id')}::float AS advance_balance,
        ${clientTotalBalanceSql('c.id')}::float AS total_debt,
        loyalty.last_sale_at,
        COALESCE(loyalty.sale_count, 0)::int AS sale_count,
        COALESCE(loyalty.avg_cart_total, 0)::float AS avg_cart_total
       FROM clients c
       LEFT JOIN delivery_points dp ON dp.id = c.delivery_point_id
       LEFT JOIN LATERAL (
         SELECT MAX(sc.validated_at) AS last_sale_at,
                COUNT(*)::int AS sale_count,
                AVG(sc.total_amount)::float AS avg_cart_total
         FROM sales_carts sc
         WHERE sc.client_id = c.id AND sc.status = 'finalise'
       ) loyalty ON TRUE
       ${where}
       ORDER BY
         (CASE WHEN c.code = 'COMPTOIR' THEN 0 ELSE 1 END),
         ${clientTotalBalanceSql('c.id')} DESC,
         c.name
       LIMIT ${CLIENTS_LIST_LIMIT}`,
      params,
    ),
    getClientsReceivablesAggregate({
      search,
      debt_only: debt_only === 'true',
      delivery_point_id: deliveryPointId,
    }),
  ]);

  res.json({
    clients: listRes.rows,
    summary: {
      total_balance_due: parseFloat(summary.total_balance_due || 0),
      total_cart_balance_due: parseFloat(summary.total_cart_balance_due || 0),
      total_external_balance_due: parseFloat(summary.total_external_balance_due || 0),
      clients_with_debt: parseInt(summary.clients_with_debt || 0, 10),
    },
    list_meta: {
      limit: CLIENTS_LIST_LIMIT,
      returned: listRes.rows.length,
      truncated: listRes.rows.length >= CLIENTS_LIST_LIMIT,
    },
  });
}));

router.get('/review/misassigned', requireAdmin, asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.code, c.name, c.delivery_point_id,
            dp.code AS delivery_point_code, dp.name AS delivery_point_name,
            mode_pv.delivery_point_id AS suggested_delivery_point_id,
            mode_dp.code AS suggested_delivery_point_code,
            mode_dp.name AS suggested_delivery_point_name,
            mode_pv.cart_count
     FROM clients c
     LEFT JOIN delivery_points dp ON dp.id = c.delivery_point_id
     LEFT JOIN LATERAL (
       SELECT sc.delivery_point_id, COUNT(*)::int AS cart_count
       FROM sales_carts sc
       WHERE sc.client_id = c.id AND sc.delivery_point_id IS NOT NULL
       GROUP BY sc.delivery_point_id
       ORDER BY COUNT(*) DESC
       LIMIT 1
     ) mode_pv ON TRUE
     LEFT JOIN delivery_points mode_dp ON mode_dp.id = mode_pv.delivery_point_id
     WHERE c.is_active = TRUE
       AND c.code != 'COMPTOIR'
       AND (
         c.delivery_point_id IS NULL
         OR (mode_pv.delivery_point_id IS NOT NULL AND mode_pv.delivery_point_id != c.delivery_point_id)
       )
     ORDER BY c.name
     LIMIT 200`
  );
  res.json(rows);
}));

router.post('/:id/transfer-pv', requireAdmin, asyncHandler(async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const pvId = parseInt(req.body?.delivery_point_id, 10);
  if (Number.isNaN(pvId)) {
    return res.status(400).json({ message: 'Point de vente cible requis' });
  }
  const { rows: pvRows } = await pool.query(
    'SELECT id FROM delivery_points WHERE id = $1 AND is_active = TRUE',
    [pvId]
  );
  if (!pvRows.length) return res.status(400).json({ message: 'Point de vente invalide' });

  const { rows } = await pool.query(
    'SELECT id, code, name, delivery_point_id FROM clients WHERE id = $1',
    [clientId]
  );
  if (!rows.length) return res.status(404).json({ message: 'Client introuvable' });
  const before = rows[0];
  if (before.code === 'COMPTOIR') {
    return res.status(400).json({ message: 'Le client comptoir ne peut pas être transféré' });
  }

  const { rows: updated } = await pool.query(
    `UPDATE clients SET delivery_point_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [pvId, clientId]
  );
  await logAudit(req.user.id, 'transfer_pv', 'client', clientId, {
    code: before.code,
    name: before.name,
    from_pv: before.delivery_point_id,
    to_pv: pvId,
  });
  emitEvent(EVENTS.CLIENT_UPDATED, updated[0]);
  res.json(updated[0]);
}));

router.get('/:id/history', asyncHandler(async (req, res) => {
  const clientId = req.params.id;
  try {
    await assertClientPvAccess(req.user, clientId, pool);
  } catch (err) {
    return res.status(err.status || 403).json({ message: err.message });
  }
  try {
    await syncMissingSalesDebtSettlements();
  } catch (err) {
    console.error('Sync créances (historique client):', err.message);
  }

  const [carts, settlements, payments, cartTotals, paymentTotals, settlementTotals, receivableTotals] = await Promise.all([
    pool.query(
      `SELECT sc.id, sc.cart_number, sc.status, sc.total_amount, sc.amount_paid,
              (${CART_BALANCE_DUE_SQL}) AS balance_due,
              sc.created_at, sc.validated_at, e.name AS seller_name
       FROM sales_carts sc
       LEFT JOIN employees e ON e.id = sc.seller_id
       WHERE sc.client_id = $1 AND sc.status != 'annule'
       ORDER BY sc.created_at DESC LIMIT 80`,
      [clientId],
    ),
    pool.query(
      `SELECT * FROM settlements
       WHERE client_id = $1
         AND reference_id IS NULL
         AND status = 'en_cours'
         AND balance > 0.005
       ORDER BY created_at DESC`,
      [clientId],
    ),
    pool.query(
      `SELECT cp.id, cp.amount, cp.payment_mode, cp.created_at, sc.cart_number, sc.id AS cart_id
       FROM cart_payments cp
       JOIN sales_carts sc ON sc.id = cp.cart_id
       WHERE sc.client_id = $1
       ORDER BY cp.created_at DESC LIMIT 100`,
      [clientId],
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(sc.total_amount), 0)::float AS total_amount,
              COALESCE(SUM(sc.amount_paid), 0)::float AS amount_paid,
              COALESCE(SUM((${CART_BALANCE_DUE_SQL})), 0)::float AS balance_due,
              COUNT(*) FILTER (WHERE (${CART_BALANCE_DUE_SQL}) > 0.005)::int AS unpaid_count
       FROM sales_carts sc
       WHERE sc.client_id = $1
         AND ${CLIENT_CART_BALANCE_WHERE.replace(/\n\s*/g, ' ')}`,
      [clientId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(cp.amount), 0)::float AS total
       FROM cart_payments cp
       JOIN sales_carts sc ON sc.id = cp.cart_id
       WHERE sc.client_id = $1`,
      [clientId],
    ).catch(() => ({ rows: [{ count: 0, total: 0 }] })),
    pool.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(amount), 0)::float AS amount,
              COALESCE(SUM(amount_paid), 0)::float AS amount_paid,
              COALESCE(SUM(balance), 0)::float AS balance
       FROM settlements
       WHERE client_id = $1
         AND reference_id IS NULL
         AND status = 'en_cours'
         AND balance > 0.005`,
      [clientId],
    ),
    pool.query(
      `SELECT
         ${clientCartBalanceSubquery('$1')}::float AS cart_balance_due,
         ${clientExternalBalanceSubquery('$1')}::float AS external_balance_due,
         ${clientTotalBalanceSql('$1')}::float AS total_balance_due`,
      [clientId],
    ),
  ]);

  const receivable = receivableTotals.rows[0] || {};
  const cartBalance = parseFloat(receivable.cart_balance_due || 0);
  const externalBalance = parseFloat(receivable.external_balance_due || 0);
  const totalBalance = parseFloat(receivable.total_balance_due || 0);

  res.json({
    carts: carts.rows,
    settlements: settlements.rows,
    payments: payments.rows,
    summaries: {
      carts: cartTotals.rows[0],
      payments: paymentTotals.rows[0],
      settlements: settlementTotals.rows[0],
      receivable: {
        cart_balance_due: cartBalance,
        external_balance_due: externalBalance,
        total_balance_due: totalBalance,
      },
    },
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Client introuvable' });
  try {
    await assertClientPvAccess(req.user, rows[0], pool);
  } catch (err) {
    return res.status(err.status || 403).json({ message: err.message });
  }
  res.json(rows[0]);
}));

router.post('/', asyncHandler(async (req, res) => {
  try {
    const { name, contact, address, client_type, delivery_point_id } = req.body;
    if (!name) return res.status(400).json({ message: 'Nom requis' });
    const pvId = resolveDeliveryPointId(req.user, delivery_point_id);
    if (!pvId) {
      return res.status(400).json({ message: 'Point de vente requis pour créer un client' });
    }
    if (contact && !/^\d{9}$/.test(contact)) {
      return res.status(400).json({ message: 'Contact : 9 chiffres requis' });
    }
    const code = await generateClientCode(pool, client_type || 'particulier');
    const { rows } = await pool.query(
      `INSERT INTO clients (name, code, contact, address, client_type, delivery_point_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, code, contact || null, address || null, client_type || 'particulier', pvId]
    );
    emitEvent(EVENTS.CLIENT_UPDATED, rows[0]);
    await logAudit(req.user.id, 'create', 'client', rows[0].id, {
      code: rows[0].code,
      name: rows[0].name,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Un client avec ce code existe déjà. Réessayez.' });
    }
    res.status(500).json({ message: err.message });
  }
}));

router.put('/:id', async (req, res) => {
  const { name, contact, address, client_type } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Nom requis' });
  if (contact && !/^\d{9}$/.test(contact)) {
    return res.status(400).json({ message: 'Contact : 9 chiffres requis' });
  }
  const clientId = parseInt(req.params.id, 10);
  try {
    await assertClientPvAccess(req.user, clientId, pool);
  } catch (err) {
    return res.status(err.status || 403).json({ message: err.message });
  }
  const { rows } = await pool.query(
    `UPDATE clients SET name=$1, contact=$2, address=$3, client_type=$4, updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [name, contact, address, client_type, clientId]
  );
  if (!rows.length) return res.status(404).json({ message: 'Client introuvable' });
  await logAudit(req.user.id, 'update', 'client', clientId, {
    code: rows[0].code,
    name: rows[0].name,
  });
  emitEvent(EVENTS.CLIENT_UPDATED, rows[0]);
  res.json(rows[0]);
});

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { rows: clientRows } = await pool.query(
    'SELECT id, code, name FROM clients WHERE id = $1',
    [req.params.id]
  );
  await pool.query('UPDATE clients SET is_active = FALSE WHERE id = $1', [req.params.id]);
  const client = clientRows[0];
  await logAudit(req.user.id, 'delete', 'client', parseInt(req.params.id, 10), client ? {
    code: client.code,
    name: client.name,
  } : {});
  res.json({ message: 'Client désactivé' });
}));

export default router;
