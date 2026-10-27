-- Paiements par tranches sur les paniers
CREATE TABLE IF NOT EXISTS cart_payments (
  id SERIAL PRIMARY KEY,
  cart_id INTEGER NOT NULL REFERENCES sales_carts(id) ON DELETE CASCADE,
  amount DECIMAL(18,2) NOT NULL,
  payment_mode payment_mode NOT NULL DEFAULT 'especes',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cart_payments_cart ON cart_payments(cart_id);
