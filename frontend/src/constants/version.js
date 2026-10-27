export const APP_VERSION = '1.2.0';
export const APP_NAME = 'BESTO SHOP';

/** Titre barre fenêtre / onglet : nom du magasin uniquement */
export function appWindowTitle(storeName) {
  return storeName?.trim() || '';
}
