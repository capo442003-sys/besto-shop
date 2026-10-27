-- Conserver le nom et la référence produit au moment de la vente (factures fiables)
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS product_name_snapshot VARCHAR(200);
ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS product_reference_snapshot VARCHAR(50);

UPDATE sale_lines sl
SET
  product_name_snapshot = p.name,
  product_reference_snapshot = p.reference
FROM products p
WHERE p.id = sl.product_id
  AND (sl.product_name_snapshot IS NULL OR sl.product_name_snapshot = '');
