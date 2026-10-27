import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import config from '../config/index.js';
import pool from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAudit } from '../middleware/audit.js';
import { sensitiveOpsRateLimit } from '../middleware/rateLimit.js';
import { validateBody, readPositiveInt, readTrimmedString } from '../middleware/validate.js';
import {
  runDatabaseBackup,
  listBackups,
  purgeOldBackups,
  restoreDatabaseBackup,
  createDatabaseExportFile,
  createFullDataExportPackage,
  resolveBackupDownloadFile,
  restoreFromUploadedFile,
  backupDir,
} from '../services/backupService.js';
import {
  getStoreDriveStatus,
  saveStoreDriveConnection,
  disconnectStoreDrive,
  setBackupAutoEnabled,
} from '../services/storeDriveService.js';
import {
  isGoogleOAuthConfigured,
  buildGoogleAuthUrl,
  exchangeGoogleAuthCode,
  createOAuthClient,
  fetchGoogleAccountEmail,
  ensureClientBackupFolder,
} from '../services/googleDriveService.js';
import { ensureComptoirClient } from '../utils/comptoirClient.js';

const router = Router();

const validateToggleAutoBody = validateBody((body) => {
  if (body.enabled == null) return { value: { enabled: true } };
  if (typeof body.enabled !== 'boolean') return { error: 'enabled invalide' };
  return { value: { enabled: body.enabled } };
});

const validateImportBody = validateBody((body) => {
  const password = readTrimmedString(body, 'password', { required: true, min: 1, max: 200, label: 'Mot de passe administrateur' });
  if (password.error) return { error: password.error };
  const confirmText = readTrimmedString(body, 'confirm_text', { required: true, min: 1, max: 20, label: 'Confirmation' });
  if (confirmText.error) return { error: confirmText.error };
  return {
    value: {
      password: password.value,
      confirm_text: confirmText.value,
    },
  };
});

const validateRestoreBody = validateBody((body) => {
  const password = readTrimmedString(body, 'password', { required: true, min: 1, max: 200, label: 'Mot de passe administrateur' });
  if (password.error) return { error: password.error };
  const confirmText = readTrimmedString(body, 'confirm_text', { required: true, min: 1, max: 20, label: 'Confirmation' });
  if (confirmText.error) return { error: confirmText.error };
  return {
    value: {
      password: password.value,
      confirm_text: confirmText.value,
    },
  };
});

const validatePurgeBody = validateBody((body) => {
  const keepDays = readPositiveInt(body, 'keep_days', { required: false, min: 7, max: 3650, label: 'keep_days' });
  if (keepDays.error) return { error: keepDays.error };
  return { value: { keep_days: keepDays.value ?? 30 } };
});

const importUploadDir = path.join(backupDir, 'import');
if (!fs.existsSync(importUploadDir)) fs.mkdirSync(importUploadDir, { recursive: true });

const importUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, importUploadDir),
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'export')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 120);
      cb(null, `upload_${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.sql') || name.endsWith('.zip')) cb(null, true);
    else cb(new Error('Fichier attendu : .sql ou .zip'));
  },
});

function clientRedirect(path = '/parametres/magasin') {
  const base = config.clientUrls[0] || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}${path}`;
}

router.get('/google/callback', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(`${clientRedirect()}?gdrive=error&msg=${encodeURIComponent(String(error))}`);
  }
  if (!code || !state) {
    return res.redirect(`${clientRedirect()}?gdrive=error&msg=missing_code`);
  }

  let payload;
  try {
    payload = jwt.verify(String(state), config.jwt.secret);
  } catch {
    return res.redirect(`${clientRedirect()}?gdrive=error&msg=session_expired`);
  }
  if (payload.purpose !== 'google_drive' || !payload.sub) {
    return res.redirect(`${clientRedirect()}?gdrive=error&msg=invalid_state`);
  }

  const tokens = await exchangeGoogleAuthCode(String(code));
  const oauth2 = createOAuthClient(tokens.refresh_token);
  const email = await fetchGoogleAccountEmail(oauth2);
  if (!email) {
    return res.redirect(`${clientRedirect()}?gdrive=error&msg=no_email`);
  }

  const folderId = await ensureClientBackupFolder(tokens.refresh_token, null);
  await saveStoreDriveConnection({
    email,
    refreshToken: tokens.refresh_token,
    folderId,
  });
  await logAudit(payload.sub, 'update', 'store_settings', null, {
    change: 'google_drive_connected',
    email,
  });

  res.redirect(`${clientRedirect()}?gdrive=connected&tab=systeme`);
}));

router.use(authenticate);
router.use(requireAdmin);
router.use(sensitiveOpsRateLimit);

router.get('/google/status', asyncHandler(async (_req, res) => {
  res.json(await getStoreDriveStatus());
}));

router.get('/google/connect', asyncHandler(async (req, res) => {
  if (!isGoogleOAuthConfigured()) {
    return res.status(503).json({
      message: 'Google Drive non disponible — l\'hébergeur doit configurer GOOGLE_OAUTH_*',
    });
  }
  const state = jwt.sign(
    { sub: req.user.id, purpose: 'google_drive' },
    config.jwt.secret,
    { expiresIn: '15m' }
  );
  res.json({ url: buildGoogleAuthUrl(state) });
}));

