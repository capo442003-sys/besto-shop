import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAudit } from '../middleware/audit.js';
import { buildCashDaySummary, closeCashDay, reopenCashDay } from '../services/cashClosureService.js';
import { emitEvent, EVENTS } from '../socket/index.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { requireAdmin } from '../middleware/auth.js';
import { ACTIVE_CASH_TX_AND } from '../utils/cashTransactionSql.js';
import {
  isPvScoped,
  pvCashSqlClause,
  pvCartSqlClause,
  pvReceiptSqlClause,
  requiresPvIsolation,
  canAccessAllPvs,
  resolveDeliveryPointId,
} from '../utils/pvScope.js';

const router = Router();
router.use(authenticate);

function appendPvCashFilter(user, where, params, requestedPvId = null) {
  const pvFilter = pvCashSqlClause(user, 'ct', params.length + 1, requestedPvId);
  if (!pvFilter.sql) return where;
  params.push(...pvFilter.params);
  return where + pvFilter.sql;
}

function buildTransactionsFilter(query = {}, user = null) {
  const { date_from, date_to, type, scope } = query;
  let where = 'WHERE 1=1';
  const params = [];
  if (date_from) { params.push(date_from); where += ` AND ct.cash_date >= $${params.length}`; }
  if (date_to) { params.push(date_to); where += ` AND ct.cash_date <= $${params.length}`; }
  if (type) { params.push(type); where += ` AND ct.transaction_type = $${params.length}`; }
  if (scope === 'manuel') {
    where += ' AND ct.reference_type IS NULL';
    if (user && requiresPvIsolation(user)) {
      where += ' AND FALSE';
    }
  } else if (scope === 'ventes') {
    where += ` AND ct.reference_type IN ('sales_cart', 'sales_cart_void')`;
  } else if (scope === 'bc') {
    where += ` AND ct.reference_type = 'purchase_order'`;
  } else if (scope === 'actives') {
    where += ACTIVE_CASH_TX_AND;
  }
  if (user) {
    where = appendPvCashFilter(user, where, params, query.delivery_point_id);
  }
  return { where, params };
}

function summaryWhereFrom(query, where) {
  if (query.include_voided === 'true') return where;
  return `${where}${ACTIVE_CASH_TX_AND}`;
}

const TX_REFERENCE_NUMBER_SQL = `
  CASE ct.reference_type
    WHEN 'sales_cart' THEN (SELECT cart_number FROM sales_carts WHERE id = ct.reference_id)
    WHEN 'sales_cart_void' THEN (SELECT cart_number FROM sales_carts WHERE id = ct.reference_id)
    WHEN 'purchase_order' THEN (SELECT order_number FROM purchase_orders WHERE id = ct.reference_id)
    ELSE NULL
  END AS reference_number,
  CASE
    WHEN ct.reference_type IN ('sales_cart', 'sales_cart_void') THEN (
      SELECT status FROM sales_carts WHERE id = ct.reference_id
    )
    ELSE NULL
  END AS cart_status`;

const TX_FROM = 'FROM cash_transactions ct';

const TX_SELECT = `
  SELECT ct.*, ${TX_REFERENCE_NUMBER_SQL}
  ${TX_FROM}`;

