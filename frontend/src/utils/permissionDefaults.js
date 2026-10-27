/** Droits par défaut si la base ne renvoie pas role_permissions */
export const ROLE_DEFAULTS = {
  vendeur: {
    dashboard: { view: true, print: true },
    ventes: { view: true, create: true, print: true },
  },
  caissier: {
    dashboard: { view: true, print: true },
    ventes: { view: true, create: true, edit: true, print: true },
  },
  controleur: {
    dashboard: { view: true, print: true },
    ventes: { view: true, create: true, print: true },
    produits: { view: true, print: true },
  },
  gestionnaire: {
    dashboard: { view: true, print: true },
    ventes: { view: true, create: true, edit: true, print: true },
    produits: { view: true, create: true, edit: true, print: true },
    employes: { view: true, create: true, edit: true, delete: false, print: true },
    finances: { view: true, create: true, edit: true, print: true },
  },
  comptable: {
    dashboard: { view: true, print: true },
    ventes: { view: true, create: true, edit: true, print: true },
    produits: { view: true, create: true, edit: true, print: true },
    employes: { view: true, create: true, edit: true, delete: false, print: true },
    finances: { view: true, create: true, edit: true, print: true },
  },
  assistant: {
    dashboard: { view: true },
    ventes: { view: true, create: true, print: true },
    produits: { view: true, print: true },
  },
  administrateur: { all: true },
};

export function defaultCan(roles, module, action = 'view') {
  if (roles.includes('administrateur')) return true;
  const key = { view: 'view', create: 'create', edit: 'edit', delete: 'delete', print: 'print' }[action] || 'view';
  for (const role of roles) {
    const mod = ROLE_DEFAULTS[role]?.[module];
    if (mod?.[key]) return true;
  }
  return false;
}
