import { useEffect, useState, useMemo, useCallback } from 'react';
import api from '../../api/client';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { formatQty, parseNumberInput } from '../../utils/format';
import { useNotify } from '../../hooks/useNotify';
import { extractApiItems } from '../../utils/calculations';
import {
  canAccessAllPvs,
  isPvScoped,
  isZoneManager,
  pvDisplayLabel,
  stockQueryParams,
} from '../../utils/pvScope';

export default function InventairePhysique() {
  const { user } = useAuth();
  const pvLocked = isPvScoped(user);
  const canPickPv = canAccessAllPvs(user) || isZoneManager(user);
  const [deliveryPoints, setDeliveryPoints] = useState([]);
  const [selectedPvId, setSelectedPvId] = useState('');
  const [products, setProducts] = useState([]);
  const [counts, setCounts] = useState({});
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const notify = useNotify();
  const confirm = useConfirm();

  const availablePoints = useMemo(() => {
    if (isZoneManager(user)) {
      const allowed = (user.allowed_delivery_point_ids || []).map(String);
      return deliveryPoints.filter((dp) => allowed.includes(String(dp.id)));
    }
    return deliveryPoints;
  }, [deliveryPoints, user]);

  const pvParams = useMemo(() => stockQueryParams(user, selectedPvId), [user, selectedPvId]);

  const pvLabel = useMemo(() => {
    if (pvLocked) return pvDisplayLabel(user);
    const dp = availablePoints.find((p) => String(p.id) === String(selectedPvId));
    return dp ? `${dp.code} — ${dp.name}` : '';
  }, [pvLocked, user, availablePoints, selectedPvId]);

  useEffect(() => {
    if (!canPickPv) return;
    api.get('/delivery-points')
      .then((r) => {
        const points = r.data || [];
        setDeliveryPoints(points);
        if (user?.delivery_point_id) {
          setSelectedPvId(String(user.delivery_point_id));
        } else if (isZoneManager(user) && user.allowed_delivery_point_ids?.length) {
          setSelectedPvId(String(user.allowed_delivery_point_ids[0]));
        } else if (points[0]?.id) {
          setSelectedPvId(String(points[0].id));
        }
      })
      .catch(() => {});
  }, [canPickPv, user?.delivery_point_id, user?.allowed_delivery_point_ids]);

  const loadProducts = useCallback(() => {
    if (!pvParams.delivery_point_id) {
      setProducts([]);
      setCounts({});
      return Promise.resolve();
    }
    setLoading(true);
    return api.get('/products', { params: pvParams })
      .then((r) => {
        const items = extractApiItems(r.data);
        setProducts(items);
        const init = {};
        items.forEach((p) => {
          init[p.id] = p.total_stock != null && p.total_stock !== '' ? formatQty(p.total_stock) : '';
        });
        setCounts(init);
      })
      .catch((err) => notify.apiError(err, 'Impossible de charger les produits'))
      .finally(() => setLoading(false));
  }, [pvParams, notify]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const totals = useMemo(() => ({
    count: products.length,
    stock: products.reduce((s, p) => s + (parseFloat(p.total_stock) || 0), 0),
    ecart: products.reduce((s, p) => {
      const sys = parseFloat(p.total_stock) || 0;
      const counted = parseNumberInput(counts[p.id]);
      return s + (counted - sys);
    }, 0),
  }), [products, counts]);

  const save = async () => {
    if (!pvParams.delivery_point_id) {
      notify.error('Sélectionnez un point de vente pour valider l\'inventaire');
      return;
    }
    const ok = await confirm({
      title: 'Valider l\'inventaire',
      message: `Appliquer les quantités comptées pour ${products.length} produit(s) au point de vente « ${pvLabel} » ? Les écarts seront ajustés sur le stock de ce PV.`,
      confirmLabel: 'Valider l\'inventaire',
    });
    if (!ok) return;
    const items = products.map((p) => ({
      product_id: p.id,
      counted_quantity: parseNumberInput(counts[p.id]),
    }));
    try {
      const { data } = await api.post('/products/inventory/count', {
        items,
        notes: `Inventaire physique — ${pvLabel}`,
        delivery_point_id: pvParams.delivery_point_id,
      });
      setMsg(data.message);
      await loadProducts();
    } catch (e) {
      setMsg(e.response?.data?.message || 'Erreur');
    }
  };

  return (
    <div className="card table-main">
      <div className="table-main-toolbar">
        <h3>Inventaire physique</h3>
        <div className="toolbar-actions">
          {canPickPv && availablePoints.length > 1 ? (
            <select
              className="filter-select"
              value={selectedPvId}
              onChange={(e) => setSelectedPvId(e.target.value)}
              title="Point de vente"
            >
              {availablePoints.map((dp) => (
                <option key={dp.id} value={dp.id}>{dp.code} — {dp.name}</option>
              ))}
            </select>
          ) : pvLabel ? (
            <span className="filter-hint">{pvLabel}</span>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadProducts}
            disabled={loading || !pvParams.delivery_point_id}
          >
            {loading ? 'Chargement…' : 'Actualiser'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
            disabled={!pvParams.delivery_point_id || products.length === 0}
          >
            Valider l&apos;inventaire
          </button>
        </div>
      </div>
      <p className="table-main-toolbar__hint">
        {pvParams.delivery_point_id
          ? `Comptage pour le point de vente « ${pvLabel} ». Saisissez la quantité réelle : seuls les écarts sur ce PV seront ajustés.`
          : 'Sélectionnez un point de vente pour commencer l\'inventaire.'}
      </p>
      {msg && <div className="alert alert-success">{msg}</div>}
      <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full">
          <thead>
            <tr>
              <th>Réf.</th>
              <th>Produit</th>
              <th className="col-num">Stock système</th>
              <th className="col-num">Quantité comptée</th>
              <th className="col-num">Écart</th>
            </tr>
          </thead>
          <tbody>
            {!pvParams.delivery_point_id ? (
              <tr><td colSpan={5} className="table-empty">Choisissez un point de vente</td></tr>
            ) : loading ? (
              <tr><td colSpan={5} className="table-empty">Chargement…</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={5} className="table-empty">Aucun produit pour ce point de vente</td></tr>
            ) : products.map((p) => {
              const sys = parseFloat(p.total_stock) || 0;
              const counted = parseNumberInput(counts[p.id]);
              const ecart = counted - sys;
              return (
                <tr key={p.id}>
                  <td>{p.reference}</td>
                  <td>{p.name}</td>
                  <td className="col-num">{formatQty(sys)}</td>
                  <td className="col-num">
                    <input
                      type="text"
                      inputMode="decimal"
                      style={{ width: 100, textAlign: 'right' }}
                      value={counts[p.id] ?? ''}
                      onChange={(e) => setCounts({ ...counts, [p.id]: e.target.value })}
                    />
                  </td>
                  <td className="col-num" style={{ color: ecart !== 0 ? 'var(--danger)' : 'inherit' }}>{formatQty(ecart)}</td>
                </tr>
              );
            })}
          </tbody>
          {products.length > 0 && (
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td colSpan={2}><strong>Total ({totals.count} produit{totals.count > 1 ? 's' : ''})</strong></td>
                <td className="col-num"><strong>{formatQty(totals.stock)}</strong></td>
                <td />
                <td className="col-num"><strong style={{ color: totals.ecart !== 0 ? 'var(--danger)' : 'inherit' }}>{formatQty(totals.ecart)}</strong></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
