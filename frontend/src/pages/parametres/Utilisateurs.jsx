import { useEffect, useState, useRef } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';
import AlertBanner from '../../components/AlertBanner';
import BmbFormModal from '../../components/BmbFormModal';
import { normalizeRoles } from '../../utils/roles';

const emptyForm = {
  username: '',
  password: '',
  full_name: '',
  roles: ['vendeur'],
  is_active: true,
  delivery_point_ids: [],
};

const ROLE_LABELS = {
  vendeur: 'Vendeur',
  caissier: 'Caissier',
  controleur: 'Contrôleur',
  gestionnaire: 'Gestionnaire',
  comptable: 'Comptable',
  assistant: 'Assistant',
  responsable_zone: 'Responsable de zone',
  administrateur: 'Administrateur',
};

const FALLBACK_ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([code, label]) => ({ code, label }));

export default function Utilisateurs() {
  const { user: currentUser, refreshUser } = useAuth();
  const [list, setList] = useState([]);
  const [roleOptions, setRoleOptions] = useState(FALLBACK_ROLE_OPTIONS);
  const [deliveryPoints, setDeliveryPoints] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
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
      const { data } = await api.get('/settings/users');
      const users = Array.isArray(data) ? data : [];
      setList(users.map((u) => ({
        ...u,
        roles: normalizeRoles(u.roles, u.role),
      })));
    } catch (e) {
      setError(e.response?.data?.message || 'Impossible de charger les utilisateurs');
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    api.get('/settings/roles')
      .then((r) => {
        if (Array.isArray(r.data) && r.data.length) setRoleOptions(r.data);
      })
      .catch(() => setRoleOptions(FALLBACK_ROLE_OPTIONS));
    api.get('/delivery-points').then((r) => setDeliveryPoints(r.data || [])).catch(() => {});
  }, []);

  const toggleRole = (code) => {
    setForm((f) => {
      const current = normalizeRoles(f.roles);
      const has = current.includes(code);
      const roles = has ? current.filter((r) => r !== code) : [...current, code];
      return { ...f, roles: roles.length ? roles : [code] };
    });
  };

  const formatRoles = (roles, fallbackRole) => {
    return normalizeRoles(roles, fallbackRole)
      .map((r) => ROLE_LABELS[r] || r)
      .join(', ');
  };

  const save = async () => {
    setError('');
    if (!form.full_name?.trim() || !form.username?.trim()) {
      setError('Le nom et l\'identifiant sont requis');
      return;
    }
    const roles = normalizeRoles(form.roles);
    if (!roles.length) {
      setError('Sélectionnez au moins un rôle');
      return;
    }
    if (roles.includes('responsable_zone') && !form.delivery_point_ids?.length) {
      setError('Sélectionnez au moins un point de vente pour le responsable de zone');
      return;
    }
    const ok = await confirm({
      title: editUser ? 'Modifier l\'utilisateur' : 'Créer un utilisateur',
      message: editUser
        ? `Enregistrer les modifications du compte « ${form.username.trim()} » ?`
        : `Créer le compte « ${form.username.trim()} » ?`,
      confirmLabel: editUser ? 'Enregistrer' : 'Créer',
    });
    if (!ok) return;
    try {
      if (editUser) {
        await api.put(`/settings/users/${editUser.id}`, {
          username: form.username.trim(),
          full_name: form.full_name.trim(),
          password: form.password || undefined,
          roles,
          is_active: form.is_active,
          delivery_point_ids: roles.includes('responsable_zone') ? form.delivery_point_ids : [],
        });
        notify.success('Utilisateur modifié');
        if (editUser.id === currentUser?.id) {
          await refreshUser();
        }
      } else {
        if (!form.password) {
          setError('Mot de passe requis pour un nouveau compte');
          return;
        }
        await api.post('/settings/users', {
          username: form.username.trim(),
          full_name: form.full_name.trim(),
          password: form.password,
          roles,
          delivery_point_ids: roles.includes('responsable_zone') ? form.delivery_point_ids : [],
        });
        notify.success('Compte utilisateur créé');
        setForm(emptyForm);
        setEditUser(null);
        setError('');
        focusNameField();
      }
      if (editUser) closeForm();
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible d\'enregistrer l\'utilisateur'));
    }
  };

  const removeUser = async (u) => {
    if (currentUser?.id === u.id) {
      setError('Vous ne pouvez pas supprimer votre propre compte');
      return;
    }
    const ok = await confirm({
      title: 'Supprimer l\'utilisateur',
      message: `Le compte « ${u.username} — ${u.full_name} » sera supprimé définitivement (irréversible). Continuer ?`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    setError('');
    try {
      await api.delete(`/settings/users/${u.id}`);
      notify.success(`Utilisateur ${u.username} supprimé`);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible de supprimer l\'utilisateur'));
    }
  };

  const openEdit = async (u) => {
    setEditUser(u);
    let delivery_point_ids = [];
    try {
      const { data } = await api.get(`/settings/users/${u.id}`);
      delivery_point_ids = data.delivery_point_ids || [];
    } catch {
      delivery_point_ids = [];
    }
    setForm({
      username: u.username,
      password: '',
      full_name: u.full_name,
      roles: normalizeRoles(u.roles, u.role),
      is_active: u.is_active !== false,
      delivery_point_ids: delivery_point_ids.map(String),
    });
    setShowForm(true);
  };

  const toggleDeliveryPoint = (id) => {
    const sid = String(id);
    setForm((f) => {
      const current = (f.delivery_point_ids || []).map(String);
      const next = current.includes(sid) ? current.filter((x) => x !== sid) : [...current, sid];
      return { ...f, delivery_point_ids: next };
    });
  };

  const openCreate = () => {
    closeForm();
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditUser(null);
    setForm(emptyForm);
    setError('');
  };

  const formRoles = normalizeRoles(form.roles);

  return (
    <>
      <div className="card table-main">
        <div className="table-main-toolbar">
          <h3>Utilisateurs</h3>
          <button type="button" className="btn btn-accent" onClick={openCreate}>+ Créer un compte</button>
        </div>

        {error && !showForm && <AlertBanner message={error} onClose={() => setError('')} />}

        {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Chargement...</p>
      ) : (
        <div className="bmb-data-table-wrap table-scroll">
          <table className="bmb-data-table table-full">
            <thead>
              <tr><th>Nom</th><th>Utilisateur</th><th>Rôles</th><th>Rôle principal</th><th>Actif</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr><td colSpan={6} className="table-empty">Aucun utilisateur</td></tr>
              ) : list.map((u) => (
                <tr key={u.id} style={!u.is_active ? { opacity: 0.65 } : undefined}>
                  <td>{u.full_name}</td>
                  <td>{u.username}</td>
                  <td>{formatRoles(u.roles, u.role)}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td>{u.is_active ? 'Oui' : 'Non'}</td>
                  <td className="actions-cell">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(u)}>Modifier</button>
                    {currentUser?.id !== u.id && (
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => removeUser(u)}>Supprimer</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr className="bmb-data-table-total-row">
                  <td colSpan={6}><strong>Total ({list.length} utilisateur{list.length > 1 ? 's' : ''})</strong></td>
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
        title={editUser ? `Modifier — ${editUser.username}` : 'Nouveau compte utilisateur'}
        titleId="user-form-title"
      >
        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}
        <div className="inline-form-grid form-compact">
          <div className="form-group">
            <label>Nom complet</label>
            <input
              ref={nameInputRef}
              value={form.full_name}
              autoComplete="name"
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Nom d&apos;utilisateur</label>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{editUser ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe'}</label>
            <input
              type="password"
              value={form.password}
              placeholder={editUser ? 'Laisser vide pour ne pas changer' : ''}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          {editUser && (
            <div className="form-group" style={{ alignSelf: 'end' }}>
              <label className="roles-checkbox-item" style={{ marginTop: '1.2rem' }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                <span>Compte actif</span>
              </label>
            </div>
          )}
        </div>

        <div className="roles-checkbox-group">
          <label className="roles-checkbox-label">Rôles (plusieurs choix possibles)</label>
          <div className="roles-checkbox-list">
            {roleOptions.map((r) => (
              <label key={r.code} className="roles-checkbox-item">
                <input
                  type="checkbox"
                  checked={formRoles.includes(r.code)}
                  onChange={() => toggleRole(r.code)}
                />
                <span>{r.label}</span>
              </label>
            ))}
          </div>
        </div>

        {formRoles.includes('responsable_zone') && (
          <div className="roles-checkbox-group" style={{ marginTop: '0.75rem' }}>
            <label className="roles-checkbox-label">Points de vente accessibles *</label>
            <div className="roles-checkbox-list">
              {deliveryPoints.map((dp) => (
                <label key={dp.id} className="roles-checkbox-item">
                  <input
                    type="checkbox"
                    checked={(form.delivery_point_ids || []).map(String).includes(String(dp.id))}
                    onChange={() => toggleDeliveryPoint(dp.id)}
                  />
                  <span>{dp.code} — {dp.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="btn-group" style={{ marginTop: '1rem' }}>
          <button type="button" className="btn btn-primary" onClick={save}>
            {editUser ? 'Enregistrer' : 'Créer le compte'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={closeForm}>Annuler</button>
        </div>
      </BmbFormModal>
    </>
  );
}
