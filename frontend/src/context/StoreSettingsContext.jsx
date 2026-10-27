import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api from '../api/client';
import { resolveAssetUrl } from '../config/api';

const StoreSettingsContext = createContext(null);

export function StoreSettingsProvider({ children }) {
  const [store, setStore] = useState({
    store_name: 'BESTO SHOP',
    logo_url: null,
    login_image_1_url: null,
    login_image_2_url: null,
    login_image_3_url: null,
    address: '',
    phone: '',
    phone_2: '',
    phone_3: '',
    email: '',
  });
  const [loading, setLoading] = useState(true);

  const refreshStore = useCallback(async () => {
    const { data } = await api.get('/settings/store');
    setStore(data || {});
    return data;
  }, []);

  useEffect(() => {
    refreshStore()
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshStore]);

  useEffect(() => {
    const theme = store?.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }, [store?.theme]);

  return (
    <StoreSettingsContext.Provider value={{ store, setStore, loading, refreshStore }}>
      {children}
    </StoreSettingsContext.Provider>
  );
}

export const useStoreSettings = () => {
  const ctx = useContext(StoreSettingsContext);
  if (!ctx) throw new Error('useStoreSettings must be used within StoreSettingsProvider');
  return ctx;
};

/** URL d'un asset magasin (logo, images login…) avec cache-bust optionnel */
export function logoSrc(logoUrl, bust) {
  if (!logoUrl) return null;
  // Aperçu local immédiat (File / blob) — ne pas passer par resolveAssetUrl
  if (/^(blob:|data:)/i.test(logoUrl)) return logoUrl;
  const resolved = resolveAssetUrl(logoUrl);
  const v = bust ? new Date(bust).getTime() : 0;
  if (!v || Number.isNaN(v)) return resolved;
  return `${resolved}${resolved.includes('?') ? '&' : '?'}v=${v}`;
}

export const storeAssetSrc = logoSrc;
