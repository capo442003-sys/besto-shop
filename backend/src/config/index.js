import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

function buildClientUrls() {
  const urls = (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV !== 'production') {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      if (!urls.includes(origin)) urls.push(origin);
    }
  }
  if (process.env.SERVE_CLIENT === '1' || process.env.SERVE_CLIENT === 'true') {
    const port = process.env.PORT || '3001';
    for (const origin of [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      `https://localhost:${port}`,
      `https://127.0.0.1:${port}`,
    ]) {
      if (!urls.includes(origin)) urls.push(origin);
    }
  }
  return urls;
}

function vercelPreviewAllowed() {
  return process.env.ALLOW_VERCEL_CORS === '1' || process.env.ALLOW_VERCEL_CORS === 'true';
}

export function isAllowedClientOrigin(origin) {
  if (!origin) return true;
  const urls = buildClientUrls();
  if (urls.includes(origin)) return true;
  if (vercelPreviewAllowed()) {
    try {
      if (new URL(origin).hostname.endsWith('.vercel.app')) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function corsOriginCallback(origin, callback) {
  if (isAllowedClientOrigin(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`Origine CORS non autorisée: ${origin}`));
  }
}

const clientUrls = buildClientUrls();

export default {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/bmb_gestion',
  jwt: {
    secret: process.env.JWT_SECRET || 'bmb_dev_secret_change_in_prod',
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },
  clientUrls,
  allowVercelCors: vercelPreviewAllowed(),
  ssl: {
    keyPath: process.env.SSL_KEY_PATH || '',
    certPath: process.env.SSL_CERT_PATH || '',
  },
  appVersion: process.env.APP_VERSION || '1.2.0',
  backendPublicUrl: (process.env.BACKEND_PUBLIC_URL || process.env.RAILWAY_STATIC_URL || '').replace(/\/$/, ''),
};

if (
  process.env.NODE_ENV === 'production'
  && (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('change') || process.env.JWT_SECRET.includes('dev'))
) {
  console.warn('\n⚠️  BMB : Définissez un JWT_SECRET unique dans backend/.env avant la mise en production.\n');
}
