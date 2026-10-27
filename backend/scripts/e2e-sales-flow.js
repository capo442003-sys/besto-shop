/**
 * Smoke test flux ventes (login → panier → ligne optionnelle).
 * Usage: API_URL=http://localhost:3001/api node backend/scripts/e2e-sales-flow.js
 */
const API_URL = (process.env.API_URL || 'http://localhost:3001/api').replace(/\/$/, '');
const USERNAME = process.env.E2E_USER || 'admin';
const PASSWORD = process.env.E2E_PASS || 'admin123';

let passed = 0;
let failed = 0;
let token = null;

function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(method, path, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = typeof data === 'object' ? data?.message : text;
    throw new Error(`${res.status} ${msg || res.statusText}`);
  }
  return data;
}

async function main() {
  console.log(`\n=== E2E ventes — ${API_URL} ===\n`);

  try {
    const login = await api('POST', '/auth/login', { username: USERNAME, password: PASSWORD }, false);
    token = login.token;
    ok('Login admin', Boolean(token));
  } catch (e) {
    ok('Login admin', false, e.message);
    console.log(`\n=== Résultat : ${passed} OK, ${failed} échec(s) ===\n`);
    process.exit(1);
  }

  let deliveryPointId = null;
  try {
    const points = await api('GET', '/delivery-points');
    deliveryPointId = points?.[0]?.id;
    ok('Points de vente disponibles', Boolean(deliveryPointId), 'aucun PV actif');
  } catch (e) {
    ok('Points de vente disponibles', false, e.message);
  }

  if (!deliveryPointId) {
    console.log(`\n=== Résultat : ${passed} OK, ${failed} échec(s) ===\n`);
    process.exit(failed > 0 ? 1 : 0);
  }

  let cart = null;
  try {
    cart = await api('POST', '/sales/carts', {
      delivery_point_id: deliveryPointId,
      sale_type: 'detail',
      payment_mode: 'especes',
    });
    ok('Création panier', Boolean(cart?.id), cart?.cart_number || '');
  } catch (e) {
    ok('Création panier', false, e.message);
  }

  if (cart?.id) {
    try {
      const productsRes = await api('GET', '/products?limit=5');
      const products = productsRes?.items || productsRes || [];
      const product = Array.isArray(products) ? products[0] : null;
      if (product?.id) {
        const lineRes = await api('POST', `/sales/carts/${cart.id}/lines`, {
          product_id: product.id,
          quantity: 1,
          unit_price: parseFloat(product.retail_price) || 1000,
        });
        ok('Ajout ligne produit', Boolean(lineRes?.line?.id || lineRes?.cart?.id));
      } else {
        console.log('  · Pas de produit — ajout ligne ignoré');
        ok('Ajout ligne produit (skip)', true);
      }
    } catch (e) {
      ok('Ajout ligne produit', false, e.message);
    }

    try {
      const fetched = await api('GET', `/sales/carts/${cart.id}`);
      ok('Lecture panier', fetched?.id === cart.id);
    } catch (e) {
      ok('Lecture panier', false, e.message);
    }
  }

  console.log(`\n=== Résultat : ${passed} OK, ${failed} échec(s) ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