const TX_SUMMARY_SELECT = `
  SELECT
    COUNT(*)::int AS count,
    COALESCE(SUM(CASE WHEN ct.transaction_type = 'recette' THEN ct.amount ELSE 0 END), 0)::float AS recettes,
    COALESCE(SUM(CASE WHEN ct.transaction_type = 'depense' THEN ct.amount ELSE 0 END), 0)::float AS depenses,
    COALESCE(SUM(CASE WHEN ct.transaction_type = 'recette' THEN ct.amount ELSE -ct.amount END), 0)::float AS net,
    COALESCE(SUM(CASE WHEN ct.transaction_type = 'recette' AND ct.reference_type IS NULL THEN ct.amount ELSE 0 END), 0)::float AS manual_recettes,
    COALESCE(SUM(CASE WHEN ct.transaction_type = 'depense' AND ct.reference_type IS NULL THEN ct.amount ELSE 0 END), 0)::float AS manual_depenses,
    COALESCE(SUM(CASE WHEN ct.transaction_type = 'recette' AND ct.reference_type = 'sales_cart' THEN ct.amount ELSE 0 END), 0)::float AS sales_collected,
    COALESCE(SUM(CASE WHEN ct.transaction_type = 'depense' AND ct.reference_type = 'sales_cart_void' THEN ct.amount ELSE 0 END), 0)::float AS sales_voided,
    COALESCE(SUM(CASE WHEN ct.transaction_type = 'recette' AND ct.reference_type = 'purchase_order' THEN ct.amount ELSE 0 END), 0)::float AS bc_collected
  ${TX_FROM}`;

router.get('/caisse', asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  let txWhere = 'WHERE ct.cash_date = $1';
  const txParams = [date];
  txWhere = appendPvCashFilter(req.user, txWhere, txParams, req.query.delivery_point_id);
  const [tx, summary] = await Promise.all([
    pool.query(
      `${TX_SELECT} ${txWhere} ORDER BY ct.created_at`,
      txParams
    ),
    buildCashDaySummary(date, req.user, req.query.delivery_point_id),
  ]);
  res.json({
    date,
    transactions: tx.rows,
    recettes: summary.manual_recettes,
    depenses: summary.manual_depenses,
    solde: summary.manual_recettes - summary.manual_depenses,
    closure_summary: summary,
  });
}));

router.post('/caisse/close', requirePermission('finances', 'edit'), asyncHandler(async (req, res) => {
  const date = req.body.cash_date || new Date().toISOString().slice(0, 10);
  const delivery_point_id = resolveDeliveryPointId(req.user, req.body.delivery_point_id ?? req.query.delivery_point_id);
  const result = await closeCashDay({
    date,
    counted_balance: req.body.counted_balance,
    opening_balance: req.body.opening_balance,
    signature_name: req.body.signature_name,
    notes: req.body.notes,
    userId: req.user.id,
    user: req.user,
    delivery_point_id,
  });
  await logAudit(req.user.id, 'close', 'cash_closure', result.record.id, {
    cash_date: date,
    expected: result.expected,
    counted: parseFloat(req.body.counted_balance),
    variance: result.variance,
    signature_name: req.body.signature_name,
  });
  emitEvent(EVENTS.CASH_CLOSED, { date });
  res.json({
    message: 'Clôture de caisse enregistrée',
    ...result,
  });
}));

router.post('/caisse/reopen', requireAdmin, asyncHandler(async (req, res) => {
  const date = req.body.cash_date || new Date().toISOString().slice(0, 10);
  const delivery_point_id = resolveDeliveryPointId(req.user, req.body.delivery_point_id ?? req.query.delivery_point_id);
  const summary = await reopenCashDay(date, req.user.id, req.body.reason, req.user, delivery_point_id);
  await logAudit(req.user.id, 'update', 'cash_closure', null, { cash_date: date, action: 'reopen' });
  emitEvent(EVENTS.CASH_CLOSED, { date, reopened: true });
  res.json({ message: 'Journée rouverte — opérations autorisées', closure_summary: summary });
}));

router.get('/caisse/closure-report', asyncHandler(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const summary = await buildCashDaySummary(date, req.user, req.query.delivery_point_id);
  let txWhere = 'WHERE ct.cash_date = $1';
  const txParams = [date];
  txWhere = appendPvCashFilter(req.user, txWhere, txParams, req.query.delivery_point_id);
  const { rows: tx } = await pool.query(
    `${TX_SELECT} ${txWhere} ORDER BY ct.created_at`,
    txParams
  );
  res.json({ date, summary, transactions: tx });
}));

