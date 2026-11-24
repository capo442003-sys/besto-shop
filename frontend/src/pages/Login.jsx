import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { logoSrc, useStoreSettings } from '../context/StoreSettingsContext';
import api from '../api/client';
import {
  BRAND_LOGO,
  BRAND_NAME,
  BRAND_APP_NAME,
  BRAND_PHONE,
  BRAND_PHONE_TEL,
} from '../config/brandAssets';
import Etoffe from '../components/ui/Etoffe';

const SLIDE_INTERVAL_MS = 8000;

function loginErrorMessage(err) {
  if (!err.response) {
    return 'Serveur inaccessible. Vérifiez votre connexion ou relancez BESTO SHOP.';
  }
  if (err.response?.status === 503) {
    return err.response?.data?.message || 'PostgreSQL indisponible — démarrez la base de données';
  }
  return err.response?.data?.message || 'Identifiant ou mot de passe incorrect';
}

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiDown, setApiDown] = useState(false);
  const [healthMsg, setHealthMsg] = useState('');
  const [healthChecking, setHealthChecking] = useState(true);
  const [slideIndex, setSlideIndex] = useState(0);
  const { login, user, loading: authLoading } = useAuth();
  const { store } = useStoreSettings();
  const navigate = useNavigate();

  const bust = store?.updated_at;

  const customSlides = useMemo(() => (
    [1, 2, 3]
      .map((n) => logoSrc(store?.[`login_image_${n}_url`], bust))
      .filter(Boolean)
  ), [store, bust]);

  const slideCount = customSlides.length > 0 ? Math.min(3, customSlides.length) : 3;

  useEffect(() => {
    if (!authLoading && user) {
      navigate('/', { replace: true });
    }
  }, [authLoading, user, navigate]);

  useEffect(() => {
    const checkHealth = () => {
      setHealthChecking(true);
      api.get('/health', { validateStatus: () => true })
        .then((r) => {
          const dbDown = r.status === 503 || r.data?.db === 'down' || r.data?.status === 'degraded';
          const serverDown = r.status === 0 || (r.status >= 500 && r.status !== 503);
          if (serverDown) {
            setApiDown(true);
            setHealthMsg('Erreur serveur — réessayez dans un instant');
            return;
          }
          setApiDown(dbDown);
          setHealthMsg(
            dbDown
              ? (r.data?.message || 'PostgreSQL inaccessible — vérifiez DATABASE_URL dans backend/.env')
              : ''
          );
        })
        .catch(() => {
          setApiDown(true);
          setHealthMsg(
            'Serveur inaccessible — vérifiez votre connexion ou relancez BESTO SHOP'
          );
        })
        .finally(() => setHealthChecking(false));
    };
    checkHealth();
    const t = setInterval(checkHealth, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (slideCount <= 1) return undefined;
    const timer = setInterval(() => {
      setSlideIndex((i) => (i + 1) % slideCount);
    }, SLIDE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [slideCount]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      try {
        localStorage.setItem('bmb_login_seen', '1');
      } catch {
        /* ignore */
      }
      navigate('/');
    } catch (err) {
      setError(loginErrorMessage(err));
      if (!err.response) setApiDown(true);
    } finally {
      setLoading(false);
    }
  };

  const showcase = customSlides.length > 0
    ? customSlides.slice(0, 3).map((src, i) => ({ key: src, photo: src, i }))
    : [
      { key: 'robe', category: 'robe wax', name: 'Robe wax', tone: 'terracotta', i: 0 },
      { key: 'jean', category: 'jean', name: 'Jean slim', tone: 'denim', i: 1 },
      { key: 'basket', category: 'basket', name: 'Baskets', tone: 'sable', i: 2 },
    ];
  const marquee = 'Jeans · Robes · Chemises · T-shirts · Baskets · Sandales · Mocassins · Sacs · Ceintures · Casquettes · Foulards · ';

  return (
    <div className="login-page">
      <div className="login-page__marquee" aria-hidden="true">
        <span>{marquee}{marquee}</span>
      </div>

      <section className="login-vitrine" aria-label={BRAND_APP_NAME}>
        <div className="login-vitrine__brand">
          <img src={BRAND_LOGO} alt="" className="login-vitrine__logo" />
          <strong>{store?.store_name || BRAND_NAME}</strong>
        </div>
        <h1 className="login-vitrine__title">Le style,<br /><span>bien géré.</span></h1>
        <p className="login-vitrine__lead">
          Vêtements, chaussures et accessoires. Vos ventes, votre stock et vos clients au même endroit.
        </p>
        {BRAND_PHONE ? (
        <a href={`tel:${BRAND_PHONE_TEL}`} className="login-vitrine__phone">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" />
            </svg>
            {BRAND_PHONE}
          </a>
        ) : null}

        <div className="login-vitrine__stage" aria-hidden="true">
          {showcase.map((item) => (
            <div key={item.key} className={`login-vitrine__piece login-vitrine__piece--${item.i}${item.i === slideIndex % showcase.length ? ' is-active' : ''}`}>
              <Etoffe category={item.category} name={item.name} photo={item.photo} tone={item.tone} />
            </div>
          ))}
          <div className="login-vitrine__tag login-vitrine__tag--a">
            <span>NOUVEAUTÉ</span>
            <strong>Collection de la saison</strong>
          </div>
          <div className="login-vitrine__tag login-vitrine__tag--b">
            <i />
            <span>Caisse, stock et dettes clients</span>
          </div>
        </div>
      </section>

      <main className="login-form-side">
        <form className="login-form-card" onSubmit={handleSubmit}>
          <div className="login-form-card__header">
            <span className="login-form-card__eyebrow">Espace boutique</span>
            <h2>Bon retour.</h2>
            <p className="login-form-card__sub">Connectez-vous à votre compte {BRAND_APP_NAME}</p>
          </div>

          {(healthChecking || apiDown) && (
            <div className={`login-status${healthChecking ? '' : ' login-status--down'}`} role="status">
              <span className="login-status__dot" aria-hidden />
              {healthChecking
                ? 'Vérification du serveur…'
                : (healthMsg || 'Serveur ou base de données indisponible')}
            </div>
          )}

          {error && <div className="alert alert-error login-alert" role="alert">{error}</div>}

          <div className="login-field">
            <label htmlFor="login-username">Identifiant</label>
            <div className="login-field__wrap">
              <input
                id="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
                placeholder="nom.utilisateur"
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Mot de passe</label>
            <div className="login-field__wrap login-field__wrap--password">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Votre mot de passe"
              />
              <button
                type="button"
                className="login-field__toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            <a href={`mailto:${store?.email || 'contact@bestoshop.app'}?subject=Mot de passe oublié`} className="login-form-card__forgot">
              Mot de passe oublié ?
            </a>
          </div>

          <button type="submit" className="login-submit" disabled={loading}>
            {loading && <span className="login-submit__spinner" aria-hidden />}
            {loading ? 'Connexion…' : 'Ouvrir la boutique'}
            {!loading && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            )}
          </button>

          <p className="login-form-card__contact">
            Pas encore de compte ?{' '}
            {BRAND_PHONE ? (
              <>
                <a href={`tel:${BRAND_PHONE_TEL}`}>Appelez le {BRAND_PHONE}</a>
                {' · '}
              </>
            ) : null}
            <a href={`mailto:${store?.email || 'contact@bestoshop.app'}?subject=Demande d'accès BESTO SHOP`}>
              Nous contacter
            </a>
          </p>
        </form>
      </main>
    </div>
  );
}
