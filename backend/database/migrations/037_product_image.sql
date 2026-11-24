-- Photo produit facultative (affichée en caisse, catalogue et accueil)
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;
