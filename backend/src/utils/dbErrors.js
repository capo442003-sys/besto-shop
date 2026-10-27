/** Erreurs PostgreSQL / connexion base (ne doivent pas faire planter le serveur). */
export function isDbConnectionError(err) {
  if (!err) return false;
  return (
    err.code === '28P01'
    || err.code === '28000'
    || err.code === '3D000'
    || err.code === 'ECONNREFUSED'
    || err.code === 'ENOTFOUND'
    || err.severity === 'FATAL'
  );
}

export function dbErrorMessage(err) {
  if (err?.code === '28P01' || err?.code === '28000') {
    return 'PostgreSQL inaccessible — vérifiez DATABASE_URL dans backend/.env (utilisateur ou mot de passe incorrect)';
  }
  if (err?.code === '3D000') {
    return 'Base de données introuvable — vérifiez DATABASE_URL dans backend/.env';
  }
  return 'PostgreSQL inaccessible — démarrez le service PostgreSQL et vérifiez backend/.env';
}

/** Message lisible pour conflits PostgreSQL (doublons, concurrence). */
export function friendlyDbError(err, fallback = 'Erreur base de données') {
  if (!err) return fallback;
  if (err.code === '23505') {
    const c = String(err.constraint || err.detail || '').toLowerCase();
    if (c.includes('invoice_number') || c.includes('proforma')) {
      return 'Facture déjà générée pour cette vente — vérifiez l\'inventaire des ventes';
    }
    if (c.includes('cart_number')) {
      return 'Conflit de numéro de panier — réessayez';
    }
    if (c.includes('settlement')) {
      return 'Créance déjà enregistrée pour cette vente';
    }
    return 'Enregistrement en double — réessayez';
  }
  if (err.code === '40P01') {
    return 'Une autre vente est en cours sur les mêmes articles — réessayez dans un instant';
  }
  if (err.code === '55P03') {
    return 'Caisse occupée par une autre opération — réessayez';
  }
  return err.message || fallback;
}
