import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { logoSrc, useStoreSettings } from '../../context/StoreSettingsContext';
import { clearPdfLogoCache } from '../../utils/pdfLogo';
import BrandLogo from '../../components/BrandLogo';
import { useConfirm } from '../../context/ConfirmContext';
import { useNotify } from '../../hooks/useNotify';
import AlertBanner from '../../components/AlertBanner';
import { formatDate } from '../../utils/format';
import { downloadBlobResponse } from '../../utils/downloadBlob';
import '../../styles/magasin.css';

const LOGIN_SLOTS = [
  { slot: '1', label: 'Image principale', hint: 'Grande image de fond — recommandé 1920×1080' },
  { slot: '2', label: 'Image 2', hint: 'Diaporama automatique (optionnel)' },
  { slot: '3', label: 'Image 3', hint: 'Diaporama automatique (optionnel)' },
];

export default function Magasin() {
  const { userRoles } = useAuth();
  const isAdmin = userRoles().includes('administrateur');
  const { store, setStore, refreshStore } = useStoreSettings();
  const [form, setForm] = useState({
    store_name: '',
    address: '',
    phone: '',
    phone_2: '',
    phone_3: '',
    email: '',
    logo_url: null,
    login_image_1_url: null,
    login_image_2_url: null,
    login_image_3_url: null,
    pos_confirm_add_line: false,
    inventory_lock: false,
    theme: 'light',
    pos_idle_minutes: 30,
  });
  const [backups, setBackups] = useState([]);
  const [driveStatus, setDriveStatus] = useState({ connected: false, email: null, auto_enabled: true, oauth_available: false });
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreConfirm, setRestoreConfirm] = useState('');
  const [restoringId, setRestoringId] = useState(null);
  const [exportingKind, setExportingKind] = useState(null);
  const [importing, setImporting] = useState(false);
  const importFileRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadingLoginSlot, setUploadingLoginSlot] = useState(null);
  const [tab, setTab] = useState('general');
  const fileRef = useRef(null);
  const loginFileRefs = useRef({});
  const confirm = useConfirm();
  const notify = useNotify();

  useEffect(() => {
    setForm({
      store_name: store.store_name || '',
      address: store.address || '',
      phone: store.phone || '',
      phone_2: store.phone_2 || '',
      phone_3: store.phone_3 || '',
      email: store.email || '',
      logo_url: store.logo_url || null,
      login_image_1_url: store.login_image_1_url || null,
      login_image_2_url: store.login_image_2_url || null,
      login_image_3_url: store.login_image_3_url || null,
      pos_confirm_add_line: Boolean(store.pos_confirm_add_line),
      inventory_lock: Boolean(store.inventory_lock),
      theme: store.theme || 'light',
      pos_idle_minutes: store.pos_idle_minutes ?? 30,
    });
  }, [store]);

  useEffect(() => {
    if (!isAdmin) return;
    api.get('/backups').then((r) => setBackups(r.data)).catch(() => {});
    api.get('/backups/google/status').then((r) => setDriveStatus(r.data)).catch(() => {});
  }, [isAdmin]);

  useEffect(() => {
    const gdrive = searchParams.get('gdrive');
    const tabParam = searchParams.get('tab');
    if (tabParam === 'systeme') setTab('systeme');
    if (gdrive === 'connected') {
      setTab('systeme');
      notify.success('Google Drive connecté — vos sauvegardes iront sur votre compte');
      searchParams.delete('gdrive');
      searchParams.delete('tab');
      setSearchParams(searchParams, { replace: true });
      api.get('/backups/google/status').then((r) => setDriveStatus(r.data)).catch(() => {});
      refreshStore();
    } else if (gdrive === 'error') {
      setTab('systeme');
      notify.error('Connexion Google Drive annulée ou échouée');
      searchParams.delete('gdrive');
      searchParams.delete('msg');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, notify, refreshStore]);

  const save = async () => {
    setError('');
    const ok = await confirm({
      title: 'Enregistrer les paramètres',
      message: `Enregistrer les informations du magasin « ${form.store_name?.trim() || 'BESTO SHOP'} » ?`,
      confirmLabel: 'Enregistrer',
    });
    if (!ok) return;
    try {
      const payload = {
        store_name: form.store_name,
        address: form.address,
        phone: form.phone,
        phone_2: form.phone_2,
        phone_3: form.phone_3,
        email: form.email,
        logo_url: form.logo_url,
        pos_confirm_add_line: form.pos_confirm_add_line,
        inventory_lock: form.inventory_lock,
        theme: form.theme,
        pos_idle_minutes: parseInt(form.pos_idle_minutes, 10) || 30,
      };
      await api.put('/settings/store', payload);
      await refreshStore();
      notify.success('Paramètres enregistrés');
    } catch (e) {
      setError(e.response?.data?.message || 'Enregistrement impossible');
    }
  };

  const onLogoPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAdmin) {
      setError('Seul un administrateur peut modifier le logo');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setError('');
    // Aperçu immédiat (sans dialog de confirmation)
    const localUrl = URL.createObjectURL(file);
    setForm((f) => ({ ...f, logo_url: localUrl }));
    setUploading(true);
    try {
      const body = new FormData();
      body.append('logo', file);
      const { data } = await api.post('/settings/store/logo', body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      clearPdfLogoCache();
      URL.revokeObjectURL(localUrl);
      if (data?.logo_url) {
        setForm((f) => ({ ...f, logo_url: data.logo_url }));
        setStore(data);
      }
      // refresh en arrière-plan — l’UI est déjà à jour
      refreshStore().catch(() => {});
      notify.success('Logo mis à jour');
    } catch (err) {
      URL.revokeObjectURL(localUrl);
      setForm((f) => ({ ...f, logo_url: store?.logo_url || null }));
      setError(err.response?.data?.message || 'Échec du téléversement');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeLogo = async () => {
    if (!isAdmin) return;
    const ok = await confirm({
      title: 'Supprimer le logo',
      message: 'Le logo personnalisé sera supprimé et le logo par défaut sera restauré.',
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    setError('');
    try {
      const { data } = await api.delete('/settings/store/logo');
      clearPdfLogoCache();
      setForm((f) => ({ ...f, logo_url: null }));
      if (data) setStore(data);
      await refreshStore();
      notify.success('Logo par défaut restauré');
    } catch (err) {
      setError(err.response?.data?.message || 'Suppression impossible');
    }
  };

  const onLoginImagePick = async (slot, e) => {
    const file = e.target.files?.[0];
    if (!file || !isAdmin) return;
    const ok = await confirm({
      title: 'Changer l\'image de connexion',
      message: `Remplacer l'image ${slot} par « ${file.name} » ?`,
      confirmLabel: 'Téléverser',
    });
    if (!ok) {
      if (loginFileRefs.current[slot]) loginFileRefs.current[slot].value = '';
      return;
    }
    setError('');
    setUploadingLoginSlot(slot);
    try {
      const body = new FormData();
      body.append('image', file);
      const { data } = await api.post(`/settings/store/login-image/${slot}`, body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setForm((f) => ({
        ...f,
        [`login_image_${slot}_url`]: data[`login_image_${slot}_url`],
      }));
      await refreshStore();
      notify.success(`Image de connexion ${slot} mise à jour`);
    } catch (err) {
      setError(err.response?.data?.message || 'Échec du téléversement');
    } finally {
      setUploadingLoginSlot(null);
      if (loginFileRefs.current[slot]) loginFileRefs.current[slot].value = '';
    }
  };

  const removeLoginImage = async (slot) => {
    if (!isAdmin) return;
    const ok = await confirm({
      title: 'Supprimer l\'image',
      message: `L'image de connexion ${slot} sera supprimée.`,
      confirmLabel: 'Supprimer',
      variant: 'danger',
    });
    if (!ok) return;
    setError('');
    setUploadingLoginSlot(slot);
    try {
      const { data } = await api.delete(`/settings/store/login-image/${slot}`);
      setForm((f) => ({
        ...f,
        [`login_image_${slot}_url`]: data[`login_image_${slot}_url`],
      }));
      await refreshStore();
      notify.success('Image supprimée');
    } catch (err) {
      setError(err.response?.data?.message || 'Suppression impossible');
    } finally {
      setUploadingLoginSlot(null);
    }
  };

  const resetData = async () => {
    if (resetConfirm !== 'REINITIALISER') {
      setError('Tapez REINITIALISER pour confirmer');
      return;
    }
    if (!resetPassword) {
      setError('Mot de passe administrateur requis');
      return;
    }
    const ok = await confirm({
      title: 'Réinitialiser toutes les données',
      message: 'Cette action supprime définitivement ventes, produits, clients, stocks et finances. Seuls les paramètres de base et le compte admin seront recréés. Continuer ?',
      confirmLabel: 'Tout effacer',
      variant: 'danger',
    });
    if (!ok) return;
    setError('');
    setResetting(true);
    try {
      const { data } = await api.post('/settings/reset-data', {
        password: resetPassword,
        confirm_text: resetConfirm,
      });
      setResetPassword('');
      setResetConfirm('');
      notify.success(data.message || 'Données réinitialisées');
      await refreshStore();
    } catch (e) {
      setError(e.response?.data?.message || 'Réinitialisation impossible');
    } finally {
      setResetting(false);
    }
  };

  const previewSrc = logoSrc(form.logo_url, store?.updated_at);
  const bust = store?.updated_at;

  const tabs = [
    { id: 'general', label: 'Magasin' },
    { id: 'visuel', label: 'Visuel' },
    ...(isAdmin ? [{ id: 'systeme', label: 'Système' }] : []),
  ];

  const renderLoginSlot = ({ slot, label, hint }) => {
    const url = form[`login_image_${slot}_url`];
    const src = logoSrc(url, bust);
    const busy = uploadingLoginSlot === slot;
    return (
      <div key={slot} className="mag-login-slot">
        <div className="mag-login-slot__img">
          {src ? (
            <img src={src} alt={label} />
          ) : (
            <div className={`mag-login-slot__placeholder mag-login-slot__placeholder--${slot}`}>
              {label}
            </div>
          )}
        </div>
        <div className="mag-login-slot__foot">
          <div>
            <strong>{label}</strong>
            <span>{hint}</span>
          </div>
          {isAdmin && (
            <div className="mag-login-slot__btns">
              <input
                ref={(el) => { loginFileRefs.current[slot] = el; }}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="mag-file-input"
                onChange={(e) => onLoginImagePick(slot, e)}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy || uploading}
                onClick={() => loginFileRefs.current[slot]?.click()}
              >
                {busy ? '…' : src ? 'Changer' : 'Ajouter'}
              </button>
              {src && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => removeLoginImage(slot)}
                  title="Supprimer"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mag-page">
      {error && <AlertBanner message={error} onClose={() => setError('')} />}

      <div className="mag-hero">
        <div className="mag-hero__badge">
          {previewSrc ? (
            <img src={previewSrc} alt="" />
          ) : (
            <BrandLogo variant="icon" />
          )}
        </div>
        <div className="mag-hero__text">
          <h2>{form.store_name?.trim() || 'Mon magasin'}</h2>
          <p>{form.address?.trim() || 'Adresse non renseignée'}</p>
        </div>
      </div>

      <nav className="mag-tabs" aria-label="Sections paramètres magasin">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`mag-tab${tab === t.id ? ' mag-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'general' && (
        <div className="mag-panel">
          <div className="mag-card">
            <p className="mag-section-label">Coordonnées</p>
            <div className="mag-form-grid mag-form-grid--2">
              <div className="form-group mag-span-2">
                <label>Nom du magasin</label>
                <input
                  value={form.store_name || ''}
                  onChange={(e) => setForm({ ...form, store_name: e.target.value })}
                  disabled={!isAdmin}
                />
              </div>
              <div className="form-group mag-span-2">
                <label>Adresse</label>
                <input
                  value={form.address || ''}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  disabled={!isAdmin}
                />
              </div>
              <div className="form-group">
                <label>Téléphone 1</label>
                <input
                  value={form.phone || ''}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  disabled={!isAdmin}
                  placeholder="ex. 620000000"
                />
              </div>
              <div className="form-group">
                <label>Téléphone 2</label>
                <input
                  value={form.phone_2 || ''}
                  onChange={(e) => setForm({ ...form, phone_2: e.target.value })}
                  disabled={!isAdmin}
                  placeholder="Optionnel"
                />
              </div>
              <div className="form-group">
                <label>Téléphone 3</label>
                <input
                  value={form.phone_3 || ''}
                  onChange={(e) => setForm({ ...form, phone_3: e.target.value })}
                  disabled={!isAdmin}
                  placeholder="Optionnel"
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={form.email || ''}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  disabled={!isAdmin}
                />
              </div>
            </div>

            {isAdmin && (
              <>
                <p className="mag-section-label">Caisse &amp; interface</p>
                <div className="mag-switches">
                  <label className="mag-switch">
                    <input
                      type="checkbox"
                      checked={form.pos_confirm_add_line}
                      onChange={(e) => setForm({ ...form, pos_confirm_add_line: e.target.checked })}
                    />
                    <span>Confirmation à chaque ajout en caisse</span>
                  </label>
                  <label className="mag-switch">
                    <input
                      type="checkbox"
                      checked={form.inventory_lock}
                      onChange={(e) => setForm({ ...form, inventory_lock: e.target.checked })}
                    />
                    <span>Verrouiller les ventes (inventaire)</span>
                  </label>
                </div>
                <div className="mag-form-grid mag-form-grid--2" style={{ marginTop: '0.85rem' }}>
                  <div className="form-group">
                    <label>Thème</label>
                    <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
                      <option value="light">Clair</option>
                      <option value="dark">Sombre</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Déconnexion auto caisse (minutes)</label>
                    <input
                      type="number"
                      min="0"
                      max="480"
                      value={form.pos_idle_minutes}
                      onChange={(e) => setForm({ ...form, pos_idle_minutes: e.target.value })}
                    />
                    <span className="mag-hint-inline">0 = désactivé</span>
                  </div>
                </div>
                <div className="mag-save-row">
                  <button type="button" className="btn btn-primary" onClick={save}>
                    Enregistrer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'visuel' && (
        <div className="mag-panel">
          <div className="mag-card">
            <p className="mag-section-label">Logo</p>
            <div className="mag-logo-block">
              <div className="mag-logo-previews">
                <div>
                  <div className="mag-logo-preview mag-logo-preview--dark">
                    <BrandLogo variant="full" />
                  </div>
                  <span className="mag-logo-preview__label">Sidebar</span>
                </div>
                <div>
                  <div className="mag-logo-preview mag-logo-preview--light">
                    {previewSrc ? (
                      <img src={previewSrc} alt="Logo" className="mag-logo-preview__img" />
                    ) : (
                      <BrandLogo variant="icon" />
                    )}
                  </div>
                  <span className="mag-logo-preview__label">Documents</span>
                </div>
              </div>
              {isAdmin ? (
                <div className="btn-group mag-logo-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                    className="mag-file-input"
                    onChange={onLogoPick}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? 'Envoi…' : previewSrc ? 'Changer le logo' : 'Téléverser un logo'}
                  </button>
                  {previewSrc && (
                    <button type="button" className="btn btn-secondary" onClick={removeLogo} disabled={uploading}>
                      Logo par défaut
                    </button>
                  )}
                </div>
              ) : (
                <p className="mag-muted">Modification réservée aux administrateurs.</p>
              )}
            </div>

            <p className="mag-section-label">Page de connexion</p>
            <div className="mag-login-grid">
              {LOGIN_SLOTS.map(renderLoginSlot)}
            </div>
          </div>
        </div>
      )}

      {tab === 'systeme' && isAdmin && (
        <div className="mag-panel mag-system-stack">
          <div className="mag-card" id="export-donnees">
            <p className="mag-section-label">Export complet des données</p>
            <p className="mag-hint">
              Téléchargez une copie de <strong>toutes</strong> les données : clients, ventes, stocks, dettes,
              utilisateurs, permissions, paramètres magasin, etc. Utile pour migration ou archivage.
              Les mots de passe utilisateurs sont inclus (hash sécurisé).
            </p>
            <div className="mag-save-row" style={{ marginTop: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={Boolean(exportingKind)}
                onClick={async () => {
                  setExportingKind('package');
                  try {
                    const res = await api.get('/backups/export/package', { responseType: 'blob' });
                    const filename = downloadBlobResponse(res, 'besto_export_complet.zip');
                    notify.success(`Export téléchargé : ${filename}`);
                  } catch (err) {
                    notify.error(err.response?.data?.message || 'Export impossible — pg_dump installé sur le serveur ?');
                  } finally {
                    setExportingKind(null);
                  }
                }}
              >
                {exportingKind === 'package' ? 'Export en cours…' : 'Télécharger tout (.zip)'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={Boolean(exportingKind)}
                onClick={async () => {
                  setExportingKind('sql');
                  try {
                    const res = await api.get('/backups/export/full', { responseType: 'blob' });
                    const filename = downloadBlobResponse(res, 'besto_export_complet.sql');
                    notify.success(`Base exportée : ${filename}`);
                  } catch (err) {
                    notify.error(err.response?.data?.message || 'Export SQL impossible');
                  } finally {
                    setExportingKind(null);
                  }
                }}
              >
                {exportingKind === 'sql' ? 'Export…' : 'Base seule (.sql)'}
              </button>
            </div>

            <p className="mag-section-label" style={{ marginTop: '1.25rem' }}>Importer un export</p>
            <p className="mag-hint">
              Restaure un fichier <strong>.zip</strong> ou <strong>.sql</strong> exporté depuis BESTO SHOP.
              <strong> Attention :</strong> remplace toutes les données actuelles (y compris les utilisateurs).
              Remplissez le mot de passe et tapez RESTAURER ci-dessous avant d&apos;importer.
            </p>
            <input
              ref={importFileRef}
              type="file"
              accept=".sql,.zip,application/zip,application/sql,text/plain"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const pwd = restorePassword.trim();
                if (!pwd) {
                  notify.error('Saisissez votre mot de passe administrateur ci-dessous');
                  return;
                }
                if (restoreConfirm !== 'RESTAURER') {
                  notify.error('Tapez RESTAURER dans le champ de confirmation');
                  return;
                }
                const ok = await confirm({
                  title: 'Importer l\'export',
                  message: `Le fichier « ${file.name} » remplacera TOUTES les données actuelles (clients, ventes, utilisateurs…). Continuer ?`,
                  confirmLabel: 'Importer et écraser',
                  variant: 'danger',
                });
                if (!ok) return;
                setImporting(true);
                try {
                  const fd = new FormData();
                  fd.append('file', file);
                  fd.append('password', pwd);
                  fd.append('confirm_text', 'RESTAURER');
                  const { data } = await api.post('/backups/import', fd, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    timeout: 10 * 60 * 1000,
                  });
                  notify.success(data.message || 'Import terminé');
                  setRestorePassword('');
                  setRestoreConfirm('');
                  await refreshStore();
                  const { data: list } = await api.get('/backups').catch(() => ({ data: [] }));
                  if (Array.isArray(list)) setBackups(list);
                } catch (err) {
                  notify.error(err.response?.data?.message || 'Import impossible');
                } finally {
                  setImporting(false);
                }
              }}
            />
            <button
              type="button"
              className="btn btn-accent btn-sm"
              style={{ marginTop: '0.5rem' }}
              disabled={importing || Boolean(exportingKind)}
              onClick={() => importFileRef.current?.click()}
            >
              {importing ? 'Import en cours…' : 'Choisir un fichier (.zip / .sql)'}
            </button>
          </div>

          <div className="mag-card" id="sauvegardes">
            <p className="mag-section-label">Sauvegardes Google Drive</p>
            <p className="mag-hint">
              Connectez votre compte Google : les données sont sauvegardées sur <strong>votre</strong> Drive
              (dossier « BESTO SHOP Sauvegardes »), chaque nuit à 3h et à la demande. Restauration possible à tout moment.
            </p>

            {driveStatus.connected ? (
              <div className="mag-drive-status" style={{ marginBottom: '1rem' }}>
                <p>
                  <strong>Compte connecté :</strong> {driveStatus.email}
                </p>
                <label className="mag-check" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={driveStatus.auto_enabled !== false}
                    onChange={async (e) => {
                      try {
                        const { data } = await api.patch('/backups/google/auto', { enabled: e.target.checked });
                        setDriveStatus((s) => ({ ...s, auto_enabled: data.auto_enabled }));
                        notify.success(e.target.checked ? 'Sauvegarde automatique activée' : 'Sauvegarde automatique désactivée');
                      } catch (err) {
                        notify.error(err.response?.data?.message || 'Impossible de modifier');
                      }
                    }}
                  />
                  Sauvegarde automatique chaque nuit
                </label>
                <div className="mag-save-row" style={{ marginTop: '0.75rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Déconnecter Google Drive',
                        message: 'Les sauvegardes automatiques seront arrêtées. Vos fichiers restent sur Drive.',
                        confirmLabel: 'Déconnecter',
                        variant: 'danger',
                      });
                      if (!ok) return;
                      try {
                        await api.delete('/backups/google/disconnect');
                        setDriveStatus({ connected: false, email: null, auto_enabled: true, oauth_available: driveStatus.oauth_available });
                        await refreshStore();
                        notify.success('Compte Google Drive déconnecté');
                      } catch (err) {
                        notify.error(err.response?.data?.message || 'Déconnexion impossible');
                      }
                    }}
                  >
                    Déconnecter
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: '1rem' }}>
                {!driveStatus.oauth_available && (
                  <p className="mag-muted">Google Drive n&apos;est pas encore activé sur ce serveur (configuration hébergeur).</p>
                )}
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  disabled={!driveStatus.oauth_available}
                  onClick={async () => {
                    try {
                      const { data } = await api.get('/backups/google/connect');
                      window.location.href = data.url;
                    } catch (err) {
                      notify.error(err.response?.data?.message || 'Connexion Google impossible');
                    }
                  }}
                >
                  Connecter mon Google Drive
                </button>
              </div>
            )}

            <button
              type="button"
              className="btn btn-accent btn-sm"
              disabled={!driveStatus.connected}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Sauvegarde',
                  message: 'Envoyer une copie de la base sur votre Google Drive ?',
                  confirmLabel: 'Sauvegarder',
                });
                if (!ok) return;
                try {
                  const { data } = await api.post('/backups/run');
                  notify.success(data.message);
                  const { data: list } = await api.get('/backups');
                  setBackups(list);
                } catch (err) {
                  setError(err.response?.data?.message || 'Sauvegarde impossible');
                }
              }}
            >
              Sauvegarder maintenant
            </button>

            {backups.length === 0 ? (
              <p className="mag-muted" style={{ marginTop: '0.85rem' }}>Aucune sauvegarde enregistrée.</p>
            ) : (
              <ul className="mag-backup-list" style={{ marginTop: '0.85rem' }}>
                {backups.slice(0, 10).map((b) => (
                  <li key={b.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span>
                      <strong>{formatDate(b.created_at)}</strong>
                      {' — '}{b.backup_type === 'google_drive' ? 'Google Drive' : 'Local'}
                      {' — '}{b.status}
                    </span>
                    {(b.google_drive_file_id || b.file_path) && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={async () => {
                            try {
                              const res = await api.get(`/backups/${b.id}/download`, { responseType: 'blob' });
                              downloadBlobResponse(res, `besto_backup_${b.id}.sql`);
                            } catch (err) {
                              notify.error(err.response?.data?.message || 'Téléchargement impossible');
                            }
                          }}
                        >
                          Télécharger
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={restoringId === b.id}
                          onClick={async () => {
                          const ok = await confirm({
                            title: 'Restaurer la sauvegarde',
                            message: 'ATTENTION : toutes les données actuelles seront remplacées par cette sauvegarde. Continuer ?',
                            confirmLabel: 'Continuer',
                            variant: 'danger',
                          });
                          if (!ok) return;
                          const pwd = restorePassword.trim();
                          if (!pwd) {
                            notify.error('Saisissez votre mot de passe administrateur ci-dessous');
                            return;
                          }
                          if (restoreConfirm !== 'RESTAURER') {
                            notify.error('Tapez RESTAURER dans le champ de confirmation');
                            return;
                          }
                          setRestoringId(b.id);
                          try {
                            const { data } = await api.post(`/backups/${b.id}/restore`, {
                              password: pwd,
                              confirm_text: 'RESTAURER',
                            });
                            notify.success(data.message);
                            setRestorePassword('');
                            setRestoreConfirm('');
                          } catch (err) {
                            notify.error(err.response?.data?.message || 'Restauration impossible');
                          } finally {
                            setRestoringId(null);
                          }
                        }}
                      >
                        {restoringId === b.id ? 'Restauration…' : 'Restaurer'}
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mag-restore-fields" style={{ marginTop: '1rem', maxWidth: '420px' }}>
              <div className="form-group">
                <label>Mot de passe admin (pour restaurer)</label>
                <input
                  type="password"
                  value={restorePassword}
                  onChange={(e) => setRestorePassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="form-group">
                <label>Tapez RESTAURER pour confirmer une restauration</label>
                <input
                  value={restoreConfirm}
                  onChange={(e) => setRestoreConfirm(e.target.value.toUpperCase())}
                  placeholder="RESTAURER"
                />
              </div>
            </div>
          </div>

          <div className="mag-card mag-card--danger" id="reset">
            <p className="mag-section-label">Zone dangereuse</p>
            <p className="mag-hint">
              Efface définitivement produits, ventes, clients, stocks et finances.
              Le compte admin sera recréé avec le mot de passe <code>admin123</code>.
            </p>
            <div className="form-group">
              <label>Mot de passe administrateur</label>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="Mot de passe actuel"
                autoComplete="current-password"
              />
            </div>
            <div className="form-group">
              <label>Tapez REINITIALISER pour confirmer</label>
              <input
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value.toUpperCase())}
                placeholder="REINITIALISER"
              />
            </div>
            <div className="mag-save-row">
              <button
                type="button"
                className="btn btn-danger"
                onClick={resetData}
                disabled={resetting || resetConfirm !== 'REINITIALISER' || !resetPassword}
              >
                {resetting ? 'Réinitialisation…' : 'Réinitialiser toutes les données'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
