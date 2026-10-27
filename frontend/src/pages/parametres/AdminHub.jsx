import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useStoreSettings } from '../../context/StoreSettingsContext';
import { formatStorePhones } from '../../utils/storeFormat';

export default function AdminHub() {
  const { userRoles } = useAuth();
  const { store } = useStoreSettings();
  const isAdmin = userRoles().includes('administrateur');
  const [stats, setStats] = useState({ users: 0, points: 0 });

  useEffect(() => {
    if (!isAdmin) return;
    Promise.all([
      api.get('/settings/users').then((r) => r.data?.length || 0).catch(() => 0),
      api.get('/settings/delivery-points').then((r) => (r.data || []).filter((p) => p.is_active).length).catch(() => 0),
    ]).then(([users, points]) => setStats({ users, points }));
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="bmb-hub">
        <p className="table-empty-block">Accès réservé aux administrateurs.</p>
      </div>
    );
  }

  const phones = formatStorePhones(store);

  return (
    <div className="bmb-admin-hub">
      <header className="bmb-admin-hub__header">
        <h1>Paramètres administrateur</h1>
        <p className="bmb-admin-hub__crumb">Accueil › Paramètres administrateur</p>
      </header>

      <section className="bmb-admin-section">
        <h2 className="bmb-admin-section__title">Configuration</h2>
        <div className="bmb-admin-cards bmb-admin-cards--3">
          <div className="bmb-admin-card">
            <div className="bmb-admin-card__head">
              <h3>Magasin</h3>
            </div>
            <p><strong>{store.store_name || 'BESTO SHOP'}</strong></p>
            {store.address && <p className="bmb-admin-card__muted">{store.address}</p>}
            {phones && <p className="bmb-admin-card__muted">{phones}</p>}
            <Link to="/admin/magasin" className="btn btn-primary bmb-admin-card__btn">Configurer</Link>
          </div>
          <div className="bmb-admin-card">
            <div className="bmb-admin-card__head">
              <h3>Points de vente</h3>
            </div>
            <p><strong>{stats.points}</strong> point(s) de vente actif(s)</p>
            <Link to="/admin/points-vente" className="btn btn-primary bmb-admin-card__btn">Gérer les points de vente</Link>
          </div>
          <div className="bmb-admin-card">
            <div className="bmb-admin-card__head">
              <h3>Utilisateurs</h3>
            </div>
            <p><strong>{stats.users}</strong> utilisateur(s) enregistré(s)</p>
            <Link to="/admin/utilisateurs" className="btn btn-primary bmb-admin-card__btn">Gérer les utilisateurs</Link>
          </div>
        </div>
      </section>

      <section className="bmb-admin-section bmb-admin-section--maint">
        <h2 className="bmb-admin-section__title">Maintenance</h2>
        <div className="bmb-admin-cards bmb-admin-cards--5">
          <div className="bmb-admin-card bmb-admin-card--sm">
            <h3>Import Excel</h3>
            <Link to="/admin/import" className="btn btn-secondary btn-sm">Importer</Link>
          </div>
          <div className="bmb-admin-card bmb-admin-card--sm">
            <h3>Sauvegardes</h3>
            <Link to="/admin/magasin#sauvegardes" className="btn btn-secondary btn-sm">Sauvegarder</Link>
          </div>
          <div className="bmb-admin-card bmb-admin-card--sm bmb-admin-card--danger">
            <h3>Réinitialiser données</h3>
            <p className="bmb-admin-card__muted">Remettre à zéro le système</p>
            <Link to="/admin/magasin#reset" className="btn btn-danger btn-sm">Réinitialiser</Link>
          </div>
          <div className="bmb-admin-card bmb-admin-card--sm">
            <h3>Journal audit</h3>
            <Link to="/admin/audit" className="btn btn-secondary btn-sm">Consulter</Link>
          </div>
          <div className="bmb-admin-card bmb-admin-card--sm">
            <h3>État système</h3>
            <Link to="/admin/systeme" className="btn btn-secondary btn-sm">Vérifier</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
