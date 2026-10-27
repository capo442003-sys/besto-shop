/**
 * Contrôles après déploiement serveur
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../..');
const distIndex = path.join(root, 'frontend', 'dist', 'index.html');

let failed = 0;

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function fail(msg) {
  console.error(`  ✗ ${msg}`);
  failed += 1;
}

async function main() {
  console.log('\nContrôles post-déploiement :\n');

  if (fs.existsSync(distIndex)) ok('frontend/dist/index.html présent');
  else fail('frontend/dist manquant — npm run build --prefix frontend');

  if (fs.existsSync(path.join(__dirname, '../.env'))) ok('backend/.env présent');
  else fail('backend/.env manquant');

  try {
    await pool.query('SELECT 1');
    ok('PostgreSQL connecté');
  } catch (e) {
    fail(`PostgreSQL : ${e.message}`);
    process.exit(1);
  }

  const checks = [
    ['users', 'table'],
    ['daily_cash', 'table'],
    ['schema_migrations', 'table'],
  ];

  for (const [name, type] of checks) {
    const q =
      type === 'view'
        ? `SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = $1) AS ok`
        : `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS ok`;
    const { rows } = await pool.query(q, [name]);
    if (rows[0].ok) ok(`${name} OK`);
    else fail(`${name} absent`);
  }

  const view = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'cash_closure') AS ok`
  );
  if (view.rows[0].ok) ok('vue cash_closure OK');
  else fail('vue cash_closure absente — npm run db:migrate');

  const { rows: mig } = await pool.query('SELECT COUNT(*)::int AS c FROM schema_migrations');
  ok(`journal migrations : ${mig[0].c} entrée(s)`);

  await pool.end();

  if (failed) {
    console.error(`\n✗ ${failed} contrôle(s) en échec\n`);
    process.exit(1);
  }
  console.log('\n✓ Tous les contrôles OK\n');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
