/**
 * Déploiement / mise à jour sur serveur (v1.0 → v1.2+)
 * Usage : npm run deploy:server
 *
 * Prérequis : Node.js, PostgreSQL, conserver backend/.env
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const backendDir = path.join(root, 'backend');
const frontendDir = path.join(root, 'frontend');
const distIndex = path.join(frontendDir, 'dist', 'index.html');
const envPath = path.join(backendDir, '.env');

function run(cmd, cwd = root, label = '') {
  if (label) console.log(`\n→ ${label}`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function step(msg) {
  console.log(`\n══ ${msg} ══`);
}

console.log('\n╔══════════════════════════════════════╗');
console.log('║  BMB — Déploiement serveur             ║');
console.log('╚══════════════════════════════════════╝');

if (!fs.existsSync(envPath)) {
  console.error('\n✗ Fichier manquant : backend\\.env');
  console.error('  Copiez l’ancien .env du serveur avant de continuer.');
  process.exit(1);
}

step('1/5 — Dépendances backend');
run('npm install', backendDir);

step('2/5 — Interface (frontend/dist)');
const mustBuild =
  process.env.BMB_REBUILD_FRONTEND === '1'
  || !fs.existsSync(distIndex);

if (mustBuild) {
  if (!fs.existsSync(path.join(frontendDir, 'node_modules'))) {
    run('npm install', frontendDir, 'Installation frontend');
  }
  run('npm run build:prod', root, 'Compilation frontend');
} else {
  console.log('✓ frontend/dist déjà présent (build ignoré)');
  console.log('  Pour forcer : set BMB_REBUILD_FRONTEND=1 && npm run deploy:server');
}

step('3/5 — Migrations PostgreSQL');
run('npm run db:migrate', backendDir);

step('4/5 — Vérifications');
try {
  run('node scripts/post-deploy-check.js', backendDir);
} catch {
  console.warn('⚠️  Vérifications partielles — consultez les messages ci-dessus');
}

step('5/5 — Tests API (optionnel)');
try {
  run('node scripts/smoke-test.js', backendDir);
} catch {
  console.warn('⚠️  Tests API non passés (backend arrêté ou identifiants admin changés)');
  console.warn('  Démarrez le backend puis : npm run test:api');
}

console.log('\n✓ Déploiement terminé.');
console.log('  Démarrez : cd backend && npm start');
console.log('  Ou : BESTO SHOP / BESTO SHOP');
console.log('  URL : http://localhost:3001\n');
