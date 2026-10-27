import { balanceDueGnf } from './money.js';

export function formatGNF(amount) {
  const n = parseFloat(amount) || 0;
  return new Intl.NumberFormat('fr-GN', { style: 'decimal', maximumFractionDigits: 0 }).format(n) + ' GNF';
}

/** Montants pour jsPDF (police Helvetica — pas d'espaces Unicode) */
export function formatGNFForPdf(amount) {
  const n = Math.round(parseFloat(amount) || 0);
  const num = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${num} GNF`;
}

/** Texte compatible jsPDF (Latin-1, espaces ASCII) */
export function pdfText(value) {
  if (value == null || value === '') return '';
  return String(value)
    .replace(/\u202f/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x00-\xFF]/g, (ch) => ({
      é: 'e', è: 'e', ê: 'e', ë: 'e',
      à: 'a', â: 'a', ä: 'a',
      ù: 'u', û: 'u', ü: 'u',
      ô: 'o', ö: 'o',
      î: 'i', ï: 'i',
      ç: 'c',
      É: 'E', È: 'E', À: 'A', Ç: 'C',
      '•': '-',
    }[ch] || '?'));
}

export function formatDateForPdf(d) {
  if (!d) return '-';
  const dt = new Date(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/** Quantités stock — évite l'affichage "50.000" confondu avec 50 000 */
export function formatQty(value) {
  const v = parseFloat(value);
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v - Math.round(v)) < 0.0001) return String(Math.round(v));
  return v.toFixed(3).replace(/\.?0+$/, '');
}

export function parseNumberInput(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const s = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Date seule (planning, embauche…) — évite l'affichage ISO brut */
export function formatDateOnly(d) {
  if (!d) return '—';
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Heure HH:MM depuis TIME PostgreSQL ou ISO */
export function formatTimeOnly(t) {
  if (!t) return '—';
  const s = String(t);
  const m = s.match(/(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  return s;
}

export const SALE_TYPES = [
  { value: 'gros', label: 'Vente en gros' },
  { value: 'detail', label: 'Vente en Détail' },
];

export const PAYMENT_MODES = [
  { value: 'especes', label: 'Espèces' },
  { value: 'paiement_mobile', label: 'Paiement Mobile' },
  { value: 'virement', label: 'Virement' },
  { value: 'cheque', label: 'Chèque' },
];

export const CLIENT_TYPES = [
  { value: 'particulier', label: 'Particulier' },
  { value: 'entreprise', label: 'Entreprise' },
  { value: 'etat', label: 'État' },
];

export const CART_STATUS_LABELS = {
  en_cours: 'En cours',
  en_attente: 'En attente',
  finalise: 'Finalisé',
  annule: 'Annulé',
};

export const SETTLEMENT_STATUS_LABELS = {
  en_cours: 'En cours',
  solde: 'Soldé',
};

export function lookupLabel(options, value, fallback = '—') {
  if (value == null || value === '') return fallback;
  return options.find((o) => o.value === value)?.label ?? String(value);
}

export function paymentModeLabel(value) {
  return lookupLabel(PAYMENT_MODES, value, value || '—');
}

export function saleTypeLabel(value) {
  return lookupLabel(SALE_TYPES, value, value || '—');
}

export function clientTypeLabel(value) {
  return lookupLabel(CLIENT_TYPES, value, value || '—');
}

export function cartStatusLabel(value) {
  return CART_STATUS_LABELS[value] || value || '—';
}

const CASH_REFERENCE_LABELS = {
  sales_cart: 'Vente',
  purchase_order: 'Bon de commande',
  sales_cart_void: 'Annulation vente',
};

/** Libellé français du document lié à une opération de caisse */
export function cashReferenceLabel(referenceType) {
  if (!referenceType) return '';
  return CASH_REFERENCE_LABELS[referenceType]
    || referenceType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Type affiché d'une ligne de caisse (distingue manuel / vente / annulation) */
export function cashTransactionTypeLabel(tx) {
  const rt = tx?.reference_type;
  const tt = tx?.transaction_type;
  if (tt === 'recette' && rt === 'sales_cart') return 'Encaissement vente';
  if (tt === 'recette' && rt === 'purchase_order') return 'Encaissement BC';
  if (tt === 'depense' && rt === 'sales_cart_void') return 'Annulation vente';
  if (tt === 'recette' && !rt) return 'Recette manuelle';
  if (tt === 'depense' && !rt) return 'Dépense manuelle';
  if (tt === 'recette') return 'Recette';
  if (tt === 'depense') return 'Dépense';
  return '—';
}

/** true si saisie manuelle en caisse (hors ventes / BC / annulations) */
export function isManualCashTransaction(tx) {
  return !tx?.reference_type;
}

/** Texte complet « Vente (BESTO-…) » pour une transaction de caisse */
export function formatCashReference(tx) {
  if (!tx?.reference_type) return '';
  const label = cashReferenceLabel(tx.reference_type);
  const num = tx.reference_number;
  if (num) return `${label} (${num})`;
  if (tx.reference_id) return `${label} n°${tx.reference_id}`;
  return label;
}

/** Reste à payer sur un panier (jamais négatif — monnaie rendue exclue du reste) */
export function cartBalanceDue(cart) {
  return balanceDueGnf(cart?.total_amount, cart?.amount_paid);
}

/** Statut affiché dans Règlement / encaissement (tient compte du reste à payer) */
export function cartEncaissementStatus(cart) {
  const reste = cartBalanceDue(cart);

  if (cart?.status === 'en_cours') {
    if (reste > 0) return { label: 'À encaisser', badge: 'en-cours' };
    return { label: 'Soldé — à finaliser', badge: 'en-cours' };
  }
  if (cart?.status === 'finalise') {
    if (reste > 0) return { label: 'À encaisser', badge: 'credit' };
    return { label: 'Soldé', badge: 'finalise' };
  }
  return { label: cartStatusLabel(cart?.status), badge: 'secondary' };
}

/** Reste à payer sur un bon de commande */
export function purchaseOrderReste(order) {
  if (order?.balance_due != null) return parseFloat(order.balance_due);
  const total = parseFloat(order?.total_amount || 0);
  const paid = parseFloat(order?.amount_paid || 0);
  return Math.max(0, total - paid);
}

/** Statut affiché pour les bons de commande (tient compte de l'encaissement) */
export function purchaseOrderEncaissementStatus(order) {
  const reste = purchaseOrderReste(order);
  const total = parseFloat(order?.total_amount || 0);
  const hasAmount = total > 0.005;

  if (order?.status === 'annule') {
    return { label: 'Annulé', badge: 'secondary' };
  }
  if (order?.status === 'en_cours') {
    if (hasAmount && reste > 0.005) return { label: 'À encaisser', badge: 'credit' };
    if (hasAmount && reste <= 0.005) return { label: 'Soldé — à finaliser', badge: 'en-cours' };
    return { label: 'En cours', badge: 'en-cours' };
  }
  if (order?.status === 'finalise') {
    if (reste > 0.005) return { label: 'À encaisser', badge: 'credit' };
    return { label: 'Soldé', badge: 'finalise' };
  }
  return { label: order?.status || '—', badge: 'secondary' };
}

export function settlementStatusLabel(value) {
  return SETTLEMENT_STATUS_LABELS[value] || value || '—';
}

export const EMPLOYEE_FUNCTIONS = [
  { value: 'vendeur', label: 'Vendeur' },
  { value: 'caissier', label: 'Caissier' },
  { value: 'vendeur_caissier', label: 'Vendeur & Caissier' },
  { value: 'controleur', label: 'Contrôleur' },
  { value: 'gestionnaire', label: 'Gestionnaire' },
  { value: 'comptable', label: 'Comptable' },
  { value: 'assistant', label: 'Assistant' },
  { value: 'dg', label: 'DG (Directeur général)' },
];

export function employeeFunctionLabel(value) {
  return lookupLabel(EMPLOYEE_FUNCTIONS, value, value || '—');
}
