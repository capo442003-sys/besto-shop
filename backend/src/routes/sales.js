import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAnyPermission, requirePermission } from '../middleware/requirePermission.js';
import * as salesService from '../services/salesService.js';
import pool from '../db/pool.js';
import { applySellerScope, assertCartAccess, resolveSellerId, assertCanCollectPayment } from '../utils/sellerScope.js';
import { applyPvScope, resolveDeliveryPointId, assertPvAccess, assertClientPvAccess, canAccessAllPvs, requiresPvIsolation, attachPvUserToFilters } from '../utils/pvScope.js';
import { requireAdmin } from '../middleware/auth.js';
import { validateBody, readAmount, readBoolean, readEnum, readTrimmedString, coerceBoolean } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
router.use(authenticate);

const PAYMENT_MODES = ['especes', 'mobile_money', 'virement', 'cheque', 'carte', 'mixte'];

const validateCartPaymentBody = validateBody((body) => {
  const amount = readAmount(body, 'amount_paid', { required: false, min: 0, label: 'Montant' });
  if (amount.error) return { error: amount.error };
  const amountAlt = readAmount(body, 'amount', { required: false, min: 0, label: 'Montant' });
  if (amountAlt.error) return { error: amountAlt.error };
  const paymentMode = readEnum(body, 'payment_mode', PAYMENT_MODES, { required: false, label: 'Mode de paiement' });
  if (paymentMode.error) return { error: paymentMode.error };
  const useAdvance = readBoolean(body, 'use_advance', { required: false, label: 'use_advance' });
  if (useAdvance.error) return { error: useAdvance.error };
  return {
    value: {
      amount_paid: amount.value,
      amount: amountAlt.value,
      payment_mode: paymentMode.value,
      use_advance: useAdvance.value,
    },
  };
});

const validateCartValidateBody = validateBody((body) => {
  const amountPaid = readAmount(body, 'amount_paid', { required: false, min: 0, label: 'Montant' });
  if (amountPaid.error) return { error: amountPaid.error };
  const paymentMode = readEnum(body, 'payment_mode', PAYMENT_MODES, { required: false, label: 'Mode de paiement' });
  if (paymentMode.error) return { error: paymentMode.error };
  const useAdvance = readBoolean(body, 'use_advance', { required: false, label: 'use_advance' });
  if (useAdvance.error) return { error: useAdvance.error };
  const payment = body.payment;
  if (payment != null && typeof payment !== 'object') {
    return { error: 'payment invalide' };
  }
  return {
    value: {
      amount_paid: amountPaid.value,
      payment_mode: paymentMode.value,
      payment: payment || undefined,
      use_advance: useAdvance.value,
    },
  };
});

const validateAdvancePaymentBody = validateBody((body) => {
  const amountPaid = readAmount(body, 'amount_paid', { required: false, min: 0.01, label: 'Montant avance' });
  if (amountPaid.error) return { error: amountPaid.error };
  const amount = readAmount(body, 'amount', { required: false, min: 0.01, label: 'Montant avance' });
  if (amount.error) return { error: amount.error };
  if (amountPaid.value == null && amount.value == null) {
    return { error: 'Montant avance requis' };
  }
  const paymentMode = readEnum(body, 'payment_mode', PAYMENT_MODES, { required: false, label: 'Mode de paiement' });
  if (paymentMode.error) return { error: paymentMode.error };
  const notes = readTrimmedString(body, 'notes', { required: false, max: 500, label: 'Notes' });
  if (notes.error) return { error: notes.error };
  return {
    value: {
      amount_paid: amountPaid.value,
      amount: amount.value,
      payment_mode: paymentMode.value,
      notes: notes.value,
    },
  };
});

const validateBulkPaymentBody = validateBody((body) => {
  const amountPaid = readAmount(body, 'amount_paid', { required: false, min: 0.01, label: 'Montant encaissement' });
  if (amountPaid.error) return { error: amountPaid.error };
  const amount = readAmount(body, 'amount', { required: false, min: 0.01, label: 'Montant encaissement' });
  if (amount.error) return { error: amount.error };
  const paymentMode = readEnum(body, 'payment_mode', PAYMENT_MODES, { required: false, label: 'Mode de paiement' });
  if (paymentMode.error) return { error: paymentMode.error };
  return {
    value: {
      amount_paid: amountPaid.value,
      amount: amount.value,
      payment_mode: paymentMode.value,
    },
  };
});

function mergeSalesFilters(user, query) {
  return attachPvUserToFilters(user, applyPvScope(user, applySellerScope(user, query)));
}

