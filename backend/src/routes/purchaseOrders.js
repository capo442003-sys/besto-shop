import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { generateOrderNumber } from '../utils/codes.js';
import { emitEvent, EVENTS } from '../socket/index.js';
import { logAudit } from '../middleware/audit.js';
import { pvClientSqlClause, assertClientPvAccess } from '../utils/pvScope.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
router.use(authenticate);

async function assertOrderPvAccess(user, order) {
  if (!order?.client_id) {
    const err = new Error('Accès refusé — bon sans client');
    err.status = 403;
    throw err;
  }
  await assertClientPvAccess(user, order.client_id);
}

async function getOrder(orderId) {
  const { rows } = await pool.query(
    `SELECT po.*, c.name AS client_name, c.code AS client_code,
            c.contact AS client_contact, c.address AS client_address,
            c.delivery_point_id,
            GREATEST(0, COALESCE(po.total_amount, 0) - COALESCE(po.amount_paid, 0)) AS balance_due
     FROM purchase_orders po
     LEFT JOIN clients c ON c.id = po.client_id
     WHERE po.id = $1`,
    [orderId]
  );
  return rows[0] || null;
}

async function getOrderLines(orderId) {
  const { rows } = await pool.query(
    `SELECT pol.*, p.name AS product_name, p.reference AS product_reference
     FROM purchase_order_lines pol
     LEFT JOIN products p ON p.id = pol.product_id
     WHERE pol.order_id = $1 ORDER BY pol.id`,
    [orderId]
  );
  return rows;
}

async function getOrderPayments(orderId) {
  try {
    const { rows } = await pool.query(
      `SELECT pop.*, u.username AS created_by_name
       FROM purchase_order_payments pop
       LEFT JOIN users u ON u.id = pop.created_by
       WHERE pop.order_id = $1 ORDER BY pop.created_at`,
      [orderId]
    );
    return rows;
  } catch (e) {
    if (e.code === '42P01') return [];
    throw e;
  }
}

async function recalculateOrderTotal(orderId, client = pool) {
  await client.query(
    `UPDATE purchase_orders SET total_amount = (
       SELECT COALESCE(SUM(line_total), 0) FROM purchase_order_lines WHERE order_id = $1
     ), updated_at = NOW() WHERE id = $1`,
    [orderId]
  );
}

async function buildOrderResponse(orderId) {
  const order = await getOrder(orderId);
  if (!order) return null;
  const lines = await getOrderLines(orderId);
  const payments = await getOrderPayments(orderId);
  return { ...order, lines, payments };
}

async function finalizeOrderIfPaid(orderId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, order_number, status, total_amount, amount_paid FROM purchase_orders WHERE id = $1`,
    [orderId]
  );
  const order = rows[0];
  if (!order || order.status === 'finalise') return order;
  const total = parseFloat(order.total_amount || 0);
  const paid = parseFloat(order.amount_paid || 0);
  if (total <= 0.005 || paid + 0.005 < total) return order;
  const { rows: updated } = await client.query(
    `UPDATE purchase_orders SET status = 'finalise', finalized_at = NOW(), updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [orderId]
  );
  return updated[0];
}

router.get('/', asyncHandler(async (req, res) => {
  const { status, reglement, balance_due } = req.query;
  const params = [];
  let q = `SELECT po.*, c.name AS client_name, c.code AS client_code,
           c.delivery_point_id, dp.code AS delivery_point_code,
           GREATEST(0, COALESCE(po.total_amount, 0) - COALESCE(po.amount_paid, 0)) AS balance_due
           FROM purchase_orders po
           LEFT JOIN clients c ON c.id = po.client_id
           LEFT JOIN delivery_points dp ON dp.id = c.delivery_point_id
           WHERE 1=1`;
  const pvFilter = pvClientSqlClause(req.user, 'c', params.length + 1, req.query.delivery_point_id);
  if (pvFilter.sql) {
    q += pvFilter.sql;
    params.push(...pvFilter.params);
  }
  if (status) { params.push(status); q += ` AND po.status = $${params.length}`; }
  if (reglement === 'true') {
    q += ` AND EXISTS (SELECT 1 FROM purchase_order_lines pol WHERE pol.order_id = po.id)
           AND COALESCE(po.total_amount, 0) > 0`;
  }
  if (balance_due === 'true') {
    q += ` AND GREATEST(0, COALESCE(po.total_amount, 0) - COALESCE(po.amount_paid, 0)) > 0.005`;
  }
  q += ' ORDER BY po.created_at DESC';
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const data = await buildOrderResponse(req.params.id);
  if (!data) return res.status(404).json({ message: 'Bon introuvable' });
  try {
    if (data.client_id) {
      await assertClientPvAccess(req.user, data.client_id);
    }
  } catch (err) {
    return res.status(err.status || 403).json({ message: err.message });
  }
  res.json(data);
}));

