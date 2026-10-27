-- Droits contrôleur + caissier (règlement)
INSERT INTO role_permissions (role_id, module_code, can_view, can_create, can_edit, can_delete, can_print)
SELECT r.id, 'ventes', TRUE, FALSE, FALSE, FALSE, TRUE FROM roles r WHERE r.code = 'controleur'
AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.module_code = 'ventes');

INSERT INTO role_permissions (role_id, module_code, can_view, can_create, can_edit, can_delete, can_print)
SELECT r.id, 'produits', TRUE, FALSE, FALSE, FALSE, TRUE FROM roles r WHERE r.code = 'controleur'
AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.module_code = 'produits');

INSERT INTO role_permissions (role_id, module_code, can_view, can_create, can_edit, can_delete, can_print)
SELECT r.id, 'dashboard', TRUE, FALSE, FALSE, FALSE, TRUE FROM roles r WHERE r.code = 'controleur'
AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.module_code = 'dashboard');

UPDATE role_permissions SET can_edit = TRUE
WHERE role_id = (SELECT id FROM roles WHERE code = 'caissier')
  AND module_code = 'ventes';
