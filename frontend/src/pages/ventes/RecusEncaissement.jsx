import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../api/client';
import { formatGNF, formatDate, paymentModeLabel } from '../../utils/format';
import { downloadBulkReceiptPdf, downloadPaymentReceiptPdf } from '../../utils/printPdf';
import { buildBulkReceiptDocument, buildReceiptDocument } from '../../utils/documentBuilders';
import { matchesListSearch } from '../../utils/listSearch';
import PrintDocument from '../../components/PrintDocument';
import PrintPreviewModal from '../../components/PrintPreviewModal';
import { useNotify } from '../../hooks/useNotify';
import { useAuth } from '../../context/AuthContext';
import { canAccessReglement } from '../../utils/sellerScope';
import { stockQueryParams } from '../../utils/pvScope';
import { usePvFilter } from '../../context/PvFilterContext';
import EncaissementPvSelect from '../../components/EncaissementPvSelect';

export default function RecusEncaissement() {
  const { user } = useAuth();
  const { queryParams: pvFilterParams } = usePvFilter();
  const notify = useNotify();
  const [list, setList] = useState([]);
  const [clients, setClients] = useState([]);
  const [store, setStore] = useState({});
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ date_from: '', date_to: '', client_id: '' });
  const [detail, setDetail] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [orientation, setOrientation] = useState('portrait');
  const printRef = useRef();

  const canView = canAccessReglement(user);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const params = {
        ...stockQueryParams(user),
        ...pvFilterParams,
        ...Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v !== '' && v != null)
        ),
      };
      const { data } = await api.get('/sales/payment-receipts', { params });
      setList(Array.isArray(data.receipts) ? data.receipts : []);
    } catch (err) {
      notify.apiError(err, 'Impossible de charger les reçus');
    }
  }, [canView, filters, notify, user, pvFilterParams]);

  useEffect(() => {
    if (!canView) return;
    api.get('/clients', { params: { ...stockQueryParams(user), ...pvFilterParams } }).then((r) => {
      const rows = Array.isArray(r.data) ? r.data : r.data?.clients || [];
      setClients(rows);
    }).catch(() => {});
    api.get('/settings/store').then((r) => setStore(r.data || {})).catch(() => {});
  }, [canView, user, pvFilterParams]);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  const filteredList = useMemo(
    () => list.filter((r) => matchesListSearch(
      search,
      r.reference,
      r.client_name,
      r.client_code,
      r.receipt_type === 'bulk' ? 'global' : 'panier',
    )),
    [list, search],
  );

  const printDoc = useMemo(() => {
    if (!detail) return null;
    if (detail.type === 'bulk') {
      return buildBulkReceiptDocument({ result: detail.data, store });
    }
    return buildReceiptDocument({
      cart: detail.cart,
      payment: detail.payment,
      store,
    });
  }, [detail, store]);

  const previewTitle = useMemo(() => {
    if (!detail) return 'Aperçu reçu';
    if (detail.type === 'bulk') return `Aperçu — ${detail.data.batch_ref}`;
    return `Aperçu — ${detail.cart?.cart_number}`;
  }, [detail]);

  const view = async (row) => {
    try {
      if (row.receipt_type === 'bulk') {
        const { data } = await api.get(`/sales/payment-receipts/bulk/${encodeURIComponent(row.reference)}`);
        setDetail({ type: 'bulk', data, rowKey: row.reference });
      } else {
        const { data } = await api.get(`/sales/payment-receipts/${row.payment_id}`);
        setDetail({ type: 'single', cart: data.cart, payment: data.payment, rowKey: `p-${row.payment_id}` });
      }
      setOrientation('portrait');
      setPreviewOpen(true);
    } catch (err) {
      notify.apiError(err, 'Impossible d\'ouvrir le reçu');
    }
  };

  const exportPdf = async () => {
    if (!detail) return;
    if (detail.type === 'bulk') {
      await downloadBulkReceiptPdf(detail.data, store);
    } else {
      await downloadPaymentReceiptPdf({
        cart: detail.cart,
        payment: detail.payment,
        store,
      });
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setDetail(null);
  };

  if (!canView) {
    return (
      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>Accès refusé</h3>
        <p style={{ color: 'var(--text-muted)' }}>
          Les reçus d&apos;encaissement sont réservés à la caisse et à la gestion.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="card table-main">
        <div className="table-main-toolbar">
          <h3>Reçus d&apos;encaissement</h3>
          <p className="table-main-toolbar__hint">
            Émis à chaque encaissement — panier ou règlement global client
          </p>
        </div>

        <div className="bmb-filters-panel bmb-print-skip reglement-recus-filters">
          <EncaissementPvSelect id="recus-pv-select" />
          <div className="bmb-filters-panel__item reglement-recus-filters__search">
            <label htmlFor="recus-search">Recherche (client ou référence)</label>
            <input
              id="recus-search"
              className="search-input"
              style={{ width: '100%', maxWidth: 'none' }}
              placeholder="Client, code, n° reçu ou n° panier..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="form-group bmb-filters-panel__item">
            <label>Du</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
            />
          </div>
          <div className="form-group bmb-filters-panel__item">
            <label>Au</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
            />
          </div>
          <div className="form-group bmb-filters-panel__item">
            <label>Client</label>
            <select
              className="filter-select"
              value={filters.client_id}
              onChange={(e) => setFilters({ ...filters, client_id: e.target.value })}
            >
              <option value="">Tous</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="bmb-data-table-wrap table-scroll">
          <table className="bmb-data-table table-full">
            <thead>
              <tr>
                <th>N° Reçu</th>
                <th>Type</th>
                <th>Client</th>
                <th className="col-num">Montant</th>
                <th className="col-num">Paniers</th>
                <th>Mode</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-empty">
                    {search.trim() ? 'Aucun reçu pour cette recherche' : 'Aucun reçu d\'encaissement'}
                  </td>
                </tr>
              ) : filteredList.map((r) => (
                <tr
                  key={r.receipt_type === 'bulk' ? r.reference : `p-${r.payment_id}`}
                  className={detail?.rowKey === (r.receipt_type === 'bulk' ? r.reference : `p-${r.payment_id}`) ? 'row-selected' : ''}
                >
                  <td><strong>{r.reference}</strong></td>
                  <td>{r.receipt_type === 'bulk' ? 'Global' : 'Panier'}</td>
                  <td>
                    {r.client_name || '—'}
                    {r.client_code ? ` (${r.client_code})` : ''}
                  </td>
                  <td className="col-num">{formatGNF(r.amount_paid)}</td>
                  <td className="col-num">{r.cart_count || 1}</td>
                  <td>{paymentModeLabel(r.payment_mode)}</td>
                  <td>{formatDate(r.created_at)}</td>
                  <td className="actions-cell">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => view(r)}>
                      Aperçu
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PrintPreviewModal
        open={previewOpen && !!printDoc}
        onClose={closePreview}
        title={previewTitle}
        orientation={orientation}
        onOrientationChange={setOrientation}
        onExportPdf={exportPdf}
        printRef={printRef}
      >
        {printDoc && <PrintDocument {...printDoc} />}
      </PrintPreviewModal>
    </>
  );
}
