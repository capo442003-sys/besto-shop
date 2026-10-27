const WEAK_PASSWORDS = new Set([
  'admin123',
  'admin',
  'password',
  'bmb1234',
  '123456',
  '12345678',
  'azerty',
]);

export function validatePasswordStrength(password) {
  const p = String(password || '').trim();
  if (p.length < 8) {
    return 'Le mot de passe doit contenir au moins 8 caractères';
  }
  if (WEAK_PASSWORDS.has(p.toLowerCase())) {
    return 'Ce mot de passe est trop simple — choisissez un mot de passe plus sécurisé';
  }
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) {
    return 'Utilisez au moins une lettre et un chiffre';
  }
  return null;
}
