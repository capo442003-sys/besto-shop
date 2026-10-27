import pool from '../db/pool.js';
import { ACTIVE_CASH_TX_AND } from '../utils/cashTransactionSql.js';
import { pvCashSqlClause, pvReceiptSqlClause, pvSettlementSqlClause, requiresPvIsolation, resolveDeliveryPointId } from '../utils/pvScope.js';

function effectiveClosurePvId(user, requestedPvId) {
  if (user) {
    const resolved = resolveDeliveryPointId(user, requestedPvId);
    if (requiresPvIsolation(user)) return resolved;
    return resolved;
  }
  if (requestedPvId === undefined || requestedPvId === null || requestedPvId === '') return null;
  const n = parseInt(requestedPvId, 10);
  return Number.isNaN(n) ? null : n;
}

function closureRowFilter(pvId, paramIndex) {
  if (pvId == null) {
    return { sql: ' AND delivery_point_id IS NULL', params: [] };
  }
  return { sql: ` AND delivery_point_id = $${paramIndex}`, params: [pvId] };
}

async function manualCashTotals(date, user = null, requestedPvId = null) {
  if (user && requiresPvIsolation(user)) {
    return { recettes: 0, depenses: 0 };
  }
  const params = [date];
  let where = 'WHERE ct.cash_date = $1';
  if (user) {
    const pvFilter = pvCashSqlClause(user, 'ct', params.length + 1, requestedPvId);
    if (pvFilter.sql) {
      where += pvFilter.sql;
      params.push(...pvFilter.params);
    }
  }
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN ct.transaction_type='recette' AND ct.reference_type IS NULL THEN ct.amount ELSE 0 END),0) AS recettes,
       COALESCE(SUM(CASE WHEN ct.transaction_type='depense' AND ct.reference_type IS NULL THEN ct.amount ELSE 0 END),0) AS depenses
     FROM cash_transactions ct ${where}`,
    params
  );
  return {
    recettes: parseFloat(rows[0].recettes),
    depenses: parseFloat(rows[0].depenses),
  };
}

async function salesCollected(date, user = null, requestedPvId = null) {
  const params = [date];
  let pvSql = '';
  if (user) {
    const pvFilter = pvReceiptSqlClause(user, {}, params.length + 1, requestedPvId);
    pvSql = pvFilter.sql;
    params.push(...pvFilter.params);
  }
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(cp.amount), 0) AS total
     FROM cart_payments cp
     INNER JOIN sales_carts sc ON sc.id = cp.cart_id AND sc.status != 'annule'
     LEFT JOIN clients c ON c.id = sc.client_id
     WHERE DATE(cp.created_at) = $1::date${pvSql}`,
    params
  );
  return parseFloat(rows[0].total);
}

