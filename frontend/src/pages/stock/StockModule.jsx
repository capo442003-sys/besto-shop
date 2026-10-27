import ModuleShell from '../../components/ModuleShell';

const TABS = [
  { to: 'stocks', label: 'Stocks', end: true, module: 'produits', action: 'view' },
  { to: 'liste', label: 'Produits', module: 'produits', action: 'view' },
  { to: 'fournisseurs', label: 'Fournisseurs', module: 'produits', action: 'view' },
  { to: 'inventaire', label: 'Comptage', module: 'produits', action: 'edit' },
];

export default function StockModule() {
  return (
    <ModuleShell
      title="Stock"
      subtitle="Produits, niveaux de stock et fournisseurs"
      tabs={TABS}
    />
  );
}
