import {
  formatGNF,
  formatDate,
  formatDateOnly,
  formatQty,
  formatGNFForPdf,
  formatDateForPdf,
  paymentModeLabel,
  saleTypeLabel,
  cartStatusLabel,
  clientTypeLabel,
} from './format';
import { balanceDueGnf, isFullyPaidGnf, roundGnf } from './money';

const INVOICE_COLS = [
  { key: 'num', label: 'N°', align: 'center' },
  { key: 'reference', label: 'Réf.' },
  { key: 'productName', label: 'Nom produit' },
  { key: 'unitPrice', label: 'P.U.', align: 'right' },
  { key: 'quantity', label: 'Qté', align: 'right' },
  { key: 'discount', label: 'Remise', align: 'right' },
  { key: 'lineTotal', label: 'Total', align: 'right' },
];

const INVOICE_TABLE_HEAD_PDF = [
  'N°',
  'Reference',
  'Nom produit',
  'P.U.',
  'Qte',
  'Remise',
  'Total',
];

const PO_COLUMNS = [
  { key: 'num', label: 'N°' },
  { key: 'reference', label: 'Référence' },
  { key: 'designation', label: 'Désignation' },
  { key: 'quantity', label: 'Quantité', align: 'right' },
  { key: 'unitPrice', label: 'Prix Unitaire', align: 'right' },
  { key: 'lineTotal', label: 'Coût Total', align: 'right' },
];

function lineRef(l) {
  return l.product_reference || l.reference || '—';
}

function isPlaceholderProductName(name) {
  const n = String(name || '').trim().toUpperCase();
  return !n || ['SOLDE', 'SOLDE A PAYER', 'RESTE'].includes(n);
}

function lineProductName(l) {
  const snapshot = String(l.product_name_snapshot || '').trim();
  const current = String(l.product_name || '').trim();
  if (snapshot && !isPlaceholderProductName(snapshot)) return snapshot;
  if (current && !isPlaceholderProductName(current)) return current;
  if (snapshot) return snapshot;
  if (current) return current;
  return '—';
}

function mapInvoiceLines(lines = []) {
  return lines.map((l, i) => ({
    id: l.id,
    num: String(i + 1),
    reference: lineRef(l),
    productName: lineProductName(l),
    unitPrice: formatGNF(l.unit_price),
    quantity: formatQty(l.quantity),
    discount: formatGNF(l.discount || 0),
    lineTotal: formatGNF(l.line_total),
  }));
}

function mapInvoiceLinesPdf(lines = []) {
  return lines.map((l, i) => [
    String(i + 1),
    lineRef(l).replace('—', '-'),
    lineProductName(l),
    formatGNFForPdf(l.unit_price),
    formatQty(l.quantity),
    formatGNFForPdf(l.discount || 0),
    formatGNFForPdf(l.line_total),
  ]);
}

function buildStore(detail) {
  return {
    store_name: detail.store_name,
    address: detail.store_address,
    phone: detail.store_phone,
    phone_2: detail.store_phone_2,
    phone_3: detail.store_phone_3,
    email: detail.store_email || detail.email,
    logo_url: detail.store_logo_url || detail.logo_url || null,
    updated_at: detail.store_updated_at || detail.updated_at || null,
  };
}

function invoiceTotals(total, paid) {
  const sum = roundGnf(total);
  const paidAmt = roundGnf(paid);
  const rest = balanceDueGnf(sum, paidAmt);
  const paidLabel = isFullyPaidGnf(sum, paidAmt) ? 'Montant payé' : 'Montant avancé';
  return [
    { label: 'Somme Totale', value: formatGNF(sum) },
    { label: paidLabel, value: formatGNF(paidAmt) },
    { label: 'Reste à payer', value: formatGNF(rest) },
  ];
}

function invoiceTotalsPdf(total, paid) {
  const sum = roundGnf(total);
  const paidAmt = roundGnf(paid);
  const rest = balanceDueGnf(sum, paidAmt);
  const paidLabel = isFullyPaidGnf(sum, paidAmt) ? 'Montant paye' : 'Montant Avance';
  return [
    { label: 'Somme Totale', value: formatGNFForPdf(sum) },
    { label: paidLabel, value: formatGNFForPdf(paidAmt) },
    { label: 'Reste a Payer', value: formatGNFForPdf(rest) },
  ];
}

