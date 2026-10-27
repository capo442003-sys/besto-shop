import { useMemo } from 'react';
import { usePvFilter } from '../context/PvFilterContext';
import { useAuth } from '../context/AuthContext';
import { canAccessAllPvs, isPvScoped, isZoneManager, pvDisplayLabel } from '../utils/pvScope';

/** Sélecteur PV pour encaissement / reçus — toujours visible quand pertinent. */
export default function EncaissementPvSelect({ id = 'encaissement-pv-select' }) {
  const { user } = useAuth();
  const { canFilter, deliveryPoints, selectedPvId, setPvFilter } = usePvFilter();

  const visiblePoints = useMemo(() => {
    if (isZoneManager(user)) {
      const allowed = new Set((user.allowed_delivery_point_ids || []).map(String));
      return deliveryPoints.filter((dp) => allowed.has(String(dp.id)));
    }
    return deliveryPoints;
  }, [deliveryPoints, user]);

  if (isPvScoped(user) && !canFilter) {
    const label = pvDisplayLabel(user);
    if (!label) return null;
    return (
      <div className="bmb-filters-panel__item reglement-pv-field">
        <label>Point de vente</label>
        <p className="reglement-pv-field__value">{label}</p>
      </div>
    );
  }

  if (!canFilter || !visiblePoints.length) return null;

  return (
    <div className="bmb-filters-panel__item reglement-pv-field">
      <label htmlFor={id}>Point de vente</label>
      <select
        id={id}
        className="filter-select reglement-pv-field__select"
        value={selectedPvId}
        onChange={(e) => setPvFilter(e.target.value)}
      >
        {canAccessAllPvs(user) ? (
          <option value="">Tous les points de vente</option>
        ) : null}
        {visiblePoints.map((dp) => (
          <option key={dp.id} value={dp.id}>{dp.code} — {dp.name}</option>
        ))}
      </select>
      <p className="reglement-pv-field__hint">
        {selectedPvId
          ? 'Seuls les clients et encaissements de ce PV sont affichés.'
          : 'Choisissez un PV pour limiter l\'encaissement à un magasin.'}
      </p>
    </div>
  );
}
