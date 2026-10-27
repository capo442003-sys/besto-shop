import { useEffect, useState } from 'react';
import api from '../../api/client';
import { formatGNF } from '../../utils/format';
import { useNotify } from '../../hooks/useNotify';

const SEVERITY_LABELS = {
  error: 'Critique',
  warning: 'Attention',
  info: 'Info',
};

const SEVERITY_CLASS = {
  error: 'alert-error',
  warning: 'alert-warning',
  info: 'alert-info',
};

export default function SanteDonnees() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const notify = useNotify();

  const load = () => {
    setLoading(true);
    api.get('/system/data-health')
      .then((r) => setReport(r.data))
      .catch((err) => notify.apiError(err, 'Impossible de charger la santé des données'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const reconcile = async () => {
    setReconciling(true);
    try {
      const { data } = await api.post('/sales/reconcile-balances');
      notify.success(`Réconciliation : ${data.count || 0} correction(s), écart ${formatGNF(data.ecart || 0)}`);
      load();
    } catch (err) {
      notify.apiError(err, 'Réconciliation échouée');
    } finally {
      setReconciling(false);
    }
  };

  return (
    <div className="page-panel">
      <header className="page-header">
        <h1>Santé des données</h1>
        <p className="page-subtitle">Contrôles d&apos;intégrité — créances, stocks, rattachements PV</p>
      </header>

      <div className="page-actions bmb-print-skip" style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? 'Analyse…' : 'Actualiser'}
        </button>
        <button type="button" className="btn btn-primary" onClick={reconcile} disabled={reconciling}>
          {reconciling ? 'Réconciliation…' : 'Réconcilier les soldes paniers'}
        </button>
      </div>

      {loading && !report && <p>Analyse en cours…</p>}

      {report && (
        <>
          <p className="form-hint">
            Dernière analyse : {new Date(report.checked_at).toLocaleString('fr-FR')}
            {' — '}
            {report.issue_count === 0 ? 'Aucun problème détecté' : `${report.issue_count} point(s) d'attention`}
          </p>

          {report.issue_count === 0 ? (
            <section className="card">
              <p className="alert alert-success">Tous les contrôles sont passés.</p>
            </section>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {report.issues.map((issue) => (
                <section key={issue.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                      <span className={`alert ${SEVERITY_CLASS[issue.severity] || 'alert-warning'}`} style={{ display: 'inline-block', marginBottom: '0.5rem', padding: '0.2rem 0.5rem' }}>
                        {SEVERITY_LABELS[issue.severity] || issue.severity}
                      </span>
                      <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>{issue.title}</h2>
                      <p style={{ margin: 0, color: 'var(--text-muted)' }}>{issue.detail}</p>
                    </div>
                    {issue.count != null && (
                      <strong style={{ fontSize: '1.25rem' }}>{issue.count}</strong>
                    )}
                  </div>
                  {issue.samples?.length > 0 && (
                    <details style={{ marginTop: '0.75rem' }}>
                      <summary>Échantillon ({issue.samples.length})</summary>
                      <pre style={{ fontSize: '0.8rem', overflow: 'auto', marginTop: '0.5rem' }}>
                        {JSON.stringify(issue.samples, null, 2)}
                      </pre>
                    </details>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
