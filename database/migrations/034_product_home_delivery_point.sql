-- Point de vente « maison » d'un produit (catalogue partagé, stock par PV)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS delivery_point_id INTEGER REFERENCES delivery_points(id);

CREATE INDEX IF NOT EXISTS idx_products_delivery_point ON products(delivery_point_id);