router.get('/transactions', asyncHandler(async (req, res) => {
  const { where, params } = buildTransactionsFilter(req.query, req.user);
  const sumWhere = summaryWhereFrom(req.query, where);
  const [listRes, summaryRes] = await Promise.all([
    pool.query(`${TX_SELECT} ${where} ORDER BY ct.cash_date DESC, ct.created_at DESC LIMIT 500`, params),
    pool.query(`${TX_SUMMARY_SELECT} ${sumWhere}`, params),
  ]);
  const summary = summaryRes.rows[0] || {
    count: 0, recettes: 0, depenses: 0, net: 0,
    manual_recettes: 0, manual_depenses: 0, sales_collected: 0, sales_voided: 0, bc_collected: 0,
  };
  const recettes = parseFloat(summary.recettes || 0);
  const depenses = parseFloat(summary.depenses || 0);
  const net = parseFloat(summary.net ?? recettes - depenses);
  res.json({
    items: listRes.rows,
    summary: {
      count: summary.count || 0,
      recettes,
      depenses,
      net,
      manual_recettes: parseFloat(summary.manual_recettes || 0),
      manual_depenses: parseFloat(summary.manual_depenses || 0),
      sales_collected: parseFloat(summary.sales_collected || 0),
      sales_voided: parseFloat(summary.sales_voided || 0),
      bc_collected: parseFloat(summary.bc_collected || 0),
    },
    truncated: listRes.rows.length < (summary.count || 0),
  });
}));

router.delete('/transactions/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cash_transactions WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Transaction introuvable' });
  const tx = rows[0];
  await pool.query('DELETE FROM cash_transactions WHERE id = $1', [req.params.id]);
  await logAudit(req.user.id, 'delete', 'cash_transaction', tx.id, {
    transaction_type: tx.transaction_type,
    amount: tx.amount,
    cash_date: tx.cash_date,
    description: tx.description,
    reference_type: tx.reference_type,
    reference_id: tx.reference_id,
  });
  emitEvent(EVENTS.DASHBOARD_REFRESH);
  emitEvent(EVENTS.CASH_CLOSED, { date: tx.cash_date, transaction_deleted: true });
  res.json({ message: 'Transaction supprimée', deleted: tx });
}));

router.post('/transactions/purge', requireAdmin, asyncHandler(async (req, res) => {
  const filters = { ...req.query, ...req.body };
  const { where, params } = buildTransactionsFilter(filters, req.user);
  const countRes = await pool.query(`SELECT COUNT(*)::int AS count ${TX_FROM} ${where}`, params);
  const count = countRes.rows[0]?.count || 0;
  if (!count) {
    return res.json({ message: 'Aucune transaction à supprimer', deleted: 0 });
  }
  const delRes = await pool.query(
    `DELETE FROM cash_transactions WHERE id IN (SELECT ct.id ${TX_FROM} ${where}) RETURNING id, cash_date, transaction_type, amount`,
    params
  );
  await logAudit(req.user.id, 'delete', 'cash_transaction', null, {
    action: 'purge',
    deleted_count: delRes.rowCount,
    filters,
  });
  emitEvent(EVENTS.DASHBOARD_REFRESH);
  const dates = [...new Set(delRes.rows.map((r) => r.cash_date))];
  dates.forEach((d) => emitEvent(EVENTS.CASH_CLOSED, { date: d, transaction_deleted: true }));
  res.json({
    message: `${delRes.rowCount} transaction(s) supprimée(s)`,
    deleted: delRes.rowCount,
  });
}));

