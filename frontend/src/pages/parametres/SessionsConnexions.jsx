import { useEffect, useState } from 'react';
import api from '../../api/client';
import { formatDate } from '../../utils/format';

export default function SessionsConnexions() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/system/sessions')
      .then((r) => setSessions(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-panel">
      <header className="page-header">
        <h1>Sessions de connexion</h1>
        <p className="page-subtitle">200 dernières connexions / déconnexions</p>
      </header>

      {loading ? <p>Chargement…</p> : (
        <div className="bmb-data-table-wrap table-scroll">
          <table className="bmb-data-table table-full">
            <thead>
              <tr>
                <th>Date</th>
                <th>Utilisateur</th>
                <th>Action</th>
                <th>IP</th>
                <th>Agent</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr><td colSpan={5} className="table-empty">Aucune session enregistrée</td></tr>
              ) : sessions.map((s) => (
                <tr key={s.id}>
                  <td>{formatDate(s.created_at)}</td>
                  <td>{s.full_name || s.username}</td>
                  <td>{s.action}</td>
                  <td>{s.ip_address || '—'}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.user_agent}>
                    {s.user_agent ? s.user_agent.slice(0, 60) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
