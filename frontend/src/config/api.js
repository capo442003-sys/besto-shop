/**
 * URL backend (Railway, VPS, local via proxy Vite).
 * En local : laisser vide → requêtes relatives /api (proxy Vite).
 * Sur Vercel : VITE_API_URL=https://votre-app.up.railway.app
 */
export function getBackendOrigin() {
  const url = (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
  return url || null;
}

export function getApiBaseUrl() {
  const origin = getBackendOrigin();
  return origin ? `${origin}/api` : '/api';
}

/** Chemins relatifs : /api/… → backend ; autres assets → origine du frontend (Vercel) */
export function resolveAssetUrl(path) {
  if (!path) return null;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized.startsWith('/api/')) {
    const origin = getBackendOrigin() || window.location.origin;
    return `${origin}${normalized}`;
  }
  return `${window.location.origin}${normalized}`;
}

export function getSocketOrigin() {
  return getBackendOrigin() || window.location.origin;
}
