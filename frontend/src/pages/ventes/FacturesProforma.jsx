import { useEffect, useState, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { formatGNF, formatDate } from '../../utils/format';
import { downloadProformaPdf, buildProformaDocument } from '../../utils/printPdf';
import { matchesListSearch } from '../../utils/listSearch';
import EmptyState from '../../components/ui/EmptyState';
import TableSkeleton from '../../components/ui/TableSkeleton';
import DataCard from '../../components/ui/DataCard';
import ResponsiveDataView from '../../components/ui/ResponsiveDataView';
import PrintDocument from '../../components/PrintDocument';
import PrintPreviewModal from '../../components/PrintPreviewModal';
import { useNotify } from '../../hooks/useNotify';
import { useAuth } from '../../context/AuthContext';
import { usePvFilter } from '../../context/PvFilterContext';
import { stockQueryParams } from '../../utils/pvScope';
import PvFilterBar from '../../components/PvFilterBar';

export default function FacturesProforma() {
  const { user } = useAuth();
  const pvFilter = usePvFilter();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [orientation, setOrientation] = useState('portrait');
  const notify = useNotify();
  const printRef = useRef();

  const printDoc = useMemo(
    () => (detail ? buildProformaDocument(detail) : null),
    [detail]
  );

  const filteredList = useMemo(
    () => list.filter((f) => matchesListSearch(
      search,
      f.invoice_number,
      f.cart_number,
      f.client_name,
      f.client_code,
    )),
    [list, search],
  );

  const apiParams = useMemo(
    () => ({ ...stockQueryParams(user), ...pvFilter.queryParams }),
    [user, pvFilter.queryParams],
  );

  useEffect(() => {
    setLoading(true);
    api.get('/proforma', { params: apiParams })
      .then((r) => setList(Array.isArray(r.data) ? r.data : []))
      .catch((err) => notify.apiError(err, 'Impossible de charger les factures'))
      .finally(() => setLoading(false));
  }, [notify, apiParams]);

  const view = async (id) => {
    try {
      const { data } = await api.get(`/proforma/${id}`);
      setDetail(data);
      setOrientation('portrait');
      setPreviewOpen(true);
    } catch (err) {
      notify.apiError(err, 'Impossible d\'ouvrir la facture');
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setDetail(null);
  };

  const exportPdf = async () => {
    if (!detail) return;
    try {
      await downloadProformaPdf(detail);
      notify.success('Facture exportée en PDF');
    } catch (err) {
      notify.apiError(err, 'Export PDF impossible');
    }
  };

  return (
    <>
      <div className="card table-main">
        <div className="table-main-toolbar">
          <h3>Factures clients</h3>
        </div>
        <p className="table-main-toolbar__hint">Générées automatiquement à chaque vente validée — format facture client</p>

        <div className="bmb-filters-panel bmb-print-skip">
          <PvFilterBar variant="panel" />
          <div className="bmb-filters-panel__item clients-filters__search">
            <label htmlFor="factures-search">Recherche (client ou n° panier)</label>
            <input
              id="factures-search"
              className="search-input search-input--full"
              placeholder="Nom client, code ou n° panier / facture..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={8} columns={4} />
        ) : (
          <ResponsiveDataView
            cards={
              filteredList.length === 0 ? (
                <EmptyState
                  icon="🧾"
                  title="Aucune facture"
                  description={search.trim()
                    ? 'Aucun résultat pour cette recherche.'
                    : 'Les factures sont générées automatiquement à chaque vente validée.'}
                  compact
                />
              ) : filteredList.map((f) => {
                const reste = f.balance_due != null
                  ? parseFloat(f.balance_due)
                  : Math.max(0, parseFloat(f.total_amount || 0) - parseFloat(f.amount_paid || 0));
                const clientLabel = f.client_name
                  ? `${f.client_name}${f.client_code ? ` (${f.client_code})` : ''}`
                  : '—';
                return (
                  <DataCard
                    key={f.id}
                    title={f.invoice_number}
                    subtitle={f.cart_number}
                    badge={reste > 0.005 ? (
                      <span className="bmb-amount--danger">Reste {formatGNF(reste)}</span>
                    ) : (
                      <span className="badge badge-finalise">Soldé</span>
                    )}
                    fields={[
                      { label: 'Client', value: clientLabel },
                      { label: 'Total', value: formatGNF(f.total_amount), strong: true },
                      { label: 'Encaissé', value: formatGNF(f.amount_paid || 0) },
                      { label: 'Date', value: formatDate(f.issued_at) },
                    ]}
                    actions={(
                      <>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => view(f.id)}>Aperçu</button>
                        {f.cart_id && (
                          <Link
                            to={f.cart_status === 'en_cours' ? `/ventes/vendre?cart_id=${f.cart_id}` : `/ventes/reglement?cart=${f.cart_id}`}
                            className="btn btn-accent btn-sm"
                          >
                            {f.cart_status === 'en_cours' ? 'Voir panier' : 'Encaisser'}
                          </Link>
                        )}
                      </>
                    )}
                  />
                );
              })
            }
            table={(
              <div className="bmb-data-table-wrap table-scroll">
                <table className="bmb-data-table table-full">
                  <thead>
                    <tr><th>N° Facture</th><th>N° Panier</th><th>Client</th><th className="col-num">Total</th><th className="col-num">Encaissé</th><th className="col-num">Reste</th><th>Date</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {filteredList.length === 0 ? (
                      <tr><td colSpan={8} className="table-empty">
                        {search.trim() ? 'Aucune facture pour cette recherche' : 'Aucune facture pro forma'}
                      </td></tr>
                    ) : filteredList.map((f) => {
                      const reste = f.balance_due != null
                        ? parseFloat(f.balance_due)
                        : Math.max(0, parseFloat(f.total_amount || 0) - parseFloat(f.amount_paid || 0));
                      return (
                        <tr key={f.id} className={detail?.id === f.id ? 'row-selected' : ''}>
                          <td><strong>{f.invoice_number}</strong></td>
                          <td>{f.cart_number}</td>
                          <td>{f.client_name || '—'}{f.client_code ? ` (${f.client_code})` : ''}</td>
                          <td className="col-num">{formatGNF(f.total_amount)}</td>
                          <td className="col-num">{formatGNF(f.amount_paid || 0)}</td>
                          <td className="col-num">{formatGNF(reste)}</td>
                          <td>{formatDate(f.issued_at)}</td>
                          <td className="actions-cell">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => view(f.id)}>Aperçu</button>
                            {f.cart_id && (
                              <Link
                                to={f.cart_status === 'en_cours' ? `/ventes/vendre?cart_id=${f.cart_id}` : `/ventes/reglement?cart=${f.cart_id}`}
                                className="btn btn-accent btn-sm"
                                style={{ marginLeft: '0.35rem' }}
                              >
                                Voir panier / Encaisser
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          />
        )}
      </div>

      <PrintPreviewModal
        open={previewOpen && !!printDoc}
        onClose={closePreview}
        title={detail ? `Aperçu — ${detail.invoice_number}` : 'Aperçu facture'}
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
