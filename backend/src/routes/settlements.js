import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { syncMissingSalesDebtSettlements, syncLinkedSettlementFromCart, getClientsReceivablesAggregate } from '../services/salesService.js';
import { isSellerScoped, assertCartAccess, assertCanCollectPaymentAfterSale } from '../utils/sellerScope.js';
import { assertPvAccess, assertClientPvAccess, pvSettlementSqlClause } from '../utils/pvScope.js';
import { logAudit } from '../middleware/audit.js';
import { validateBody, readAmount, readEnum, readPositiveInt, readTrimmedString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
router.use(authenticate);

const SETTLEMENT_TYPES = ['dette_commerciale', 'dette_externe', 'creance_commerciale', 'creance_externe'];
const PAYMENT_MODES = ['especes', 'mobile_money', 'virement', 'cheque', 'carte', 'mixte'];

const validateCreateSettlementBody = validateBody((body) => {
  const settlementType = readEnum(body, 'settlement_type', SETTLEMENT_TYPES, { required: true, label: 'Type de règlement' });
  if (settlementType.error) return { error: settlementType.error };
  const clientId = readPositiveInt(body, 'client_id', { required: false, label: 'Client' });
  if (clientId.error) return { error: clientId.error };
  const amount = readAmount(body, 'amount', { required: true, min: 0.01, label: 'Montant' });
  if (amount.error) return { error: amount.error };
  const dueDate = readTrimmedString(body, 'due_date', { required: false, min: 8, max: 10, label: 'Date échéance' });
  if (dueDate.error) return { error: dueDate.error };
  const notes = readTrimmedString(body, 'notes', { required: false, max: 500, label: 'Notes' });
  if (notes.error) return { error: notes.error };
  return {
    value: {
      settlement_type: settlementType.value,
      client_id: clientId.value,
      amount: amount.value,
      due_date: dueDate.value,
      notes: notes.value,
    },
  };
});

const validateSettlementPaymentBody = validateBody((body) => {
  const amount = readAmount(body, 'amount', { required: true, min: 0.01, label: 'Montant' });
  if (amount.error) return { error: amount.error };
  const paymentMode = readEnum(body, 'payment_mode', PAYMENT_MODES, { required: false, label: 'Mode de paiement' });
  if (paymentMode.error) return { error: paymentMode.error };
  const notes = readTrimmedString(body, 'notes', { required: false, max: 500, label: 'Notes' });
  if (notes.error) return { error: notes.error };
  return {
    value: {
      amount: amount.value,
      payment_mode: paymentMode.value,
      notes: notes.value,
    },
  };
});

router.get('/', asyncHandler(async (req, res) => {
  const { settlement_type, status, sync_sales, balance_only } = req.query;

  if (sync_sales === 'true') {
    await syncMissingSalesDebtSettlements();
  }

  const scoped = isSellerScoped(req.user);
  const sellerId = scoped ? req.user.employee_id : null;

  let q = scoped
    ? `SELECT s.*, c.name AS client_name, sc.cart_number AS sale_cart_number
       FROM settlements s
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN sales_carts sc ON sc.id = s.reference_id
       WHERE (sc.seller_id = $1 OR (s.reference_id IS NULL AND s.created_by = $2))`
    : `SELECT s.*, c.name AS client_name,
              sc.cart_number AS sale_cart_number
       FROM settlements s
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN sales_carts sc ON sc.id = s.reference_id
       WHERE 1=1`;
  const params = scoped ? [sellerId, req.user.id] : [];
  if (settlement_type) { params.push(settlement_type); q += ` AND s.settlement_type = $${params.length}`; }
  if (status) { params.push(status); q += ` AND s.status = $${params.length}`; }
  if (balance_only === 'true') { q += ` AND s.balance > 0.005`; }
  const pvFilter = pvSettlementSqlClause(req.user, {}, params.length + 1, req.query.delivery_point_id);
  if (pvFilter.sql) {
    q += pvFilter.sql;
    params.push(...pvFilter.params);
  }
  q += ' ORDER BY s.created_at DESC';
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

router.post('/', validateCreateSettlementBody, asyncHandler(async (req, res) => {
  try {
    const { settlement_type, client_id, amount, due_date, notes } = req.body;
    if (!settlement_type || !amount) {
      return res.status(400).json({ message: 'Type et montant requis' });
    }
    if (client_id) {
      await assertClientPvAccess(req.user, client_id);
    }
    const num = `REG-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
    const amt = parseFloat(amount);
    const { rows } = await pool.query(
      `INSERT INTO settlements (settlement_number, settlement_type, client_id, amount, amount_paid, balance, due_date, notes, created_by)
       VALUES ($1,$2,$3,$4,0,$4,$5,$6,$7) RETURNING *`,
      [num, settlement_type, client_id || null, amt, due_date || null, notes || null, req.user.id]
    );
    await logAudit(req.user.id, 'create', 'settlement', rows[0].id, {
      settlement_number: num,
      settlement_type,
      amount: amt,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}));

router.get('/debts-summary', asyncHandler(async (req, res) => {
  await syncMissingSalesDebtSettlements();
  const agg = await getClientsReceivablesAggregate({
    user: req.user,
    requestedPvId: req.query.delivery_point_id,
    delivery_point_id: req.query.delivery_point_id,
  });
  res.json([{
    settlement_type: 'client_debt',
    total_balance: agg.total_balance_due,
    count: agg.clients_with_debt,
  }]);
}));

router.post('/:id/payments', validateSettlementPaymentBody, asyncHandler(async (req, res) => {
  try {
    assertCanCollectPaymentAfterSale(req.user);
  } catch (err) {
    return res.status(err.status || 403).json({ message: err.message });
  }
  const { amount, payment_mode, notes } = req.body;
  const installment = parseFloat(amount || 0);
  if (!installment || installment <= 0) {
    return res.status(400).json({ message: 'Montant invalide' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const settRes = await client.query('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [req.params.id]);
    const settlement = settRes.rows[0];
    if (!settlement) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Enregistrement introuvable' });
    }
    if (settlement.reference_id) {
      const cartCheck = await client.query('SELECT * FROM sales_carts WHERE id = $1', [settlement.reference_id]);
      if (cartCheck.rows[0]) {
        assertCartAccess(req.user, cartCheck.rows[0]);
        assertPvAccess(req.user, cartCheck.rows[0]);
      }
    }
    if (settlement.client_id) {
      await assertClientPvAccess(req.user, settlement.client_id, client);
    }
    if (parseFloat(settlement.balance) <= 0.005) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cette dette est déjà soldée' });
    }
    if (installment > parseFloat(settlement.balance) + 0.005) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Montant supérieur au solde restant' });
    }

    await client.query(
      `INSERT INTO settlement_payments (settlement_id, amount, payment_mode, notes, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, installment, payment_mode, notes, req.user.id]
    );

    if (settlement.reference_id && settlement.settlement_type === 'creance_commerciale') {
      const cartRes = await client.query(
        'SELECT id, cart_number, total_amount, amount_paid, seller_id FROM sales_carts WHERE id = $1 FOR UPDATE',
        [settlement.reference_id]
      );
      const cart = cartRes.rows[0];
      if (cart) {
        assertCartAccess(req.user, cart);
        assertPvAccess(req.user, cart);
        const newPaid = parseFloat(cart.amount_paid || 0) + installment;
        try {
          await client.query(
            `INSERT INTO cart_payments (cart_id, amount, payment_mode, created_by)
             VALUES ($1, $2, $3, $4)`,
            [cart.id, installment, payment_mode || 'especes', req.user.id]
          );
        } catch (e) {
          if (e.code !== '42P01') throw e;
        }
        await client.query(
          `UPDATE sales_carts SET amount_paid = $1, payment_mode = $2, updated_at = NOW() WHERE id = $3`,
          [newPaid, payment_mode || 'especes', cart.id]
        );
        await client.query(
          `INSERT INTO cash_transactions (cash_date, transaction_type, amount, description, reference_type, reference_id, created_by)
           VALUES (CURRENT_DATE, 'recette', $1, $2, 'sales_cart', $3, $4)`,
          [installment, `Règlement dette ${cart.cart_number}`, cart.id, req.user.id]
        );
        await syncLinkedSettlementFromCart(client, cart.id);
      }
    } else {
      await client.query(
        `UPDATE settlements SET amount_paid = amount_paid + $1,
         balance = amount - (amount_paid + $1),
         status = CASE WHEN amount <= (amount_paid + $1) THEN 'solde' ELSE 'en_cours' END,
         updated_at = NOW() WHERE id = $2`,
        [installment, req.params.id]
      );
    }

    await client.query('COMMIT');
    await logAudit(req.user.id, 'payment', 'settlement', parseInt(req.params.id, 10), {
      settlement_number: settlement.settlement_number,
      installment,
      payment_mode,
    });
    const { rows } = await pool.query(
      `SELECT s.*, c.name AS client_name, sc.cart_number AS sale_cart_number
       FROM settlements s
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN sales_carts sc ON sc.id = s.reference_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ message: e.message });
  } finally {
    client.release();
  }
}));

export default router;
