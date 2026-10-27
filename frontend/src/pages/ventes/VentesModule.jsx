import { useMemo } from 'react';
import ModuleShell from '../../components/ModuleShell';
import { useAuth } from '../../context/AuthContext';
import { canAccessReglement } from '../../utils/sellerScope';

const BASE_TABS = [
  { to: 'vendre', label: 'Caisse', end: true, module: 'ventes', action: 'create' },
  { to: 'inventaire', label: 'Historique', module: 'ventes', action: 'view' },
  { to: 'clients', label: 'Clients', module: 'ventes', action: 'view' },
  { to: 'factures', label: 'Pro forma', module: 'ventes', action: 'print' },
  { to: 'recus', label: 'Reçus', reglementAccess: true, module: 'ventes', action: 'view' },
  { to: 'bons-commande', label: 'Commandes', module: 'ventes', action: 'create' },
];

const REGLEMENT_TAB = { to: 'reglement', label: 'Encaisser', reglementAccess: true };

export default function VentesModule() {
  const { user, can } = useAuth();
  const tabs = useMemo(() => {
    const list = canAccessReglement(user)
      ? [BASE_TABS[0], REGLEMENT_TAB, ...BASE_TABS.slice(1)]
      : [...BASE_TABS];
    return list.filter((t) => {
      if (t.reglementAccess) return canAccessReglement(user);
      if (t.module && !can(t.module, t.action || 'view')) return false;
      return true;
    });
  }, [user, can]);

  return (
    <ModuleShell
      className="module-shell--ventes"
      title="Ventes"
      subtitle="Caisse mode — encaissement, clients et documents"
      tabs={tabs}
      ariaLabel="Module ventes"
    />
  );
}
