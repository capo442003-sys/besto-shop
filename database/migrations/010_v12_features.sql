-- BMB v1.2 — préférences magasin, historique prix, sessions, clôture réouverte
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS inventory_lock BOOLEAN DEFAULT FALSE;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS pos_idle_minutes INTEGER DEFAULT 30;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS theme VARCHAR(20) DEFAULT 'light';
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS max_line_discount_pct DECIMAL(5,2) DEFAULT 100;

CREATE TABLE IF NOT EXISTS product_price_history (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field_name VARCHAR(40) NOT NULL,
  old_value DECIMAL(18,2),
  new_value DECIMAL(18,2),
  changed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON product_price_history(product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS session_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  username VARCHAR(80),
  action VARCHAR(30) NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_log_created ON session_log(created_at DESC);

ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
ALTER TABLE daily_cash ADD COLUMN IF NOT EXISTS reopened_by INTEGER REFERENCES users(id);
