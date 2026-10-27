/** Message utilisateur à partir d'une erreur axios / réseau */
export function apiErrorMessage(err, fallback = 'Erreur de communication avec le serveur') {
  if (!err?.response) {
    if (err?.code === 'ECONNABORTED') {
      return 'Le serveur met trop de temps à répondre — réessayez (plusieurs caisses actives en même temps).';
    }
    return 'Serveur inaccessible. Vérifiez que le backend est démarré (Railway ou « BESTO SHOP »).';
  }
  const status = err.response.status;
  const msg = err.response.data?.message;
  if (status === 503) {
    return msg || 'Base de données indisponible. Vérifiez que PostgreSQL est démarré.';
  }
  if (status === 409) {
    return msg || 'Conflit — une autre caisse traite la même vente. Réessayez.';
  }
  if (status === 500) {
    return msg || 'Erreur serveur. Consultez la console backend.';
  }
  if (status === 403) return msg || 'Accès refusé';
  return msg || fallback;
}

export function isApiUnreachable(err) {
  return !err?.response;
}
