/** Limite les tentatives de connexion par IP (mémoire locale). */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 25;
const store = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function loginRateLimit(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  let entry = store.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    return res.status(429).json({
      message: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.',
    });
  }
  next();
}

/** Réinitialise le compteur après une connexion réussie. */
export function clearLoginAttempts(req) {
  store.delete(clientIp(req));
}