export function buildProformaDocument(detail) {
  const store = buildStore(detail);
  const issuedAt = detail.validated_at || detail.issued_at;
  const paid = detail.amount_paid ?? 0;
  const paymentList = detail.payments || [];

  return {
    store,
    docTitle: 'Facture Client',
    docDateTime: formatDate(issuedAt),
    invoiceNumber: detail.invoice_number,
    invoiceDate: formatDateOnly(issuedAt),
    sellerName: detail.seller_name,
    clientName: detail.client_name,
    clientCode: detail.client_code,
    clientAddress: detail.client_address,
    clientPhone: detail.client_contact,
    clientType: detail.client_type,
    qrValue: detail.invoice_number,
    columns: INVOICE_COLS,
    lines: mapInvoiceLines(detail.lines),
    totals: invoiceTotals(detail.total_amount, paid),
    listTitle: paymentList.length ? 'Versements enregistrés' : null,
    listItems: paymentList.map(
      (p) => `${formatGNF(p.amount)} — ${paymentModeLabel(p.payment_mode)} — ${formatDate(p.created_at)}`
    ),
    footerNotes: ['Merci pour votre confiance'],
    pdf: {
      title: 'Facture Client',
      invoiceNumber: detail.invoice_number,
      invoiceDate: formatDateForPdf(issuedAt),
      sellerName: detail.seller_name,
      clientName: detail.client_name || '-',
      clientCode: detail.client_code,
      clientAddress: detail.client_address,
      clientPhone: detail.client_contact,
      clientType: detail.client_type ? clientTypeLabel(detail.client_type) : '',
      qrValue: detail.invoice_number,
      tableHead: INVOICE_TABLE_HEAD_PDF,
      tableBody: mapInvoiceLinesPdf(detail.lines),
      totals: invoiceTotalsPdf(detail.total_amount, paid),
      listTitle: paymentList.length ? 'Versements enregistres' : null,
      listItems: paymentList.map(
        (p) => `${formatGNFForPdf(p.amount)} - ${paymentModeLabel(p.payment_mode)} - ${formatDateForPdf(p.created_at)}`
      ),
      footer: ['Merci pour votre confiance'],
      filename: `facture-${detail.invoice_number}.pdf`,
    },
  };
}

export function buildTicketDocument({ cart, store, payments = [] }) {
  const paymentList = payments.length ? payments : (cart.payments || []);
  const issuedAt = cart.validated_at || cart.created_at;

  return {
    store,
    docTitle: 'Facture Client',
    docDateTime: formatDate(issuedAt),
    invoiceNumber: cart.cart_number,
    invoiceDate: formatDateOnly(issuedAt),
    sellerName: cart.seller_name,
    clientName: cart.client_name,
    clientCode: cart.client_code,
    clientAddress: cart.client_address,
    clientPhone: cart.client_contact,
    clientType: cart.client_type,
    qrValue: cart.cart_number,
    columns: INVOICE_COLS,
    lines: mapInvoiceLines(cart.lines),
    totals: invoiceTotals(cart.total_amount, cart.amount_paid),
    listTitle: paymentList.length ? 'Versements enregistrés' : null,
    listItems: paymentList.map(
      (p) => `${formatGNF(p.amount)} — ${paymentModeLabel(p.payment_mode)} — ${formatDate(p.created_at)}`
    ),
    footerNotes: ['Merci pour votre confiance'],
    pdf: {
      title: 'Facture Client',
      invoiceNumber: cart.cart_number,
      invoiceDate: formatDateForPdf(issuedAt),
      sellerName: cart.seller_name,
      clientName: cart.client_name || '-',
      clientCode: cart.client_code,
      clientAddress: cart.client_address,
      clientPhone: cart.client_contact,
      clientType: cart.client_type ? clientTypeLabel(cart.client_type) : '',
      qrValue: cart.cart_number,
      tableHead: INVOICE_TABLE_HEAD_PDF,
      tableBody: mapInvoiceLinesPdf(cart.lines),
      totals: invoiceTotalsPdf(cart.total_amount, cart.amount_paid),
      listTitle: 'Versements enregistres',
      listItems: paymentList.map(
        (p) => `${formatGNFForPdf(p.amount)} - ${paymentModeLabel(p.payment_mode)} - ${formatDateForPdf(p.created_at)}`
      ),
      footer: ['Merci pour votre confiance'],
      filename: `facture-${cart.cart_number}.pdf`,
    },
  };
}

