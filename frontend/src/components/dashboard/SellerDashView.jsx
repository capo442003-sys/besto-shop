import { Link } from 'react-router-dom';
import { formatGNF } from '../../utils/format';
import { canAccessReglement } from '../../utils/sellerScope';
import LoadingInline from '../ui/LoadingInline';

function QuickLink({ to, children, primary }) {
  return (
    <Link
      to={to}
      className={`bmb-seller-dash__quick${primary ? ' bmb-seller-dash__quick--primary' : ''}`}
    >
      {children}
    </Link>
  );
}

export default function SellerDashView({
  data,
  loading,
  onRefresh,
  can,
  user,
  store,
  todayLabel,
  fromRoleHome,
}) {
  const showReglement = canAccessReglement(user);
  const evolution = data.evolution_ca_7j || [];
  const max = Math.max(...evolution.map((d) => parseFloat(d.montant || 0)), 1);
  const paniersAttente = data.paniers_en_attente || [];
  const topProducts = data.top_produits_jour || [];

  return (
    <div className="bmb-seller-dash">
      <header className="bmb-seller-dash__hero">
        <div>
          <p className="bmb-seller-dash__eyebrow">{data.seller_name || 'Mon activité'}</p>
          <h1 className="bmb-seller-dash__title">Tableau de bord</h1>
          <p className="bmb-seller-dash__date">{todayLabel}</p>
          {store?.store_name && <p className="bmb-seller-dash__store">{store.store_name}</p>}
        </div>
        <button type="button" className="bmb-dash-erp__refresh-btn" onClick={onRefresh} disabled={loading}>
          {loading ? 'Actualisation…' : 'Actualiser'}
        </button>
      </header>

      {fromRoleHome && (
        <Link to="/" className="bmb-role-home__analytics-link">← Retour à l&apos;accueil</Link>
      )}

      {data.inventory_lock && (
        <div className="bmb-seller-dash__alert" role="alert">
          Inventaire verrouillé — les ventes sont suspendues.
        </div>
      )}

      <nav className="bmb-seller-dash__quick-row" aria-label="Actions rapides">
        {can('ventes', 'create') && <QuickLink to="/ventes/vendre" primary>Ouvrir la caisse</QuickLink>}
        <QuickLink to="/ventes/inventaire">Mes ventes</QuickLink>
        {showReglement && <QuickLink to="/ventes/reglement">Encaisser</QuickLink>}
      </nav>

      <div className="bmb-seller-dash__kpis">
        <article className="bmb-seller-dash__kpi">
          <span className="bmb-seller-dash__kpi-label">Ventes du jour</span>
          <strong className="bmb-seller-dash__kpi-value">{formatGNF(data.ventes_jour?.montant)}</strong>
          <span className="bmb-seller-dash__kpi-sub">{data.ventes_jour?.paniers || 0} panier(s)</span>
        </article>
        <article className="bmb-seller-dash__kpi">
          <span className="bmb-seller-dash__kpi-label">Encaissé</span>
          <strong className="bmb-seller-dash__kpi-value">{formatGNF(data.ventes_jour?.encaisse)}</strong>
        </article>
        <article className="bmb-seller-dash__kpi bmb-seller-dash__kpi--accent">
          <span className="bmb-seller-dash__kpi-label">Reste à encaisser</span>
          <strong className="bmb-seller-dash__kpi-value">{formatGNF(data.ventes_jour?.reste)}</strong>
        </article>
      </div>

      {evolution.length > 0 && (
        <section className="bmb-seller-dash__panel" aria-label="Évolution 7 jours">
          <h2 className="bmb-seller-dash__panel-title">7 derniers jours</h2>
          <div className="bmb-seller-dash__spark">
            {evolution.map((d) => {
              const val = parseFloat(d.montant || 0);
              const h = Math.max(8, (val / max) * 100);
              return (
                <div key={d.jour} className="bmb-seller-dash__spark-col" title={formatGNF(val)}>
                  <div className="bmb-seller-dash__spark-bar" style={{ height: `${h}%` }} />
                  <span>{d.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {paniersAttente.length > 0 && showReglement && (
        <section className="bmb-seller-dash__panel">
          <div className="bmb-seller-dash__panel-head">
            <h2 className="bmb-seller-dash__panel-title">Paniers à encaisser</h2>
            <Link to="/ventes/reglement" className="bmb-seller-dash__panel-link">Tout voir</Link>
          </div>
          <ul className="bmb-seller-dash__list">
            {paniersAttente.slice(0, 5).map((p) => (
              <li key={p.id}>
                <span>{p.cart_number} · {p.client_name || 'Sans client'}</span>
                <strong>{formatGNF(p.balance_due)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {topProducts.length > 0 && (
        <section className="bmb-seller-dash__panel">
          <div className="bmb-seller-dash__panel-head">
            <h2 className="bmb-seller-dash__panel-title">Top produits aujourd&apos;hui</h2>
            <Link to="/ventes/inventaire" className="bmb-seller-dash__panel-link">Inventaire</Link>
          </div>
          <ul className="bmb-seller-dash__list">
            {topProducts.slice(0, 5).map((p) => (
              <li key={p.reference || p.name}>
                <span>{p.name}</span>
                <strong>{formatGNF(p.total)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {loading && <LoadingInline label="Mise à jour…" />}
    </div>
  );
}
