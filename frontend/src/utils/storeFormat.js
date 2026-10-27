/** Formate les numéros de téléphone du magasin pour affichage */
export function formatStorePhones(store) {
  if (!store) return '';
  const phones = [store.phone, store.phone_2, store.phone_3].filter(Boolean);
  if (!phones.length) return '';
  return phones.map((p) => `Tél. ${p}`).join(' · ');
}

/** Téléphones séparés par « / » (factures imprimées) */
export function formatStorePhonesSlash(store) {
  if (!store) return '';
  return [store.phone, store.phone_2, store.phone_3].filter(Boolean).join(' / ');
}

/** Ligne d'en-tête magasin : adresse + téléphones */
export function formatStoreHeaderLine(store) {
  if (!store) return 'Gestion magasin';
  const parts = [store.address, formatStorePhones(store)].filter(Boolean);
  return parts.join(' · ') || 'Gestion magasin';
}

/** Sous-titre activité magasin (factures) — uniquement si configuré dans le magasin */
export function formatStoreActivityLine(store) {
  return store?.invoice_tagline?.trim() || '';
}
