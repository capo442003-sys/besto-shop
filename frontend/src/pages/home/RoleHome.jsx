import { Link } from 'react-router-dom';
import { useEffect, useState, useMemo } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { formatGNF } from '../../utils/format';
import { NavIcon } from '../../components/NavIcons';
import { BRAND_FEATURES } from '../../config/brandAssets';
import { homeRoleLabel } from '../../utils/homeRole';
import { getRoleHomeConfig } from './roleHomeConfigs';
import { canAccessReglement } from '../../utils/sellerScope';
import { stockQueryParams } from '../../utils/pvScope';
import LoadingInline from '../../components/ui/LoadingInline';


function readDashboardPath(data, path) {
  if (!data || !path) return null;
  return path.split('.').reduce((acc, key) => (acc != null ? acc[key] : null), data);
}

function formatSummaryValue(value, summary) {
  if (value == null || Number.isNaN(value)) return '—';
  if (summary.format === 'count') {
    const n = parseInt(value, 10) || 0;
    return `${n} ${summary.suffix || ''}`.trim();
  }
  return formatGNF(value);
}

function computeSalesTrend(dash) {
  const series = dash?.evolution_ca_7j;
  if (!series || series.length < 2) return null;
  const today = parseFloat(series[series.length - 1]?.montant ?? 0);
  const yesterday = parseFloat(series[series.length - 2]?.montant ?? 0);
  if (yesterday <= 0) return null;
  const pct = ((today - yesterday) / yesterday) * 100;
  return { pct: Math.abs(pct), up: pct >= 0 };
}

export default function RoleHome({ role }) {
  const { user, can } = useAuth();
  const config = getRoleHomeConfig(role);
  const [dash, setDash] = useState(null);
  const [dashLoading, setDashLoading] = useState(true);

  useEffect(() => {
    setDashLoading(true);
    api.get('/dashboard', { params: stockQueryParams(user) })
      .then((r) => setDash(r.data))
      .catch(() => {})
      .finally(() => setDashLoading(false));
  }, [user]);


  const firstName = (user?.full_name || homeRoleLabel(role)).split(' ')[0];
  const roleLabel = homeRoleLabel(role);
  const salesTrend = useMemo(() => computeSalesTrend(dash), [dash]);

  const visibleActions = useMemo(
    () => config.actions.filter((a) => {
      if (!can(a.module, a.action || 'view')) return false;
      if (a.requireAfterSalePayment && !canAccessReglement(user)) return false;
      return true;
    }),
    [config.actions, can, user]
  );

  const summaryValue = formatSummaryValue(
    readDashboardPath(dash, config.summary.path),
    config.summary
  );

  return (
    <div className="bmb-role-home">
      <section className="bmb-role-home__hero bmb-role-home__hero--solid" aria-label="Accueil">
        <div className="bmb-role-home__hero-shade" aria-hidden />
        <div className="bmb-role-home__hero-content">
          <p className="bmb-role-home__badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            {roleLabel}
          </p>
          <h1 className="bmb-role-home__title">
            Bonjour, <span className="bmb-role-home__name">{firstName}</span>
          </h1>
          <span className="bmb-role-home__title-accent" aria-hidden />
        </div>
      </section>

      <div className="bmb-role-home__body">
        <h1 className="bmb-role-home__title bmb-role-home__title--pwa">
          Bonjour, <span className="bmb-role-home__name">{firstName}</span>
        </h1>

        <div className="bmb-role-home__features" aria-hidden>
          {BRAND_FEATURES.map((f) => (
            <span key={f.label} className="bmb-role-home__feat" style={{ '--feat-color': f.color }}>
              {f.label}
            </span>
          ))}
        </div>

        <div className="bmb-role-home__actions">
          {visibleActions.map((action) => (
            <Link
              key={action.to + action.label}
              to={action.to}
              className={`bmb-role-home__btn bmb-role-home__btn--${action.variant}`}
            >
              <span className="bmb-role-home__btn-icon" aria-hidden>
                <NavIcon name={action.icon} />
              </span>
              <span className="bmb-role-home__btn-text">
                <strong>{action.label}</strong>
                {action.subtitle && <small>{action.subtitle}</small>}
              </span>
              <span className="bmb-role-home__btn-chevron" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </Link>
          ))}
        </div>

        <div className="bmb-role-home__summary">
          {dashLoading ? (
            <div className="bmb-role-home__summary bmb-role-home__summary--loading">
              <LoadingInline label="Chargement du résumé…" />
            </div>
          ) : (
            <>
          <div className="bmb-role-home__summary-head">
            <span className="bmb-role-home__summary-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
            </span>
            <div className="bmb-role-home__summary-meta">
              <strong>Résumé des ventes</strong>
              <span>Aujourd&apos;hui</span>
            </div>
          </div>
          <div className="bmb-role-home__summary-text">
            <span>{config.summary.label}</span>
            <strong className="bmb-role-home__summary-amount">{summaryValue}</strong>
          </div>
          <strong className="bmb-role-home__summary-amount bmb-role-home__summary-amount--pwa">{summaryValue}</strong>
          {salesTrend && (
            <p className={`bmb-role-home__summary-trend${salesTrend.up ? '' : ' is-down'}`}>
              {salesTrend.up ? '↗' : '↘'}{' '}
              {salesTrend.pct.toFixed(1).replace('.', ',')}% vs hier
            </p>
          )}
            </>
          )}
        </div>

        {dash && !dashLoading && (
          <div className="bmb-role-home__kpis" aria-label="Indicateurs du jour">
            <div className="bmb-role-home__kpi">
              <span className="bmb-role-home__kpi-label">Paniers</span>
              <strong className="bmb-role-home__kpi-value">{dash.ventes_jour?.paniers ?? 0}</strong>
            </div>
            <div className="bmb-role-home__kpi">
              <span className="bmb-role-home__kpi-label">Encaissé</span>
              <strong className="bmb-role-home__kpi-value">{formatGNF(dash.ventes_jour?.encaisse)}</strong>
            </div>
            <div className="bmb-role-home__kpi">
              <span className="bmb-role-home__kpi-label">Reste</span>
              <strong className="bmb-role-home__kpi-value">{formatGNF(dash.ventes_jour?.reste)}</strong>
            </div>
          </div>
        )}

        {dash && !dashLoading && (dash.inventory_lock || (dash.paniers_en_attente?.length > 0 && canAccessReglement(user))) && (
          <div className="bmb-role-home__alerts">
            {dash.inventory_lock && (
              <div className="bmb-role-home__alert" role="alert">Inventaire verrouillé — ventes suspendues.</div>
            )}
            {dash.paniers_en_attente?.length > 0 && canAccessReglement(user) && (
              <div className="bmb-role-home__alert" role="status">
                {dash.paniers_en_attente.length} panier(s) à encaisser —{' '}
                <Link to="/ventes/reglement">Ouvrir le règlement</Link>
              </div>
            )}
          </div>
        )}

        {can('ventes', 'view') && !config.analytics && (
          <Link to="/?view=analytics" className="bmb-role-home__analytics-link">
            Voir mon activité détaillée →
          </Link>
        )}

        {config.analytics && can('dashboard', 'view') && (
          <Link to="/?view=analytics" className="bmb-role-home__analytics-link">
            Voir le tableau de bord analytique →
          </Link>
        )}
      </div>
    </div>
  );
}
