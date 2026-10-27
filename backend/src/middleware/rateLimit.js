const stores = new Map();

function nowMs() {
  return Date.now();
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function getStore(key) {
  if (!stores.has(key)) stores.set(key, new Map());
  return stores.get(key);
}

function consume(store, key, windowMs) {
  const now = nowMs();
  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }
  entry.count += 1;
  return entry;
}

function isApiPath(req) {
  return req.path === '/api' || req.path.startsWith('/api/');
}

export function createMemoryRateLimit({
  key = 'default',
  windowMs = 60_000,
  max = 120,
  keyFn = (req) => clientIp(req),
  skip = () => false,
  message = 'Trop de requêtes. Réessayez dans un instant.',
} = {}) {
  const store = getStore(key);
  return function memoryRateLimit(req, res, next) {
    if (skip(req)) return next();
    const token = keyFn(req);
    const entry = consume(store, token, windowMs);
    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - nowMs()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ message });
    }
    return next();
  };
}

export const globalApiRateLimit = createMemoryRateLimit({
  key: 'global-api',
  windowMs: 60_000,
  max: 240,
  skip: (req) => !isApiPath(req) || req.path === '/api/health',
  message: 'Trop de requêtes API. Réessayez dans quelques secondes.',
});

export const sensitiveOpsRateLimit = createMemoryRateLimit({
  key: 'sensitive-ops',
  windowMs: 10 * 60_000,
  max: 20,
  keyFn: (req) => `${clientIp(req)}:${req.user?.id || 'anon'}`,
  message: 'Trop d’opérations sensibles. Patientez avant de recommencer.',
});
