import {
  formatGNF,
  formatGNFForPdf,
  formatDate,
  formatQty,
  paymentModeLabel,
  cartEncaissementStatus,
  cartBalanceDue,
} from './format';

const SETTLEMENT_TYPE_LABELS = {
  avance_client: 'Avance client',
  creance_commerciale: 'Créance commerciale',
  creance_externe: 'Créance externe',
  dette_commerciale: 'Dette commerciale',
  dette_externe: 'Dette externe',
  credit_vente: 'Crédit vente (reste à payer)',
};

export function settlementTypeLabel(value) {
  return SETTLEMENT_TYPE_LABELS[value] || value || 'Règlement';
}

export function resolveDailyReportDate(appliedFilters) {
  const today = new Date().toISOString().slice(0, 10);
  const { date_from: from, date_to: to } = appliedFilters;
  if (from && to && from !== to) {
    return { date: from, multiDay: true };
  }
  return { date: from || to || today, multiDay: false };
}

export function resolveMonthlyReportMonth(appliedFilters) {
  const ref = appliedFilters.date_from || appliedFilters.date_to || new Date().toISOString().slice(0, 10);
  return ref.slice(0, 7);
}

export function formatMonthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  if (!y || !m) return monthStr;
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export function formatPeriodLabel(data) {
  if (!data) return '';
  if (data.period === 'month' && data.month) {
    return formatMonthLabel(data.month);
  }
  if (data.date_from && data.date_to && data.date_from !== data.date_to) {
    return `${formatDate(data.date_from)} — ${formatDate(data.date_to)}`;
  }
  return formatDate(data.date || data.date_from);
}

export const DAILY_SALE_COLUMNS = [
  { key: 'cart_number', label: 'N° Panier' },
  { key: 'time', label: 'Heure' },
  { key: 'client', label: 'Client' },
  { key: 'seller', label: 'Vendeur' },
  { key: 'type', label: 'Type' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'paid', label: 'Encaissé', align: 'right' },
  { key: 'status', label: 'Statut' },
];

export const DAILY_PRODUCT_COLUMNS = [
  { key: 'product_name', label: 'Produit' },
  { key: 'reference', label: 'Référence' },
  { key: 'quantity', label: 'Qté', align: 'right' },
  { key: 'sales_count', label: 'Ventes', align: 'right' },
  { key: 'line_total', label: 'Montant', align: 'right' },
];

export const DAILY_PAYMENT_MODE_COLUMNS = [
  { key: 'mode', label: 'Mode de paiement' },
  { key: 'count', label: 'Nb opérations', align: 'right' },
  { key: 'amount', label: 'Montant', align: 'right' },
];

export const DAILY_ENC_COLUMNS = [
  { key: 'time', label: 'Heure' },
  { key: 'reference', label: 'Référence' },
  { key: 'client', label: 'Client' },
  { key: 'type', label: 'Type' },
  { key: 'mode', label: 'Mode' },
  { key: 'amount', label: 'Montant', align: 'right' },
];

export const DEBTS_CREANCES_COLUMNS = [
  { key: 'time', label: 'Heure' },
  { key: 'number', label: 'N°' },
  { key: 'type', label: 'Type' },
  { key: 'client', label: 'Client' },
  { key: 'reference', label: 'Référence' },
  { key: 'amount', label: 'Montant', align: 'right' },
  { key: 'paid', label: 'Payé', align: 'right' },
  { key: 'balance', label: 'Solde', align: 'right' },
];

function formatTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function buildDailyReportView(data, { showPaymentCols = true, pvLabel = '' } = {}) {
  if (!data) return null;

  const sales = data.sales || {};
  const enc = data.encaissements || {};
  const encSummary = enc.summary || {};
  const dc = data.debts_creances || {};
  const dcSummary = dc.summary || {};
  const isMonth = data.period === 'month';
  const periodLabel = formatPeriodLabel(data);

  const summary = [
    { label: 'Paniers vendus', value: String(sales.cart_count || 0) },
    { label: 'Détail / Gros', value: `${sales.detail_count || 0} / ${sales.gros_count || 0}` },
    { label: 'Lignes', value: formatQty(sales.line_count || 0) },
    { label: isMonth ? 'CA du mois' : 'CA du jour', value: formatGNF(sales.total_amount || 0), emphasis: true },
  ];

  if (showPaymentCols) {
    summary.push(
      { label: 'Encaissé (ventes)', value: formatGNF(encSummary.cart_collected || 0), emphasis: true },
      { label: 'Règlements / avances', value: formatGNF(encSummary.settlement_collected || 0), emphasis: true },
      { label: 'Total encaissé', value: formatGNF(encSummary.total_collected || 0), emphasis: true },
    );
    if ((sales.balance_due || 0) > 0.005) {
      summary.push({ label: 'Reste à payer (ventes)', value: formatGNF(sales.balance_due || 0) });
    }
    if ((dcSummary.dettes_created_count || 0) > 0) {
      summary.push({
        label: isMonth ? 'Dettes enregistrées' : 'Dettes du jour',
        value: `${dcSummary.dettes_created_count} · ${formatGNF(dcSummary.dettes_created_amount || 0)}`,
      });
    }
    if ((dcSummary.creances_created_count || 0) > 0) {
      summary.push({
        label: isMonth ? 'Créances enregistrées' : 'Créances du jour',
        value: `${dcSummary.creances_created_count} · ${formatGNF(dcSummary.creances_created_amount || 0)}`,
      });
    }
    if ((dcSummary.sales_credit_count || 0) > 0) {
      summary.push({
        label: 'Crédit ventes (impayé)',
        value: `${dcSummary.sales_credit_count} · ${formatGNF(dcSummary.sales_credit_amount || 0)}`,
      });
    }
  }

  const filters = [
    { label: 'Période', value: periodLabel },
    ...(pvLabel ? [{ label: 'Point de vente', value: pvLabel }] : []),
  ];

  const saleRows = (data.carts || []).map((c) => {
    const st = cartEncaissementStatus(c);
    return {
      id: c.id,
      cart_number: c.cart_number,
      time: formatTime(c.validated_at || c.created_at),
      client: c.client_name || '—',
      seller: c.seller_name || '—',
      type: c.sale_type === 'gros' ? 'Gros' : 'Détail',
      total: formatGNF(c.total_amount),
      paid: formatGNF(c.amount_paid),
      status: st.label,
    };
  });

  const saleFoot = sales.cart_count
    ? [{
      cells: [
        { value: `Total (${sales.cart_count} panier${sales.cart_count > 1 ? 's' : ''})`, colSpan: 5 },
        { value: formatGNF(sales.total_amount), align: 'right' },
        ...(showPaymentCols ? [{ value: formatGNF(sales.amount_paid), align: 'right' }] : []),
        { value: '' },
      ],
    }]
    : [];

  const productRows = (data.products || []).map((r) => ({
    id: `${r.reference}-${r.product_name}`,
    product_name: r.product_name,
    reference: r.reference || '—',
    quantity: formatQty(r.quantity),
    sales_count: r.sales_count,
    line_total: formatGNF(r.line_total),
  }));

  const productQty = (data.products || []).reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0);
  const productAmount = (data.products || []).reduce((s, r) => s + (parseFloat(r.line_total) || 0), 0);
  const productFoot = productRows.length
    ? [{
      cells: [
        { value: `Top produits (${productRows.length})`, colSpan: 2 },
        { value: formatQty(productQty), align: 'right' },
        { value: '' },
        { value: formatGNF(productAmount), align: 'right' },
      ],
    }]
    : [];

  const modeRows = (enc.payment_modes || []).map((r) => ({
    id: r.payment_mode,
    mode: paymentModeLabel(r.payment_mode),
    count: r.payment_count,
    amount: formatGNF(r.total_amount),
  }));

  const modeFoot = modeRows.length
    ? [{
      cells: [
        { value: 'Total encaissé' },
        { value: String((enc.payment_modes || []).reduce((s, r) => s + (r.payment_count || 0), 0)), align: 'right' },
        { value: formatGNF(encSummary.total_collected || 0), align: 'right' },
      ],
    }]
    : [];

  const encRows = [];
  for (const p of enc.cart_payments || []) {
    encRows.push({
      id: `cp-${p.id}`,
      time: formatTime(p.created_at),
      reference: p.cart_number || '—',
      client: p.client_name || '—',
      type: 'Encaissement vente',
      mode: paymentModeLabel(p.payment_mode),
      amount: formatGNF(p.amount),
    });
  }
  for (const p of enc.settlement_payments || []) {
    encRows.push({
      id: `sp-${p.id}`,
      time: formatTime(p.created_at),
      reference: p.settlement_number || '—',
      client: p.client_name || '—',
      type: settlementTypeLabel(p.settlement_type),
      mode: paymentModeLabel(p.payment_mode),
      amount: formatGNF(p.amount),
    });
  }
  encRows.sort((a, b) => (a.time > b.time ? 1 : -1));

  const encFoot = encRows.length
    ? [{
      cells: [
        { value: `Total (${encRows.length} opération${encRows.length > 1 ? 's' : ''})`, colSpan: 5 },
        { value: formatGNF(encSummary.total_collected || 0), align: 'right' },
      ],
    }]
    : [];

  const debtsRows = (dc.created || []).map((s) => ({
    id: `s-${s.id}`,
    time: formatTime(s.created_at),
    number: s.settlement_number || '—',
    type: settlementTypeLabel(s.settlement_type),
    client: s.client_name || '—',
    reference: s.sale_cart_number || '—',
    amount: formatGNF(s.amount),
    paid: formatGNF(s.amount_paid),
    balance: formatGNF(s.balance),
  }));

  const salesCreditRows = (dc.sales_credits || []).map((c) => ({
    id: `sc-${c.cart_id}`,
    time: formatTime(c.validated_at),
    number: c.cart_number || '—',
    type: settlementTypeLabel('credit_vente'),
    client: c.client_name || '—',
    reference: c.cart_number || '—',
    amount: formatGNF(c.total_amount),
    paid: formatGNF(c.amount_paid),
    balance: formatGNF(c.balance_due),
  }));

  const allDebtsCreancesRows = [...debtsRows, ...salesCreditRows];

  const debtsFoot = allDebtsCreancesRows.length
    ? [{
      cells: [
        { value: `Total (${allDebtsCreancesRows.length})`, colSpan: 5 },
        { value: formatGNF(
          (dc.created || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
            + (dc.sales_credits || []).reduce((s, r) => s + (parseFloat(r.total_amount) || 0), 0)
        ), align: 'right' },
        { value: formatGNF(
          (dc.created || []).reduce((s, r) => s + (parseFloat(r.amount_paid) || 0), 0)
            + (dc.sales_credits || []).reduce((s, r) => s + (parseFloat(r.amount_paid) || 0), 0)
        ), align: 'right' },
        { value: formatGNF(
          (dc.created || []).reduce((s, r) => s + (parseFloat(r.balance) || 0), 0)
            + (dc.sales_credits || []).reduce((s, r) => s + (parseFloat(r.balance_due) || 0), 0)
        ), align: 'right' },
      ],
    }]
    : [];

  const reportKind = isMonth ? 'mensuel' : 'journalier';
  const reportDateKey = data.month || data.date || data.date_from;

  return {
    date: reportDateKey,
    period: data.period || 'day',
    title: `Rapport ${reportKind} — ${periodLabel}`,
    subtitle: 'Ventes, encaissements, dettes et créances BESTO SHOP',
    filters,
    summary,
    saleRows,
    saleFoot,
    productRows,
    productFoot,
    modeRows,
    modeFoot,
    encRows,
    encFoot,
    debtsRows: allDebtsCreancesRows,
    debtsFoot,
    showPaymentCols,
  };
}

