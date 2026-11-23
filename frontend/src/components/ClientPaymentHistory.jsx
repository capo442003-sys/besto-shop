import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { formatGNF, PAYMENT_MODES } from '../utils/format';

function modeLabel(mode) {
  return PAYMENT_MODES.find((m) => m.value === mode)?.label || mode || '—';
}

function formatDateTime(d) {
  if (!d) return { date: '—', time: '' };
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return { date: '—', time: '' };
  return {
    date: dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  };
}

/**
 * Historique des encaissements d'un client (reçus panier + encaissements globaux).
 * `refreshKey` : changer la valeur pour recharger (ex. après un encaissement).
 */
export default function ClientPaymentHistory({ clientId, refreshKey, limit, compact = false, title = 'Historique des encaissements' }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clientId) {
      setRows([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    api.get('/sales/payment-receipts', { params: { client_id: clientId } })
      .then(({ data }) => {
        if (!cancelled) setRows(Array.isArray(data?.receipts) ? data.receipts : []);
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setError('Historique indisponible');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [clientId, refreshKey]);

  const shown = useMemo(() => (limit ? rows.slice(0, limit) : rows), [rows, limit]);
  const total = useMemo(
    () => shown.reduce((s, r) => s + (parseFloat(r.amount_paid) || 0), 0),
    [shown],
  );

  if (!clientId) return null;

  return (
    <section className={`client-pay-history${compact ? ' client-pay-history--compact' : ''}`} aria-label={title}>
      <h4 className="bmb-section-title">
        {title}
        {rows.length > 0 && <span className="client-pay-history__count"> · {rows.length} versement{rows.length > 1 ? 's' : ''}</span>}
      </h4>
      {loading ? (
        <p className="bmb-page-hint">Chargement…</p>
      ) : error ? (
        <p className="bmb-page-hint">{error}</p>
      ) : shown.length === 0 ? (
        <p className="bmb-page-hint">Aucun encaissement enregistré pour ce client.</p>
      ) : (
        <div className="bmb-data-table-wrap table-scroll bmb-table-scroll-y client-pay-history__table">
          <table className="bmb-data-table table-full">
            <thead>
              <tr>
                <th>Date</th>
                <th>Référence</th>
                {!compact && <th>Type</th>}
                <th>Mode</th>
                <th className="col-num">Montant</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const { date, time } = formatDateTime(r.created_at);
                return (
                  <tr key={`${r.receipt_type}-${r.reference}-${r.payment_id || ''}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {date}
                      {time && <span className="client-pay-history__time">{time}</span>}
                    </td>
                    <td>{r.reference || '—'}</td>
                    {!compact && (
                      <td>
                        {r.receipt_type === 'bulk'
                          ? `Encaissement global (${r.cart_count} panier${r.cart_count > 1 ? 's' : ''})`
                          : 'Panier'}
                      </td>
                    )}
                    <td>{modeLabel(r.payment_mode)}</td>
                    <td className="col-num" style={{ whiteSpace: 'nowrap' }}><strong>{formatGNF(r.amount_paid)}</strong></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td colSpan={compact ? 3 : 4}>
                  <strong>
                    Total {limit && rows.length > shown.length ? `(${shown.length} derniers)` : `(${shown.length})`}
                  </strong>
                </td>
                <td className="col-num" style={{ whiteSpace: 'nowrap' }}><strong>{formatGNF(total)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
