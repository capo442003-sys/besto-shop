import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { isPvScoped, canAccessAllPvs, requiresPvIsolation, pvReceiptSqlClause, receiptEffectivePvSql } from '../utils/pvScope.js';
import { assertPvAccess } from '../utils/pvScope.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
router.use(authenticate);

function buildProformaPvFilter(user, requestedPv, params) {
  let pvSql = '';
  if (requiresPvIsolation(user)) {
    const cartClause = pvReceiptSqlClause(
      user,
      { paymentAlias: null, cartAlias: 'sc', clientAlias: 'c' },
      params.length + 1,
      requestedPv,
    );
    if (cartClause.sql) {
      pvSql = cartClause.sql;
      params.push(...cartClause.params);
    }
  } else if (canAccessAllPvs(user) && requestedPv) {
    const n = parseInt(requestedPv, 10);
    if (!Number.isNaN(n)) {
      params.push(n);
      const pvCol = receiptEffectivePvSql({ paymentAlias: null, cartAlias: 'sc', clientAlias: 'c' });
      pvSql = ` AND ${pvCol} = $${params.length}`;
    }
  }
  return pvSql;
}

router.get('/', asyncHandler(async (req, res) => {
  const params = [];
  const pvSql = buildProformaPvFilter(req.user, req.query.delivery_point_id, params);
  const usePagination = req.query.page != null && req.query.page !== '';
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(20, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const baseFrom = `
     FROM proforma_invoices pf
     JOIN sales_carts sc ON sc.id = pf.cart_id
     LEFT JOIN clients c ON c.id = COALESCE(pf.client_id, sc.client_id)
     LEFT JOIN delivery_points dp ON dp.id = sc.delivery_point_id
     WHERE 1=1${pvSql}`;

  const selectSql = `
    SELECT pf.*, c.name AS client_name, c.code AS client_code, sc.cart_number,
            sc.status AS cart_status, sc.delivery_point_id, dp.code AS delivery_point_code,
            sc.amount_paid,
            GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0)) AS balance_due
    ${baseFrom}
    ORDER BY pf.issued_at DESC`;

  if (!usePagination) {
    const { rows } = await pool.query(`${selectSql} LIMIT 500`, params);
    return res.json(rows);
  }

  const [{ rows }, countRes] = await Promise.all([
    pool.query(`${selectSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
    pool.query(`SELECT COUNT(*)::int AS total ${baseFrom}`, params),
  ]);
  res.json({
    items: rows,
    total: countRes.rows[0]?.total ?? rows.length,
    page,
    limit,
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const inv = await pool.query(
    `SELECT pf.*, s.store_name, s.address AS store_address, s.phone AS store_phone,
            s.phone_2 AS store_phone_2, s.phone_3 AS store_phone_3,
            s.logo_url AS store_logo_url, s.updated_at AS store_updated_at, s.email AS store_email,
            c.name AS client_name, c.code AS client_code, c.address AS client_address,
            c.contact AS client_contact, c.client_type,
            c.delivery_point_id AS client_delivery_point_id,
            sc.cart_number, sc.sale_type, sc.payment_mode, sc.amount_paid, sc.validated_at,
            sc.delivery_point_id, e.name AS seller_name
     FROM proforma_invoices pf
     JOIN sales_carts sc ON sc.id = pf.cart_id
     CROSS JOIN store_settings s
     LEFT JOIN clients c ON c.id = COALESCE(pf.client_id, sc.client_id)
     LEFT JOIN employees e ON e.id = sc.seller_id
     WHERE pf.id = $1`,
    [req.params.id]
  );
  if (!inv.rows.length) return res.status(404).json({ message: 'Facture introuvable' });
  try {
    assertPvAccess(req.user, inv.rows[0]);
  } catch (err) {
    return res.status(err.status || 403).json({ message: err.message });
  }

  const lines = await pool.query(
    `SELECT sl.id, sl.cart_id, sl.product_id, sl.unit_price, sl.discount, sl.quantity, sl.line_total, sl.created_at,
            sl.product_name_snapshot, sl.product_reference_snapshot,
            p.name AS product_name,
            p.reference AS product_reference
     FROM sale_lines sl JOIN products p ON p.id = sl.product_id
     WHERE sl.cart_id = $1 ORDER BY sl.id`,
    [inv.rows[0].cart_id]
  );

  let payments = [];
  try {
    const payRes = await pool.query(
      `SELECT cp.* FROM cart_payments cp
       WHERE cp.cart_id = $1 ORDER BY cp.created_at`,
      [inv.rows[0].cart_id]
    );
    payments = payRes.rows;
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }

  res.json({ ...inv.rows[0], lines: lines.rows, payments });
}));

export default router;
