/** Reste à payer panier — aligné sur balanceDueGnf (arrondi GNF, tolérance 1 GNF). */
export const CART_BALANCE_DUE_SQL = `
  CASE
    WHEN GREATEST(0, ROUND(COALESCE(sc.total_amount, 0)) - ROUND(COALESCE(sc.amount_paid, 0))) <= 1 THEN 0
    ELSE GREATEST(0, ROUND(COALESCE(sc.total_amount, 0)) - ROUND(COALESCE(sc.amount_paid, 0)))
  END
`;

/** Périmètre créances commerciales validées (inventaire ventes, tableau de bord). */
export const RECEIVABLE_CART_WHERE = `
  sc.status = 'finalise'
  AND EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)
`;

/** Périmètre créances client : ventes validées + paniers en cours avec reste à payer (aligné règlement). */
export const CLIENT_CART_BALANCE_WHERE = `
  sc.status != 'annule'
  AND EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)
  AND (
    sc.status = 'finalise'
    OR (sc.status = 'en_cours' AND (${CART_BALANCE_DUE_SQL}) > 0.005)
  )
`;

export const CLIENT_RECEIVABLE_SETTLEMENT_TYPES = `('creance_commerciale', 'creance_externe', 'dette_commerciale')`;

/** @deprecated utiliser CLIENT_RECEIVABLE_SETTLEMENT_TYPES */
export const EXTERNAL_CREANCE_SETTLEMENT_TYPES = CLIENT_RECEIVABLE_SETTLEMENT_TYPES;
export const CLIENT_ADVANCE_SETTLEMENT_TYPE = 'avance_client';

export function clientAdvanceBalanceSubquery(clientIdExpr = 'c.id') {
  return `
    COALESCE((
      SELECT SUM(s.balance)
      FROM settlements s
      WHERE s.client_id = ${clientIdExpr}
        AND s.settlement_type = '${CLIENT_ADVANCE_SETTLEMENT_TYPE}'
        AND s.status = 'en_cours'
        AND s.balance > 0.005
    ), 0)`;
}

export function clientCartBalanceSubquery(clientIdExpr = 'c.id') {
  return `
    COALESCE((
      SELECT SUM((${CART_BALANCE_DUE_SQL}))
      FROM sales_carts sc
      WHERE sc.client_id = ${clientIdExpr}
        AND ${CLIENT_CART_BALANCE_WHERE}
    ), 0)`;
}

export function clientSettlementBalanceSubquery(clientIdExpr = 'c.id') {
  return `
    COALESCE((
      SELECT SUM(s.balance)
      FROM settlements s
      WHERE s.client_id = ${clientIdExpr}
        AND s.reference_id IS NULL
        AND s.status = 'en_cours'
        AND s.balance > 0.005
        AND s.settlement_type IN ${CLIENT_RECEIVABLE_SETTLEMENT_TYPES}
    ), 0)`;
}

/** Dettes manuelles client (hors paniers déjà comptés via reference_id). */
export const clientExternalBalanceSubquery = clientSettlementBalanceSubquery;

export function clientTotalBalanceSql(clientIdExpr = 'c.id') {
  return `(${clientCartBalanceSubquery(clientIdExpr)} + ${clientSettlementBalanceSubquery(clientIdExpr)})`;
}
