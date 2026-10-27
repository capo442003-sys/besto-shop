import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { syncMissingSalesDebtSettlements, getClientReceivablesSummary, getSettlementCreancesSummary } from '../services/salesService.js';
import { isSellerScoped } from '../utils/sellerScope.js';
import {
  isPvScoped,
  resolveDeliveryPointId,
  requiresPvIsolation,
  pvCartSqlClause,
  pvSettlementSqlClause,
  pvCashSqlClause,
  pvEmployeeSqlClause,
  pvClientSqlClause,
} from '../utils/pvScope.js';
import { stockSqlForPv } from '../utils/stockSync.js';
import { ACTIVE_CASH_TX_AND } from '../utils/cashTransactionSql.js';
import { CART_BALANCE_DUE_SQL } from '../utils/cartBalanceSql.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
router.use(authenticate);

/** Une ligne par produit actif — stock filtré par PV si employé rattaché */
function buildProductsStockBase(deliveryPointId) {
  const stockSql = stockSqlForPv(deliveryPointId);
  return `
  SELECT p.id, p.min_stock, COALESCE(p.purchase_price, 0) AS purchase_price,
         COALESCE(c.name, 'Sans catégorie') AS category,
         ${stockSql} AS total_stock
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.is_active = TRUE
`;
}

