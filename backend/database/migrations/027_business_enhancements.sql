-- Objectifs CA par PV et snapshot prix d'achat sur les lignes de vente
CREATE TABLE IF NOT EXISTS pv_objectives (
  id SERIAL PRIMARY KEY,
  delivery_point_id INTEGER NOT NULL REFERENCES delivery_points(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  target_ca DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (delivery_point_id, month)
);

CREATE INDEX IF NOT EXISTS idx_pv_objectives_month ON pv_objectives(month, delivery_point_id);

ALTER TABLE sale_lines ADD COLUMN IF NOT EXISTS purchase_price_snapshot DECIMAL(18,2);

UPDATE sale_lines sl
SET purchase_price_snapshot = p.purchase_price
FROM products p
WHERE p.id = sl.product_id
  AND sl.purchase_price_snapshot IS NULL;
