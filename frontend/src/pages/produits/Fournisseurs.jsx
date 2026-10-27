import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import api from '../../api/client';
import PrintReport from '../../components/PrintReport';
import PrintPreviewModal from '../../components/PrintPreviewModal';
import { downloadReportPdf } from '../../utils/printReportPdf';
import { suggestPrintOrientation } from '../../utils/printOrientation';
import { useStoreSettings } from '../../context/StoreSettingsContext';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';
import AlertBanner from '../../components/AlertBanner';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import BmbFormModal from '../../components/BmbFormModal';

const emptyForm = { name: '', status: 'entreprise', product_type_id: '', address: '', country: '', city: '', contact: '' };

const STATUS_LABELS = {
  entreprise: 'Entreprise',
  particulier: 'Particulier',
  cooperative: 'Coopérative',
  groupement: 'Groupement',
};

const SUPPLIER_COLUMNS = [
  { key: 'code', label: 'Code' },
  { key: 'name', label: 'Nom' },
  { key: 'status', label: 'Statut' },
  { key: 'contact', label: 'Contact' },
  { key: 'city', label: 'Ville' },
];

function statusLabel(value) {
  return STATUS_LABELS[value] || value || '—';
}

export default function Fournisseurs() {
  const { store } = useStoreSettings();
  const { can } = useAuth();
  const [list, setList] = useState([]);
  const [types, setTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const notify = useNotify();
  const confirm = useConfirm();
  const printRef = useRef();
  const nameInputRef = useRef(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [orientation, setOrientation] = useState('portrait');

  const load = () => api.get('/suppliers', { params: { search } }).then((r) => setList(r.data)).catch((e) => {
    setError(apiErrorMessage(e, 'Impossible de charger les fournisseurs'));
  });
  useEffect(() => {
    load();
    api.get('/suppliers/types').then((r) => setTypes(r.data)).catch(() => {});
  }, []);

  const focusNameField = () => {
    window.setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  useEffect(() => {
    if (showForm) focusNameField();
  }, [showForm]);

  const reportFilters = useMemo(() => [
    { label: 'Recherche', value: search.trim() ? `« ${search.trim()} »` : '' },
  ], [search]);

  const reportRows = useMemo(() => list.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    status: statusLabel(s.status),
    contact: s.contact || '—',
    city: s.city || '—',
  })), [list]);

  const reportFoot = useMemo(() => (
    list.length
      ? [{ cells: [{ value: `Total : ${list.length} fournisseur${list.length > 1 ? 's' : ''}`, colSpan: 5 }] }]
      : []
  ), [list.length]);

  const exportPdf = useCallback(() => {
    downloadReportPdf({
      store,
      title: 'Liste des fournisseurs',
      subtitle: 'Répertoire fournisseurs BESTO SHOP',
      filters: reportFilters,
      head: SUPPLIER_COLUMNS.map((c) => c.label),
      body: reportRows.map((r) => SUPPLIER_COLUMNS.map((c) => r[c.key])),
      foot: list.length
        ? [[`Total : ${list.length} fournisseur${list.length > 1 ? 's' : ''}`, '', '', '', '']]
        : [],
      filename: 'liste-fournisseurs.pdf',
      orientation,
    });
  }, [store, reportFilters, reportRows, list.length, orientation]);

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm);
    setError('');
  };

  const openCreate = () => {
    closeForm();
    setShowForm(true);
  };

  const openEdit = (s) => {
    setEditId(s.id);
    setForm({
      name: s.name,
      status: s.status || 'entreprise',
      product_type_id: s.product_type_id || '',
      address: s.address || '',
      country: s.country || '',
      city: s.city || '',
      contact: s.contact || '',
    });
    setShowForm(true);
  };

  const save = async () => {
    setError('');
    if (!form.name?.trim()) {
      setError('Le nom du fournisseur est requis');
      return;
    }
    const ok = await confirm({
      title: editId ? 'Modifier le fournisseur' : 'Ajouter le fournisseur',
      message: editId
        ? `Enregistrer les modifications pour « ${form.name.trim()} » ?`
        : `Créer le fournisseur « ${form.name.trim()} » ?`,
      confirmLabel: editId ? 'Enregistrer' : 'Créer',
    });
    if (!ok) return;
    try {
      if (editId) {
        await api.put(`/suppliers/${editId}`, form);
        notify.success('Fournisseur modifié');
        closeForm();
      } else {
        await api.post('/suppliers', form);
        notify.success('Fournisseur ajouté avec succès');
        setForm(emptyForm);
        setEditId(null);
        setError('');
        focusNameField();
      }
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible d\'enregistrer le fournisseur'));
    }
  };

  const removeSupplier = async (s) => {
    const ok = await confirm({
      title: 'Désactiver le fournisseur',
      message: `« ${s.name} » (${s.code}) sera désactivé.`,
      confirmLabel: 'Désactiver',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/suppliers/${s.id}`);
      notify.success('Fournisseur désactivé');
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible de désactiver'));
    }
  };

  return (
    <>
      {error && !showForm && <AlertBanner message={error} onClose={() => setError('')} className="bmb-print-skip" />}
      {msg && <div className="alert alert-success bmb-print-skip">{msg}</div>}

      <div className="card table-main">
        <div className="table-main-toolbar bmb-print-skip">
          <h3>Fournisseurs</h3>
          <div className="toolbar-actions">
            {can('produits', 'create') && (
              <button type="button" className="btn btn-accent" onClick={openCreate}>+ Ajouter</button>
            )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setOrientation(suggestPrintOrientation(SUPPLIER_COLUMNS.length));
              setPreviewOpen(true);
            }}
          >
            Aperçu / Imprimer
          </button>
          <button type="button" className="btn btn-secondary" onClick={exportPdf}>Exporter PDF</button>
          </div>
        </div>

        <div className="bmb-filters-panel bmb-print-skip">
        <div className="bmb-filters-panel__item" style={{ gridColumn: 'span 2' }}>
          <label>Recherche (nom, code, contact)</label>
          <input
            className="search-input"
            style={{ width: '100%', maxWidth: 'none' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un fournisseur..."
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
        </div>
        <div className="bmb-filters-panel__item" style={{ alignSelf: 'end' }}>
          <button type="button" className="btn btn-primary" onClick={load}>Rechercher</button>
        </div>
      </div>

      <div className="bmb-data-table-wrap table-scroll bmb-print-skip">
        <table className="bmb-data-table table-full">
          <thead><tr><th>Code</th><th>Nom</th><th>Statut</th><th>Contact</th><th>Ville</th><th>Actions</th></tr></thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={6} className="table-empty">Aucun fournisseur</td></tr>
            ) : list.map((s) => (
              <tr key={s.id}>
                <td>{s.code}</td>
                <td>{s.name}</td>
                <td>{statusLabel(s.status)}</td>
                <td>{s.contact || '—'}</td>
                <td>{s.city || '—'}</td>
                <td className="actions-cell">
                  {can('produits', 'edit') && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>Modifier</button>
                  )}
                  {can('produits', 'delete') && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removeSupplier(s)}>Supp.</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td colSpan={6}><strong>Total ({list.length} fournisseur{list.length > 1 ? 's' : ''})</strong></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <PrintPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Aperçu — Liste des fournisseurs"
        orientation={orientation}
        onOrientationChange={setOrientation}
        onExportPdf={exportPdf}
        printRef={printRef}
      >
        <PrintReport
          store={store}
          title="Liste des fournisseurs"
          subtitle="Répertoire fournisseurs BESTO SHOP"
          date={new Date()}
          filters={reportFilters}
          columns={SUPPLIER_COLUMNS}
          rows={reportRows}
          footRows={reportFoot}
          emptyMessage="Aucun fournisseur"
        />
      </PrintPreviewModal>
      </div>

      <BmbFormModal
        open={showForm}
        onClose={closeForm}
        title={editId ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
        titleId="supplier-form-title"
      >
        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <div className="inline-form-grid form-compact">
          <div className="form-group">
            <label>Nom</label>
            <input ref={nameInputRef} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Statut</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="entreprise">Entreprise</option>
              <option value="particulier">Particulier</option>
              <option value="cooperative">Coopérative</option>
              <option value="groupement">Groupement</option>
            </select>
          </div>
          <div className="form-group">
            <label>Type produits</label>
            <select value={form.product_type_id} onChange={(e) => setForm({ ...form, product_type_id: e.target.value })}>
              <option value="">—</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Contact</label><input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
          <div className="form-group"><label>Ville</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div className="form-group"><label>Pays</label><input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
          <div className="form-group vente-form-grid__full">
            <label>Adresse</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
        </div>
        {!editId && (
          <p style={{ marginTop: '.75rem', color: 'var(--text-muted)', fontSize: '.9rem' }}>
            Le code fournisseur est généré automatiquement à l&apos;enregistrement.
          </p>
        )}
        <div className="btn-group" style={{ marginTop: '1rem' }}>
          <button type="button" className="btn btn-primary" onClick={save}>Enregistrer</button>
          <button type="button" className="btn btn-secondary" onClick={closeForm}>Annuler</button>
        </div>
      </BmbFormModal>
    </>
  );
}
