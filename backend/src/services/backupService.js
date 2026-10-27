import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import unzipper from 'unzipper';
import pool from '../db/pool.js';
import {
  ensureClientBackupFolder,
  uploadToClientDrive,
  downloadFromClientDrive,
} from './googleDriveService.js';
import {
  getStoreDriveSettings,
  isStoreDriveConnected,
  updateStoreDriveFolderId,
} from './storeDriveService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const backupDir = path.join(__dirname, '../../backups');
const uploadsDir = path.join(__dirname, '../../uploads');
const exportDir = path.join(backupDir, 'exports');

const PG_DUMP_ARGS = ['--clean', '--if-exists', '--no-owner', '--no-acl'];

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      ...options,
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Impossible de lancer ${command}: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} a échoué (code ${code})${stderr ? `: ${stderr.trim()}` : ''}`));
      }
    });
  });
}

function exportStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeUnlink(filepath) {
  if (filepath && fs.existsSync(filepath)) {
    try { fs.unlinkSync(filepath); } catch { /* ignore */ }
  }
}

async function dumpDatabaseToFile(filepath) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL manquant dans backend/.env');
  }
  await runCommand('pg_dump', [...PG_DUMP_ARGS, process.env.DATABASE_URL, '-f', filepath]);
  return fs.statSync(filepath);
}

function shouldDeleteLocalAfterUpload() {
  if (process.env.BACKUP_DELETE_LOCAL === '1' || process.env.BACKUP_DELETE_LOCAL === 'true') {
    return true;
  }
  return process.env.NODE_ENV === 'production' && process.env.SERVE_CLIENT !== '1';
}

async function uploadBackupToClientDrive(filepath, filename) {
  const store = await getStoreDriveSettings();
  if (!store.google_drive_refresh_token) {
    throw new Error('Aucun compte Google Drive connecté — Paramètres → Magasin → Sauvegardes');
  }

  let folderId = store.google_drive_folder_id;
  folderId = await ensureClientBackupFolder(store.google_drive_refresh_token, folderId);
  if (folderId !== store.google_drive_folder_id) {
    await updateStoreDriveFolderId(folderId);
  }

  return uploadToClientDrive(store.google_drive_refresh_token, folderId, filepath, filename);
}

export async function createDatabaseExportFile() {
  ensureDir(exportDir);
  const filename = `besto_export_complet_${exportStamp()}.sql`;
  const filepath = path.join(exportDir, filename);
  const stat = await dumpDatabaseToFile(filepath);
  return { filename, filepath, size_bytes: stat.size };
}

export async function createFullDataExportPackage() {
  ensureDir(exportDir);
  const sqlExport = await createDatabaseExportFile();
  const zipFilename = `besto_export_complet_${exportStamp()}.zip`;
  const zipPath = path.join(exportDir, zipFilename);

  await new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.file(sqlExport.filepath, { name: 'database.sql' });
    if (fs.existsSync(uploadsDir)) {
      archive.directory(uploadsDir, 'uploads');
    }
    archive.append(
      [
        'Export complet BESTO SHOP',
        '',
        'Contenu :',
        '- database.sql : base PostgreSQL complète (clients, ventes, stocks, utilisateurs, permissions, etc.)',
        '- uploads/ : logos et fichiers images',
        '',
        'Restauration sur un nouveau serveur :',
        '1. Installer PostgreSQL et créer la base',
        '2. psql "postgresql://USER:PASS@HOST:5432/DB" -f database.sql',
        '3. Copier uploads/ dans backend/uploads/',
        '4. Lancer les migrations si besoin : npm run db:migrate',
        '',
        `Généré le ${new Date().toISOString()}`,
      ].join('\n'),
      { name: 'LISEZMOI.txt' },
    );
    archive.finalize();
  });

  safeUnlink(sqlExport.filepath);
  const stat = fs.statSync(zipPath);
  return { filename: zipFilename, filepath: zipPath, size_bytes: stat.size };
}

export async function resolveBackupDownloadFile(backupId) {
  const backup = await getBackupById(backupId);
  if (!backup) throw new Error('Sauvegarde introuvable');

  if (backup.file_path && fs.existsSync(backup.file_path)) {
    return {
      filepath: backup.file_path,
      filename: path.basename(backup.file_path),
      cleanup: false,
    };
  }

  if (backup.google_drive_file_id) {
    const store = await getStoreDriveSettings();
    if (!store.google_drive_refresh_token) {
      throw new Error('Compte Google Drive déconnecté — reconnectez-le pour télécharger');
    }
    ensureDir(path.join(backupDir, 'restore'));
    const tempFile = path.join(backupDir, 'restore', `download_${backupId}_${Date.now()}.sql`);
    await downloadFromClientDrive(store.google_drive_refresh_token, backup.google_drive_file_id, tempFile);
    return {
      filepath: tempFile,
      filename: path.basename(tempFile),
      cleanup: true,
    };
  }

  throw new Error('Fichier de sauvegarde introuvable');
}

export async function runDatabaseBackup(userId = null, options = {}) {
  const storeConnected = await isStoreDriveConnected();
  const uploadToDrive = options.uploadToDrive ?? storeConnected;

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL manquant dans backend/.env');
  }

  if (uploadToDrive && !storeConnected) {
    throw new Error('Connectez votre compte Google Drive pour sauvegarder');
  }

  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `besto_backup_${stamp}.sql`;
  const filepath = path.join(backupDir, filename);

  await dumpDatabaseToFile(filepath);

  const stat = fs.statSync(filepath);
  let googleDriveFileId = null;
  let backupType = 'local';

  if (uploadToDrive) {
    googleDriveFileId = await uploadBackupToClientDrive(filepath, filename);
    backupType = 'google_drive';
    if (shouldDeleteLocalAfterUpload()) {
      try { fs.unlinkSync(filepath); } catch { /* ignore */ }
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO backups (backup_type, file_path, google_drive_file_id, status, created_at)
     VALUES ($1, $2, $3, 'success', NOW()) RETURNING *`,
    [
      backupType,
      backupType === 'google_drive' && shouldDeleteLocalAfterUpload() ? null : filepath,
      googleDriveFileId,
    ]
  );

  if (userId) {
    const { logAudit } = await import('../middleware/audit.js');
    await logAudit(userId, 'create', 'backup', rows[0].id, {
      file: filename,
      size_bytes: stat.size,
      google_drive: Boolean(googleDriveFileId),
    });
  }

  return {
    backup: rows[0],
    filename,
    filepath: rows[0].file_path || filepath,
    size_bytes: stat.size,
    google_drive_file_id: googleDriveFileId,
  };
}

