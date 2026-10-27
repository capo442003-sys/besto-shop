-- Droits ventes pour gestionnaire et comptable (caisse, règlement, inventaire ventes)
INSERT INTO role_permissions (role_id, module_code, can_view, can_create, can_edit, can_delete, can_print)
SELECT r.id, 'ventes', TRUE, TRUE, TRUE, FALSE, TRUE
FROM roles r
WHERE r.code IN ('gestionnaire', 'comptable')
ON CONFLICT (role_id, module_code) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete,
  can_print = EXCLUDED.can_print;
