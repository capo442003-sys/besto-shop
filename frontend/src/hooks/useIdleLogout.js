import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useStoreSettings } from '../context/StoreSettingsContext';

const EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'];

export default function useIdleLogout() {
  const { user, logout } = useAuth();
  const { store } = useStoreSettings();
  const timer = useRef(null);

  useEffect(() => {
    if (!user) return undefined;
    const minutes = parseInt(store?.pos_idle_minutes, 10);
    if (!minutes || minutes < 5) return undefined;

    const reset = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        logout();
        window.location.replace('/login?reason=idle');
      }, minutes * 60 * 1000);
    };

    reset();
    EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer.current);
      EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user, store?.pos_idle_minutes, logout]);
}
