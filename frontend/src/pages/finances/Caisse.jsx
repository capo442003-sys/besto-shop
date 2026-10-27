import { useEffect, useState, useMemo } from 'react';
import api from '../../api/client';
import { formatGNF, formatCashReference, cashTransactionTypeLabel } from '../../utils/format';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';
import AlertBanner from '../../components/AlertBanner';
import HelpTip from '../../components/HelpTip';
import { useConfirm } from '../../context/ConfirmContext';
import { useStoreSettings } from '../../context/StoreSettingsContext';
import { useAuth } from '../../context/AuthContext';
import { stockQueryParams } from '../../utils/pvScope';
import { usePvFilter } from '../../context/PvFilterContext';
import PvFilterBar from '../../components/PvFilterBar';
import { useSocket } from '../../hooks/useSocket';
import { sumCashTransactions } from '../../utils/calculations';
import { downloadReportPdf } from '../../utils/printReportPdf';

export default function Caisse() {
  const { user, userRoles } = useAuth();
  const pvFilter = usePvFilter();
  const isAdmin = userRoles().includes('administrateur');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ transaction_type: 'depense', amount: '', description: '', category: '' });
  const [closeForm, setCloseForm] = useState({ opening_balance: '', counted_balance: '', signature_name: '', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const notify = useNotify();
  const confirm = useConfirm();
  const { store } = useStoreSettings();

  const summary = data?.closure_summary;

  const caisseParams = useMemo(
    () => ({ date, ...stockQueryParams(user), ...pvFilter.queryParams }),
    [date, user, pvFilter.queryParams],
  );

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await api.get('/finances/caisse', { params: caisseParams });
      setData(r.data);
      const s = r.data.closure_summary;
      if (s && !s.is_closed) {
        setCloseForm((f) => ({
          ...f,
          opening_balance: s.opening_balance != null ? String(s.opening_balance) : '',
          signature_name: f.signature_name || user?.full_name || '',
        }));
      }
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible de charger la caisse'));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [date, pvFilter.queryParams]);

  useSocket((event) => {
    if (event === 'dashboard:refresh' || event === 'cash:closed') load();
  });

  const closeParams = () => ({ ...stockQueryParams(user), ...pvFilter.queryParams });

  const deleteTransaction = async (tx) => {
    const linked = tx.reference_type
      ? `\n\nLiée à : ${formatCashReference(tx)}.`
      : '';
    const ok = await confirm({
      title: 'Supprimer l\'opération',
      message: `Supprimer cette opération de caisse (${formatGNF(tx.amount)}) ?${linked}\n\nLe journal et le tableau de bord seront mis à jour.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/finances/transactions/${tx.id}`);
      notify.success('Opération supprimée');
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Suppression impossible'));
    }
  };

  const save = async () => {
    setError('');
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setError('Saisissez un montant valide');
      return;
    }
    const typeLabel = form.transaction_type === 'recette' ? 'recette' : 'dépense';
    const ok = await confirm({
      title: 'Enregistrer l\'opération',
      message: `Enregistrer une ${typeLabel} de ${formatGNF(form.amount)} en caisse ?`,
      confirmLabel: 'Enregistrer',
    });
    if (!ok) return;
    try {
      await api.post('/finances/transactions', { ...form, cash_date: date });
      notify.success('Opération de caisse enregistrée');
      setShowForm(false);
      setForm({ transaction_type: 'depense', amount: '', description: '', category: '' });
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible d\'enregistrer l\'opération'));
    }
  };

  const reopenDay = async () => {
    const ok = await confirm({
      title: 'Rouvrir la journée',
      message: `Rouvrir la caisse du ${date} ? Réservé à l'administrateur.`,
      confirmLabel: 'Rouvrir',
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await api.post('/finances/caisse/reopen', { cash_date: date, reason: 'Correction admin', ...closeParams() });
      notify.success('Journée rouverte');
      load();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const printClosure = async () => {
    try {
      const { data } = await api.get('/finances/caisse/closure-report', { params: { date, ...closeParams() } });
      const s = data.summary;
      await downloadReportPdf({
        store,
        title: `Clôture caisse — ${date}`,
        subtitle: store?.store_name || 'BESTO SHOP',
        head: ['Libellé', 'Montant'],
        body: [
          ['Fond ouverture', formatGNF(s.opening_balance)],
          ['Encaissements ventes', formatGNF(s.sales_collected)],
          ['Règlements', formatGNF(s.settlement_collected)],
          ['Recettes manuelles', formatGNF(s.manual_recettes)],
          ['Dépenses manuelles', formatGNF(s.manual_depenses)],
          ['Solde théorique', formatGNF(s.expected_balance)],
          ['Montant compté', formatGNF(s.closure?.counted_balance ?? 0)],
          ['Écart', formatGNF(s.closure?.variance ?? 0)],
        ],
      });
    } catch (e) {
      notify.error(apiErrorMessage(e));
    }
  };

  const closeDay = async () => {
    const counted = parseFloat(closeForm.counted_balance);
    if (!Number.isFinite(counted) || counted < 0) {
      setError('Saisissez le montant réellement compté en caisse');
      return;
    }
    const expected = summary?.expected_balance ?? 0;
    const ecart = counted - expected;
    const ok = await confirm({
      title: 'Clôture de caisse (Z)',
      message: `Solde théorique : ${formatGNF(expected)} · Compté : ${formatGNF(counted)} · Écart : ${formatGNF(ecart)}. Confirmer la clôture du ${date} ?`,
      confirmLabel: 'Clôturer',
      variant: Math.abs(ecart) > 1000 ? 'warning' : 'default',
    });
    if (!ok) return;
    try {
      await api.post('/finances/caisse/close', {
        cash_date: date,
        counted_balance: counted,
        opening_balance: closeForm.opening_balance || undefined,
        signature_name: closeForm.signature_name,
        notes: closeForm.notes,
        ...closeParams(),
      });
      notify.success('Clôture enregistrée');
      setShowClose(false);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible de clôturer'));
    }
  };

  if (loading && !data) return <p style={{ color: 'var(--text-muted)' }}>Chargement de la caisse…</p>;
  if (!data) return <AlertBanner message={error || 'Données indisponibles'} />;

  const txTotals = sumCashTransactions(data.transactions || []);
  const closed = summary?.is_closed;
  const closure = summary?.closure;

  return (
    <div className="card table-main">
      <div className="table-main-toolbar">
        <h3>Caisse du {date}</h3>
        <div className="toolbar-actions">
          <PvFilterBar compact />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          {!closed && (
            <>
              <button type="button" className="btn btn-accent" onClick={() => setShowForm(true)}>+ Opération</button>
              <button type="button" className="btn btn-primary" onClick={() => setShowClose(true)}>Clôture (Z)</button>
            </>
          )}
          <button type="button" className="btn btn-secondary" onClick={printClosure}>PDF clôture</button>
          {closed && isAdmin && (
            <button type="button" className="btn btn-secondary" onClick={reopenDay}>Rouvrir (admin)</button>
          )}
          <button type="button" className="btn btn-secondary" onClick={load}>Actualiser</button>
        </div>
      </div>

      {closed && (
        <AlertBanner
          variant="success"
          message={`Journée clôturée${closure?.signature_name ? ` par ${closure.signature_name}` : ''} — écart ${formatGNF(closure?.variance ?? 0)}`}
        />
      )}

      {error && <AlertBanner message={error} onClose={() => setError('')} />}

      {summary && (
        <div className="stat-grid closure-grid" style={{ marginBottom: '1rem' }}>
          <div className="stat-card"><div className="label">Fond d&apos;ouverture</div><div className="value">{formatGNF(summary.opening_balance)}</div></div>
          <div className="stat-card"><div className="label">Encaissements ventes</div><div className="value">{formatGNF(summary.sales_collected)}</div></div>
          <div className="stat-card"><div className="label">Règlements reçus</div><div className="value">{formatGNF(summary.settlement_collected)}</div></div>
          <div className="stat-card"><div className="label">Recettes manuelles</div><div className="value">{formatGNF(summary.manual_recettes)}</div></div>
          <div className="stat-card"><div className="label">Dépenses manuelles</div><div className="value">{formatGNF(summary.manual_depenses)}</div></div>
          <div className="stat-card stat-card--highlight">
            <div className="label">Solde théorique</div>
            <div className="value">{formatGNF(summary.expected_balance)}</div>
          </div>
          {closed && closure && (
            <>
              <div className="stat-card"><div className="label">Montant compté</div><div className="value">{formatGNF(closure.counted_balance)}</div></div>
              <div className="stat-card"><div className="label">Écart</div><div className="value">{formatGNF(closure.variance)}</div></div>
            </>
          )}
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: '1rem' }}>
        <div className="stat-card"><div className="label">Recettes (journal)</div><div className="value">{formatGNF(data.recettes)}</div></div>
        <div className="stat-card"><div className="label">Dépenses (journal)</div><div className="value">{formatGNF(data.depenses)}</div></div>
        <div className="stat-card"><div className="label">Solde journal</div><div className="value">{formatGNF(data.solde)}</div></div>
      </div>

      {showClose && !closed && summary && (
        <div className="inline-form-panel card-lite closure-form">
          <h4>Clôture de caisse — {date}</h4>
          <p className="form-hint">
            Comptez l&apos;argent réel en caisse (espèces + mobile). Le solde théorique inclut les encaissements système du jour.
          </p>
          <div className="inline-form-grid form-compact">
            <div className="form-group">
              <label>Fond d&apos;ouverture (GNF)</label>
              <input
                type="number"
                min="0"
                value={closeForm.opening_balance}
                onChange={(e) => setCloseForm({ ...closeForm, opening_balance: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Montant compté en caisse (GNF)</label>
              <input
                type="number"
                min="0"
                value={closeForm.counted_balance}
                onChange={(e) => setCloseForm({ ...closeForm, counted_balance: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && closeDay()}
              />
            </div>
            <div className="form-group">
              <label>Responsable (signature)</label>
              <input
                value={closeForm.signature_name}
                onChange={(e) => setCloseForm({ ...closeForm, signature_name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Notes</label>
              <input value={closeForm.notes} onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })} />
            </div>
          </div>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-primary" onClick={closeDay}>Valider la clôture</button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowClose(false)}>Annuler</button>
          </div>
        </div>
      )}

      {showForm && !closed && (
        <div className="inline-form-panel">
          <div className="inline-form-grid form-compact">
            <div className="form-group">
              <label>Type</label>
              <select value={form.transaction_type} onChange={(e) => setForm({ ...form, transaction_type: e.target.value })}>
                <option value="recette">Recette</option>
                <option value="depense">Dépense</option>
              </select>
            </div>
            <div className="form-group"><label>Montant</label><input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="form-group"><label>Description</label><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <button type="button" className="btn btn-primary" onClick={save}>Enregistrer</button>
        </div>
      )}

      <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full">
          <thead>
            <tr>
              <th>Type</th>
              <th className="col-num">Montant</th>
              <th>Description</th>
              <th>Catégorie</th>
              {isAdmin && <th className="col-actions">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(data.transactions || []).length === 0 ? (
              <tr><td colSpan={isAdmin ? 5 : 4} className="table-empty">Aucune opération ce jour</td></tr>
            ) : data.transactions.map((t) => (
              <tr key={t.id}>
                <td>{cashTransactionTypeLabel(t)}</td>
                <td className="col-num">{formatGNF(t.amount)}</td>
                <td>
                  {t.description || '—'}
                  {t.reference_type && (
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Lié : {formatCashReference(t)}
                    </span>
                  )}
                </td>
                <td>{t.category}</td>
                {isAdmin && (
                  <td className="actions-cell">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => deleteTransaction(t)}
                      title="Supprimer cette opération"
                    >
                      Supprimer
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {(data.transactions || []).length > 0 && (
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td><strong>Total journal ({data.transactions.length})</strong></td>
                <td className="col-num"><strong>{formatGNF(txTotals.net)}</strong></td>
                <td colSpan={isAdmin ? 3 : 2}>
                  Recettes {formatGNF(txTotals.recettes)} · Dépenses {formatGNF(txTotals.depenses)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
