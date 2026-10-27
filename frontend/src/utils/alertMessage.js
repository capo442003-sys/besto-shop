/** Détecte si un message utilisateur est une erreur / avertissement */
export function isErrorMessage(msg) {
  return /erreur|insuffisant|sélectionnez|saisissez|requis|invalide|impossible|dépasse|vide|modifiable|manquant|indisponible|introuvable|échou|refus|trop élevé|minimum|ajoutez|déjà|choisissez|annul/i.test(msg || '');
}

export function alertVariant(message) {
  if (!message) return null;
  if (isErrorMessage(message)) return 'error';
  if (/annul|attention|avertissement/i.test(message)) return 'warning';
  return 'success';
}
