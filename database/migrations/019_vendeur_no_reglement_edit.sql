-- Le vendeur ne doit pas accéder au règlement (encaissement après vente)
UPDATE role_permissions rp
SET can_edit = FALSE
FROM roles r
WHERE rp.role_id = r.id
  AND r.code = 'vendeur'
  AND rp.module_code = 'ventes';
