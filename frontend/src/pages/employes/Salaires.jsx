import { useEffect, useState, useMemo } from 'react';
import api from '../../api/client';
import { formatGNF } from '../../utils/format';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';
import AlertBanner from '../../components/AlertBanner';
import { useConfirm } from '../../context/ConfirmContext';
import { extractApiItems } from '../../utils/calculations';

export default function Salaires() {
  const [list, setList] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ employee_id: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(), amount: '', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const notify = useNotify();
  const confirm = useConfirm();

  const load = () => api.get('/employees/salaries').then((r) => setList(r.data)).catch((e) => {
    setError(apiErrorMessage(e, 'Impossible de charger les salaires'));
  });

  useEffect(() => {
    load();
    api.get('/employees').then((r) => setEmployees(extractApiItems(r.data))).catch(() => {});
  }, []);

  const totalPaid = useMemo(
    () => list.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0),
    [list]
  );

  const save = async () => {
    setError('');
    if (!form.employee_id) { setError('Sélectionnez un employé'); return; }
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Saisissez un montant valide'); return; }
    const emp = employees.find((e) => String(e.id) === String(form.employee_id));
    const ok = await confirm({
      title: 'Enregistrer le paiement',
      message: emp
        ? `Enregistrer un paiement de salaire pour ${emp.name} ?`
        : 'Enregistrer ce paiement de salaire ?',
      confirmLabel: 'Enregistrer',
    });
    if (!ok) return;
    try {
      await api.post('/employees/salaries', form);
      notify.success('Paiement de salaire enregistré');
      setShowForm(false);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible d\'enregistrer le paiement'));
    }
  };

  return (
    <div className="card table-main">
      <div className="table-main-toolbar">
        <h3>Gestion des salaires</h3>
        <button type="button" className="btn btn-accent" onClick={() => setShowForm(true)}>+ Paiement salaire</button>
      </div>
      {error && <AlertBanner message={error} onClose={() => setError('')} />}
      {showForm && (
        <div className="inline-form-panel">
          <div className="inline-form-grid form-compact">
            <div className="form-group">
              <label>Employé</label>
              <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                <option value="">—</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Mois</label><input type="number" min="1" max="12" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} /></div>
            <div className="form-group"><label>Année</label><input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></div>
            <div className="form-group"><label>Montant</label><input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          </div>
          <button type="button" className="btn btn-primary" onClick={save}>Enregistrer</button>
        </div>
      )}
      <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full">
          <thead><tr><th>Employé</th><th>Mois</th><th>Année</th><th className="col-num">Montant</th><th>Date paiement</th></tr></thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={5} className="table-empty">Aucun paiement enregistré</td></tr>
            ) : list.map((s) => (
              <tr key={s.id}><td>{s.name}</td><td>{s.month}</td><td>{s.year}</td><td className="col-num">{formatGNF(s.amount)}</td><td>{s.paid_at ? new Date(s.paid_at).toLocaleDateString('fr-FR') : '—'}</td></tr>
            ))}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td colSpan={3}><strong>Total ({list.length})</strong></td>
                <td className="col-num"><strong>{formatGNF(totalPaid)}</strong></td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
