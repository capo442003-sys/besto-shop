/** Noms réservés (erreurs de saisie) — ne pas figer sur les factures si le catalogue a été corrigé. */
export const PLACEHOLDER_PRODUCT_NAMES = ['SOLDE', 'SOLDE A PAYER', 'RESTE'];

export function isPlaceholderProductName(name) {
  const n = String(name || '').trim().toUpperCase();
  return !n || PLACEHOLDER_PRODUCT_NAMES.includes(n);
}

/** Expression SQL : nom produit affiché sur panier / facture. */
export const SALE_LINE_PRODUCT_NAME_SQL = `
  CASE
    WHEN UPPER(TRIM(COALESCE(sl.product_name_snapshot, ''))) IN ('SOLDE', 'SOLDE A PAYER', 'RESTE')
      AND TRIM(COALESCE(p.name, '')) <> ''
      AND UPPER(TRIM(p.name)) NOT IN ('SOLDE', 'SOLDE A PAYER', 'RESTE')
    THEN TRIM(p.name)
    ELSE COALESCE(NULLIF(TRIM(sl.product_name_snapshot), ''), NULLIF(TRIM(p.name), ''))
  END`;

export const SALE_LINE_PRODUCT_REFERENCE_SQL = `
  COALESCE(NULLIF(TRIM(sl.product_reference_snapshot), ''), NULLIF(TRIM(p.reference), ''))`;
