import ModuleShell from '../../components/ModuleShell';

const TABS = [
  { to: 'caisse', label: 'Caisse jour', end: true, module: 'finances' },
  { to: 'historique', label: 'Historique', module: 'finances' },
  { to: 'charges', label: 'Charges', module: 'finances' },
  { to: 'bilan', label: 'Bilan', module: 'finances' },
];

export default function FinancesModule() {
  return (
    <ModuleShell
      title="Finances"
      subtitle="Trésorerie, charges et bilan"
      tabs={TABS}
    />
  );
}
