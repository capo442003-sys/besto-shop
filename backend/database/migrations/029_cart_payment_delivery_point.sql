-- PV d'origine du reçu d'encaissement (vente, pas caisse)
ALTER TABLE cart_payments
  ADD COLUMN IF NOT EXISTS delivery_point_id INTEGER REFERENCES delivery_points(id);

CREATE INDEX IF NOT EXISTS idx_cart_payments_delivery_point
  ON cart_payments(delivery_point_id);

UPDATE cart_payments cp
SET delivery_point_id = COALESCE(c.delivery_point_id, sc.delivery_point_id)
FROM sales_carts sc
LEFT JOIN clients c ON c.id = sc.client_id
WHERE cp.cart_id = sc.id
  AND COALESCE(c.delivery_point_id, sc.delivery_point_id) IS NOT NULL
  AND cp.delivery_point_id IS DISTINCT FROM COALESCE(c.delivery_point_id, sc.delivery_point_id);

UPDATE sales_carts sc
SET delivery_point_id = c.delivery_point_id,
    updated_at = NOW()
FROM clients c
WHERE sc.client_id = c.id
  AND c.delivery_point_id IS NOT NULL
  AND sc.delivery_point_id IS DISTINCT FROM c.delivery_point_id;

UPDATE cart_payments cp
SET delivery_point_id = COALESCE(c.delivery_point_id, sc.delivery_point_id)
FROM sales_carts sc
LEFT JOIN clients c ON c.id = sc.client_id
WHERE cp.cart_id = sc.id
  AND COALESCE(c.delivery_point_id, sc.delivery_point_id) IS NOT NULL
  AND cp.delivery_point_id IS DISTINCT FROM COALESCE(c.delivery_point_id, sc.delivery_point_id);
