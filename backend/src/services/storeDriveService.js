import pool from '../db/pool.js';

const DRIVE_FIELDS = `google_drive_email, google_drive_refresh_token, google_drive_folder_id, backup_auto_enabled`;

export async function getStoreDriveSettings() {
  const { rows } = await pool.query(`SELECT ${DRIVE_FIELDS} FROM store_settings LIMIT 1`);
  return rows[0] || {};
}

export async function isStoreDriveConnected() {
  const settings = await getStoreDriveSettings();
  return Boolean(settings.google_drive_refresh_token);
}

export async function getStoreDriveStatus() {
  const settings = await getStoreDriveSettings();
  return {
    connected: Boolean(settings.google_drive_refresh_token),
    email: settings.google_drive_email || null,
    auto_enabled: settings.backup_auto_enabled !== false,
    oauth_available: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
  };
}

export async function saveStoreDriveConnection({ email, refreshToken, folderId = null }) {
  await pool.query(
    `UPDATE store_settings
     SET google_drive_email = $1,
         google_drive_refresh_token = $2,
         google_drive_folder_id = COALESCE($3, google_drive_folder_id),
         backup_auto_enabled = COALESCE(backup_auto_enabled, TRUE),
         updated_at = NOW()
     WHERE id = (SELECT id FROM store_settings LIMIT 1)`,
    [email, refreshToken, folderId]
  );
}

export async function updateStoreDriveFolderId(folderId) {
  await pool.query(
    `UPDATE store_settings SET google_drive_folder_id = $1, updated_at = NOW()
     WHERE id = (SELECT id FROM store_settings LIMIT 1)`,
    [folderId]
  );
}

export async function setBackupAutoEnabled(enabled) {
  await pool.query(
    `UPDATE store_settings SET backup_auto_enabled = $1, updated_at = NOW()
     WHERE id = (SELECT id FROM store_settings LIMIT 1)`,
    [Boolean(enabled)]
  );
}

export async function disconnectStoreDrive() {
  await pool.query(
    `UPDATE store_settings
     SET google_drive_email = NULL,
         google_drive_refresh_token = NULL,
         google_drive_folder_id = NULL,
         updated_at = NOW()
     WHERE id = (SELECT id FROM store_settings LIMIT 1)`
  );
}

/** Retire les champs sensibles pour l'API publique */
export function sanitizeStoreForClient(row = {}) {
  const {
    google_drive_refresh_token: _token,
    ...safe
  } = row;
  return {
    ...safe,
    google_drive_connected: Boolean(row.google_drive_refresh_token),
    google_drive_email: row.google_drive_email || null,
    backup_auto_enabled: row.backup_auto_enabled !== false,
  };
}