function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function mergeDailySeries(days, rows, valueKey = 'montant') {
  const map = new Map(rows.map((r) => [String(r.jour).slice(0, 10), parseFloat(r[valueKey] || 0)]));
  return days.map((jour) => ({
    jour,
    label: new Date(`${jour}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
    montant: map.get(jour) || 0,
    paniers: rows.find((r) => String(r.jour).slice(0, 10) === jour)?.paniers ?? 0,
  }));
}

router.get('/', asyncHandler(async (req, res) => {
  try {
  const today = new Date().toISOString().slice(0, 10);
  const days7 = lastNDays(7);
  const scoped = isSellerScoped(req.user);
  const requestedPv = req.query.delivery_point_id;
  const sellerId = scoped ? req.user.employee_id : null;
  const deliveryPointId = resolveDeliveryPointId(req.user, requestedPv);
  const productsStockBase = buildProductsStockBase(deliveryPointId);
  const sellerParam = scoped ? [today, sellerId] : [today];
  const sellerClauseSc = scoped ? ' AND sc.seller_id = $2' : '';
  const sellerOnlyClause = scoped ? ' AND sc.seller_id = $1' : '';

  const ventesParams = [...sellerParam];
  const ventesPv = pvCartSqlClause(req.user, 'sc', ventesParams.length + 1, requestedPv);
  ventesParams.push(...ventesPv.params);

  const caParams = scoped ? [sellerId] : [];
  const caPv = pvCartSqlClause(req.user, 'sc', caParams.length + 1, requestedPv);
  caParams.push(...caPv.params);

  const cashTodayParams = [today];
  const cashTodayPv = pvCashSqlClause(req.user, 'ct', cashTodayParams.length + 1, requestedPv);
  cashTodayParams.push(...cashTodayPv.params);

  const stockAlertParams = [];
  const stockAlertPv = pvClientSqlClause(req.user, 'ps', stockAlertParams.length + 1, requestedPv);
  stockAlertParams.push(...stockAlertPv.params);

  const dettesParams = scoped ? [sellerId] : [];
  let dettesQuery;
  if (scoped) {
    dettesQuery = `SELECT settlement_type, SUM(s.balance) AS total
           FROM settlements s
           JOIN sales_carts sc ON sc.id = s.reference_id
           WHERE s.status = 'en_cours' AND s.balance > 0.005 AND sc.seller_id = $1
           GROUP BY s.settlement_type`;
  } else {
    const dettesPv = pvSettlementSqlClause(req.user, {}, dettesParams.length + 1, requestedPv);
    dettesParams.push(...dettesPv.params);
    dettesQuery = `SELECT s.settlement_type, SUM(s.balance) AS total
           FROM settlements s
           LEFT JOIN sales_carts sc ON sc.id = s.reference_id
           LEFT JOIN clients c ON c.id = s.client_id
           WHERE s.status = 'en_cours' AND s.balance > 0.005${dettesPv.sql}
           GROUP BY s.settlement_type`;
  }

  const vendeursParams = scoped ? [today, sellerId] : [today];
  let vendeursQuery;
  if (scoped) {
    vendeursQuery = `SELECT e.name, COUNT(sc.id) AS paniers, COALESCE(SUM(sc.total_amount),0) AS total
           FROM employees e
           LEFT JOIN sales_carts sc ON sc.seller_id = e.id AND sc.status='finalise' AND DATE(sc.validated_at)=$1
           WHERE e.id = $2
           GROUP BY e.id`;
  } else {
    const vendeursEmpPv = pvEmployeeSqlClause(req.user, 'e', vendeursParams.length + 1, requestedPv);
    vendeursParams.push(...vendeursEmpPv.params);
    const vendeursCartPv = pvCartSqlClause(req.user, 'sc', vendeursParams.length + 1, requestedPv);
    vendeursParams.push(...vendeursCartPv.params);
    vendeursQuery = `SELECT e.name, COUNT(sc.id) AS paniers, COALESCE(SUM(sc.total_amount),0) AS total
           FROM employees e
           LEFT JOIN sales_carts sc ON sc.seller_id = e.id AND sc.status='finalise' AND DATE(sc.validated_at)=$1${vendeursCartPv.sql}
           WHERE e.function IN ('vendeur','vendeur_caissier','caissier') AND e.is_active = TRUE${vendeursEmpPv.sql}
           GROUP BY e.id ORDER BY total DESC LIMIT 10`;
  }

  const paniersParams = scoped ? [sellerId] : [];
  const paniersPv = pvCartSqlClause(req.user, 'sc', paniersParams.length + 1, requestedPv);
  paniersParams.push(...paniersPv.params);

  const topParams = [...sellerParam];
  const topPv = pvCartSqlClause(req.user, 'sc', topParams.length + 1, requestedPv);
  topParams.push(...topPv.params);

  const evoCaParams = scoped ? [sellerId] : [];
  const evoCaPv = pvCartSqlClause(req.user, 'sc', evoCaParams.length + 1, requestedPv);
  evoCaParams.push(...evoCaPv.params);

  const evoEncParams = [];
  const evoEncPv = pvCashSqlClause(req.user, 'ct', evoEncParams.length + 1, requestedPv);
  evoEncParams.push(...evoEncPv.params);

  const creditParams = scoped ? [sellerId] : [];
  const creditPv = pvCartSqlClause(req.user, 'sc', creditParams.length + 1, requestedPv);
  creditParams.push(...creditPv.params);

  const dettesEchuesParams = [];
  const dettesEchuesPv = pvSettlementSqlClause(req.user, {}, dettesEchuesParams.length + 1, requestedPv);
  dettesEchuesParams.push(...dettesEchuesPv.params);

  const marginParams = [...sellerParam];
  const marginPv = pvCartSqlClause(req.user, 'sc', marginParams.length + 1, requestedPv);
  marginParams.push(...marginPv.params);

  await syncMissingSalesDebtSettlements().catch((err) => {
    console.error('Sync dettes (dashboard):', err.message);
  });

  const [
    ventesJour,
    caSemaine,
    caSemainePrecedente,
    caMois,
    caisse,
    alertes,
    alertCount,
    dettes,
    vendeurs,
    stockGeneral,
    paniersAttente,
    topProduits,
    evolutionCa,
    evolutionEncaissements,
    stockParCategorie,
    creditFinalise,
    dettesEchues,
    caisseHier,
    storePrefs,
    marginToday,
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS paniers,
              COALESCE(SUM(sc.total_amount),0) AS montant,
              COALESCE(SUM(sc.amount_paid),0) AS encaisse,
              COALESCE(SUM((${CART_BALANCE_DUE_SQL})), 0) AS reste
       FROM sales_carts sc
       WHERE sc.status = 'finalise' AND DATE(sc.validated_at) = $1${sellerClauseSc}${ventesPv.sql}`,
      ventesParams
    ),
    pool.query(
      `SELECT COALESCE(SUM(sc.total_amount),0) AS montant FROM sales_carts sc
       WHERE sc.status = 'finalise' AND sc.validated_at >= NOW() - INTERVAL '7 days'${sellerOnlyClause}${caPv.sql}`,
      caParams
    ),
    pool.query(
      `SELECT COALESCE(SUM(sc.total_amount),0) AS montant FROM sales_carts sc
       WHERE sc.status = 'finalise'
         AND sc.validated_at >= NOW() - INTERVAL '14 days'
         AND sc.validated_at < NOW() - INTERVAL '7 days'${sellerOnlyClause}${caPv.sql}`,
      caParams
    ),
    pool.query(
      `SELECT COALESCE(SUM(sc.total_amount),0) AS montant FROM sales_carts sc
       WHERE sc.status = 'finalise' AND sc.validated_at >= DATE_TRUNC('month', NOW())${sellerOnlyClause}${caPv.sql}`,
      caParams
    ),
    pool.query(
      `SELECT COALESCE(SUM(CASE WHEN ct.transaction_type='recette' THEN ct.amount ELSE -ct.amount END),0) AS solde
       FROM cash_transactions ct
       WHERE ct.cash_date = $1 ${ACTIVE_CASH_TX_AND}${cashTodayPv.sql}`,
      cashTodayParams
    ),
    pool.query(
      `SELECT p.id, p.name, p.reference, ps.quantity, p.min_stock, dp.code AS pv_code
       FROM products p
       JOIN product_stock ps ON ps.product_id = p.id
       JOIN delivery_points dp ON dp.id = ps.delivery_point_id AND dp.is_active = TRUE
       WHERE p.is_active = TRUE${stockAlertPv.sql}
         AND ps.quantity <= p.min_stock
       ORDER BY ps.quantity ASC
       LIMIT 20`,
      stockAlertParams
    ),
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM (
         SELECT p.id FROM products p
         JOIN product_stock ps ON ps.product_id = p.id
         JOIN delivery_points dp ON dp.id = ps.delivery_point_id AND dp.is_active = TRUE
         WHERE p.is_active = TRUE${stockAlertPv.sql}
           AND ps.quantity <= p.min_stock
       ) x`,
      stockAlertParams
    ),
    pool.query(dettesQuery, dettesParams),
    pool.query(vendeursQuery, vendeursParams),
    pool.query(
      `SELECT
         COUNT(*)::int AS produits_actifs,
         COALESCE(SUM(s.total_stock), 0) AS quantite_totale,
         COALESCE(SUM(s.total_stock * s.purchase_price), 0) AS valeur_achat,
         COUNT(*) FILTER (WHERE s.total_stock <= 0)::int AS epuises,
         COUNT(*) FILTER (WHERE s.total_stock > 0 AND s.total_stock <= s.min_stock)::int AS alertes,
         COUNT(*) FILTER (WHERE s.total_stock > s.min_stock)::int AS ok_count
       FROM (${productsStockBase}) s`
    ),
    pool.query(
      `SELECT sc.id, sc.cart_number, sc.total_amount, sc.amount_paid, sc.status,
              (${CART_BALANCE_DUE_SQL}) AS balance_due,
              c.name AS client_name
       FROM sales_carts sc
       LEFT JOIN clients c ON c.id = sc.client_id
       WHERE sc.status = 'en_cours'
         AND EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)
         AND (${CART_BALANCE_DUE_SQL}) > 0.005
         ${scoped ? 'AND sc.seller_id = $1' : ''}${paniersPv.sql}
       ORDER BY sc.created_at DESC LIMIT 15`,
      paniersParams
    ),
    pool.query(
      `SELECT p.name, p.reference,
              COALESCE(c.name, 'Sans catégorie') AS category,
              COALESCE(p.retail_price, 0) AS sale_price,
              SUM(sl.quantity) AS quantity,
              SUM(sl.line_total) AS total
       FROM sale_lines sl
       JOIN sales_carts sc ON sc.id = sl.cart_id
       JOIN products p ON p.id = sl.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE sc.status = 'finalise' AND DATE(sc.validated_at) = $1
         ${scoped ? 'AND sc.seller_id = $2' : ''}${topPv.sql}
       GROUP BY p.id, p.name, p.reference, c.name, p.retail_price
       ORDER BY total DESC LIMIT 8`,
      topParams
    ),
    pool.query(
      `SELECT DATE(sc.validated_at) AS jour,
              COALESCE(SUM(sc.total_amount), 0) AS montant,
              COUNT(*)::int AS paniers
       FROM sales_carts sc
       WHERE sc.status = 'finalise'
         AND sc.validated_at >= CURRENT_DATE - INTERVAL '6 days'
         ${scoped ? 'AND sc.seller_id = $1' : ''}${evoCaPv.sql}
       GROUP BY DATE(sc.validated_at)
       ORDER BY jour`,
      evoCaParams
    ),
    pool.query(
      `SELECT ct.cash_date AS jour, COALESCE(SUM(ct.amount), 0) AS montant
       FROM cash_transactions ct
       WHERE ct.transaction_type = 'recette'
         AND ct.cash_date >= CURRENT_DATE - INTERVAL '6 days'
         ${ACTIVE_CASH_TX_AND}${evoEncPv.sql}
       GROUP BY ct.cash_date
       ORDER BY jour`,
      evoEncParams
    ),
    pool.query(
      `SELECT s.category,
              COALESCE(SUM(s.total_stock), 0) AS quantite,
              COALESCE(SUM(s.total_stock * s.purchase_price), 0) AS valeur_achat
       FROM (${productsStockBase}) s
       GROUP BY s.category
       ORDER BY quantite DESC
       LIMIT 8`
    ),
    pool.query(
      `SELECT sc.id, sc.cart_number, sc.total_amount, sc.amount_paid,
              (${CART_BALANCE_DUE_SQL}) AS balance_due,
              c.name AS client_name
       FROM sales_carts sc
       LEFT JOIN clients c ON c.id = sc.client_id
       WHERE sc.status = 'finalise'
         AND (${CART_BALANCE_DUE_SQL}) > 0.005
         ${scoped ? 'AND sc.seller_id = $1' : ''}${creditPv.sql}
       ORDER BY sc.validated_at DESC LIMIT 10`,
      creditParams
    ),
    pool.query(
      `SELECT s.id, s.settlement_number, s.balance, s.due_date, c.name AS client_name
       FROM settlements s
       LEFT JOIN clients c ON c.id = s.client_id
       LEFT JOIN sales_carts sc ON sc.id = s.reference_id
       WHERE s.status = 'en_cours' AND s.balance > 0.005
         AND s.due_date IS NOT NULL AND s.due_date < CURRENT_DATE${dettesEchuesPv.sql}
       ORDER BY s.due_date ASC LIMIT 15`,
      dettesEchuesParams
    ),
    pool.query(
      `SELECT closed_at FROM daily_cash WHERE cash_date = CURRENT_DATE - INTERVAL '1 day'`
    ),
    pool.query('SELECT * FROM store_settings LIMIT 1').catch(() => ({ rows: [{}] })),
    pool.query(
      `SELECT
         COALESCE(SUM(sl.line_total), 0)::float AS revenue,
         COALESCE(SUM(sl.quantity * COALESCE(sl.purchase_price_snapshot, p.purchase_price, 0)), 0)::float AS cost
       FROM sale_lines sl
       JOIN sales_carts sc ON sc.id = sl.cart_id
       JOIN products p ON p.id = sl.product_id
       WHERE sc.status = 'finalise' AND DATE(sc.validated_at) = $1
         ${scoped ? 'AND sc.seller_id = $2' : ''}${marginPv.sql}`,
      marginParams
    ),
  ]);

  const ventesTotal = parseFloat(ventesJour.rows[0].montant);
  const encaisseJour = parseFloat(ventesJour.rows[0].encaisse);
  const resteJour = parseFloat(ventesJour.rows[0].reste);
  const stockGen = stockGeneral.rows[0] || {};

  const receivablesFilters = scoped && sellerId
    ? { seller_id: String(sellerId) }
    : requiresPvIsolation(req.user)
      ? { user: req.user, delivery_point_id: requestedPv || undefined }
      : (deliveryPointId != null ? { delivery_point_id: String(deliveryPointId) } : {});
  const settlementCreancesFilters = scoped && sellerId
    ? { seller_id: sellerId }
    : requiresPvIsolation(req.user)
      ? { user: req.user, requestedPvId: requestedPv }
      : (deliveryPointId != null ? { delivery_point_id: deliveryPointId } : {});
  const [receivablesSummary, settlementCreances] = await Promise.all([
    getClientReceivablesSummary(receivablesFilters),
    getSettlementCreancesSummary(settlementCreancesFilters),
  ]);
  const creancesTotal = parseFloat(receivablesSummary.balance_due || 0);
  const creancesCount = parseInt(receivablesSummary.unpaid_cart_count || 0, 10);
  const settlementsCreancesTotal = parseFloat(settlementCreances.total || 0);

  const marginRow = marginToday.rows[0] || {};
  const marginTodayValue = parseFloat(marginRow.revenue || 0) - parseFloat(marginRow.cost || 0);

  res.json({
    scope: scoped ? 'seller' : 'all',
    seller_name: scoped ? req.user.full_name : null,
    ventes_jour: {
      paniers: ventesJour.rows[0].paniers,
      montant: ventesTotal,
      encaisse: encaisseJour,
      reste: resteJour,
    },
    chiffre_affaires: {
      jour: ventesTotal,
      semaine: parseFloat(caSemaine.rows[0].montant),
      semaine_precedente: parseFloat(caSemainePrecedente.rows[0].montant),
      mois: parseFloat(caMois.rows[0].montant),
    },
    benefices_estimes: ventesTotal - ventesTotal * 0.7,
    caisse: parseFloat(caisse.rows[0].solde),
    alertes_stock: alertes.rows,
    alertes_stock_count: alertCount.rows[0]?.cnt || 0,
    dettes_creances: dettes.rows,
    vendeurs_jour: vendeurs.rows,
    stock_general: {
      produits_actifs: parseInt(stockGen.produits_actifs || 0, 10),
      quantite_totale: parseFloat(stockGen.quantite_totale || 0),
      ok_count: parseInt(stockGen.ok_count || 0, 10),
      alertes: parseInt(stockGen.alertes || 0, 10),
      epuises: parseInt(stockGen.epuises || 0, 10),
      valeur_achat: parseFloat(stockGen.valeur_achat || 0),
    },
    paniers_en_attente: paniersAttente.rows,
    credits_clients: creditFinalise.rows,
    top_produits_jour: topProduits.rows,
    evolution_ca_7j: mergeDailySeries(days7, evolutionCa.rows),
    evolution_encaissements_7j: mergeDailySeries(days7, evolutionEncaissements.rows),
    valeur_stock: {
      produits_actifs: parseInt(stockGen.produits_actifs || 0, 10),
      quantite_totale: parseFloat(stockGen.quantite_totale || 0),
      valeur_achat: parseFloat(stockGen.valeur_achat || 0),
    },
    creances_clients: {
      total: creancesTotal,
      count: creancesCount,
      source: 'paniers',
      settlements_total: settlementsCreancesTotal,
      ecart_settlements: Math.round(settlementsCreancesTotal - creancesTotal),
    },
    stock_par_categorie: stockParCategorie.rows.map((r) => ({
      category: r.category,
      quantite: parseFloat(r.quantite || 0),
      valeur_achat: parseFloat(r.valeur_achat || 0),
    })),
    dettes_echeues: dettesEchues.rows,
    dettes_echeues_count: dettesEchues.rows.length,
    caisse_hier_non_cloturee: caisseHier.rows.length > 0 && !caisseHier.rows[0].closed_at,
    inventory_lock: Boolean(storePrefs.rows[0]?.inventory_lock),
    theme: storePrefs.rows[0]?.theme || 'light',
    margin_today: marginTodayValue,
  });
  } catch (err) {
    console.error('Dashboard:', err);
    res.status(500).json({
      message: 'Impossible de charger le tableau de bord',
      detail: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
}));

router.get('/by-pv', asyncHandler(async (req, res) => {
  try {
    const { canAccessAllPvs, isZoneManager } = await import('../utils/pvScope.js');
    const { getClientsReceivablesAggregate } = await import('../services/salesService.js');
    if (!canAccessAllPvs(req.user) && !isZoneManager(req.user)) {
      return res.status(403).json({ message: 'Accès réservé à l\'administrateur ou responsable de zone' });
    }
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = new Date();
    monthStart.setDate(1);
    const monthKey = monthStart.toISOString().slice(0, 10);
    let pvQuery = 'SELECT id, code, name FROM delivery_points WHERE is_active = TRUE ORDER BY code';
    const pvParams = [];
    if (isZoneManager(req.user)) {
      const ids = req.user.allowed_delivery_point_ids || [];
      if (!ids.length) return res.json([]);
      pvParams.push(ids);
      pvQuery = `SELECT id, code, name FROM delivery_points
                 WHERE is_active = TRUE AND id = ANY($1::int[]) ORDER BY code`;
    }
    const { rows: pvs } = await pool.query(pvQuery, pvParams);
    const { rows: objectives } = await pool.query(
      `SELECT delivery_point_id, target_ca::float AS target_ca
       FROM pv_objectives WHERE month = DATE_TRUNC('month', CURRENT_DATE)::date`
    ).catch(() => ({ rows: [] }));
    const objectiveByPv = new Map(objectives.map((o) => [o.delivery_point_id, parseFloat(o.target_ca || 0)]));

    const results = await Promise.all(pvs.map(async (pv) => {
      const pvId = pv.id;
      const [ventes, creances, stockAlertes, paniers] = await Promise.all([
        pool.query(
          `SELECT COUNT(*)::int AS paniers, COALESCE(SUM(total_amount),0)::float AS montant
           FROM sales_carts
           WHERE status = 'finalise' AND DATE(validated_at) = $1 AND delivery_point_id = $2`,
          [today, pvId]
        ),
        getClientsReceivablesAggregate({ delivery_point_id: pvId }),
        pool.query(
          `SELECT COUNT(*)::int AS cnt FROM products p
           JOIN product_stock ps ON ps.product_id = p.id
           WHERE p.is_active = TRUE AND ps.delivery_point_id = $1 AND ps.quantity <= p.min_stock`,
          [pvId]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS cnt FROM sales_carts sc
           WHERE sc.status = 'en_cours' AND sc.delivery_point_id = $1
             AND EXISTS (SELECT 1 FROM sale_lines sl WHERE sl.cart_id = sc.id)`,
          [pvId]
        ),
      ]);
      const caJour = parseFloat(ventes.rows[0]?.montant || 0);
      const targetCa = objectiveByPv.get(pvId) || 0;
      const progressPct = targetCa > 0 ? Math.min(100, Math.round((caJour / targetCa) * 1000) / 10) : null;
      return {
        id: pv.id,
        code: pv.code,
        name: pv.name,
        ventes_jour: {
          paniers: ventes.rows[0]?.paniers || 0,
          montant: caJour,
        },
        objective: {
          target_ca: targetCa,
          progress_pct: progressPct,
          month: monthKey,
        },
        creances: parseFloat(creances.total_balance_due || 0),
        clients_avec_dette: parseInt(creances.clients_with_debt || 0, 10),
        alertes_stock: parseInt(stockAlertes.rows[0]?.cnt || 0, 10),
        paniers_en_cours: parseInt(paniers.rows[0]?.cnt || 0, 10),
      };
    }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}));

export default router;
