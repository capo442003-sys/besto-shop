import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NavIcon } from './NavIcons';
import { SIDEBAR_MODULES } from '../config/navigation';

const SIDEBAR_GROUPS = [
  { label: null, modules: ['dashboard'] },
  { label: 'Activité', modules: ['ventes', 'produits'] },
  { label: 'Gestion', modules: ['employes', 'finances'] },
  { label: 'Système', modules: ['parametres'] },
];

export default function SidebarNav({ stockAlerts = 0 }) {
  const { can } = useAuth();

  const moduleByKey = Object.fromEntries(SIDEBAR_MODULES.map((m) => [m.module, m]));

  return (
    <nav className="bmb-sidebar-nav" aria-label="Modules principaux">
      {SIDEBAR_GROUPS.map((group) => {
        const items = group.modules
          .map((key) => moduleByKey[key])
          .filter((m) => m && can(m.module, 'view'));
        if (!items.length) return null;
        return (
          <div key={group.label || 'main'} className="bmb-nav-section">
            {group.label && <div className="bmb-nav-section__title">{group.label}</div>}
            {items.map((m) => (
              <NavLink
                key={m.path}
                to={m.path}
                end={m.path === '/'}
                className={({ isActive }) =>
                  `bmb-nav-item${isActive ? ' bmb-nav-item--active' : ''}`
                }
              >
                <NavIcon name={m.icon} />
                <span>{m.label}</span>
                {m.module === 'produits' && stockAlerts > 0 && (
                  <span className="bmb-nav-badge">{stockAlerts}</span>
                )}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
