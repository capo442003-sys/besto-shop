/**
 * Ventes annulées : hors totaux caisse / historique / tableau de bord.
 * - pas les écritures sales_cart_void (remboursement annulation)
 * - pas les encaissements liés à un panier status = annule
 */
export const ACTIVE_CASH_TX_SQL = `
  ct.reference_type IS DISTINCT FROM 'sales_cart_void'
  AND (
    ct.reference_type IS DISTINCT FROM 'sales_cart'
    OR EXISTS (
      SELECT 1 FROM sales_carts sc_active
      WHERE sc_active.id = ct.reference_id AND sc_active.status != 'annule'
    )
  )`;

export const ACTIVE_CASH_TX_AND = ` AND (${ACTIVE_CASH_TX_SQL.trim()})`;
