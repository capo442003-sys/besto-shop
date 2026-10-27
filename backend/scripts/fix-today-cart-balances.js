/**
 * Corrige les paniers soldés en caisse mais affichés avec un reste (arrondis GNF).
 *
 * Usage :
 *   node scripts/fix-today-cart-balances.js
 *   node scripts/fix-today-cart-balances.js --date=2026-06-19
 *   node scripts/fix-today-cart-balances.js --dry-run
 */
import pool from '../src/db/pool.js';
import { balanceDueGnf, roundGnf } from '../src/utils/money.js';
import { reconcileMisreportedCartBalances } from '../src/services/salesService.js';

function parseArgs() {
  const args = process.argv.slice(2);
  let date = new Date().toISOString().slice(0, 10);
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--date=')) date = arg.slice(7);
  }
  return { date, dryRun };
}

async function preview(date) {
  const { rows } = await pool.query(
    `SELECT sc.cart_number, sc.total_amount, sc.amount_paid,
            COALESCE((SELECT SUM(cp.amount) FROM cart_payments cp WHERE cp.cart_id = sc.id), 0) AS payments_sum,
            c.name AS client_name
     FROM sales_carts sc
     LEFT JOIN clients c ON c.id = sc.client_id
     WHERE sc.status != 'annule'
       AND DATE(COALESCE(sc.validated_at, sc.created_at)) = $1::date
       AND COALESCE(sc.total_amount, 0) > 0
     ORDER BY sc.id`,
    [date]
  );
  return rows.filter((r) => balanceDueGnf(r.total_amount, r.amount_paid) > 0);
}

async function main() {
  const { date, dryRun } = parseArgs();
  console.log(`\n══ Correction soldes paniers — ${date}${dryRun ? ' (simulation)' : ''} ══\n`);

  const candidates = await preview(date);
  if (!candidates.length) {
    console.log('Aucun panier avec reste affiché pour cette date.');
    await pool.end();
    return;
  }

  console.log(`${candidates.length} panier(s) avec reste avant correction :\n`);
  for (const c of candidates) {
    const due = balanceDueGnf(c.total_amount, c.amount_paid);
    console.log(
      `  ${c.cart_number} | ${c.client_name || '—'} | total ${roundGnf(c.total_amount)} | `
      + `encaissé ${roundGnf(c.amount_paid)} | reste ${due} | versements ${roundGnf(c.payments_sum)}`
    );
  }

  if (dryRun) {
    console.log('\nSimulation — aucune modification en base.');
    await pool.end();
    return;
  }

  const fixed = await reconcileMisreportedCartBalances({ date });
  console.log(`\n✓ ${fixed.length} panier(s) corrigé(s).\n`);
  for (const f of fixed) {
    console.log(`  ${f.cart_number} : reste ${f.was_due} → 0 (encaissé ${f.was_paid} → ${f.now_paid})`);
  }
  console.log('');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
