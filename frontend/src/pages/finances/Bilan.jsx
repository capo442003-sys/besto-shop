import { useEffect, useState } from 'react';
import api from '../../api/client';
import { formatGNF } from '../../utils/format';
import { useNotify } from '../../hooks/useNotify';
import { useAuth } from '../../context/AuthContext';
import { stockQueryParams } from '../../utils/pvScope';

export default function Bilan() {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ date_from: '', date_to: '' });
  const [data, setData] = useState(null);
  const notify = useNotify();

  const load = () => api.get('/finances/bilan', { params: { ...filters, ...stockQueryParams(user) } })
    .then((r) => setData(r.data))
    .catch((err) => notify.apiError(err, 'Impossible de charger le bilan'));
  useEffect(() => { load(); }, []);

  return (
    <div className="card table-main">
      <div className="table-main-toolbar">
        <h3>Bilan / Compte de résultats</h3>
      </div>
      <div className="bmb-filters-panel">
        <div className="bmb-filters-panel__item">
          <label>Date début</label>
          <input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
        </div>
        <div className="bmb-filters-panel__item">
          <label>Date fin</label>
          <input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
        </div>
        <div className="bmb-filters-panel__item" style={{ alignSelf: 'end' }}>
          <button type="button" className="btn btn-primary" onClick={load}>Calculer</button>
        </div>
      </div>
      {data && (
        <>
          <p className="dash-chart-sub" style={{ marginBottom: '1rem' }}>
            Les montants « total des ventes » correspondent à la somme des paniers de vente <strong>finalisés</strong> sur la période.
          </p>
        <div className="stat-grid">
          <div className="stat-card" title="Somme des ventes finalisées sur la période choisie">
            <div className="label">Total des ventes</div>
            <div className="value">{formatGNF(data.chiffre_affaires)}</div>
            <small>Montant facturé (paniers validés)</small>
          </div>
          <div className="stat-card"><div className="label">Coûts achats (estimés)</div><div className="value">{formatGNF(data.couts_achats_estimes)}</div><small>Estimation à 65 % du total ventes</small></div>
          <div className="stat-card"><div className="label">Dépenses</div><div className="value">{formatGNF(data.depenses)}</div><small>Charges + sorties caisse</small></div>
          <div className="stat-card"><div className="label">Bénéfice estimé</div><div className="value">{formatGNF(data.benefice)}</div><small>Ventes − achats − dépenses</small></div>
        </div>
        </>
      )}
    </div>
  );
}
