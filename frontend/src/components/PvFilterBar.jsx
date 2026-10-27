import { usePvFilter } from '../context/PvFilterContext';

/**
 * Filtre point de vente.
 * variant="panel" — dans une grille de filtres (pleine largeur, champs empilés).
 * variant="inline" — barre d'outils / topbar (horizontal compact).
 */
export default function PvFilterBar({ compact = false, variant = 'inline' }) {
  const { canFilter, deliveryPoints, selectedPvId, setPvFilter } = usePvFilter();
  if (!canFilter || deliveryPoints.length <= 1) return null;

  const selectId = 'bmb-pv-filter-select';

  if (variant === 'panel') {
    return (
      <div className="bmb-filters-panel__item bmb-pv-filter-panel">
        <label htmlFor={selectId}>Point de vente</label>
        <select
          id={selectId}
          className="filter-select filter-select--full"
          value={selectedPvId}
          onChange={(e) => setPvFilter(e.target.value)}
        >
          <option value="">Tous les points de vente</option>
          {deliveryPoints.map((dp) => (
            <option key={dp.id} value={dp.id}>{dp.code} — {dp.name}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className={`bmb-pv-filter${compact ? ' bmb-pv-filter--compact' : ''}`}>
      <label htmlFor={selectId}>Point de vente</label>
      <select
        id={selectId}
        value={selectedPvId}
        onChange={(e) => setPvFilter(e.target.value)}
      >
        <option value="">Tous les PV</option>
        {deliveryPoints.map((dp) => (
          <option key={dp.id} value={dp.id}>{dp.code} — {dp.name}</option>
        ))}
      </select>
    </div>
  );
}
