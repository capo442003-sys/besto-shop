import { useEffect, useState, useMemo } from 'react';
import api from '../../api/client';
import { formatGNF } from '../../utils/format';
import { useNotify } from '../../hooks/useNotify';

export default function StatsVentes() {
  const [list, setList] = useState([]);
  const [filters, setFilters] = useState({ date_from: '', date_to: '' });
  const notify = useNotify();

  const load = () => api.get('/employees/sales-stats', { params: filters })
    .then((r) => setList(r.data))
    .catch((err) => notify.apiError(err, 'Impossible de charger les statistiques'));
  useEffect(() => { load(); }, []);

  const totals = useMemo(() => ({
    paniers: list.reduce((s, e) => s + (parseInt(e.paniers_count, 10) || 0), 0),
    ventes: list.reduce((s, e) => s + (parseFloat(e.total_ventes) || 0), 0),
  }), [list]);

  return (
    <div className="card table-main">
      <div className="table-main-toolbar">
        <h3>Statistiques ventes par employé</h3>
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
          <button type="button" className="btn btn-primary" onClick={load}>Rechercher</button>
        </div>
      </div>
      <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full">
          <thead><tr><th>Vendeur</th><th>Matricule</th><th className="col-num">Paniers</th><th className="col-num">Total ventes</th></tr></thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={4} className="table-empty">Aucune statistique pour cette période</td></tr>
            ) : list.map((e) => (
              <tr key={e.id}><td>{e.name}</td><td>{e.matricule}</td><td className="col-num">{e.paniers_count}</td><td className="col-num">{formatGNF(e.total_ventes)}</td></tr>
            ))}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td colSpan={2}><strong>Total ({list.length})</strong></td>
                <td className="col-num"><strong>{totals.paniers}</strong></td>
                <td className="col-num"><strong>{formatGNF(totals.ventes)}</strong></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
