-- Prix d'achat saisi à chaque ravitaillement (historique mouvements)
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS purchase_unit_price DECIMAL(18,2);
