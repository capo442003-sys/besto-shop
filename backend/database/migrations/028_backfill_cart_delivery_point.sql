-- Renseigne le PV manquant sur les paniers (ventes / reçus historiques)
UPDATE sales_carts sc
SET delivery_point_id = e.delivery_point_id,
    updated_at = NOW()
FROM employees e
WHERE sc.delivery_point_id IS NULL
  AND sc.seller_id = e.id
  AND e.delivery_point_id IS NOT NULL;

UPDATE sales_carts sc
SET delivery_point_id = c.delivery_point_id,
    updated_at = NOW()
FROM clients c
WHERE sc.delivery_point_id IS NULL
  AND sc.client_id = c.id
  AND c.delivery_point_id IS NOT NULL
  AND c.code != 'COMPTOIR';