export async function getBackupById(id) {
  const { rows } = await pool.query('SELECT * FROM backups WHERE id = $1', [id]);
  return rows[0] || null;
}

async function runPsqlRestore(sqlPath) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL manquant');
  }
  if (!sqlPath || !fs.existsSync(sqlPath)) {
    throw new Error('Fichier SQL introuvable');
  }
  await runCommand('psql', [process.env.DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath]);
}

function copyDirRecursive(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function removeDirRecursive(dir) {
  if (!dir || !fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

async function extractZipArchive(zipPath, destDir) {
  ensureDir(destDir);
  const directory = await unzipper.Open.file(zipPath);
  await directory.extract({ path: destDir });
}

function findSqlInDirectory(dir) {
  const preferred = [
    path.join(dir, 'database.sql'),
    path.join(dir, 'besto_export_complet.sql'),
  ];
  for (const p of preferred) {
    if (fs.existsSync(p)) return p;
  }
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      } else if (entry.name.toLowerCase().endsWith('.sql')) {
        return full;
      }
    }
    return null;
  };
  return walk(dir);
}

/**
 * Restaure un export téléchargé (.sql ou .zip BMB).
 * Remplace toute la base (y compris utilisateurs).
 */
export async function restoreFromUploadedFile(uploadedPath, originalName, userId) {
  if (!uploadedPath || !fs.existsSync(uploadedPath)) {
    throw new Error('Fichier d\'import introuvable');
  }

  const lower = String(originalName || uploadedPath).toLowerCase();
  const workDir = path.join(backupDir, 'import', `job_${Date.now()}`);
  ensureDir(workDir);

  let sqlPath = null;
  let uploadsRestored = 0;

  try {
    if (lower.endsWith('.zip')) {
      await extractZipArchive(uploadedPath, workDir);
      sqlPath = findSqlInDirectory(workDir);
      if (!sqlPath) throw new Error('Aucun fichier .sql trouvé dans l\'archive (attendu : database.sql)');

      const uploadsCandidates = [
        path.join(workDir, 'uploads'),
        path.join(path.dirname(sqlPath), 'uploads'),
      ];
      for (const src of uploadsCandidates) {
        if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
          copyDirRecursive(src, uploadsDir);
          uploadsRestored = 1;
          break;
        }
      }
    } else if (lower.endsWith('.sql')) {
      sqlPath = path.join(workDir, 'import.sql');
      fs.copyFileSync(uploadedPath, sqlPath);
    } else {
      throw new Error('Format non supporté — utilisez .sql ou .zip (export BMB)');
    }

    await runPsqlRestore(sqlPath);

    const { logAudit } = await import('../middleware/audit.js');
    await logAudit(userId, 'update', 'backup', null, {
      action: 'import_restore',
      file: originalName,
      uploads_restored: uploadsRestored,
    });

    return {
      restored_at: new Date().toISOString(),
      source: originalName,
      uploads_restored: uploadsRestored,
    };
  } finally {
    removeDirRecursive(workDir);
    safeUnlink(uploadedPath);
  }
}

