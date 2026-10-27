import { normalizeRoles } from './roles';

const HOME_ROLE_ORDER = [
  'administrateur',
  'gestionnaire',
  'comptable',
  'controleur',
  'caissier',
  'vendeur',
  'assistant',
];

/** Rôle principal pour l'écran d'accueil (un écran dédié par profil). */
export function getPrimaryHomeRole(user) {
  const roles = normalizeRoles(user?.roles, user?.role);
  if (roles.includes('vendeur') && roles.includes('caissier')
    && !roles.some((r) => ['administrateur', 'gestionnaire', 'comptable'].includes(r))) {
    return 'vendeur_caissier';
  }
  for (const code of HOME_ROLE_ORDER) {
    if (roles.includes(code)) return code;
  }
  return roles[0] || 'vendeur';
}

export function homeRoleLabel(role) {
  const labels = {
    administrateur: 'Administrateur',
    gestionnaire: 'Gestionnaire',
    comptable: 'Comptable',
    controleur: 'Contrôleur',
    caissier: 'Caissier',
    vendeur: 'Vendeur',
    vendeur_caissier: 'Vendeur & Caissier',
    assistant: 'Assistant',
  };
  return labels[role] || 'Utilisateur';
}
