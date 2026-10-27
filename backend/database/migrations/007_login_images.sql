-- Images personnalisables pour la page de connexion

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS login_image_1_url TEXT,
  ADD COLUMN IF NOT EXISTS login_image_2_url TEXT,
  ADD COLUMN IF NOT EXISTS login_image_3_url TEXT;
