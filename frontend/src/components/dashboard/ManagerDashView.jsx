import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { logoSrc, useStoreSettings } from '../../context/StoreSettingsContext';
import { usePvFilter } from '../../context/PvFilterContext';
import { useSocket } from '../../hooks/useSocket';
import { formatGNF, formatQty } from '../../utils/format';
import { apiErrorMessage } from '../../utils/apiError';
import { canAccessReglement } from '../../utils/sellerScope';
import { pvDisplayLabel, stockQueryParams } from '../../utils/pvScope';
import { BRAND_FLYERS, BRAND_LOGO } from '../../config/brandAssets';
import { NavIcon } from '../NavIcons';
import PvFilterBar from '../PvFilterBar';
import LoadingInline from '../ui/LoadingInline';
import { getRoleHomeConfig } from '../../pages/home/roleHomeConfigs';

const FLYER_MS = 8000;

const QUICK_ACTIONS = [
  { to: '/ventes/inventaire', label: 'Ventes', desc: 'Suivi du jour', icon: 'ventes', module: 'ventes', action: 'view', accent: 'emerald' },
  { to: '/produits/stocks', label: 'Stocks', desc: 'Alertes & niveaux', icon: 'stock', module: 'produits', action: 'view', accent: 'teal' },
  { to: '/finances/caisse', label: 'Caisse', desc: 'Trésorerie', icon: 'finances', module: 'finances', action: 'view', accent: 'indigo' },
  { to: '/ventes/reglement', label: 'Encaisser', desc: 'Règlements', icon: 'clients', module: 'ventes', action: 'edit', accent: 'amber', requireAfterSalePayment: true },
  { to: '/ventes/clients', label: 'Clients', desc: 'Comptes', icon: 'clients', module: 'ventes', action: 'view', accent: 'slate' },
  { to: '/employes/liste', label: 'Équipe', desc: 'Employés', icon: 'employes', module: 'employes', action: 'view', accent: 'slate' },
];

