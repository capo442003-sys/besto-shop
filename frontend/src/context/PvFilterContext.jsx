import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { canAccessAllPvs, isZoneManager } from '../utils/pvScope';
import api from '../api/client';

const STORAGE_KEY = 'bmb_admin_pv_filter';
const PvFilterContext = createContext(null);

export function PvFilterProvider({ children }) {
  const { user } = useAuth();
  const canFilter = canAccessAllPvs(user) || isZoneManager(user);
  const [deliveryPoints, setDeliveryPoints] = useState([]);
  const [selectedPvId, setSelectedPvId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.sessionStorage.getItem(STORAGE_KEY) || '';
  });

  useEffect(() => {
    if (!canFilter) return;
    api.get('/delivery-points').then((r) => setDeliveryPoints(r.data || [])).catch(() => {});
  }, [canFilter]);

  useEffect(() => {
    if (!canFilter) {
      setSelectedPvId('');
      return;
    }
    if (selectedPvId) {
      window.sessionStorage.setItem(STORAGE_KEY, selectedPvId);
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  }, [selectedPvId, canFilter]);

  const setPvFilter = useCallback((id) => {
    setSelectedPvId(id ? String(id) : '');
  }, []);

  const queryParams = useMemo(() => {
    if (!canFilter || !selectedPvId) return {};
    return { delivery_point_id: selectedPvId };
  }, [canFilter, selectedPvId]);

  const selectedPv = useMemo(
    () => deliveryPoints.find((dp) => String(dp.id) === String(selectedPvId)) || null,
    [deliveryPoints, selectedPvId],
  );

  const value = useMemo(() => ({
    canFilter,
    deliveryPoints,
    selectedPvId,
    selectedPv,
    setPvFilter,
    queryParams,
  }), [canFilter, deliveryPoints, selectedPvId, selectedPv, setPvFilter, queryParams]);

  return (
    <PvFilterContext.Provider value={value}>
      {children}
    </PvFilterContext.Provider>
  );
}

export function usePvFilter() {
  return useContext(PvFilterContext) || {
    canFilter: false,
    deliveryPoints: [],
    selectedPvId: '',
    selectedPv: null,
    setPvFilter: () => {},
    queryParams: {},
  };
}
