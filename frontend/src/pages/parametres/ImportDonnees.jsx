import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';
import { useConfirm } from '../../context/ConfirmContext';
import { useNotify } from '../../hooks/useNotify';
import { apiErrorMessage } from '../../utils/apiError';
import { downloadBlobResponse } from '../../utils/downloadBlob';

const STEPS = [
  { n: 1, text: 'Téléchargez le modèle Excel pour chaque type de données.' },
  { n: 2, text: 'Copiez vos données existantes dans le modèle (une ligne = un enregistrement, ou une ligne par article pour les ventes).' },
  { n: 3, text: 'Importez dans l’ordre : catégories → produits → clients → fournisseurs → ventes historiques.' },
  { n: 4, text: 'Vérifiez le rapport (créés / mis à jour / erreurs) et contrôlez stocks & clients dans l’app.' },
];

export default function ImportDonnees() {
  const confirm = useConfirm();
  const notify = useNotify();
  const [templates, setTemplates] = useState([]);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [importingFull, setImportingFull] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [importConfirmText, setImportConfirmText] = useState('');
  const fullImportRef = useRef(null);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    api.get('/import/templates').then((r) => setTemplates(r.data)).catch(() => {});
    api.get('/health').then((r) => setHealth(r.data)).catch(() => {});
  }, []);

  const downloadTemplate = async (type) => {
    try {
      const res = await api.get(`/import/templates/${type}`, { responseType: 'blob' });
      const meta = templates.find((t) => t.id === type);
      const name = meta?.filename || `modele_${type}.xlsx`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify.error(apiErrorMessage(err));
    }
  };

  const runPreview = async (type, file) => {
    setBusy(`preview-${type}`);
    setLastResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/import/${type}/preview`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setLastResult({ type, ...data, preview: true });
      notify.success(data.message);
    } catch (err) {
      notify.error(apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const runImport = async (type, file) => {
    const meta = templates.find((t) => t.id === type);
    const ok = await confirm({
      title: `Importer — ${meta?.label || type}`,
      message: `Le fichier « ${file.name} » sera fusionné avec les données existantes (mise à jour par code/référence, pas de suppression). Continuer ?`,
      confirmLabel: 'Importer',
      variant: type === 'sales_history' ? 'warning' : 'default',
    });
    if (!ok) return;

    setBusy(type);
    setLastResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/import/${type}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setLastResult({ type, ...data });
      notify.success(data.message);
    } catch (err) {
      notify.error(apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const onFile = (type) => (e) => {
    const file = e.target.files?.[0];
    if (file) runImport(type, file);
    e.target.value = '';
  };

  return (
    <div className="page-panel">
      <header className="bmb-page-head">
        <div className="bmb-page-head__text">
          <span className="bmb-page-head__eyebrow">Migration & Donnees</span>
          <h1 className="bmb-page-head__title">Import des données existantes</h1>
          <p className="bmb-page-head__subtitle">
            Incorporez catalogue, clients, fournisseurs et historique de ventes depuis Excel (.xlsx, .xls) ou CSV.
            Les enregistrements déjà présents sont mis à jour, pas effacés.
          </p>
        </div>
      </header>

      <aside className="bmb-context-help">
        <strong>Important :</strong> pour une restauration complète (.zip/.sql), utilisez d’abord l’export complet
        puis importez hors heures de caisse afin d’éviter toute écriture concurrente.
      </aside>

      {health && (
        <div className="import-health card-lite">
          <span>Système : {health.status === 'ok' ? 'OK' : 'Dégradé'}</span>
          <span>Version {health.version}</span>
          {health.low_stock_count != null && (
            <span>{health.low_stock_count} produit(s) sous stock min.</span>
          )}
          {health.last_backup_at && (
            <span>Dernière sauvegarde : {new Date(health.last_backup_at).toLocaleString('fr-FR')}</span>
          )}
        </div>
      )}

      <section className="card import-steps">
        <h2>Exporter / importer toutes les données</h2>
        <p className="form-hint">
          Archive complète (base PostgreSQL + fichiers) pour migration ou changement d&apos;hébergeur.
          Inclut les utilisateurs, rôles, clients, ventes, stocks et paramètres.
        </p>
        <div className="import-card__actions bmb-wrap-gap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={exporting || importingFull}
            onClick={async () => {
              setExporting(true);
              try {
                const res = await api.get('/backups/export/package', { responseType: 'blob' });
                const filename = downloadBlobResponse(res, 'besto_export_complet.zip');
                notify.success(`Export téléchargé : ${filename}`);
              } catch (err) {
                notify.error(apiErrorMessage(err, 'Export impossible'));
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? 'Export en cours…' : 'Télécharger l’export complet (.zip)'}
          </button>
        </div>

        <div className="bmb-narrow-block">
          <p className="form-hint bmb-mb-sm">
            <strong>Importer un export</strong> remplace toutes les données actuelles. Mot de passe admin + confirmation RESTAURER requis.
          </p>
          <div className="form-group">
            <label htmlFor="full-import-password">Mot de passe administrateur</label>
            <input
              id="full-import-password"
              type="password"
              value={importPassword}
              onChange={(e) => setImportPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="form-group">
            <label htmlFor="full-import-confirm">Tapez RESTAURER</label>
            <input
              id="full-import-confirm"
              value={importConfirmText}
              onChange={(e) => setImportConfirmText(e.target.value.toUpperCase())}
              placeholder="RESTAURER"
            />
          </div>
          <input
            ref={fullImportRef}
            type="file"
            accept=".sql,.zip,application/zip"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (!importPassword.trim()) {
                notify.error('Saisissez votre mot de passe administrateur');
                return;
              }
              if (importConfirmText !== 'RESTAURER') {
                notify.error('Tapez RESTAURER pour confirmer');
                return;
              }
              const ok = await confirm({
                title: 'Importer l\'export complet',
                message: `« ${file.name} » remplacera TOUTES les données (y compris utilisateurs). Continuer ?`,
                confirmLabel: 'Importer et écraser',
                variant: 'danger',
              });
              if (!ok) return;
              setImportingFull(true);
              try {
                const fd = new FormData();
                fd.append('file', file);
                fd.append('password', importPassword.trim());
                fd.append('confirm_text', 'RESTAURER');
                const { data } = await api.post('/backups/import', fd, {
                  headers: { 'Content-Type': 'multipart/form-data' },
                  timeout: 10 * 60 * 1000,
                });
                notify.success(data.message || 'Import terminé — reconnectez-vous si besoin');
                setImportPassword('');
                setImportConfirmText('');
              } catch (err) {
                notify.error(apiErrorMessage(err, 'Import impossible'));
              } finally {
                setImportingFull(false);
              }
            }}
          />
          <button
            type="button"
            className="btn btn-accent"
            disabled={exporting || importingFull}
            onClick={() => fullImportRef.current?.click()}
          >
            {importingFull ? 'Import en cours…' : 'Importer un export (.zip / .sql)'}
          </button>
        </div>
      </section>

      <section className="card import-steps">
        <h2>Procédure recommandée (Excel / CSV)</h2>
        <ol className="import-steps__list">
          {STEPS.map((s) => (
            <li key={s.n}>
              <strong>{s.n}.</strong> {s.text}
            </li>
          ))}
        </ol>
        <p className="form-hint">
          Astuce : exportez d’abord vos données actuelles depuis votre ancien logiciel en CSV, ouvrez le modèle BESTO SHOP,
          collez les colonnes correspondantes, puis importez.
        </p>
      </section>

      <section className="import-grid">
        {templates.map((t) => (
          <article key={t.id} className="card import-card">
            <h3>{t.label || t.id}</h3>
            <p className="form-hint">Colonnes : {t.headers?.join(', ')}</p>
            <div className="import-card__actions">
              <button type="button" className="btn btn--secondary" onClick={() => downloadTemplate(t.id)}>
                Télécharger le modèle
              </button>
              <label className={`btn btn--secondary ${busy === `preview-${t.id}` ? 'is-loading' : ''}`}>
                Aperçu
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  hidden
                  disabled={!!busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) runPreview(t.id, file);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className={`btn btn--primary ${busy === t.id ? 'is-loading' : ''}`}>
                {busy === t.id ? 'Import…' : 'Importer'}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  hidden
                  disabled={!!busy}
                  onChange={onFile(t.id)}
                />
              </label>
            </div>
            {t.id === 'sales_history' && (
              <p className="form-hint import-warn">
                Les ventes historiques n’impactent pas le stock actuel. Les numéros déjà présents sont ignorés.
              </p>
            )}
          </article>
        ))}
      </section>

      {lastResult && (
        <section className="card import-result">
          <h2>Dernier import</h2>
          <p>{lastResult.message}</p>
          {(lastResult.created != null || lastResult.updated != null) && (
            <p>
              Créés : <strong>{lastResult.created ?? 0}</strong>
              {' · '}
              Mis à jour : <strong>{lastResult.updated ?? 0}</strong>
              {lastResult.skipped != null && (
                <>
                  {' · '}
                  Ignorés : <strong>{lastResult.skipped}</strong>
                </>
              )}
            </p>
          )}
          {lastResult.errors?.length > 0 && (
            <details open>
              <summary>{lastResult.errors.length} alerte(s) / erreur(s)</summary>
              <ul className="import-errors">
                {lastResult.errors.slice(0, 50).map((err, i) => (
                  <li key={`${err.line}-${i}`}>
                    {err.line ? `Ligne ${err.line} : ` : ''}
                    {err.message}
                  </li>
                ))}
              </ul>
              {lastResult.errors.length > 50 && (
                <p className="form-hint">… et {lastResult.errors.length - 50} autre(s) ligne(s).</p>
              )}
            </details>
          )}
        </section>
      )}
    </div>
  );
}