export function buildReceiptDocument({ cart, payment, store }) {
  const paidAt = payment.created_at || new Date();

  return {
    store,
    docTitle: 'Reçu d\'encaissement',
    docDateTime: formatDate(paidAt),
    invoiceNumber: cart.cart_number,
    invoiceDate: formatDateOnly(paidAt),
    sellerName: cart.seller_name,
    clientName: cart.client_name,
    clientCode: cart.client_code,
    clientAddress: cart.client_address,
    clientPhone: cart.client_contact,
    clientType: cart.client_type,
    qrValue: `${cart.cart_number}-${payment.id || Date.now()}`,
    highlight: {
      label: 'Montant versé',
      value: formatGNF(payment.amount),
      detail: `Mode : ${paymentModeLabel(payment.payment_mode)}`,
    },
    totals: invoiceTotals(cart.total_amount, cart.amount_paid),
    footerNotes: [
      `Reçu émis le ${formatDate(paidAt)} — BESTO SHOP`,
    ],
    pdf: {
      title: 'Recu d\'encaissement',
      invoiceNumber: cart.cart_number,
      invoiceDate: formatDateForPdf(paidAt),
      sellerName: cart.seller_name,
      clientName: cart.client_name || '-',
      clientCode: cart.client_code,
      clientAddress: cart.client_address,
      clientPhone: cart.client_contact,
      clientType: cart.client_type ? clientTypeLabel(cart.client_type) : '',
      qrValue: `${cart.cart_number}-${payment.id || 'versement'}`,
      highlight: {
        label: 'Montant verse',
        value: formatGNFForPdf(payment.amount),
        detail: `Mode : ${paymentModeLabel(payment.payment_mode)}`,
      },
      totals: invoiceTotalsPdf(cart.total_amount, cart.amount_paid),
      footer: [`Recu emis le ${formatDateForPdf(paidAt)} — BESTO SHOP`],
      filename: `recu-${cart.cart_number}-${Date.now()}.pdf`,
    },
  };
}

export function buildBulkReceiptDocument({ result, store }) {
  const paidAt = result.paid_at || new Date();
  const client = result.client || {};
  const allocations = result.allocations || [];
  const listItems = allocations.map(
    (a) => `${a.cart_number} : ${formatGNFForPdf(a.amount)} (reste ${formatGNFForPdf(a.balance_after)})`
  );

  return {
    store,
    docTitle: 'Reçu d\'encaissement global',
    docDateTime: formatDate(paidAt),
    invoiceNumber: result.batch_ref,
    invoiceDate: formatDateOnly(paidAt),
    clientName: client.name,
    clientCode: client.code,
    clientAddress: client.address,
    clientPhone: client.contact,
    clientType: client.client_type,
    qrValue: result.batch_ref,
    highlight: {
      label: 'Montant total encaissé',
      value: formatGNF(result.amount_paid),
      detail: `Mode : ${paymentModeLabel(result.payment_mode)} — ${allocations.length} panier(s)`,
    },
    listTitle: 'Paniers réglés',
    listItems: allocations.map(
      (a) => `${a.cart_number} — ${formatGNF(a.amount)}${a.balance_after > 0.005 ? ` (reste ${formatGNF(a.balance_after)})` : ' (soldé)'}`
    ),
    totals: [
      { label: 'Dette avant encaissement', value: formatGNF(result.total_due_before) },
      { label: 'Montant encaissé', value: formatGNF(result.amount_paid), emphasis: true },
      { label: 'Reste à payer', value: formatGNF(result.balance_due_after), emphasis: true },
    ],
    footerNotes: [
      `Reçu ${result.batch_ref} — ${allocations.length} panier(s) traité(s)`,
      `Émis le ${formatDate(paidAt)} — BESTO SHOP`,
    ],
    pdf: {
      title: 'Recu encaissement global',
      invoiceNumber: result.batch_ref,
      invoiceDate: formatDateForPdf(paidAt),
      clientName: client.name || '-',
      clientCode: client.code,
      clientAddress: client.address,
      clientPhone: client.contact,
      clientType: client.client_type ? clientTypeLabel(client.client_type) : '',
      qrValue: result.batch_ref,
      highlight: {
        label: 'Montant total encaisse',
        value: formatGNFForPdf(result.amount_paid),
        detail: `Mode : ${paymentModeLabel(result.payment_mode)} — ${allocations.length} panier(s)`,
      },
      listTitle: 'Paniers regles',
      listItems,
      totals: [
        { label: 'Dette avant', value: formatGNFForPdf(result.total_due_before) },
        { label: 'Encaisse', value: formatGNFForPdf(result.amount_paid) },
        { label: 'Reste', value: formatGNFForPdf(result.balance_due_after) },
      ],
      footer: [`Recu ${result.batch_ref} — BESTO SHOP`],
      filename: `recu-global-${result.batch_ref}.pdf`,
    },
  };
}

