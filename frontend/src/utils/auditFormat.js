import { formatGNF, formatQty } from './format';

const ENTITY_LABELS = {
  client: 'Client',
  sales_cart: 'Panier de vente',
  product: 'Produit',
  products: 'Produits',
  category: 'Catégorie',
  supplier: 'Fournisseur',
  employee: 'Employé',
  user: 'Utilisateur',
  delivery_point: 'Point de vente',
  sale_line: 'Ligne de vente',
  purchase_order: 'Bon de commande',
  purchase_order_line: 'Ligne bon de commande',
  store_settings: 'Paramètres magasin',
  cash_transaction: 'Caisse',
  charge: 'Charge',
  settlement: 'Dette / créance',
  salary_payment: 'Paiement salaire',
  work_schedule: 'Planning',
  backup: 'Sauvegarde',
  auth: 'Authentification',
  clients: 'Clients',
  suppliers: 'Fournisseurs',
  categories: 'Catégories',
  sales_history: 'Ventes historiques',
  cash_closure: 'Clôture de caisse',
};

const ACTION_LABELS = {
  create: 'Création',
  deactivate: 'Désactivation',
  delete: 'Suppression',
  update: 'Modification',
  validate: 'Validation vente',
  payment: 'Encaissement',
  cancel: 'Annulation',
  import: 'Import Excel',
  login_failed: 'Échec connexion',
  close: 'Clôture',
  inventory: 'Inventaire physique',
  restock: 'Ravitaillement',
};

export function formatAuditEntityType(entityType) {
  if (!entityType) return '—';
  return ENTITY_LABELS[entityType] || entityType.replace(/_/g, ' ');
}

export function formatAuditAction(action) {
  if (!action) return '—';
  return ACTION_LABELS[action] || action.replace(/_/g, ' ');
}

function parseDetails(details) {
  if (!details) return {};
  if (typeof details === 'string') {
    try {
      return JSON.parse(details);
    } catch {
      return {};
    }
  }
  return details;
}

function productLabel(d) {
  if (d.reference && d.name) return `${d.name} (${d.reference})`;
  if (d.name) return d.name;
  if (d.reference) return d.reference;
  if (d.product_name) return d.product_name;
  return null;
}

