/**
 * Tests module par module — chaque onglet de l'application.
 * Prérequis : backend démarré (port 3001)
 * Usage : npm run test:modules
 */
const BASE = process.env.API_URL || 'http://localhost:3001/api';

let token = null;
const results = [];

async function req(method, path, body, auth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data, ok: res.status >= 200 && res.status < 300 };
  } finally {
    clearTimeout(timer);
  }
}

function record(module, tab, ok, detail = '') {
  results.push({ module, tab, ok, detail });
  const icon = ok ? '✓' : '✗';
  console.log(`  ${icon} ${tab}${detail ? ` — ${detail}` : ''}`);
}

async function testModule(name, tests) {
  console.log(`\n▸ ${name}`);
  for (const t of tests) {
    try {
      const r = await req(t.method || 'GET', t.path, t.body, t.auth !== false);
      const pass = t.check ? t.check(r) : r.ok;
      record(name, t.tab, pass, pass ? '' : `HTTP ${r.status}`);
    } catch (e) {
      record(name, t.tab, false, e.message);
    }
  }
}

async function run() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  BMB — Tests module par module         ║');
  console.log('╚══════════════════════════════════════╝');

  const health = await req('GET', '/health');
  record('Système', 'Connexion serveur + PostgreSQL', health.ok && health.data?.db === 'ok');

  const login = await req('POST', '/auth/login', { username: 'admin', password: 'admin123' });
  token = login.data?.token;
  record('Système', 'Authentification admin', login.ok && !!token);
  if (!token) {
    console.error('\nArrêt : impossible de se connecter.\n');
    process.exit(1);
  }

  const store = await req('GET', '/settings/store');
  record('Système', 'Paramètres magasin (public)', store.ok);

  await testModule('Tableau de bord', [
    { tab: 'Dashboard KPIs', path: '/dashboard', check: (r) => r.ok && r.data != null },
  ]);

  await testModule('Ventes — Caisse', [
    { tab: 'Points de vente', path: '/delivery-points' },
    { tab: 'Liste paniers', path: '/sales/carts' },
    { tab: 'Client comptoir', path: '/clients?search=COMPTOIR', check: (r) => r.ok && Array.isArray(r.data) && r.data.length > 0 },
    { tab: 'Produits recherche', path: '/products?search=' },
  ]);

  await testModule('Ventes — Encaisser', [
    { tab: 'Paniers à encaisser', path: '/sales/carts?reglement=true&status=en_cours&balance_due=true' },
    { tab: 'Paniers finalisés', path: '/sales/carts?reglement=true&status=finalise' },
    { tab: 'BC règlement', path: '/purchase-orders?reglement=true' },
    { tab: 'Dettes & créances', path: '/settlements/debts-summary' },
    { tab: 'Liste règlements', path: '/settlements?sync_sales=true' },
  ]);

  await testModule('Ventes — Inventaire vente', [
    { tab: 'Ventes par produit', path: '/sales/by-product' },
  ]);

  await testModule('Ventes — Clients', [
    { tab: 'Liste clients', path: '/clients' },
  ]);

  await testModule('Ventes — Factures', [
    { tab: 'Factures pro forma', path: '/proforma' },
  ]);

  await testModule('Ventes — Bons C.', [
    { tab: 'Liste bons commande', path: '/purchase-orders' },
  ]);

  await testModule('Produits — Stocks', [
    { tab: 'Vue stocks', path: '/products/stock/overview' },
    { tab: 'Historique mouvements', path: '/products/stock/history?limit=50' },
  ]);

  await testModule('Produits — Liste', [
    { tab: 'Catalogue produits', path: '/products' },
    { tab: 'Catégories', path: '/categories' },
  ]);

  await testModule('Produits — Inventaire physique', [
    { tab: 'Liste produits (comptage)', path: '/products' },
  ]);

  await testModule('Produits — Fournisseurs', [
    { tab: 'Liste fournisseurs', path: '/suppliers' },
    { tab: 'Types fournisseurs', path: '/suppliers/types' },
  ]);

  await testModule('Employés — Liste', [
    { tab: 'Liste employés', path: '/employees' },
  ]);

  await testModule('Employés — Salaires', [
    { tab: 'Paiements salaires', path: '/employees/salaries' },
  ]);

  await testModule('Employés — Plannings', [
    { tab: 'Plannings', path: '/employees/schedules' },
  ]);

  await testModule('Employés — Performances', [
    { tab: 'Stats ventes vendeurs', path: '/employees/sales-stats' },
  ]);

  await testModule('Finances — Caisse jour', [
    { tab: 'Caisse du jour', path: `/finances/caisse?date=${new Date().toISOString().slice(0, 10)}` },
    {
      tab: 'Résumé clôture caisse',
      path: `/finances/caisse?date=${new Date().toISOString().slice(0, 10)}`,
      check: (r) => r.ok && r.data?.closure_summary != null,
    },
  ]);

  await testModule('Finances — Historique', [
    { tab: 'Historique transactions', path: '/finances/transactions' },
  ]);

  await testModule('Finances — Charges', [
    { tab: 'Liste charges', path: '/finances/charges' },
    { tab: 'Types charges', path: '/finances/charge-types' },
  ]);

  await testModule('Finances — Bilan', [
    { tab: 'Bilan financier', path: '/finances/bilan' },
  ]);

  await testModule('Paramètres — Magasin', [
    { tab: 'Infos magasin', path: '/settings/store', auth: false },
  ]);

  await testModule('Paramètres — Utilisateurs', [
    { tab: 'Liste utilisateurs', path: '/settings/users' },
    { tab: 'Rôles', path: '/settings/roles' },
  ]);

  await testModule('Paramètres — Points de vente', [
    { tab: 'Points de vente', path: '/settings/delivery-points' },
  ]);

  await testModule('Paramètres — Audit', [
    { tab: 'Journal audit', path: '/audit?limit=20' },
    { tab: 'Filtres audit (utilisateurs)', path: '/audit/users' },
    { tab: 'Export audit CSV', path: '/audit/export?limit=5', check: (r) => r.status === 200 },
  ]);

  await testModule('Paramètres — Sauvegardes', [
    { tab: 'Liste sauvegardes', path: '/backups' },
  ]);

  await testModule('Paramètres — Import', [
    { tab: 'Modèles import', path: '/import/templates' },
  ]);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log('\n══════════════════════════════════════');
  console.log(`Résultat : ${passed}/${results.length} onglets OK`);

  if (failed.length) {
    console.log('\nÉchecs :');
    failed.forEach((f) => console.log(`  • [${f.module}] ${f.tab}${f.detail ? ` — ${f.detail}` : ''}`));
  }

  console.log('');
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => {
  console.error('Erreur fatale :', e.message);
  process.exit(1);
});
