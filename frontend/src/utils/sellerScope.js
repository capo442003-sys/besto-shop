import { normalizeRoles } from './roles';
import { getPrimaryHomeRole } from './homeRole';

/** Compte vendeur (profil accueil vendeur, sans rôle caisse/gestion) */
export function isVendeurAccount(user) {
  if (!user) return false;
  return getPrimaryHomeRole(user) === 'vendeur';
}

/** Vendeur lié à un employé — ses ventes uniquement (pas admin ni gestion) */
export function isSellerScoped(user) {
  if (!user?.employee_id) return false;
  const roles = normalizeRoles(user.roles, user.role);
  if (roles.includes('administrateur')) return false;
  if (
    roles.includes('gestionnaire')
    || roles.includes('comptable')
    || roles.includes('caissier')
    || roles.includes('controleur')
  ) {
    return false;
  }
  return true;
}

/** Vendeur : encaissement uniquement à la validation du panier (pas règlement après) */
export function canEncaisserPendantVente(user) {
  return Boolean(user);
}

/** Règlement / versements après validation — vendeur seul non autorisé */
export function canAccessReglement(user) {
  if (!user) return false;
  if (isVendeurAccount(user)) return false;
  const roles = normalizeRoles(user?.roles, user?.role);
  if (roles.includes('administrateur')) return true;
  if (roles.includes('caissier') || roles.includes('gestionnaire') || roles.includes('comptable')) {
    return true;
  }
  return false;
}

/** Valider la vente sans encaissement à la caisse (solde réglé par la caisse ensuite) */
export function canPayLaterInCaisse(user) {
  return Boolean(user?.employee_id);
}

/** @deprecated alias */
export const canCollectPaymentAfterSale = canAccessReglement;
export const canCollectPaymentInCaisse = canAccessReglement;

export function hasLinkedEmployee(user) {
  return Boolean(user?.employee_id);
}

export function sellerDisplayName(user) {
  if (user?.employee_name) {
    return user.employee_matricule
      ? `${user.employee_name} — ${user.employee_matricule}`
      : user.employee_name;
  }
  return user?.full_name || 'Vendeur';
}
