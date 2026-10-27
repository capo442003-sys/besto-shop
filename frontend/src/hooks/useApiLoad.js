import { useCallback } from 'react';
import { useNotify } from './useNotify';

/**
 * Exécute un appel API avec gestion d'erreur utilisateur.
 */
export function useApiLoad() {
  const notify = useNotify();

  const run = useCallback(async (promise, fallbackMessage) => {
    try {
      return await promise;
    } catch (err) {
      notify.apiError(err, fallbackMessage || 'Chargement impossible');
      throw err;
    }
  }, [notify]);

  return { run, notify };
}
