import { useEffect, useState, useMemo } from 'react';
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useStoreSettings } from '../context/StoreSettingsContext';
import { normalizeRoles } from '../utils/roles';
import { getPrimaryHomeRole, homeRoleLabel } from '../utils/homeRole';
import api from '../api/client';
import BrandLogo from './BrandLogo';
import { NavIcon } from './NavIcons';
import SidebarNav from './SidebarNav';
import useApiHealth from '../hooks/useApiHealth';
import CommandPalette from './CommandPalette';
import { usePwa } from '../context/PwaContext';
import useIdleLogout from '../hooks/useIdleLogout';
import { formatStoreHeaderLine } from '../utils/storeFormat';
import { APP_VERSION } from '../constants/version';
import { canAccessReglement } from '../utils/sellerScope';
import PvFilterBar from './PvFilterBar';
import { usePvFilter } from '../context/PvFilterContext';
import { isPvScoped, isZoneManager, pvDisplayLabel } from '../utils/pvScope';
import { getOfflineQueueCount, flushOfflineQueue } from '../utils/offlineQueue';
import { useOnboarding } from '../context/OnboardingContext';

function formatClock(date) {
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function countAlerts(data) {
  if (!data) return 0;
  let n = data.alertes_stock_count || 0;
  if (data.caisse_hier_non_cloturee) n += 1;
  if (data.dettes_echeues_count > 0) n += 1;
  if (data.inventory_lock) n += 1;
  return n;
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const { store } = useStoreSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [stockAlerts, setStockAlerts] = useState(0);
  const [notifCount, setNotifCount] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const apiHealth = useApiHealth(180000);
  const pwa = usePwa();
  const pvFilter = usePvFilter();
  const onboarding = useOnboarding();
  const [offlineCount, setOfflineCount] = useState(() => getOfflineQueueCount());
  useIdleLogout();

  useEffect(() => {
    const onQueueChange = () => setOfflineCount(getOfflineQueueCount());
    window.addEventListener('bmb-offline-queue-changed', onQueueChange);
    const onOnline = () => flushOfflineQueue(api).catch(() => {});
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('bmb-offline-queue-changed', onQueueChange);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const onResize = () => {
      if (window.innerWidth >= 1024) root.classList.add('app-desktop-wide');
      else root.classList.remove('app-desktop-wide');
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      root.classList.remove('app-desktop-wide');
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) {
      document.body.classList.remove('bmb-sidebar-open');
      return undefined;
    }
    document.body.classList.add('bmb-sidebar-open');
    return () => document.body.classList.remove('bmb-sidebar-open');
  }, [sidebarOpen]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!can('dashboard', 'view') && !can('produits', 'view')) return;
    api.get('/dashboard')
      .then((r) => {
        setStockAlerts(r.data?.alertes_stock_count || 0);
        setNotifCount(countAlerts(r.data));
      })
      .catch(() => {
        setStockAlerts(0);
        setNotifCount(0);
      });
    // Une fois par session utilisateur — pas à chaque navigation (évite lenteur / clignotements)
  }, [user?.id]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const roles = useMemo(
    () => normalizeRoles(user?.roles, user?.role).join(' · '),
    [user?.roles, user?.role]
  );

  const primaryRoleLabel = useMemo(
    () => homeRoleLabel(getPrimaryHomeRole(user)),
    [user]
  );

  const initials = (user?.full_name || 'U')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const isPwaMobile = Boolean(
    pwa?.isPwaMobile
    || (typeof document !== 'undefined' && document.documentElement.classList.contains('app-pwa-mobile'))
  );

  const activePvLabel = pvFilter.selectedPv
    ? `${pvFilter.selectedPv.code} — ${pvFilter.selectedPv.name}`
    : pvDisplayLabel(user);

  return (
    <div className={`app-layout bmb-v2${sidebarOpen ? ' app-layout--sidebar-open' : ''}${pwa?.standalone ? ' app-layout--pwa' : ''}${isPwaMobile ? ' app-layout--pwa-mobile' : ''}`}>
      <div className="app-layout__workspace">
      {sidebarOpen && (
        <button type="button" className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Fermer" />
      )}

      <aside className="sidebar bmb-sidebar">
        <div className="sidebar-brand bmb-sidebar__brand">
          <BrandLogo variant="full" />
        </div>

        <SidebarNav stockAlerts={stockAlerts} />

        <div className="bmb-sidebar__store-card">
          <strong>{store?.store_name || 'BESTO SHOP'}</strong>
          <span>{formatStoreHeaderLine(store)}</span>
        </div>

        <div className="sidebar-footer">
          <button type="button" className="sidebar-logout-btn" onClick={handleLogout}>
            <NavIcon name="logout" />
            Déconnexion
          </button>
          <span className="bmb-sidebar__version">v{APP_VERSION}</span>
        </div>
      </aside>

      <div className="main-content bmb-main">
        <header className="topbar bmb-topbar">
          {isPwaMobile ? (
            <>
              <div className="bmb-topbar__pwa-brand">
                <BrandLogo variant="icon" className="bmb-topbar__pwa-logo" />
                <span className="bmb-topbar__pwa-title">
                  BESTO <strong>SHOP</strong>
                </span>
              </div>
              <button
                type="button"
                className="bmb-topbar__pwa-role"
                onClick={() => setSidebarOpen(true)}
                aria-label={`Profil ${primaryRoleLabel}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {primaryRoleLabel}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </>
          ) : (
          <>
          <div className="bmb-topbar__left">
            <button
              type="button"
              className="sidebar-toggle bmb-topbar__menu-btn"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
            >
              <span /><span /><span />
            </button>
            <div className="bmb-topbar__mobile-logo">
              <BrandLogo variant="full" />
            </div>
            {!pwa?.standalone && (
              <span className="bmb-topbar__store">{store?.store_name || 'BESTO SHOP'}</span>
            )}
          </div>
          <div className="bmb-topbar__right">
            {(isPvScoped(user) || isZoneManager(user) || pvFilter.canFilter) && activePvLabel ? (
              <span className="bmb-topbar__pv-badge" title="Point de vente actif">{activePvLabel}</span>
            ) : null}
            <PvFilterBar compact />
            {import.meta.env.DEV && (
              <span className="topbar__env-badge">Développement</span>
            )}
            <button
              type="button"
              className="bmb-topbar__notif"
              title="Alertes"
              onClick={() => navigate('/')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
              </svg>
              {notifCount > 0 && <span className="bmb-topbar__notif-badge">{notifCount}</span>}
            </button>
            <button type="button" className="topbar-search" onClick={() => setCmdOpen(true)} title="Ctrl+K">
              Rechercher…
            </button>
            <div className="bmb-topbar__user">
              <span className="bmb-topbar__role-pill" title={roles}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {primaryRoleLabel}
              </span>
              <button
                type="button"
                className="bmb-topbar__user-btn"
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-expanded={userMenuOpen}
              >
                <span className="bmb-topbar__avatar">{initials}</span>
                <span className="bmb-topbar__user-info">
                  <strong>{user?.full_name}</strong>
                  <small>{roles.split(' · ')[0]}</small>
                </span>
              </button>
              {userMenuOpen && (
                <div className="bmb-topbar__dropdown">
                  <button type="button" onClick={handleLogout}>Déconnexion</button>
                </div>
              )}
            </div>
            <time className="topbar__clock" dateTime={now.toISOString()}>{formatClock(now)}</time>
          </div>
          </>
          )}
        </header>

        <main className="page bmb-page">
          <div className="bmb-page__inner">
          {pwa && !pwa.isOnline && (
            <div className="alert alert-error api-health-banner" role="alert">
              <strong>Connexion perdue</strong> — Vous êtes hors ligne.
            </div>
          )}
          {!apiHealth.ok && !apiHealth.checking && (
            <div className="alert alert-warning api-health-banner" role="alert">
              <strong>Serveur indisponible</strong> — {apiHealth.message || 'L\'API ne répond pas.'}
              <button type="button" className="btn btn-secondary btn-sm" onClick={apiHealth.refresh}>Vérifier</button>
            </div>
          )}
          {offlineCount > 0 && (
            <div className="alert alert-warning bmb-print-skip" role="alert">
              <strong>{offlineCount} opération(s) caisse en attente</strong> — synchronisation à la reconnexion.
            </div>
          )}
          {onboarding.showCard && location.pathname === '/' && (
            <section className="bmb-onboarding-card bmb-print-skip">
              <div className="bmb-onboarding-card__inner">
                <div>
                  <h2 className="bmb-onboarding-card__title">Bienvenue sur BESTO SHOP</h2>
                  <p className="bmb-onboarding-card__progress">
                    {onboarding.completedCount}/{onboarding.steps.length} étapes — parcours de prise en main
                  </p>
                  <ul className="bmb-onboarding-card__steps">
                    {onboarding.steps.map((step) => (
                      <li key={step.id} className={onboarding.completed[step.id] ? 'is-done' : undefined}>
                        {step.label}
                      </li>
                    ))}
                  </ul>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={onboarding.dismiss}>
                  Masquer
                </button>
              </div>
            </section>
          )}
          <Outlet />
          </div>
        </main>
      </div>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Navigation mobile">
        <Link to="/" className={`mobile-bottom-nav__item${location.pathname === '/' ? ' mobile-bottom-nav__item--active' : ''}`}>
          <NavIcon name="dashboard" /><span>Accueil</span>
        </Link>
        {can('ventes', 'create') && (
          <Link to="/ventes/vendre" className={`mobile-bottom-nav__item${location.pathname === '/ventes/vendre' ? ' mobile-bottom-nav__item--active' : ''}`}>
            <NavIcon name="caisse" /><span>Caisse</span>
          </Link>
        )}
        {canAccessReglement(user) && (
          <Link to="/ventes/reglement" className={`mobile-bottom-nav__item${location.pathname.startsWith('/ventes/reglement') ? ' mobile-bottom-nav__item--active' : ''}`}>
            <NavIcon name="finances" /><span>Encaisser</span>
          </Link>
        )}
        {can('produits', 'view') && (
          <Link to="/produits/stocks" className={`mobile-bottom-nav__item${location.pathname.startsWith('/produits') ? ' mobile-bottom-nav__item--active' : ''}`}>
            <NavIcon name="stock" /><span>Stock</span>
          </Link>
        )}
        <button type="button" className="mobile-bottom-nav__item" onClick={() => setSidebarOpen(true)} aria-label="Menu">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span>Menu</span>
        </button>
      </nav>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
