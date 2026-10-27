-- Clôture de caisse (Z) — table daily_cash déjà présente dans le schéma
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS closed_by INTEGER REFERENCES users(id);
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS expected_balance DECIMAL(18,2);
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS counted_balance DECIMAL(18,2);
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS variance DECIMAL(18,2);
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS sales_collected DECIMAL(18,2) DEFAULT 0;
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS settlement_collected DECIMAL(18,2) DEFAULT 0;
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS signature_name VARCHAR(150);

CREATE INDEX IF NOT EXISTS idx_daily_cash_date ON daily_cash(cash_date DESC);
