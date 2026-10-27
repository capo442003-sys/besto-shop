-- Séparer le stock par PV : l'ancien modèle unifié (004) a copié la même quantité sur tous les PV.
-- On conserve le stock sur le PV actif le plus ancien (id min), les autres PV actifs repassent à 0.
UPDATE product_stock ps
SET quantity = 0, updated_at = NOW()
WHERE ps.delivery_point_id IN (
  SELECT dp.id
  FROM delivery_points dp
  WHERE dp.is_active = TRUE
    AND dp.id != (SELECT MIN(id) FROM delivery_points WHERE is_active = TRUE)
);
