/**
 * Tests API smoke — lancer avec le backend démarré :
 * node backend/scripts/smoke-test.js
 */
const BASE = process.env.API_URL || 'http://localhost:3001/api';

let token = null;
let passed = 0;
let failed = 0;

async function req(method, path, body, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function run() {
  console.log('\n=== BMB Smoke Tests ===\n');

  const health = await req('GET', '/health');
  ok('Health check', health.status === 200 && health.data?.db === 'ok', `status ${health.status}`);

  const store = await req('GET', '/settings/store');
  ok('Store settings (public)', store.status === 200);

  const loginBad = await req('POST', '/auth/login', { username: 'wrong', password: 'wrong' });
  ok('Login refusé (mauvais identifiants)', loginBad.status === 401, `status ${loginBad.status}`);

  const login = await req('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  ok('Login admin', login.status === 200 && login.data?.token, login.data?.message || `status ${login.status}`);
  token = login.data?.token;

  if (!token) {
    console.error('\nImpossible de continuer sans token.');
    process.exit(1);
  }

  const endpoints = [
    ['GET', '/dashboard'],
    ['GET', '/clients'],
    ['GET', '/products'],
    ['GET', '/sales/carts'],
    ['GET', '/purchase-orders'],
    ['GET', '/proforma'],
    ['GET', '/settlements/debts-summary'],
    ['GET', '/finances/caisse?date=2026-01-01'],
    ['GET', '/employees'],
    ['GET', '/suppliers'],
    ['GET', '/settings/users'],
    ['GET', '/settings/delivery-points'],
  ];

  for (const [method, path] of endpoints) {
    const r = await req(method, path, null, true);
    ok(`${method} ${path}`, r.status >= 200 && r.status < 300, `status ${r.status}`);
  }

  const comptoir = await req('GET', '/clients?search=COMPTOIR', null, true);
  ok('Client comptoir existe', comptoir.status === 200 && Array.isArray(comptoir.data) && comptoir.data.length > 0);

  console.log(`\n=== Résultat : ${passed} OK, ${failed} échec(s) ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Erreur fatale:', e.message);
  console.error('Le backend est-il démarré sur le port 3001 ?');
  process.exit(1);
});
