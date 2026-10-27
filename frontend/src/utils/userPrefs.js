const PREFIX = 'bmb_prefs_';

export function loadPref(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw != null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

const CAISSE_PREFS_VERSION = 3;

export function loadCaissePrefs() {
  const defaults = {
    sale_type: 'detail',
    delivery_point_id: '',
    auto_open: false,
  };
  const prefs = { ...defaults, ...loadPref('caisse', defaults) };
  const version = loadPref('caisse_prefs_version', 1);
  if (version < CAISSE_PREFS_VERSION) {
    prefs.auto_open = false;
    savePref('caisse_prefs_version', CAISSE_PREFS_VERSION);
    savePref('caisse', prefs);
  }
  return prefs;
}

export function saveCaissePrefs(prefs) {
  savePref('caisse_prefs_version', CAISSE_PREFS_VERSION);
  savePref('caisse', prefs);
}

const CAISSE_SESSION_KEY = 'bmb_caisse_session';

export function loadCaisseSession() {
  try {
    const raw = sessionStorage.getItem(CAISSE_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCaisseSession(session) {
  try {
    sessionStorage.setItem(CAISSE_SESSION_KEY, JSON.stringify(session));
  } catch {
    /* private mode */
  }
}

export function clearCaisseSession() {
  try {
    sessionStorage.removeItem(CAISSE_SESSION_KEY);
  } catch {
    /* private mode */
  }
}