router.delete('/google/disconnect', asyncHandler(async (req, res) => {
  await disconnectStoreDrive();
  await logAudit(req.user.id, 'update', 'store_settings', null, { change: 'google_drive_disconnected' });
  res.json({ message: 'Compte Google Drive déconnecté' });
}));

router.patch('/google/auto', validateToggleAutoBody, asyncHandler(async (req, res) => {
  await setBackupAutoEnabled(req.body.enabled !== false);
  res.json({ auto_enabled: req.body.enabled !== false });
}));

router.get('/', asyncHandler(async (_req, res) => {
  const backups = await listBackups(30);
  res.json(backups);
}));

router.post('/run', asyncHandler(async (req, res) => {
  const result = await runDatabaseBackup(req.user.id, { uploadToDrive: true });
  res.status(201).json({
    message: `Sauvegarde envoyée sur Google Drive : ${result.filename}`,
    ...result,
  });
}));

function sendDownloadFile(res, { filepath, filename, cleanup = false }) {
  res.download(filepath, filename, (err) => {
    if (cleanup) {
      try { fs.unlinkSync(filepath); } catch { /* ignore */ }
    } else if (filepath.includes(`${path.sep}exports${path.sep}`)) {
      try { fs.unlinkSync(filepath); } catch { /* ignore */ }
    }
    if (err && !res.headersSent) {
      res.status(500).json({ message: 'Téléchargement interrompu' });
    }
  });
}

router.get('/export/full', asyncHandler(async (req, res) => {
  const exported = await createDatabaseExportFile();
  await logAudit(req.user.id, 'create', 'backup', null, {
    action: 'export_sql',
    file: exported.filename,
    size_bytes: exported.size_bytes,
  });
  sendDownloadFile(res, { ...exported, cleanup: false });
}));

router.get('/export/package', asyncHandler(async (req, res) => {
  const exported = await createFullDataExportPackage();
  await logAudit(req.user.id, 'create', 'backup', null, {
    action: 'export_package',
    file: exported.filename,
    size_bytes: exported.size_bytes,
  });
  sendDownloadFile(res, { ...exported, cleanup: false });
}));

router.get('/:id/download', asyncHandler(async (req, res) => {
  const backupId = parseInt(req.params.id, 10);
  if (!backupId) return res.status(400).json({ message: 'Sauvegarde invalide' });
  const file = await resolveBackupDownloadFile(backupId);
  await logAudit(req.user.id, 'create', 'backup', backupId, {
    action: 'download',
    file: file.filename,
  });
  sendDownloadFile(res, file);
}));

router.post('/import', (req, res, next) => {
  importUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload invalide' });
    next();
  });
}, validateImportBody, asyncHandler(async (req, res) => {
  const { password, confirm_text } = req.body || {};
  if (confirm_text !== 'RESTAURER') {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    return res.status(400).json({ message: 'Tapez RESTAURER pour confirmer' });
  }
  if (!password) {
    if (req.file?.path) try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    return res.status(400).json({ message: 'Mot de passe administrateur requis' });
  }
  if (!req.file?.path) {
    return res.status(400).json({ message: 'Fichier .sql ou .zip requis' });
  }

  const { rows: userRows } = await pool.query(
    'SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE',
    [req.user.id]
  );
  if (!userRows.length || !(await bcrypt.compare(password, userRows[0].password_hash))) {
    try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    return res.status(403).json({ message: 'Mot de passe incorrect' });
  }

  const result = await restoreFromUploadedFile(req.file.path, req.file.originalname, req.user.id);
  await ensureComptoirClient().catch(() => {});
  res.json({
    message: result.uploads_restored
      ? 'Données importées (base + fichiers) — reconnectez-vous si besoin'
      : 'Base de données importée — reconnectez-vous si besoin',
    ...result,
  });
}));

router.post('/:id/restore', validateRestoreBody, asyncHandler(async (req, res) => {
  const backupId = parseInt(req.params.id, 10);
  const { password, confirm_text } = req.body;
  if (confirm_text !== 'RESTAURER') {
    return res.status(400).json({ message: 'Tapez RESTAURER pour confirmer' });
  }
  if (!password) {
    return res.status(400).json({ message: 'Mot de passe administrateur requis' });
  }

  const { rows: userRows } = await pool.query(
    'SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE',
    [req.user.id]
  );
  if (!userRows.length || !(await bcrypt.compare(password, userRows[0].password_hash))) {
    return res.status(403).json({ message: 'Mot de passe incorrect' });
  }

  const result = await restoreDatabaseBackup(backupId, req.user.id);
  await ensureComptoirClient().catch(() => {});
  res.json({
    message: 'Base de données restaurée depuis la sauvegarde',
    ...result,
  });
}));

router.post('/purge-old', validatePurgeBody, asyncHandler(async (req, res) => {
  const days = req.body.keep_days;
  const count = await purgeOldBackups(days);
  res.json({ message: `${count} ancienne(s) sauvegarde(s) supprimée(s)`, count });
}));

export default router;
