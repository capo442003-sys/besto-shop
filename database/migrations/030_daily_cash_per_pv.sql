-- Clôture de caisse par point de vente (NULL = clôture globale legacy)
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS delivery_point_id INTEGER REFERENCES delivery_points(id);

ALTER TABLE daily_cash DROP CONSTRAINT IF EXISTS daily_cash_cash_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_cash_date_global
  ON daily_cash (cash_date) WHERE delivery_point_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_cash_date_pv
  ON daily_cash (cash_date, delivery_point_id) WHERE delivery_point_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_cash_pv_date ON daily_cash (delivery_point_id, cash_date DESC);

DROP VIEW IF EXISTS cash_closure;

CREATE VIEW cash_closure AS
SELECT
  id, cash_date, delivery_point_id, opening_balance, total_income, total_expense, closing_balance,
  sales_collected, settlement_collected, expected_balance, counted_balance, variance,
  signature_name, closed_at, closed_by, reopened_at, reopened_by, notes, created_at, updated_at
FROM daily_cash;