export function buildDailyReportPdfSections(view, data) {
  if (!view || !data) return [];
  const sales = data.sales || {};
  const encSummary = data.encaissements?.summary || {};
  const saleCols = DAILY_SALE_COLUMNS.filter((c) => view.showPaymentCols || c.key !== 'paid');
  const salesTitle = data.period === 'month' ? 'Ventes du mois' : 'Ventes du jour';

  const sections = [
    {
      title: salesTitle,
      subtitle: 'Paniers validés à la caisse',
      head: saleCols.map((c) => c.label),
      body: view.saleRows.map((r) => saleCols.map((c) => {
        if (c.key === 'total' || c.key === 'paid') {
          const cart = (data.carts || []).find((x) => x.id === r.id);
          const raw = c.key === 'total' ? cart?.total_amount : cart?.amount_paid;
          return formatGNFForPdf(raw);
        }
        return r[c.key];
      })),
      foot: sales.cart_count
        ? [[
          `Total (${sales.cart_count})`,
          '', '', '', '',
          formatGNFForPdf(sales.total_amount),
          ...(view.showPaymentCols ? [formatGNFForPdf(sales.amount_paid)] : []),
          '',
        ]]
        : [],
      rightAlignCols: view.showPaymentCols ? [5, 6] : [5],
    },
  ];

  if (view.productRows.length) {
    const productQty = (data.products || []).reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0);
    const productAmount = (data.products || []).reduce((s, r) => s + (parseFloat(r.line_total) || 0), 0);
    sections.push({
      title: 'Top produits',
      head: DAILY_PRODUCT_COLUMNS.map((c) => c.label),
      body: view.productRows.map((r) => DAILY_PRODUCT_COLUMNS.map((c) => (
        c.key === 'line_total' ? formatGNFForPdf(
          (data.products || []).find((p) => `${p.reference}-${p.product_name}` === r.id)?.line_total
        ) : r[c.key]
      ))),
      foot: [[`Top produits (${view.productRows.length})`, '', formatQty(productQty), '', formatGNFForPdf(productAmount)]],
      rightAlignCols: [2, 3, 4],
    });
  }

  if (view.showPaymentCols && view.modeRows.length) {
    sections.push({
      title: 'Encaissements par mode de paiement',
      head: DAILY_PAYMENT_MODE_COLUMNS.map((c) => c.label),
      body: (data.encaissements?.payment_modes || []).map((r) => [
        paymentModeLabel(r.payment_mode),
        String(r.payment_count),
        formatGNFForPdf(r.total_amount),
      ]),
      foot: [[
        'Total encaissé',
        String((data.encaissements?.payment_modes || []).reduce((s, r) => s + (r.payment_count || 0), 0)),
        formatGNFForPdf(encSummary.total_collected || 0),
      ]],
      rightAlignCols: [1, 2],
    });
  }

  if (view.showPaymentCols && view.encRows.length) {
    sections.push({
      title: 'Détail des encaissements',
      head: DAILY_ENC_COLUMNS.map((c) => c.label),
      body: view.encRows.map((r) => {
        const isCart = String(r.id).startsWith('cp-');
        const rawId = parseInt(String(r.id).split('-')[1], 10);
        const raw = isCart
          ? (data.encaissements?.cart_payments || []).find((p) => p.id === rawId)?.amount
          : (data.encaissements?.settlement_payments || []).find((p) => p.id === rawId)?.amount;
        return [
          r.time,
          r.reference,
          r.client,
          r.type,
          r.mode,
          formatGNFForPdf(raw),
        ];
      }),
      foot: [[
        `Total (${view.encRows.length})`,
        '', '', '', '',
        formatGNFForPdf(encSummary.total_collected || 0),
      ]],
      rightAlignCols: [5],
    });
  }

  if (view.showPaymentCols && view.debtsRows?.length) {
    const dc = data.debts_creances || {};
    sections.push({
      title: data.period === 'month' ? 'Dettes et créances du mois' : 'Dettes et créances du jour',
      head: DEBTS_CREANCES_COLUMNS.map((c) => c.label),
      body: view.debtsRows.map((r) => {
        const isSettlement = String(r.id).startsWith('s-');
        const rawId = parseInt(String(r.id).split('-')[1], 10);
        const raw = isSettlement
          ? (dc.created || []).find((p) => p.id === rawId)
          : (dc.sales_credits || []).find((p) => p.cart_id === rawId);
        return [
          r.time,
          r.number,
          r.type,
          r.client,
          r.reference,
          formatGNFForPdf(raw?.amount ?? raw?.total_amount),
          formatGNFForPdf(raw?.amount_paid),
          formatGNFForPdf(raw?.balance ?? raw?.balance_due),
        ];
      }),
      foot: [[
        `Total (${view.debtsRows.length})`,
        '', '', '', '',
        formatGNFForPdf(
          (dc.created || []).reduce((s, row) => s + (parseFloat(row.amount) || 0), 0)
            + (dc.sales_credits || []).reduce((s, row) => s + (parseFloat(row.total_amount) || 0), 0)
        ),
        formatGNFForPdf(
          (dc.created || []).reduce((s, row) => s + (parseFloat(row.amount_paid) || 0), 0)
            + (dc.sales_credits || []).reduce((s, row) => s + (parseFloat(row.amount_paid) || 0), 0)
        ),
        formatGNFForPdf(
          (dc.created || []).reduce((s, row) => s + (parseFloat(row.balance) || 0), 0)
            + (dc.sales_credits || []).reduce((s, row) => s + (parseFloat(row.balance_due) || 0), 0)
        ),
      ]],
      rightAlignCols: [5, 6, 7],
    });
  }

  return sections;
}

