import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import {
  applyPwaHtmlClasses,
  getPwaEnvironment,
  listenPwaEnvironment,
} from '../utils/pwaEnv';

const PwaContext = createContext(null);
const INSTALL_DISMISS_KEY = 'bmb-pwa-install-dismissed';
const INSECURE_DISMISS_KEY = 'bmb-pwa-insecure-dismissed';

function isIosDevice() {
  return getPwaEnvironment().ios;
}

export function PwaProvider({ children }) {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);
  const [showDesktopHint, setShowDesktopHint] = useState(false);
  const [showInsecureHint, setShowInsecureHint] = useState(false);
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const gotPromptRef = useRef(false);

  const [pwaEnv, setPwaEnv] = useState(() => {
    let env = getPwaEnvironment();
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (root?.classList.contains('app-pwa-mobile') && !env.isPwaMobile) {
      env = { ...env, standalone: true, isPwaMobile: true };
    } else if (root?.dataset?.bmbPwa === 'mobile' && !env.isPwaMobile) {
      env = { ...env, standalone: true, isPwaMobile: true, ios: env.ios || root.classList.contains('app-ios') };
    }
    return applyPwaHtmlClasses(env);
  });

  useEffect(() => {
    return listenPwaEnvironment((env) => {
      applyPwaHtmlClasses(env);
      setPwaEnv(env);
    });
  }, []);

  const standalone = pwaEnv.standalone;
  const isDesktopPcFlag = pwaEnv.desktop;
  const isPwaMobile = pwaEnv.isPwaMobile;

  useEffect(() => {
    if (standalone || typeof window === 'undefined') return;
    if (window.isSecureContext) return;
    if (sessionStorage.getItem(INSECURE_DISMISS_KEY)) return;
    setShowInsecureHint(true);
  }, [standalone]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return undefined;

    const applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
        // Applique automatiquement les mises à jour (textes, correctifs) sans bloquer l'utilisateur
        setTimeout(() => applyUpdate(true), 1500);
      },
    });

    setUpdateSW(() => applyUpdate);
    return undefined;
  }, []);

  useEffect(() => {
    if (standalone) return undefined;
    if (sessionStorage.getItem(INSTALL_DISMISS_KEY)) return undefined;

    if (isIosDevice()) {
      setShowIosHint(true);
      return undefined;
    }

    let desktopTimer;

    const onBeforeInstall = (e) => {
      e.preventDefault();
      gotPromptRef.current = true;
      setInstallPrompt(e);
      setShowInstallBanner(true);
      setShowDesktopHint(false);
      clearTimeout(desktopTimer);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    if (isDesktopPcFlag) {
      desktopTimer = setTimeout(() => {
        if (!gotPromptRef.current) setShowDesktopHint(true);
      }, 5000);
    }

    return () => {
      clearTimeout(desktopTimer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    };
  }, [standalone]);

  const install = useCallback(async () => {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      setShowInstallBanner(false);
      return true;
    }
    return false;
  }, [installPrompt]);

  const dismissHints = useCallback(() => {
    sessionStorage.setItem(INSTALL_DISMISS_KEY, '1');
    setShowInstallBanner(false);
    setShowIosHint(false);
    setShowDesktopHint(false);
  }, []);

  const dismissInsecureHint = useCallback(() => {
    sessionStorage.setItem(INSECURE_DISMISS_KEY, '1');
    setShowInsecureHint(false);
  }, []);

  const applyUpdate = useCallback(() => {
    updateSW?.(true);
    setNeedRefresh(false);
  }, [updateSW]);

  const value = {
    standalone,
    isOnline,
    isPwaMobile,
    isIos: pwaEnv.ios,
    canInstall: Boolean(installPrompt),
    isDesktopPc: isDesktopPcFlag,
    install,
    dismissHints,
    showInstallHelp: () => {
      if (isIosDevice()) setShowIosHint(true);
      else if (isDesktopPcFlag) setShowDesktopHint(true);
      else setShowInstallBanner(true);
    },
  };

  return (
    <PwaContext.Provider value={value}>
      {children}
      {(!isOnline || (!standalone && (showInstallBanner || showIosHint || showDesktopHint || showInsecureHint || needRefresh))) && (
        <div className="pwa-banners" role="region" aria-label="Notifications application">
          {showInsecureHint && (
            <div className="pwa-banner pwa-banner--warning">
              <span className="pwa-banner__text">
                <strong>Connexion non sécurisée (HTTP)</strong> — La fenêtre installée affiche l&apos;adresse IP.
                {' '}Sur le PC serveur, exécutez <code>npm run ssl:generate</code>, redémarrez le backend,
                puis ouvrez <strong>https://</strong>… (même IP) avant d&apos;installer la PWA.
              </span>
              <div className="pwa-banner__actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={dismissInsecureHint}>
                  Compris
                </button>
              </div>
            </div>
          )}
          {!isOnline && (
            <div className="pwa-banner pwa-banner--offline">
              <span className="pwa-banner__text">
                <strong>Hors ligne</strong> — Les ventes et stocks nécessitent le serveur. Reconnectez le réseau ou le PC serveur.
              </span>
            </div>
          )}
          {needRefresh && (
            <div className="pwa-banner pwa-banner--update">
              <span className="pwa-banner__text">Une mise à jour de BESTO SHOP est disponible.</span>
              <div className="pwa-banner__actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={applyUpdate}>
                  Mettre à jour
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNeedRefresh(false)}>
                  Plus tard
                </button>
              </div>
            </div>
          )}
          {showInstallBanner && (
            <div className="pwa-banner pwa-banner--install">
              <span className="pwa-banner__text">
                Installez BESTO SHOP sur ce PC ou appareil pour l&apos;ouvrir comme une application (sans navigateur).
              </span>
              <div className="pwa-banner__actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={install}>
                  Installer
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={dismissHints}>
                  Ignorer
                </button>
              </div>
            </div>
          )}
          {showDesktopHint && (
            <div className="pwa-banner pwa-banner--install">
              <span className="pwa-banner__text">
                <strong>Installer sur PC (Windows)</strong> — Ouvrez BESTO SHOP dans{' '}
                <strong>Chrome</strong> ou <strong>Edge</strong>, puis cliquez l&apos;icône{' '}
                <strong>Installer</strong> dans la barre d&apos;adresse, ou Menu
                {' '}
                <strong>Installer l&apos;application</strong>.
              </span>
              <div className="pwa-banner__actions">
                {installPrompt && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={install}>
                    Installer maintenant
                  </button>
                )}
                <button type="button" className="btn btn-secondary btn-sm" onClick={dismissHints}>
                  Compris
                </button>
              </div>
            </div>
          )}
          {showIosHint && (
            <div className="pwa-banner pwa-banner--install">
              <span className="pwa-banner__text">
                Sur iPhone : Safari → <strong>Partager</strong> → <strong>Sur l&apos;écran d&apos;accueil</strong>.
              </span>
              <div className="pwa-banner__actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={dismissHints}>
                  Compris
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </PwaContext.Provider>
  );
}

export function usePwa() {
  const ctx = useContext(PwaContext);
  return ctx;
}
