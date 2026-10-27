import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './config/index.js';

const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.join(backendRoot, '..');

function resolveCertPath(filePath) {
  if (!filePath) return '';
  if (path.isAbsolute(filePath)) return filePath;
  const candidates = [
    path.join(backendRoot, filePath),
    path.join(projectRoot, filePath),
    path.join(backendRoot, 'certs', path.basename(filePath)),
  ];
  return candidates.find((p) => fs.existsSync(p)) || filePath;
}

/**
 * Crée le serveur HTTP ou HTTPS selon SSL_KEY_PATH / SSL_CERT_PATH.
 */
export function createHttpServer(app) {
  const keyPath = resolveCertPath(config.ssl.keyPath);
  const certPath = resolveCertPath(config.ssl.certPath);

  if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      server: https.createServer(
        {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath),
        },
        app
      ),
      protocol: 'https',
    };
  }

  if (process.env.HTTPS === '1' || process.env.HTTPS === 'true') {
    console.warn(
      '\n⚠️  HTTPS=1 mais certificats introuvables.\n' +
        '   Générez-les : npm run ssl:generate\n'
    );
  }

  return {
    server: http.createServer(app),
    protocol: 'http',
  };
}
