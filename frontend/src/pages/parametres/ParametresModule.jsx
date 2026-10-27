import ModuleShell from '../../components/ModuleShell';
import { useAuth } from '../../context/AuthContext';

const TABS = [
  { to: 'magasin', label: 'Boutique', end: true, module: 'parametres', action: 'view' },
  { to: 'utilisateurs', label: 'Comptes', module: 'parametres', action: 'view' },
  { to: 'points-vente', label: 'Points de vente', module: 'parametres', action: 'view' },
  { to: 'audit', label: 'Journal', module: 'parametres', action: 'view', adminOnly: true },
  { to: 'sante-donnees', label: 'Données', module: 'parametres', action: 'view', adminOnly: true },
  { to: 'import', label: 'Import', module: 'parametres', action: 'view', adminOnly: true },
  { to: 'systeme', label: 'Système', module: 'parametres', action: 'view', adminOnly: true },
  { to: 'permissions', label: 'Droits', module: 'parametres', action: 'view', adminOnly: true },
  { to: 'sessions', label: 'Sessions', module: 'parametres', action: 'view', adminOnly: true },
];

export default function ParametresModule() {
  const { can, userRoles } = useAuth();
  const isAdmin = userRoles().includes('administrateur');
  const tabs = TABS.filter((t) => {
    if (t.adminOnly && !isAdmin) return false;
    return can(t.module, t.action);
  });

  return (
    <ModuleShell
      title="Réglages"
      subtitle="Identité boutique, comptes et accès"
      tabs={tabs}
    />
  );
}
