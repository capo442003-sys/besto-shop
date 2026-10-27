import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { formatDate } from '../../utils/format';
import { formatAuditAction, formatAuditDetails, formatAuditEntityType } from '../../utils/auditFormat';
import { useNotify } from '../../hooks/useNotify';
import { useConfirm } from '../../context/ConfirmContext';
import { useStoreSettings } from '../../context/StoreSettingsContext';
import { downloadReportPdf } from '../../utils/printReportPdf';

const ACTION_OPTIONS = [
  { value: '', label: 'Toutes les actions' },
  { value: 'create', label: 'Création' },
  { value: 'update', label: 'Modification' },
  { value: 'delete', label: 'Suppression' },
  { value: 'deactivate', label: 'Désactivation' },
  { value: 'validate', label: 'Validation' },
  { value: 'payment', label: 'Encaissement' },
  { value: 'cancel', label: 'Annulation' },
  { value: 'import', label: 'Import' },
  { value: 'inventory', label: 'Inventaire' },
  { value: 'restock', label: 'Ravitaillement' },
];

const DEFAULT_FILTERS = {
  search: '',
  user_id: '',
  action: '',
  entity_type: '',
  date_from: '',
  date_to: '',
  limit: 300,
};

export default function JournalAudit() {
  const [list, setList] = useState([]);
  const [users, setUsers] = useState([]);
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const { store } = useStoreSettings();
  const notify = useNotify();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const confirm = useConfirm();

  const load = useCallback((filters = appliedFilters) => {
    setLoading(true);
    const params = Object.fromEntries(
      Object.entries(filters).filter(([, v]) => v != null && v !== '')
    );
    return api.get('/audit', { params })
      .then((r) => setList(r.data))
      .catch((err) => notifyRef.current.apiError(err, 'Impossible de charger le journal d\'audit'))
      .finally(() => setLoading(false));
  }, [appliedFilters]);

  useEffect(() => {
    api.get('/audit/users').then((r) => setUsers(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    load(appliedFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- charge uniquement quand les filtres appliqués changent
  }, [appliedFilters]);

  const applyFilters = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const exportPdf = async () => {
    if (!list.length) {
      notify.error('Aucune entrée à exporter — appliquez les filtres d\'abord');
      return;
    }
    setExportingPdf(true);
    try {
      const filterLabels = [
        { label: 'Recherche', value: appliedFilters.search },
        { label: 'Utilisateur', value: users.find((u) => String(u.id) === String(appliedFilters.user_id))?.full_name || appliedFilters.user_id },
        { label: 'Action', value: appliedFilters.action ? formatAuditAction(appliedFilters.action) : '' },
        { label: 'Type', value: appliedFilters.entity_type },
        { label: 'Du', value: appliedFilters.date_from },
        { label: 'Au', value: appliedFilters.date_to },
      ];
      await downloadReportPdf({
        store,
        title: 'Journal d\'audit',
        subtitle: 'Historique des actions sensibles',
        filters: filterLabels,
        head: ['Date', 'Utilisateur', 'Action', 'Entité', 'Détails'],
        body: list.map((a) => [
          formatDate(a.created_at),
          a.full_name || a.username || '—',
          formatAuditAction(a.action),
          formatAuditEntityType(a.entity_type),
          formatAuditDetails(a),
        ]),
        foot: [[`Total (${list.length} entrée${list.length > 1 ? 's' : ''})`, '', '', '', '']],
        filename: `journal-audit-${new Date().toISOString().slice(0, 10)}.pdf`,
        footerNote: 'Document généré par BESTO SHOP',
      });
      notify.success('PDF exporté');
    } catch (err) {
      notify.apiError(err, 'Export PDF impossible');
    } finally {
      setExportingPdf(false);
    }
  };

  const exportCsv = async () => {
    try {
      const params = Object.fromEntries(
        Object.entries(appliedFilters).filter(([, v]) => v != null && v !== '')
      );
      const { data } = await api.get('/audit/export', { params, responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `journal-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify.apiError(err, 'Export impossible');
    }
  };

  const purgeOld = async () => {
    const ok = await confirm({
      title: 'Nettoyer l\'historique',
      message: 'Supprimer les entrées d\'audit de plus de 12 mois ? Cette action est irréversible.',
      confirmLabel: 'Nettoyer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { data } = await api.post('/audit/purge', { retention_months: 12 });
      notify.success(data.message || 'Historique nettoyé');
      load(appliedFilters);
    } catch (err) {
      notify.apiError(err, 'Échec du nettoyage');
    }
  };

  const runBackup = async () => {
    const ok = await confirm({
      title: 'Sauvegarde base de données',
      message: 'Lancer une sauvegarde PostgreSQL maintenant ? (pg_dump requis sur le serveur)',
      confirmLabel: 'Sauvegarder',
    });
    if (!ok) return;
    try {
      const { data } = await api.post('/backups/run');
      notify.success(data.message || 'Sauvegarde terminée');
    } catch (err) {
      notify.apiError(err, 'Échec de la sauvegarde');
    }
  };

  return (
    <div className="card table-main">
      <div className="table-main-toolbar">
        <h3>Journal d&apos;audit</h3>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => load(appliedFilters)}
            disabled={loading}
          >
            Actualiser
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv}>
            Export CSV
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportPdf} disabled={exportingPdf || loading}>
            {exportingPdf ? 'PDF…' : 'Export PDF'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={runBackup}>
            Sauvegarde BDD
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={purgeOld}>
            Purger &gt; 12 mois
          </button>
        </div>
      </div>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Historique des actions sensibles. Rétention recommandée : 12 mois.
      </p>

      <div className="bmb-filters-panel" style={{ marginBottom: '1rem' }}>
        <div className="bmb-filters-panel__item">
          <label>Recherche</label>
          <input
            value={draftFilters.search}
            onChange={(e) => setDraftFilters({ ...draftFilters, search: e.target.value })}
            placeholder="Utilisateur, action, détails…"
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
          />
        </div>
        <div className="bmb-filters-panel__item">
          <label>Utilisateur</label>
          <select value={draftFilters.user_id} onChange={(e) => setDraftFilters({ ...draftFilters, user_id: e.target.value })}>
            <option value="">Tous</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
            ))}
          </select>
        </div>
        <div className="bmb-filters-panel__item">
          <label>Action</label>
          <select value={draftFilters.action} onChange={(e) => setDraftFilters({ ...draftFilters, action: e.target.value })}>
            {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="bmb-filters-panel__item">
          <label>Type entité</label>
          <input
            value={draftFilters.entity_type}
            onChange={(e) => setDraftFilters({ ...draftFilters, entity_type: e.target.value })}
            placeholder="ex. product, client"
          />
        </div>
        <div className="bmb-filters-panel__item">
          <label>Du</label>
          <input type="date" value={draftFilters.date_from} onChange={(e) => setDraftFilters({ ...draftFilters, date_from: e.target.value })} />
        </div>
        <div className="bmb-filters-panel__item">
          <label>Au</label>
          <input type="date" value={draftFilters.date_to} onChange={(e) => setDraftFilters({ ...draftFilters, date_to: e.target.value })} />
        </div>
        <div className="bmb-filters-panel__item" style={{ alignSelf: 'end' }}>
          <button type="button" className="btn btn-primary" onClick={applyFilters} disabled={loading}>
            Filtrer
          </button>
        </div>
      </div>

      <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full">
          <thead>
            <tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Entité</th><th>Détails</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="table-empty">Chargement…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={5} className="table-empty">Aucune entrée</td></tr>
            ) : list.map((a) => (
              <tr key={a.id}>
                <td>{formatDate(a.created_at)}</td>
                <td>{a.full_name || a.username}</td>
                <td>{formatAuditAction(a.action)}</td>
                <td>{formatAuditEntityType(a.entity_type)}</td>
                <td style={{ fontSize: '.85rem', maxWidth: 420 }}>{formatAuditDetails(a)}</td>
              </tr>
            ))}
          </tbody>
          {list.length > 0 && !loading && (
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td colSpan={5}><strong>{list.length} entrée{list.length > 1 ? 's' : ''}</strong></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