router.post('/', asyncHandler(async (req, res) => {
  try {
    const { client_id, supplier_id, notes } = req.body;
    if (!client_id) {
      return res.status(400).json({ message: 'Client requis pour créer un bon de commande' });
    }
    await assertClientPvAccess(req.user, client_id);

    const orderNumber = await generateOrderNumber(pool);
    const { rows } = await pool.query(
      `INSERT INTO purchase_orders (order_number, client_id, supplier_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [orderNumber, client_id, supplier_id || null, notes || null, req.user.id]
    );
    emitEvent(EVENTS.DASHBOARD_REFRESH, {});
    const full = await buildOrderResponse(rows[0].id);
    await logAudit(req.user.id, 'create', 'purchase_order', rows[0].id, {
      order_number: orderNumber,
    });
    res.status(201).json(full);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ message: 'Bon introuvable' });
    await assertOrderPvAccess(req.user, order);
    if (order.status !== 'en_cours') {
      return res.status(400).json({ message: 'Ce bon ne peut plus être modifié' });
    }
    const lines = await getOrderLines(req.params.id);
    const fields = [];
    const params = [];
    let i = 1;
    if (req.body.client_id != null) {
      if (lines.length > 0) {
        return res.status(400).json({ message: 'Client non modifiable après ajout de lignes' });
      }
      await assertClientPvAccess(req.user, req.body.client_id);
      fields.push(`client_id = $${i++}`);
      params.push(req.body.client_id || null);
    }
    if (req.body.notes !== undefined) {
      fields.push(`notes = $${i++}`);
      params.push(req.body.notes || null);
    }
    if (!fields.length) return res.status(400).json({ message: 'Aucune modification' });
    fields.push('updated_at = NOW()');
    params.push(req.params.id);
    await pool.query(`UPDATE purchase_orders SET ${fields.join(', ')} WHERE id = $${i}`, params);
    const full = await buildOrderResponse(req.params.id);
    await logAudit(req.user.id, 'update', 'purchase_order', parseInt(req.params.id, 10), {
      order_number: order.order_number,
    });
    res.json(full);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}));

router.post('/:id/lines', asyncHandler(async (req, res) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ message: 'Bon introuvable' });
    await assertOrderPvAccess(req.user, order);
    if (order.status !== 'en_cours') {
      return res.status(400).json({ message: 'Ce bon de commande ne peut plus être modifié' });
    }

    const { product_id, description, quantity, unit_price } = req.body;
    const qty = parseFloat(quantity);
    const price = parseFloat(unit_price);

    if (!product_id) {
      return res.status(400).json({ message: 'Sélectionnez un produit' });
    }
    if (!qty || qty <= 0) {
      return res.status(400).json({ message: 'Quantité invalide (minimum 0,001)' });
    }
    if (Number.isNaN(price) || price <= 0) {
      return res.status(400).json({ message: 'Prix unitaire invalide (minimum 1 GNF)' });
    }

    const { rows: dup } = await pool.query(
      'SELECT id FROM purchase_order_lines WHERE order_id = $1 AND product_id = $2 LIMIT 1',
      [req.params.id, product_id]
    );
    if (dup.length) {
      return res.status(400).json({ message: 'Ce produit est déjà dans le bon de commande' });
    }

    const lineTotal = qty * price;
    await pool.query(
      `INSERT INTO purchase_order_lines (order_id, product_id, description, quantity, unit_price, line_total)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        req.params.id,
        product_id,
        description?.trim() || null,
        qty,
        price,
        lineTotal,
      ]
    );
    await recalculateOrderTotal(req.params.id);
    const full = await buildOrderResponse(req.params.id);
    const { rows: prod } = await pool.query(
      'SELECT reference, name FROM products WHERE id = $1',
      [product_id]
    );
    await logAudit(req.user.id, 'create', 'purchase_order_line', null, {
      order_number: order.order_number,
      reference: prod[0]?.reference,
      product_name: prod[0]?.name,
      quantity: qty,
    });
    emitEvent(EVENTS.DASHBOARD_REFRESH, {});
    res.status(201).json(full);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}));

router.delete('/:id/lines/:lineId', asyncHandler(async (req, res) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ message: 'Bon introuvable' });
    await assertOrderPvAccess(req.user, order);
    if (order.status !== 'en_cours') {
      return res.status(400).json({ message: 'Ce bon de commande ne peut plus être modifié' });
    }

    const del = await pool.query(
      `DELETE FROM purchase_order_lines pol
       USING products p
       WHERE pol.id = $1 AND pol.order_id = $2 AND p.id = pol.product_id
       RETURNING pol.id, pol.quantity, pol.unit_price, p.reference, p.name AS product_name`,
      [req.params.lineId, req.params.id]
    );
    if (!del.rows.length) return res.status(404).json({ message: 'Ligne introuvable' });

    await logAudit(req.user.id, 'delete', 'purchase_order_line', parseInt(req.params.lineId, 10), {
      order_number: order.order_number,
      reference: del.rows[0].reference,
      product_name: del.rows[0].product_name,
      quantity: del.rows[0].quantity,
    });

    await recalculateOrderTotal(req.params.id);
    const full = await buildOrderResponse(req.params.id);
    res.json(full);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}));