function trendPct(current, previous) {
  const c = parseFloat(current) || 0;
  const p = parseFloat(previous) || 0;
  if (p <= 0) return null;
  const pct = ((c - p) / p) * 100;
  return { pct: Math.abs(pct), up: pct >= 0 };
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      className={spinning ? 'mgr-cockpit__spin' : ''}
      aria-hidden
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function SalesSparkline({ data }) {
  const points = useMemo(() => {
    if (!data?.length) return null;
    const values = data.map((d) => parseFloat(d.montant || 0));
    const max = Math.max(...values, 1);
    const w = 280;
    const h = 72;
    const pad = 4;
    const coords = values.map((v, i) => {
      const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
      const y = h - pad - (v / max) * (h - pad * 2);
      return { x, y, val: v, label: data[i].label };
    });
    const line = coords.map((p) => `${p.x},${p.y}`).join(' ');
    const area = `${coords[0].x},${h} ${line} ${coords[coords.length - 1].x},${h}`;
    return { w, h, line, area, coords, max };
  }, [data]);

  if (!points) {
    return <p className="mgr-cockpit__chart-empty">Aucune vente sur les 7 derniers jours</p>;
  }

  return (
    <div className="mgr-cockpit__chart-wrap">
      <svg
        viewBox={`0 0 ${points.w} ${points.h}`}
        className="mgr-cockpit__chart-svg"
        role="img"
        aria-label="Évolution du chiffre d'affaires sur 7 jours"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="mgr-chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2d9d5f" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0f5c38" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={points.area} fill="url(#mgr-chart-fill)" />
        <polyline points={points.line} fill="none" stroke="#1a7a4c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.coords.map((p, i) => (
          <circle key={data[i].jour} cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke="#0f5c38" strokeWidth="2">
            <title>{`${p.label}: ${formatGNF(p.val)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="mgr-cockpit__chart-labels">
        {data.map((d) => (
          <span key={d.jour} title={formatGNF(d.montant)}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function AlertBanner({ type, children }) {
  return (
    <div className={`mgr-cockpit__alert mgr-cockpit__alert--${type}`} role={type === 'info' ? 'status' : 'alert'}>
      {children}
    </div>
  );
}

export default function ManagerDashView() {
  const { user, can } = useAuth();
  const { store } = useStoreSettings();
  const pvFilter = usePvFilter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [flyerIdx, setFlyerIdx] = useState(0);

  const dashParams = useMemo(
    () => ({ ...stockQueryParams(user), ...pvFilter.queryParams }),
    [user, pvFilter.queryParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/dashboard', { params: dashParams });
      setData(r.data);
    } catch (err) {
      setError(apiErrorMessage(err, 'Impossible de charger le tableau de bord'));
    } finally {
      setLoading(false);
    }
  }, [dashParams]);

  useEffect(() => { load(); }, [load]);
  useSocket((event) => { if (event === 'dashboard:refresh') load(); });

  useEffect(() => {
    if (BRAND_FLYERS.length <= 1) return undefined;
    const t = setInterval(() => setFlyerIdx((i) => (i + 1) % BRAND_FLYERS.length), FLYER_MS);
    return () => clearInterval(t);
  }, []);

  const firstName = (user?.full_name || 'Gestionnaire').split(' ')[0];
  const todayLabel = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  const pvLabel = pvDisplayLabel(user) || pvFilter.selectedPv?.name;
  const showReglement = canAccessReglement(user);
  const config = getRoleHomeConfig('gestionnaire');

  const visibleActions = useMemo(
    () => QUICK_ACTIONS.filter((a) => {
      if (!can(a.module, a.action || 'view')) return false;
      if (a.requireAfterSalePayment && !showReglement) return false;
      return true;
    }),
    [can, showReglement],
  );

  const evolution = data?.evolution_ca_7j || [];
  const ca = data?.chiffre_affaires || {};
  const todaySales = evolution.at(-1)?.montant ?? ca.jour;
  const yesterdaySales = evolution.at(-2)?.montant ?? 0;
  const salesTrend = trendPct(todaySales, yesterdaySales);
  const alertCount = data?.alertes_stock_count || 0;
  const topProducts = (data?.top_produits_jour || []).slice(0, 5);

  const alerts = useMemo(() => {
    if (!data) return [];
    const items = [];
    if (data.inventory_lock) {
      items.push({ type: 'warn', content: 'Inventaire verrouillé — ventes suspendues.' });
    }
    if (data.caisse_hier_non_cloturee && can('finances', 'view')) {
      items.push({
        type: 'warn',
        content: <>Caisse d&apos;hier non clôturée — <Link to="/finances/caisse">Clôturer</Link></>,
      });
    }
    if (data.dettes_echeues_count > 0 && showReglement) {
      items.push({
        type: 'warn',
        content: <>{data.dettes_echeues_count} dette(s) échue(s) — <Link to="/ventes/reglement">Règlement</Link></>,
      });
    }
    if (data.paniers_en_attente?.length > 0 && showReglement) {
      items.push({
        type: 'info',
        content: <>{data.paniers_en_attente.length} panier(s) à encaisser — <Link to="/ventes/reglement">Encaisser</Link></>,
      });
    }
    return items;
  }, [data, can, showReglement]);

  const followItems = useMemo(() => {
    if (!data) return [];
    const items = [
      { label: 'Reste à encaisser', value: formatGNF(data.ventes_jour?.reste), tone: 'accent' },
    ];
    if (can('ventes', 'view')) {
      items.push({ label: 'Créances clients', value: formatGNF(data.creances_clients?.total) });
    }
    if (can('finances', 'view')) {
      items.push({ label: 'Caisse du jour', value: formatGNF(data.caisse) });
    }
    items.push({ label: 'CA du mois', value: formatGNF(ca.mois) });
    return items;
  }, [data, ca.mois, can]);

  if (loading && !data && !error) {
    return (
      <div className="mgr-cockpit mgr-cockpit--loading" aria-busy="true">
        <LoadingInline label="Chargement de votre cockpit gestionnaire…" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mgr-cockpit mgr-cockpit--error">
        <div className="mgr-cockpit__error-card">
          <p className="mgr-cockpit__error-msg">{error}</p>
          <button type="button" className="mgr-cockpit__retry-btn" onClick={load}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mgr-cockpit">
      <header className="mgr-cockpit__header" aria-label="En-tête gestionnaire">
        <div className="mgr-cockpit__header-bg" aria-hidden>
          {BRAND_FLYERS.map((src, i) => (
            <img key={src} src={src} alt="" className={i === flyerIdx ? 'is-visible' : ''} draggable={false} />
          ))}
        </div>
        <div className="mgr-cockpit__header-overlay" aria-hidden />
        <div className="mgr-cockpit__header-inner">
          <div className="mgr-cockpit__header-row">
            <img src={logoSrc(store?.logo_url, store?.updated_at) || BRAND_LOGO} alt="" className="mgr-cockpit__logo" width="42" height="42" />
            <div className="mgr-cockpit__header-meta">
              <span className="mgr-cockpit__role-badge">Cockpit gestionnaire</span>
              {pvLabel && <span className="mgr-cockpit__pv-tag">{pvLabel}</span>}
            </div>
            <button
              type="button"
              className="mgr-cockpit__refresh"
              onClick={load}
              disabled={loading}
              aria-label="Actualiser le tableau de bord"
            >
              <RefreshIcon spinning={loading} />
            </button>
          </div>
          <h1 className="mgr-cockpit__greeting">
            Bonjour, <em>{firstName}</em>
          </h1>
          <div className="mgr-cockpit__header-foot">
            <time className="mgr-cockpit__date" dateTime={new Date().toISOString().slice(0, 10)}>
              {todayLabel}
            </time>
            {store?.store_name && <span className="mgr-cockpit__store">{store.store_name}</span>}
          </div>
        </div>
      </header>

      <main className="mgr-cockpit__main">
        {pvFilter.canFilter && (
          <div className="mgr-cockpit__pv-filter">
            <PvFilterBar compact />
          </div>
        )}

        {loading && data && (
          <div className="mgr-cockpit__sync-bar" role="status" aria-live="polite">
            Mise à jour en cours…
          </div>
        )}

        {alerts.length > 0 && (
          <section className="mgr-cockpit__alerts" aria-label="Alertes">
            {alerts.map((a, i) => (
              <AlertBanner key={i} type={a.type}>{a.content}</AlertBanner>
            ))}
          </section>
        )}

        <section className="mgr-cockpit__quick" aria-label="Actions rapides">
          <h2 className="mgr-cockpit__section-title">Accès rapide</h2>
          <div className="mgr-cockpit__quick-scroll">
            {visibleActions.map((action) => (
              <Link
                key={action.to}
                to={action.to}
                className={`mgr-cockpit__quick-tile mgr-cockpit__quick-tile--${action.accent}`}
              >
                <span className="mgr-cockpit__quick-icon" aria-hidden>
                  <NavIcon name={action.icon} />
                </span>
                <span className="mgr-cockpit__quick-label">{action.label}</span>
                <span className="mgr-cockpit__quick-desc">{action.desc}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="mgr-cockpit__kpis" aria-label="Indicateurs clés">
          <article className="mgr-cockpit__kpi mgr-cockpit__kpi--featured">
            <div className="mgr-cockpit__kpi-head">
              <span className="mgr-cockpit__kpi-icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              </span>
              <span className="mgr-cockpit__kpi-label">{config.summary.label}</span>
            </div>
            <strong className="mgr-cockpit__kpi-value">{formatGNF(ca.jour ?? data?.ventes_jour?.montant)}</strong>
            {salesTrend && (
              <span className={`mgr-cockpit__kpi-trend${salesTrend.up ? '' : ' is-down'}`}>
                {salesTrend.up ? '↑' : '↓'} {salesTrend.pct.toFixed(1).replace('.', ',')}% vs hier
              </span>
            )}
          </article>

          <article className="mgr-cockpit__kpi">
            <span className="mgr-cockpit__kpi-label">CA 7 jours</span>
            <strong className="mgr-cockpit__kpi-value">{formatGNF(ca.semaine)}</strong>
          </article>

          <article className="mgr-cockpit__kpi">
            <span className="mgr-cockpit__kpi-label">Encaissé</span>
            <strong className="mgr-cockpit__kpi-value">{formatGNF(data?.ventes_jour?.encaisse)}</strong>
            <span className="mgr-cockpit__kpi-hint">{data?.ventes_jour?.paniers || 0} panier(s)</span>
          </article>

          {can('produits', 'view') && (
            <article className={`mgr-cockpit__kpi${alertCount > 0 ? ' mgr-cockpit__kpi--alert' : ''}`}>
              <span className="mgr-cockpit__kpi-label">Alertes stock</span>
              <strong className="mgr-cockpit__kpi-value">{alertCount}</strong>
              <Link to="/produits/stocks" className="mgr-cockpit__kpi-link">Voir stocks</Link>
            </article>
          )}
        </section>

        <div className="mgr-cockpit__dual">
          <section className="mgr-cockpit__card" aria-label="Évolution sur 7 jours">
            <div className="mgr-cockpit__card-head">
              <h2 className="mgr-cockpit__card-title">CA — 7 jours</h2>
            </div>
            <SalesSparkline data={evolution} />
          </section>

          <section className="mgr-cockpit__card" aria-label="À suivre">
            <div className="mgr-cockpit__card-head">
              <h2 className="mgr-cockpit__card-title">À suivre</h2>
            </div>
            <ul className="mgr-cockpit__follow">
              {followItems.map((item) => (
                <li key={item.label} className={item.tone ? `mgr-cockpit__follow-item--${item.tone}` : ''}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {topProducts.length > 0 && (
          <section className="mgr-cockpit__card mgr-cockpit__card--wide" aria-label="Top ventes du jour">
            <div className="mgr-cockpit__card-head">
              <h2 className="mgr-cockpit__card-title">Top ventes aujourd&apos;hui</h2>
              <Link to="/ventes/inventaire" className="mgr-cockpit__card-link">Tout voir</Link>
            </div>
            <ol className="mgr-cockpit__top">
              {topProducts.map((p, i) => (
                <li key={p.product_id || p.name}>
                  <span className={`mgr-cockpit__top-rank mgr-cockpit__top-rank--${i + 1}`}>{i + 1}</span>
                  <div className="mgr-cockpit__top-info">
                    <span className="mgr-cockpit__top-name">{p.name}</span>
                    <span className="mgr-cockpit__top-qty">{formatQty(p.quantite)} vendu(s)</span>
                  </div>
                  <strong className="mgr-cockpit__top-amount">{formatGNF(p.montant)}</strong>
                </li>
              ))}
            </ol>
          </section>
        )}

        {can('dashboard', 'view') && (
          <Link to="/?view=analytics" className="mgr-cockpit__analytics">
            <span>Tableau de bord analytique complet</span>
            <ChevronRight />
          </Link>
        )}
      </main>
    </div>
  );
}
