import { useEffect, useState, useMemo } from 'react';
import api from '../../api/client';
import { formatGNF } from '../../utils/format';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';
import AlertBanner from '../../components/AlertBanner';
import { useConfirm } from '../../context/ConfirmContext';
import { parseChargesApiResponse } from '../../utils/calculations';

export default function Charges() {
  const [list, setList] = useState([]);
  const [chargeSummary, setChargeSummary] = useState(null);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ charge_type_id: '', amount: '', charge_date: new Date().toISOString().slice(0, 10), notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const notify = useNotify();
  const confirm = useConfirm();

  const load = () => api.get('/finances/charges').then((r) => {
    const parsed = parseChargesApiResponse(r.data);
    setList(parsed.items);
    setChargeSummary(parsed.summary);
  }).catch((e) => {
    setError(apiErrorMessage(e, 'Impossible de charger les charges'));
  });

  useEffect(() => {
    load();
    api.get('/finances/charge-types').then((r) => setTypes(r.data)).catch(() => {});
  }, []);

  const chargeCount = chargeSummary?.count ?? list.length;

  const totalCharges = useMemo(
    () => (chargeSummary
      ? parseFloat(chargeSummary.total || 0)
      : list.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)),
    [chargeSummary, list]
  );

  const save = async () => {
    setError('');
    if (!form.charge_type_id) { setError('Sélectionnez un type de charge'); return; }
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Saisissez un montant valide'); return; }
    const ok = await confirm({
      title: 'Enregistrer la charge',
      message: `Enregistrer une charge de ${formatGNF(form.amount)} ?`,
      confirmLabel: 'Enregistrer',
    });
    if (!ok) return;
    try {
      await api.post('/finances/charges', form);
      notify.success('Charge enregistrée');
      setShowForm(false);
      load();
    } catch (e) {
      setError(apiErrorMessage(e, 'Impossible d\'enregistrer la charge'));
    }
  };

  return (
    <div className="card table-main">
      <div className="table-main-toolbar">
        <h3>Gestion des charges</h3>
        <button type="button" className="btn btn-accent" onClick={() => setShowForm(true)}>+ Ajouter</button>
      </div>
      {error && <AlertBanner message={error} onClose={() => setError('')} />}
      {showForm && (
        <div className="inline-form-panel">
          <div className="inline-form-grid form-compact">
            <div className="form-group">
              <label>Type</label>
              <select value={form.charge_type_id} onChange={(e) => setForm({ ...form, charge_type_id: e.target.value })}>
                <option value="">—</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Montant</label><input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            <div className="form-group"><label>Date</label><input type="date" value={form.charge_date} onChange={(e) => setForm({ ...form, charge_date: e.target.value })} /></div>
          </div>
          <button type="button" className="btn btn-primary" onClick={save}>Enregistrer</button>
        </div>
      )}
      <div className="bmb-data-table-wrap table-scroll">
        <table className="bmb-data-table table-full">
          <thead><tr><th>Date</th><th>Type</th><th className="col-num">Montant</th><th>Notes</th></tr></thead>
          <tbody>
            {list.length === 0 ? (
              <tr><td colSpan={4} className="table-empty">Aucune charge enregistrée</td></tr>
            ) : list.map((c) => (
              <tr key={c.id}><td>{c.charge_date}</td><td>{c.charge_type_name}</td><td className="col-num">{formatGNF(c.amount)}</td><td>{c.notes}</td></tr>
            ))}
          </tbody>
          {list.length > 0 && (
            <tfoot>
              <tr className="bmb-data-table-total-row">
                <td colSpan={2}><strong>Total ({chargeCount})</strong></td>
                <td className="col-num"><strong>{formatGNF(totalCharges)}</strong></td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
