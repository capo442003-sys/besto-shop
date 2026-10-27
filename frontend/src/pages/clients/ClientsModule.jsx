import ModuleShell from '../../components/ModuleShell';

const TABS = [
  { to: 'liste', label: 'Clients', end: true, module: 'ventes', action: 'view' },
  { to: 'factures', label: 'Factures', module: 'ventes', action: 'print' },
  { to: 'bons', label: 'Bons de commande', module: 'ventes', action: 'create' },
  { to: 'historique', label: 'Historique ventes', module: 'ventes', action: 'view' },
];

export default function ClientsModule() {
  return (
    <ModuleShell
      title="Clients"
      subtitle="Clients, factures et suivi commercial"
      tabs={TABS}
    />
  );
}
