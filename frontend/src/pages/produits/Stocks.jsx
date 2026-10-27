import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { formatQty, formatGNF, parseNumberInput } from '../../utils/format';
import EmptyState from '../../components/ui/EmptyState';
import TableSkeleton from '../../components/ui/TableSkeleton';
import DataCard from '../../components/ui/DataCard';
import ResponsiveDataView from '../../components/ui/ResponsiveDataView';
import PrintReport from '../../components/PrintReport';
import PrintPreviewModal from '../../components/PrintPreviewModal';
import { downloadReportPdf } from '../../utils/printReportPdf';
import { suggestPrintOrientation } from '../../utils/printOrientation';
import { useStoreSettings } from '../../context/StoreSettingsContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { extractApiItems } from '../../utils/calculations';
import { canAccessAllPvs, isPvScoped, pvDisplayLabel, stockQueryParams } from '../../utils/pvScope';

const emptyRestock = { product_id: '', quantity_add: '', purchase_unit_price: '', notes: '' };

const STOCK_COLUMNS = [
  { key: 'reference', label: 'Réf.' },
  { key: 'name', label: 'Produit' },
  { key: 'category', label: 'Catégorie' },
  { key: 'total_stock', label: 'Stock total', align: 'right' },
  { key: 'min_stock', label: 'Seuil min', align: 'right' },
  { key: 'state', label: 'État' },
];

const HISTORY_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'product', label: 'Produit' },
  { key: 'pv', label: 'PV' },
  { key: 'type', label: 'Type' },
  { key: 'purchase_price', label: 'Prix achat', align: 'right' },
  { key: 'quantity', label: 'Variation', align: 'right' },
  { key: 'before', label: 'Avant', align: 'right' },
  { key: 'after', label: 'Après', align: 'right' },
];

const RESTOCK_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'product', label: 'Produit' },
  { key: 'pv', label: 'PV' },
  { key: 'quantity', label: 'Quantité', align: 'right' },
  { key: 'unit_price', label: 'Prix unitaire', align: 'right' },
  { key: 'total_value', label: 'Valeur totale', align: 'right' },
  { key: 'note', label: 'Fournisseur / Note' },
];

function stockState(p) {
  const stock = parseFloat(p.total_stock) || 0;
  const min = parseFloat(p.min_stock) || 0;
  if (stock <= 0) return 'Épuisé';
  if (stock <= min) return 'Alerte';
  return 'OK';
}

const FILTER_LABELS = { '': 'Tous', alerte: 'Alertes seuil', epuise: 'Épuisés' };

function stockRowFlags(p) {
  const stock = parseFloat(p.total_stock) || 0;
  const min = parseFloat(p.min_stock) || 0;
  const epuise = stock <= 0;
  const alerte = !epuise && stock <= min;
  return { stock, min, epuise, alerte };
}

function stockStateBadge(epuise, alerte) {
  if (epuise) return <span className="badge badge-en-cours">Épuisé</span>;
  if (alerte) return <span className="badge badge-en-cours">Alerte</span>;
  return <span className="badge badge-finalise">OK</span>;
}

