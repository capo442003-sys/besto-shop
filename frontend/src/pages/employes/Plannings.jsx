import { useEffect, useState } from 'react';
import api from '../../api/client';
import { formatDateOnly, formatTimeOnly } from '../../utils/format';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';
import AlertBanner from '../../components/AlertBanner';
import { useConfirm } from '../../context/ConfirmContext';
import { extractApiItems } from '../../utils/calculations';

export default function Plannings() {
  const [list, setList] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ employee_id: '', schedule_date: '', start_time: '08:00', end_time: '17:00', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const notify = useNotify();
  const confirm = useConfirm();

  const load = () => api.get('/employees/schedules').then((r) => setList(r.data)).catch((e) => {
    setError(apiErrorMessage(e, 'Impossible de charger les plannings'));
  });

  useEffect(() => {
    load();
    api.get('/employees').then((r) => setEmployees(extractApiItems(r.data))).catch(() => {});
  }, []);

  const save = async () => {
    setError('');
    if (!form.employee_id) { setError('Sélectionnez un employé'); return; }
    if (!form.schedule_date) { setError('Saisissez une date'); return; }
    const emp = employees.find((e) => String(e.id) === String(form.employee_id));
    const ok = await confirm({
      title: 'Enregistrer le planning',
      message: emp
        ? `Ajouter un créneau pour ${emp.name} le ${form.schedule_date} ?`
        : 'Enregistrer ce planning ?',
      confirmLabel: 'Enregistrer',
    });
    if (!ok) return;
    try {
      await api.post('/employees/schedules', form);
      notify.success('Planning enregistré');
      setShowForm(false);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible d\'enregistrer le planning'));
    }
  };

  return (
    <div className="card table-main">
      <div className="table-main-toolbar">
        <h3>Plannings de travail</h3>
        <button type="button" className="btn btn-accent" onClick={() => setShowForm(true)}>+ Ajouter</button>
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
            <div className="form-group"><label>Date</label><input type="date" value={form.schedule_date} onChange={(e) => setForm({ ...form, schedule_date: e.target.value })} /></div>
            <div className="form-group"><label>Début</label><input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
            <div className="form-group"><label>Fin</label><input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
          </div>
          <button type="button" className="btn btn-primary" onClick={save}>Enregistrer</button>
        </div>
      )}
      <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full">
          <thead><tr><th>Employé</th><th>Date</th><th>Début</th><th>Fin</th><th>Notes</th></tr></thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={5} className="table-empty">Aucun planning</td></tr>
            ) : list.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{formatDateOnly(s.schedule_date)}</td>
                <td>{formatTimeOnly(s.start_time)}</td>
                <td>{formatTimeOnly(s.end_time)}</td>
                <td>{s.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td colSpan={5}><strong>Total ({list.length} entrée{list.length > 1 ? 's' : ''})</strong></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
