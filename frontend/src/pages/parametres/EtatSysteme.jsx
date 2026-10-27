import { useEffect, useState } from 'react';
import api from '../../api/client';
export default function EtatSysteme() {
  const [status, setStatus] = useState(null);
  const [changelog, setChangelog] = useState(null);

  useEffect(() => {
    api.get('/system/status').then((r) => setStatus(r.data)).catch(() => {});
    api.get('/system/changelog').then((r) => setChangelog(r.data)).catch(() => {});
  }, []);

  return (
    <div className="page-panel">
      <header className="page-header">
        <h1>État du système</h1>
        <p className="page-subtitle">Version, base de données, sauvegardes et alertes techniques</p>
      </header>

      {status && (
        <section className="card">
          <div className="stat-grid">
            <div className="stat-card"><div className="label">Version</div><div className="value">{status.version}</div></div>
            <div className="stat-card"><div className="label">Base</div><div className="value">{status.database}</div></div>
            <div className="stat-card"><div className="label">Stock bas</div><div className="value">{status.low_stock_count}</div></div>
            <div className="stat-card"><div className="label">Caisse aujourd&apos;hui</div><div className="value">{status.cash_today_closed ? 'Clôturée' : 'Ouverte'}</div></div>
            <div className="stat-card"><div className="label">Inventaire verrouillé</div><div className="value">{status.inventory_lock ? 'Oui' : 'Non'}</div></div>
          </div>
          {status.last_backup_at && (
            <p className="form-hint">Dernière sauvegarde : {new Date(status.last_backup_at).toLocaleString('fr-FR')}</p>
          )}
          {status.cash_yesterday_non_cloturee && (
            <p className="import-warn">La caisse d&apos;hier n&apos;a pas été clôturée.</p>
          )}
        </section>
      )}

      {changelog?.entries && (
        <section className="card" style={{ marginTop: '1rem' }}>
          <h2>Journal des versions</h2>
          <ul className="import-steps__list">
            {changelog.entries.map((e) => (
              <li key={e.version}>
                <strong>v{e.version}</strong> ({e.date}) — {e.highlights?.join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
