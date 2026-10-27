import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../context/AuthContext';
import { useStoreSettings } from '../context/StoreSettingsContext';
import { usePwa } from '../context/PwaContext';
import useApiHealth from '../hooks/useApiHealth';
import { formatGNF, formatQty, formatDate } from '../utils/format';
import { apiErrorMessage } from '../utils/apiError';
import { BRAND_FEATURES } from '../config/brandAssets';
import { canAccessReglement, isSellerScoped } from '../utils/sellerScope';
import { canAccessAllPvs, isZoneManager, stockQueryParams } from '../utils/pvScope';
import { usePvFilter } from '../context/PvFilterContext';
import PvFilterBar from '../components/PvFilterBar';
import SellerDashView from '../components/dashboard/SellerDashView';
import { NavIcon } from '../components/NavIcons';
import { pvDisplayLabel } from '../utils/pvScope';

const MGR_QUICK_ACTIONS = [
  { to: '/ventes/inventaire', label: 'Ventes', sub: 'Suivi du jour', icon: 'ventes', module: 'ventes', action: 'view', tone: '' },
  { to: '/produits/stocks', label: 'Stocks', sub: 'Alertes & niveaux', icon: 'stock', module: 'produits', action: 'view', tone: '' },
  { to: '/finances/caisse', label: 'Caisse', sub: 'Trésorerie', icon: 'finances', module: 'finances', action: 'view', tone: 'blue' },
  { to: '/ventes/reglement', label: 'Encaisser', sub: 'Règlements', icon: 'clients', module: 'ventes', action: 'edit', tone: 'amber', requireReglement: true },
  { to: '/ventes/clients', label: 'Clients', sub: 'Comptes', icon: 'clients', module: 'ventes', action: 'view', tone: '' },
  { to: '/employes/liste', label: 'Équipe', sub: 'Employés', icon: 'employes', module: 'employes', action: 'view', tone: '' },
];

const ADMIN_QUICK_ACTIONS = [
  { to: '/parametres/utilisateurs', label: 'Utilisateurs', sub: 'Administration', icon: 'parametres', module: 'parametres', action: 'view', tone: 'blue' },
  { to: '/ventes/inventaire', label: 'Ventes', sub: 'Inventaire', icon: 'ventes', module: 'ventes', action: 'view', tone: '' },
  { to: '/finances/caisse', label: 'Caisse', sub: 'Trésorerie', icon: 'finances', module: 'finances', action: 'view', tone: '' },
  { to: '/produits/stocks', label: 'Stocks', sub: 'Alertes', icon: 'stock', module: 'produits', action: 'view', tone: '' },
  { to: '/employes/liste', label: 'Employés', sub: 'Équipe', icon: 'employes', module: 'employes', action: 'view', tone: '' },
  { to: '/ventes/vendre', label: 'Caisse POS', sub: 'Nouvelle vente', icon: 'caisse', module: 'ventes', action: 'create', tone: 'amber' },
];

const TRUST_ITEMS = BRAND_FEATURES.map((f, i) => ({
  title: f.label,
  text: [
    'Sélection rigoureuse de produits de qualité.',
    'Produits soigneusement contrôlés.',
    'Une équipe dédiée à votre satisfaction.',
    'BESTO SHOP, au service de votre performance.',
  ][i] || f.label,
}));

function pctTrend(current, previous) {
  const c = parseFloat(current) || 0;
  const p = parseFloat(previous) || 0;
  if (p <= 0) return null;
  return { pct: Math.abs(((c - p) / p) * 100), up: c >= p };
}

function formatTrend(trend, suffix) {
  if (!trend) return null;
  const arrow = trend.up ? '↗' : '↘';
  const sign = trend.up ? '+' : '-';
  return `${arrow} ${sign}${trend.pct.toFixed(1).replace('.', ',')}% ${suffix}`;
}

function formatAxisValue(val) {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (val >= 1_000) return `${Math.round(val / 1_000)}k`;
  return String(Math.round(val));
}

function KpiCard({ variant, label, value, trend, sub, linkTo, icon }) {
  return (
    <article className={`bmb-dash-erp-kpi bmb-dash-erp-kpi--${variant}`}>
      <div className="bmb-dash-erp-kpi__head">
        <span className="bmb-dash-erp-kpi__label">{label}</span>
        <span className="bmb-dash-erp-kpi__icon" aria-hidden>{icon}</span>
      </div>
      <div className="bmb-dash-erp-kpi__value">{value}</div>
      {trend && (
        <div className={`bmb-dash-erp-kpi__trend${trend.startsWith('↘') ? ' is-down' : ''}`}>{trend}</div>
      )}
      {sub && !trend && <div className="bmb-dash-erp-kpi__sub">{sub}</div>}
      {linkTo && <Link to={linkTo} className="bmb-dash-erp-kpi__link">Voir le détail</Link>}
    </article>
  );
}

function MiniStat({ label, value, sub }) {
  return (
    <div className="bmb-dash-erp-stat">
      <div className="bmb-dash-erp-stat__label">{label}</div>
      <div className="bmb-dash-erp-stat__value">{value}</div>
      {sub && <div className="bmb-dash-erp-stat__sub">{sub}</div>}
    </div>
  );
}