router.post('/transactions', asyncHandler(async (req, res) => {
  if (requiresPvIsolation(req.user)) {
    return res.status(403).json({ message: 'Les opérations manuelles de caisse sont réservées à l\'administration' });
  }
  const { cash_date, transaction_type, amount, description, category } = req.body;
  if (!transaction_type || amount == null) {
    return res.status(400).json({ message: 'Type et montant requis' });
  }
  const { rows } = await pool.query(
    `INSERT INTO cash_transactions (cash_date, transaction_type, amount, description, category, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [cash_date || new Date().toISOString().slice(0, 10), transaction_type, amount, description, category, req.user.id]
  );
  await logAudit(req.user.id, 'create', 'cash_transaction', rows[0].id, {
    transaction_type,
    amount,
    cash_date: rows[0].cash_date,
    description,
  });
  res.status(201).json(rows[0]);
}));

router.get('/charges', asyncHandler(async (req, res) => {
  if (requiresPvIsolation(req.user)) {
    return res.status(403).json({ message: 'Accès réservé à l\'administration — charges globales magasin' });
  }
  const [listRes, summaryRes] = await Promise.all([
    pool.query(
      `SELECT ch.*, ct.name AS charge_type_name FROM charges ch
       LEFT JOIN charge_types ct ON ct.id = ch.charge_type_id ORDER BY ch.charge_date DESC LIMIT 200`
    ),
    pool.query('SELECT COALESCE(SUM(amount), 0)::float AS total, COUNT(*)::int AS count FROM charges'),
  ]);
  const summary = summaryRes.rows[0] || { total: 0, count: 0 };
  res.json({
    items: listRes.rows,
    summary,
    truncated: listRes.rows.length < (summary.count || 0),
  });
}));

router.get('/charge-types', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM charge_types ORDER BY name');
  res.json(rows);
}));

router.post('/charges', asyncHandler(async (req, res) => {
  if (requiresPvIsolation(req.user)) {
    return res.status(403).json({ message: 'Accès réservé à l\'administration — charges globales magasin' });
  }
  const { charge_type_id, amount, charge_date, period_month, period_year, notes } = req.body;
  if (amount == null) return res.status(400).json({ message: 'Montant requis' });
  const { rows } = await pool.query(
    `INSERT INTO charges (charge_type_id, amount, charge_date, period_month, period_year, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [charge_type_id, amount, charge_date, period_month, period_year, notes, req.user.id]
  );
  await logAudit(req.user.id, 'create', 'charge', rows[0].id, { amount, charge_date });
  res.status(201).json(rows[0]);
}));

router.get('/bilan', asyncHandler(async (req, res) => {
  const { date_from, date_to } = req.query;
  const from = date_from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = date_to || new Date().toISOString().slice(0, 10);
  const requestedPv = req.query.delivery_point_id;

  const ventesParams = [from, to];
  const ventesPv = pvReceiptSqlClause(
    req.user,
    { paymentAlias: null, cartAlias: 'sc', clientAlias: 'c' },
    ventesParams.length + 1,
    requestedPv,
  );
  ventesParams.push(...ventesPv.params);

  let depensesSql = `SELECT COALESCE(SUM(amount),0) AS total FROM cash_transactions ct
       WHERE ct.transaction_type='depense' AND ct.reference_type IS NULL
         AND ct.cash_date BETWEEN $1 AND $2`;
  const depensesParams = [from, to];
  if (requiresPvIsolation(req.user)) {
    depensesSql = `SELECT 0 AS total`;
  }

  let chargesSql = `SELECT COALESCE(SUM(amount),0) AS total FROM charges WHERE charge_date BETWEEN $1 AND $2`;
  const chargesParams = [from, to];
  if (requiresPvIsolation(req.user)) {
    chargesSql = `SELECT 0 AS total`;
  }

  const [ventes, depenses, charges] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(total_amount),0) AS ca FROM sales_carts sc
       LEFT JOIN clients c ON c.id = sc.client_id
       WHERE sc.status='finalise' AND DATE(sc.validated_at) BETWEEN $1 AND $2${ventesPv.sql}`,
      ventesParams
    ),
    pool.query(depensesSql, depensesParams),
    pool.query(chargesSql, chargesParams),
  ]);
  const ca = parseFloat(ventes.rows[0].ca);
  const achatsEstimes = ca * 0.65;
  const dep = parseFloat(depenses.rows[0].total) + parseFloat(charges.rows[0].total);
  res.json({ periode: { from, to }, chiffre_affaires: ca, couts_achats_estimes: achatsEstimes, depenses: dep, benefice: ca - achatsEstimes - dep });
}));

export default router;
