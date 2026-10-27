/**
 * Compare créances tableau de bord vs inventaire ventes (reste à payer).
 * Usage: node scripts/diagnose-creances-ecart.js
 */
import pool from '../src/db/pool.js';
import { syncMissingSalesDebtSettlements } from '../src/services/salesService.js';

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

async function main() {
  await syncMissingSalesDebtSettlements().catch((e) => console.warn('Sync:', e.message));

  const [dashboardCreances] = await q(`
    SELECT COALESCE(SUM(balance), 0)::float AS total,
           COUNT(*)::int AS nb
    FROM settlements
    WHERE settlement_type = 'creance_commerciale'
      AND status = 'en_cours' AND balance > 0.005
  `);

  const [inventaireFinalise] = await q(`
    SELECT
      COUNT(*)::int AS cart_count,
      COALESCE(SUM(GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0))), 0)::float AS balance_due
    FROM sales_carts sc
    WHERE sc.status != 'annule'
      AND EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)
      AND sc.status = 'finalise'
  `);

  const [inventaireTous] = await q(`
    SELECT
      COUNT(*)::int AS cart_count,
      COALESCE(SUM(GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0))), 0)::float AS balance_due
    FROM sales_carts sc
    WHERE sc.status != 'annule'
      AND EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)
      AND GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0)) > 0.005
  `);

  const cartsSansSettlement = await q(`
    SELECT sc.id, sc.cart_number, sc.status, sc.total_amount, sc.amount_paid,
           GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0)) AS balance_due,
           c.name AS client_name
    FROM sales_carts sc
    LEFT JOIN clients c ON c.id = sc.client_id
    WHERE sc.status = 'finalise'
      AND sc.client_id IS NOT NULL
      AND GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0)) > 0.005
      AND NOT EXISTS (
        SELECT 1 FROM settlements s
        WHERE s.reference_id = sc.id AND s.settlement_type = 'creance_commerciale'
          AND COALESCE(s.status, 'en_cours') != 'annule'
      )
    ORDER BY balance_due DESC
    LIMIT 20
  `);

  const settlementsDesync = await q(`
    SELECT sc.id, sc.cart_number, sc.total_amount, sc.amount_paid,
           GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0)) AS cart_balance,
           s.id AS settlement_id, s.settlement_number, s.balance AS settlement_balance,
           s.status AS settlement_status,
           (s.balance - GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0)))::float AS ecart
    FROM settlements s
    JOIN sales_carts sc ON sc.id = s.reference_id
    WHERE s.settlement_type = 'creance_commerciale'
      AND COALESCE(s.status, 'en_cours') != 'annule'
      AND ABS(s.balance - GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0))) > 0.5
    ORDER BY ABS(s.balance - GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0))) DESC
    LIMIT 30
  `);

  const settlementsOrphelins = await q(`
    SELECT s.id, s.settlement_number, s.balance, s.status, s.reference_id, c.name AS client_name
    FROM settlements s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.settlement_type = 'creance_commerciale'
      AND s.status = 'en_cours' AND s.balance > 0.005
      AND (s.reference_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM sales_carts sc WHERE sc.id = s.reference_id AND sc.status != 'annule'
      ))
    ORDER BY s.balance DESC
    LIMIT 20
  `);

  const enCoursAvecSolde = await q(`
    SELECT sc.id, sc.cart_number, sc.total_amount, sc.amount_paid,
           GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0)) AS balance_due,
           c.name AS client_name
    FROM sales_carts sc
    LEFT JOIN clients c ON c.id = sc.client_id
    WHERE sc.status = 'en_cours'
      AND EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)
      AND GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0)) > 0.005
    ORDER BY balance_due DESC
    LIMIT 20
  `);

  const settlementsEnCoursPasDansInventaire = await q(`
    SELECT COALESCE(SUM(s.balance), 0)::float AS total, COUNT(*)::int AS nb
    FROM settlements s
    JOIN sales_carts sc ON sc.id = s.reference_id
    WHERE s.settlement_type = 'creance_commerciale'
      AND s.status = 'en_cours' AND s.balance > 0.005
      AND sc.status != 'finalise'
  `);

  const creancesSoldeMaisBalance = await q(`
    SELECT s.id, s.settlement_number, s.balance, s.status, sc.cart_number
    FROM settlements s
    LEFT JOIN sales_carts sc ON sc.id = s.reference_id
    WHERE s.settlement_type = 'creance_commerciale'
      AND s.status = 'solde' AND s.balance > 0.005
    LIMIT 10
  `);

  const ecart = dashboardCreances.total - inventaireFinalise.balance_due;

  console.log('\n=== COMPARAISON CRÉANCES ===\n');
  console.log('Tableau de bord (settlements creance_commerciale en_cours):',
    dashboardCreances.total, `GNF — ${dashboardCreances.nb} dossier(s)`);
  console.log('Inventaire ventes (paniers finalisés, somme reste panier):',
    inventaireFinalise.balance_due, `GNF — ${inventaireFinalise.cart_count} panier(s)`);
  console.log('Inventaire (tous statuts hors annulé, reste > 0):',
    inventaireTous.balance_due, `GNF — ${inventaireTous.cart_count} panier(s)`);
  console.log('\nÉCART dashboard − inventaire finalisé:', ecart, 'GNF\n');

  console.log('--- Causes possibles ---');
  console.log('Paniers finalisés avec solde SANS créance:', cartsSansSettlement.length,
    '— total:',
    cartsSansSettlement.reduce((s, r) => s + parseFloat(r.balance_due), 0));
  console.log('Créances désynchronisées (balance ≠ reste panier):', settlementsDesync.length,
    '— somme écarts:',
    settlementsDesync.reduce((s, r) => s + parseFloat(r.ecart), 0));
  console.log('Créances orphelines (pas de panier valide):', settlementsOrphelins.length,
    '— total:',
    settlementsOrphelins.reduce((s, r) => s + parseFloat(r.balance), 0));
  console.log('Paniers en_cours avec solde (hors inventaire défaut):', enCoursAvecSolde.length,
    '— total:',
    enCoursAvecSolde.reduce((s, r) => s + parseFloat(r.balance_due), 0));
  console.log('Créances liées à paniers NON finalisés:',
    settlementsEnCoursPasDansInventaire.total, `GNF (${settlementsEnCoursPasDansInventaire.nb})`);
  console.log('Créances statut solde mais balance > 0:', creancesSoldeMaisBalance.length);

  if (cartsSansSettlement.length) {
    console.log('\nTop paniers sans créance:');
    cartsSansSettlement.forEach((r) => console.log(`  ${r.cart_number} ${r.client_name} ${r.balance_due}`));
  }
  if (settlementsDesync.length) {
    console.log('\nTop désynchronisations settlement vs panier:');
    settlementsDesync.forEach((r) => console.log(
      `  ${r.cart_number} panier=${r.cart_balance} créance=${r.settlement_balance} écart=${r.ecart}`
    ));
  }
  if (settlementsOrphelins.length) {
    console.log('\nCréances orphelines:');
    settlementsOrphelins.forEach((r) => console.log(`  ${r.settlement_number} ${r.balance} ref=${r.reference_id}`));
  }
  if (enCoursAvecSolde.length) {
    console.log('\nPaniers en cours avec solde:');
    enCoursAvecSolde.forEach((r) => console.log(`  ${r.cart_number} ${r.client_name} ${r.balance_due}`));
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
