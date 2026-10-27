-- Un seul DG : conserver la fiche liée au compte admin, les autres passent en gestionnaire
UPDATE employees e
SET function = 'gestionnaire', updated_at = NOW()
WHERE e.function = 'dg'
  AND e.is_active = TRUE
  AND e.id NOT IN (
    SELECT u.employee_id FROM users u
    WHERE u.username = 'admin' AND u.employee_id IS NOT NULL
    UNION
    SELECT MIN(e2.id) FROM employees e2 WHERE e2.function = 'dg' AND e2.is_active = TRUE
  );
