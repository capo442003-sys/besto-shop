import { isAdmin, hasRole } from './permissions.js';

/** Encaissement après validation (règlement, versements) — interdit au seul rôle vendeur */
export function canCollectPaymentAfterSale(user) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (hasRole(user, 'caissier') || hasRole(user, 'gestionnaire') || hasRole(user, 'comptable')) {
    return true;
  }
  return false;
}

export const canCollectPaymentInCaisse = canCollectPaymentAfterSale;

export function assertCanCollectPaymentAfterSale(user) {
  if (!canCollectPaymentAfterSale(user)) {
    const err = new Error('Les vendeurs ne peuvent encaisser qu\'à la validation de la vente — solde à régler par la caisse');
    err.status = 403;
    throw err;
  }
}

export const assertCanCollectPayment = assertCanCollectPaymentAfterSale;

export const canAccessReglement = canCollectPaymentAfterSale;

/** Vendeur lié à un employé — ne voit/agit que sur ses propres ventes */
export function isSellerScoped(user) {
  if (!user?.employee_id) return false;
  if (isAdmin(user)) return false;
  if (
    hasRole(user, 'gestionnaire')
    || hasRole(user, 'comptable')
    || hasRole(user, 'caissier')
    || hasRole(user, 'controleur')
  ) {
    return false;
  }
  return true;
}

export function applySellerScope(user, query = {}) {
  const q = { ...query };
  if (isSellerScoped(user) && q.inventaire !== 'true') {
    q.seller_id = String(user.employee_id);
  }
  return q;
}

export function resolveSellerId(user, _sellerId) {
  if (user?.employee_id) return user.employee_id;
  const err = new Error('Aucun employé lié à votre compte — vente impossible');
  err.status = 400;
  throw err;
}

export function assertCartAccess(user, cart) {
  if (!cart) return;
  if (isSellerScoped(user) && String(cart.seller_id) !== String(user.employee_id)) {
    const err = new Error('Accès refusé — ce panier appartient à un autre vendeur');
    err.status = 403;
    throw err;
  }
}
