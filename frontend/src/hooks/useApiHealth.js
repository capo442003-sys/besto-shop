import { useEffect, useState, useCallback, useRef } from 'react';
import api from '../api/client';

/** Santé API — ne bascule pas « checking » à chaque poll (évite clignotements Layout). */
export default function useApiHealth(pollMs = 60000) {
  const [status, setStatus] = useState({ ok: true, db: true, checking: true });
  const first = useRef(true);

  const check = useCallback((isManual = false) => {
    if (first.current || isManual) {
      setStatus((s) => ({ ...s, checking: true }));
    }
    return api.get('/health')
      .then((r) => {
        first.current = false;
        setStatus({
          ok: r.data?.status === 'ok',
          db: r.data?.db !== 'down',
          checking: false,
          message: r.data?.db === 'down' ? 'PostgreSQL ne répond pas' : null,
        });
      })
      .catch((err) => {
        first.current = false;
        if (err.response?.status === 503) {
          setStatus({
            ok: false,
            db: false,
            checking: false,
            message: err.response.data?.message || 'PostgreSQL ne répond pas',
          });
          return;
        }
        setStatus({
          ok: false,
          db: false,
          checking: false,
          message: 'Serveur API indisponible',
        });
      });
  }, []);

  useEffect(() => {
    check(false);
    if (!pollMs) return undefined;
    const t = setInterval(() => check(false), pollMs);
    return () => clearInterval(t);
  }, [check, pollMs]);

  return { ...status, refresh: () => check(true) };
}
