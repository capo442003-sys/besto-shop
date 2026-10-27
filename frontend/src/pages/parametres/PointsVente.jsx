import { useEffect, useState, useRef } from 'react';
import api from '../../api/client';
import { useConfirm } from '../../context/ConfirmContext';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';
import AlertBanner from '../../components/AlertBanner';
import BmbFormModal from '../../components/BmbFormModal';

const emptyForm = { code: '', name: '' };

export default function PointsVente() {
  const [list, setList] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editPoint, setEditPoint] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const confirm = useConfirm();
  const notify = useNotify();
  const nameInputRef = useRef(null);

  const focusNameField = () => {
    window.setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  useEffect(() => {
    if (showForm) focusNameField();
  }, [showForm]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/settings/delivery-points');
      setList(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.response?.data?.message || 'Impossible de charger les points de vente');
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    setError('');
    if (!code || !name) {
      setError('Le code et le nom sont requis');
      return;
    }
    const ok = await confirm({
      title: editPoint ? 'Modifier le point de vente' : 'Créer un point de vente',
      message: editPoint
        ? `Enregistrer les modifications pour « ${code} — ${name} » ?`
        : `Créer le point de vente « ${code} — ${name} » ?`,
      confirmLabel: editPoint ? 'Enregistrer' : 'Créer',
    });
    if (!ok) return;
    try {
      if (editPoint) {
        await api.put(`/settings/delivery-points/${editPoint.id}`, { code, name, is_active: true });
        notify.success('Point de vente modifié');
        closeForm();
      } else {
        await api.post('/settings/delivery-points', { code, name });
        notify.success('Point de vente créé');
        setForm(emptyForm);
        setEditPoint(null);
        setError('');
        focusNameField();
      }
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible d\'enregistrer le point de vente'));
    }
  };

  const deletePoint = async (p) => {
    const ok = await confirm({
      title: 'Supprimer le point de vente',
      message: `Le point « ${p.code} — ${p.name} » sera supprimé définitivement (irréversible). Continuer ?`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/settings/delivery-points/${p.id}`);
      notify.success(`Point de vente ${p.code} supprimé`);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible de supprimer le point de vente'));
    }
  };

  const openEdit = (p) => {
    setEditPoint(p);
    setForm({ code: p.code, name: p.name });
    setShowForm(true);
  };

  const openCreate = () => {
    closeForm();
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditPoint(null);
    setForm(emptyForm);
    setError('');
  };

  return (
    <>
      <div className="card table-main">
        <div className="table-main-toolbar">
          <h3>Points de vente</h3>
          <button type="button" className="btn btn-accent" onClick={openCreate}>+ Ajouter</button>
        </div>

        {error && !showForm && <AlertBanner message={error} onClose={() => setError('')} />}

        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Chargement...</p>
        ) : (
          <div className="bmb-data-table-wrap table-scroll">
            <table className="bmb-data-table table-full">
              <thead>
                <tr><th>Code</th><th>Nom</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {list.length === 0 ? (
                  <tr><td colSpan={3} className="table-empty">Aucun point de vente</td></tr>
                ) : list.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.code}</strong></td>
                    <td>{p.name}</td>
                    <td className="actions-cell">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(p)}>Modifier</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => deletePoint(p)}>Supprimer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {list.length > 0 && (
                <tfoot>
                  <tr className="bmb-data-table-total-row">
                    <td colSpan={3}><strong>Total ({list.length} point{list.length > 1 ? 's' : ''} de vente)</strong></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      <BmbFormModal
        open={showForm}
        onClose={closeForm}
        title={editPoint ? `Modifier — ${editPoint.code}` : 'Nouveau point de vente'}
        titleId="delivery-point-form-title"
      >
        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <div className="inline-form-grid form-compact">
          <div className="form-group">
            <label>Code (ex. PV1)</label>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="PV4"
              maxLength={10}
            />
          </div>
          <div className="form-group">
            <label>Nom</label>
            <input
              ref={nameInputRef}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Point de vente 4"
            />
          </div>
        </div>
        <div className="btn-group" style={{ marginTop: '1rem' }}>
          <button type="button" className="btn btn-primary" onClick={save}>
            {editPoint ? 'Enregistrer' : 'Créer'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={closeForm}>Annuler</button>
        </div>
      </BmbFormModal>
    </>
  );
}
