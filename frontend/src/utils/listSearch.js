/** Filtre client : correspond si la requête est vide ou incluse dans l'un des champs. */
export function matchesListSearch(query, ...values) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return values.some((v) => String(v ?? '').toLowerCase().includes(q));
}
