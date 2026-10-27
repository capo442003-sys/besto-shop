import ModuleShell from '../../components/ModuleShell';

const TABS = [
  { to: 'liste', label: 'Employés', end: true, module: 'employes' },
  { to: 'salaires', label: 'Salaires', module: 'employes' },
  { to: 'plannings', label: 'Plannings', module: 'employes' },
  { to: 'stats', label: 'Performances', module: 'employes' },
];

export default function EmployesModule() {
  return (
    <ModuleShell
      title="Employés"
      subtitle="Personnel, rémunération et performances"
      tabs={TABS}
    />
  );
}
