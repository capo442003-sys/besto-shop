import { useEffect, useState, useMemo, useCallback } from 'react';
import api from '../../api/client';
import { formatGNF, formatCashReference, cashTransactionTypeLabel } from '../../utils/format';
import { sumCashTransactionsBreakdown, isExcludedVoidedCashTx } from '../../utils/calculations';
import EmptyState from '../../components/ui/EmptyState';
import TableSkeleton from '../../components/ui/TableSkeleton';
import DataCard from '../../components/ui/DataCard';
import ResponsiveDataView from '../../components/ui/ResponsiveDataView';
import { useNotify } from '../../hooks/useNotify';
import { useAuth } from '../../context/AuthContext';
import { stockQueryParams } from '../../utils/pvScope';
import { useConfirm } from '../../context/ConfirmContext';
import { useSocket } from '../../hooks/useSocket';

function parseTransactionsResponse(data) {
  if (Array.isArray(data)) {
    return { items: data, summary: null, truncated: false };
  }
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    summary: data?.summary ?? null,
    truncated: Boolean(data?.truncated),
  };
}

function filterSummary(filters) {
  const parts = [];
  if (filters.date_from) parts.push(`du ${filters.date_from}`);
  if (filters.date_to) parts.push(`au ${filters.date_to}`);
  if (filters.scope === 'manuel') parts.push('opérations manuelles');
  else if (filters.scope === 'ventes') parts.push('ventes & annulations');
  else if (filters.scope === 'bc') parts.push('bons de commande');
  if (filters.type === 'recette') parts.push('recettes uniquement');
  if (filters.type === 'depense') parts.push('sorties uniquement');
  return parts.length ? parts.join(' · ') : 'toutes les opérations';
}

function parseSummaryBreakdown(summary) {
  if (!summary) return null;
  return {
    count: summary.count || 0,
    recettes: parseFloat(summary.recettes || 0),
    depenses: parseFloat(summary.depenses || 0),
    net: parseFloat(summary.recettes || 0) - parseFloat(summary.depenses || 0),
    manual_recettes: parseFloat(summary.manual_recettes || 0),
    manual_depenses: parseFloat(summary.manual_depenses || 0),
    sales_collected: parseFloat(summary.sales_collected || 0),
    sales_voided: parseFloat(summary.sales_voided || 0),
    bc_collected: parseFloat(summary.bc_collected || 0),
  };
}

