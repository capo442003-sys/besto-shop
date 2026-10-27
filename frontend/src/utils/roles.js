/** Normalise les rôles (tableau PG, chaîne "{a,b}", ou valeur unique). */
export function normalizeRoles(roles, fallbackRole) {
  if (Array.isArray(roles)) {
    return roles.filter(Boolean).map(String);
  }
  if (typeof roles === 'string') {
    const trimmed = roles.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1);
      if (!inner) return fallbackRole ? [fallbackRole] : [];
      return inner.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    }
    return trimmed ? [trimmed] : fallbackRole ? [fallbackRole] : [];
  }
  if (roles) return [String(roles)];
  return fallbackRole ? [fallbackRole] : [];
}