async function settlementCollected(date, user = null, requestedPvId = null) {
  const params = [date];
  let pvSql = '';
  if (user) {
    const pvFilter = pvSettlementSqlClause(user, { clientAlias: 'c', cartAlias: 'sc' }, params.length + 1, requestedPvId);
    pvSql = pvFilter.sql;
    params.push(...pvFilter.params);
  }
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(sp.amount), 0) AS total
     FROM settlement_payments sp
     JOIN settlements s ON s.id = sp.settlement_id
     LEFT JOIN clients c ON c.id = s.client_id
     LEFT JOIN sales_carts sc ON sc.id = s.reference_id
     WHERE DATE(sp.paid_at) = $1::date${pvSql}`,
    params
  ).catch(() => ({ rows: [{ total: 0 }] }));
  return parseFloat(rows[0]?.total || 0);
}

async function openingBalanceForDate(date, pvId = null) {
  const prev = new Date(`${date}T12:00:00`);
  prev.setDate(prev.getDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);
  const prevParams = [prevStr];
  const prevPv = closureRowFilter(pvId, 2);
  prevParams.push(...prevPv.params);
  const { rows } = await pool.query(
    `SELECT counted_balance, closing_balance, closed_at
     FROM daily_cash WHERE cash_date = $1${prevPv.sql}`,
    prevParams
  );
  if (rows.length && rows[0].closed_at) {
    return parseFloat(rows[0].counted_balance ?? rows[0].closing_balance ?? 0);
  }
  const todayParams = [date];
  const todayPv = closureRowFilter(pvId, 2);
  todayParams.push(...todayPv.params);
  const today = await pool.query(
    `SELECT opening_balance FROM daily_cash WHERE cash_date = $1${todayPv.sql}`,
    todayParams
  );
  if (today.rows.length) return parseFloat(today.rows[0].opening_balance || 0);
  return 0;
}

async function fetchClosureRow(date, pvId) {
  const params = [date];
  const pv = closureRowFilter(pvId, 2);
  params.push(...pv.params);
  const { rows } = await pool.query(
    `SELECT * FROM daily_cash WHERE cash_date = $1${pv.sql}`,
    params
  );
  return rows[0] || null;
}

export async function buildCashDaySummary(date, user = null, requestedPvId = null) {
  const pvId = effectiveClosurePvId(user, requestedPvId);
  const [manual, sales, settlements, opening, closure] = await Promise.all([
    manualCashTotals(date, user, requestedPvId),
    salesCollected(date, user, requestedPvId),
    settlementCollected(date, user, requestedPvId),
    openingBalanceForDate(date, pvId),
    fetchClosureRow(date, pvId),
  ]);
  const expected =
    opening + sales + settlements + manual.recettes - manual.depenses;

  const isClosed = Boolean(closure?.closed_at);

  return {
    date,
    delivery_point_id: pvId,
    opening_balance: opening,
    sales_collected: sales,
    settlement_collected: settlements,
    manual_recettes: manual.recettes,
    manual_depenses: manual.depenses,
    expected_balance: expected,
    closure: closure
      ? {
          closed_at: closure.closed_at,
          closed_by: closure.closed_by,
          counted_balance: parseFloat(closure.counted_balance || 0),
          variance: parseFloat(closure.variance || 0),
          signature_name: closure.signature_name,
          notes: closure.notes,
        }
      : null,
    is_closed: isClosed,
  };
}

export async function closeCashDay({
  date,
  counted_balance,
  opening_balance,
  signature_name,
  notes,
  userId,
  user = null,
  delivery_point_id = null,
}) {
  const pvId = effectiveClosurePvId(user, delivery_point_id);
  const counted = parseFloat(counted_balance);
  if (!Number.isFinite(counted) || counted < 0) {
    throw Object.assign(new Error('Montant compté invalide'), { status: 400 });
  }

  const summary = await buildCashDaySummary(date, user, delivery_point_id);
  if (summary.is_closed) {
    throw Object.assign(new Error('Cette journée est déjà clôturée pour ce point de vente'), { status: 409 });
  }

  const opening =
    opening_balance != null && opening_balance !== ''
      ? parseFloat(opening_balance)
      : summary.opening_balance;
  const expected =
    opening
    + summary.sales_collected
    + summary.settlement_collected
    + summary.manual_recettes
    - summary.manual_depenses;
  const variance = counted - expected;

  const existing = await fetchClosureRow(date, pvId);
  let rows;
  if (existing) {
    ({ rows } = await pool.query(
      `UPDATE daily_cash SET
        opening_balance = $2, total_income = $3, total_expense = $4, closing_balance = $5,
        sales_collected = $6, settlement_collected = $7, expected_balance = $8,
        counted_balance = $9, variance = $10, signature_name = $11, notes = $12,
        closed_at = NOW(), closed_by = $13, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        existing.id,
        opening,
        summary.manual_recettes + summary.sales_collected + summary.settlement_collected,
        summary.manual_depenses,
        counted,
        summary.sales_collected,
        summary.settlement_collected,
        expected,
        counted,
        variance,
        signature_name || null,
        notes || null,
        userId,
      ]
    ));
  } else {
    ({ rows } = await pool.query(
      `INSERT INTO daily_cash (
        cash_date, delivery_point_id, opening_balance, total_income, total_expense, closing_balance,
        sales_collected, settlement_collected, expected_balance, counted_balance, variance,
        signature_name, notes, closed_at, closed_by, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),$14,NOW())
      RETURNING *`,
      [
        date,
        pvId,
        opening,
        summary.manual_recettes + summary.sales_collected + summary.settlement_collected,
        summary.manual_depenses,
        counted,
        summary.sales_collected,
        summary.settlement_collected,
        expected,
        counted,
        variance,
        signature_name || null,
        notes || null,
        userId,
      ]
    ));
  }

  return {
    record: rows[0],
    summary: await buildCashDaySummary(date, user, delivery_point_id),
    expected,
    variance,
  };
}

export async function reopenCashDay(date, userId, reason = '', user = null, delivery_point_id = null) {
  const pvId = effectiveClosurePvId(user, delivery_point_id);
  const params = [date];
  const pv = closureRowFilter(pvId, 2);
  params.push(...pv.params);
  const { rows } = await pool.query(
    `SELECT * FROM daily_cash WHERE cash_date = $1${pv.sql}`,
    params
  );
  if (!rows.length || !rows[0].closed_at) {
    throw Object.assign(new Error('Aucune clôture à rouvrir pour cette date'), { status: 404 });
  }
  const noteText = reason ? `\n[Réouverture] ${reason}` : '\n[Réouverture admin]';
  const reopenParams = [date, userId, noteText];
  let reopenWhere = 'WHERE cash_date = $1 AND delivery_point_id IS NULL';
  if (pvId != null) {
    reopenWhere = 'WHERE cash_date = $1 AND delivery_point_id = $4';
    reopenParams.push(pvId);
  }
  await pool.query(
    `UPDATE daily_cash SET
       closed_at = NULL, closed_by = NULL,
       reopened_at = NOW(), reopened_by = $2,
       notes = COALESCE(notes, '') || $3,
       updated_at = NOW()
     ${reopenWhere}`,
    reopenParams
  );
  return buildCashDaySummary(date, user, delivery_point_id);
}
