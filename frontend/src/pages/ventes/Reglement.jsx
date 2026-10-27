import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useSocket } from '../../hooks/useSocket';
import { formatGNF, formatDate, formatGNFForPdf, PAYMENT_MODES, settlementStatusLabel, cartEncaissementStatus, cartStatusLabel, purchaseOrderEncaissementStatus, purchaseOrderReste } from '../../utils/format';
import { downloadReportPdf } from '../../utils/printReportPdf';
import { buildPurchaseOrderDocument, downloadPurchaseOrderPdf, downloadBulkReceiptPdf } from '../../utils/printPdf';
import { useReactToPrint } from 'react-to-print';
import PrintReport from '../../components/PrintReport';
import PrintDocument from '../../components/PrintDocument';
import { buildBulkReceiptDocument } from '../../utils/documentBuilders';
import AlertBanner from '../../components/AlertBanner';
import { useNotify } from '../../hooks/useNotify';
import { useConfirm } from '../../context/ConfirmContext';
import { apiErrorMessage } from '../../utils/apiError';
import { parseClientsListResponse } from '../../utils/clientsApi';
import { matchesListSearch } from '../../utils/listSearch';
import '../../styles/bc.css';
import EmptyState from '../../components/ui/EmptyState';
import TableSkeleton from '../../components/ui/TableSkeleton';
import ResponsiveDataView from '../../components/ui/ResponsiveDataView';
import DataCard from '../../components/ui/DataCard';
import BmbFormModal from '../../components/BmbFormModal';
import EncaissementModal from '../../components/EncaissementModal';
import PrintPreviewModal from '../../components/PrintPreviewModal';
import SearchSelect from '../../components/SearchSelect';
import { parseNumberInput } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import { clientEncaissementOptionLabel, clientPvShort, shouldShowClientPv } from '../../utils/pvDisplay';
import { usePvFilter } from '../../context/PvFilterContext';
import EncaissementPvSelect from '../../components/EncaissementPvSelect';

const SECTIONS = [
  { id: 'ventes', label: 'Règlement ventes' },
  { id: 'client', label: 'Encaissement client' },
  { id: 'bc', label: 'Règlement BC' },
  { id: 'situation', label: 'Dettes clients' },
];

const SETTLEMENT_LABELS = {
  client_debt: 'Dettes clients',
  creance_commerciale: 'Dette client',
  dette_commerciale: 'Dette client',
  dette_externe: 'Dettes externes',
  creance_externe: 'Créances externes',
  avance_client: 'Avances client (crédit)',
};

const MANUAL_SETTLEMENT_TYPES = ['dette_commerciale', 'dette_externe', 'creance_externe'];

const SETTLEMENT_TYPE_HINTS = {
  dette_commerciale: 'Dette enregistrée manuellement pour ce client (hors panier caisse).',
  dette_externe: 'La boutique doit de l\'argent à un tiers (fournisseur, banque, etc.). Client optionnel.',
  creance_externe: 'Un tiers doit de l\'argent à la boutique. Indiquez le client ou débiteur concerné.',
};

const VENTES_COLUMNS = [
  { key: 'cart_number', label: 'N° Panier' },
  { key: 'client', label: 'Client' },
  { key: 'date', label: 'Date et heure' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'paid', label: 'Encaissé', align: 'right' },
  { key: 'reste', label: 'Reste à payer', align: 'right' },
  { key: 'status', label: 'Statut' },
];

function cartDateTime(c) {
  return formatDate(c?.validated_at || c?.created_at);
}

function localIsoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function periodQueryParams(periode) {
  if (periode === 'today') {
    const d = localIsoDate();
    return { date_from: d, date_to: d };
  }
  if (periode === 'yesterday') {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const d = localIsoDate(y);
    return { date_from: d, date_to: d };
  }
  return {};
}

function parseCartsResponse(data) {
  if (data && Array.isArray(data.carts)) {
    return { carts: data.carts, truncated: Boolean(data.truncated) };
  }
  return { carts: Array.isArray(data) ? data : [], truncated: false };
}

const BC_COLUMNS = [
  { key: 'order_number', label: 'N° BC' },
  { key: 'client', label: 'Client' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'paid', label: 'Encaissé', align: 'right' },
  { key: 'reste', label: 'Reste', align: 'right' },
  { key: 'status', label: 'Statut' },
  { key: 'date', label: 'Date' },
];

const SETTLEMENT_COLUMNS = [
  { key: 'type', label: 'Type' },
  { key: 'client', label: 'Client' },
  { key: 'reference', label: 'Référence' },
  { key: 'amount', label: 'Montant', align: 'right' },
  { key: 'paid', label: 'Payé', align: 'right' },
  { key: 'balance', label: 'Solde', align: 'right' },
  { key: 'status', label: 'Statut' },
];

const emptySettlement = {
  settlement_type: 'dette_commerciale',
  client_id: '',
  amount: '',
  due_date: '',
  notes: '',
};

