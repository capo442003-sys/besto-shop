import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import api from '../../api/client';
import { formatGNF, formatDate, formatQty, formatGNFForPdf, cartEncaissementStatus, cartBalanceDue } from '../../utils/format';
import PrintReport from '../../components/PrintReport';
import PrintPreviewModal from '../../components/PrintPreviewModal';
import { downloadReportPdf, downloadMultiSectionReportPdf } from '../../utils/printReportPdf';
import {
  buildDailyReportView,
  buildDailyReportPdfSections,
  resolveDailyReportDate,
  resolveMonthlyReportMonth,
  formatMonthLabel,
  DAILY_SALE_COLUMNS,
  DAILY_PRODUCT_COLUMNS,
  DAILY_PAYMENT_MODE_COLUMNS,
  DAILY_ENC_COLUMNS,
  DEBTS_CREANCES_COLUMNS,
} from '../../utils/dailySalesReport';
import { suggestPrintOrientation } from '../../utils/printOrientation';
import { useStoreSettings } from '../../context/StoreSettingsContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';
import { matchesListSearch } from '../../utils/listSearch';
import { parseClientsListResponse } from '../../utils/clientsApi';
import { canAccessAllPvs, isPvScoped, pvDisplayLabel, stockQueryParams } from '../../utils/pvScope';
import EmptyState from '../../components/ui/EmptyState';
import TableSkeleton from '../../components/ui/TableSkeleton';
import ResponsiveDataView from '../../components/ui/ResponsiveDataView';
import DataCard from '../../components/ui/DataCard';

const PANIER_COLUMNS = [
  { key: 'cart_number', label: 'N° Panier' },
  { key: 'date', label: 'Date' },
  { key: 'client', label: 'Client' },
  { key: 'seller', label: 'Vendeur' },
  { key: 'type', label: 'Type' },
  { key: 'lines', label: 'Lignes', align: 'right' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'paid', label: 'Encaissé', align: 'right' },
  { key: 'reste', label: 'Reste', align: 'right' },
  { key: 'status', label: 'Statut' },
];

const PRODUIT_COLUMNS = [
  { key: 'product_name', label: 'Produit' },
  { key: 'reference', label: 'Référence' },
  { key: 'quantity', label: 'Qté vendue', align: 'right' },
  { key: 'sales_count', label: 'Nb ventes', align: 'right' },
  { key: 'line_total', label: 'Montant total', align: 'right' },
];

function localIsoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function InventaireVentes() {
  const { store } = useStoreSettings();
  const { can, user } = useAuth();
  const confirm = useConfirm();
  const notify = useNotify();
  const showPaymentCols = can('ventes', 'view');
  const canVoidSale = can('ventes', 'delete');
  const panierColumns = useMemo(
    () => PANIER_COLUMNS.filter((c) => showPaymentCols || (c.key !== 'paid' && c.key !== 'reste')),
    [showPaymentCols]
  );
  const pvLocked = isPvScoped(user);
  const canPickPv = canAccessAllPvs(user);
  const [deliveryPoints, setDeliveryPoints] = useState([]);
  const [selectedPvId, setSelectedPvId] = useState('');
  const [tab, setTab] = useState('panier');
  const [carts, setCarts] = useState([]);
  const [cartSummary, setCartSummary] = useState(null);
  const [cartsTruncated, setCartsTruncated] = useState(false);
  const [byProduct, setByProduct] = useState([]);
  const [productGrouped, setProductGrouped] = useState([]);
  const [productApiSummary, setProductApiSummary] = useState(null);
  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [products, setProducts] = useState([]);
  const [filters, setFilters] = useState({
    date_from: '',
    date_to: '',
    client_id: '',
    seller_id: '',
    product_id: '',
    status: 'finalise',
  });
  const [appliedFilters, setAppliedFilters] = useState({
    date_from: '',
    date_to: '',
    client_id: '',
    seller_id: '',
    product_id: '',
    status: 'finalise',
  });
  const [search, setSearch] = useState('');
  const printRef = useRef();
  const dailyReportRef = useRef();
  const loadSeqRef = useRef(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dailyReportOpen, setDailyReportOpen] = useState(false);
  const [dailyReportData, setDailyReportData] = useState(null);
  const [dailyReportLoading, setDailyReportLoading] = useState(false);
  const [orientation, setOrientation] = useState('landscape');
  const [loading, setLoading] = useState(true);

  const pvParams = useMemo(() => stockQueryParams(user, selectedPvId), [user, selectedPvId]);

  useEffect(() => {
    const pvFilter = pvParams.delivery_point_id
      ? { delivery_point_id: pvParams.delivery_point_id, at_pv_only: 'true' }
      : {};
    Promise.all([
      api.get('/clients', { params: pvFilter }),
      api.get('/employees', { params: pvFilter }),
      api.get('/products', { params: { ...pvFilter, limit: 500 } }),
      api.get('/delivery-points'),
    ])
      .then(([c, e, p, dp]) => {
        setClients(parseClientsListResponse(c.data).clients);
        setEmployees(Array.isArray(e.data) ? e.data : e.data?.items || []);
        setProducts(Array.isArray(p.data) ? p.data : p.data?.items || []);
        const points = dp.data || [];
        setDeliveryPoints(points);
        if (user?.delivery_point_id) {
          setSelectedPvId(String(user.delivery_point_id));
        } else if (points[0]?.id) {
          setSelectedPvId((prev) => prev || String(points[0].id));
        }
      })
      .catch((err) => notify.apiError(err, 'Impossible de charger les filtres'));
  }, [notify, user?.delivery_point_id, pvParams]);

  const buildParams = useCallback(() => {
    const pvFilter = pvParams.delivery_point_id ? { delivery_point_id: pvParams.delivery_point_id } : {};
    const entries = tab === 'panier'
      ? {
          inventaire: 'true',
          date_from: appliedFilters.date_from,
          date_to: appliedFilters.date_to,
          client_id: appliedFilters.client_id,
          seller_id: appliedFilters.seller_id,
          status: appliedFilters.status,
          ...pvFilter,
        }
      : {
          inventaire: 'true',
          date_from: appliedFilters.date_from,
          date_to: appliedFilters.date_to,
          product_id: appliedFilters.product_id,
          status: appliedFilters.status,
          seller_id: appliedFilters.seller_id,
          ...pvFilter,
        };
    return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== '' && v != null));
  }, [tab, appliedFilters, pvParams]);

  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const params = buildParams();
    setLoading(true);
    try {
      if (tab === 'panier') {
        const { data } = await api.get('/sales/carts', { params });
        if (seq !== loadSeqRef.current) return;
        if (data && Array.isArray(data.carts)) {
          setCarts(data.carts);
          setCartSummary(data.summary || null);
          setCartsTruncated(false);
        } else {
          const rows = Array.isArray(data) ? data : [];
          setCarts(rows);
          setCartSummary(null);
          setCartsTruncated(false);
        }
      } else {
        const { data } = await api.get('/sales/by-product', { params });
        if (seq !== loadSeqRef.current) return;
        if (data && Array.isArray(data.items)) {
          setByProduct(data.items);
          setProductGrouped(Array.isArray(data.grouped) ? data.grouped : []);
          setProductApiSummary(data.summary || null);
        } else {
          const rows = Array.isArray(data) ? data : [];
          setByProduct(rows);
          setProductGrouped([]);
          setProductApiSummary(null);
        }
      }
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      notify.apiError(err, tab === 'panier' ? 'Impossible de charger l\'inventaire paniers' : 'Impossible de charger l\'inventaire produits');
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [tab, buildParams, notify]);

  const applyFilters = useCallback(() => {
    setAppliedFilters({ ...filters });
  }, [filters]);

  const setTodayFilter = useCallback(() => {
    const d = localIsoDate();
    const next = { ...filters, date_from: d, date_to: d };
    setFilters(next);
    setAppliedFilters(next);
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedFilters(filters);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    load();
  }, [appliedFilters, tab, pvParams, load]);

  useEffect(() => {
    setSearch('');
  }, [tab]);

  const productSummary = useMemo(() => {
    if (productGrouped.length) {
      return productGrouped.map((r) => ({
        product_name: r.product_name,
        reference: r.reference,
        quantity: parseFloat(r.quantity) || 0,
        line_total: parseFloat(r.line_total) || 0,
        sales_count: parseInt(r.sales_count, 10) || 0,
      }));
    }
    const map = new Map();
    for (const row of byProduct) {
      const key = row.product_id || row.reference || row.product_name;
      const prev = map.get(key) || {
        product_name: row.product_name,
        reference: row.reference,
        quantity: 0,
        line_total: 0,
        cartIds: new Set(),
      };
      prev.quantity += parseFloat(row.quantity) || 0;
      prev.line_total += parseFloat(row.line_total) || 0;
      if (row.cart_id != null) prev.cartIds.add(row.cart_id);
      map.set(key, prev);
    }
    return [...map.values()]
      .map((row) => ({
        product_name: row.product_name,
        reference: row.reference,
        quantity: row.quantity,
        line_total: row.line_total,
        sales_count: row.cartIds.size,
      }))
      .sort((a, b) => b.line_total - a.line_total);
  }, [productGrouped, byProduct]);

  const filteredCarts = useMemo(
    () => carts.filter((c) => matchesListSearch(
      search,
      c.cart_number,
      c.client_name,
      c.client_code,
      c.seller_name,
    )),
    [carts, search],
  );

  const filteredProductSummary = useMemo(
    () => productSummary.filter((r) => matchesListSearch(search, r.product_name, r.reference)),
    [productSummary, search],
  );

  const computeCartTotals = useCallback((list) => {
    const total = list.reduce((s, c) => s + parseFloat(c.total_amount || 0), 0);
    const paid = list.reduce((s, c) => s + parseFloat(c.amount_paid || 0), 0);
    const due = list.reduce((s, c) => s + cartBalanceDue(c), 0);
    const lines = list.reduce((s, c) => s + (parseInt(c.line_count, 10) || 0), 0);
    return { count: list.length, lines, total, paid, due };
  }, []);

  const computeProductTotals = useCallback((list) => ({
    count: list.length,
    qty: list.reduce((s, r) => s + r.quantity, 0),
    amount: list.reduce((s, r) => s + r.line_total, 0),
  }), []);

  const cartTotals = useMemo(() => {
    if (search.trim()) return computeCartTotals(filteredCarts);
    if (cartSummary) {
      return {
        count: cartSummary.cart_count || 0,
        lines: cartSummary.line_count || 0,
        total: parseFloat(cartSummary.total_amount || 0),
        paid: parseFloat(cartSummary.amount_paid || 0),
        due: parseFloat(cartSummary.balance_due || 0),
      };
    }
    return computeCartTotals(carts);
  }, [search, filteredCarts, cartSummary, carts, computeCartTotals]);

  const productTotals = useMemo(() => {
    if (search.trim()) return computeProductTotals(filteredProductSummary);
    if (productApiSummary) {
      return {
        count: productApiSummary.product_count || 0,
        qty: parseFloat(productApiSummary.quantity || 0),
        amount: parseFloat(productApiSummary.line_total || 0),
      };
    }
    return computeProductTotals(productSummary);
  }, [search, filteredProductSummary, productApiSummary, productSummary, computeProductTotals]);

  const displayCarts = search.trim() ? filteredCarts : carts;
  const displayProductSummary = search.trim() ? filteredProductSummary : productSummary;

  const reportSummary = useMemo(() => {
    if (tab === 'panier') {
      if (!cartTotals.count) return [];
      return [
        { label: 'Paniers', value: String(cartTotals.count) },
        { label: 'Lignes', value: formatQty(cartTotals.lines) },
        { label: 'Total ventes', value: formatGNF(cartTotals.total), emphasis: true },
        ...(showPaymentCols ? [
          { label: 'Encaissé', value: formatGNF(cartTotals.paid), emphasis: true },
          { label: 'Reste à payer', value: formatGNF(cartTotals.due), emphasis: true },
        ] : []),
      ];
    }
    if (!productTotals.count) return [];
    return [
      { label: 'Produits', value: String(productTotals.count) },
      { label: 'Qté vendue', value: formatQty(productTotals.qty) },
      { label: 'Montant total', value: formatGNF(productTotals.amount), emphasis: true },
    ];
  }, [tab, cartTotals, productTotals, showPaymentCols]);

  const reportFilters = useMemo(() => {
    const clientName = clients.find((c) => String(c.id) === String(appliedFilters.client_id))?.name;
    const sellerName = employees.find((e) => String(e.id) === String(appliedFilters.seller_id))?.name;
    const productLabel = products.find((p) => String(p.id) === String(appliedFilters.product_id));
    const statusLabel = appliedFilters.status === 'finalise'
      ? 'Validées à la caisse'
      : appliedFilters.status === 'en_cours'
        ? 'En cours'
        : appliedFilters.status === 'annule'
          ? 'Annulés'
          : 'Tous (hors annulés)';
    const base = [
      { label: 'Du', value: appliedFilters.date_from },
      { label: 'Au', value: appliedFilters.date_to },
    ];
    if (tab === 'panier') {
    return [
      ...base,
      { label: 'Client', value: clientName },
      { label: 'Vendeur', value: sellerName },
      { label: 'Statut', value: statusLabel },
      ...(search.trim() ? [{ label: 'Recherche', value: search.trim() }] : []),
    ];
  }
    return [
      ...base,
      { label: 'Produit', value: productLabel ? `${productLabel.reference} — ${productLabel.name}` : '' },
      ...(search.trim() ? [{ label: 'Recherche', value: search.trim() }] : []),
    ];
  }, [tab, appliedFilters, clients, employees, products, search]);

  const panierReportRows = useMemo(() => displayCarts.map((c) => {
    const reste = cartBalanceDue(c);
    const st = cartEncaissementStatus(c);
    return {
      id: c.id,
      cart_number: c.cart_number,
      date: formatDate(c.validated_at || c.created_at),
      client: c.client_name || '—',
      seller: c.seller_name || '—',
      type: c.sale_type === 'gros' ? 'Gros' : 'Détail',
      lines: c.line_count ?? '—',
      total: formatGNF(c.total_amount),
      paid: formatGNF(c.amount_paid),
      reste: formatGNF(reste),
      status: st.label,
    };
  }), [displayCarts]);

  const produitReportRows = useMemo(() => displayProductSummary.map((r) => ({
    id: `${r.reference}-${r.product_name}`,
    product_name: r.product_name,
    reference: r.reference || '—',
    quantity: formatQty(r.quantity),
    sales_count: r.sales_count,
    line_total: formatGNF(r.line_total),
  })), [displayProductSummary]);

  const panierReportFoot = useMemo(() => (
    cartTotals.count
      ? [{
        cells: [
          { value: `Total (${cartTotals.count} panier${cartTotals.count > 1 ? 's' : ''})`, colSpan: 5 },
          { value: formatQty(cartTotals.lines), align: 'right' },
          { value: formatGNF(cartTotals.total), align: 'right' },
          ...(showPaymentCols ? [
            { value: formatGNF(cartTotals.paid), align: 'right' },
            { value: formatGNF(cartTotals.due), align: 'right' },
          ] : []),
          { value: '' },
        ],
      }]
      : []
  ), [cartTotals, showPaymentCols]);

  const produitReportFoot = useMemo(() => (
    productTotals.count
      ? [{
        cells: [
          { value: `Total (${productTotals.count} produit${productTotals.count > 1 ? 's' : ''})`, colSpan: 2 },
          { value: formatQty(productTotals.qty), align: 'right' },
          { value: '' },
          { value: formatGNF(productTotals.amount), align: 'right' },
        ],
      }]
      : []
  ), [productTotals]);

  const reportTitle = tab === 'panier' ? 'Inventaire des ventes — par panier' : 'Inventaire des ventes — par produit';
  const reportColumns = tab === 'panier' ? panierColumns : PRODUIT_COLUMNS;
  const reportRows = tab === 'panier' ? panierReportRows : produitReportRows;
  const reportFoot = tab === 'panier' ? panierReportFoot : produitReportFoot;

  const dailyReportPvLabel = useMemo(() => {
    if (pvLocked) return pvDisplayLabel(user);
    const dp = deliveryPoints.find((p) => String(p.id) === String(selectedPvId));
    return dp ? `${dp.code} — ${dp.name}` : '';
  }, [pvLocked, user, deliveryPoints, selectedPvId]);

  const dailyReportView = useMemo(
    () => buildDailyReportView(dailyReportData, { showPaymentCols, pvLabel: dailyReportPvLabel }),
    [dailyReportData, showPaymentCols, dailyReportPvLabel],
  );

  const dailySaleColumns = useMemo(
    () => DAILY_SALE_COLUMNS.filter((c) => showPaymentCols || c.key !== 'paid'),
    [showPaymentCols],
  );

  const loadDailyReport = useCallback(async (reportDate, { openPreview = false, monthly = false } = {}) => {
    setDailyReportLoading(true);
    try {
      const params = {
        status: appliedFilters.status || 'finalise',
        ...pvParams,
      };
      if (appliedFilters.seller_id) params.seller_id = appliedFilters.seller_id;
      let data;
      if (monthly) {
        const month = reportDate;
        const { data: res } = await api.get('/sales/monthly-report', { params: { ...params, month } });
        data = res;
      } else {
        const { data: res } = await api.get('/sales/daily-report', { params: { ...params, date: reportDate } });
        data = res;
      }
      setDailyReportData(data);
      if (openPreview) {
        setOrientation('portrait');
        setDailyReportOpen(true);
      }
      return data;
    } catch (err) {
      notify.apiError(err, monthly ? 'Impossible de charger le rapport mensuel' : 'Impossible de charger le rapport journalier');
      return null;
    } finally {
      setDailyReportLoading(false);
    }
  }, [appliedFilters.status, appliedFilters.seller_id, pvParams, notify]);

  const openDailyReport = useCallback(async () => {
    const { date, multiDay } = resolveDailyReportDate(appliedFilters);
    if (multiDay) {
      notify.info(`Période sur plusieurs jours — rapport généré pour le ${formatDate(date)} uniquement`);
    }
    await loadDailyReport(date, { openPreview: true });
  }, [appliedFilters, loadDailyReport, notify]);

  const openMonthlyReport = useCallback(async () => {
    const month = resolveMonthlyReportMonth(appliedFilters);
    notify.info(`Rapport mensuel : ${formatMonthLabel(month)}`);
    await loadDailyReport(month, { openPreview: true, monthly: true });
  }, [appliedFilters, loadDailyReport, notify]);

  const exportDailyPdf = useCallback(() => {
    if (!dailyReportView || !dailyReportData) return;
    downloadMultiSectionReportPdf({
      store,
      title: dailyReportView.title,
      subtitle: dailyReportView.subtitle,
      date: dailyReportData.date,
      filters: dailyReportView.filters,
      sections: buildDailyReportPdfSections(dailyReportView, dailyReportData),
      filename: dailyReportData.period === 'month'
        ? `rapport-mensuel-${dailyReportData.month || dailyReportData.date_from}.pdf`
        : `rapport-journalier-${dailyReportData.date || dailyReportData.date_from}.pdf`,
      orientation: 'portrait',
      footerNote: dailyReportData.period === 'month'
        ? 'Rapport mensuel — format A4 portrait'
        : 'Rapport journalier — format A4 portrait',
    });
  }, [store, dailyReportView, dailyReportData, orientation]);

  const exportPdf = useCallback(() => {
    if (tab === 'panier') {
      downloadReportPdf({
        store,
        title: 'Inventaire des ventes',
        subtitle: 'Vue par panier',
        filters: reportFilters,
        summary: reportSummary,
        head: panierColumns.map((c) => c.label),
        body: panierReportRows.map((r) => panierColumns.map((c) => r[c.key])),
        foot: cartTotals.count
          ? [[
            `Total (${cartTotals.count})`,
            '', '', '', '',
            formatQty(cartTotals.lines),
            formatGNFForPdf(cartTotals.total),
            ...(showPaymentCols ? [
              formatGNFForPdf(cartTotals.paid),
              formatGNFForPdf(cartTotals.due),
            ] : []),
            '',
          ]]
          : [],
        rightAlignCols: showPaymentCols ? [5, 6, 7, 8] : [5, 6],
        filename: 'inventaire-ventes-panier.pdf',
        orientation,
      });
    } else {
      downloadReportPdf({
        store,
        title: 'Inventaire des ventes',
        subtitle: 'Vue par produit',
        filters: reportFilters,
        summary: reportSummary,
        head: PRODUIT_COLUMNS.map((c) => c.label),
        body: produitReportRows.map((r) => PRODUIT_COLUMNS.map((c) => r[c.key])),
        foot: productTotals.count
          ? [[`Total (${productTotals.count})`, '', formatQty(productTotals.qty), '', formatGNFForPdf(productTotals.amount)]]
          : [],
        rightAlignCols: [2, 3, 4],
        filename: 'inventaire-ventes-produit.pdf',
        orientation,
      });
    }
  }, [tab, store, reportFilters, reportSummary, panierReportRows, produitReportRows, cartTotals, productTotals, orientation, search, panierColumns, showPaymentCols]);

  const voidSale = useCallback(async (cart) => {
    if (!canVoidSale) {
      notify.error('Vous n\'avez pas la permission de supprimer une vente validée');
      return;
    }
    const ok = await confirm({
      title: 'Supprimer la vente',
      message: `Supprimer définitivement la vente ${cart.cart_number} ? Le stock sera rétabli et les encaissements seront annulés.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.post(`/sales/carts/${cart.id}/void`);
      notify.success(`Vente ${cart.cart_number} supprimée`);
      load();
    } catch (e) {
      notify.error(apiErrorMessage(e, 'Impossible de supprimer la vente'));
    }
  }, [confirm, notify, load, canVoidSale]);

  return (
    <div className="card table-main inventaire-ventes">
      <div className="table-main-toolbar">
        <h3>Inventaire des ventes</h3>
        <p className="bmb-page-hint">
          {tab === 'produit'
            ? 'Quantités vendues par produit — utilisez Du/Au ou « Aujourd\'hui » pour filtrer par jour.'
            : 'Consultation des ventes validées — filtrez par période, client ou vendeur.'}
        </p>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-primary" onClick={applyFilters}>Rechercher</button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              const cols = tab === 'panier' ? panierColumns.length : PRODUIT_COLUMNS.length;
              setOrientation(suggestPrintOrientation(cols));
              setPreviewOpen(true);
            }}
          >
            Aperçu / Imprimer
          </button>
          <button type="button" className="btn btn-secondary" onClick={exportPdf}>Exporter PDF</button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={dailyReportLoading}
            onClick={openDailyReport}
          >
            {dailyReportLoading ? 'Chargement…' : 'Rapport journalier'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={dailyReportLoading}
            onClick={openMonthlyReport}
          >
            Rapport mensuel
          </button>
        </div>
      </div>

      <nav className="tabs inventaire-subtabs bmb-print-skip" aria-label="Vue inventaire ventes">
        <button
          type="button"
          className={`tab${tab === 'panier' ? ' active' : ''}`}
          onClick={() => setTab('panier')}
        >
          Par panier
        </button>
        <button
          type="button"
          className={`tab${tab === 'produit' ? ' active' : ''}`}
          onClick={() => setTab('produit')}
        >
          Par produit
        </button>
      </nav>

      <div className="bmb-filters-panel bmb-print-skip">
        <div className="bmb-filters-panel__item inventaire-ventes-search">
          <label htmlFor="inventaire-ventes-search">
            {tab === 'panier' ? 'Recherche (client ou n° panier)' : 'Recherche (produit ou référence)'}
          </label>
          <input
            id="inventaire-ventes-search"
            type="search"
            className="search-input search-input--full"
            placeholder={tab === 'panier'
              ? 'Nom client, code ou n° panier...'
              : 'Nom produit ou référence...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="form-group bmb-filters-panel__item">
          <label>Du</label>
          <input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
        </div>
        <div className="form-group bmb-filters-panel__item">
          <label>Au</label>
          <input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
        </div>
        <div className="form-group bmb-filters-panel__item bmb-filters-panel__item--actions">
          <label>&nbsp;</label>
          <button type="button" className="btn btn-secondary" onClick={setTodayFilter}>
            Aujourd&apos;hui
          </button>
        </div>
        {canPickPv && deliveryPoints.length > 1 ? (
          <div className="form-group bmb-filters-panel__item">
            <label>Point de vente</label>
            <select className="filter-select" value={selectedPvId} onChange={(e) => setSelectedPvId(e.target.value)}>
              {deliveryPoints.map((dp) => (
                <option key={dp.id} value={dp.id}>{dp.code} — {dp.name}</option>
              ))}
            </select>
          </div>
        ) : pvLocked ? (
          <div className="form-group bmb-filters-panel__item">
            <label>Point de vente</label>
            <p className="vente-pos-setup__seller-name bmb-page-hint" style={{ margin: 0 }}>{pvDisplayLabel(user)}</p>
          </div>
        ) : null}
        {tab === 'panier' ? (
          <>
            <div className="form-group bmb-filters-panel__item">
              <label>Client</label>
              <select className="filter-select" value={filters.client_id} onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}>
                <option value="">Tous</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group bmb-filters-panel__item">
              <label>Vendeur</label>
              <select className="filter-select" value={filters.seller_id} onChange={(e) => setFilters({ ...filters, seller_id: e.target.value })}>
                <option value="">Tous</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="form-group bmb-filters-panel__item">
              <label>Statut</label>
              <select className="filter-select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="finalise">Validées à la caisse</option>
                <option value="en_cours">En cours</option>
                <option value="">Tous (hors annulés)</option>
              </select>
            </div>
          </>
        ) : (
          <>
            <div className="form-group bmb-filters-panel__item">
              <label>Produit</label>
              <select className="filter-select" value={filters.product_id} onChange={(e) => setFilters({ ...filters, product_id: e.target.value })}>
                <option value="">Tous</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.reference} — {p.name}</option>)}
              </select>
            </div>
            <div className="form-group bmb-filters-panel__item">
              <label>Vendeur</label>
              <select className="filter-select" value={filters.seller_id} onChange={(e) => setFilters({ ...filters, seller_id: e.target.value })}>
                <option value="">Tous</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="form-group bmb-filters-panel__item">
              <label>Statut</label>
              <select className="filter-select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <option value="finalise">Validées à la caisse</option>
                <option value="en_cours">En cours</option>
                <option value="">Tous (hors annulés)</option>
              </select>
            </div>
          </>
        )}
      </div>

      <div className="bmb-print-skip">
        {reportSummary.length > 0 && (
          <div className="reglement-summary-row" role="group" aria-label="Totaux">
            {reportSummary.map((item) => (
              <div key={item.label} className="reglement-summary-item">
                <span className="reglement-summary-label">{item.label}</span>
                <strong className="reglement-summary-value">{item.value}</strong>
              </div>
            ))}
          </div>
        )}
        {(cartsTruncated && tab === 'panier') && (
          <p className="bmb-page-hint bmb-page-hint--warning">
            Liste tronquée — les totaux ci-dessus incluent tous les paniers correspondant aux filtres.
          </p>
        )}

        {loading ? (
          <TableSkeleton rows={6} columns={5} />
        ) : tab === 'panier' ? (
          <ResponsiveDataView
            cards={
              displayCarts.length === 0 ? (
                <EmptyState
                  icon="🛒"
                  title={search.trim() ? 'Aucune vente trouvée' : 'Aucune vente'}
                  description={search.trim()
                    ? 'Essayez un autre terme ou élargissez la période.'
                    : 'Modifiez les filtres puis cliquez sur Rechercher.'}
                  compact
                />
              ) : displayCarts.map((c) => {
                const reste = cartBalanceDue(c);
                const st = cartEncaissementStatus(c);
                return (
                  <DataCard
                    key={c.id}
                    title={c.cart_number}
                    subtitle={`${formatDate(c.validated_at || c.created_at)} · ${c.client_name || 'Sans client'}`}
                    badge={<span className={`badge badge-${st.badge}`}>{st.label}</span>}
                    fields={[
                      { label: 'Vendeur', value: c.seller_name || '—' },
                      { label: 'Type', value: c.sale_type === 'gros' ? 'Gros' : 'Détail' },
                      { label: 'Lignes', value: c.line_count ?? '—' },
                      { label: 'Total', value: formatGNF(c.total_amount), strong: true },
                      ...(showPaymentCols ? [
                        { label: 'Encaissé', value: formatGNF(c.amount_paid) },
                        { label: 'Reste', value: formatGNF(reste), strong: true },
                      ] : []),
                    ]}
                    actions={canVoidSale && c.status === 'finalise' ? (
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => voidSale(c)}>
                        Supprimer
                      </button>
                    ) : null}
                  />
                );
              })
            }
            table={(
          <div className="bmb-data-table-wrap table-scroll bmb-table-scroll-contained inventaire-ventes-table-wrap">
            <table className="bmb-data-table table-full inventaire-ventes-table">
              <thead>
                <tr>
                  <th>N° Panier</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>Vendeur</th>
                  <th>Type</th>
                  <th>Lignes</th>
                  <th className="col-num">Total</th>
                  {showPaymentCols && <th className="col-num">Encaissé</th>}
                  {showPaymentCols && <th className="col-num">Reste</th>}
                  <th>Statut</th>
                  {canVoidSale && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {displayCarts.length === 0 ? (
                  <tr><td colSpan={(showPaymentCols ? 10 : 8) + (canVoidSale ? 1 : 0)} className="table-empty">
                    {search.trim()
                      ? 'Aucune vente pour cette recherche'
                      : 'Aucune vente — modifiez les filtres puis Rechercher'}
                  </td></tr>
                ) : displayCarts.map((c) => {
                  const reste = cartBalanceDue(c);
                  const st = cartEncaissementStatus(c);
                  return (
                    <tr key={c.id}>
                      <td><strong>{c.cart_number}</strong></td>
                      <td>{formatDate(c.validated_at || c.created_at)}</td>
                      <td>{c.client_name || '—'}</td>
                      <td>{c.seller_name || '—'}</td>
                      <td>{c.sale_type === 'gros' ? 'Gros' : 'Détail'}</td>
                      <td className="col-num">{c.line_count ?? '—'}</td>
                      <td className="col-num">{formatGNF(c.total_amount)}</td>
                      {showPaymentCols && <td className="col-num">{formatGNF(c.amount_paid)}</td>}
                      {showPaymentCols && <td className="col-num">{formatGNF(reste)}</td>}
                      <td>
                        <span className={`badge badge-${st.badge}`}>
                          {st.label}
                        </span>
                      </td>
                      {canVoidSale && (
                        <td className="actions-cell">
                          {c.status === 'finalise' && (
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => voidSale(c)}
                            >
                              Supprimer
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {cartTotals.count > 0 && (
                <tfoot>
                  <tr className="bmb-data-table-total-row">
                    <td colSpan={5}>
                      <strong>Total ({cartTotals.count} panier{cartTotals.count > 1 ? 's' : ''})</strong>
                    </td>
                    <td className="col-num"><strong>{formatQty(cartTotals.lines)}</strong></td>
                    <td className="col-num"><strong>{formatGNF(cartTotals.total)}</strong></td>
                    {showPaymentCols && <td className="col-num"><strong>{formatGNF(cartTotals.paid)}</strong></td>}
                    {showPaymentCols && <td className="col-num"><strong>{formatGNF(cartTotals.due)}</strong></td>}
                    <td colSpan={canVoidSale ? 2 : 1} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
            )}
          />
        ) : (
          <ResponsiveDataView
            cards={
              displayProductSummary.length === 0 ? (
                <EmptyState
                  icon="📦"
                  title={search.trim() ? 'Aucun produit trouvé' : 'Aucune vente produit'}
                  description={search.trim()
                    ? 'Essayez un autre terme ou élargissez la période.'
                    : 'Modifiez les filtres puis cliquez sur Rechercher.'}
                  compact
                />
              ) : displayProductSummary.map((r) => (
                <DataCard
                  key={`${r.reference}-${r.product_name}`}
                  title={r.product_name}
                  subtitle={r.reference || 'Sans référence'}
                  fields={[
                    { label: 'Qté vendue', value: formatQty(r.quantity), strong: true },
                    { label: 'Nb ventes', value: r.sales_count },
                    { label: 'Montant', value: formatGNF(r.line_total), strong: true },
                  ]}
                />
              ))
            }
            table={(
          <div className="bmb-data-table-wrap table-scroll bmb-table-scroll-contained inventaire-ventes-table-wrap">
            <table className="bmb-data-table table-full inventaire-ventes-table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Référence</th>
                  <th className="col-num">Qté vendue</th>
                  <th className="col-num">Nb ventes</th>
                  <th className="col-num">Montant total</th>
                </tr>
              </thead>
              <tbody>
                {displayProductSummary.length === 0 ? (
                  <tr><td colSpan={5} className="table-empty">
                    {search.trim()
                      ? 'Aucun produit pour cette recherche'
                      : 'Aucune vente produit — modifiez les filtres puis Rechercher'}
                  </td></tr>
                ) : displayProductSummary.map((r) => (
                  <tr key={`${r.reference}-${r.product_name}`}>
                    <td><strong>{r.product_name}</strong></td>
                    <td>{r.reference || '—'}</td>
                    <td className="col-num">{formatQty(r.quantity)}</td>
                    <td className="col-num">{r.sales_count}</td>
                    <td className="col-num">{formatGNF(r.line_total)}</td>
                  </tr>
                ))}
              </tbody>
              {productTotals.count > 0 && (
                <tfoot>
                  <tr className="bmb-data-table-total-row">
                    <td colSpan={2}><strong>Total ({productTotals.count} produit{productTotals.count > 1 ? 's' : ''})</strong></td>
                    <td className="col-num"><strong>{formatQty(productTotals.qty)}</strong></td>
                    <td />
                    <td className="col-num"><strong>{formatGNF(productTotals.amount)}</strong></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
            )}
          />
        )}
      </div>

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
          subtitle="Inventaire des ventes BESTO SHOP"
          date={new Date()}
          filters={reportFilters}
          summary={reportSummary}
          columns={reportColumns}
          rows={reportRows}
          footRows={reportFoot}
          emptyMessage="Aucune donnée — modifiez les filtres"
        />
      </PrintPreviewModal>

      <PrintPreviewModal
        open={dailyReportOpen}
        onClose={() => setDailyReportOpen(false)}
        title={dailyReportView?.title || 'Rapport journalier'}
        orientation={orientation}
        onOrientationChange={setOrientation}
        onExportPdf={exportDailyPdf}
        printRef={dailyReportRef}
      >
        {dailyReportView && (
          <>
            <PrintReport
              store={store}
              title={dailyReportView.title}
              subtitle={dailyReportView.subtitle}
              date={dailyReportView.date}
              filters={dailyReportView.filters}
              summary={dailyReportView.summary}
              columns={dailySaleColumns}
              rows={dailyReportView.saleRows}
              footRows={dailyReportView.saleFoot}
              emptyMessage="Aucune vente ce jour"
            />
            {dailyReportView.productRows.length > 0 && (
              <div className="bmb-print-history-section">
                <PrintReport
                  store={store}
                  title="Top produits"
                  subtitle={dailyReportView.subtitle}
                  date={dailyReportView.date}
                  columns={DAILY_PRODUCT_COLUMNS}
                  rows={dailyReportView.productRows}
                  footRows={dailyReportView.productFoot}
                  emptyMessage="Aucun produit"
                />
              </div>
            )}
            {showPaymentCols && dailyReportView.modeRows.length > 0 && (
              <div className="bmb-print-history-section">
                <PrintReport
                  store={store}
                  title="Encaissements par mode de paiement"
                  subtitle={dailyReportView.subtitle}
                  date={dailyReportView.date}
                  columns={DAILY_PAYMENT_MODE_COLUMNS}
                  rows={dailyReportView.modeRows}
                  footRows={dailyReportView.modeFoot}
                  emptyMessage="Aucun encaissement"
                />
              </div>
            )}
            {showPaymentCols && dailyReportView.encRows.length > 0 && (
              <div className="bmb-print-history-section">
                <PrintReport
                  store={store}
                  title="Détail des encaissements"
                  subtitle={dailyReportView.subtitle}
                  date={dailyReportView.date}
                  columns={DAILY_ENC_COLUMNS}
                  rows={dailyReportView.encRows}
                  footRows={dailyReportView.encFoot}
                  emptyMessage="Aucun encaissement"
                />
              </div>
            )}
            {showPaymentCols && dailyReportView.debtsRows?.length > 0 && (
              <div className="bmb-print-history-section">
                <PrintReport
                  store={store}
                  title={dailyReportData?.period === 'month' ? 'Dettes et créances du mois' : 'Dettes et créances du jour'}
                  subtitle={dailyReportView.subtitle}
                  date={dailyReportView.date}
                  columns={DEBTS_CREANCES_COLUMNS}
                  rows={dailyReportView.debtsRows}
                  footRows={dailyReportView.debtsFoot}
                  emptyMessage="Aucune dette ni créance"
                />
              </div>
            )}
          </>
        )}
      </PrintPreviewModal>
    </div>
  );
}
