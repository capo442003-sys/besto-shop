-- Sécurité comptes + préférences caisse
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS pos_confirm_add_line BOOLEAN NOT NULL DEFAULT FALSE;

-- Forcer changement mot de passe pour le compte admin par défaut (une fois)
UPDATE users SET must_change_password = TRUE WHERE username = 'admin' AND must_change_password = FALSE;

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
