-- Trois numéros de téléphone pour le magasin
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS phone_2 VARCHAR(20);
ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS phone_3 VARCHAR(20);
