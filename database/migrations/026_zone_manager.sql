-- Responsable de zone : accès multi-PV sans droits admin
INSERT INTO roles (code, label)
VALUES ('responsable_zone', 'Responsable de zone')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_delivery_points (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivery_point_id INTEGER NOT NULL REFERENCES delivery_points(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, delivery_point_id)
);
CREATE INDEX IF NOT EXISTS idx_user_delivery_points_user ON user_delivery_points(user_id);