export default function Historique() {
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState(null);
  const [truncated, setTruncated] = useState(false);
  const [filters, setFilters] = useState({ date_from: '', date_to: '', type: '', scope: '' });
  const [loading, setLoading] = useState(false);
  const notify = useNotify();
  const confirm = useConfirm();
  const { userRoles, user } = useAuth();
  const isAdmin = userRoles().includes('administrateur');

  const load = useCallback(() => {
    setLoading(true);
    const params = {
      ...stockQueryParams(user),
      ...Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== '' && v != null)
      ),
    };
    return api.get('/finances/transactions', { params })
      .then((r) => {
        const parsed = parseTransactionsResponse(r.data);
        setList(parsed.items);
        setSummary(parsed.summary);
        setTruncated(parsed.truncated);
      })
      .catch((err) => notify.apiError(err, 'Impossible de charger l\'historique'))
      .finally(() => setLoading(false));
  }, [filters, notify, user]);

  useEffect(() => { load(); }, [load]);

  useSocket((event) => {
    if (event === 'dashboard:refresh' || event === 'cash:closed') load();
  });

  const totals = useMemo(() => {
    const fromApi = parseSummaryBreakdown(summary);
    if (fromApi) return fromApi;
    return sumCashTransactionsBreakdown(list);
  }, [summary, list]);

  const footerLabel = filters.type === 'recette'
    ? 'Total recettes'
    : filters.type === 'depense'
      ? 'Total sorties'
      : 'Solde net caisse';

  const footerAmount = filters.type === 'recette'
    ? totals.recettes
    : filters.type === 'depense'
      ? totals.depenses
      : totals.net;

  const deleteOne = async (tx) => {
    const linked = tx.reference_type
      ? `\n\nLiée à : ${formatCashReference(tx)}.`
      : '';
    const ok = await confirm({
      title: 'Supprimer cette opération',
      message: `Supprimer définitivement « ${cashTransactionTypeLabel(tx)} » de ${formatGNF(tx.amount)} (${tx.cash_date}) ?${linked}\n\nLe tableau de bord sera mis à jour.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { data } = await api.delete(`/finances/transactions/${tx.id}`);
      notify.success(data.message || 'Opération supprimée');
      load();
    } catch (err) {
      notify.apiError(err, 'Suppression impossible');
    }
  };

  const purgeFiltered = async () => {
    if (!totals.count) {
      notify.error('Aucune opération à supprimer pour ces filtres');
      return;
    }
    const ok = await confirm({
      title: 'Supprimer l\'historique filtré',
      message: `Supprimer définitivement ${totals.count} opération(s) (${filterSummary(filters)}) ?\n\nCette action est irréversible. Les totaux du tableau de bord seront recalculés.`,
      confirmLabel: `Supprimer ${totals.count} opération(s)`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== '' && v != null)
      );
      const { data } = await api.post('/finances/transactions/purge', params);
      notify.success(data.message || 'Historique supprimé');
      load();
    } catch (err) {
      notify.apiError(err, 'Suppression impossible');
    }
  };

  const isOutflow = (t) => t.transaction_type === 'depense';

  return (
    <div className="card table-main">
      <div className="table-main-toolbar">
        <h3>Historique recettes & dépenses</h3>
        {isAdmin && (
          <div className="toolbar-actions">
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={purgeFiltered}
              disabled={loading || !totals.count}
              title="Supprimer toutes les opérations correspondant aux filtres"
            >
              Supprimer l&apos;historique filtré
            </button>
          </div>
        )}
      </div>
      <p className="table-main-toolbar__hint" style={{ marginTop: 0 }}>
        Toutes les opérations sont listées. Les ventes annulées restent visibles mais sont exclues des totaux.
      </p>
      <div className="bmb-filters-panel">
        <div className="bmb-filters-panel__item">
          <label>Date début</label>
          <input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} />
        </div>
        <div className="bmb-filters-panel__item">
          <label>Date fin</label>
          <input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} />
        </div>
        <div className="bmb-filters-panel__item">
          <label>Origine</label>
          <select className="filter-select" value={filters.scope} onChange={(e) => setFilters({ ...filters, scope: e.target.value })} style={{ width: '100%' }}>
            <option value="">Toutes</option>
            <option value="manuel">Manuel (caisse)</option>
            <option value="ventes">Ventes & annulations</option>
            <option value="bc">Bons de commande</option>
          </select>
        </div>
        <div className="bmb-filters-panel__item">
          <label>Type</label>
          <select className="filter-select" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} style={{ width: '100%' }}>
            <option value="">Tous</option>
            <option value="recette">Entrées</option>
            <option value="depense">Sorties</option>
          </select>
        </div>
        <div className="bmb-filters-panel__item" style={{ alignSelf: 'end' }}>
          <button type="button" className="btn btn-primary" onClick={load} disabled={loading}>
            {loading ? 'Chargement…' : 'Rechercher'}
          </button>
        </div>
      </div>
      {truncated && (
        <p className="vente-form-panel__hint" style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--warning)' }}>
          Liste limitée à 500 lignes — les totaux incluent les {totals.count} opérations correspondant aux filtres.
        </p>
      )}
      {loading ? (
        <TableSkeleton rows={8} columns={4} />
      ) : (
        <ResponsiveDataView
          cards={
            list.length === 0 ? (
              <EmptyState
                icon="💰"
                title="Aucune transaction"
                description={filterSummary(filters) !== 'toutes les opérations'
                  ? `Aucune opération pour : ${filterSummary(filters)}.`
                  : 'Les recettes et dépenses de caisse apparaîtront ici.'}
                compact
              />
            ) : list.map((t) => {
              const excluded = isExcludedVoidedCashTx(t);
              const outflow = isOutflow(t);
              return (
                <DataCard
                  key={t.id}
                  title={cashTransactionTypeLabel(t)}
                  subtitle={t.cash_date}
                  badge={(
                    <span className={outflow ? 'bmb-amount--danger' : undefined} style={outflow ? undefined : { color: 'var(--success)' }}>
                      {outflow ? '−' : '+'}
                      {formatGNF(t.amount)}
                    </span>
                  )}
                  fields={[
                    { label: 'Description', value: t.description || '—' },
                    ...(t.reference_type
                      ? [{ label: 'Lié à', value: formatCashReference(t) }]
                      : []),
                    ...(excluded
                      ? [{ label: 'Statut', value: 'Exclu des totaux (vente annulée)' }]
                      : []),
                  ]}
                  actions={isAdmin ? (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => deleteOne(t)}
                    >
                      Supprimer
                    </button>
                  ) : null}
                />
              );
            })
          }
          table={(
      <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th className="col-num">Montant</th>
              <th>Description</th>
              {isAdmin && <th className="col-actions">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={isAdmin ? 5 : 4} className="table-empty">Aucune transaction</td></tr>
            ) : list.map((t) => {
              const excluded = isExcludedVoidedCashTx(t);
              return (
              <tr key={t.id} style={excluded ? { opacity: 0.65 } : undefined}>
                <td>{t.cash_date}</td>
                <td>
                  {cashTransactionTypeLabel(t)}
                  {excluded && (
                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--warning)' }}>
                      Exclu des totaux (vente annulée)
                    </span>
                  )}
                </td>
                <td className="col-num" style={isOutflow(t) ? { color: 'var(--danger)' } : undefined}>
                  {isOutflow(t) ? '−' : '+'}
                  {formatGNF(t.amount)}
                </td>
                <td>
                  {t.description || '—'}
                  {t.reference_type && (
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Lié : {formatCashReference(t)}
                    </span>
                  )}
                </td>
                {isAdmin && (
                  <td className="actions-cell">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => deleteOne(t)}
                      title="Supprimer cette opération"
                    >
                      Supprimer
                    </button>
                  </td>
                )}
              </tr>
            );})}
          </tbody>
          {totals.count > 0 && (
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td colSpan={2}>
                  <strong>{footerLabel} ({totals.count})</strong>
                  {!filters.type && (
                    <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                      Encaissements ventes {formatGNF(totals.sales_collected)}
                      {totals.bc_collected > 0 ? ` · BC ${formatGNF(totals.bc_collected)}` : ''}
                      {totals.manual_recettes > 0 ? ` · Recettes manuelles ${formatGNF(totals.manual_recettes)}` : ''}
                      {totals.manual_depenses > 0 ? ` · Dépenses manuelles ${formatGNF(totals.manual_depenses)}` : ''}
                    </span>
                  )}
                </td>
                <td className="col-num"><strong>{formatGNF(footerAmount)}</strong></td>
                <td colSpan={isAdmin ? 2 : 1} />
              </tr>
              {!filters.type && (
                <tr className="bmb-data-table-total-row">
                  <td colSpan={isAdmin ? 5 : 4} style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    <strong>Dépenses manuelles :</strong>{' '}
                    {totals.manual_depenses > 0.005 ? formatGNF(totals.manual_depenses) : 'aucune'}
                  </td>
                </tr>
              )}
            </tfoot>
          )}
        </table>
      </div>
          )}
        />
      )}
    </div>
  );
}
