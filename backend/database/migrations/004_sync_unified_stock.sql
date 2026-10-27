-- Aligner tous les points de vente sur le stock max du produit (stock unique)
UPDATE product_stock ps
SET quantity = sub.unified_qty, updated_at = NOW()
FROM (
  SELECT product_id, MAX(quantity) AS unified_qty
  FROM product_stock
  GROUP BY product_id
) sub
WHERE ps.product_id = sub.product_id;