function DashSection({ title, hint, children }) {
  return (
    <section className="bmb-dash-mgr-section">
      <div className="bmb-dash-mgr-section__head">
        <h2 className="bmb-dash-mgr-section__title">{title}</h2>
        {hint && <span className="bmb-dash-mgr-section__hint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function DashPanel({ title, action, children, className = '' }) {
  return (
    <section className={`bmb-dash-erp-panel ${className}`.trim()}>
      <div className="bmb-dash-erp-panel__head">
        <h2 className="bmb-dash-erp-panel__title">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ErpBarChart({ data, valueKey = 'montant', barClass = '' }) {
  const max = useMemo(
    () => Math.max(...data.map((d) => parseFloat(d[valueKey] || 0)), 1),
    [data, valueKey]
  );
  const yTicks = useMemo(() => {
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => (max / steps) * (steps - i));
  }, [max]);

  if (!data.length) {
    return <p className="bmb-dash-erp-empty">Pas de données sur cette période</p>;
  }

  return (
    <div className="bmb-dash-erp-chart" role="img" aria-label="Graphique">
      <div className="bmb-dash-erp-chart__y-axis" aria-hidden>
        {yTicks.map((tick) => (
          <span key={tick}>{formatAxisValue(tick)}</span>
        ))}
      </div>
      <div className="bmb-dash-erp-chart__plot">
        <div className="bmb-dash-erp-chart__bars">
          {data.map((d) => {
            const val = parseFloat(d[valueKey] || 0);
            const pct = Math.max(4, (val / max) * 100);
            return (
              <div key={d.jour} className="bmb-dash-erp-chart__col">
                <div className="bmb-dash-erp-chart__bar-wrap">
                  <div
                    className={`bmb-dash-erp-chart__bar ${barClass}`.trim()}
                    style={{ height: `${pct}%` }}
                    title={formatGNF(val)}
                  />
                </div>
                <div className="bmb-dash-erp-chart__label">{d.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EmptyBlock({ children }) {
  return (
    <div className="bmb-dash-erp-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      {children}
    </div>
  );
}

const KPI_ICONS = {
  sales: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  week: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  cash: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  alert: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

export default function Dashboard({ fromRoleHome = false, gestionnaireMode = false, adminMode = false }) {
  const { can, loading: authLoading, user } = useAuth();
  const { store } = useStoreSettings();
  const pwa = usePwa();
  const apiHealth = useApiHealth(120000);
  const [data, setData] = useState(null);
  const [pvOverview, setPvOverview] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const pvFilter = usePvFilter();
  const showPvOverview = canAccessAllPvs(user) || isZoneManager(user);

  const load = useCallback(async (attempt = 0) => {
    setLoading(true);
    setError('');
    try {
      const dashParams = { ...stockQueryParams(user), ...pvFilter.queryParams };
      const [dashRes, pvRes] = await Promise.all([
        api.get('/dashboard', { params: dashParams }),
        showPvOverview ? api.get('/dashboard/by-pv').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
      ]);
      setData(dashRes.data);
      setPvOverview(pvRes.data || []);
    } catch (err) {
      if (!err.response && attempt < 4) {
        await new Promise((resolve) => { setTimeout(resolve, 1500); });
        return load(attempt + 1);
      }
      setError(apiErrorMessage(err, 'Impossible de charger le tableau de bord'));
    } finally {
      setLoading(false);
    }
  }, [pvFilter.queryParams, showPvOverview, user]);

  useEffect(() => {
    if (authLoading) return;
    load();
  }, [authLoading, load]);

  useSocket((event) => { if (event === 'dashboard:refresh') load(); });

  if (loading && !data && !error) {
    return <div className="dash-loading">Chargement du tableau de bord…</div>;
  }

  if (error && !data) {
    return (
      <div className="card api-error-panel">
        <h2 className="page-title">Tableau de bord</h2>
        <div className="alert alert-error">{error}</div>
        <button type="button" className="btn btn-primary" onClick={() => load()} disabled={loading}>
          {loading ? 'Chargement…' : 'Réessayer'}
        </button>
      </div>
    );
  }

  const alertCount = data.alertes_stock_count || 0;
  const topProducts = data.top_produits_jour || [];
  const stockGen = { ...(data.valeur_stock || {}), ...(data.stock_general || {}) };
  const ca = data.chiffre_affaires || {};
  const evolution = data.evolution_ca_7j || [];
  const todaySales = evolution.at(-1)?.montant ?? ca.jour;
  const yesterdaySales = evolution.at(-2)?.montant ?? 0;
  const ventesTrend = formatTrend(pctTrend(todaySales, yesterdaySales), 'vs hier');
  const semaineTrend = formatTrend(pctTrend(ca.semaine, ca.semaine_precedente ?? 0), 'vs 7 jours préc.');
  const caisseValue = can('finances', 'view') ? data.caisse : data.ventes_jour?.encaisse;
  const todayLabel = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const paniersAttente = data.paniers_en_attente || [];
  const creditsClients = data.credits_clients || [];
  const showReglement = canAccessReglement(user);

  if (data.scope === 'seller' && !gestionnaireMode && isSellerScoped(user)) {
    return (
      <SellerDashView
        data={data}
        loading={loading}
        onRefresh={() => load()}
        can={can}
        user={user}
        store={store}
        todayLabel={todayLabel}
        fromRoleHome={fromRoleHome}
      />
    );
  }

  const firstName = (user?.full_name || 'Utilisateur').split(' ')[0];
  const pvLabel = pvDisplayLabel(user) || pvFilter.selectedPv?.name;
  const premiumMode = gestionnaireMode || adminMode;
  const quickActionDefs = adminMode ? ADMIN_QUICK_ACTIONS : MGR_QUICK_ACTIONS;
  const premiumQuickActions = quickActionDefs.filter((a) => {
    if (!can(a.module, a.action || 'view')) return false;
    if (a.requireReglement && !showReglement) return false;
    return true;
  });
  const indicatorsHint = adminMode ? 'Synthèse globale du magasin' : 'Synthèse de votre point de vente';

  if (premiumMode) {
    return (
      <div className={`bmb-dash-erp bmb-dash-erp--mgr${adminMode ? ' bmb-dash-erp--admin' : ''}${pwa?.isPwaMobile ? ' bmb-dash-erp--pwa' : ''}`}>
        <header className="bmb-dash-mgr-header">
          <div className="bmb-dash-mgr-header__main">
            <div className="bmb-dash-mgr-header__eyebrow">
              <span className="bmb-dash-mgr-header__badge">Tableau de bord</span>
              {adminMode && <span className="bmb-dash-mgr-header__role">Administrateur</span>}
              {pvLabel && <span className="bmb-dash-mgr-header__pv">{pvLabel}</span>}
            </div>
            <h1 className="bmb-dash-mgr-header__title">
              Bonjour, <em>{firstName}</em>
            </h1>
            <p className="bmb-dash-mgr-header__meta">{todayLabel}</p>
            {store?.store_name && <p className="bmb-dash-mgr-header__store">{store.store_name}</p>}
          </div>
          <div className="bmb-dash-mgr-header__actions">
            <button
              type="button"
              className="bmb-dash-mgr-header__refresh"
              onClick={() => load()}
              disabled={loading}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={loading ? 'is-spin' : ''}
                aria-hidden
              >
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
              </svg>
              {loading ? 'Actualisation…' : 'Actualiser'}
            </button>
          </div>
        </header>

        {(pvFilter.canFilter || adminMode) && (
          <div className="bmb-dash-mgr-pv-bar bmb-print-skip">
            <PvFilterBar compact={!adminMode} />
          </div>
        )}

        {(data.caisse_hier_non_cloturee || data.inventory_lock || (data.dettes_echeues_count > 0 && showReglement) || user?.must_change_password) && (
          <div className="bmb-dash-erp-alerts">
            {data.caisse_hier_non_cloturee && can('finances', 'view') && (
              <div className="alert alert-warning" role="alert">
                <strong>Caisse</strong> — Hier non clôturée. <Link to="/finances/caisse">Clôturer</Link>
              </div>
            )}
            {data.inventory_lock && (
              <div className="alert alert-warning" role="alert">
                <strong>Inventaire verrouillé</strong> — ventes suspendues.
              </div>
            )}
            {data.dettes_echeues_count > 0 && showReglement && (
              <div className="alert alert-warning" role="alert">
                <strong>{data.dettes_echeues_count} dette(s) échue(s)</strong> —{' '}
                <Link to="/ventes/reglement">Règlement</Link>
              </div>
            )}
            {user?.must_change_password && (
              <div className="alert alert-error" role="alert">
                <strong>Sécurité</strong> — Changez votre mot de passe initial.
              </div>
            )}
          </div>
        )}

        {fromRoleHome && (
          <Link to="/" className="bmb-role-home__analytics-link">← Retour à l&apos;accueil</Link>
        )}

        {premiumQuickActions.length > 0 && (
          <DashSection title="Accès rapide">
            <div className="bmb-dash-mgr-actions">
              {premiumQuickActions.map((action) => (
                <Link
                  key={action.to}
                  to={action.to}
                  className={`bmb-dash-mgr-action${action.tone ? ` bmb-dash-mgr-action--${action.tone}` : ''}`}
                >
                  <span className="bmb-dash-mgr-action__icon" aria-hidden>
                    <NavIcon name={action.icon} />
                  </span>
                  <span className="bmb-dash-mgr-action__label">{action.label}</span>
                  <span className="bmb-dash-mgr-action__sub">{action.sub}</span>
                </Link>
              ))}
            </div>
          </DashSection>
        )}

        {adminMode && showPvOverview && pvOverview.length > 0 && (
          <DashSection title="Points de vente" hint="Vue consolidée">
            <div className="bmb-dash-mgr-pv-grid">
              {pvOverview.map((pv) => (
                <article key={pv.id} className="bmb-dash-mgr-pv-card">
                  <div className="bmb-dash-mgr-pv-card__head">
                    <strong>{pv.code}</strong>
                    <span>{pv.name}</span>
                  </div>
                  <div className="bmb-dash-mgr-pv-card__row">
                    <span>CA jour</span>
                    <strong>{formatGNF(pv.ventes_jour?.montant)}</strong>
                  </div>
                  {pv.objective?.target_ca > 0 && (
                    <div className="bmb-dash-mgr-pv-card__progress">
                      <div className="bmb-dash-mgr-pv-card__progress-label">
                        <span>Objectif</span>
                        <strong>{pv.objective.progress_pct ?? 0}%</strong>
                      </div>
                      <div className="bmb-dash-mgr-pv-card__progress-bar">
                        <div style={{ width: `${Math.min(100, pv.objective.progress_pct || 0)}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="bmb-dash-mgr-pv-card__row">
                    <span>Créances</span>
                    <strong>{formatGNF(pv.creances)}</strong>
                  </div>
                  <div className="bmb-dash-mgr-pv-card__foot">
                    {pv.ventes_jour?.paniers || 0} panier(s) · {pv.alertes_stock} alerte(s)
                  </div>
                </article>
              ))}
            </div>
          </DashSection>
        )}

        <DashSection title="Indicateurs du jour" hint={indicatorsHint}>
          <div className="bmb-dash-erp__kpis">
            <KpiCard variant="green" label="Ventes du jour" value={formatGNF(data.ventes_jour?.montant)} trend={ventesTrend} linkTo="/ventes/inventaire" icon={KPI_ICONS.sales} />
            <KpiCard variant="blue" label="CA 7 jours" value={formatGNF(ca.semaine)} trend={semaineTrend} linkTo="/ventes/inventaire" icon={KPI_ICONS.week} />
            <KpiCard variant="yellow" label="Caisse (aujourd'hui)" value={formatGNF(caisseValue)} sub={`${data.ventes_jour?.paniers || 0} panier(s) · encaissé ${formatGNF(data.ventes_jour?.encaisse)}`} linkTo={can('finances', 'view') ? '/finances/caisse' : '/ventes/reglement'} icon={KPI_ICONS.cash} />
            {can('produits', 'view') && (
              <KpiCard variant="red" label="Alertes stock" value={String(alertCount)} sub={alertCount > 0 ? 'Rupture / stock faible' : 'Niveaux OK'} linkTo="/produits/stocks" icon={KPI_ICONS.alert} />
            )}
          </div>
          <div className="bmb-dash-erp__kpis-secondary">
            <MiniStat label="CA du mois" value={formatGNF(ca.mois)} />
            {can('ventes', 'view') && (
              <MiniStat label="Créances" value={formatGNF(data.creances_clients?.total)} sub={`${data.creances_clients?.count || 0} dossier(s)`} />
            )}
            {adminMode && can('ventes', 'view') && data.margin_today != null && (
              <MiniStat label="Marge du jour" value={formatGNF(data.margin_today)} sub="CA − coût d'achat" />
            )}
            <MiniStat label="Paniers du jour" value={String(data.ventes_jour?.paniers || 0)} sub={`Reste ${formatGNF(data.ventes_jour?.reste)}`} />
            {can('produits', 'view') && (
              <MiniStat label="Valeur stock" value={formatGNF(stockGen.valeur_achat)} sub={`${stockGen.produits_actifs ?? 0} produits actifs`} />
            )}
          </div>
        </DashSection>

        <DashSection title="Analyse" hint="7 derniers jours">
          <div className="bmb-dash-mgr-grid-2">
            <DashPanel title="Évolution CA" action={<span className="bmb-dash-erp-panel__select">7 jours</span>}>
              <ErpBarChart data={evolution} />
            </DashPanel>
            {can('finances', 'view') ? (
              <DashPanel title="Encaissements">
                <ErpBarChart data={data.evolution_encaissements_7j || []} barClass="bmb-dash-erp-chart__bar--blue" />
              </DashPanel>
            ) : (
              <DashPanel title="Top ventes" action={<Link to="/ventes/inventaire" className="bmb-dash-erp-panel__action">Voir tout</Link>}>
                <TopProductsTable products={topProducts} />
              </DashPanel>
            )}
          </div>
        </DashSection>

        <DashSection title="Activité">
          <div className="bmb-dash-mgr-grid-2">
            <DashPanel title="Top ventes aujourd'hui" action={<Link to="/ventes/inventaire" className="bmb-dash-erp-panel__action">Voir tout</Link>}>
              <TopProductsTable products={topProducts} />
            </DashPanel>
            {can('ventes', 'view') && (
              <DashPanel title="Paniers à encaisser" action={showReglement ? <Link to="/ventes/reglement" className="bmb-dash-erp-panel__action">Encaisser</Link> : null}>
                {paniersAttente.length === 0 && creditsClients.length === 0 ? (
                  <EmptyBlock>Aucun panier en attente</EmptyBlock>
                ) : (
                  <div className="bmb-dash-erp-table-wrap">
                    <table className="bmb-dash-erp-table">
                      <thead><tr><th>N°</th><th>Client</th><th className="col-num">Reste</th></tr></thead>
                      <tbody>
                        {paniersAttente.slice(0, 6).map((p) => (
                          <tr key={`a-${p.id}`}>
                            <td><strong>{p.cart_number}</strong></td>
                            <td>{p.client_name || '—'}</td>
                            <td className="col-num bmb-dash-erp-table__ca">{formatGNF(p.balance_due)}</td>
                          </tr>
                        ))}
                        {creditsClients.slice(0, 4).map((p) => (
                          <tr key={`c-${p.id}`}>
                            <td><strong>{p.cart_number}</strong></td>
                            <td>{p.client_name || '—'}</td>
                            <td className="col-num bmb-dash-erp-table__ca">{formatGNF(p.balance_due)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </DashPanel>
            )}
          </div>
        </DashSection>

        {can('produits', 'view') && (
          <DashSection title="Stocks">
            <div className={`bmb-dash-mgr-grid-2${adminMode ? ' bmb-dash-mgr-grid-2--stack' : ''}`}>
              <DashPanel title="État du stock" action={<Link to="/produits/stocks" className="bmb-dash-erp-panel__action">Gérer</Link>}>
                <div className="bmb-dash-erp-stock-grid">
                  <div className="bmb-dash-erp-stock-cell">
                    <strong>{formatGNF(stockGen.valeur_achat)}</strong>
                    <span>Valeur</span>
                  </div>
                  <div className="bmb-dash-erp-stock-cell bmb-dash-erp-stock-cell--ok">
                    <strong>{stockGen.ok_count ?? 0}</strong>
                    <span>OK</span>
                  </div>
                  <div className="bmb-dash-erp-stock-cell bmb-dash-erp-stock-cell--warn">
                    <strong>{stockGen.alertes ?? 0}</strong>
                    <span>Alertes</span>
                  </div>
                  <div className="bmb-dash-erp-stock-cell bmb-dash-erp-stock-cell--danger">
                    <strong>{stockGen.epuises ?? 0}</strong>
                    <span>Épuisés</span>
                  </div>
                  {adminMode && (
                    <>
                      <div className="bmb-dash-erp-stock-cell">
                        <strong>{formatQty(stockGen.quantite_totale)}</strong>
                        <span>Quantité tot.</span>
                      </div>
                      <div className="bmb-dash-erp-stock-cell">
                        <strong>{stockGen.produits_actifs ?? 0}</strong>
                        <span>Actifs</span>
                      </div>
                    </>
                  )}
                </div>
              </DashPanel>
              <DashPanel title="Produits en alerte" action={<Link to="/produits/stocks" className="bmb-dash-erp-panel__action">Voir stocks</Link>}>
                {(data.alertes_stock || []).length === 0 ? (
                  <EmptyBlock>Aucune alerte — stocks OK</EmptyBlock>
                ) : (
                  <div className="bmb-dash-erp-table-wrap">
                    <table className="bmb-dash-erp-table">
                      <thead><tr><th>Produit</th><th className="col-num">Stock</th><th>Statut</th></tr></thead>
                      <tbody>
                        {(data.alertes_stock || []).slice(0, 6).map((a) => {
                          const qty = parseFloat(a.quantity || 0);
                          const critique = qty <= 0;
                          return (
                            <tr key={a.id}>
                              <td><strong>{a.name}</strong></td>
                              <td className="col-num">{formatQty(qty)}</td>
                              <td>
                                <span className={`bmb-dash-erp-badge${critique ? ' bmb-dash-erp-badge--critique' : ' bmb-dash-erp-badge--faible'}`}>
                                  {critique ? 'Rupture' : 'Faible'}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </DashPanel>
            </div>
            {adminMode && (
              <DashPanel title="Stock par catégorie" className="bmb-dash-erp-panel--full">
                {(data.stock_par_categorie || []).length === 0 ? (
                  <EmptyBlock>Aucune catégorie</EmptyBlock>
                ) : (
                  <div className="bmb-dash-erp-table-wrap">
                    <table className="bmb-dash-erp-table">
                      <thead><tr><th>Catégorie</th><th className="col-num">Qté</th><th className="col-num">Valeur</th></tr></thead>
                      <tbody>
                        {(data.stock_par_categorie || []).map((c) => (
                          <tr key={c.category}>
                            <td>{c.category}</td>
                            <td className="col-num">{formatQty(c.quantite)}</td>
                            <td className="col-num">{formatGNF(c.valeur_achat)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </DashPanel>
            )}
          </DashSection>
        )}

        {(data.dettes_echeues || []).length > 0 && can('ventes', 'view') && (
          <DashSection title="Dettes échues">
            <DashPanel title="Clients en retard" action={showReglement ? <Link to="/ventes/reglement" className="bmb-dash-erp-panel__action">Régler</Link> : null}>
              <div className="bmb-dash-erp-table-wrap">
                <table className="bmb-dash-erp-table">
                  <thead><tr><th>Client</th><th className="col-num">Solde</th><th>Échéance</th></tr></thead>
                  <tbody>
                    {(data.dettes_echeues || []).map((d) => (
                      <tr key={d.id}>
                        <td>{d.client_name || '—'}</td>
                        <td className="col-num">{formatGNF(d.balance)}</td>
                        <td>{formatDate(d.due_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashPanel>
          </DashSection>
        )}

        {data.scope === 'all' && (data.vendeurs_jour || []).length > 0 && (
          <DashSection title="Équipe commerciale" hint="Performance du jour">
            <DashPanel title="Vendeurs">
              <div className="bmb-dash-erp-table-wrap">
                <table className="bmb-dash-erp-table">
                  <thead><tr><th>Vendeur</th><th className="col-num">Paniers</th><th className="col-num">CA</th></tr></thead>
                  <tbody>
                    {(data.vendeurs_jour || []).map((v) => (
                      <tr key={v.name}>
                        <td><strong>{v.name}</strong></td>
                        <td className="col-num">{v.paniers}</td>
                        <td className="col-num bmb-dash-erp-table__ca">{formatGNF(v.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashPanel>
          </DashSection>
        )}
      </div>
    );
  }

  return (
    <div className={`bmb-dash-erp${pwa?.isPwaMobile ? ' bmb-dash-erp--pwa' : ''}`}>
      <header className="bmb-dash-erp__hero">
        <div>
          <h1 className="bmb-dash-erp__title">Tableau de bord</h1>
          <p className="bmb-dash-erp__date">{todayLabel}</p>
          {store?.store_name && <p className="bmb-dash-erp__store">{store.store_name}</p>}
        </div>
        <div className="bmb-dash-erp__hero-actions">
          <button type="button" className="bmb-dash-erp__refresh-btn" onClick={() => load()} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            {loading ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
      </header>

      <div className="bmb-print-skip" style={{ marginBottom: '1rem' }}>
        <PvFilterBar />
      </div>

      {showPvOverview && pvOverview.length > 0 && (
        <section className="bmb-dash-pv-overview bmb-print-skip" style={{ marginBottom: '1.25rem' }}>
          <h2 className="bmb-dash-erp-panel__title" style={{ marginBottom: '0.75rem' }}>Vue par point de vente</h2>
          <div className="bmb-dash-pv-overview__grid" style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {pvOverview.map((pv) => (
              <article key={pv.id} className="card" style={{ padding: '0.85rem 1rem' }}>
                <strong>{pv.code}</strong>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{pv.name}</div>
                <div style={{ fontSize: '0.9rem' }}>CA jour: <strong>{formatGNF(pv.ventes_jour?.montant)}</strong></div>
                {pv.objective?.target_ca > 0 && (
                  <div style={{ fontSize: '0.85rem', marginTop: '0.35rem' }}>
                    Objectif: {formatGNF(pv.objective.target_ca)}
                    {' — '}
                    <strong>{pv.objective.progress_pct ?? 0}%</strong>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 4 }}>
                      <div style={{ width: `${Math.min(100, pv.objective.progress_pct || 0)}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                    </div>
                  </div>
                )}
                <div style={{ fontSize: '0.9rem' }}>Créances: {formatGNF(pv.creances)}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {pv.ventes_jour?.paniers || 0} panier(s) · {pv.alertes_stock} alerte(s) stock
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {fromRoleHome && (
        <Link to="/" className="bmb-role-home__analytics-link">← Retour à l&apos;accueil</Link>
      )}

      <div className="bmb-dash-erp-alerts">
        {data.caisse_hier_non_cloturee && can('finances', 'view') && (
          <div className="alert alert-warning" role="alert">
            <strong>Caisse</strong> — Hier non clôturée. <Link to="/finances/caisse">Clôturer</Link>
          </div>
        )}
        {data.inventory_lock && (
          <div className="alert alert-warning" role="alert">
            <strong>Inventaire verrouillé</strong> — ventes suspendues.
          </div>
        )}
        {data.dettes_echeues_count > 0 && showReglement && (
          <div className="alert alert-warning" role="alert">
            <strong>{data.dettes_echeues_count} dette(s) échue(s)</strong> —{' '}
            <Link to="/ventes/reglement">Règlement</Link>
          </div>
        )}
        {user?.must_change_password && (
          <div className="alert alert-error" role="alert">
            <strong>Sécurité</strong> — Changez votre mot de passe initial.
          </div>
        )}
      </div>

      <nav className="bmb-dash-erp__quick" aria-label="Actions rapides">
        {can('ventes', 'create') && (
          <Link to="/ventes/vendre" className="bmb-dash-erp__quick-link">+ Nouvelle vente</Link>
        )}
        {showReglement && (
          <Link to="/ventes/reglement" className="bmb-dash-erp__quick-link bmb-dash-erp__quick-link--muted">Encaisser</Link>
        )}
        {can('produits', 'view') && (
          <Link to="/produits/stocks" className="bmb-dash-erp__quick-link bmb-dash-erp__quick-link--muted">Stocks</Link>
        )}
        {can('finances', 'view') && (
          <Link to="/finances/caisse" className="bmb-dash-erp__quick-link bmb-dash-erp__quick-link--muted">Caisse</Link>
        )}
      </nav>

      <div className="bmb-dash-erp__kpis">
        <KpiCard variant="green" label="Ventes du jour" value={formatGNF(data.ventes_jour?.montant)} trend={ventesTrend} linkTo="/ventes/inventaire" icon={KPI_ICONS.sales} />
        <KpiCard variant="blue" label="CA 7 jours" value={formatGNF(ca.semaine)} trend={semaineTrend} linkTo="/ventes/inventaire" icon={KPI_ICONS.week} />
        <KpiCard variant="yellow" label="Caisse (aujourd'hui)" value={formatGNF(caisseValue)} sub={`${data.ventes_jour?.paniers || 0} panier(s) · encaissé ${formatGNF(data.ventes_jour?.encaisse)}`} linkTo={can('finances', 'view') ? '/finances/caisse' : (showReglement ? '/ventes/reglement' : '/ventes/inventaire')} icon={KPI_ICONS.cash} />
        {can('produits', 'view') && (
          <KpiCard variant="red" label="Alertes stock" value={String(alertCount)} sub={alertCount > 0 ? 'Rupture / stock faible' : 'Niveaux OK'} linkTo="/produits/stocks" icon={KPI_ICONS.alert} />
        )}
      </div>

      <div className="bmb-dash-erp__kpis-secondary">
        <MiniStat label="CA du mois" value={formatGNF(ca.mois)} />
        {can('ventes', 'view') && (
          <MiniStat label="Créances" value={formatGNF(data.creances_clients?.total)} sub={`${data.creances_clients?.count || 0} dossier(s)`} />
        )}
        {can('ventes', 'view') && data.margin_today != null && (
          <MiniStat label="Marge du jour" value={formatGNF(data.margin_today)} sub="CA − coût d'achat" />
        )}
        <MiniStat label="Paniers du jour" value={String(data.ventes_jour?.paniers || 0)} sub={`Reste ${formatGNF(data.ventes_jour?.reste)}`} />
        {can('produits', 'view') && (
          <MiniStat label="Valeur stock" value={formatGNF(stockGen.valeur_achat)} sub={`${stockGen.produits_actifs ?? 0} produits actifs`} />
        )}
      </div>

      <div className="bmb-dash-erp__main">
        <DashPanel title="Évolution CA — 7 jours" action={<span className="bmb-dash-erp-panel__select">7 derniers jours</span>}>
          <ErpBarChart data={evolution} />
        </DashPanel>
        {can('finances', 'view') ? (
          <DashPanel title="Encaissements — 7 jours">
            <ErpBarChart data={data.evolution_encaissements_7j || []} barClass="bmb-dash-erp-chart__bar--blue" />
          </DashPanel>
        ) : (
          <DashPanel title="Produits — top ventes" action={<Link to="/ventes/inventaire" className="bmb-dash-erp-panel__action">Voir tous</Link>}>
            <TopProductsTable products={topProducts} />
          </DashPanel>
        )}
      </div>

      {can('finances', 'view') && (
        <DashPanel title="Produits — top ventes (aujourd'hui)" action={<Link to="/ventes/inventaire" className="bmb-dash-erp-panel__action">Voir tous</Link>} className="bmb-dash-erp-panel--full">
          <TopProductsTable products={topProducts} />
        </DashPanel>
      )}

      <div className="bmb-dash-erp__row">
        {can('produits', 'view') && (
          <DashPanel title="Stock général" action={<Link to="/produits/stocks" className="bmb-dash-erp-panel__action">Gérer</Link>}>
            <div className="bmb-dash-erp-stock-grid">
              <div className="bmb-dash-erp-stock-cell">
                <strong>{formatGNF(stockGen.valeur_achat)}</strong>
                <span>Valeur</span>
              </div>
              <div className="bmb-dash-erp-stock-cell bmb-dash-erp-stock-cell--ok">
                <strong>{stockGen.ok_count ?? 0}</strong>
                <span>OK</span>
              </div>
              <div className="bmb-dash-erp-stock-cell bmb-dash-erp-stock-cell--warn">
                <strong>{stockGen.alertes ?? 0}</strong>
                <span>Alertes</span>
              </div>
              <div className="bmb-dash-erp-stock-cell bmb-dash-erp-stock-cell--danger">
                <strong>{stockGen.epuises ?? 0}</strong>
                <span>Épuisés</span>
              </div>
              <div className="bmb-dash-erp-stock-cell">
                <strong>{formatQty(stockGen.quantite_totale)}</strong>
                <span>Quantité tot.</span>
              </div>
              <div className="bmb-dash-erp-stock-cell">
                <strong>{stockGen.produits_actifs ?? 0}</strong>
                <span>Actifs</span>
              </div>
            </div>
          </DashPanel>
        )}
        {can('produits', 'view') && (
          <DashPanel title="Stock par catégorie">
            {(data.stock_par_categorie || []).length === 0 ? (
              <EmptyBlock>Aucune catégorie</EmptyBlock>
            ) : (
              <div className="bmb-dash-erp-table-wrap">
                <table className="bmb-dash-erp-table">
                  <thead><tr><th>Catégorie</th><th className="col-num">Qté</th><th className="col-num">Valeur</th></tr></thead>
                  <tbody>
                    {(data.stock_par_categorie || []).map((c) => (
                      <tr key={c.category}>
                        <td>{c.category}</td>
                        <td className="col-num">{formatQty(c.quantite)}</td>
                        <td className="col-num">{formatGNF(c.valeur_achat)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DashPanel>
        )}
      </div>

      <div className="bmb-dash-erp__row">
        {can('produits', 'view') && (
          <DashPanel title="Alertes stock" action={<Link to="/produits/stocks" className="bmb-dash-erp-panel__action">Voir stocks</Link>}>
            {(data.alertes_stock || []).length === 0 ? (
              <EmptyBlock>Aucune alerte — stocks OK</EmptyBlock>
            ) : (
              <div className="bmb-dash-erp-table-wrap">
                <table className="bmb-dash-erp-table">
                  <thead><tr><th>Produit</th><th className="col-num">Stock</th><th className="col-num">Min</th><th>Statut</th></tr></thead>
                  <tbody>
                    {(data.alertes_stock || []).slice(0, 8).map((a) => {
                      const qty = parseFloat(a.quantity || 0);
                      const critique = qty <= 0;
                      return (
                        <tr key={a.id}>
                          <td><strong>{a.name}</strong><br /><small>{a.reference}</small></td>
                          <td className="col-num">{formatQty(qty)}</td>
                          <td className="col-num">{formatQty(a.min_stock)}</td>
                          <td>
                            <span className={`bmb-dash-erp-badge${critique ? ' bmb-dash-erp-badge--critique' : ' bmb-dash-erp-badge--faible'}`}>
                              {critique ? 'Rupture' : 'Faible'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DashPanel>
        )}
        {can('ventes', 'view') && (
          <DashPanel title="Paniers à encaisser" action={showReglement ? <Link to="/ventes/reglement" className="bmb-dash-erp-panel__action">Encaisser</Link> : null}>
            {paniersAttente.length === 0 && creditsClients.length === 0 ? (
              <EmptyBlock>Aucun panier en attente</EmptyBlock>
            ) : (
              <div className="bmb-dash-erp-table-wrap">
                <table className="bmb-dash-erp-table">
                  <thead><tr><th>N°</th><th>Client</th><th className="col-num">Reste</th></tr></thead>
                  <tbody>
                    {paniersAttente.slice(0, 6).map((p) => (
                      <tr key={`a-${p.id}`}>
                        <td><strong>{p.cart_number}</strong></td>
                        <td>{p.client_name || '—'}</td>
                        <td className="col-num bmb-dash-erp-table__ca">{formatGNF(p.balance_due)}</td>
                      </tr>
                    ))}
                    {creditsClients.slice(0, 4).map((p) => (
                      <tr key={`c-${p.id}`}>
                        <td><strong>{p.cart_number}</strong></td>
                        <td>{p.client_name || '—'}</td>
                        <td className="col-num bmb-dash-erp-table__ca">{formatGNF(p.balance_due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DashPanel>
        )}
      </div>

      {data.scope === 'all' && (data.vendeurs_jour || []).length > 0 && (
        <DashPanel title="Performance vendeurs — aujourd'hui" className="bmb-dash-erp-panel--full">
          <div className="bmb-dash-erp-table-wrap">
            <table className="bmb-dash-erp-table">
              <thead><tr><th>Vendeur</th><th className="col-num">Paniers</th><th className="col-num">Chiffre d&apos;affaires</th></tr></thead>
              <tbody>
                {(data.vendeurs_jour || []).map((v) => (
                  <tr key={v.name}>
                    <td><strong>{v.name}</strong></td>
                    <td className="col-num">{v.paniers}</td>
                    <td className="col-num bmb-dash-erp-table__ca">{formatGNF(v.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DashPanel>
      )}

      {(data.dettes_echeues || []).length > 0 && can('ventes', 'view') && (
        <DashPanel title="Dettes échues" action={showReglement ? <Link to="/ventes/reglement" className="bmb-dash-erp-panel__action">Régler</Link> : null} className="bmb-dash-erp-panel--full">
          <div className="bmb-dash-erp-table-wrap">
            <table className="bmb-dash-erp-table">
              <thead><tr><th>Client</th><th className="col-num">Solde</th><th>Échéance</th></tr></thead>
              <tbody>
                {(data.dettes_echeues || []).map((d) => (
                  <tr key={d.id}>
                    <td>{d.client_name || '—'}</td>
                    <td className="col-num">{formatGNF(d.balance)}</td>
                    <td>{formatDate(d.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DashPanel>
      )}

      <footer className="bmb-dash-erp-trust" aria-label="Engagements BESTO SHOP">
        {TRUST_ITEMS.map((item) => (
          <div key={item.title} className="bmb-dash-erp-trust__item">
            <span className="bmb-dash-erp-trust__icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <div className="bmb-dash-erp-trust__text">
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </div>
          </div>
        ))}
      </footer>
    </div>
  );
}

function TopProductsTable({ products }) {
  if (!products.length) {
    return <EmptyBlock>Pas encore de vente aujourd&apos;hui</EmptyBlock>;
  }
  return (
    <div className="bmb-dash-erp-table-wrap">
      <table className="bmb-dash-erp-table">
        <thead>
          <tr>
            <th>Produit</th>
            <th>Catégorie</th>
            <th className="col-num">Prix</th>
            <th className="col-num">Qté</th>
            <th className="col-num">CA</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, i) => {
            const unitPrice = parseFloat(p.sale_price) || (
              parseFloat(p.quantity) > 0 ? parseFloat(p.total) / parseFloat(p.quantity) : 0
            );
            const initial = (p.name || '?').trim().charAt(0).toUpperCase();
            return (
              <tr key={p.reference || i}>
                <td>
                  <div className="bmb-dash-erp-product">
                    <span className="bmb-dash-erp-product__thumb">{initial}</span>
                    <span>
                      <span className="bmb-dash-erp-product__name">{p.name}</span>
                      {p.reference && <span className="bmb-dash-erp-product__ref">{p.reference}</span>}
                    </span>
                  </div>
                </td>
                <td>{p.category || '—'}</td>
                <td className="col-num">{formatGNF(unitPrice)}</td>
                <td className="col-num">{formatQty(p.quantity)}</td>
                <td className="col-num bmb-dash-erp-table__ca">{formatGNF(p.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