function poStatusLabel(status) {
  if (status === 'finalise') return 'Validé';
  if (status === 'en_cours') return 'En cours';
  return status || '—';
}

function mapPoLines(lines = []) {
  return (lines || []).map((l, i) => ({
    id: l.id,
    num: String(i + 1).padStart(2, '0'),
    reference: l.product_reference || '—',
    designation: l.description || l.product_name || '—',
    quantity: formatQty(l.quantity),
    unitPrice: formatGNF(l.unit_price),
    lineTotal: formatGNF(l.line_total),
  }));
}

function mapPoLinesPdf(lines = []) {
  return (lines || []).map((l, i) => [
    String(i + 1).padStart(2, '0'),
    (l.product_reference || '—').replace('—', '-'),
    (l.description || l.product_name || '—'),
    formatQty(l.quantity),
    formatGNFForPdf(l.unit_price),
    formatGNFForPdf(l.line_total),
  ]);
}

export function buildPurchaseOrderDocument(order, store = {}) {
  const orderDate = order.finalized_at || order.created_at;

  return {
    store,
    docTitle: 'Bon de commande',
    docDateTime: formatDate(orderDate),
    invoiceNumber: order.order_number,
    invoiceDate: formatDateOnly(orderDate),
    sellerName: null,
    clientName: order.client_name,
    clientCode: order.client_code,
    clientAddress: order.client_address,
    clientPhone: order.client_contact,
    qrValue: order.order_number,
    columns: PO_COLUMNS,
    lines: mapPoLines(order.lines),
    totals: invoiceTotals(order.total_amount, order.amount_paid),
    listTitle: order.notes ? 'Observations' : null,
    listItems: order.notes ? [order.notes] : [],
    footerNotes: [
      `Statut : ${poStatusLabel(order.status)}`,
      'Merci de mentionner le numéro de bon sur toute correspondance',
    ],
    pdf: {
      title: 'Bon de commande',
      invoiceNumber: order.order_number,
      invoiceDate: formatDateForPdf(orderDate),
      clientName: order.client_name || '-',
      clientCode: order.client_code,
      clientAddress: order.client_address,
      clientPhone: order.client_contact,
      qrValue: order.order_number,
      tableHead: ['N°', 'Reference', 'Designation', 'Quantite', 'Prix Unitaire', 'Cout Total'],
      tableBody: mapPoLinesPdf(order.lines),
      totals: invoiceTotalsPdf(order.total_amount, order.amount_paid),
      listTitle: order.notes ? 'Observations' : null,
      listItems: order.notes ? [order.notes] : [],
      filename: `bon-commande-${order.order_number}.pdf`,
    },
  };
}