export function formatAuditDetails(entry) {
  const { action, entity_type: entityType, entity_id: entityId } = entry;
  const d = parseDetails(entry.details);
  const parts = [];

  if (entityType === 'sales_cart') {
    if (d.cart_number) parts.push(`Panier ${d.cart_number}`);
    else if (entityId) parts.push(`Panier #${entityId}`);
  }

  if (entityType === 'purchase_order' && d.order_number) {
    parts.push(`Bon ${d.order_number}`);
  }

  if (entityType === 'client') {
    if (d.name) parts.push(d.code ? `${d.name} (${d.code})` : d.name);
    else if (entityId) parts.push(`Client #${entityId}`);
  }

  if (entityType === 'product') {
    const label = productLabel(d);
    if (label) parts.push(label);
    else if (entityId) parts.push(`Produit #${entityId}`);
  }

  if (entityType === 'category' && d.name) {
    parts.push(d.name);
  }

  if (entityType === 'supplier' && (d.name || d.code)) {
    parts.push(d.name ? (d.code ? `${d.name} (${d.code})` : d.name) : d.code);
  }

  if (entityType === 'employee' && (d.name || d.matricule)) {
    parts.push(d.name ? (d.matricule ? `${d.name} (${d.matricule})` : d.name) : d.matricule);
  }

  if (entityType === 'user' && d.username) {
    parts.push(d.username);
  }

  if (entityType === 'delivery_point' && (d.code || d.name)) {
    parts.push(d.name ? `${d.code || ''} — ${d.name}`.trim() : d.code);
  }

  if (entityType === 'settlement' && d.settlement_number) {
    parts.push(d.settlement_number);
  }

  if (entityType === 'cash_transaction' && d.amount != null) {
    parts.push(`${d.transaction_type || 'opération'} ${formatGNF(d.amount)}`);
  }

  if (entityType === 'charge' && d.amount != null) {
    parts.push(formatGNF(d.amount));
  }

  if (entityType === 'salary_payment' && d.employee_name) {
    parts.push(`${d.employee_name}${d.month ? ` — ${d.month}/${d.year}` : ''}`);
  }

  if (entityType === 'work_schedule' && d.employee_name) {
    parts.push(`${d.employee_name}${d.schedule_date ? ` — ${d.schedule_date}` : ''}`);
  }

  if (entityType === 'store_settings' && d.change) {
    parts.push(d.change.replace(/_/g, ' '));
  } else if (entityType === 'store_settings' && d.store_name) {
    parts.push(d.store_name);
  }

  if (entityType === 'sale_line' || entityType === 'purchase_order_line') {
    if (d.cart_number) parts.push(`panier ${d.cart_number}`);
    if (d.order_number) parts.push(`bon ${d.order_number}`);
    const pl = productLabel(d);
    if (pl) parts.push(pl);
    if (d.quantity != null) parts.push(`qté ${formatQty(d.quantity)}`);
  }

  switch (action) {
    case 'payment':
      if (d.installment != null) parts.push(`versement ${formatGNF(d.installment)}`);
      if (d.amount_paid != null) parts.push(`total encaissé ${formatGNF(d.amount_paid)}`);
      if (d.amount != null && entityType === 'salary_payment') parts.push(formatGNF(d.amount));
      if (entityType === 'purchase_order' && d.order_number) parts.push(`bon ${d.order_number}`);
      if (entityType === 'settlement' && d.settlement_number) parts.push(d.settlement_number);
      break;
    case 'validate':
      if (d.total != null) parts.push(`montant ${formatGNF(d.total)}`);
      break;
    case 'cancel':
      if (entityType === 'sales_cart') parts.push('panier annulé');
      else if (entityType === 'purchase_order') parts.push('bon annulé');
      break;
    case 'create':
      if (entityType === 'client' && !d.name) parts.push('nouveau client');
      break;
    case 'delete':
      if (entityType === 'client') parts.push('client désactivé');
      else if (entityType === 'product') parts.push(d.action_label || 'produit désactivé');
      else if (entityType === 'user') parts.push('compte désactivé');
      else if (entityType === 'delivery_point') parts.push('point désactivé');
      else if (entityType === 'employee') parts.push('employé désactivé');
      else if (entityType === 'supplier') parts.push('fournisseur désactivé');
      else if (entityType === 'category') parts.push('catégorie supprimée');
      else if (entityType === 'sale_line') parts.push('ligne retirée du panier');
      else if (entityType === 'purchase_order_line') parts.push('ligne retirée du bon');
      break;
    case 'update':
      if (entityType === 'product' && !productLabel(d) && entityId) parts.push(`produit #${entityId}`);
      break;
    case 'import':
      if (d.created != null || d.updated != null) {
        parts.push(`${d.created ?? 0} créé(s), ${d.updated ?? 0} mis à jour`);
      }
      break;
    case 'inventory':
      if (d.count != null) parts.push(`${d.count} produit(s) ajusté(s)`);
      break;
    case 'restock':
      if (d.addQty != null) parts.push(`+${formatQty(d.addQty)}`);
      if (d.quantity != null) parts.push(`stock ${formatQty(d.quantity)}`);
      break;
    default:
      break;
  }

  if (parts.length === 0) {
    const extras = Object.entries(d)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${k} : ${typeof v === 'number' && k.includes('amount') ? formatGNF(v) : v}`);
    if (extras.length) return extras.join(' · ');
    if (entityId) return `Réf. #${entityId}`;
    return '—';
  }

  return parts.join(' — ');
}
