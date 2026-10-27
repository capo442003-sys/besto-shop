/**
 * Crée le dossier de distribution commercial BMB-Gestion-1.0.0
 * Usage : npm run release
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const outName = `BMB-Gestion-${version}`;
const outDir = path.join(root, 'dist', outName);

const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.cursor',
  'terminals',
]);

const EXCLUDE_FILES = new Set([
  '.env',
  '.DS_Store',
]);

function shouldSkip(rel) {
  const parts = rel.split(path.sep);
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  if (EXCLUDE_FILES.has(path.basename(rel))) return true;
  if (rel.endsWith('.log')) return true;
  return false;
}

function copyRecursive(src, dest, base = src) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    const rel = path.relative(base, src);
    if (rel && shouldSkip(rel)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name), base);
    }
  } else {
    const rel = path.relative(base, src);
    if (shouldSkip(rel)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

console.log(`\n═══ BMB — Package commercial ${version} ═══\n`);

console.log('→ Compilation frontend...');
execSync('npm run build', { cwd: path.join(root, 'frontend'), stdio: 'inherit' });

if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true, force: true });
}
fs.mkdirSync(outDir, { recursive: true });

const toCopy = [
  'backend',
  'frontend',
  'electron',
  'database',
  'scripts',
  'docs',
  'package.json',
  'package-lock.json',
  'VERSION',
  'README.md',
  'LIRE-MOI.txt',
  'INSTALLER BMB.bat',
  'BESTO SHOP',
  'BESTO SHOP',
  'METTRE-A-JOUR-SERVEUR.bat',
  'REMPLACER-ANCIENNE-VERSION.bat',
  'CREER PACKAGE COMMERCIAL.bat',
];

for (const item of toCopy) {
  const src = path.join(root, item);
  if (!fs.existsSync(src)) continue;
  console.log(`→ Copie ${item}...`);
  copyRecursive(src, path.join(outDir, item), src);
}

const envExample = path.join(outDir, 'backend', '.env.production.example');
const envTarget = path.join(outDir, 'backend', '.env.example');
if (fs.existsSync(envExample)) {
  fs.copyFileSync(envExample, envTarget);
}

const checklist = `# Checklist livraison BMB ${version}

- [ ] INSTALLER BMB.bat exécuté chez le client
- [ ] backend/.env configuré (PostgreSQL + JWT_SECRET)
- [ ] Mot de passe admin changé
- [ ] Formation effectuée
- [ ] Sauvegarde PostgreSQL expliquée

Dossier prêt : ${outName}
`;

fs.writeFileSync(path.join(outDir, 'CHECKLIST_LIVRAISON.txt'), checklist, 'utf8');

console.log(`\n✓ Package créé : dist/${outName}`);
console.log('  Remettez ce dossier au client + exécutez INSTALLER BMB.bat sur site.\n');
