-- Données initiales BESTO SHOP (idempotent)
INSERT INTO store_settings (store_name, address, phone, currency)
SELECT 'BESTO SHOP', 'Conakry, Guinée', '620000000', 'GNF'
WHERE NOT EXISTS (SELECT 1 FROM store_settings LIMIT 1);

INSERT INTO delivery_points (code, name) VALUES
  ('PV1', 'Boutique principale'),
  ('PV2', 'Point de vente 2'),
  ('PV3', 'Point de vente 3')
ON CONFLICT (code) DO NOTHING;

INSERT INTO categories (name) VALUES
  ('Hommes'),
  ('Femmes'),
  ('Enfants'),
  ('Chaussures'),
  ('Accessoires')
ON CONFLICT (name) DO NOTHING;

INSERT INTO charge_types (name) VALUES
  ('Loyer'),
  ('Électricité'),
  ('Eau'),
  ('Transport'),
  ('Autres')
ON CONFLICT (name) DO NOTHING;

INSERT INTO supplier_product_types (name) VALUES
  ('Vêtements'),
  ('Chaussures'),
  ('Accessoires'),
  ('Sacs'),
  ('Textile')
ON CONFLICT (name) DO NOTHING;

INSERT INTO roles (code, label) VALUES
  ('administrateur', 'Administrateur'),
  ('vendeur', 'Vendeur'),
  ('caissier', 'Caissier'),
  ('controleur', 'Contrôleur'),
  ('gestionnaire', 'Gestionnaire'),
  ('comptable', 'Comptable'),
  ('assistant', 'Assistant')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, module_code, can_view, can_create, can_edit, can_delete, can_print)
SELECT r.id, m.code, TRUE, TRUE, TRUE, TRUE, TRUE
FROM roles r
CROSS JOIN (VALUES
  ('dashboard'),('ventes'),('produits'),('employes'),('finances'),('parametres')
) AS m(code)
WHERE r.code = 'administrateur'
ON CONFLICT (role_id, module_code) DO NOTHING;

INSERT INTO role_permissions (role_id, module_code, can_view, can_create, can_edit, can_delete, can_print)
SELECT r.id, 'ventes', TRUE, TRUE, FALSE, FALSE, TRUE FROM roles r WHERE r.code = 'vendeur'
ON CONFLICT (role_id, module_code) DO NOTHING;

INSERT INTO role_permissions (role_id, module_code, can_view, can_create, can_edit, can_delete, can_print)
SELECT r.id, 'ventes', TRUE, TRUE, TRUE, FALSE, TRUE FROM roles r WHERE r.code = 'caissier'
ON CONFLICT (role_id, module_code) DO NOTHING;

INSERT INTO role_permissions (role_id, module_code, can_view, can_create, can_edit, can_delete, can_print)
SELECT r.id, 'dashboard', TRUE, FALSE, FALSE, FALSE, TRUE FROM roles r WHERE r.code != 'administrateur'
ON CONFLICT (role_id, module_code) DO NOTHING;

INSERT INTO role_permissions (role_id, module_code, can_view, can_create, can_edit, can_delete, can_print)
SELECT r.id, m.code, TRUE, TRUE, TRUE, FALSE, TRUE
FROM roles r
CROSS JOIN (VALUES ('produits'), ('employes'), ('finances'), ('ventes')) AS m(code)
WHERE r.code IN ('gestionnaire', 'comptable')
ON CONFLICT (role_id, module_code) DO NOTHING;

INSERT INTO role_permissions (role_id, module_code, can_view, can_create, can_edit, can_delete, can_print)
SELECT r.id, 'produits', TRUE, FALSE, FALSE, FALSE, TRUE FROM roles r WHERE r.code = 'assistant'
ON CONFLICT (role_id, module_code) DO NOTHING;

INSERT INTO clients (name, code, client_type, delivery_point_id)
SELECT 'Client Comptoir', 'COMPTOIR', 'particulier', dp.id
FROM delivery_points dp
WHERE dp.is_active = TRUE
ON CONFLICT (code, delivery_point_id) DO NOTHING;
