import fs from 'fs';
import { google } from 'googleapis';
import config from '../config/index.js';

const BACKUP_FOLDER_NAME = 'BESTO SHOP Sauvegardes';
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function isGoogleOAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
    && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  );
}

export function getOAuthRedirectUri() {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()) {
    return process.env.GOOGLE_OAUTH_REDIRECT_URI.trim();
  }
  const base = config.backendPublicUrl?.replace(/\/$/, '');
  if (!base) {
    throw new Error('BACKEND_PUBLIC_URL ou GOOGLE_OAUTH_REDIRECT_URI requis pour Google Drive');
  }
  return `${base}/api/backups/google/callback`;
}

export function createOAuthClient(refreshToken = null) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    getOAuthRedirectUri()
  );
  if (refreshToken) {
    oauth2.setCredentials({ refresh_token: refreshToken });
  }
  return oauth2;
}

export function buildGoogleAuthUrl(state) {
  const oauth2 = createOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DRIVE_SCOPES,
    state,
  });
}

export async function exchangeGoogleAuthCode(code) {
  const oauth2 = createOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Google n\'a pas renvoyé de jeton permanent — révoquez l\'accès BMB dans votre compte Google puis reconnectez.');
  }
  return tokens;
}

export async function fetchGoogleAccountEmail(oauth2) {
  const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
  const { data } = await oauth2Api.userinfo.get();
  return data.email || null;
}

async function getDriveClient(refreshToken) {
  const auth = createOAuthClient(refreshToken);
  return google.drive({ version: 'v3', auth });
}

export async function ensureClientBackupFolder(refreshToken, existingFolderId = null) {
  const drive = await getDriveClient(refreshToken);
  if (existingFolderId) {
    try {
      await drive.files.get({ fileId: existingFolderId, fields: 'id,trashed' });
      return existingFolderId;
    } catch {
      /* recréer le dossier */
    }
  }

  const search = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${BACKUP_FOLDER_NAME}' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 1,
  });
  if (search.data.files?.length) {
    return search.data.files[0].id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: BACKUP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });
  return created.data.id;
}

export async function uploadToClientDrive(refreshToken, folderId, filepath, filename) {
  if (!fs.existsSync(filepath)) {
    throw new Error(`Fichier introuvable : ${filepath}`);
  }
  const drive = await getDriveClient(refreshToken);
  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: folderId ? [folderId] : undefined,
    },
    media: { mimeType: 'application/sql', body: fs.createReadStream(filepath) },
  });
  if (!res.data.id) {
    throw new Error('Upload Google Drive sans identifiant de fichier');
  }
  return res.data.id;
}

export async function downloadFromClientDrive(refreshToken, fileId, destPath) {
  const drive = await getDriveClient(refreshToken);
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destPath);
    res.data.pipe(dest);
    dest.on('finish', resolve);
    dest.on('error', reject);
    res.data.on('error', reject);
  });
}
