import { useEffect, useState, useMemo, useRef } from 'react';
import api from '../../api/client';
import { useStoreSettings } from '../../context/StoreSettingsContext';
import { formatGNF, employeeFunctionLabel, EMPLOYEE_FUNCTIONS } from '../../utils/format';
import { downloadEmployeeCardPdf, downloadAllEmployeeCardsPdf } from '../../utils/employeeCardPdf';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import BmbFormModal from '../../components/BmbFormModal';

const emptyForm = { name: '', function: 'vendeur', delivery_point_id: '', monthly_salary: '', address: '', contact: '', hire_date: '', is_active: true, create_account: true, account_username: '', account_password: 'bmb1234' };

const PV_REQUIRED_FUNCTIONS = ['vendeur', 'caissier', 'vendeur_caissier', 'gestionnaire'];

export default function ListeEmployes() {
  const { store } = useStoreSettings();
  const { can, userRoles } = useAuth();
  const isAdmin = userRoles().includes('administrateur');
  const [list, setList] = useState([]);
  const [deliveryPoints, setDeliveryPoints] = useState([]);
  const [employeeSummary, setEmployeeSummary] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState('success');
  const [cardLoading, setCardLoading] = useState(null);
  const confirm = useConfirm();
  const nameInputRef = useRef(null);

  const load = () => api.get('/employees', { params: { include_inactive: '1' } }).then((r) => {
    const data = r.data;
    if (Array.isArray(data)) {
      setList(data);
      setEmployeeSummary(null);
    } else {
      setList(data.items || []);
      setEmployeeSummary(data.summary || null);
    }
  });
  useEffect(() => {
    load();
    api.get('/delivery-points').then((r) => setDeliveryPoints(r.data || [])).catch(() => {});
  }, []);

  const focusNameField = () => {
    window.setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  useEffect(() => {
    if (showForm) focusNameField();
  }, [showForm]);

  const totalSalary = useMemo(
    () => (employeeSummary
      ? parseFloat(employeeSummary.total_salary || 0)
      : list.reduce((s, e) => s + (parseFloat(e.monthly_salary) || 0), 0)),
    [employeeSummary, list]
  );

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
    setForm(emptyForm);
  };

  const openCreate = () => {
    closeForm();
    setShowForm(true);
  };

  const openEdit = (e) => {
    setEditId(e.id);
    setForm({
      name: e.name,
      function: e.function || 'vendeur',
      delivery_point_id: e.delivery_point_id ? String(e.delivery_point_id) : '',
      monthly_salary: e.monthly_salary ?? '',
      address: e.address || '',
      contact: e.contact || '',
      hire_date: e.hire_date ? String(e.hire_date).slice(0, 10) : '',
      is_active: e.is_active !== false,
      create_account: false,
      account_username: '',
      account_password: '',
    });
    setShowForm(true);
  };

  const showMsg = (text, type = 'success') => {
    setMsg(text);
    setMsgType(type);
  };

  const save = async () => {
    if (!form.name?.trim()) {
      showMsg('Nom requis', 'error');
      return;
    }
    if (!editId && !can('employes', 'create')) {
      showMsg('Vous n\'avez pas le droit d\'ajouter un employé', 'error');
      return;
    }
    if (PV_REQUIRED_FUNCTIONS.includes(form.function) && !form.delivery_point_id) {
      showMsg('Point de vente requis pour cette fonction (vendeur, caissier ou gestionnaire)', 'error');
      return;
    }
    const ok = await confirm({
      title: editId ? 'Modifier l\'employé' : 'Ajouter l\'employé',
      message: editId
        ? `Enregistrer les modifications pour « ${form.name.trim()} » ?`
        : `Créer la fiche employé pour « ${form.name.trim()} » ?`,
      confirmLabel: editId ? 'Enregistrer' : 'Créer',
    });
    if (!ok) return;
    try {
      if (editId) {
        await api.put(`/employees/${editId}`, {
          name: form.name,
          function: form.function,
          delivery_point_id: form.delivery_point_id || null,
          monthly_salary: form.monthly_salary || null,
          address: form.address,
          contact: form.contact,
          hire_date: form.hire_date || null,
          is_active: form.is_active,
        });
        showMsg('Employé modifié');
        closeForm();
      } else {
        const payload = {
          name: form.name.trim(),
          function: form.function,
          delivery_point_id: form.delivery_point_id || null,
          monthly_salary: form.monthly_salary || null,
          address: form.address || null,
          contact: form.contact || null,
          hire_date: form.hire_date || null,
          create_account: Boolean(form.create_account),
          account_username: form.account_username?.trim() || undefined,
          account_password: form.account_password || undefined,
        };
        const { data } = await api.post('/employees', payload);
        showMsg(data.user_username
          ? `Employé ajouté — compte : ${data.user_username} / mot de passe initial`
          : `Employé ajouté — matricule ${data.matricule}`);
        setForm(emptyForm);
        setEditId(null);
        focusNameField();
      }
      load();
    } catch (e) {
      showMsg(e.response?.data?.message || 'Erreur lors de l\'enregistrement', 'error');
    }
  };

  const deactivateEmployee = async (e) => {
    const ok = await confirm({
      title: 'Désactiver l\'employé',
      message: `« ${e.name} » (${e.matricule}) sera désactivé et ne pourra plus se connecter.`,
      confirmLabel: 'Désactiver',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.put(`/employees/${e.id}`, {
        name: e.name,
        function: e.function,
        delivery_point_id: e.delivery_point_id || null,
        monthly_salary: e.monthly_salary ?? null,
        address: e.address,
        contact: e.contact,
        hire_date: e.hire_date || null,
        is_active: false,
      });
      showMsg(`Employé ${e.name} désactivé`);
      load();
    } catch (err) {
      showMsg(err.response?.data?.message || 'Erreur', 'error');
    }
  };

  const removeEmployee = async (e) => {
    const ok = await confirm({
      title: 'Supprimer l\'employé',
      message: `« ${e.name} » (${e.matricule}) sera supprimé définitivement.\n\nSon compte de connexion sera aussi supprimé. Les ventes passées seront conservées.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/employees/${e.id}`);
      showMsg(`Employé ${e.name} supprimé`);
      load();
    } catch (err) {
      showMsg(err.response?.data?.message || 'Erreur', 'error');
    }
  };

  const generateCard = async (employee) => {
    setCardLoading(employee.id);
    setMsg('');
    try {
      await downloadEmployeeCardPdf(employee, store);
      setMsg(`Carte générée pour ${employee.name}`);
    } catch {
      setMsg('Erreur lors de la génération de la carte');
    } finally {
      setCardLoading(null);
    }
  };

  const generateAllCards = async () => {
    if (!list.length) return;
    setCardLoading('all');
    setMsg('');
    try {
      await downloadAllEmployeeCardsPdf(list, store);
      setMsg(`${list.length} carte(s) employé exportée(s) en PDF`);
    } catch {
      setMsg('Erreur lors de la génération des cartes');
    } finally {
      setCardLoading(null);
    }
  };

  return (
    <>
      {msg && <div className={`alert alert-${msgType === 'error' ? 'danger' : 'success'}`}>{msg}</div>}
      <div className="card table-main">
        <div className="table-main-toolbar">
          <h3>Liste des employés</h3>
          <div className="toolbar-actions">
            {list.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={cardLoading === 'all'}
                onClick={generateAllCards}
              >
                {cardLoading === 'all' ? 'Génération…' : 'Cartes PDF (tous)'}
              </button>
            )}
            {can('employes', 'create') && (
              <button type="button" className="btn btn-accent" onClick={openCreate}>+ Ajouter</button>
            )}
          </div>
        </div>
        <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full">
          <thead><tr><th>Matricule</th><th>Nom</th><th>Fonction</th><th>Point de vente</th><th className="col-num">Salaire</th><th>Contact</th><th>Actif</th><th>Actions</th></tr></thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={8} className="table-empty">Aucun employé</td></tr>
            ) : list.map((e) => (
              <tr key={e.id} style={e.is_active === false ? { opacity: 0.65 } : undefined}>
                <td><strong>{e.matricule}</strong></td>
                <td>{e.name}</td>
                <td>{employeeFunctionLabel(e.function)}</td>
                <td>
                  {e.delivery_point_code ? `${e.delivery_point_code} — ${e.delivery_point_name || ''}` : (
                    PV_REQUIRED_FUNCTIONS.includes(e.function) && e.is_active !== false
                      ? <span className="bmb-pv-missing-badge" title="Point de vente requis">⚠ PV manquant</span>
                      : '—'
                  )}
                </td>
                <td className="col-num">{formatGNF(e.monthly_salary)}</td>
                <td>{e.contact || '—'}{e.user_username ? ` · ${e.user_username}` : ''}</td>
                <td>{e.is_active !== false ? 'Oui' : 'Non'}</td>
                <td className="actions-cell">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={cardLoading === e.id}
                    onClick={() => generateCard(e)}
                  >
                    {cardLoading === e.id ? '…' : 'Carte PDF'}
                  </button>
                  {can('employes', 'edit') && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(e)}>Modifier</button>
                  )}
                  {can('employes', 'edit') && e.function !== 'dg' && e.is_active !== false && (
                    <button type="button" className="btn btn-warning btn-sm" onClick={() => deactivateEmployee(e)}>Désactiver</button>
                  )}
                  {isAdmin && e.function !== 'dg' && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removeEmployee(e)}>Supprimer</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td colSpan={4}><strong>Total ({list.length} employé{list.length > 1 ? 's' : ''})</strong></td>
                <td className="col-num"><strong>{formatGNF(totalSalary)}</strong></td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      </div>

      <BmbFormModal
        open={showForm}
        onClose={closeForm}
        title={editId ? 'Modifier l\'employé' : 'Nouvel employé'}
        titleId="employee-form-title"
      >
        <div className="inline-form-grid form-compact">
          <div className="form-group">
            <label>Nom</label>
            <input ref={nameInputRef} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Fonction</label>
            {form.function === 'dg' ? (
              <p className="vente-pos-setup__seller-name" style={{ margin: 0 }}>
                DG (Directeur général) — unique, compte administrateur
              </p>
            ) : (
              <select
                value={form.function}
                onChange={(e) => setForm({ ...form, function: e.target.value, delivery_point_id: PV_REQUIRED_FUNCTIONS.includes(e.target.value) ? form.delivery_point_id : '' })}
              >
                {EMPLOYEE_FUNCTIONS.filter((f) => f.value !== 'dg').map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            )}
          </div>
          {PV_REQUIRED_FUNCTIONS.includes(form.function) && (
            <div className="form-group">
              <label>Point de vente</label>
              <select
                value={form.delivery_point_id}
                onChange={(e) => setForm({ ...form, delivery_point_id: e.target.value })}
                required
              >
                <option value="">— Sélectionner —</option>
                {deliveryPoints.map((dp) => (
                  <option key={dp.id} value={dp.id}>{dp.code} — {dp.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Salaire mensuel</label>
            <input type="number" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Contact</label>
            <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Date emploi</label>
            <input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} />
          </div>
          {editId && (
            <div className="form-group" style={{ alignSelf: 'end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', marginTop: '1.2rem' }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(ev) => setForm({ ...form, is_active: ev.target.checked })}
                />
                <span>Employé actif</span>
              </label>
            </div>
          )}
          {!editId && (
            <div className="form-group vente-form-grid__full">
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.create_account} onChange={(e) => setForm({ ...form, create_account: e.target.checked })} />
                Créer un compte de connexion
              </label>
            </div>
          )}
          {!editId && form.create_account && (
            <>
              <div className="form-group">
                <label>Identifiant (défaut : matricule)</label>
                <input value={form.account_username} placeholder="Auto" onChange={(e) => setForm({ ...form, account_username: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Mot de passe initial</label>
                <input value={form.account_password} onChange={(e) => setForm({ ...form, account_password: e.target.value })} />
              </div>
            </>
          )}
        </div>
        {!editId && (
          <p style={{ marginTop: '.75rem', color: 'var(--text-muted)', fontSize: '.9rem' }}>
            Le matricule est généré automatiquement à l&apos;enregistrement.
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