function clientDebtBalance(client) {
  const raw = client?.total_debt ?? client?.total_balance_due ?? 0;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function isClientUnifiedDebt(settlement) {
  return settlement?.client_id
    && ['creance_commerciale', 'dette_commerciale'].includes(settlement.settlement_type);
}

function clientDebtBreakdownHint(info) {
  if (!info) return null;
  const cart = parseFloat(info.cart_balance_due || 0);
  const manual = parseFloat(info.settlement_balance_due || 0);
  const total = parseFloat(info.total_due || 0);
  if (total <= 0.005 || (cart <= 0.005 && manual <= 0.005)) return null;
  const parts = [];
  if (cart > 0.005) parts.push(`paniers ${formatGNF(cart)}`);
  if (manual > 0.005) parts.push(`manuelles ${formatGNF(manual)}`);
  if (!parts.length) return null;
  return `Composée de ${parts.join(' + ')} — un seul encaissement sur la dette totale.`;
}

function ReglementSearchBar({ id, label, placeholder, value, onChange }) {
  return (
    <div className="bmb-filters-panel bmb-print-skip reglement-search-bar">
      <div className="bmb-filters-panel__item reglement-search-bar__field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type="search"
          className="search-input search-input--full"
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          autoComplete="off"
        />
      </div>
    </div>
  );
}

export default function Reglement() {
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const showClientPv = shouldShowClientPv(user);
  const { queryParams: pvFilterParams } = usePvFilter();
  const [tab, setTab] = useState(location.state?.tab || 'ventes');
  const [search, setSearch] = useState('');
  const [cartsEnCours, setCartsEnCours] = useState([]);
  const [cartsFinalise, setCartsFinalise] = useState([]);
  const [cartsFinalisePaid, setCartsFinalisePaid] = useState([]);
  const [cartsTruncated, setCartsTruncated] = useState(false);
  const [filterPeriode, setFilterPeriode] = useState('all');
  const [ordersEnCours, setOrdersEnCours] = useState([]);
  const [ordersFinalise, setOrdersFinalise] = useState([]);
  const [summary, setSummary] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [clients, setClients] = useState([]);
  const [filterVentes, setFilterVentes] = useState('solde');
  const [filterBc, setFilterBc] = useState('solde');
  const [filterSettlementType, setFilterSettlementType] = useState('');
  const [filterDebtsOnly, setFilterDebtsOnly] = useState(true);
  const [selected, setSelected] = useState(null);
  const [panelMode, setPanelMode] = useState(null);
  const [showAddSettlement, setShowAddSettlement] = useState(false);
  const [settlementForm, setSettlementForm] = useState(emptySettlement);
  const [settlementClientOption, setSettlementClientOption] = useState(null);
  const [settlementSaving, setSettlementSaving] = useState(false);
  const [cartPayment, setCartPayment] = useState({ amount_paid: '', payment_mode: 'especes' });
  const [bcPayment, setBcPayment] = useState({ amount_paid: '', payment_mode: 'especes' });
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_mode: 'especes', notes: '' });
  const [clientBulkClientId, setClientBulkClientId] = useState('');
  const [clientDebtInfo, setClientDebtInfo] = useState(null);
  const [clientBulkPayment, setClientBulkPayment] = useState({ amount_paid: '', payment_mode: 'especes' });
  const [lastBulkReceipt, setLastBulkReceipt] = useState(null);
  const [clientBulkOpen, setClientBulkOpen] = useState(false);
  const [clientAdvanceOpen, setClientAdvanceOpen] = useState(false);
  const [clientAdvancePayment, setClientAdvancePayment] = useState({ amount_paid: '', payment_mode: 'especes', notes: '' });
  const bulkReceiptPrintRef = useRef();
  const handleBulkReceiptPrint = useReactToPrint({ content: () => bulkReceiptPrintRef.current });
  const [msg, setMsg] = useState('');
  const [store, setStore] = useState({});
  const notify = useNotify();
  const confirm = useConfirm();
  const [bcPreviewOrder, setBcPreviewOrder] = useState(null);
  const [bcPreviewOrientation, setBcPreviewOrientation] = useState('portrait');
  const [loading, setLoading] = useState(false);
  const [clientDebtLoading, setClientDebtLoading] = useState(false);
  const printRef = useRef();
  const bcDocPrintRef = useRef();
  const handlePrint = useReactToPrint({ content: () => printRef.current });
  const handleBcDocPrint = useReactToPrint({ content: () => bcDocPrintRef.current });

  const loadVentes = useCallback(async () => {
    setLoading(true);
    try {
      const today = localIsoDate();
      try {
        await api.post('/sales/reconcile-balances', null, { params: { date: today } });
      } catch {
        /* non bloquant */
      }
      const params = { reglement: 'true', ...periodQueryParams(filterPeriode), ...pvFilterParams };
      const [enCoursRes, finaliseUnpaidRes, finalisePaidRes] = await Promise.all([
        api.get('/sales/carts', { params: { ...params, status: 'en_cours', balance_due: 'true' } }),
        api.get('/sales/carts', { params: { ...params, status: 'finalise', balance_due: 'true' } }),
        api.get('/sales/carts', { params: { ...params, status: 'finalise', balance_paid: 'true' } }),
      ]);
      const enCours = parseCartsResponse(enCoursRes.data);
      const finaliseUnpaid = parseCartsResponse(finaliseUnpaidRes.data);
      const finalisePaid = parseCartsResponse(finalisePaidRes.data);
      setCartsEnCours(enCours.carts);
      setCartsFinalise(finaliseUnpaid.carts);
      setCartsFinalisePaid(finalisePaid.carts);
      setCartsTruncated(enCours.truncated || finaliseUnpaid.truncated || finalisePaid.truncated);
      return true;
    } catch (e) {
      setMsg(apiErrorMessage(e, 'Impossible de charger les ventes à encaisser'));
      return false;
    } finally {
      setLoading(false);
    }
  }, [filterPeriode, pvFilterParams]);

  const loadBc = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/purchase-orders', { params: { reglement: 'true' } });
      const all = Array.isArray(r.data) ? r.data : [];
      setOrdersEnCours(all.filter((o) => o.status === 'en_cours'));
      setOrdersFinalise(all.filter((o) => o.status === 'finalise'));
      return true;
    } catch (e) {
      setMsg(apiErrorMessage(e, 'Impossible de charger les bons de commande'));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSituation = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, settlementsRes] = await Promise.all([
        api.get('/settlements/debts-summary'),
        api.get('/settlements', { params: { sync_sales: 'true' } }),
      ]);
      setSummary(summaryRes.data);
      setSettlements(settlementsRes.data);
      return true;
    } catch (e) {
      setMsg(apiErrorMessage(e, 'Impossible de charger les dettes et créances'));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadClientDebts = useCallback(async (clientId) => {
    if (!clientId) {
      setClientDebtInfo(null);
      return false;
    }
    setClientDebtLoading(true);
    try {
      const { data } = await api.get(`/sales/clients/${clientId}/unpaid-carts`);
      setClientDebtInfo(data);
      setClientBulkPayment((p) => ({
        ...p,
        amount_paid: data.total_due > 0 ? String(Math.round(data.total_due)) : '',
      }));
      return true;
    } catch (e) {
      setClientDebtInfo(null);
      setMsg(apiErrorMessage(e, 'Impossible de charger les dettes du client'));
      return false;
    } finally {
      setClientDebtLoading(false);
    }
  }, []);

  const refresh = async () => {
    setMsg('');
    let ok = false;
    if (tab === 'ventes') ok = await loadVentes();
    else if (tab === 'client') ok = clientBulkClientId ? await loadClientDebts(clientBulkClientId).then(() => true) : true;
    else if (tab === 'bc') ok = await loadBc();
    else ok = await loadSituation();
    if (ok) notify.success('Liste actualisée');
  };

  useEffect(() => {
    api.get('/clients', { params: { debt_only: 'true', ...pvFilterParams } })
      .then((r) => setClients(parseClientsListResponse(r.data).clients))
      .catch(() => {});
    api.get('/settings/store').then((r) => setStore(r.data || {})).catch(() => {});
  }, [pvFilterParams]);

  useEffect(() => {
    if (!clientBulkClientId || !pvFilterParams.delivery_point_id) return;
    const client = clients.find((c) => String(c.id) === String(clientBulkClientId));
    if (client && String(client.delivery_point_id) !== String(pvFilterParams.delivery_point_id)) {
      setClientBulkClientId('');
      setClientDebtInfo(null);
    }
  }, [pvFilterParams, clients, clientBulkClientId]);

  useEffect(() => {
    setSelected(null);
    setPanelMode(null);
    setShowAddSettlement(false);
    setSearch('');
    setBcPreviewOrder(null);
    if (tab === 'ventes') loadVentes();
    else if (tab === 'client' && clientBulkClientId) loadClientDebts(clientBulkClientId);
    else if (tab === 'bc') loadBc();
    else loadSituation();
  }, [tab, filterPeriode, clientBulkClientId, loadVentes, loadBc, loadSituation, loadClientDebts]);

  useEffect(() => {
    if (tab === 'client' && clientBulkClientId) {
      loadClientDebts(clientBulkClientId);
    }
  }, [tab, clientBulkClientId, loadClientDebts]);

  useSocket((event, data) => {
    if (event !== 'cart:updated' && event !== 'cart:validated') return;
    if (tab === 'ventes') loadVentes();
    if (tab === 'situation') loadSituation();
    if (selected?.id && data?.id === selected.id) {
      if (data.status === 'annule') {
        setSelected(null);
        setPanelMode(null);
        setMsg('Ce panier a été annulé');
      } else if (event === 'cart:updated') {
        api.get(`/sales/carts/${selected.id}`).then((r) => setSelected(r.data)).catch(() => {});
      }
    }
  });

  const matchSearch = (...fields) => matchesListSearch(search, ...fields);

  const mergeCartsUnique = (lists) => {
    const byId = new Map();
    lists.flat().forEach((c) => { if (c?.id) byId.set(c.id, c); });
    return [...byId.values()].sort(
      (a, b) => new Date(b.validated_at || b.created_at) - new Date(a.validated_at || a.created_at)
    );
  };

  const cartMonnaie = (c) => Math.max(0, parseFloat(c.amount_paid || 0) - parseFloat(c.total_amount || 0));

  const cartResteAPayer = (c) => {
    if (c.balance_due != null) return parseFloat(c.balance_due);
    return Math.max(0, parseFloat(c.total_amount || 0) - parseFloat(c.amount_paid || 0));
  };

  const bcResteAPayer = (o) => purchaseOrderReste(o);

  const mergeOrdersUnique = (lists) => {
    const byId = new Map();
    lists.flat().forEach((o) => { if (o?.id) byId.set(o.id, o); });
    return [...byId.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  };

  const ventesRows = (filterVentes === 'solde'
    ? mergeCartsUnique([
        cartsEnCours.filter((c) => cartResteAPayer(c) > 0.005),
        cartsFinalise.filter((c) => cartResteAPayer(c) > 0.005),
      ])
    : filterVentes === 'credit'
      ? cartsFinalise.filter((c) => cartResteAPayer(c) > 0.005)
    : filterVentes === 'finalise'
    ? cartsFinalisePaid
    : filterVentes === 'en_cours'
      ? cartsEnCours
      : filterVentes === 'tous'
        ? mergeCartsUnique([cartsEnCours, cartsFinalisePaid])
        : cartsEnCours
  ).filter((c) => matchSearch(c.cart_number, c.client_name, c.client_code));

  const bcRows = (filterBc === 'solde'
    ? mergeOrdersUnique([ordersEnCours, ordersFinalise]).filter((o) => bcResteAPayer(o) > 0.005)
    : filterBc === 'finalise'
      ? ordersFinalise.filter((o) => bcResteAPayer(o) <= 0.005)
      : filterBc === 'en_cours'
        ? ordersEnCours
        : filterBc === 'tous'
          ? mergeOrdersUnique([ordersEnCours, ordersFinalise])
          : ordersEnCours
  ).filter((o) => matchSearch(o.order_number, o.client_name, o.client_code));

  const settlementRows = (filterSettlementType
    ? settlements.filter((s) => s.settlement_type === filterSettlementType)
    : settlements.filter((s) => ['creance_commerciale', 'dette_commerciale', 'creance_externe'].includes(s.settlement_type))
  )
    .filter((s) => !filterDebtsOnly || parseFloat(s.balance) > 0.005)
    .filter((s) => matchSearch(s.client_name, SETTLEMENT_LABELS[s.settlement_type], s.notes, s.sale_cart_number));

  const ventesFilterLabel = filterVentes === 'solde'
    ? 'À encaisser'
    : filterVentes === 'credit'
      ? 'Crédit client (dettes)'
    : filterVentes === 'en_cours'
      ? 'En cours'
      : filterVentes === 'finalise'
        ? 'Soldés'
        : 'Tous';
  const bcFilterLabel = filterBc === 'solde'
    ? 'À encaisser'
    : filterBc === 'en_cours'
      ? 'En cours'
      : filterBc === 'finalise'
        ? 'Soldés'
        : 'Tous';

  const periodeLabel = filterPeriode === 'today'
    ? 'Aujourd\'hui'
    : filterPeriode === 'yesterday'
      ? 'Hier'
      : 'Toutes dates';

  const searchLabel = tab === 'ventes'
    ? 'Recherche (client ou n° panier)'
    : tab === 'bc'
      ? 'Recherche (client ou n° BC)'
      : 'Recherche (client ou référence)';

  const searchPlaceholder = tab === 'ventes'
    ? 'Nom client, code ou n° panier...'
    : tab === 'bc'
      ? 'Nom client, code ou n° BC...'
      : 'Nom client ou référence panier...';

  const ventesReportFilters = useMemo(() => [
    { label: 'Statut', value: ventesFilterLabel },
    { label: 'Période', value: periodeLabel },
    ...(search.trim() ? [{ label: 'Recherche', value: search.trim() }] : []),
  ], [ventesFilterLabel, periodeLabel, search]);

  const bcReportFilters = useMemo(() => [
    { label: 'Statut', value: bcFilterLabel },
    ...(search.trim() ? [{ label: 'Recherche', value: search.trim() }] : []),
  ], [bcFilterLabel, search]);

  const settlementReportFilters = useMemo(() => [
    { label: 'Type', value: filterSettlementType ? SETTLEMENT_LABELS[filterSettlementType] : '' },
    { label: 'Affichage', value: filterDebtsOnly ? 'Dettes en cours' : 'Tous' },
    ...(search.trim() ? [{ label: 'Recherche', value: search.trim() }] : []),
  ], [filterSettlementType, filterDebtsOnly, search]);

  const ventesReportRows = useMemo(() => ventesRows.map((c) => {
    const st = cartEncaissementStatus(c);
    return {
      id: c.id,
      cart_number: c.cart_number,
      client: c.client_name || '—',
      date: cartDateTime(c),
      total: formatGNF(c.total_amount),
      paid: formatGNF(c.amount_paid),
      reste: cartResteAPayer(c) > 0.005 ? formatGNF(cartResteAPayer(c)) : '—',
      status: st.label,
    };
  }), [ventesRows]);

  const ventesReportTotals = useMemo(() => ({
    total: ventesRows.reduce((s, c) => s + parseFloat(c.total_amount || 0), 0),
    paid: ventesRows.reduce((s, c) => s + parseFloat(c.amount_paid || 0), 0),
  }), [ventesRows]);

  const ventesReportFoot = useMemo(() => (
    ventesRows.length
      ? [{
        cells: [
          { value: `Total (${ventesRows.length})`, colSpan: 3 },
          { value: formatGNF(ventesReportTotals.total), align: 'right' },
          { value: formatGNF(ventesReportTotals.paid), align: 'right' },
          { value: '', colSpan: 2 },
        ],
      }]
      : []
  ), [ventesRows.length, ventesReportTotals]);

  const bcReportRows = useMemo(() => bcRows.map((o) => {
    const st = purchaseOrderEncaissementStatus(o);
    const reste = bcResteAPayer(o);
    return {
      id: o.id,
      order_number: o.order_number,
      client: o.client_name || '—',
      total: formatGNF(o.total_amount),
      paid: formatGNF(o.amount_paid || 0),
      reste: reste > 0.005 ? formatGNF(reste) : '—',
      status: st.label,
      date: formatDate(o.finalized_at || o.created_at),
    };
  }), [bcRows]);

  const bcReportTotals = useMemo(
    () => bcRows.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0),
    [bcRows]
  );

  const bcReportFoot = useMemo(() => (
    bcRows.length
      ? [{
        cells: [
          { value: `Total (${bcRows.length})`, colSpan: 2 },
          { value: formatGNF(bcReportTotals), align: 'right' },
          { value: '', colSpan: 4 },
        ],
      }]
      : []
  ), [bcRows.length, bcReportTotals]);

  const settlementReportRows = useMemo(() => settlementRows.map((s) => ({
    id: s.id,
    type: SETTLEMENT_LABELS[s.settlement_type] || s.settlement_type,
    client: s.client_name || '—',
    reference: s.sale_cart_number || s.notes || s.settlement_number || '—',
    amount: formatGNF(s.amount),
    paid: formatGNF(s.amount_paid),
    balance: formatGNF(s.balance),
    status: settlementStatusLabel(s.status),
  })), [settlementRows]);

  const settlementReportTotals = useMemo(() => ({
    amount: settlementRows.reduce((s, x) => s + parseFloat(x.amount || 0), 0),
    paid: settlementRows.reduce((s, x) => s + parseFloat(x.amount_paid || 0), 0),
    balance: settlementRows.reduce((s, x) => s + parseFloat(x.balance || 0), 0),
  }), [settlementRows]);

  const settlementReportFoot = useMemo(() => (
    settlementRows.length
      ? [{
        cells: [
          { value: `Total (${settlementRows.length})`, colSpan: 3 },
          { value: formatGNF(settlementReportTotals.amount), align: 'right' },
          { value: formatGNF(settlementReportTotals.paid), align: 'right' },
          { value: formatGNF(settlementReportTotals.balance), align: 'right' },
          { value: '', colSpan: 2 },
        ],
      }]
      : []
  ), [settlementRows.length, settlementReportTotals]);

  const exportReportPdf = useCallback(() => {
    if (tab === 'ventes') {
      downloadReportPdf({
        store,
        title: 'Règlement des ventes',
        subtitle: ventesFilterLabel,
        filters: ventesReportFilters,
        head: VENTES_COLUMNS.map((c) => c.label),
        body: ventesReportRows.map((r) => VENTES_COLUMNS.map((c) => r[c.key])),
        foot: ventesRows.length
          ? [[`Total (${ventesRows.length})`, '', formatGNFForPdf(ventesReportTotals.total), formatGNFForPdf(ventesReportTotals.paid), '', '']]
          : [],
        rightAlignCols: [2, 3, 4],
        filename: 'reglement-ventes.pdf',
      });
    } else if (tab === 'bc') {
      downloadReportPdf({
        store,
        title: 'Règlement des bons de commande',
        subtitle: bcFilterLabel,
        filters: bcReportFilters,
        head: BC_COLUMNS.map((c) => c.label),
        body: bcReportRows.map((r) => BC_COLUMNS.map((c) => r[c.key])),
        foot: bcRows.length
          ? [[`Total (${bcRows.length})`, '', formatGNFForPdf(bcReportTotals), '', '', '', '']]
          : [],
        rightAlignCols: [2, 3, 4],
        filename: 'reglement-bc.pdf',
      });
    } else {
      downloadReportPdf({
        store,
        title: 'Dettes et créances',
        subtitle: 'Situation financière',
        filters: settlementReportFilters,
        head: SETTLEMENT_COLUMNS.map((c) => c.label),
        body: settlementReportRows.map((r) => SETTLEMENT_COLUMNS.map((c) => r[c.key])),
        foot: settlementRows.length
          ? [[`Total (${settlementRows.length})`, '', '', formatGNFForPdf(settlementReportTotals.amount), formatGNFForPdf(settlementReportTotals.paid), formatGNFForPdf(settlementReportTotals.balance), '']]
          : [],
        rightAlignCols: [3, 4, 5],
        filename: 'dettes-creances.pdf',
      });
    }
  }, [
    tab, store, ventesFilterLabel, bcFilterLabel, ventesReportFilters, bcReportFilters, settlementReportFilters,
    ventesReportRows, bcReportRows, settlementReportRows, ventesRows.length, bcRows.length, settlementRows.length,
    ventesReportTotals, bcReportTotals, settlementReportTotals,
  ]);

  const viewCart = async (c) => {
    try {
      const { data } = await api.get(`/sales/carts/${c.id}`);
      setSelected(data);
      setPanelMode('view');
    } catch {
      setMsg('Impossible de charger le panier');
    }
  };

  const closePanel = () => {
    setPanelMode(null);
    setSelected(null);
    setShowAddSettlement(false);
    setSettlementForm(emptySettlement);
    setSettlementClientOption(null);
    setSettlementSaving(false);
  };

  const openAddSettlement = () => {
    setSettlementForm({ ...emptySettlement });
    setSettlementClientOption(null);
    setSelected(null);
    setPanelMode('add');
    setShowAddSettlement(true);
  };

  const closeSettlementModal = () => {
    setShowAddSettlement(false);
    if (panelMode === 'add') setPanelMode(null);
    setSettlementForm(emptySettlement);
    setSettlementClientOption(null);
    setSettlementSaving(false);
  };

  const fetchClientSelectOptions = useCallback(async (query, { debtOnly = false } = {}) => {
    const { data } = await api.get('/clients', {
      params: {
        search: query || undefined,
        ...(debtOnly ? { debt_only: 'true' } : {}),
        ...pvFilterParams,
      },
    });
    return parseClientsListResponse(data).clients.map((c) => ({
      value: c.id,
      label: clientEncaissementOptionLabel(c, user, clientDebtBalance(c)),
    }));
  }, [user, pvFilterParams]);

  const clientSelectOptions = useCallback(
    (query) => fetchClientSelectOptions(query, { debtOnly: true }),
    [fetchClientSelectOptions],
  );

  const settlementClientSelectOptions = useCallback(
    (query) => fetchClientSelectOptions(query, { debtOnly: false }),
    [fetchClientSelectOptions],
  );

  const selectedBulkClient = useMemo(
    () => clients.find((c) => String(c.id) === String(clientBulkClientId)) || null,
    [clients, clientBulkClientId],
  );

  const selectedBulkClientOption = useMemo(() => {
    if (!selectedBulkClient) return null;
    return {
      value: selectedBulkClient.id,
      label: clientEncaissementOptionLabel(selectedBulkClient, user, clientDebtBalance(selectedBulkClient)),
    };
  }, [selectedBulkClient, user]);

  const openClientEncaissement = useCallback((clientId) => {
    if (!clientId) return;
    setTab('client');
    setClientBulkClientId(String(clientId));
    setLastBulkReceipt(null);
    setMsg('');
    setPanelMode(null);
    setSelected(null);
  }, []);

  const openClientBulkPayment = () => {
    if (!clientBulkClientId) {
      setMsg('Sélectionnez d\'abord un client');
      return;
    }
    if (parseFloat(clientDebtInfo?.total_due || 0) <= 0.005) {
      setMsg('Ce client n\'a aucune dette à encaisser');
      return;
    }
    setClientBulkOpen(true);
  };

  const selectedClientOption = useMemo(() => {
    if (settlementClientOption) return settlementClientOption;
    if (!settlementForm.client_id) return null;
    const client = clients.find((c) => String(c.id) === String(settlementForm.client_id));
    return client
      ? { value: client.id, label: clientEncaissementOptionLabel(client, user, clientDebtBalance(client)) }
      : null;
  }, [settlementClientOption, clients, settlementForm.client_id, user]);

  const openCartPayment = (c) => {
    setSelected(c);
    setPanelMode('cart');
    setCartPayment({
      amount_paid: '',
      payment_mode: 'especes',
    });
  };

  useEffect(() => {
    const cartId = searchParams.get('cart');
    const clientId = searchParams.get('client');
    if (clientId) {
      setTab('client');
      setClientBulkClientId(clientId);
      setSearchParams({}, { replace: true });
      return;
    }
    if (!cartId) return;
    api.get(`/sales/carts/${cartId}`)
      .then(({ data }) => {
        setTab('ventes');
        openCartPayment(data);
        setSearchParams({}, { replace: true });
      })
      .catch(() => setMsg('Panier introuvable — vérifiez le numéro ou actualisez la liste'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recordCartPayment = async () => {
    if (!selected?.id) return;
    const installment = parseFloat(cartPayment.amount_paid || 0);
    const reste = cartResteAPayer(selected);
    if (!installment || installment <= 0) {
      setMsg('Saisissez le montant de ce versement');
      return;
    }
    if (installment > reste + 0.005) {
      setMsg(`Montant trop élevé. Reste à payer : ${formatGNF(reste)}`);
      return;
    }
    const ok = await confirm({
      title: 'Enregistrer l\'encaissement',
      message: `Encaisser ${formatGNF(installment)} sur le panier ${selected.cart_number} ?`,
      confirmLabel: 'Encaisser',
    });
    if (!ok) return;
    try {
      const { data } = await api.post(`/sales/carts/${selected.id}/payments`, cartPayment);
      const balance = parseFloat(data.balance_due ?? 0);
      const successMsg = balance <= 0.005
        ? (data.message || 'Paiement complet — panier soldé')
        : (data.message || `Versement enregistré — reste ${formatGNF(balance)}`);
      setMsg('');
      notify.success(successMsg);
      closePanel();
      loadVentes();
      loadSituation();
    } catch (e) {
      setMsg(e.response?.data?.message || 'Erreur lors du règlement du panier');
    }
  };

  const recordClientBulkPayment = async () => {
    if (!clientBulkClientId) {
      setMsg('Sélectionnez un client');
      return;
    }
    const totalDue = parseFloat(clientDebtInfo?.total_due || 0);
    const installment = parseFloat(clientBulkPayment.amount_paid || 0);
    if (totalDue <= 0.005) {
      setMsg('Ce client n\'a aucune dette à encaisser');
      return;
    }
    if (!installment || installment <= 0) {
      setMsg('Saisissez le montant à encaisser');
      return;
    }
    if (installment > totalDue + 0.005) {
      setMsg(`Montant trop élevé. Dette totale : ${formatGNF(totalDue)}`);
      return;
    }
    const clientName = clients.find((c) => String(c.id) === String(clientBulkClientId))?.name || 'ce client';
    const ok = await confirm({
      title: 'Encaissement global',
      message: `Encaisser ${formatGNF(installment)} pour ${clientName} sur la dette totale (${formatGNF(totalDue)}) ?`,
      confirmLabel: 'Encaisser tout',
    });
    if (!ok) return;
    try {
      const { data } = await api.post(`/sales/clients/${clientBulkClientId}/bulk-payment`, clientBulkPayment);
      setLastBulkReceipt(data);
      setMsg('');
      notify.success(data.message || 'Encaissement enregistré');
      await loadClientDebts(clientBulkClientId);
      loadVentes();
      loadSituation();
    } catch (e) {
      setMsg(apiErrorMessage(e, 'Erreur encaissement global'));
    }
  };

  const recordClientAdvance = async () => {
    if (!clientBulkClientId) {
      setMsg('Sélectionnez un client');
      return;
    }
    const installment = parseFloat(clientAdvancePayment.amount_paid || 0);
    if (!installment || installment <= 0) {
      setMsg('Saisissez le montant de l\'avance');
      return;
    }
    const clientName = selectedBulkClient?.name || 'ce client';
    const ok = await confirm({
      title: 'Enregistrer une avance',
      message: `Enregistrer une avance de ${formatGNF(installment)} pour ${clientName} ? Ce crédit pourra être utilisé lors des prochains achats.`,
      confirmLabel: 'Enregistrer l\'avance',
    });
    if (!ok) return;
    try {
      const { data } = await api.post(`/sales/clients/${clientBulkClientId}/advance-payment`, clientAdvancePayment);
      setMsg('');
      notify.success(data.message || 'Avance enregistrée');
      setClientAdvanceOpen(false);
      setClientAdvancePayment({ amount_paid: '', payment_mode: 'especes', notes: '' });
      await loadClientDebts(clientBulkClientId);
    } catch (e) {
      setMsg(apiErrorMessage(e, 'Erreur enregistrement avance'));
    }
  };

  const openClientAdvanceModal = () => {
    if (!clientBulkClientId) {
      setMsg('Sélectionnez d\'abord un client');
      return;
    }
    setClientAdvancePayment({ amount_paid: '', payment_mode: 'especes', notes: '' });
    setClientAdvanceOpen(true);
  };

  const openBcPayment = (o) => {
    setSelected(o);
    setPanelMode('bc');
    setBcPayment({ amount_paid: '', payment_mode: 'especes' });
  };

  const loadBcForDoc = async (id) => {
    const { data } = await api.get(`/purchase-orders/${id}`);
    return data;
  };

  const openBcPreview = async (o) => {
    if (!o?.id) return;
    try {
      const data = o.lines?.length ? o : await loadBcForDoc(o.id);
      setBcPreviewOrder(data);
      setSelected(o);
    } catch {
      setMsg('Impossible de charger le bon de commande');
    }
  };

  const printBcOrder = async (o) => {
    if (!o?.id) return;
    try {
      const data = bcPreviewOrder?.id === o.id ? bcPreviewOrder : await loadBcForDoc(o.id);
      setBcPreviewOrder(data);
      setTimeout(() => handleBcDocPrint(), 150);
    } catch {
      setMsg('Impossible d\'imprimer le bon');
    }
  };

  const bcPrintDoc = useMemo(
    () => (bcPreviewOrder?.lines?.length ? buildPurchaseOrderDocument(bcPreviewOrder, store) : null),
    [bcPreviewOrder, store]
  );

  const recordBcPayment = async () => {
    if (!selected?.id) return;
    const installment = parseFloat(bcPayment.amount_paid || 0);
    const reste = bcResteAPayer(selected);
    if (!installment || installment <= 0) {
      setMsg('Saisissez le montant de ce versement');
      return;
    }
    if (installment > reste + 0.005) {
      setMsg(`Montant trop élevé. Reste à payer : ${formatGNF(reste)}`);
      return;
    }
    const ok = await confirm({
      title: 'Encaissement bon de commande',
      message: `Encaisser ${formatGNF(installment)} sur le bon ${selected.order_number} ?`,
      confirmLabel: 'Encaisser',
    });
    if (!ok) return;
    try {
      const { data } = await api.post(`/purchase-orders/${selected.id}/payments`, bcPayment);
      setMsg('');
      notify.success(data.message || 'Encaissement enregistré — bon de commande mis à jour');
      closePanel();
      loadBc();
    } catch (e) {
      setMsg(e.response?.data?.message || 'Erreur lors de l\'encaissement du bon');
    }
  };

  const paySettlement = async () => {
    if (!selected?.id || !paymentForm.amount) return;
    const installment = parseFloat(paymentForm.amount || 0);
    const ok = await confirm({
      title: 'Enregistrer le paiement',
      message: `Enregistrer un paiement de ${formatGNF(installment)} ?`,
      confirmLabel: 'Encaisser',
    });
    if (!ok) return;
    try {
      await api.post(`/settlements/${selected.id}/payments`, paymentForm);
      setMsg('');
      notify.success(selected.reference_id ? 'Paiement enregistré — dette mise à jour' : 'Paiement enregistré avec succès');
      closePanel();
      loadSituation();
    } catch (e) {
      setMsg(e.response?.data?.message || 'Erreur lors du paiement');
    }
  };

  const openSettlementPayment = (s) => {
    setSelected(s);
    setPanelMode('settlement');
    setPaymentForm({ amount: String(s.balance), payment_mode: 'especes', notes: '' });
  };

  const saveNewSettlement = async () => {
    const amt = parseNumberInput(settlementForm.amount);
    if (!settlementForm.settlement_type) {
      notify.error('Choisissez un type de dette ou créance');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      notify.error('Saisissez un montant supérieur à 0');
      return;
    }
    if (settlementForm.settlement_type === 'dette_commerciale' && !settlementForm.client_id) {
      notify.error('Sélectionnez le client concerné');
      return;
    }
    const typeLabel = SETTLEMENT_LABELS[settlementForm.settlement_type] || settlementForm.settlement_type;
    const clientLabel = selectedClientOption?.label;
    const ok = await confirm({
      title: 'Enregistrer la dette / créance',
      message: clientLabel
        ? `Créer « ${typeLabel} » de ${formatGNF(amt)} pour ${clientLabel} ?`
        : `Créer « ${typeLabel} » de ${formatGNF(amt)} ?`,
      confirmLabel: 'Enregistrer',
    });
    if (!ok) return;
    setSettlementSaving(true);
    try {
      await api.post('/settlements', {
        ...settlementForm,
        amount: amt,
        client_id: settlementForm.client_id || null,
        due_date: settlementForm.due_date || null,
        notes: settlementForm.notes?.trim() || null,
      });
      setMsg('');
      notify.success('Dette / créance enregistrée avec succès');
      closeSettlementModal();
      loadSituation();
    } catch (e) {
      setMsg(e.response?.data?.message || 'Erreur lors de l\'enregistrement');
    } finally {
      setSettlementSaving(false);
    }
  };

  return (
    <>
      <AlertBanner message={msg} onClose={() => setMsg('')} />

      <div className="card table-main reglement-page">
        <div className="reglement-section-bar bmb-print-skip">
          <label htmlFor="reglement-section">Section</label>
          <select
            id="reglement-section"
            className="filter-select"
            value={tab}
            onChange={(e) => setTab(e.target.value)}
          >
            {SECTIONS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        {tab === 'client' && (
          <>
            <div className="bmb-filters-panel bmb-print-skip reglement-client-panel">
              <EncaissementPvSelect id="reglement-pv-select" />
              <div className="bmb-filters-panel__item reglement-client-panel__select">
                <SearchSelect
                  label="Client à encaisser"
                  value={clientBulkClientId}
                  selectedOption={selectedBulkClientOption}
                  onChange={(id) => {
                    setClientBulkClientId(id || '');
                    setLastBulkReceipt(null);
                    setMsg('');
                  }}
                  loadOptions={clientSelectOptions}
                  placeholder="Rechercher un client avec dette…"
                  allowClear
                  clearLabel="— Aucun client —"
                  hint={showClientPv
                    ? 'Le point de vente est affiché pour chaque client — vérifiez le PV avant d\'encaisser une avance.'
                    : 'Les clients avec un solde impayé apparaissent en premier.'}
                />
              </div>
              {showClientPv && selectedBulkClient && (
                <div className="bmb-filters-panel__item reglement-client-panel__pv">
                  <p className="bmb-page-hint" style={{ margin: 0 }}>
                    Point de vente :{' '}
                    <strong>{clientPvShort(selectedBulkClient) || '—'}</strong>
                    {selectedBulkClient.code ? ` · Code client ${selectedBulkClient.code}` : ''}
                  </p>
                </div>
              )}
            </div>

            <div className="table-main-toolbar bmb-print-skip">
              <h3>Encaissement client</h3>
              <div className="toolbar-actions">
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={openClientAdvanceModal}
                  disabled={!clientBulkClientId}
                >
                  Enregistrer une avance
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={openClientBulkPayment}
                  disabled={!clientBulkClientId || parseFloat(clientDebtInfo?.total_due || 0) <= 0.005}
                >
                  Encaisser
                </button>
                <button type="button" className="btn btn-secondary" onClick={refresh}>Actualiser</button>
                {lastBulkReceipt && (
                  <>
                    <button type="button" className="btn btn-secondary" onClick={handleBulkReceiptPrint}>
                      Imprimer reçu
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => downloadBulkReceiptPdf(lastBulkReceipt, store)}
                    >
                      PDF reçu
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="bmb-print-skip reglement-client-panel__body">
              {!clientBulkClientId && (
                <EmptyState
                  icon="👤"
                  title="Sélectionnez un client"
                  description="Choisissez un client ci-dessus pour voir ses dettes, son crédit d'avance ou enregistrer un versement anticipé."
                  compact
                />
              )}

              {clientBulkClientId && clientDebtLoading && (
                <TableSkeleton rows={4} columns={5} />
              )}

              {clientBulkClientId && !clientDebtLoading && clientDebtInfo && (
                <>
                <div className="reglement-summary-row" role="group" aria-label="Compte client">
                  <div className="reglement-summary-item">
                    <span className="reglement-summary-label">Dette totale</span>
                    <strong className="reglement-summary-value" style={{ color: 'var(--danger)' }}>
                      {formatGNF(clientDebtInfo.total_due || 0)}
                    </strong>
                  </div>
                  <div className="reglement-summary-item">
                    <span className="reglement-summary-label">Avance disponible</span>
                    <strong className="reglement-summary-value" style={{ color: 'var(--success)' }}>
                      {formatGNF(clientDebtInfo.advance_balance || 0)}
                    </strong>
                  </div>
                </div>
                {clientDebtBreakdownHint(clientDebtInfo) && (
                  <p className="bmb-page-hint" style={{ marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
                    {clientDebtBreakdownHint(clientDebtInfo)}
                  </p>
                )}
                </>
              )}

              {clientBulkClientId && !clientDebtLoading && clientDebtInfo?.carts?.length > 0 && (
                <>
                  <h4 className="bmb-section-title">Détail — paniers</h4>
                  <ResponsiveDataView
                    cards={clientDebtInfo.carts.map((c) => (
                      <DataCard
                        key={c.id}
                        title={c.cart_number}
                        subtitle={formatDate(c.validated_at || c.created_at)}
                        fields={[
                          { label: 'Total', value: formatGNF(c.total_amount) },
                          { label: 'Encaissé', value: formatGNF(c.amount_paid) },
                          { label: 'Reste', value: formatGNF(c.balance_due), strong: true },
                        ]}
                      />
                    ))}
                    table={(
                      <div className="bmb-data-table-wrap table-scroll">
                        <table className="bmb-data-table table-full">
                          <thead>
                            <tr>
                              <th>N° Panier</th>
                              <th>Date</th>
                              <th>Total</th>
                              <th>Encaissé</th>
                              <th>Reste</th>
                            </tr>
                          </thead>
                          <tbody>
                            {clientDebtInfo.carts.map((c) => (
                              <tr key={c.id}>
                                <td><strong>{c.cart_number}</strong></td>
                                <td>{formatDate(c.validated_at || c.created_at)}</td>
                                <td className="col-num">{formatGNF(c.total_amount)}</td>
                                <td className="col-num">{formatGNF(c.amount_paid)}</td>
                                <td className="col-num"><strong>{formatGNF(c.balance_due)}</strong></td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="bmb-data-table-total-row">
                              <td colSpan={2}><span style={{ color: 'var(--text-muted)' }}>Sous-total paniers ({clientDebtInfo.cart_count})</span></td>
                              <td />
                              <td />
                              <td className="col-num" style={{ color: 'var(--text-muted)' }}>{formatGNF(clientDebtInfo.cart_balance_due ?? 0)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  />
                </>
              )}

              {clientBulkClientId && !clientDebtLoading && clientDebtInfo?.advances?.length > 0 && (
                <>
                  <h4 className="bmb-section-title">Avances en cours</h4>
                  <div className="bmb-data-table-wrap table-scroll">
                    <table className="bmb-data-table table-full">
                      <thead>
                        <tr>
                          <th>Référence</th>
                          <th>Date</th>
                          <th>Versement initial</th>
                          <th>Utilisé</th>
                          <th>Disponible</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientDebtInfo.advances.map((a) => (
                          <tr key={a.id}>
                            <td><strong>{a.settlement_number}</strong></td>
                            <td>{formatDate(a.created_at)}</td>
                            <td className="col-num">{formatGNF(a.amount)}</td>
                            <td className="col-num">{formatGNF(a.amount_paid)}</td>
                            <td className="col-num"><strong>{formatGNF(a.balance)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {clientBulkClientId && !clientDebtLoading && clientDebtInfo?.settlements?.length > 0 && (
                <>
                  <h4 className="bmb-section-title">Détail — dettes manuelles</h4>
                  <div className="bmb-data-table-wrap table-scroll">
                    <table className="bmb-data-table table-full">
                      <thead>
                        <tr>
                          <th>Référence</th>
                          <th>Date</th>
                          <th>Montant</th>
                          <th>Encaissé</th>
                          <th>Reste</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clientDebtInfo.settlements.map((s) => (
                          <tr key={s.id}>
                            <td><strong>{s.settlement_number}</strong></td>
                            <td>{formatDate(s.created_at)}</td>
                            <td className="col-num">{formatGNF(s.amount)}</td>
                            <td className="col-num">{formatGNF(s.amount_paid)}</td>
                            <td className="col-num"><strong>{formatGNF(s.balance)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bmb-data-table-total-row">
                          <td colSpan={2}><span style={{ color: 'var(--text-muted)' }}>Sous-total manuelles ({clientDebtInfo.settlement_count})</span></td>
                          <td />
                          <td />
                          <td className="col-num" style={{ color: 'var(--text-muted)' }}>{formatGNF(clientDebtInfo.settlement_balance_due || 0)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}

              {clientBulkClientId && !clientDebtLoading && clientDebtInfo
                && parseFloat(clientDebtInfo.total_due || 0) <= 0.005
                && !(clientDebtInfo.advance_balance > 0.005) && (
                <EmptyState
                  icon="✓"
                  title="Aucune dette ni avance"
                  description="Ce client n'a aucune dette. Utilisez « Enregistrer une avance » pour un versement anticipé."
                  compact
                />
              )}

              {clientBulkClientId && !clientDebtLoading && clientDebtInfo
                && parseFloat(clientDebtInfo.total_due || 0) <= 0.005
                && (clientDebtInfo.advance_balance > 0.005) && (
                <p className="bmb-page-hint">
                  Aucune dette — crédit d&apos;avance disponible :{' '}
                  <strong>{formatGNF(clientDebtInfo.advance_balance)}</strong>
                </p>
              )}
            </div>
          </>
        )}

        {tab === 'ventes' && (
          <>
            <div className="bmb-filters-panel bmb-print-skip reglement-ventes-filters">
              <EncaissementPvSelect id="reglement-ventes-pv-select" />
            </div>

            <ReglementSearchBar
              id="reglement-ventes-search"
              label={searchLabel}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="table-main-toolbar bmb-print-skip">
              <h3>{
                filterVentes === 'solde' ? 'Ventes à encaisser'
                  : filterVentes === 'credit' ? 'Crédit client — dettes après vente'
                  : filterVentes === 'en_cours' ? 'Paniers en cours'
                  : filterVentes === 'finalise' ? 'Paniers soldés'
                  : 'Tous les paniers'
              }</h3>
              <div className="toolbar-actions">
                <select className="filter-select" value={filterVentes} onChange={(e) => setFilterVentes(e.target.value)}>
                  <option value="solde">À encaisser</option>
                  <option value="credit">Crédit client</option>
                  <option value="en_cours">En cours</option>
                  <option value="finalise">Soldés</option>
                  <option value="tous">Tous (hors crédit)</option>
                </select>
                <select
                  className="filter-select"
                  value={filterPeriode}
                  onChange={(e) => setFilterPeriode(e.target.value)}
                  aria-label="Période"
                >
                  <option value="all">Toutes dates</option>
                  <option value="today">Aujourd&apos;hui</option>
                  <option value="yesterday">Hier</option>
                </select>
                <button type="button" className="btn btn-primary" onClick={refresh}>Actualiser</button>
                <button type="button" className="btn btn-secondary" onClick={handlePrint}>Imprimer</button>
                <button type="button" className="btn btn-secondary" onClick={exportReportPdf}>Exporter PDF</button>
              </div>
            </div>

            {cartsTruncated && (
              <p className="bmb-page-hint bmb-page-hint--warning bmb-print-skip">
                Liste tronquée — affinez la période ou la recherche pour voir tous les paniers.
              </p>
            )}

            {loading ? (
              <TableSkeleton rows={6} columns={4} />
            ) : (
              <ResponsiveDataView
                className="reglement-ventes-data"
                cards={
                  ventesRows.length === 0 ? (
                    <EmptyState
                      icon="💳"
                      title={search.trim() ? 'Aucun panier trouvé' : 'Aucun panier'}
                      description={search.trim()
                        ? 'Essayez un autre terme ou changez le filtre.'
                        : (filterVentes === 'credit'
                          ? 'Aucun crédit client — consultez Dettes & créances.'
                          : 'Aucun panier à afficher pour ce filtre.')}
                      compact
                    />
                  ) : ventesRows.map((c) => {
                    const st = cartEncaissementStatus(c);
                    const reste = cartResteAPayer(c);
                    return (
                      <DataCard
                        key={c.id}
                        title={c.cart_number}
                        subtitle={`${c.client_name || 'Sans client'} · ${cartDateTime(c)}`}
                        badge={<span className={`badge badge-${st.badge}`}>{st.label}</span>}
                        fields={[
                          { label: 'Total', value: formatGNF(c.total_amount), strong: true },
                          { label: 'Encaissé', value: formatGNF(c.amount_paid) },
                          {
                            label: 'Reste',
                            value: reste > 0.005
                              ? formatGNF(reste)
                              : (cartMonnaie(c) > 0 ? `${formatGNF(cartMonnaie(c))} monnaie` : '—'),
                            strong: reste > 0.005,
                          },
                        ]}
                        actions={reste > 0.005 ? (
                          c.client_id ? (
                            <>
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => openClientEncaissement(c.client_id)}>
                                Encaisser client
                              </button>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCartPayment(c)}>
                                Ce panier
                              </button>
                            </>
                          ) : (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => openCartPayment(c)}>
                              Encaisser
                            </button>
                          )
                        ) : (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => viewCart(c)}>
                            Voir
                          </button>
                        )}
                      />
                    );
                  })
                }
                table={(
            <div className="bmb-data-table-wrap table-scroll bmb-table-scroll-contained bmb-print-skip">
              <table className="bmb-data-table table-full">
                <thead>
                  <tr>
                    <th>N° Panier</th><th>Client</th><th>Date et heure</th><th>Total</th><th>Encaissé</th><th>Reste à payer</th>
                    <th>Statut</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {ventesRows.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      {search.trim()
                        ? 'Aucun panier pour cette recherche'
                        : filterVentes === 'credit'
                          ? 'Aucun crédit client — voir Dettes & créances'
                          : 'Aucun panier'}
                    </td></tr>
                  ) : ventesRows.map((c) => {
                    const st = cartEncaissementStatus(c);
                    const reste = cartResteAPayer(c);
                    return (
                    <tr key={c.id} className={selected?.id === c.id ? 'row-selected' : ''}>
                      <td><strong>{c.cart_number}</strong></td>
                      <td>{c.client_name || '—'}</td>
                      <td>{cartDateTime(c)}</td>
                      <td>{formatGNF(c.total_amount)}</td>
                      <td>{formatGNF(c.amount_paid)}</td>
                      <td>
                        {reste > 0.005
                          ? formatGNF(reste)
                          : cartMonnaie(c) > 0
                            ? `— (${formatGNF(cartMonnaie(c))} monnaie)`
                            : '—'}
                      </td>
                      <td>
                        <span className={`badge badge-${st.badge}`}>{st.label}</span>
                      </td>
                      <td className="actions-cell">
                        {reste > 0.005 ? (
                          c.client_id ? (
                            <>
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => openClientEncaissement(c.client_id)}>Encaisser client</button>
                              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openCartPayment(c)}>Ce panier</button>
                            </>
                          ) : (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => openCartPayment(c)}>Encaisser</button>
                          )
                        ) : (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => viewCart(c)}>Voir</button>
                        )}
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
                )}
              />
            )}

            {panelMode === 'view' && selected && (
              <div className="inline-form-panel bmb-print-skip">
                <div className="inline-form-panel-header">
                  <h3>Détail — {selected.cart_number}</h3>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closePanel}>×</button>
                </div>
                <div className="cart-detail-summary">
                  <p>
                    Client : <strong>{selected.client_name || '—'}</strong>
                    {' · '}
                    Vendeur : <strong>{selected.seller_name || '—'}</strong>
                    {' · '}
                    Date : <strong>{cartDateTime(selected)}</strong>
                  </p>
                  <p>
                    Total : <strong>{formatGNF(selected.total_amount)}</strong>
                    {' · '}
                    Encaissé : <strong>{formatGNF(selected.amount_paid)}</strong>
                    {' · '}
                    Reste : <strong>{formatGNF(cartResteAPayer(selected))}</strong>
                    {' · '}
                    Statut : <span className={`badge badge-${cartEncaissementStatus(selected).badge}`}>{cartEncaissementStatus(selected).label}</span>
                  </p>
                </div>
                {selected.lines?.length > 0 && (
                  <div className="bmb-data-table-wrap table-scroll" style={{ marginTop: '0.75rem' }}>
                    <table className="bmb-data-table table-full">
                      <thead>
                        <tr><th>Produit</th><th>Qté</th><th>P.U.</th><th>Total</th></tr>
                      </thead>
                      <tbody>
                        {selected.lines.map((l) => (
                          <tr key={l.id}>
                            <td>{l.product_name || l.designation || '—'}</td>
                            <td>{l.quantity}</td>
                            <td>{formatGNF(l.unit_price)}</td>
                            <td>{formatGNF(l.line_total ?? (l.quantity * l.unit_price))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {tab === 'bc' && (
          <>
            <ReglementSearchBar
              id="reglement-bc-search"
              label={searchLabel}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="table-main-toolbar bmb-print-skip">
              <h3>{bcFilterLabel}</h3>
              <div className="toolbar-actions">
                <select className="filter-select" value={filterBc} onChange={(e) => setFilterBc(e.target.value)}>
                  <option value="solde">À encaisser</option>
                  <option value="en_cours">En cours</option>
                  <option value="finalise">Soldés</option>
                  <option value="tous">Tous</option>
                </select>
                <button type="button" className="btn btn-primary" onClick={refresh}>Actualiser</button>
                <button type="button" className="btn btn-secondary" onClick={handlePrint}>Imprimer</button>
                <button type="button" className="btn btn-secondary" onClick={exportReportPdf}>Exporter PDF</button>
              </div>
            </div>

            {loading ? (
              <TableSkeleton rows={5} columns={4} />
            ) : (
              <ResponsiveDataView
                cards={
                  bcRows.length === 0 ? (
                    <EmptyState
                      icon="📋"
                      title={search.trim() ? 'Aucun bon trouvé' : 'Aucun bon de commande'}
                      description="Modifiez le filtre ou actualisez la liste."
                      compact
                    />
                  ) : bcRows.map((o) => {
                    const reste = bcResteAPayer(o);
                    const st = purchaseOrderEncaissementStatus(o);
                    return (
                      <DataCard
                        key={o.id}
                        title={o.order_number}
                        subtitle={o.client_name || 'Sans client'}
                        badge={<span className={`badge badge-${st.badge}`}>{st.label}</span>}
                        fields={[
                          { label: 'Total', value: formatGNF(o.total_amount), strong: true },
                          { label: 'Encaissé', value: formatGNF(o.amount_paid || 0) },
                          { label: 'Reste', value: reste > 0.005 ? formatGNF(reste) : '—', strong: reste > 0.005 },
                          { label: 'Date', value: formatDate(o.finalized_at || o.created_at) },
                        ]}
                        actions={reste > 0.005 ? (
                          <>
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => openBcPayment(o)}>Encaisser</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openBcPreview(o)}>Bon</button>
                          </>
                        ) : (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openBcPreview(o)}>Voir</button>
                        )}
                      />
                    );
                  })
                }
                table={(
            <div className="bmb-data-table-wrap table-scroll bmb-print-skip">
              <table className="bmb-data-table table-full">
                <thead>
                  <tr><th>N° BC</th><th>Client</th><th>Total</th><th>Encaissé</th><th>Reste</th><th>Statut</th><th>Date</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {bcRows.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      {search.trim() ? 'Aucun bon pour cette recherche' : 'Aucun bon'}
                    </td></tr>
                  ) : bcRows.map((o) => {
                    const reste = bcResteAPayer(o);
                    const st = purchaseOrderEncaissementStatus(o);
                    return (
                    <tr key={o.id} className={selected?.id === o.id ? 'row-selected' : ''}>
                      <td><strong>{o.order_number}</strong></td>
                      <td>{o.client_name || '—'}</td>
                      <td>{formatGNF(o.total_amount)}</td>
                      <td>{formatGNF(o.amount_paid || 0)}</td>
                      <td>{reste > 0.005 ? formatGNF(reste) : '—'}</td>
                      <td>
                        <span className={`badge badge-${st.badge}`}>
                          {st.label}
                        </span>
                      </td>
                      <td>{formatDate(o.finalized_at || o.created_at)}</td>
                      <td className="actions-cell">
                        {reste > 0.005 ? (
                          <>
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => openBcPayment(o)}>Encaisser</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openBcPreview(o)}>Bon</button>
                          </>
                        ) : (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => openBcPreview(o)}>Voir</button>
                        )}
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
                )}
              />
            )}

          </>
        )}

        {tab === 'situation' && (
          <>
            <ReglementSearchBar
              id="reglement-situation-search"
              label={searchLabel}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="table-main-toolbar bmb-print-skip">
              <h3>Dettes clients</h3>
              <div className="toolbar-actions">
                <select className="filter-select" value={filterDebtsOnly ? 'debts' : 'all'} onChange={(e) => setFilterDebtsOnly(e.target.value === 'debts')}>
                  <option value="debts">Dettes en cours</option>
                  <option value="all">Tous les enregistrements</option>
                </select>
                <select className="filter-select" value={filterSettlementType} onChange={(e) => setFilterSettlementType(e.target.value)}>
                  <option value="">Toutes les dettes client</option>
                  <option value="creance_commerciale">Dettes paniers / ventes</option>
                  <option value="dette_commerciale">Dettes manuelles</option>
                  <option value="creance_externe">Créances externes</option>
                  <option value="dette_externe">Dettes externes (boutique)</option>
                </select>
                <button type="button" className="btn btn-accent" onClick={openAddSettlement}>+ Ajouter</button>
                <button type="button" className="btn btn-primary" onClick={refresh}>Actualiser</button>
                <button type="button" className="btn btn-secondary" onClick={handlePrint}>Imprimer</button>
                <button type="button" className="btn btn-secondary" onClick={exportReportPdf}>Exporter PDF</button>
              </div>
            </div>

            {summary.length > 0 && (
              <div className="reglement-summary-row bmb-print-skip">
                {summary.map((s) => (
                  <div key={s.settlement_type} className="reglement-summary-item">
                    <span>{SETTLEMENT_LABELS[s.settlement_type] || s.settlement_type}</span>
                    <strong>{formatGNF(s.total_balance)}</strong>
                  </div>
                ))}
              </div>
            )}

            {loading ? (
              <TableSkeleton rows={5} columns={4} />
            ) : (
              <ResponsiveDataView
                cards={
                  settlementRows.length === 0 ? (
                    <EmptyState
                      icon="📊"
                      title="Aucune dette"
                      description="Les ventes à crédit apparaissent ici après finalisation."
                      compact
                    />
                  ) : settlementRows.map((s) => (
                    <DataCard
                      key={s.id}
                      title={s.client_name || 'Sans client'}
                      subtitle={s.sale_cart_number || s.settlement_number || s.notes || '—'}
                      badge={<span className="badge">{settlementStatusLabel(s.status)}</span>}
                      fields={[
                        { label: 'Type', value: SETTLEMENT_LABELS[s.settlement_type] || s.settlement_type },
                        { label: 'Montant', value: formatGNF(s.amount) },
                        { label: 'Payé', value: formatGNF(s.amount_paid) },
                        { label: 'Solde', value: formatGNF(s.balance), strong: true },
                      ]}
                      actions={parseFloat(s.balance) > 0 ? (
                        isClientUnifiedDebt(s) ? (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => openClientEncaissement(s.client_id)}>
                            Encaisser client
                          </button>
                        ) : (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => openSettlementPayment(s)}>Régler</button>
                        )
                      ) : (
                        <span className="bmb-amount--muted">Soldé</span>
                      )}
                    />
                  ))
                }
                table={(
            <div className="bmb-data-table-wrap table-scroll bmb-print-skip">
              <table className="bmb-data-table table-full">
                <thead>
                  <tr><th>Type</th><th>Client</th><th>Référence</th><th>Montant</th><th>Payé</th><th>Solde</th><th>Statut</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {settlementRows.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Aucune dette client — les ventes à crédit apparaissent ici après finalisation</td></tr>
                  ) : settlementRows.map((s) => (
                    <tr key={s.id} className={selected?.id === s.id ? 'row-selected' : ''}>
                      <td>{SETTLEMENT_LABELS[s.settlement_type] || s.settlement_type}</td>
                      <td><strong>{s.client_name || '—'}</strong></td>
                      <td>{s.sale_cart_number || s.notes || s.settlement_number || '—'}</td>
                      <td>{formatGNF(s.amount)}</td>
                      <td>{formatGNF(s.amount_paid)}</td>
                      <td><strong>{formatGNF(s.balance)}</strong></td>
                      <td>{settlementStatusLabel(s.status)}</td>
                      <td className="actions-cell">
                        {parseFloat(s.balance) > 0 ? (
                          isClientUnifiedDebt(s) ? (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => openClientEncaissement(s.client_id)}>Encaisser client</button>
                          ) : (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => openSettlementPayment(s)}>Régler</button>
                          )
                        ) : (
                          <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>Soldé</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
                )}
              />
            )}
          </>
        )}

        <div className="bmb-print-only">
          <div ref={printRef}>
            {tab === 'ventes' && (
              <PrintReport
                store={store}
                title="Règlement des ventes"
                subtitle={ventesFilterLabel}
                date={new Date()}
                filters={ventesReportFilters}
                columns={VENTES_COLUMNS}
                rows={ventesReportRows}
                footRows={ventesReportFoot}
                emptyMessage="Aucun panier"
              />
            )}
            {tab === 'bc' && (
              <PrintReport
                store={store}
                title="Règlement des bons de commande"
                subtitle={bcFilterLabel}
                date={new Date()}
                filters={bcReportFilters}
                columns={BC_COLUMNS}
                rows={bcReportRows}
                footRows={bcReportFoot}
                emptyMessage="Aucun bon de commande"
              />
            )}
            {tab === 'situation' && (
              <PrintReport
                store={store}
                title="Dettes et créances"
                subtitle="Situation financière"
                date={new Date()}
                filters={settlementReportFilters}
                columns={SETTLEMENT_COLUMNS}
                rows={settlementReportRows}
                footRows={settlementReportFoot}
                emptyMessage="Aucun enregistrement"
              />
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'none' }}>
        {lastBulkReceipt && (
          <PrintDocument
            ref={bulkReceiptPrintRef}
            {...buildBulkReceiptDocument({ result: lastBulkReceipt, store })}
          />
        )}
      </div>

      <PrintPreviewModal
        open={Boolean(bcPreviewOrder && bcPrintDoc)}
        onClose={() => setBcPreviewOrder(null)}
        title={bcPreviewOrder ? `Bon de commande — ${bcPreviewOrder.order_number}` : 'Aperçu'}
        orientation={bcPreviewOrientation}
        onOrientationChange={setBcPreviewOrientation}
        printRef={bcDocPrintRef}
        onExportPdf={() => bcPreviewOrder && downloadPurchaseOrderPdf(bcPreviewOrder, store)}
      >
        {bcPrintDoc && <PrintDocument {...bcPrintDoc} />}
      </PrintPreviewModal>

      <EncaissementModal
        open={panelMode === 'cart' && Boolean(selected)}
        onClose={closePanel}
        title={selected?.cart_number || 'Panier'}
        subtitle={selected ? `${selected.client_name || 'Sans client'} · ${cartDateTime(selected)}` : ''}
        stats={selected ? [
          { label: 'Total', value: formatGNF(selected.total_amount) },
          { label: 'Encaissé', value: formatGNF(selected.amount_paid) },
          { label: 'Reste', value: formatGNF(cartResteAPayer(selected)), variant: 'due' },
        ] : []}
        amount={cartPayment.amount_paid}
        onAmountChange={(v) => setCartPayment({ ...cartPayment, amount_paid: v })}
        paymentMode={cartPayment.payment_mode}
        onPaymentModeChange={(v) => setCartPayment({ ...cartPayment, payment_mode: v })}
        onSubmit={recordCartPayment}
        submitLabel="Encaisser"
        submitDisabled={!cartPayment.amount_paid || parseFloat(cartPayment.amount_paid) <= 0}
        maxAmount={selected ? cartResteAPayer(selected) : 0}
        hint={selected?.client_id
          ? 'Pour régler toutes les dettes du client (paniers + manuelles) en une fois, utilisez l\'onglet Encaissement client.'
          : selected?.status === 'finalise'
            ? 'Paiement lié à la créance — la dette disparaît automatiquement quand le panier est soldé.'
            : 'Encaissement sur panier en cours — finalisez la vente à la caisse une fois le règlement terminé.'}
      />

      <EncaissementModal
        open={panelMode === 'bc' && Boolean(selected)}
        onClose={closePanel}
        title={selected?.order_number || 'Bon de commande'}
        subtitle={selected ? `${selected.client_name || 'Sans client'} · ${formatDate(selected.created_at)}` : ''}
        stats={selected ? [
          { label: 'Total', value: formatGNF(selected.total_amount) },
          { label: 'Encaissé', value: formatGNF(selected.amount_paid || 0) },
          { label: 'Reste', value: formatGNF(bcResteAPayer(selected)), variant: 'due' },
        ] : []}
        amount={bcPayment.amount_paid}
        onAmountChange={(v) => setBcPayment({ ...bcPayment, amount_paid: v })}
        paymentMode={bcPayment.payment_mode}
        onPaymentModeChange={(v) => setBcPayment({ ...bcPayment, payment_mode: v })}
        onSubmit={recordBcPayment}
        submitLabel="Encaisser"
        submitDisabled={!bcPayment.amount_paid || parseFloat(bcPayment.amount_paid) <= 0}
        maxAmount={selected ? bcResteAPayer(selected) : 0}
        hint="Le bon sera finalisé automatiquement lorsque le paiement sera complet."
      >
        {selected && (
          <div className="bmb-encaisse-modal__extras">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openBcPreview(selected)}>Aperçu bon</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => printBcOrder(selected)}>Imprimer</button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                try {
                  const data = bcPreviewOrder?.id === selected.id ? bcPreviewOrder : await loadBcForDoc(selected.id);
                  await downloadPurchaseOrderPdf(data, store);
                } catch {
                  setMsg('Erreur export PDF');
                }
              }}
            >
              Exporter PDF
            </button>
          </div>
        )}
      </EncaissementModal>

      <EncaissementModal
        open={panelMode === 'settlement' && Boolean(selected)}
        onClose={closePanel}
        title={selected?.client_name || 'Règlement'}
        subtitle={selected?.sale_cart_number || selected?.settlement_number || selected?.notes || 'Dette / créance'}
        stats={selected ? [
          { label: 'Montant', value: formatGNF(selected.amount) },
          { label: 'Payé', value: formatGNF(selected.amount_paid) },
          { label: 'Solde', value: formatGNF(selected.balance), variant: 'due' },
        ] : []}
        amount={paymentForm.amount}
        onAmountChange={(v) => setPaymentForm({ ...paymentForm, amount: v })}
        paymentMode={paymentForm.payment_mode}
        onPaymentModeChange={(v) => setPaymentForm({ ...paymentForm, payment_mode: v })}
        onSubmit={paySettlement}
        submitLabel="Enregistrer le paiement"
        submitDisabled={!paymentForm.amount || parseFloat(paymentForm.amount) <= 0}
        maxAmount={selected ? parseFloat(selected.balance || 0) : 0}
        hint="Saisissez le montant de ce versement sur la dette ou créance sélectionnée."
      />

      <EncaissementModal
        open={clientBulkOpen}
        onClose={() => setClientBulkOpen(false)}
        title="Encaissement global"
        subtitle={selectedBulkClient
          ? (showClientPv && clientPvShort(selectedBulkClient)
            ? `${selectedBulkClient.name} · ${clientPvShort(selectedBulkClient)}`
            : selectedBulkClient.name)
          : 'Réparti automatiquement sur toutes les dettes du client'}
        stats={parseFloat(clientDebtInfo?.total_due || 0) > 0.005 ? [
          { label: 'Dette totale', value: formatGNF(clientDebtInfo.total_due), variant: 'due' },
        ] : []}
        amount={clientBulkPayment.amount_paid}
        onAmountChange={(v) => setClientBulkPayment({ ...clientBulkPayment, amount_paid: v })}
        paymentMode={clientBulkPayment.payment_mode}
        onPaymentModeChange={(v) => setClientBulkPayment({ ...clientBulkPayment, payment_mode: v })}
        onSubmit={async () => {
          await recordClientBulkPayment();
          setClientBulkOpen(false);
        }}
        submitLabel="Encaisser tout"
        submitDisabled={!clientBulkClientId || parseFloat(clientDebtInfo?.total_due || 0) <= 0.005 || !clientBulkPayment.amount_paid || parseFloat(clientBulkPayment.amount_paid) <= 0}
        maxAmount={clientDebtInfo?.total_due ? parseFloat(clientDebtInfo.total_due) : 0}
        hint={parseFloat(clientDebtInfo?.total_due || 0) > 0.005
          ? 'Le montant sera réparti sur les paniers impayés puis sur les dettes manuelles.'
          : 'Sélectionnez un client avec une dette sur l\'écran principal.'}
      />

      <EncaissementModal
        open={clientAdvanceOpen}
        onClose={() => setClientAdvanceOpen(false)}
        title="Avance client"
        subtitle={selectedBulkClient
          ? (showClientPv && clientPvShort(selectedBulkClient)
            ? `${selectedBulkClient.name} · ${clientPvShort(selectedBulkClient)}`
            : selectedBulkClient.name)
          : ''}
        stats={clientDebtInfo?.advance_balance > 0.005 ? [
          { label: 'Crédit actuel', value: formatGNF(clientDebtInfo.advance_balance), variant: 'due' },
        ] : []}
        amount={clientAdvancePayment.amount_paid}
        onAmountChange={(v) => setClientAdvancePayment({ ...clientAdvancePayment, amount_paid: v })}
        paymentMode={clientAdvancePayment.payment_mode}
        onPaymentModeChange={(v) => setClientAdvancePayment({ ...clientAdvancePayment, payment_mode: v })}
        onSubmit={async () => {
          await recordClientAdvance();
        }}
        submitLabel="Enregistrer l'avance"
        submitDisabled={!clientBulkClientId || !clientAdvancePayment.amount_paid || parseFloat(clientAdvancePayment.amount_paid) <= 0}
        hint="L'avance est créditée sur le compte client et pourra être utilisée automatiquement à la prochaine vente."
      >
        <div className="bmb-encaisse-modal__extras" style={{ paddingTop: '0.75rem' }}>
          <div className="form-group" style={{ width: '100%', margin: 0 }}>
            <label htmlFor="client-advance-notes">Note (optionnel)</label>
            <input
              id="client-advance-notes"
              type="text"
              className="search-input search-input--full"
              placeholder="Ex. avance pour commande mars…"
              value={clientAdvancePayment.notes}
              onChange={(e) => setClientAdvancePayment({ ...clientAdvancePayment, notes: e.target.value })}
            />
          </div>
        </div>
      </EncaissementModal>

      <BmbFormModal
        open={showAddSettlement && panelMode === 'add'}
        onClose={closeSettlementModal}
        title="Nouvelle dette / créance"
        titleId="settlement-form-title"
        panelClassName="bmb-settlement-form-panel"
      >
        <p className="bmb-page-hint bmb-settlement-form-panel__intro">
          Enregistrement manuel hors vente en caisse. Les créances issues des paniers impayés sont créées automatiquement.
        </p>

        <div className="vente-form-grid bmb-settlement-form">
          <div className="form-group vente-form-grid__full">
            <label htmlFor="settlement-type">Type de dossier</label>
            <select
              id="settlement-type"
              className="filter-select"
              value={settlementForm.settlement_type}
              onChange={(e) => setSettlementForm({ ...settlementForm, settlement_type: e.target.value })}
            >
              {MANUAL_SETTLEMENT_TYPES.map((k) => (
                <option key={k} value={k}>{SETTLEMENT_LABELS[k]}</option>
              ))}
            </select>
            {SETTLEMENT_TYPE_HINTS[settlementForm.settlement_type] && (
              <p className="bmb-form-field-hint">
                {SETTLEMENT_TYPE_HINTS[settlementForm.settlement_type]}
              </p>
            )}
          </div>

          <div className="form-group vente-form-grid__full">
            <SearchSelect
              label={settlementForm.settlement_type === 'dette_commerciale' ? 'Client' : 'Client / tiers'}
              value={settlementForm.client_id}
              selectedOption={selectedClientOption}
              onChange={(id, opt) => {
                setSettlementForm({ ...settlementForm, client_id: id || '' });
                setSettlementClientOption(opt || null);
              }}
              loadOptions={settlementClientSelectOptions}
              listMaxHeight={320}
              placeholder="Rechercher un client…"
              allowClear
              clearLabel="— Aucun —"
              required={settlementForm.settlement_type === 'dette_commerciale'}
              hint={
                settlementForm.settlement_type === 'dette_commerciale'
                  ? 'Obligatoire pour une dette commerciale.'
                  : 'Optionnel pour les dettes ou créances externes.'
              }
            />
          </div>

          <div className="form-group">
            <label htmlFor="settlement-amount">Montant (GNF)</label>
            <input
              id="settlement-amount"
              type="text"
              inputMode="decimal"
              placeholder="ex. 500 000"
              value={settlementForm.amount}
              onChange={(e) => setSettlementForm({ ...settlementForm, amount: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveNewSettlement();
                }
              }}
            />
            <p className="bmb-form-field-hint">Montant total à enregistrer pour ce dossier.</p>
          </div>

          <div className="form-group">
            <label htmlFor="settlement-due">Échéance</label>
            <input
              id="settlement-due"
              type="date"
              value={settlementForm.due_date}
              onChange={(e) => setSettlementForm({ ...settlementForm, due_date: e.target.value })}
            />
            <p className="bmb-form-field-hint">Date limite de paiement (facultatif).</p>
          </div>

          <div className="form-group vente-form-grid__full">
            <label htmlFor="settlement-notes">Notes / référence</label>
            <textarea
              id="settlement-notes"
              className="search-input search-input--full"
              rows={3}
              placeholder="Ex. facture fournisseur, motif, contact…"
              value={settlementForm.notes}
              onChange={(e) => setSettlementForm({ ...settlementForm, notes: e.target.value })}
            />
          </div>
        </div>

        <div className="btn-group" style={{ marginTop: '1.25rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={saveNewSettlement}
            disabled={settlementSaving}
          >
            {settlementSaving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={closeSettlementModal} disabled={settlementSaving}>
            Annuler
          </button>
        </div>
      </BmbFormModal>
    </>
  );
}
