import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useStoreSettings } from '../../context/StoreSettingsContext';
import { formatGNF } from '../../utils/format';
import { canAccessReglement } from '../../utils/sellerScope';
import { stockQueryParams, pvDisplayLabel } from '../../utils/pvScope';
import '../../styles/seller-home.css';

const DEFAULT_OBJECTIVE = 5000000;
const RING_LEN = 339;

function objectiveKey(userId) {
  return `besto.seller.objective.${userId || 'me'}`;
}

function loadObjective(userId) {
  try {
    const v = parseFloat(localStorage.getItem(objectiveKey(userId)));
    return v > 0 ? v : DEFAULT_OBJECTIVE;
  } catch {
    return DEFAULT_OBJECTIVE;
  }
}

function saveObjective(userId, value) {
  try {
    localStorage.setItem(objectiveKey(userId), String(value));
  } catch {
    /* stockage indisponible : l'objectif reste pour la session */
  }
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

/** Accueil du vendeur : son activité du jour, son objectif et ses paniers en attente. */
export default function SellerHome() {
  const { user, can } = useAuth();
  const { store } = useStoreSettings();
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  const [objective, setObjective] = useState(() => loadObjective(user?.id));
  const [editingObjective, setEditingObjective] = useState(false);
  const [objectiveDraft, setObjectiveDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/dashboard', { params: stockQueryParams(user) })
      .then((r) => { if (!cancelled) setDash(r.data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    setObjective(loadObjective(user?.id));
  }, [user?.id]);

  const firstName = (dash?.seller_name || user?.full_name || 'Vendeur').split(' ')[0];
  const sold = parseFloat(dash?.ventes_jour?.montant || 0);
  const paid = parseFloat(dash?.ventes_jour?.encaisse || 0);
  const due = parseFloat(dash?.ventes_jour?.reste || 0);
  const carts = parseInt(dash?.ventes_jour?.paniers || 0, 10);
  const pct = Math.min(100, Math.round((sold / Math.max(1, objective)) * 100));
  const ringOffset = Math.round(RING_LEN * (1 - pct / 100));
  const pending = dash?.paniers_en_attente || [];
  const tops = dash?.top_produits_jour || [];
  const series = dash?.evolution_ca_7j || [];
  const maxDay = Math.max(1, ...series.map((d) => parseFloat(d.montant || 0)));
  const weekTotal = series.reduce((s, d) => s + parseFloat(d.montant || 0), 0);
  const bestDay = series.reduce((best, d) => (parseFloat(d.montant || 0) > parseFloat(best?.montant || 0) ? d : best), null);
  const showReglement = canAccessReglement(user);
  const pvLabel = pvDisplayLabel(user);

  const trend = useMemo(() => {
    if (series.length < 2) return null;
    const today = parseFloat(series[series.length - 1]?.montant || 0);
    const before = parseFloat(series[series.length - 2]?.montant || 0);
    if (before <= 0) return null;
    const p = Math.round(((today - before) / before) * 100);
    return { label: `${p >= 0 ? '+' : ''}${p} % vs hier`, up: p >= 0 };
  }, [series]);

  const todayRaw = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const todayLabel = todayRaw.charAt(0).toUpperCase() + todayRaw.slice(1);

  const submitObjective = (e) => {
    e.preventDefault();
    const v = parseFloat(String(objectiveDraft).replace(/\D/g, ''));
    if (v > 0) {
      setObjective(v);
      saveObjective(user?.id, v);
    }
    setEditingObjective(false);
  };

  return (
    <div className="seller-home">
      <div className="seller-home__top">
        <section className="seller-home__hero" aria-label="Bienvenue">
          <p className="seller-home__eyebrow">
            <span className="seller-home__date">{todayLabel}</span>
            {pvLabel ? <span> · {pvLabel}</span> : null}
            {store?.store_name ? <span> · {store.store_name}</span> : null}
          </p>
          <h1 className="seller-home__title">{greeting()} {firstName}, belle journée de vente !</h1>
          <p className="seller-home__lead">
            {pending.length > 0
              ? <>Vous avez <strong>{pending.length} panier{pending.length > 1 ? 's' : ''}</strong> en attente d&apos;encaissement.</>
              : 'Aucun panier en attente : place à la prochaine vente.'}
          </p>
          <div className="seller-home__cta-row">
            {can('ventes', 'create') && (
              <Link to="/ventes/vendre" className="seller-home__cta">
                <span className="seller-home__cta-shine" aria-hidden="true" />
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                Nouvelle vente
              </Link>
            )}
            <Link to="/ventes/inventaire" className="seller-home__cta-ghost">Voir mes ventes</Link>
          </div>
        </section>

        <section className="seller-home__goal" aria-label="Objectif du jour">
          <div className="seller-home__ring">
            <svg aria-hidden="true" width="132" height="132" viewBox="0 0 132 132">
              <circle cx="66" cy="66" r="54" fill="none" stroke="rgba(15,107,69,0.14)" strokeWidth="14" />
              <circle
                key={`${pct}-${loading}`}
                className="seller-home__ring-value"
                cx="66"
                cy="66"
                r="54"
                fill="none"
                stroke="#12804F"
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={RING_LEN}
                strokeDashoffset={ringOffset}
                transform="rotate(-90 66 66)"
              />
            </svg>
            <div className="seller-home__ring-label">
              <strong>{pct} %</strong>
              <span>de l&apos;objectif</span>
            </div>
          </div>
          <div className="seller-home__goal-text">
            <span className="seller-home__overline">Objectif du jour</span>
            <strong className="seller-home__goal-value">{formatGNF(sold)}</strong>
            {editingObjective ? (
              <form className="seller-home__goal-form" onSubmit={submitObjective}>
                <label htmlFor="seller-objective" className="seller-home__sr">Nouvel objectif (GNF)</label>
                <input
                  id="seller-objective"
                  inputMode="numeric"
                  autoFocus
                  value={objectiveDraft}
                  onChange={(e) => setObjectiveDraft(e.target.value)}
                  placeholder={String(objective)}
                />
                <button type="submit" className="btn btn-primary btn-sm">OK</button>
              </form>
            ) : (
              <span className="seller-home__goal-sub">
                <span>sur {formatGNF(objective)}</span>
                <span>encore <strong>{formatGNF(Math.max(0, objective - sold))}</strong></span>
                <button
                  type="button"
                  className="seller-home__link-btn"
                  onClick={() => { setObjectiveDraft(String(Math.round(objective))); setEditingObjective(true); }}
                >
                  Modifier
                </button>
              </span>
            )}
          </div>
        </section>
      </div>

      <section className="seller-home__kpis" aria-label="Mes chiffres du jour">
        <article className="seller-home__kpi">
          <span>Mes ventes du jour</span>
          <strong>{formatGNF(sold)}</strong>
          <small className={trend ? (trend.up ? 'is-up' : 'is-down') : ''}>{trend ? trend.label : `${carts} panier(s)`}</small>
        </article>
        <article className="seller-home__kpi">
          <span>Paniers validés</span>
          <strong>{carts}</strong>
          <small>{pending.length} en attente</small>
        </article>
        <article className="seller-home__kpi">
          <span>Encaissé</span>
          <strong>{formatGNF(paid)}</strong>
          <small>Panier moyen {formatGNF(carts ? sold / carts : 0)}</small>
        </article>
        <article className="seller-home__kpi">
          <span>Reste à encaisser</span>
          <strong className={due > 0.5 ? 'is-due' : ''}>{formatGNF(due)}</strong>
          <small>{due > 0.5 ? 'À régler en caisse' : 'Tout est encaissé'}</small>
        </article>
      </section>

      <div className="seller-home__grid">
        <section className="seller-home__panel" aria-label="Mes paniers en attente">
          <div className="seller-home__panel-head">
            <h2>Mes paniers en attente</h2>
            {pending.length > 0 && <span className="seller-home__badge">{pending.length}</span>}
          </div>
          {pending.length === 0 ? (
            <p className="seller-home__empty">Aucun panier en attente.</p>
          ) : (
            <ul className="seller-home__list">
              {pending.slice(0, 4).map((p) => (
                <li key={p.id} className="seller-home__pending">
                  <div className="seller-home__pending-top">
                    <strong>{p.cart_number}</strong>
                    <strong>{formatGNF(p.balance_due)}</strong>
                  </div>
                  <span className="seller-home__muted">{p.client_name || 'Sans client'}</span>
                  <Link
                    to={showReglement ? '/ventes/reglement' : '/ventes/vendre'}
                    className="seller-home__pending-btn"
                  >
                    {showReglement ? 'Encaisser' : 'Ouvrir la caisse'}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="seller-home__panel" aria-label="Mes 7 derniers jours">
          <div className="seller-home__panel-head">
            <h2>Mes 7 derniers jours</h2>
          </div>
          <div className="seller-home__bars">
            {series.map((d, i) => {
              const v = parseFloat(d.montant || 0);
              const last = i === series.length - 1;
              return (
                <div key={d.jour} className="seller-home__bar-col" title={`${d.label} : ${formatGNF(v)}`}>
                  <div
                    className={`seller-home__bar${last ? ' is-today' : ''}`}
                    style={{ height: `${Math.max(4, Math.round((v / maxDay) * 100))}%`, animationDelay: `${0.4 + i * 0.05}s` }}
                  />
                  <span>{(d.label || '').split(' ')[0].replace('.', '')}</span>
                </div>
              );
            })}
          </div>
          <p className="seller-home__muted">
            Total <strong>{formatGNF(weekTotal)}</strong>
            {bestDay && parseFloat(bestDay.montant) > 0 ? ` · meilleur jour : ${bestDay.label}` : ''}
          </p>
        </section>

        <section className="seller-home__panel" aria-label="Mes meilleures ventes du jour">
          <div className="seller-home__panel-head">
            <h2>Mes meilleures ventes</h2>
          </div>
          {tops.length === 0 ? (
            <p className="seller-home__empty">Vos articles vendus aujourd&apos;hui apparaîtront ici.</p>
          ) : (
            <ul className="seller-home__list">
              {tops.slice(0, 5).map((t) => (
                <li key={t.reference || t.name} className="seller-home__top-item">
                  <span className="seller-home__initials" aria-hidden="true">
                    {(t.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <span className="seller-home__top-name">{t.name}</span>
                  <strong>{formatGNF(t.total)}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {loading && <p className="seller-home__muted" role="status">Mise à jour…</p>}
    </div>
  );
}
