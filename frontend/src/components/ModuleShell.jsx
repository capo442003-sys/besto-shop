import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccessReglement } from '../utils/sellerScope';

/**
 * Enveloppe unifiée pour tous les modules — onglets pill + contenu.
 * tabs: { to, label, end?, module?, action?, icon?, reglementAccess?, requireAfterSalePayment? }
 */
export default function ModuleShell({ title, subtitle, tabs = [], ariaLabel, className = '' }) {
  const { can, user } = useAuth();
  const visible = tabs.filter((t) => {
    if (t.reglementAccess || t.requireAfterSalePayment) {
      return canAccessReglement(user);
    }
    if (t.module && !can(t.module, t.action || 'view')) return false;
    return true;
  });

  return (
    <div className={`module-shell${className ? ` ${className}` : ''}`}>
      <header className="module-shell__header bmb-page-head">
        <div className="module-shell__titles bmb-page-head__text">
          <h1 className="module-shell__title bmb-page-head__title">{title}</h1>
          {subtitle && <p className="module-shell__subtitle bmb-page-head__subtitle">{subtitle}</p>}
        </div>
      </header>

      {visible.length > 1 && (
        <nav className="module-tabs" aria-label={ariaLabel || `Onglets ${title}`}>
          {visible.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `module-tab${isActive ? ' module-tab--active' : ''}`}
            >
              {tab.icon && <span className="module-tab__icon" aria-hidden>{tab.icon}</span>}
              {tab.label}
            </NavLink>
          ))}
        </nav>
      )}

      <div className="module-shell__body">
        <Outlet />
      </div>
    </div>
  );
}
