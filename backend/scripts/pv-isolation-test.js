/**
 * Tests unitaires logique isolation PV (sans base de données).
 * node backend/scripts/pv-isolation-test.js
 */
import {
  canAccessAllPvs,
  isPvScoped,
  isZoneManager,
  resolveDeliveryPointId,
  assertPvAccess,
  assertEmployeePvAccess,
  pvReceiptSqlClause,
  pvEmployeeSqlClause,
  requiresPvIsolation,
} from '../src/utils/pvScope.js';

let passed = 0;
let failed = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const admin = { id: 1, roles: ['administrateur'], role: 'administrateur' };
const vendeurPv1 = { id: 2, roles: ['vendeur'], delivery_point_id: 10 };
const zoneMgr = { id: 3, roles: ['responsable_zone'], allowed_delivery_point_ids: [10, 20] };

ok('Admin voit tous les PV', canAccessAllPvs(admin));
ok('Vendeur ne voit pas tous les PV', !canAccessAllPvs(vendeurPv1));
ok('Vendeur est scopé', isPvScoped(vendeurPv1));
ok('Admin non scopé', !isPvScoped(admin));
ok('Responsable zone est scopé', isPvScoped(zoneMgr));
ok('isZoneManager', isZoneManager(zoneMgr));

ok('Vendeur résolu sur son PV', resolveDeliveryPointId(vendeurPv1, 99) === 10);
ok('Admin sans filtre', resolveDeliveryPointId(admin, '') === null);
ok('Admin avec filtre', resolveDeliveryPointId(admin, '20') === 20);
ok('Zone manager filtre autorisé', resolveDeliveryPointId(zoneMgr, '20') === 20);
ok('Zone manager filtre refusé', resolveDeliveryPointId(zoneMgr, '99') === null);

try {
  assertPvAccess(vendeurPv1, { id: 1, delivery_point_id: 10 });
  ok('Accès même PV autorisé', true);
} catch {
  ok('Accès même PV autorisé', false);
}

try {
  assertPvAccess(vendeurPv1, { id: 2, delivery_point_id: 20 });
  ok('Accès autre PV refusé', false);
} catch (e) {
  ok('Accès autre PV refusé', e.status === 403);
}

try {
  assertPvAccess(zoneMgr, { id: 3, delivery_point_id: 20 });
  ok('Zone manager PV autorisé', true);
} catch {
  ok('Zone manager PV autorisé', false);
}

const caissierSansPv = { id: 4, roles: ['caissier'] };
const caissierPv2 = { id: 5, roles: ['caissier'], delivery_point_id: 20 };
ok('Caissier sans PV → filtre reçus vide', pvReceiptSqlClause(caissierSansPv).sql.includes('FALSE'));
ok('Caissier PV2 → filtre reçus', pvReceiptSqlClause(caissierPv2).sql.includes('sc.delivery_point_id'));
ok('Admin reçus sans filtre', pvReceiptSqlClause(admin).sql === '');

try {
  assertPvAccess(caissierSansPv, { id: 9, delivery_point_id: 10 });
  ok('Non-admin sans PV refusé', false);
} catch (e) {
  ok('Non-admin sans PV refusé', e.status === 403);
}

ok('Gestionnaire non-admin isolé', requiresPvIsolation({ id: 6, roles: ['gestionnaire'] }));
ok('Comptable non-admin isolé', requiresPvIsolation({ id: 7, roles: ['comptable'] }));

const gestionnairePv1 = { id: 8, roles: ['gestionnaire'], delivery_point_id: 10 };
try {
  assertPvAccess(gestionnairePv1, { id: 11, delivery_point_id: 10 });
  ok('Gestionnaire même PV autorisé', true);
} catch {
  ok('Gestionnaire même PV autorisé', false);
}

const empPv1 = { id: 12, delivery_point_id: 10 };
try {
  await assertEmployeePvAccess(vendeurPv1, empPv1);
  ok('Employé même PV autorisé', true);
} catch {
  ok('Employé même PV autorisé', false);
}

try {
  await assertEmployeePvAccess(vendeurPv1, { id: 13, delivery_point_id: 20 });
  ok('Employé autre PV refusé', false);
} catch (e) {
  ok('Employé autre PV refusé', e.status === 403);
}

ok('Salaires filtrés par PV', pvEmployeeSqlClause(vendeurPv1, 'e', 1).sql.includes('delivery_point_id'));
ok('Admin salaires sans filtre', pvEmployeeSqlClause(admin, 'e', 1).sql === '');

const proformaPv = pvReceiptSqlClause(
  vendeurPv1,
  { paymentAlias: null, cartAlias: 'sc', clientAlias: 'c' },
  1,
);
ok('Proforma sans alias paiement → filtre panier', proformaPv.sql.includes('sc.delivery_point_id'));
ok('Proforma sans alias paiement exclut cp', !proformaPv.sql.includes('cp.delivery_point_id'));

const adminProformaPv = pvReceiptSqlClause(
  admin,
  { paymentAlias: null, cartAlias: 'sc', clientAlias: 'c' },
  1,
  '20',
);
ok('Admin proforma filtre PV demandé', adminProformaPv.sql.includes('= $1') && adminProformaPv.params[0] === 20);

console.log(`\n=== Résultat : ${passed} OK, ${failed} échec(s) ===\n`);
process.exit(failed > 0 ? 1 : 0);
