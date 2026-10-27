-- Clôture de caisse : table daily_cash (pas "cash_closure")
-- Sur les bases créées avant le schéma complet, daily_cash peut être absente.

CREATE TABLE IF NOT EXISTS daily_cash (
  id SERIAL PRIMARY KEY,
  cash_date DATE UNIQUE NOT NULL,
  opening_balance DECIMAL(18,2) DEFAULT 0,
  total_income DECIMAL(18,2) DEFAULT 0,
  total_expense DECIMAL(18,2) DEFAULT 0,
  closing_balance DECIMAL(18,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS closed_by INTEGER REFERENCES users(id);
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS expected_balance DECIMAL(18,2);
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS counted_balance DECIMAL(18,2);
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS variance DECIMAL(18,2);
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS sales_collected DECIMAL(18,2) DEFAULT 0;
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS settlement_collected DECIMAL(18,2) DEFAULT 0;
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS signature_name VARCHAR(150);
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS reopened_by INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_daily_cash_date ON daily_cash(cash_date DESC);

-- Vue lisible dans pgAdmin (alias "cash_closure")
CREATE OR REPLACE VIEW cash_closure AS
SELECT
  id,
  cash_date,
  opening_balance,
  total_income,
  total_expense,
  closing_balance,
  sales_collected,
  settlement_collected,
  expected_balance,
  counted_balance,
  variance,
  signature_name,
  closed_at,
  closed_by,
  reopened_at,
  reopened_by,
  notes,
  created_at,
  updated_at
FROM daily_cash;
