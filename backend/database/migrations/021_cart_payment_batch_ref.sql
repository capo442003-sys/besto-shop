-- Référence commune pour un encaissement global (plusieurs paniers d'un client).
ALTER TABLE cart_payments ADD COLUMN IF NOT EXISTS batch_ref VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_cart_payments_batch_ref ON cart_payments(batch_ref);
