export const ROUTE_LABELS = {
  vendre: 'Caisse',
  inventaire: 'Inventaire',
  clients: 'Clients',
  factures: 'Factures proforma',
  recus: 'Reçus d\'encaissement',
  'bons-commande': 'Bons de commande',
  reglement: 'Règlement & encaissement',
  stocks: 'Stocks',
  liste: 'Liste',
  fournisseurs: 'Fournisseurs',
  salaires: 'Salaires',
  plannings: 'Plannings',
  stats: 'Statistiques ventes',
  caisse: 'Caisse journalière',
  historique: 'Historique',
  charges: 'Charges',
  bilan: 'Bilan',
  magasin: 'Magasin',
  utilisateurs: 'Utilisateurs',
  'points-vente': 'Points de vente',
  audit: 'Journal audit',
};

/** Libellés selon le module (évite les conflits inventaire ventes / produits) */
const MODULE_SECTION_LABELS = {
  ventes: {
    inventaire: 'Inventaire de vente',
    vendre: 'Caisse',
    reglement: 'Règlement & encaissement',
    recus: 'Reçus d\'encaissement',
  },
  produits: {
    inventaire: 'Inventaire physique',
    liste: 'Liste des produits',
  },
  employes: {
    liste: 'Employés',
  },
};

export function routeLabel(segment, moduleKey) {
  if (!segment) return null;
  if (moduleKey && MODULE_SECTION_LABELS[moduleKey]?.[segment]) {
    return MODULE_SECTION_LABELS[moduleKey][segment];
  }
  return ROUTE_LABELS[segment] || segment.replace(/-/g, ' ');
}