function assertCartScope(user, cart) {
  assertCartAccess(user, cart);
  assertPvAccess(user, cart);
}

async function getCartOr404(id) {
  return salesService.getCartById(id);
}

router.post('/reconcile-balances', requireAdmin, asyncHandler(async (req, res) => {
  try {
    const date = req.query.date || req.body?.date || null;
    const forceFull = req.query.force_full === 'true' || req.body?.force_full === true;
    const roundingFixed = await salesService.reconcileMisreportedCartBalances({ date });
    const fullFixed = forceFull && date
      ? await salesService.forceSettlePaidInFullCarts({ date, userId: req.user.id })
      : [];
    await salesService.syncMissingSalesDebtSettlements();
    const pvFilters = requiresPvIsolation(req.user)
      ? (resolveDeliveryPointId(req.user, req.query.delivery_point_id) != null
        ? { delivery_point_id: resolveDeliveryPointId(req.user, req.query.delivery_point_id) }
        : { user: req.user, requestedPvId: req.query.delivery_point_id })
      : {};
    const [fromCarts, fromSettlements] = await Promise.all([
      salesService.getClientReceivablesSummary(pvFilters),
      salesService.getSettlementCreancesSummary(pvFilters),
    ]);
    res.json({
      count: roundingFixed.length + fullFixed.length,
      rounding_fixed: roundingFixed,
      full_payment_fixed: fullFixed,
      creances_paniers: parseFloat(fromCarts.balance_due || 0),
      creances_dossiers: parseFloat(fromSettlements.total || 0),
      ecart: Math.round(parseFloat(fromSettlements.total || 0) - parseFloat(fromCarts.balance_due || 0)),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}));

router.get('/receivables-summary', asyncHandler(async (req, res) => {
  try {
    await salesService.syncMissingSalesDebtSettlements();
  } catch (err) {
    console.error('Sync créances (résumé):', err.message);
  }
  try {
    const pvId = resolveDeliveryPointId(req.user, req.query.delivery_point_id);
    const aggregateOpts = pvId != null
      ? { delivery_point_id: pvId }
      : (requiresPvIsolation(req.user) ? { user: req.user, requestedPvId: req.query.delivery_point_id } : {});
    const summary = await salesService.getClientsReceivablesAggregate(aggregateOpts);
    res.json({
      total_balance_due: parseFloat(summary.total_balance_due || 0),
      total_cart_balance_due: parseFloat(summary.total_cart_balance_due || 0),
      total_external_balance_due: parseFloat(summary.total_external_balance_due || 0),
      clients_with_debt: parseInt(summary.clients_with_debt || 0, 10),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}));

router.get('/carts', asyncHandler(async (req, res) => {
  const filters = mergeSalesFilters(req.user, req.query);
  const withSummary = req.query.inventaire === 'true' || req.query.reglement === 'true';
  if (req.query.inventaire === 'true') {
    filters.inventaire = 'true';
    try {
      await salesService.syncMissingSalesDebtSettlements();
    } catch (err) {
      console.error('Sync créances (inventaire):', err.message);
    }
  }
  if (req.query.reglement === 'true') filters.reglement = 'true';
  const listResult = await salesService.listCarts(filters);
  const paginated = listResult && listResult.rows;
  const carts = paginated ? listResult.rows : listResult;
  if (withSummary || paginated) {
    const summary = await salesService.getCartListSummary(filters);
    const payload = { carts, summary };
    if (paginated) {
      payload.total = listResult.total;
      payload.page = listResult.page;
      payload.limit = listResult.limit;
      payload.truncated = listResult.page * listResult.limit < listResult.total;
    } else {
      payload.truncated = filters.inventaire === 'true'
        ? false
        : carts.length < (summary.cart_count || 0);
    }
    return res.json(payload);
  }
  res.json(carts);
}));

router.get('/carts/:id', asyncHandler(async (req, res) => {
  const cart = await getCartOr404(req.params.id);
  if (!cart) return res.status(404).json({ message: 'Panier introuvable' });
  try {
    assertCartScope(req.user, cart);
  } catch (e) {
    return res.status(e.status || 403).json({ message: e.message });
  }
  res.json(cart);
}));

router.post('/carts', asyncHandler(async (req, res) => {
  try {
    const delivery_point_id = resolveDeliveryPointId(req.user, req.body.delivery_point_id);
    if (!delivery_point_id) {
      return res.status(400).json({ message: 'Point de vente requis' });
    }
    const cart = await salesService.createCart(
      {
        ...req.body,
        seller_id: resolveSellerId(req.user, req.body.seller_id),
        delivery_point_id,
      },
      req.user.id
    );
    res.status(201).json(cart);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}));

router.patch('/carts/:id', asyncHandler(async (req, res) => {
  try {
    const existing = await getCartOr404(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Panier introuvable' });
    assertCartScope(req.user, existing);
    const patch = { ...req.body };
    if (patch.seller_id != null) {
      patch.seller_id = resolveSellerId(req.user, patch.seller_id);
    }
    if (patch.delivery_point_id != null) {
      patch.delivery_point_id = resolveDeliveryPointId(req.user, patch.delivery_point_id);
    }
    const cart = await salesService.updateCart(req.params.id, patch);
    res.json(cart);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.post('/carts/:id/lines', asyncHandler(async (req, res) => {
  try {
    const existing = await getCartOr404(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Panier introuvable' });
    assertCartScope(req.user, existing);
    const result = await salesService.addLineToCart(req.params.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.delete('/carts/:cartId/lines/:lineId', asyncHandler(async (req, res) => {
  try {
    const existing = await getCartOr404(req.params.cartId);
    if (!existing) return res.status(404).json({ message: 'Panier introuvable' });
    assertCartScope(req.user, existing);
    const cart = await salesService.removeLineFromCart(
      req.params.lineId,
      req.params.cartId,
      req.user.id
    );
    res.json(cart);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.post('/carts/:id/cancel', asyncHandler(async (req, res) => {
  try {
    const existing = await getCartOr404(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Panier introuvable' });
    assertCartScope(req.user, existing);
    const result = await salesService.cancelCart(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.post('/carts/:id/void', requirePermission('ventes', 'delete'), asyncHandler(async (req, res) => {
  try {
    const existing = await getCartOr404(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Vente introuvable' });
    assertCartScope(req.user, existing);
    const result = await salesService.voidFinalizedSale(req.params.id, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.post('/carts/:id/payments', validateCartPaymentBody, asyncHandler(async (req, res) => {
  try {
    const existing = await getCartOr404(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Panier introuvable' });
    assertCartScope(req.user, existing);
    assertCanCollectPayment(req.user);
    const cart = await salesService.recordCartPayment(req.params.id, req.body, req.user.id);
    res.json(cart);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.post('/carts/:id/finalize-free', asyncHandler(async (req, res) => {
  try {
    const existing = await getCartOr404(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Panier introuvable' });
    assertCartScope(req.user, existing);
    const cart = await salesService.finalizeZeroTotalCart(req.params.id, req.user.id);
    res.json(cart);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.post('/carts/:id/validate', validateCartValidateBody, asyncHandler(async (req, res) => {
  try {
    const existing = await getCartOr404(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Panier introuvable' });
    assertCartScope(req.user, existing);
    const { amount_paid, payment_mode, payment, use_advance } = req.body || {};
    let paymentPayload = payment;
    if (!paymentPayload) {
      const useAdvance = coerceBoolean(use_advance);
      const amountNum = amount_paid != null && amount_paid !== '' ? Number(amount_paid) : 0;
      const hasAmount = Number.isFinite(amountNum) && amountNum > 0.005;
      if (hasAmount || useAdvance) {
        paymentPayload = {
          amount_paid: hasAmount ? amountNum : 0,
          payment_mode: payment_mode || 'especes',
          use_advance: useAdvance,
        };
      }
    }
    const cart = await salesService.validateCart(req.params.id, req.user.id, paymentPayload);
    res.json(cart);
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ message: err.message || 'Erreur validation' });
  }
}));

router.get('/carts/:id/stock/:productId', asyncHandler(async (req, res) => {
  try {
    const cart = await getCartOr404(req.params.id);
    if (!cart) return res.status(404).json({ message: 'Panier introuvable' });
    assertCartScope(req.user, cart);
    const stock = await salesService.getCartProductStock(
      req.params.id,
      req.params.productId,
      cart.delivery_point_id,
    );
    res.json(stock);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.get('/daily-report', asyncHandler(async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) {
      return res.status(400).json({ message: 'Paramètre date requis (YYYY-MM-DD)' });
    }
    const filters = mergeSalesFilters(req.user, { ...req.query, date });
    const report = await salesService.getDailySalesReport(filters);
    res.json(report);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}));

router.get('/monthly-report', asyncHandler(async (req, res) => {
  try {
    const month = req.query.month;
    if (!month) {
      return res.status(400).json({ message: 'Paramètre month requis (YYYY-MM)' });
    }
    const filters = mergeSalesFilters(req.user, { ...req.query, month });
    const report = await salesService.getMonthlySalesReport(filters);
    res.json(report);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
}));

router.get('/by-product', asyncHandler(async (req, res) => {
  const filters = mergeSalesFilters(req.user, req.query);
  if (req.query.inventaire === 'true') {
    filters.inventaire = 'true';
    const paginated = await salesService.listSalesByProductPaginated(filters);
    const [summary, grouped] = await Promise.all([
      salesService.getInventaireProductSummary(filters),
      salesService.listInventaireByProductGrouped(filters),
    ]);
    const payload = {
      items: paginated.items,
      grouped,
      summary,
      truncated: filters.inventaire === 'true'
        ? false
        : (paginated.total != null
          ? paginated.page * paginated.limit < paginated.total
          : paginated.items.length < (summary.line_count || 0)),
    };
    if (paginated.total != null) {
      payload.total = paginated.total;
      payload.page = paginated.page;
      payload.limit = paginated.limit;
    }
    return res.json(payload);
  }
  const sales = await salesService.listSalesByProduct(filters);
  res.json(sales);
}));

router.get('/clients/:clientId/unpaid-carts', asyncHandler(async (req, res) => {
  try {
    assertCanCollectPayment(req.user);
    await assertClientPvAccess(req.user, req.params.clientId, pool);
    const data = await salesService.getClientEncaissementAccount(req.params.clientId);
    res.json(data);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.get('/clients/:clientId/advance-balance', asyncHandler(async (req, res) => {
  try {
    await assertClientPvAccess(req.user, req.params.clientId, pool);
    const data = await salesService.listClientAdvances(req.params.clientId);
    res.json({ advance_balance: data.advance_balance, advances: data.advances });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.post('/clients/:clientId/advance-payment', validateAdvancePaymentBody, asyncHandler(async (req, res) => {
  try {
    assertCanCollectPayment(req.user);
    await assertClientPvAccess(req.user, req.params.clientId, pool);
    const result = await salesService.recordClientAdvancePayment(
      req.params.clientId,
      req.body,
      req.user.id
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.post('/clients/:clientId/bulk-payment', validateBulkPaymentBody, asyncHandler(async (req, res) => {
  try {
    assertCanCollectPayment(req.user);
    await assertClientPvAccess(req.user, req.params.clientId, pool);
    const result = await salesService.recordClientBulkPayment(
      req.params.clientId,
      req.body,
      req.user.id
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.get('/payment-receipts', asyncHandler(async (req, res) => {
  try {
    assertCanCollectPayment(req.user);
    const userPv = resolveDeliveryPointId(req.user, req.query.delivery_point_id);
    if (requiresPvIsolation(req.user) && userPv == null) {
      return res.json({ receipts: [] });
    }
    const filters = mergeSalesFilters(req.user, req.query);
    if (requiresPvIsolation(req.user)) {
      filters.enforced_pv_id = userPv;
    }
    const receipts = await salesService.listPaymentReceipts(filters);
    res.set('Cache-Control', 'no-store');
    res.json({ receipts });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.get('/payment-receipts/bulk/:batchRef', asyncHandler(async (req, res) => {
  try {
    assertCanCollectPayment(req.user);
    const result = await salesService.getBulkPaymentReceipt(req.params.batchRef);
    const cartIds = [...new Set((result.allocations || []).map((a) => a.cart_id).filter(Boolean))];
    for (const cartId of cartIds) {
      const cart = await salesService.getCartById(cartId);
      if (cart) assertCartScope(req.user, cart);
    }
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.get('/payment-receipts/:paymentId', asyncHandler(async (req, res) => {
  try {
    assertCanCollectPayment(req.user);
    const result = await salesService.getSinglePaymentReceipt(req.params.paymentId);
    assertCartScope(req.user, result.cart);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}));

router.get('/product-price/:productId', asyncHandler(async (req, res) => {
  const { sale_type, delivery_point_id } = req.query;
  const pvId = resolveDeliveryPointId(req.user, delivery_point_id);
  const { rows } = pvId != null
    ? await pool.query(
      `SELECT p.wholesale_price, p.retail_price, p.purchase_price
       FROM products p
       WHERE p.id = $1`,
      [req.params.productId]
    )
    : await pool.query(
      'SELECT wholesale_price, retail_price, purchase_price FROM products WHERE id = $1',
      [req.params.productId]
    );
  if (!rows.length) return res.status(404).json({ message: 'Produit introuvable' });
  const p = rows[0];
  const retail = p.retail_price;
  const price = sale_type === 'gros' ? p.wholesale_price : retail;
  res.json({
    unit_price: parseFloat(price || 0),
    retail_price: parseFloat(retail || 0),
    purchase_price: parseFloat(p.purchase_price || 0),
  });
}));

export default router;