export function downloadDailyReportCsv(view) {
  if (!view) return;
  const lines = [];
  const pushSection = (title, headers, rows) => {
    lines.push(title);
    lines.push(headers.join(';'));
    for (const row of rows) lines.push(row.join(';'));
    lines.push('');
  };

  const saleCols = DAILY_SALE_COLUMNS.filter((c) => view.showPaymentCols || c.key !== 'paid');
  pushSection(
    'Ventes du jour',
    saleCols.map((c) => c.label),
    view.saleRows.map((r) => saleCols.map((c) => String(r[c.key] ?? '').replace(/;/g, ','))),
  );

  if (view.productRows.length) {
    pushSection(
      'Top produits',
      DAILY_PRODUCT_COLUMNS.map((c) => c.label),
      view.productRows.map((r) => DAILY_PRODUCT_COLUMNS.map((c) => String(r[c.key] ?? '').replace(/;/g, ','))),
    );
  }

  if (view.showPaymentCols && view.modeRows.length) {
    pushSection(
      'Encaissements par mode',
      DAILY_PAYMENT_MODE_COLUMNS.map((c) => c.label),
      view.modeRows.map((r) => DAILY_PAYMENT_MODE_COLUMNS.map((c) => String(r[c.key] ?? '').replace(/;/g, ','))),
    );
  }

  if (view.showPaymentCols && view.encRows.length) {
    pushSection(
      'Détail encaissements',
      DAILY_ENC_COLUMNS.map((c) => c.label),
      view.encRows.map((r) => DAILY_ENC_COLUMNS.map((c) => String(r[c.key] ?? '').replace(/;/g, ','))),
    );
  }

  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rapport-journalier-${view.date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
