import pool from '../db/pool.js';
import { syncMissingSalesDebtSettlements } from './salesService.js';

async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * Run data integrity checks and return structured issues with severity.
 */
export async function runDataHealthChecks() {
  await syncMissingSalesDebtSettlements().catch((e) => {
    console.warn('data-health sync:', e.message);
  });

  const issues = [];

  const [dashboardCreances] = await q(`
    SELECT COALESCE(SUM(balance), 0)::float AS total, COUNT(*)::int AS nb
    FROM settlements
    WHERE settlement_type = 'creance_commerciale'
      AND status = 'en_cours' AND balance > 0.005
  `);

  const [inventaireFinalise] = await q(`
    SELECT COALESCE(SUM(GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0))), 0)::float AS balance_due
    FROM sales_carts sc
    WHERE sc.status = 'finalise'
      AND EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)
  `);

  const ecart = parseFloat(dashboardCreances.total) - parseFloat(inventaireFinalise.balance_due);
  if (Math.abs(ecart) > 0.5) {
    issues.push({
      id: 'creances_ecart',
      severity: Math.abs(ecart) > 10000 ? 'error' : 'warning',
      title: 'Écart créances tableau de bord vs inventaire',
      count: 1,
      detail: `Settlements en cours : ${dashboardCreances.total} GNF (${dashboardCreances.nb}) — paniers finalisés : ${inventaireFinalise.balance_due} GNF — écart ${Math.round(ecart)} GNF`,
      metrics: {
        settlements_total: dashboardCreances.total,
        carts_total: inventaireFinalise.balance_due,
        ecart,
      },
    });
  }

  const cartsSansSettlement = await q(`
    SELECT sc.id, sc.cart_number,
           GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0))::float AS balance_due,
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
    LIMIT 10
  `);

  if (cartsSansSettlement.length) {
    const total = cartsSansSettlement.reduce((s, r) => s + parseFloat(r.balance_due), 0);
    issues.push({
      id: 'carts_sans_creance',
      severity: 'warning',
      title: 'Paniers finalisés avec solde sans créance',
      count: cartsSansSettlement.length,
      detail: `Total restant : ${Math.round(total)} GNF`,
      samples: cartsSansSettlement,
    });
  }

  const settlementsDesync = await q(`
    SELECT sc.cart_number,
           GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0))::float AS cart_balance,
           s.settlement_number, s.balance::float AS settlement_balance,
           (s.balance - GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0)))::float AS ecart
    FROM settlements s
    JOIN sales_carts sc ON sc.id = s.reference_id
    WHERE s.settlement_type = 'creance_commerciale'
      AND COALESCE(s.status, 'en_cours') != 'annule'
      AND ABS(s.balance - GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0))) > 0.5
    ORDER BY ABS(s.balance - GREATEST(0, COALESCE(sc.total_amount, 0) - COALESCE(sc.amount_paid, 0))) DESC
    LIMIT 10
  `);

  if (settlementsDesync.length) {
    issues.push({
      id: 'settlements_desync',
      severity: 'error',
      title: 'Créances désynchronisées (balance ≠ reste panier)',
      count: settlementsDesync.length,
      detail: 'Échantillon des dossiers les plus éloignés',
      samples: settlementsDesync,
    });
  }

  const [clientsNoPv] = await q(`
    SELECT COUNT(*)::int AS cnt FROM clients
    WHERE is_active = TRUE AND delivery_point_id IS NULL AND code != 'COMPTOIR'
  `);

  if (clientsNoPv.cnt > 0) {
    const samples = await q(`
      SELECT id, code, name FROM clients
      WHERE is_active = TRUE AND delivery_point_id IS NULL AND code != 'COMPTOIR'
      ORDER BY name LIMIT 10
    `);
    issues.push({
      id: 'clients_no_pv',
      severity: 'warning',
      title: 'Clients sans point de vente',
      count: clientsNoPv.cnt,
      detail: 'Attribuez un PV pour un filtrage correct',
      samples,
    });
  }

  const [employeesNoPv] = await q(`
    SELECT COUNT(*)::int AS cnt FROM employees
    WHERE is_active = TRUE
      AND function IN ('vendeur', 'vendeur_caissier', 'caissier')
      AND delivery_point_id IS NULL
  `);

  if (employeesNoPv.cnt > 0) {
    const samples = await q(`
      SELECT id, name, function FROM employees
      WHERE is_active = TRUE
        AND function IN ('vendeur', 'vendeur_caissier', 'caissier')
        AND delivery_point_id IS NULL
      ORDER BY name LIMIT 10
    `);
    issues.push({
      id: 'employees_no_pv',
      severity: 'warning',
      title: 'Vendeurs / caissiers sans point de vente',
      count: employeesNoPv.cnt,
      detail: 'Rattachez un PV pour l\'isolation des données',
      samples,
    });
  }

  const [negativeStock] = await q(`
    SELECT COUNT(*)::int AS cnt FROM product_stock WHERE quantity < -0.0001
  `);

  if (negativeStock.cnt > 0) {
    const samples = await q(`
      SELECT ps.id, p.reference, p.name, dp.code AS pv_code, ps.quantity::float AS quantity
      FROM product_stock ps
      JOIN products p ON p.id = ps.product_id
      JOIN delivery_points dp ON dp.id = ps.delivery_point_id
      WHERE ps.quantity < -0.0001
      ORDER BY ps.quantity ASC
      LIMIT 10
    `);
    issues.push({
      id: 'negative_stock',
      severity: 'error',
      title: 'Stocks négatifs',
      count: negativeStock.cnt,
      detail: 'Corrigez via ajustement ou ravitaillement',
      samples,
    });
  }

  const [pvDenials] = await q(`
    SELECT COUNT(*)::int AS cnt FROM audit_log
    WHERE action = 'pv_access_denied'
      AND created_at >= NOW() - INTERVAL '7 days'
  `);

  if (pvDenials.cnt > 0) {
    const samples = await q(`
      SELECT al.created_at, al.details, u.username
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.action = 'pv_access_denied'
        AND al.created_at >= NOW() - INTERVAL '7 days'
      ORDER BY al.created_at DESC
      LIMIT 5
    `);
    issues.push({
      id: 'pv_access_denied',
      severity: 'info',
      title: 'Refus d\'accès PV (7 derniers jours)',
      count: pvDenials.cnt,
      detail: 'Tentatives d\'accès à un autre point de vente',
      samples: samples.map((r) => ({
        at: r.created_at,
        username: r.username,
        ...(typeof r.details === 'object' ? r.details : {}),
      })),
    });
  }

  return {
    checked_at: new Date().toISOString(),
    issue_count: issues.length,
    issues,
  };
}
