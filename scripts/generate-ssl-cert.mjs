#!/usr/bin/env node
/**
 * Génère un certificat TLS auto-signé pour accès réseau local (PWA sans « non sécurisé »).
 * Usage : npm run ssl:generate
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

function resolveOpenssl() {
  if (process.env.OPENSSL_PATH && fs.existsSync(process.env.OPENSSL_PATH)) {
    return `"${process.env.OPENSSL_PATH}"`;
  }
  const gitOpenssl = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
  if (process.platform === 'win32' && fs.existsSync(gitOpenssl)) {
    return `"${gitOpenssl}"`;
  }
  return 'openssl';
}

const root = process.cwd();
const certDir = path.join(root, 'backend', 'certs');
const keyPath = path.join(certDir, 'server.key');
const certPath = path.join(certDir, 'server.crt');
const envPath = path.join(root, 'backend', '.env');

function getLocalIpv4() {
  const ips = new Set(['127.0.0.1']);
  for (const ifaces of Object.values(os.networkInterfaces())) {
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.add(iface.address);
      }
    }
  }
  return [...ips];
}

function buildSan(ips) {
  const parts = ['DNS:localhost', 'DNS:bmb.local', 'DNS:bmb-gestion.local'];
  for (const ip of ips) {
    parts.push(`IP:${ip}`);
  }
  return parts.join(',');
}

function patchEnv(port, protocol, primaryIp) {
  if (!fs.existsSync(envPath)) {
    console.warn(`⚠️  ${envPath} introuvable — ajoutez manuellement :`);
    console.warn(`   SSL_KEY_PATH=certs/server.key`);
    console.warn(`   SSL_CERT_PATH=certs/server.crt`);
    console.warn(`   CLIENT_URL=${protocol}://${primaryIp}:${port}`);
    return;
  }

  let env = fs.readFileSync(envPath, 'utf8');
  const set = (key, value) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${value}`;
    env = re.test(env) ? env.replace(re, line) : `${env.trimEnd()}\n${line}\n`;
  };

  set('SSL_KEY_PATH', 'certs/server.key');
  set('SSL_CERT_PATH', 'certs/server.crt');
  set('HTTPS', '1');
  set('CLIENT_URL', `${protocol}://${primaryIp}:${port}`);

  fs.writeFileSync(envPath, env);
  console.log(`✓ backend/.env mis à jour (CLIENT_URL=${protocol}://${primaryIp}:${port})`);
}

function main() {
  const port = process.env.PORT || '3001';
  const ips = getLocalIpv4();
  const primaryIp = ips.find((ip) => ip !== '127.0.0.1') || '127.0.0.1';
  const san = buildSan(ips);

  fs.mkdirSync(certDir, { recursive: true });

  if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath);
  if (fs.existsSync(certPath)) fs.unlinkSync(certPath);

  const subj = '/CN=BMB Gestion/O=BMB';
  const openssl = resolveOpenssl();
  const cmd =
    `${openssl} req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes ` +
    `-keyout "${keyPath}" -out "${certPath}" -subj "${subj}" ` +
    `-addext "subjectAltName=${san}"`;

  try {
    execSync(cmd, { stdio: 'inherit' });
  } catch {
    console.error('\n❌ OpenSSL requis. Installez Git for Windows (inclut openssl) ou OpenSSL.');
    console.error('   Puis relancez : npm run ssl:generate\n');
    process.exit(1);
  }

  patchEnv(port, 'https', primaryIp);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Certificat TLS généré pour BMB Gestion');
  console.log('══════════════════════════════════════════════════════════');
  console.log('\n1. Redémarrez le backend (npm run web:server ou npm start dans backend/)');
  console.log(`2. Ouvrez dans le navigateur : https://${primaryIp}:${port}`);
  console.log('3. Acceptez l\'avertissement certificat (auto-signé, réseau local)');
  console.log('4. Installez la PWA depuis cette adresse HTTPS');
  console.log('\nAdresses couvertes par le certificat :');
  for (const ip of ips) console.log(`   • https://${ip}:${port}`);
  console.log(`   • https://bmb.local:${port} (si DNS / fichier hosts configuré)`);
  console.log('');
}

main();