export async function restoreDatabaseBackup(backupId, userId) {
  const backup = await getBackupById(backupId);
  if (!backup) {
    throw new Error('Sauvegarde introuvable');
  }

  const tempDir = path.join(backupDir, 'restore');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  let sqlPath = backup.file_path;
  let tempFile = null;

  if (backup.google_drive_file_id) {
    const store = await getStoreDriveSettings();
    if (!store.google_drive_refresh_token) {
      throw new Error('Compte Google Drive déconnecté — reconnectez-le pour restaurer');
    }
    tempFile = path.join(tempDir, `restore_${backupId}_${Date.now()}.sql`);
    await downloadFromClientDrive(store.google_drive_refresh_token, backup.google_drive_file_id, tempFile);
    sqlPath = tempFile;
  }

  if (!sqlPath || !fs.existsSync(sqlPath)) {
    throw new Error('Fichier de sauvegarde introuvable');
  }

  try {
    await runPsqlRestore(sqlPath);
  } finally {
    if (tempFile && fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
    }
  }

  const { logAudit } = await import('../middleware/audit.js');
  await logAudit(userId, 'update', 'backup', backup.id, {
    action: 'restore',
    backup_type: backup.backup_type,
    google_drive_file_id: backup.google_drive_file_id,
  });

  return { backup_id: backup.id, restored_at: new Date().toISOString() };
}

export async function listBackups(limit = 20) {
  const { rows } = await pool.query(
    'SELECT * FROM backups ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return rows;
}

export async function purgeOldBackups(keepDays = 30) {
  const { rows } = await pool.query(
    `SELECT id, file_path FROM backups
     WHERE created_at < NOW() - ($1::text || ' days')::interval`,
    [String(keepDays)]
  );
  for (const row of rows) {
    if (row.file_path && fs.existsSync(row.file_path)) {
      try { fs.unlinkSync(row.file_path); } catch { /* ignore */ }
    }
  }
  if (rows.length) {
    await pool.query(
      'DELETE FROM backups WHERE id = ANY($1::int[])',
      [rows.map((r) => r.id)]
    );
  }
  return rows.length;
}

export { isStoreDriveConnected };
