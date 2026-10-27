import { useEffect } from 'react';
import { logoSrc, useStoreSettings } from '../context/StoreSettingsContext';
import { appWindowTitle } from '../constants/version';

function faviconType(url) {
  if (!url) return 'image/svg+xml';
  const u = url.split('?')[0].toLowerCase();
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg';
  if (u.endsWith('.gif')) return 'image/gif';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.svg')) return 'image/svg+xml';
  return 'image/png';
}

/** Met à jour favicon et titre du navigateur selon les paramètres magasin */
export default function DocumentBranding() {
  const { store } = useStoreSettings();

  useEffect(() => {
    const custom = logoSrc(store?.logo_url, store?.updated_at);
    const href = custom || '/favicon.svg';
    const type = faviconType(href);

    let link = document.querySelector('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.type = type;
    link.href = href;

    let apple = document.querySelector('link[rel="apple-touch-icon"]');
    if (!apple) {
      apple = document.createElement('link');
      apple.rel = 'apple-touch-icon';
      document.head.appendChild(apple);
    }
    apple.href = href;

    document.title = appWindowTitle(store?.store_name);

    const appName = store?.store_name?.trim();
    if (appName) {
      let metaApp = document.querySelector('meta[name="application-name"]');
      if (metaApp) metaApp.setAttribute('content', appName);
      let metaApple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
      if (metaApple) metaApple.setAttribute('content', appName);
    }
  }, [store?.logo_url, store?.updated_at, store?.store_name]);

  return null;
}
