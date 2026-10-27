-- Corriger les snapshots figés avec un nom erroné « SOLDE » quand le catalogue a le vrai nom
UPDATE sale_lines sl
SET
  product_name_snapshot = TRIM(p.name),
  product_reference_snapshot = COALESCE(NULLIF(TRIM(sl.product_reference_snapshot), ''), p.reference)
FROM products p
WHERE p.id = sl.product_id
  AND UPPER(TRIM(COALESCE(sl.product_name_snapshot, ''))) IN ('SOLDE', 'SOLDE A PAYER', 'RESTE')
  AND TRIM(COALESCE(p.name, '')) <> ''
  AND UPPER(TRIM(p.name)) NOT IN ('SOLDE', 'SOLDE A PAYER', 'RESTE');
