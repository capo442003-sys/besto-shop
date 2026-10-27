/** Détection PWA — iOS standalone, Android, desktop */

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function isAndroidDevice() {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
}

export function isStandaloneMode() {
  if (typeof window === 'undefined') return false;

  if (window.navigator.standalone === true) return true;

  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
  } catch {
    /* matchMedia indisponible */
  }

  // Script inline dans index.html (avant React) — iOS peut ne pas exposer standalone à temps
  const root = document.documentElement;
  if (root?.dataset?.bmbPwa === 'mobile' || root?.dataset?.bmbPwa === 'desktop') {
    return true;
  }
  if (root?.classList?.contains('app-standalone')) {
    return true;
  }

  return false;
}

export function isDesktopPc() {
  return !isIosDevice() && !isAndroidDevice();
}

export function getPwaEnvironment() {
  const standalone = isStandaloneMode();
  const ios = isIosDevice();
  const android = isAndroidDevice();
  const desktop = isDesktopPc();
  const isPwaMobile = standalone && !desktop;

  return { standalone, ios, android, desktop, isPwaMobile };
}

export function applyPwaHtmlClasses(env = getPwaEnvironment()) {
  if (typeof document === 'undefined') return env;
  const root = document.documentElement;

  const inlineMode = root.dataset.bmbPwa;
  if (inlineMode === 'mobile' && env.ios && !env.isPwaMobile) {
    env = { ...env, standalone: true, isPwaMobile: true };
  } else if (inlineMode === 'desktop' && env.desktop && !env.standalone) {
    env = { ...env, standalone: true };
  }

  root.classList.toggle('app-standalone', env.standalone);
  root.classList.toggle('app-desktop-pc', env.standalone && env.desktop);
  root.classList.toggle('app-pwa-mobile', env.isPwaMobile);
  root.classList.toggle('app-ios', env.ios);
  root.classList.toggle('app-android', env.android);

  if (env.standalone) {
    root.dataset.bmbPwa = env.isPwaMobile ? 'mobile' : 'desktop';
  } else {
    delete root.dataset.bmbPwa;
  }

  return env;
}

export function listenPwaEnvironment(onChange) {
  if (typeof window === 'undefined') return () => {};

  const refresh = () => onChange(getPwaEnvironment());

  window.addEventListener('pageshow', refresh);
  window.addEventListener('visibilitychange', refresh);
  window.addEventListener('resize', refresh);

  const mq = window.matchMedia('(display-mode: standalone)');
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', refresh);
  } else if (typeof mq.addListener === 'function') {
    mq.addListener(refresh);
  }

  return () => {
    window.removeEventListener('pageshow', refresh);
    window.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('resize', refresh);
    if (typeof mq.removeEventListener === 'function') {
      mq.removeEventListener('change', refresh);
    } else if (typeof mq.removeListener === 'function') {
      mq.removeListener(refresh);
    }
  };
}
