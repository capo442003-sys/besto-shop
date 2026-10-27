-- Migration 022: assign employees to a point of sale (PV)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS delivery_point_id INTEGER REFERENCES delivery_points(id);
CREATE INDEX IF NOT EXISTS idx_employees_delivery_point ON employees(delivery_point_id);

-- Existing operational staff default to PV1
UPDATE employees e
SET delivery_point_id = (SELECT id FROM delivery_points WHERE code = 'PV1' LIMIT 1)
WHERE e.delivery_point_id IS NULL
  AND e.function IN ('vendeur', 'caissier', 'vendeur_caissier', 'controleur');
