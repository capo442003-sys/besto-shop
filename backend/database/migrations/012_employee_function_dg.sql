-- Fonction employé DG (Directeur général) — équivalent administrateur pour les comptes liés
ALTER TYPE employee_function ADD VALUE IF NOT EXISTS 'dg';