export default function Stocks() {
  const { store } = useStoreSettings();
  const { user } = useAuth();
  const confirm = useConfirm();
  const pvLocked = isPvScoped(user);
  const canPickPv = canAccessAllPvs(user);
  const [deliveryPoints, setDeliveryPoints] = useState([]);
  const [selectedPvId, setSelectedPvId] = useState('');
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const [overview, setOverview] = useState([]);
  const [history, setHistory] = useState([]);
  const [restockHistory, setRestockHistory] = useState([]);
  const [products, setProducts] = useState([]);
  const [view, setView] = useState('global');
  const [showRestock, setShowRestock] = useState(false);
  const [restock, setRestock] = useState(emptyRestock);
  const [msg, setMsg] = useState('');
  const printRef = useRef();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [orientation, setOrientation] = useState('portrait');
  const [loading, setLoading] = useState(true);

  const pvParams = useMemo(() => stockQueryParams(user, selectedPvId), [user, selectedPvId]);
  const pvLabel = pvLocked ? pvDisplayLabel(user) : (
    deliveryPoints.find((dp) => String(dp.id) === String(selectedPvId))?.code || 'Tous les PV'
  );

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      api.get('/products/stock/overview', { params: { filter: filter || undefined, ...pvParams } })
        .then((r) => setOverview(r.data)),
      api.get('/products/stock/history', { params: { limit: 50, ...pvParams } })
        .then((r) => setHistory(r.data)),
      api.get('/products/stock/history', { params: { limit: 200, movement_type: 'ravitaillement,entree', ...pvParams } })
        .then((r) => setRestockHistory(r.data)),
    ]).finally(() => setLoading(false));
  }, [filter, pvParams]);

  useEffect(() => {
    api.get('/delivery-points').then((r) => {
      const points = r.data || [];
      setDeliveryPoints(points);
      if (user?.delivery_point_id) {
        setSelectedPvId(String(user.delivery_point_id));
      } else if (points[0]?.id) {
        setSelectedPvId(String(points[0].id));
      }
    }).catch(() => {});
  }, [user?.delivery_point_id]);

  useEffect(() => {
    load();
    api.get('/products', { params: pvParams }).then((r) => setProducts(extractApiItems(r.data)));
  }, [load, pvParams]);

  useEffect(() => {
    const restockId = searchParams.get('restock');
    if (restockId) openRestock(restockId);
  }, [searchParams]);

  const closeRestock = () => {
    setShowRestock(false);
    setRestock(emptyRestock);
  };

  const openRestock = (productId = '') => {
    const product = productId ? products.find((p) => String(p.id) === String(productId)) : null;
    setRestock({
      product_id: productId ? String(productId) : '',
      quantity_add: '',
      purchase_unit_price: product?.purchase_price != null ? String(product.purchase_price) : '',
      notes: '',
    });
    setShowRestock(true);
  };

  const selectedProduct = useMemo(
    () => products.find((p) => String(p.id) === String(restock.product_id)),
    [products, restock.product_id]
  );

  const previewAvgPrice = useMemo(() => {
    if (!selectedProduct) return null;
    const qtyBefore = parseFloat(selectedProduct.total_stock) || 0;
    const addQty = parseNumberInput(restock.quantity_add);
    const oldPrice = parseFloat(selectedProduct.purchase_price) || 0;
    const incoming = parseNumberInput(restock.purchase_unit_price);
    if (addQty <= 0 || incoming < 0) return null;
    if (qtyBefore <= 0 || oldPrice <= 0) return incoming;
    if (incoming <= 0) return oldPrice;
    return (qtyBefore * oldPrice + addQty * incoming) / (qtyBefore + addQty);
  }, [selectedProduct, restock.quantity_add, restock.purchase_unit_price]);

  const submitRestock = async () => {
    if (!restock.product_id) {
      setMsg('Sélectionnez un produit');
      return;
    }
    const qty = parseNumberInput(restock.quantity_add);
    if (qty <= 0) {
      setMsg('Quantité à ajouter (> 0) requise');
      return;
    }
    const product = products.find((p) => String(p.id) === String(restock.product_id));
    const unitPrice = parseNumberInput(restock.purchase_unit_price);
    const priceLabel = unitPrice > 0 ? formatGNF(unitPrice) : 'prix actuel';
    const ok = await confirm({
      title: 'Confirmer le ravitaillement',
      message: product
        ? `Ajouter ${formatQty(qty)} au stock de « ${product.name} » à ${priceLabel} ?`
        : `Ajouter ${formatQty(qty)} au stock du produit sélectionné ?`,
      confirmLabel: 'Ravitaillement',
    });
    if (!ok) return;
    try {
      const { data } = await api.post(`/products/${restock.product_id}/stock-restock`, {
        quantity_add: qty,
        purchase_unit_price: restock.purchase_unit_price !== '' ? unitPrice : undefined,
        notes: restock.notes || 'Ravitaillement',
        delivery_point_id: pvParams.delivery_point_id || selectedPvId || undefined,
      });
      setMsg(data.message || `Ravitaillement : +${formatQty(qty)} au stock global`);
      closeRestock();
      load();
      api.get('/products').then((r) => setProducts(extractApiItems(r.data)));
    } catch (e) {
      setMsg(e.response?.data?.message || 'Erreur ravitaillement');
    }
  };

  const movementLabel = (type) => {
    const labels = {
      entree: 'Entrée',
      ravitaillement: 'Ravitaillement',
      vente: 'Vente',
      ajustement: 'Ajustement',
    };
    return labels[type] || type;
  };

  const overviewTotals = useMemo(() => ({
    count: overview.length,
    stock: overview.reduce((s, p) => s + (parseFloat(p.total_stock) || 0), 0),
  }), [overview]);

  const stockReportFilters = useMemo(() => [
    { label: 'Filtre', value: FILTER_LABELS[filter] || filter },
  ], [filter]);

  const stockReportRows = useMemo(() => overview.map((p) => ({
    id: p.id,
    reference: p.reference,
    name: p.name,
    category: p.category_name || '—',
    total_stock: formatQty(p.total_stock),
    min_stock: formatQty(p.min_stock),
    state: stockState(p),
  })), [overview]);

  const stockReportFoot = useMemo(() => (
    overview.length
      ? [{
        cells: [
          { value: `Total (${overviewTotals.count} produit${overviewTotals.count > 1 ? 's' : ''})`, colSpan: 3 },
          { value: formatQty(overviewTotals.stock), align: 'right' },
          { value: '', colSpan: 2 },
        ],
      }]
      : []
  ), [overview.length, overviewTotals]);

  const historyReportRows = useMemo(() => history.map((h) => ({
    id: h.id,
    date: new Date(h.created_at).toLocaleString('fr-FR'),
    product: h.product_name,
    pv: h.pv_code || '—',
    type: movementLabel(h.movement_type),
    purchase_price: h.purchase_unit_price != null ? formatGNF(h.purchase_unit_price) : '—',
    quantity: formatQty(h.quantity),
    before: formatQty(h.quantity_before),
    after: formatQty(h.quantity_after),
  })), [history]);

  const historyReportFoot = useMemo(() => (
    history.length
      ? [{ cells: [{ value: `Total (${history.length} mouvement${history.length > 1 ? 's' : ''})`, colSpan: 8 }] }]
      : []
  ), [history.length]);

  const restockLineValue = (h) => {
    const qty = Math.abs(parseFloat(h.quantity) || 0);
    const price = h.purchase_unit_price != null ? parseFloat(h.purchase_unit_price) : null;
    return price != null ? qty * price : null;
  };

  const restockTotals = useMemo(() => restockHistory.reduce((acc, h) => {
    acc.qty += Math.abs(parseFloat(h.quantity) || 0);
    const value = restockLineValue(h);
    if (value != null) acc.value += value;
    return acc;
  }, { qty: 0, value: 0 }), [restockHistory]);

  const restockReportRows = useMemo(() => restockHistory.map((h) => {
    const value = restockLineValue(h);
    return {
      id: h.id,
      date: new Date(h.created_at).toLocaleString('fr-FR'),
      product: h.product_name,
      pv: h.pv_code || '—',
      quantity: formatQty(Math.abs(parseFloat(h.quantity) || 0)),
      unit_price: h.purchase_unit_price != null ? formatGNF(h.purchase_unit_price) : '—',
      total_value: value != null ? formatGNF(value) : '—',
      note: h.notes || '—',
    };
  }), [restockHistory]);

  const restockReportFoot = useMemo(() => (
    restockHistory.length
      ? [{
        cells: [
          { value: `Total (${restockHistory.length} ravitaillement${restockHistory.length > 1 ? 's' : ''})`, colSpan: 3 },
          { value: formatQty(restockTotals.qty), align: 'right' },
          { value: '' },
          { value: formatGNF(restockTotals.value), align: 'right' },
          { value: '' },
        ],
      }]
      : []
  ), [restockHistory.length, restockTotals]);

  const REPORT_META = {
    history: { title: 'Historique des mouvements de stock', subtitle: '50 derniers mouvements', columns: HISTORY_COLUMNS },
    ravitaillements: { title: 'Historique des ravitaillements', subtitle: 'Entrées de stock (quantité, prix, date)', columns: RESTOCK_COLUMNS },
    global: { title: 'Situation des stocks', subtitle: 'Stock global par produit', columns: STOCK_COLUMNS },
  };
  const activeMeta = REPORT_META[view] || REPORT_META.global;
  const reportTitle = activeMeta.title;
  const reportSubtitle = activeMeta.subtitle;
  const reportColumns = activeMeta.columns;
  const reportRows = view === 'history'
    ? historyReportRows
    : view === 'ravitaillements'
      ? restockReportRows
      : stockReportRows;
  const reportFoot = view === 'history'
    ? historyReportFoot
    : view === 'ravitaillements'
      ? restockReportFoot
      : stockReportFoot;
  const reportFilters = view === 'global' ? stockReportFilters : [];
  const canPrint = view === 'global' || view === 'history' || view === 'ravitaillements';

  const exportPdf = useCallback(() => {
    if (view === 'history') {
      downloadReportPdf({
        store,
        title: 'Historique des mouvements de stock',
        subtitle: '50 derniers mouvements',
        head: HISTORY_COLUMNS.map((c) => c.label),
        body: historyReportRows.map((r) => HISTORY_COLUMNS.map((c) => r[c.key])),
        foot: history.length ? [[`Total (${history.length})`, '', '', '', '', '', '', '']] : [],
        rightAlignCols: [4, 5, 6, 7],
        filename: 'historique-stock.pdf',
        orientation,
      });
    } else if (view === 'ravitaillements') {
      downloadReportPdf({
        store,
        title: 'Historique des ravitaillements',
        subtitle: 'Entrées de stock (quantité, prix, date)',
        head: RESTOCK_COLUMNS.map((c) => c.label),
        body: restockReportRows.map((r) => RESTOCK_COLUMNS.map((c) => r[c.key])),
        foot: restockHistory.length
          ? [[`Total (${restockHistory.length})`, '', '', formatQty(restockTotals.qty), '', formatGNF(restockTotals.value), '']]
          : [],
        rightAlignCols: [3, 4, 5],
        filename: 'historique-ravitaillements.pdf',
        orientation,
      });
    } else {
      downloadReportPdf({
        store,
        title: 'Situation des stocks',
        subtitle: 'Stock global par produit',
        filters: stockReportFilters,
        head: STOCK_COLUMNS.map((c) => c.label),
        body: stockReportRows.map((r) => STOCK_COLUMNS.map((c) => r[c.key])),
        foot: overview.length
          ? [[`Total (${overview.length})`, '', '', formatQty(overviewTotals.stock), '', '']]
          : [],
        rightAlignCols: [3, 4],
        filename: 'situation-stocks.pdf',
        orientation,
      });
    }
  }, [view, store, stockReportFilters, stockReportRows, historyReportRows, restockReportRows, restockHistory.length, restockTotals, overview.length, overviewTotals, history.length, orientation]);

  return (
    <div className="card table-main stocks-page">
      <div className="table-main-toolbar bmb-print-skip">
        <h3>Situation des stocks</h3>
        <div className="toolbar-actions">
          {canPickPv && deliveryPoints.length > 1 ? (
            <select
              className="filter-select"
              value={selectedPvId}
              onChange={(e) => setSelectedPvId(e.target.value)}
              title="Point de vente"
            >
              {deliveryPoints.map((dp) => (
                <option key={dp.id} value={dp.id}>{dp.code} — {dp.name}</option>
              ))}
            </select>
          ) : pvLocked ? (
            <span className="filter-hint">{pvLabel}</span>
          ) : null}
          <select className="filter-select" value={view} onChange={(e) => setView(e.target.value)}>
            <option value="global">Situation globale</option>
            <option value="ravitaillements">Historique ravitaillements</option>
            <option value="history">Tous les mouvements</option>
          </select>
          {view === 'global' && (
            <select className="filter-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Tous</option>
              <option value="alerte">Alertes seuil</option>
              <option value="epuise">Épuisés</option>
            </select>
          )}
          <button type="button" className="btn btn-accent" onClick={() => openRestock()}>+ Ravitaillement</button>
          <button type="button" className="btn btn-primary" onClick={load}>Actualiser</button>
          {canPrint && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setOrientation(suggestPrintOrientation(reportColumns.length));
                  setPreviewOpen(true);
                }}
              >
                Aperçu / Imprimer
              </button>
              <button type="button" className="btn btn-secondary" onClick={exportPdf}>Exporter PDF</button>
            </>
          )}
        </div>
      </div>

      {msg && <div className={`alert bmb-print-skip ${msg.includes('Erreur') || msg.includes('requis') ? 'alert-warning' : 'alert-success'}`}>{msg}</div>}

      {showRestock && (
        <div className="inline-form-panel bmb-print-skip" style={{ marginBottom: '1rem' }}>
          <div className="inline-form-panel-header">
            <h3>Ravitaillement{pvLabel ? ` — ${pvLabel}` : ''}</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={closeRestock} title="Fermer">×</button>
          </div>
          <div className="inline-form-grid form-compact">
            <div className="form-group">
              <label>Produit</label>
              <select
                value={restock.product_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const p = products.find((x) => String(x.id) === id);
                  setRestock({
                    ...restock,
                    product_id: id,
                    purchase_unit_price: p?.purchase_price != null ? String(p.purchase_price) : '',
                  });
                }}
              >
                <option value="">— Choisir —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.reference} — {p.name} (stock : {formatQty(p.total_stock)} · prix moyen {formatGNF(p.purchase_price)})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Quantité à ajouter</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="ex. 50"
                value={restock.quantity_add}
                onChange={(e) => setRestock({ ...restock, quantity_add: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Prix d&apos;achat de cette livraison (GNF)</label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="Prix facture fournisseur"
                value={restock.purchase_unit_price}
                onChange={(e) => setRestock({ ...restock, purchase_unit_price: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Notes (optionnel)</label>
              <input value={restock.notes} onChange={(e) => setRestock({ ...restock, notes: e.target.value })} placeholder="Livraison fournisseur..." />
            </div>
          </div>
          <p style={{ fontSize: '.85rem', color: 'var(--text-muted)', marginTop: '.5rem' }}>
            Saisissez le <strong>prix payé au fournisseur</strong> pour cette livraison. Le logiciel calcule ensuite le{' '}
            <strong>prix d&apos;achat moyen</strong> : un prix « au milieu » qui tient compte de l&apos;ancien stock et du nouveau.
            {previewAvgPrice != null && selectedProduct && (
              <>
                {' '}Nouveau prix moyen estimé : <strong>{formatGNF(previewAvgPrice)}</strong>
                {' '}(actuellement {formatGNF(selectedProduct.purchase_price)}).
              </>
            )}
          </p>
          <div className="btn-group" style={{ marginTop: '1rem' }}>
            <button type="button" className="btn btn-primary" onClick={submitRestock}>Enregistrer le ravitaillement</button>
            <button type="button" className="btn btn-secondary" onClick={closeRestock}>Fermer</button>
          </div>
        </div>
      )}

      {view === 'global' && (
        loading ? (
          <TableSkeleton rows={8} columns={4} />
        ) : (
          <ResponsiveDataView
            className="stocks-data-view"
            cards={
              overview.length === 0 ? (
                <EmptyState
                  icon="📊"
                  title="Aucun produit"
                  description={filter
                    ? `Aucun produit correspondant au filtre « ${FILTER_LABELS[filter] || filter} ».`
                    : 'Aucun produit en stock pour ce point de vente.'}
                  compact
                />
              ) : overview.map((p) => {
                const { epuise, alerte } = stockRowFlags(p);
                return (
                  <DataCard
                    key={p.id}
                    title={p.name}
                    subtitle={p.reference}
                    badge={stockStateBadge(epuise, alerte)}
                    fields={[
                      { label: 'Catégorie', value: p.category_name || '—' },
                      { label: 'Stock total', value: formatQty(p.total_stock), strong: true },
                      { label: 'Seuil min', value: formatQty(p.min_stock) },
                    ]}
                    actions={(epuise || alerte) ? (
                      <button type="button" className="btn btn-accent btn-sm" onClick={() => openRestock(p.id)}>Ravitaillement</button>
                    ) : null}
                  />
                );
              })
            }
            table={(
        <div className="bmb-data-table-wrap table-scroll bmb-table-scroll-contained stocks-table-wrap bmb-print-skip">
          <table className="bmb-data-table table-full stocks-table">
            <thead><tr><th>Réf.</th><th>Produit</th><th>Catégorie</th><th className="col-num">Stock total</th><th className="col-num">Seuil min</th><th>État</th><th>Actions</th></tr></thead>
            <tbody>
              {overview.length === 0 ? (
                <tr><td colSpan={7} className="table-empty">Aucun produit en stock</td></tr>
              ) : overview.map((p) => {
                const { epuise, alerte } = stockRowFlags(p);
                return (
                  <tr key={p.id}>
                    <td>{p.reference}</td>
                    <td>{p.name}</td>
                    <td>{p.category_name}</td>
                    <td className="col-num"><strong>{formatQty(p.total_stock)}</strong></td>
                    <td className="col-num">{formatQty(p.min_stock)}</td>
                    <td>{stockStateBadge(epuise, alerte)}</td>
                    <td className="actions-cell">
                      {(epuise || alerte) && (
                        <button type="button" className="btn btn-accent btn-sm" onClick={() => openRestock(p.id)}>Ravitaillement</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {overview.length > 0 && (
              <tfoot>
                <tr className="bmb-data-table-total-row">
                  <td colSpan={3}><strong>Total ({overviewTotals.count} produit{overviewTotals.count > 1 ? 's' : ''})</strong></td>
                  <td className="col-num"><strong>{formatQty(overviewTotals.stock)}</strong></td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
            )}
          />
        )
      )}

      {view === 'history' && (
        loading ? (
          <TableSkeleton rows={6} columns={4} />
        ) : (
          <ResponsiveDataView
            className="stocks-data-view"
            cards={
              history.length === 0 ? (
                <EmptyState
                  icon="📋"
                  title="Aucun mouvement"
                  description="Les entrées, ventes et ajustements de stock apparaîtront ici."
                  compact
                />
              ) : history.map((h) => (
                <DataCard
                  key={h.id}
                  title={h.product_name}
                  subtitle={new Date(h.created_at).toLocaleString('fr-FR')}
                  fields={[
                    { label: 'PV', value: h.pv_code || '—' },
                    { label: 'Type', value: movementLabel(h.movement_type) },
                    { label: 'Variation', value: formatQty(h.quantity), strong: true },
                    { label: 'Avant → Après', value: `${formatQty(h.quantity_before)} → ${formatQty(h.quantity_after)}` },
                    ...(h.purchase_unit_price != null
                      ? [{ label: 'Prix achat', value: formatGNF(h.purchase_unit_price) }]
                      : []),
                  ]}
                />
              ))
            }
            table={(
        <div className="bmb-data-table-wrap table-scroll bmb-table-scroll-contained stocks-table-wrap bmb-print-skip">
          <table className="bmb-data-table table-full stocks-table">
            <thead><tr><th>Date</th><th>Produit</th><th>PV</th><th>Type</th><th className="col-num">Prix achat</th><th className="col-num">Variation</th><th className="col-num">Avant</th><th className="col-num">Après</th></tr></thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={8} className="table-empty">Aucun mouvement de stock</td></tr>
              ) : history.map((h) => (
                <tr key={h.id}>
                  <td>{new Date(h.created_at).toLocaleString('fr-FR')}</td>
                  <td>{h.product_name}</td>
                  <td>{h.pv_code || '—'}</td>
                  <td>{movementLabel(h.movement_type)}</td>
                  <td className="col-num">{h.purchase_unit_price != null ? formatGNF(h.purchase_unit_price) : '—'}</td>
                  <td className="col-num">{formatQty(h.quantity)}</td>
                  <td className="col-num">{formatQty(h.quantity_before)}</td>
                  <td className="col-num">{formatQty(h.quantity_after)}</td>
                </tr>
              ))}
            </tbody>
              {history.length > 0 && (
              <tfoot>
                <tr className="bmb-data-table-total-row">
                  <td colSpan={8}><strong>Total ({history.length} mouvement{history.length > 1 ? 's' : ''})</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
            )}
          />
        )
      )}

      {view === 'ravitaillements' && (
        loading ? (
          <TableSkeleton rows={6} columns={4} />
        ) : (
          <ResponsiveDataView
            className="stocks-data-view"
            cards={
              restockHistory.length === 0 ? (
                <EmptyState
                  icon="📦"
                  title="Aucun ravitaillement"
                  description="Les entrées de stock (ravitaillements) enregistrées apparaîtront ici avec la quantité, le prix et la date."
                  compact
                />
              ) : restockHistory.map((h) => {
                const value = restockLineValue(h);
                return (
                  <DataCard
                    key={h.id}
                    title={h.product_name}
                    subtitle={new Date(h.created_at).toLocaleString('fr-FR')}
                    fields={[
                      { label: 'PV', value: h.pv_code || '—' },
                      { label: 'Quantité', value: formatQty(Math.abs(parseFloat(h.quantity) || 0)), strong: true },
                      { label: 'Prix unitaire', value: h.purchase_unit_price != null ? formatGNF(h.purchase_unit_price) : '—' },
                      { label: 'Valeur totale', value: value != null ? formatGNF(value) : '—' },
                      { label: 'Fournisseur / Note', value: h.notes || '—' },
                    ]}
                  />
                );
              })
            }
            table={(
        <div className="bmb-data-table-wrap table-scroll bmb-table-scroll-contained stocks-table-wrap bmb-print-skip">
          <table className="bmb-data-table table-full stocks-table">
            <thead><tr><th>Date</th><th>Produit</th><th>PV</th><th className="col-num">Quantité</th><th className="col-num">Prix unitaire</th><th className="col-num">Valeur totale</th><th>Fournisseur / Note</th></tr></thead>
            <tbody>
              {restockHistory.length === 0 ? (
                <tr><td colSpan={7} className="table-empty">Aucun ravitaillement enregistré</td></tr>
              ) : restockHistory.map((h) => {
                const value = restockLineValue(h);
                return (
                  <tr key={h.id}>
                    <td>{new Date(h.created_at).toLocaleString('fr-FR')}</td>
                    <td>{h.product_name}</td>
                    <td>{h.pv_code || '—'}</td>
                    <td className="col-num">{formatQty(Math.abs(parseFloat(h.quantity) || 0))}</td>
                    <td className="col-num">{h.purchase_unit_price != null ? formatGNF(h.purchase_unit_price) : '—'}</td>
                    <td className="col-num">{value != null ? formatGNF(value) : '—'}</td>
                    <td>{h.notes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            {restockHistory.length > 0 && (
              <tfoot>
                <tr className="bmb-data-table-total-row">
                  <td colSpan={3}><strong>Total ({restockHistory.length} ravitaillement{restockHistory.length > 1 ? 's' : ''})</strong></td>
                  <td className="col-num"><strong>{formatQty(restockTotals.qty)}</strong></td>
                  <td />
                  <td className="col-num"><strong>{formatGNF(restockTotals.value)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
            )}
          />
        )
      )}

      {canPrint && (
        <PrintPreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title={`Aperçu — ${reportTitle}`}
          orientation={orientation}
          onOrientationChange={setOrientation}
          onExportPdf={exportPdf}
          printRef={printRef}
        >
          <PrintReport
            store={store}
            title={reportTitle}
            subtitle={reportSubtitle}
            date={new Date()}
            filters={reportFilters}
            columns={reportColumns}
            rows={reportRows}
            footRows={reportFoot}
            emptyMessage="Aucune donnée"
          />
        </PrintPreviewModal>
      )}
    </div>
  );
}
