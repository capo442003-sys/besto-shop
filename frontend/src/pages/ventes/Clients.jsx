import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useSocket } from '../../hooks/useSocket';
import { CLIENT_TYPES, formatGNF, formatDate, paymentModeLabel, settlementStatusLabel, cartEncaissementStatus } from '../../utils/format';
import PrintReport from '../../components/PrintReport';
import PrintPreviewModal from '../../components/PrintPreviewModal';
import { downloadReportPdf, downloadMultiSectionReportPdf } from '../../utils/printReportPdf';
import { suggestPrintOrientation } from '../../utils/printOrientation';
import { useStoreSettings } from '../../context/StoreSettingsContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';
import { parseClientsListResponse } from '../../utils/clientsApi';
import { canAccessAllPvs, isPvScoped, pvDisplayLabel } from '../../utils/pvScope';
import { clientPvShort, shouldShowClientPv } from '../../utils/pvDisplay';
import { canAccessReglement } from '../../utils/sellerScope';
import { usePvFilter } from '../../context/PvFilterContext';
import PvFilterBar from '../../components/PvFilterBar';
import AlertBanner from '../../components/AlertBanner';
import BmbFormModal from '../../components/BmbFormModal';
import EncaissementModal from '../../components/EncaissementModal';
import EmptyState from '../../components/ui/EmptyState';
import TableSkeleton from '../../components/ui/TableSkeleton';
import ResponsiveDataView from '../../components/ui/ResponsiveDataView';
import DataCard from '../../components/ui/DataCard';

const emptyForm = { name: '', contact: '', address: '', client_type: 'particulier', delivery_point_id: '' };

const CLIENT_COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Nom' },
  { key: 'type', label: 'Type' },
  { key: 'contact', label: 'Contact' },
  { key: 'debt', label: 'Dette', align: 'right' },
  { key: 'address', label: 'Adresse' },
];

const HISTORY_CART_COLUMNS = [
  { key: 'cart_number', label: 'N° Panier' },
  { key: 'status', label: 'Statut' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'paid', label: 'Payé', align: 'right' },
  { key: 'due', label: 'Reste', align: 'right' },
  { key: 'date', label: 'Date' },
];

const HISTORY_PAYMENT_COLUMNS = [
  { key: 'cart_number', label: 'N° Panier' },
  { key: 'amount', label: 'Montant', align: 'right' },
  { key: 'mode', label: 'Mode' },
  { key: 'date', label: 'Date' },
];

const HISTORY_SETTLEMENT_COLUMNS = [
  { key: 'type', label: 'Type' },
  { key: 'amount', label: 'Montant', align: 'right' },
  { key: 'paid', label: 'Payé', align: 'right' },
  { key: 'balance', label: 'Solde', align: 'right' },
  { key: 'status', label: 'Statut' },
];

const SETTLEMENT_LABELS = {
  creance_commerciale: 'Dette client',
  dette_commerciale: 'Dette client',
  dette_externe: 'Dette externe',
  creance_externe: 'Créance externe',
};

function clientTypeLabel(value) {
  return CLIENT_TYPES.find((t) => t.value === value)?.label || value || '—';
}

