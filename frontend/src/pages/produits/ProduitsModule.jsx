import ModuleShell from '../../components/ModuleShell';

const TABS = [
  { to: 'stocks', label: 'Stocks', end: true, module: 'produits', action: 'view' },
  { to: 'liste', label: 'Articles', module: 'produits', action: 'view' },
  { to: 'inventaire', label: 'Inventaire', module: 'produits', action: 'edit' },
  { to: 'fournisseurs', label: 'Fournisseurs', module: 'produits', action: 'view' },
];

export default function ProduitsModule() {
  return (
    <ModuleShell
      className="module-shell--produits"
      title="Catalogue"
      subtitle="Articles, tailles & stocks — vêtements et chaussures"
      tabs={TABS}
    />
  );
}
