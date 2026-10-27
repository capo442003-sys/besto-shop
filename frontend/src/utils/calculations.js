import { cartBalanceDue } from './format';

/** Montant signé d'une opération de caisse (dépense = négatif). */
export function signedCashAmount(tx) {
  const amt = parseFloat(tx?.amount) || 0;
  return tx?.transaction_type === 'depense' ? -amt : amt;
}

/** Totaux recettes / dépenses / solde net sur un journal de caisse. */
export function sumCashTransactions(transactions = []) {
  let recettes = 0;
  let depenses = 0;
  for (const t of transactions) {
    const amt = parseFloat(t.amount) || 0;
    if (t.transaction_type === 'depense') depenses += amt;
    else recettes += amt;
  }
  return { recettes, depenses, net: recettes - depenses };
}

/** Ventes annulées — exclues des totaux */
export function isExcludedVoidedCashTx(tx) {
  if (tx?.reference_type === 'sales_cart_void') return true;
  if (tx?.reference_type === 'sales_cart' && tx?.cart_status === 'annule') return true;
  return false;
}

/** Ventilation manuel / ventes / annulations pour l'historique caisse */
export function sumCashTransactionsBreakdown(transactions = []) {
  const active = transactions.filter((t) => !isExcludedVoidedCashTx(t));
  const out = {
    manual_recettes: 0,
    manual_depenses: 0,
    sales_collected: 0,
    sales_voided: 0,
    bc_collected: 0,
    recettes: 0,
    depenses: 0,
    net: 0,
    count: active.length,
  };
  for (const t of active) {
    const amt = parseFloat(t.amount) || 0;
    const rt = t.reference_type;
    const tt = t.transaction_type;
    if (tt === 'depense') {
      out.depenses += amt;
      if (rt === 'sales_cart_void') out.sales_voided += amt;
      else if (!rt) out.manual_depenses += amt;
    } else {
      out.recettes += amt;
      if (rt === 'sales_cart') out.sales_collected += amt;
      else if (rt === 'purchase_order') out.bc_collected += amt;
      else if (!rt) out.manual_recettes += amt;
    }
  }
  out.net = out.recettes - out.depenses;
  return out;
}

/** Somme financière paniers (ligne par ligne pour le reste à payer). */
export function sumCartsFinancials(carts = []) {
  return {
    count: carts.length,
    lines: carts.reduce((s, c) => s + (parseInt(c.line_count, 10) || 0), 0),
    total: carts.reduce((s, c) => s + parseFloat(c.total_amount || 0), 0),
    paid: carts.reduce((s, c) => s + parseFloat(c.amount_paid || 0), 0),
    due: carts.reduce((s, c) => s + cartBalanceDue(c), 0),
  };
}

/** Convertit le résumé SQL API paniers en totaux frontend. */
export function totalsFromCartApiSummary(summary) {
  if (!summary) return null;
  return {
    count: summary.cart_count || 0,
    lines: summary.line_count || 0,
    total: parseFloat(summary.total_amount || 0),
    paid: parseFloat(summary.amount_paid || 0),
    due: parseFloat(summary.balance_due || 0),
  };
}

export function mergeCartApiSummaries(a, b) {
  const x = totalsFromCartApiSummary(a) || { count: 0, lines: 0, total: 0, paid: 0, due: 0 };
  const y = totalsFromCartApiSummary(b) || { count: 0, lines: 0, total: 0, paid: 0, due: 0 };
  return {
    count: x.count + y.count,
    lines: x.lines + y.lines,
    total: x.total + y.total,
    paid: x.paid + y.paid,
    due: x.due + y.due,
  };
}

export function parseCartsApiResponse(data) {
  if (Array.isArray(data)) {
    return { carts: data, summary: null, truncated: false };
  }
  return {
    carts: Array.isArray(data?.carts) ? data.carts : [],
    summary: data?.summary ?? null,
    truncated: Boolean(data?.truncated),
  };
}

export function parseProductsApiResponse(data) {
  if (Array.isArray(data)) {
    return { items: data, summary: null };
  }
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    summary: data?.summary ?? null,
  };
}

export function parseChargesApiResponse(data) {
  if (Array.isArray(data)) {
    return { items: data, summary: null };
  }
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    summary: data?.summary ?? null,
  };
}

/** Extrait un tableau depuis une réponse API (tableau brut ou { items }). */
export function extractApiItems(data) {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.items) ? data.items : [];
}