export default function Clients() {
  const { can, user } = useAuth();
  const { store } = useStoreSettings();
  const [list, setList] = useState([]);
  const [debtSummary, setDebtSummary] = useState(null);
  const [listMeta, setListMeta] = useState(null);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDebtOnly, setFilterDebtOnly] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [historyClient, setHistoryClient] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState(null);
  const [orientation, setOrientation] = useState('portrait');
  const [deliveryPoints, setDeliveryPoints] = useState([]);
  const [misassigned, setMisassigned] = useState([]);
  const [loading, setLoading] = useState(true);
  const printRef = useRef(null);
  const nameInputRef = useRef(null);

  const canCreate = can('ventes', 'create');
  const canEdit = can('ventes', 'edit');
  const showReglement = canAccessReglement(user);
  const showClientPv = shouldShowClientPv(user);
  const [clientAdvanceOpen, setClientAdvanceOpen] = useState(false);
  const [clientAdvancePayment, setClientAdvancePayment] = useState({ amount_paid: '', payment_mode: 'especes', notes: '' });
  const [clientAdvanceInfo, setClientAdvanceInfo] = useState(null);
  const pvLocked = isPvScoped(user);
  const adminPvChoice = canAccessAllPvs(user);
  const pvFilter = usePvFilter();
  const confirm = useConfirm();
  const notify = useNotify();

  const load = useCallback(() => {
    const params = { search: search.trim() || undefined, ...pvFilter.queryParams };
    if (filterDebtOnly) params.debt_only = 'true';
    setLoading(true);
    return api.get('/clients', { params })
      .then((r) => {
        const { clients, summary, listMeta: meta } = parseClientsListResponse(r.data);
        setList(clients);
        setDebtSummary(summary);
        setListMeta(meta);
      })
      .finally(() => setLoading(false));
  }, [search, filterDebtOnly, pvFilter.queryParams]);

  useEffect(() => { load(); }, [load]);
  useSocket((e) => { if (e === 'client:updated') load(); });

  useEffect(() => {
    api.get('/delivery-points').then((r) => setDeliveryPoints(r.data || [])).catch(() => {});
    if (adminPvChoice) {
      api.get('/clients/review/misassigned').then((r) => setMisassigned(r.data || [])).catch(() => {});
    }
  }, [adminPvChoice]);

  const focusNameField = () => {
    window.setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  useEffect(() => {
    if (showForm) focusNameField();
  }, [showForm]);

  const filteredList = useMemo(() => {
    if (!filterType) return list;
    return list.filter((c) => c.client_type === filterType);
  }, [list, filterType]);

  const filteredDebtTotal = useMemo(
    () => filteredList.reduce((sum, c) => sum + parseFloat(c.total_debt || 0), 0),
    [filteredList],
  );

  const filteredDebtCount = useMemo(
    () => filteredList.filter((c) => parseFloat(c.total_debt || 0) > 0.005).length,
    [filteredList],
  );

  const displayDebtTotal = useMemo(() => {
    if (!filterType && debtSummary) {
      return parseFloat(debtSummary.total_balance_due || 0);
    }
    return filteredDebtTotal;
  }, [filterType, debtSummary, filteredDebtTotal]);

  const displayDebtCount = useMemo(() => {
    if (!filterType && debtSummary) {
      return debtSummary.clients_with_debt || 0;
    }
    return filteredDebtCount;
  }, [filterType, debtSummary, filteredDebtCount]);

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm);
    setError('');
  };

  const openAddForm = () => {
    closeForm();
    const defaultPv = user?.delivery_point_id
      ? String(user.delivery_point_id)
      : (deliveryPoints[0]?.id ? String(deliveryPoints[0].id) : '');
    setForm({ ...emptyForm, delivery_point_id: defaultPv });
    setShowForm(true);
  };

  const validateForm = () => {
    if (!form.name?.trim()) return 'Le nom du client est requis';
    if (form.contact && !/^\d{9}$/.test(form.contact)) {
      return 'Le contact doit contenir exactement 9 chiffres (ou laissez vide)';
    }
    return null;
  };

  const save = async () => {
    setError('');
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!editId && !pvLocked && adminPvChoice && !form.delivery_point_id) {
      setError('Sélectionnez un point de vente');
      return;
    }
    const ok = await confirm({
      title: editId ? 'Modifier le client' : 'Ajouter le client',
      message: editId
        ? `Enregistrer les modifications pour « ${form.name.trim()} » ?`
        : `Créer le client « ${form.name.trim()} » ?`,
      confirmLabel: 'Enregistrer',
    });
    if (!ok) return;
    try {
      if (editId) {
        await api.put(`/clients/${editId}`, form);
        notify.success('Client modifié avec succès');
        closeForm();
      } else {
        const payload = {
          name: form.name,
          contact: form.contact,
          address: form.address,
          client_type: form.client_type,
          delivery_point_id: pvLocked
            ? user.delivery_point_id
            : (form.delivery_point_id || undefined),
        };
        await api.post('/clients', payload);
        notify.success('Client ajouté — code généré automatiquement');
        setForm({ ...emptyForm, delivery_point_id: form.delivery_point_id });
        setEditId(null);
        setError('');
        focusNameField();
      }
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Erreur lors de l\'enregistrement');
    }
  };

  const edit = (c) => {
    setEditId(c.id);
    setForm({ name: c.name, contact: c.contact || '', address: c.address || '', client_type: c.client_type });
    setError('');
    setShowForm(true);
  };

  const transferClient = async (clientId, deliveryPointId) => {
    if (!deliveryPointId) return;
    const ok = await confirm({
      title: 'Transférer le client',
      message: 'Déplacer ce client vers le point de vente sélectionné ?',
      confirmLabel: 'Transférer',
    });
    if (!ok) return;
    try {
      await api.post(`/clients/${clientId}/transfer-pv`, { delivery_point_id: deliveryPointId });
      notify.success('Client transféré');
      load();
      api.get('/clients/review/misassigned').then((r) => setMisassigned(r.data || [])).catch(() => {});
    } catch (e) {
      setError(apiErrorMessage(e, 'Transfert impossible'));
    }
  };

  const remove = async (id) => {
    const ok = await confirm({
      title: 'Désactiver le client',
      message: 'Ce client sera désactivé et n\'apparaîtra plus dans les listes actives. Continuer ?',
      confirmLabel: 'Désactiver',
      variant: 'danger',
    });
    if (!ok) return;
    setError('');
    try {
      await api.delete(`/clients/${id}`);
      notify.success('Client désactivé');
      if (String(historyClient?.id) === String(id)) {
        setHistoryClient(null);
        setHistory(null);
        setClientAdvanceInfo(null);
        setClientAdvanceOpen(false);
      }
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible de désactiver le client'));
    }
  };

  const loadClientAdvanceInfo = useCallback(async (clientId) => {
    if (!clientId || !showReglement) {
      setClientAdvanceInfo(null);
      return null;
    }
    try {
      const { data } = await api.get(`/sales/clients/${clientId}/advance-balance`);
      setClientAdvanceInfo(data);
      return data;
    } catch {
      setClientAdvanceInfo(null);
      return null;
    }
  }, [showReglement]);

  const selectClient = async (c) => {
    if (!c) return;
    setHistoryClient(c);
    setHistory(null);
    setClientAdvanceInfo(null);
    setError('');
    setHistoryLoading(true);
    try {
      const [historyRes, advanceData] = await Promise.all([
        api.get(`/clients/${c.id}/history`),
        showReglement
          ? api.get(`/sales/clients/${c.id}/advance-balance`).catch(() => ({ data: null }))
          : Promise.resolve({ data: null }),
      ]);
      setHistory(historyRes.data);
      if (advanceData.data) {
        setClientAdvanceInfo(advanceData.data);
        setHistoryClient((prev) => (
          prev?.id === c.id
            ? { ...prev, advance_balance: advanceData.data.advance_balance }
            : prev
        ));
      }
    } catch (e) {
      setHistoryClient(null);
      setError(apiErrorMessage(e, 'Impossible de charger l\'historique client'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const clearSelectedClient = () => {
    setHistoryClient(null);
    setHistory(null);
    setClientAdvanceInfo(null);
    setClientAdvanceOpen(false);
  };

  const openClientAdvanceModal = () => {
    if (!historyClient?.id) return;
    setClientAdvancePayment({ amount_paid: '', payment_mode: 'especes', notes: '' });
    setClientAdvanceOpen(true);
  };

  const recordClientAdvance = async () => {
    if (!historyClient?.id) return;
    const installment = parseFloat(clientAdvancePayment.amount_paid || 0);
    if (!installment || installment <= 0) {
      setError('Saisissez le montant de l\'avance');
      return;
    }
    const ok = await confirm({
      title: 'Enregistrer une avance',
      message: `Enregistrer une avance de ${formatGNF(installment)} pour ${historyClient.name} ? Ce crédit pourra être utilisé lors des prochains achats.`,
      confirmLabel: 'Enregistrer l\'avance',
    });
    if (!ok) return;
    try {
      const { data } = await api.post(`/sales/clients/${historyClient.id}/advance-payment`, clientAdvancePayment);
      setError('');
      notify.success(data.message || 'Avance enregistrée');
      setClientAdvanceOpen(false);
      setClientAdvancePayment({ amount_paid: '', payment_mode: 'especes', notes: '' });
      const advanceBalance = parseFloat(data.advance_balance ?? 0);
      setHistoryClient((prev) => (
        prev ? { ...prev, advance_balance: advanceBalance } : prev
      ));
      await loadClientAdvanceInfo(historyClient.id);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Erreur enregistrement avance'));
    }
  };

  const displayAdvanceBalance = useMemo(() => {
    const fromInfo = parseFloat(clientAdvanceInfo?.advance_balance ?? NaN);
    if (Number.isFinite(fromInfo)) return fromInfo;
    return parseFloat(historyClient?.advance_balance || 0);
  }, [clientAdvanceInfo, historyClient]);

  const historyCartTotals = useMemo(() => {
    const s = history?.summaries?.carts;
    if (s) {
      return {
        count: s.count || 0,
        total: parseFloat(s.total_amount || 0),
        paid: parseFloat(s.amount_paid || 0),
        due: parseFloat(s.balance_due || 0),
      };
    }
    const carts = history?.carts || [];
    return {
      count: carts.length,
      total: carts.reduce((acc, c) => acc + parseFloat(c.total_amount || 0), 0),
      paid: carts.reduce((acc, c) => acc + parseFloat(c.amount_paid || 0), 0),
      due: carts.reduce((acc, c) => acc + parseFloat(c.balance_due || 0), 0),
    };
  }, [history]);

  const historyPaymentTotal = useMemo(() => {
    const s = history?.summaries?.payments;
    if (s) return parseFloat(s.total || 0);
    return (history?.payments || []).reduce((acc, p) => acc + parseFloat(p.amount || 0), 0);
  }, [history]);

  const historyPaymentCount = useMemo(() => {
    const s = history?.summaries?.payments;
    return s?.count ?? (history?.payments || []).length;
  }, [history]);

  const historyExternalBalance = useMemo(() => {
    const s = history?.summaries?.settlements;
    if (s) return parseFloat(s.balance || 0);
    return (history?.settlements || []).reduce((acc, x) => acc + parseFloat(x.balance || 0), 0);
  }, [history]);

  const historyReceivableBreakdown = useMemo(() => {
    const receivable = history?.summaries?.receivable;
    if (!receivable) return null;
    const cart = parseFloat(receivable.cart_balance_due || 0);
    const manual = parseFloat(receivable.external_balance_due || 0);
    const total = parseFloat(receivable.total_balance_due || 0);
    if (total <= 0.005 || (cart <= 0.005 && manual <= 0.005)) return null;
    const parts = [];
    if (cart > 0.005) parts.push(`paniers ${formatGNF(cart)}`);
    if (manual > 0.005) parts.push(`manuelles ${formatGNF(manual)}`);
    return parts.length ? `Dont ${parts.join(' + ')}` : null;
  }, [history]);

  const historySettlementCount = useMemo(() => {
    const s = history?.summaries?.settlements;
    return s?.count ?? (history?.settlements || []).length;
  }, [history]);

  const clientReportFilters = useMemo(() => [
    { label: 'Type', value: filterType ? clientTypeLabel(filterType) : '' },
    { label: 'Créance', value: filterDebtOnly ? 'Clients avec solde uniquement' : '' },
    { label: 'Recherche', value: search.trim() ? `« ${search.trim()} »` : '' },
  ], [filterType, filterDebtOnly, search]);

  const clientReportRows = useMemo(() => filteredList.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    type: clientTypeLabel(c.client_type),
    contact: c.contact || '—',
    debt: parseFloat(c.total_debt || 0) > 0.005 ? formatGNF(c.total_debt) : '—',
    address: c.address || '—',
  })), [filteredList]);

  const clientReportFoot = useMemo(() => {
    if (!filteredList.length) return [];
    return [{
      cells: [
        { value: `Total : ${filteredList.length} client${filteredList.length > 1 ? 's' : ''}`, colSpan: 4 },
        { value: formatGNF(displayDebtTotal), align: 'right' },
        { value: '', colSpan: 1 },
      ],
    }];
  }, [filteredList, displayDebtTotal]);

  const historyCartRows = useMemo(() => (history?.carts || []).map((c) => {
    const st = cartEncaissementStatus(c);
    return {
      id: c.id,
      cart_number: c.cart_number,
      status: st.label,
      total: formatGNF(c.total_amount),
      paid: formatGNF(c.amount_paid),
      due: formatGNF(c.balance_due),
      date: formatDate(c.validated_at || c.created_at),
    };
  }), [history]);

  const historyPaymentRows = useMemo(() => (history?.payments || []).map((p) => ({
    id: p.id,
    cart_number: p.cart_number,
    amount: formatGNF(p.amount),
    mode: paymentModeLabel(p.payment_mode),
    date: formatDate(p.created_at),
  })), [history]);

  const historySettlementRows = useMemo(() => (history?.settlements || []).map((s) => ({
    id: s.id,
    type: SETTLEMENT_LABELS[s.settlement_type] || s.settlement_type,
    amount: formatGNF(s.amount),
    paid: formatGNF(s.amount_paid),
    balance: formatGNF(s.balance),
    status: settlementStatusLabel(s.status),
  })), [history]);

  const historyCartFoot = useMemo(() => (
    historyCartTotals.count
      ? [{
        cells: [
          { value: `Total (${historyCartTotals.count})`, colSpan: 2 },
          { value: formatGNF(historyCartTotals.total), align: 'right' },
          { value: formatGNF(historyCartTotals.paid), align: 'right' },
          { value: formatGNF(historyCartTotals.due), align: 'right' },
          { value: '' },
        ],
      }]
      : []
  ), [historyCartTotals]);

  const historyPaymentFoot = useMemo(() => (
    historyPaymentCount
      ? [{
        cells: [
          { value: `Total (${historyPaymentCount})` },
          { value: formatGNF(historyPaymentTotal), align: 'right' },
          { value: '', colSpan: 2 },
        ],
      }]
      : []
  ), [historyPaymentCount, historyPaymentTotal]);

  const historySettlementFoot = useMemo(() => (
    historySettlementCount
      ? [{
        cells: [
          { value: `Sous-total manuelles (${historySettlementCount})`, colSpan: 3 },
          { value: formatGNF(historyExternalBalance), align: 'right' },
          { value: '' },
        ],
      }]
      : []
  ), [historySettlementCount, historyExternalBalance]);

  const exportClientsPdf = useCallback(() => {
    downloadReportPdf({
      store,
      title: 'Liste des clients',
      subtitle: 'Répertoire clients BESTO SHOP',
      filters: clientReportFilters,
      head: CLIENT_COLUMNS.map((c) => c.label),
      body: clientReportRows.map((r) => CLIENT_COLUMNS.map((c) => r[c.key])),
      foot: filteredList.length
        ? [[`Total : ${filteredList.length} client${filteredList.length > 1 ? 's' : ''}`, '', '', '', '']]
        : [],
      filename: 'liste-clients.pdf',
      orientation,
    });
  }, [store, clientReportFilters, clientReportRows, filteredList.length, orientation]);

  const exportHistoryPdf = useCallback(() => {
    if (!historyClient || !history) return;
    downloadMultiSectionReportPdf({
      store,
      title: `Historique client — ${historyClient.name}`,
      subtitle: `Code ${historyClient.code}`,
      date: new Date(),
      filters: [
        { label: 'Type', value: clientTypeLabel(historyClient.client_type) },
        { label: 'Contact', value: historyClient.contact || '' },
      ],
      sections: [
        {
          title: 'Paniers / achats',
          head: HISTORY_CART_COLUMNS.map((c) => c.label),
          body: historyCartRows.map((r) => HISTORY_CART_COLUMNS.map((c) => r[c.key])),
          foot: historyCartTotals.count
            ? [[`Total (${historyCartTotals.count})`, '', formatGNF(historyCartTotals.total), formatGNF(historyCartTotals.paid), formatGNF(historyCartTotals.due), '']]
            : [],
          rightAlignCols: [2, 3, 4],
        },
        {
          title: 'Versements',
          head: HISTORY_PAYMENT_COLUMNS.map((c) => c.label),
          body: historyPaymentRows.map((r) => HISTORY_PAYMENT_COLUMNS.map((c) => r[c.key])),
          foot: historyPaymentCount
            ? [[`Total (${historyPaymentCount})`, formatGNF(historyPaymentTotal), '', '']]
            : [],
          rightAlignCols: [1],
        },
        {
          title: 'Dettes / créances',
          head: HISTORY_SETTLEMENT_COLUMNS.map((c) => c.label),
          body: historySettlementRows.map((r) => HISTORY_SETTLEMENT_COLUMNS.map((c) => r[c.key])),
          foot: historySettlementCount
            ? [[`Sous-total manuelles (${historySettlementCount})`, '', '', formatGNF(historyExternalBalance), '']]
            : [],
          rightAlignCols: [1, 2, 3],
        },
      ],
      filename: `historique-client-${historyClient.code}.pdf`,
      orientation,
    });
  }, [
    store,
    historyClient,
    history,
    historyCartRows,
    historyCartTotals,
    historyPaymentRows,
    historyPaymentTotal,
    historySettlementRows,
    historyExternalBalance,
    orientation,
  ]);

  return (
    <>
      {error && !showForm && <AlertBanner message={error} onClose={() => setError('')} />}

      <div className="card table-main clients-page">
        <div className="table-main-toolbar bmb-print-skip">
          <h3>Clients</h3>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-primary" onClick={load}>Rechercher</button>
            {canCreate && (
              <button type="button" className="btn btn-accent" onClick={openAddForm}>+ Ajouter</button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setOrientation(suggestPrintOrientation(CLIENT_COLUMNS.length));
                setPreviewMode('list');
              }}
            >
              Aperçu / Imprimer
            </button>
            <button type="button" className="btn btn-secondary" onClick={exportClientsPdf}>Exporter PDF</button>
          </div>
        </div>

        <div className="bmb-filters-panel clients-filters bmb-print-skip">
          <PvFilterBar variant="panel" />
          <div className="bmb-filters-panel__item clients-filters__search">
            <label htmlFor="clients-search">Recherche (nom, code, contact)</label>
            <input
              id="clients-search"
              className="search-input search-input--full"
              placeholder="Rechercher un client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
            />
          </div>
          <div className="bmb-filters-panel__item">
            <label>Type de client</label>
            <select className="filter-select filter-select--full" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">Tous</option>
              {CLIENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="bmb-filters-panel__item bmb-filters-panel__item--checkbox">
            <label className="bmb-filter-checkbox">
              <input
                type="checkbox"
                checked={filterDebtOnly}
                onChange={(e) => setFilterDebtOnly(e.target.checked)}
              />
              Clients avec dette uniquement
            </label>
          </div>
        </div>

        {adminPvChoice && misassigned.length > 0 && (
          <div className="alert alert-warning bmb-print-skip" style={{ marginBottom: '1rem' }}>
            <strong>{misassigned.length} client(s) à vérifier</strong> — rattachement PV incohérent avec l&apos;historique des ventes.
            <div className="bmb-misassigned-list" style={{ marginTop: '0.75rem' }}>
              {misassigned.slice(0, 8).map((c) => (
                <div key={c.id} className="bmb-misassigned-row" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.35rem' }}>
                  <span>{c.name} ({c.code}) — actuel: {c.delivery_point_code || '—'} → suggéré: {c.suggested_delivery_point_code || '—'}</span>
                  {c.suggested_delivery_point_id ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => transferClient(c.id, c.suggested_delivery_point_id)}>
                      Corriger
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {listMeta?.truncated && (
          <p className="bmb-page-hint bmb-print-skip">
            Affichage limité à {listMeta.limit} clients — le total dettes inclut tous les clients correspondant aux filtres.
          </p>
        )}

        {debtSummary && (
          <div className="reglement-summary-row bmb-print-skip" role="group" aria-label="Total dettes clients">
            <div className="reglement-summary-item">
              <span className="reglement-summary-label">Total dettes clients</span>
              <strong className="reglement-summary-value reglement-summary-value--danger">{formatGNF(debtSummary.total_balance_due)}</strong>
            </div>
            <div className="reglement-summary-item">
              <span className="reglement-summary-label">Clients avec solde</span>
              <strong className="reglement-summary-value">{debtSummary.clients_with_debt || 0}</strong>
            </div>
          </div>
        )}

        <div className="clients-page-layout bmb-print-skip">
          <aside className="clients-page-list" aria-label="Liste des clients">
            {loading ? (
              <TableSkeleton rows={10} columns={3} />
            ) : (
              <>
                <div className="clients-page-list__scroll">
                  <ResponsiveDataView
                    cards={
                      filteredList.length === 0 ? (
                        <EmptyState
                          icon="👤"
                          title="Aucun client"
                          description={search.trim()
                            ? 'Aucun résultat pour cette recherche.'
                            : 'Modifiez les filtres ou ajoutez un nouveau client.'}
                          action={canCreate ? (
                            <button type="button" className="btn btn-accent" onClick={openAddForm}>+ Ajouter un client</button>
                          ) : null}
                          compact
                        />
                      ) : filteredList.map((c) => (
                        <DataCard
                          key={c.id}
                          title={c.name}
                          subtitle={c.code}
                          badge={parseFloat(c.total_debt || 0) > 0.005 ? (
                            <span className="bmb-amount--danger">{formatGNF(c.total_debt)}</span>
                          ) : null}
                          fields={[
                            { label: 'Type', value: clientTypeLabel(c.client_type) },
                            { label: 'Contact', value: c.contact || '—' },
                          ]}
                          actions={(
                            <button type="button" className="btn btn-accent btn-sm" onClick={() => selectClient(c)}>
                              Voir la fiche
                            </button>
                          )}
                        />
                      ))
                    }
                    table={(
                      <div className="bmb-data-table-wrap">
                        <table className={`bmb-data-table clients-page-list__table${adminPvChoice ? ' clients-page-list__table--with-pv' : ''}`}>
                          <thead>
                            <tr>
                              <th>Code</th>
                              <th>Nom</th>
                              {adminPvChoice && <th>PV</th>}
                              <th className="col-num">Dette</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredList.length === 0 ? (
                              <tr><td colSpan={adminPvChoice ? 4 : 3} className="table-empty">Aucun client</td></tr>
                            ) : filteredList.map((c) => (
                              <tr
                                key={c.id}
                                className={`clients-page-list__row${historyClient?.id === c.id ? ' row-selected' : ''}`}
                                onClick={() => selectClient(c)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectClient(c); } }}
                                tabIndex={0}
                                role="button"
                                aria-selected={historyClient?.id === c.id}
                              >
                                <td className="clients-page-list__code">{c.code}</td>
                                <td className="clients-page-list__name" title={c.name}>{c.name}</td>
                                {adminPvChoice && <td className="clients-page-list__pv">{c.delivery_point_code || '—'}</td>}
                                <td className="col-num">
                                  {parseFloat(c.total_debt || 0) > 0.005
                                    ? <strong className="bmb-amount--danger">{formatGNF(c.total_debt)}</strong>
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          {filteredList.length > 0 && (
                            <tfoot>
                              <tr className="bmb-data-table-total-row">
                                <td colSpan={adminPvChoice ? 3 : 2}>
                                  <strong>{filteredList.length} client{filteredList.length > 1 ? 's' : ''}</strong>
                                </td>
                                <td className="col-num">
                                  <strong>{formatGNF(displayDebtTotal)}</strong>
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    )}
                  />
                </div>
              </>
            )}
          </aside>

          <section className="clients-page-detail" aria-label="Fiche client">
            {!historyClient ? (
              <div className="clients-page-detail__empty">
                <EmptyState
                  icon="📋"
                  title="Sélectionnez un client"
                  description="Cliquez sur un client dans la liste pour voir son historique, ses dettes, avances et actions."
                  compact
                />
              </div>
            ) : (
              <>
                <header className="clients-page-detail__header">
                  <div className="clients-page-detail__title">
                    <h3>{historyClient.name}</h3>
                    <p className="clients-page-detail__meta">
                      <span>{historyClient.code}</span>
                      <span>·</span>
                      <span>{clientTypeLabel(historyClient.client_type)}</span>
                      {historyClient.contact && (
                        <>
                          <span>·</span>
                          <span>{historyClient.contact}</span>
                        </>
                      )}
                      {adminPvChoice && historyClient.delivery_point_code && (
                        <>
                          <span>·</span>
                          <span>PV {historyClient.delivery_point_code}</span>
                        </>
                      )}
                    </p>
                    {historyClient.address && (
                      <p className="clients-page-detail__address">{historyClient.address}</p>
                    )}
                  </div>
                  <div className="bmb-client-account-block">
                    <div className="reglement-summary-row clients-page-detail__account-stats" role="group" aria-label="Compte client">
                      <div className="reglement-summary-item reglement-summary-item--primary">
                        <span className="reglement-summary-label">Dette totale</span>
                        <strong className="reglement-summary-value reglement-summary-value--danger">
                          {formatGNF(history?.summaries?.receivable?.total_balance_due ?? historyClient.total_debt ?? 0)}
                        </strong>
                        {historyReceivableBreakdown && (
                          <span className="reglement-summary-breakdown">{historyReceivableBreakdown}</span>
                        )}
                      </div>
                      {showReglement && (
                        <div className="reglement-summary-item">
                          <span className="reglement-summary-label">Avance disponible</span>
                          <strong className={`reglement-summary-value${displayAdvanceBalance > 0.005 ? ' reglement-summary-value--success' : ''}`}>
                            {formatGNF(displayAdvanceBalance)}
                          </strong>
                        </div>
                      )}
                      <div className="reglement-summary-item">
                        <span className="reglement-summary-label">Achats</span>
                        <strong className="reglement-summary-value">{historyClient.sale_count || 0}</strong>
                      </div>
                    </div>
                  </div>
                  <div className="clients-page-detail__actions toolbar-actions">
                    {showReglement && (
                      <>
                        <button
                          type="button"
                          className="btn btn-accent btn-sm"
                          onClick={openClientAdvanceModal}
                        >
                          Enregistrer une avance
                        </button>
                        <Link
                          to={`/ventes/reglement?client=${historyClient.id}`}
                          className="btn btn-primary btn-sm"
                        >
                          Encaisser
                        </Link>
                      </>
                    )}
                    {canEdit && (
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => edit(historyClient)}>
                        Modifier
                      </button>
                    )}
                    {user?.role === 'administrateur' && (
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(historyClient.id)}>
                        Supprimer
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setOrientation('landscape');
                        setPreviewMode('history');
                      }}
                      disabled={!history || historyLoading}
                    >
                      Aperçu / Imprimer
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={exportHistoryPdf}
                      disabled={!history || historyLoading}
                    >
                      Export PDF
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={clearSelectedClient}>
                      Fermer
                    </button>
                  </div>
                </header>

                <div className="clients-page-detail__scroll">
                  {historyLoading ? (
                    <TableSkeleton rows={6} columns={4} />
                  ) : history ? (
                    <>
                      <div className="clients-history-block">
                        <h4>Paniers / factures</h4>
                        <div className="bmb-data-table-wrap table-scroll">
                          <table className="bmb-data-table">
                            <thead>
                              <tr>
                                <th>N° Panier</th><th>Statut</th><th className="col-num">Total</th><th className="col-num">Payé</th><th className="col-num">Reste</th><th>Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(history.carts || []).length === 0 ? (
                                <tr><td colSpan={6} className="table-empty">Aucun panier</td></tr>
                              ) : (history.carts || []).map((c) => {
                                const st = cartEncaissementStatus(c);
                                return (
                                  <tr key={c.id}>
                                    <td><strong>{c.cart_number}</strong></td>
                                    <td><span className={`badge badge-${st.badge}`}>{st.label}</span></td>
                                    <td className="col-num">{formatGNF(c.total_amount)}</td>
                                    <td className="col-num">{formatGNF(c.amount_paid)}</td>
                                    <td className="col-num">{formatGNF(c.balance_due)}</td>
                                    <td>{formatDate(c.validated_at || c.created_at)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            {(history.carts || []).length > 0 && (
                              <tfoot>
                                <tr className="bmb-data-table-total-row">
                                  <td colSpan={2}><span style={{ color: 'var(--text-muted)' }}>Sous-total paniers ({historyCartTotals.count})</span></td>
                                  <td className="col-num" style={{ color: 'var(--text-muted)' }}>{formatGNF(historyCartTotals.total)}</td>
                                  <td className="col-num" style={{ color: 'var(--text-muted)' }}>{formatGNF(historyCartTotals.paid)}</td>
                                  <td className="col-num" style={{ color: 'var(--text-muted)' }}>{formatGNF(historyCartTotals.due)}</td>
                                  <td />
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>

                      <div className="clients-history-block">
                        <h4>Versements / reçus</h4>
                        <div className="bmb-data-table-wrap table-scroll">
                          <table className="bmb-data-table">
                            <thead>
                              <tr><th>N° Panier</th><th className="col-num">Montant</th><th>Mode</th><th>Date</th></tr>
                            </thead>
                            <tbody>
                              {(history.payments || []).length === 0 ? (
                                <tr><td colSpan={4} className="table-empty">Aucun versement</td></tr>
                              ) : (history.payments || []).map((p) => (
                                <tr key={p.id}>
                                  <td>{p.cart_number}</td>
                                  <td className="col-num">{formatGNF(p.amount)}</td>
                                  <td>{paymentModeLabel(p.payment_mode)}</td>
                                  <td>{formatDate(p.created_at)}</td>
                                </tr>
                              ))}
                            </tbody>
                            {(history.payments || []).length > 0 && (
                              <tfoot>
                                <tr className="bmb-data-table-total-row">
                                  <td><strong>Total ({historyPaymentCount})</strong></td>
                                  <td className="col-num"><strong>{formatGNF(historyPaymentTotal)}</strong></td>
                                  <td colSpan={2} />
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>

                      <div className="clients-history-block">
                        <h4>Dettes manuelles</h4>
                        <div className="bmb-data-table-wrap table-scroll">
                          <table className="bmb-data-table">
                            <thead>
                              <tr><th>Type</th><th className="col-num">Montant</th><th className="col-num">Payé</th><th className="col-num">Solde</th><th>Statut</th></tr>
                            </thead>
                            <tbody>
                              {(history.settlements || []).length === 0 ? (
                                <tr><td colSpan={5} className="table-empty">Aucune dette ou créance</td></tr>
                              ) : (history.settlements || []).map((s) => (
                                <tr key={s.id}>
                                  <td>{SETTLEMENT_LABELS[s.settlement_type] || s.settlement_type}</td>
                                  <td className="col-num">{formatGNF(s.amount)}</td>
                                  <td className="col-num">{formatGNF(s.amount_paid)}</td>
                                  <td className="col-num">{formatGNF(s.balance)}</td>
                                  <td>{settlementStatusLabel(s.status)}</td>
                                </tr>
                              ))}
                            </tbody>
                            {(history.settlements || []).length > 0 && (
                              <tfoot>
                                <tr className="bmb-data-table-total-row">
                                  <td><span style={{ color: 'var(--text-muted)' }}>Sous-total manuelles ({historySettlementCount})</span></td>
                                  <td colSpan={2} />
                                  <td className="col-num" style={{ color: 'var(--text-muted)' }}>{formatGNF(historyExternalBalance)}</td>
                                  <td />
                                </tr>
                              </tfoot>
                            )}
                          </table>
                        </div>
                      </div>

                      {showReglement && (clientAdvanceInfo?.advances?.length > 0 || displayAdvanceBalance > 0.005) && (
                        <div className="clients-history-block">
                          <h4>Avances en cours</h4>
                          {(clientAdvanceInfo?.advances || []).length === 0 ? (
                            <p className="bmb-page-hint" style={{ margin: 0 }}>
                              Crédit d&apos;avance disponible : <strong>{formatGNF(displayAdvanceBalance)}</strong>
                            </p>
                          ) : (
                            <div className="bmb-data-table-wrap table-scroll">
                              <table className="bmb-data-table">
                                <thead>
                                  <tr>
                                    <th>Référence</th>
                                    <th>Date</th>
                                    <th className="col-num">Versement initial</th>
                                    <th className="col-num">Utilisé</th>
                                    <th className="col-num">Disponible</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(clientAdvanceInfo.advances || []).map((a) => (
                                    <tr key={a.id}>
                                      <td><strong>{a.settlement_number}</strong></td>
                                      <td>{formatDate(a.created_at)}</td>
                                      <td className="col-num">{formatGNF(a.amount)}</td>
                                      <td className="col-num">{formatGNF(a.amount_paid)}</td>
                                      <td className="col-num"><strong>{formatGNF(a.balance)}</strong></td>
                                    </tr>
                                  ))}
                                </tbody>
                                {(clientAdvanceInfo.advances || []).length > 0 && (
                                  <tfoot>
                                    <tr className="bmb-data-table-total-row">
                                      <td colSpan={2}>
                                        <span style={{ color: 'var(--text-muted)' }}>
                                          Total avances ({clientAdvanceInfo.advances.length})
                                        </span>
                                      </td>
                                      <td colSpan={2} />
                                      <td className="col-num" style={{ color: 'var(--text-muted)' }}>
                                        {formatGNF(displayAdvanceBalance)}
                                      </td>
                                    </tr>
                                  </tfoot>
                                )}
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>


      <PrintPreviewModal
        open={Boolean(previewMode)}
        onClose={() => setPreviewMode(null)}
        title={
          previewMode === 'history' && historyClient
            ? `Historique — ${historyClient.name} (${historyClient.code})`
            : 'Aperçu — Liste des clients'
        }
        orientation={orientation}
        onOrientationChange={setOrientation}
        onExportPdf={() => (previewMode === 'history' ? exportHistoryPdf() : exportClientsPdf())}
        printRef={printRef}
      >
        {previewMode === 'list' && (
          <PrintReport
            store={store}
            title="Liste des clients"
            subtitle="Répertoire clients BESTO SHOP"
            date={new Date()}
            filters={clientReportFilters}
            columns={CLIENT_COLUMNS}
            rows={clientReportRows}
            footRows={clientReportFoot}
            emptyMessage="Aucun client"
          />
        )}
        {previewMode === 'history' && historyClient && history && (
          <>
            <div className="bmb-print-history-section">
              <PrintReport
                store={store}
                title={`Historique client — ${historyClient.name}`}
                subtitle={`Code ${historyClient.code}`}
                date={new Date()}
                filters={[
                  { label: 'Type', value: clientTypeLabel(historyClient.client_type) },
                  { label: 'Contact', value: historyClient.contact || '' },
                ]}
                columns={HISTORY_CART_COLUMNS}
                rows={historyCartRows}
                footRows={historyCartFoot}
                emptyMessage="Aucun panier"
              />
            </div>
            <div className="bmb-print-history-section">
              <PrintReport
                store={store}
                title="Versements"
                subtitle={`Client ${historyClient.code}`}
                date={new Date()}
                columns={HISTORY_PAYMENT_COLUMNS}
                rows={historyPaymentRows}
                footRows={historyPaymentFoot}
                emptyMessage="Aucun versement"
              />
            </div>
            <div className="bmb-print-history-section">
              <PrintReport
                store={store}
                title="Dettes / créances"
                subtitle={`Client ${historyClient.code}`}
                date={new Date()}
                columns={HISTORY_SETTLEMENT_COLUMNS}
                rows={historySettlementRows}
                footRows={historySettlementFoot}
                emptyMessage="Aucune dette ou créance"
              />
            </div>
          </>
        )}
      </PrintPreviewModal>
      </div>

      <BmbFormModal
        open={showForm}
        onClose={closeForm}
        title={editId ? 'Modifier le client' : 'Nouveau client'}
        titleId="client-form-title"
      >
        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <div className="client-form-grid">
          <div className="form-group">
            <label>Nom du client *</label>
            <input ref={nameInputRef} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Type de client</label>
            <select value={form.client_type} onChange={(e) => setForm({ ...form, client_type: e.target.value })}>
              {CLIENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Contact (9 chiffres, optionnel)</label>
            <input
              value={form.contact}
              maxLength={9}
              placeholder="620000000"
              onChange={(e) => setForm({ ...form, contact: e.target.value.replace(/\D/g, '') })}
            />
          </div>
          <div className="form-group">
            <label>Adresse</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          {!editId && (pvLocked || adminPvChoice) && (
            pvLocked ? (
              <div className="form-group">
                <label>Point de vente</label>
                <p style={{ margin: 0, color: 'var(--text-muted)' }}>{pvDisplayLabel(user)}</p>
              </div>
            ) : (
              <div className="form-group">
                <label>Point de vente *</label>
                <select
                  value={form.delivery_point_id}
                  onChange={(e) => setForm({ ...form, delivery_point_id: e.target.value })}
                  required
                >
                  <option value="">— Choisir —</option>
                  {deliveryPoints.map((dp) => (
                    <option key={dp.id} value={dp.id}>{dp.code} — {dp.name}</option>
                  ))}
                </select>
              </div>
            )
          )}
        </div>
        {!editId && (
          <p style={{ marginTop: '.75rem', color: 'var(--text-muted)', fontSize: '.9rem' }}>
            Le code client est généré automatiquement à l&apos;enregistrement.
          </p>
        )}
        {((editId && canEdit) || (!editId && canCreate)) && (
          <div className="btn-group" style={{ marginTop: '1rem' }}>
            <button type="button" className="btn btn-primary" onClick={save}>{editId ? 'Enregistrer' : 'Ajouter'}</button>
            <button type="button" className="btn btn-secondary" onClick={closeForm}>Annuler</button>
          </div>
        )}
        {!canCreate && !editId && (
          <p style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>
            Vous n&apos;avez pas la permission de créer un client.
          </p>
        )}
      </BmbFormModal>

      <EncaissementModal
        open={clientAdvanceOpen}
        onClose={() => setClientAdvanceOpen(false)}
        title="Avance client"
        subtitle={historyClient
          ? (showClientPv && clientPvShort(historyClient)
            ? `${historyClient.name} · ${clientPvShort(historyClient)}`
            : historyClient.name)
          : ''}
        stats={displayAdvanceBalance > 0.005 ? [
          { label: 'Crédit actuel', value: formatGNF(displayAdvanceBalance), variant: 'due' },
        ] : []}
        amount={clientAdvancePayment.amount_paid}
        onAmountChange={(v) => setClientAdvancePayment({ ...clientAdvancePayment, amount_paid: v })}
        paymentMode={clientAdvancePayment.payment_mode}
        onPaymentModeChange={(v) => setClientAdvancePayment({ ...clientAdvancePayment, payment_mode: v })}
        onSubmit={recordClientAdvance}
        submitLabel="Enregistrer l'avance"
        submitDisabled={!historyClient?.id || !clientAdvancePayment.amount_paid || parseFloat(clientAdvancePayment.amount_paid) <= 0}
        hint="L'avance est créditée sur le compte client et pourra être utilisée automatiquement à la prochaine vente."
      >
        <div className="bmb-encaisse-modal__extras" style={{ paddingTop: '0.75rem' }}>
          <div className="form-group" style={{ width: '100%', margin: 0 }}>
            <label htmlFor="clients-advance-notes">Note (optionnel)</label>
            <input
              id="clients-advance-notes"
              type="text"
              className="search-input search-input--full"
              placeholder="Ex. avance pour commande mars…"
              value={clientAdvancePayment.notes}
              onChange={(e) => setClientAdvancePayment({ ...clientAdvancePayment, notes: e.target.value })}
            />
          </div>
        </div>
      </EncaissementModal>
    </>
  );
}
