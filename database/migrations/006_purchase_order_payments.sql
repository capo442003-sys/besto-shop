-- Encaissement bons de commande (finalisation au paiement complet)

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(50);

CREATE TABLE IF NOT EXISTS purchase_order_payments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  amount DECIMAL(18,2) NOT NULL,
  payment_mode VARCHAR(50) DEFAULT 'especes',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_payments_order ON purchase_order_payments(order_id);
