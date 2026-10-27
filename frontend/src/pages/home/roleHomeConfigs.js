/** Configuration des écrans d'accueil par rôle — actions + résumé du jour */
export const ROLE_HOME_CONFIGS = {
  vendeur: {
    actions: [
      { to: '/ventes/vendre', label: 'Ouvrir la caisse', subtitle: 'Démarrer une nouvelle session', variant: 'primary', icon: 'caisse', module: 'ventes', action: 'create' },
      { to: '/ventes/inventaire', label: 'Mes ventes', subtitle: 'Voir l\'historique des ventes', variant: 'blue', icon: 'chart', module: 'ventes', action: 'view' },
    ],
    summary: { label: 'Ventes aujourd\'hui', path: 'ventes_jour.montant', format: 'gnf' },
    analytics: false,
  },
  caissier: {
    actions: [
      { to: '/ventes/reglement', label: 'Encaisser un client', subtitle: 'Encaisser un paiement', variant: 'primary', icon: 'clients', module: 'ventes', action: 'edit', requireAfterSalePayment: true },
      { to: '/finances/caisse', label: 'Caisse du jour', subtitle: 'Suivre la trésorerie', variant: 'blue', icon: 'finances', module: 'finances', action: 'view' },
      { to: '/ventes/vendre', label: 'Ouvrir la caisse', subtitle: 'Démarrer une nouvelle session', variant: 'gray', icon: 'caisse', module: 'ventes', action: 'create' },
    ],
    summary: { label: 'Encaissements aujourd\'hui', path: 'ventes_jour.encaisse', format: 'gnf' },
    analytics: false,
  },
  vendeur_caissier: {
    actions: [
      { to: '/ventes/vendre', label: 'Ouvrir la caisse', subtitle: 'Démarrer une nouvelle session', variant: 'primary', icon: 'caisse', module: 'ventes', action: 'create' },
      { to: '/ventes/reglement', label: 'Encaisser un client', subtitle: 'Encaisser un paiement', variant: 'blue', icon: 'clients', module: 'ventes', action: 'edit', requireAfterSalePayment: true },
      { to: '/finances/caisse', label: 'Caisse du jour', subtitle: 'Suivre la trésorerie', variant: 'gray', icon: 'finances', module: 'finances', action: 'view' },
    ],
    summary: { label: 'Ventes aujourd\'hui', path: 'ventes_jour.montant', format: 'gnf' },
    analytics: false,
  },
  controleur: {
    actions: [
      { to: '/ventes/inventaire', label: 'Inventaire des ventes', subtitle: 'Contrôler les transactions', variant: 'primary', icon: 'ventes', module: 'ventes', action: 'view' },
      { to: '/produits/stocks', label: 'Contrôle des stocks', subtitle: 'Vérifier les niveaux', variant: 'blue', icon: 'stock', module: 'produits', action: 'view' },
      { to: '/ventes/clients', label: 'Suivi clients', subtitle: 'Analyser les comptes', variant: 'gray', icon: 'clients', module: 'ventes', action: 'view' },
    ],
    summary: { label: 'Alertes stock', path: 'alertes_stock_count', format: 'count', suffix: 'alerte(s)' },
    analytics: false,
  },
  gestionnaire: {
    actions: [
      { to: '/ventes/inventaire', label: 'Piloter les ventes', subtitle: 'Suivre l\'activité du jour', variant: 'primary', icon: 'ventes', module: 'ventes', action: 'view' },
      { to: '/produits/stocks', label: 'Stocks & alertes', subtitle: 'Anticiper les ruptures', variant: 'blue', icon: 'stock', module: 'produits', action: 'view' },
      { to: '/finances/caisse', label: 'Trésorerie', subtitle: 'Consulter la caisse', variant: 'gray', icon: 'finances', module: 'finances', action: 'view' },
      { to: '/ventes/reglement', label: 'Encaisser', subtitle: 'Règlements clients', variant: 'gray', icon: 'clients', module: 'ventes', action: 'edit', requireAfterSalePayment: true },
      { to: '/employes/liste', label: 'Équipe', subtitle: 'Gérer les employés', variant: 'gray', icon: 'employes', module: 'employes', action: 'view' },
    ],
    summary: { label: 'Chiffre d\'affaires du jour', path: 'chiffre_affaires.jour', format: 'gnf' },
    analytics: false,
  },
  comptable: {
    actions: [
      { to: '/finances/caisse', label: 'Caisse du jour', subtitle: 'Suivre les encaissements', variant: 'primary', icon: 'finances', module: 'finances', action: 'view' },
      { to: '/finances/historique', label: 'Historique caisse', subtitle: 'Consulter les mouvements', variant: 'blue', icon: 'chart', module: 'finances', action: 'view' },
      { to: '/finances/bilan', label: 'Bilan financier', subtitle: 'Analyser la performance', variant: 'gray', icon: 'dashboard', module: 'finances', action: 'view' },
    ],
    summary: { label: 'Solde caisse du jour', path: 'caisse', format: 'gnf' },
    analytics: true,
  },
  assistant: {
    actions: [
      { to: '/ventes/vendre', label: 'Nouvelle vente', subtitle: 'Ouvrir la caisse', variant: 'primary', icon: 'caisse', module: 'ventes', action: 'create' },
      { to: '/produits/stocks', label: 'Consulter les stocks', subtitle: 'Vérifier les disponibilités', variant: 'blue', icon: 'stock', module: 'produits', action: 'view' },
      { to: '/ventes/clients', label: 'Liste clients', subtitle: 'Gérer les comptes', variant: 'gray', icon: 'clients', module: 'ventes', action: 'view' },
    ],
    summary: { label: 'Ventes aujourd\'hui', path: 'ventes_jour.montant', format: 'gnf' },
    analytics: false,
  },
  administrateur: {
    actions: [
      { to: '/parametres/utilisateurs', label: 'Administration', subtitle: 'Gérer les utilisateurs', variant: 'primary', icon: 'parametres', module: 'parametres', action: 'view' },
      { to: '/finances/caisse', label: 'Finances & caisse', subtitle: 'Suivre la trésorerie', variant: 'blue', icon: 'finances', module: 'finances', action: 'view' },
      { to: '/ventes/vendre', label: 'Ouvrir la caisse', subtitle: 'Démarrer une session', variant: 'gray', icon: 'caisse', module: 'ventes', action: 'create' },
    ],
    summary: { label: 'Chiffre d\'affaires du jour', path: 'chiffre_affaires.jour', format: 'gnf' },
    analytics: true,
  },
};

export function getRoleHomeConfig(role) {
  return ROLE_HOME_CONFIGS[role] || ROLE_HOME_CONFIGS.vendeur;
}
