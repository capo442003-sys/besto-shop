-- Clients rattachés à un point de vente (isolation multi-PV)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS delivery_point_id INTEGER REFERENCES delivery_points(id);
CREATE INDEX IF NOT EXISTS idx_clients_delivery_point ON clients(delivery_point_id);

-- Rattacher via le PV le plus fréquent dans l'historique des ventes
UPDATE clients c
SET delivery_point_id = sub.delivery_point_id
FROM (
  SELECT ranked.client_id, ranked.delivery_point_id
  FROM (
    SELECT
      sc.client_id,
      sc.delivery_point_id,
      ROW_NUMBER() OVER (
        PARTITION BY sc.client_id
        ORDER BY COUNT(*) DESC, MAX(sc.created_at) DESC, sc.delivery_point_id
      ) AS rn
    FROM sales_carts sc
    WHERE sc.client_id IS NOT NULL
      AND sc.delivery_point_id IS NOT NULL
    GROUP BY sc.client_id, sc.delivery_point_id
  ) ranked
  WHERE ranked.rn = 1
) sub
WHERE c.id = sub.client_id
  AND c.delivery_point_id IS NULL;

-- PV actif par défaut si aucun historique vente
UPDATE clients c
SET delivery_point_id = (SELECT id FROM delivery_points WHERE is_active = TRUE ORDER BY id LIMIT 1)
WHERE c.delivery_point_id IS NULL;

ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_code_key;
DROP INDEX IF EXISTS clients_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_code_pv ON clients (code, delivery_point_id);

-- Un client comptoir par PV actif
INSERT INTO clients (name, code, client_type, delivery_point_id)
SELECT 'Client Comptoir', 'COMPTOIR', 'particulier', dp.id
FROM delivery_points dp
WHERE dp.is_active = TRUE
ON CONFLICT (code, delivery_point_id) DO NOTHING;