router.post('/:id/payments', asyncHandler(async (req, res) => {
  const db = await pool.connect();
  try {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ message: 'Bon introuvable' });
    await assertOrderPvAccess(req.user, order);

    const total = parseFloat(order.total_amount || 0);
    const alreadyPaid = parseFloat(order.amount_paid || 0);
    const reste = total - alreadyPaid;

    if (order.status === 'finalise' && reste <= 0.005) {
      return res.status(400).json({ message: 'Ce bon est déjà soldé' });
    }
    if (reste <= 0.005) {
      return res.status(400).json({ message: 'Ce bon est déjà entièrement encaissé' });
    }

    const installment = parseFloat(req.body.amount_paid ?? req.body.amount ?? 0);
    if (!installment || installment <= 0) {
      return res.status(400).json({ message: 'Montant du versement invalide' });
    }
    if (installment > reste + 0.005) {
      return res.status(400).json({
        message: `Montant trop élevé. Reste à payer : ${Math.round(reste).toLocaleString('fr-FR')} GNF`,
      });
    }

    const paymentMode = req.body.payment_mode || 'especes';
    const newPaid = alreadyPaid + installment;

    await db.query('BEGIN');

    try {
      await db.query(
        `INSERT INTO purchase_order_payments (order_id, amount, payment_mode, created_by)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, installment, paymentMode, req.user.id]
      );
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }

    await db.query(
      `UPDATE purchase_orders SET amount_paid = $1, payment_mode = $2, updated_at = NOW() WHERE id = $3`,
      [newPaid, paymentMode, req.params.id]
    );

    await db.query(
      `INSERT INTO cash_transactions (cash_date, transaction_type, amount, description, reference_type, reference_id, created_by)
       VALUES (CURRENT_DATE, 'recette', $1, $2, 'purchase_order', $3, $4)`,
      [installment, `Encaissement BC ${order.order_number}`, req.params.id, req.user.id]
    );

    await finalizeOrderIfPaid(req.params.id, db);

    await db.query('COMMIT');

    await logAudit(req.user.id, 'payment', 'purchase_order', parseInt(req.params.id, 10), {
      order_number: order.order_number,
      installment,
      payment_mode: paymentMode,
    });

    const full = await buildOrderResponse(req.params.id);
    const balanceDue = Math.max(0, total - newPaid);
    emitEvent(EVENTS.DASHBOARD_REFRESH, {});
    res.json({
      ...full,
      balance_due: balanceDue,
      finalized: full.status === 'finalise',
      message: balanceDue > 0.005
        ? `Versement enregistré — reste ${Math.round(balanceDue).toLocaleString('fr-FR')} GNF`
        : 'Paiement complet — bon finalisé',
    });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(400).json({ message: err.message });
  } finally {
    db.release();
  }
}));

router.patch('/:id/finalize', asyncHandler(async (req, res) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ message: 'Bon introuvable' });
    await assertOrderPvAccess(req.user, order);
    if (order.status !== 'en_cours') {
      return res.status(400).json({ message: 'Ce bon est déjà finalisé' });
    }

    const lines = await getOrderLines(req.params.id);
    if (!lines.length) {
      return res.status(400).json({ message: 'Ajoutez au moins une ligne' });
    }

    await recalculateOrderTotal(req.params.id);
    const refreshed = await getOrder(req.params.id);
    const total = parseFloat(refreshed.total_amount || 0);
    const paid = parseFloat(refreshed.amount_paid || 0);
    if (total <= 0) {
      return res.status(400).json({ message: 'Le total du bon doit être supérieur à 0 GNF' });
    }
    if (paid + 0.005 < total) {
      return res.status(400).json({
        message: 'Encaissez le bon en totalité avant finalisation — voir Règlement BC',
      });
    }

    const finalized = await finalizeOrderIfPaid(req.params.id);
    const full = await buildOrderResponse(req.params.id);
    emitEvent(EVENTS.DASHBOARD_REFRESH, {});
    res.json(full || finalized);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) return res.status(404).json({ message: 'Bon introuvable' });
    await assertOrderPvAccess(req.user, order);
    if (order.status !== 'en_cours') {
      return res.status(400).json({ message: 'Seuls les bons en cours peuvent être annulés' });
    }
    if (parseFloat(order.amount_paid || 0) > 0.005) {
      return res.status(400).json({ message: 'Impossible d\'annuler un bon déjà encaissé' });
    }

    await pool.query('DELETE FROM purchase_order_lines WHERE order_id = $1', [req.params.id]);
    await pool.query('DELETE FROM purchase_orders WHERE id = $1', [req.params.id]);
    await logAudit(req.user.id, 'cancel', 'purchase_order', parseInt(req.params.id, 10), {
      order_number: order.order_number,
    });
    emitEvent(EVENTS.DASHBOARD_REFRESH, {});
    res.json({ message: 'Bon de commande annulé' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}));

export default router;
