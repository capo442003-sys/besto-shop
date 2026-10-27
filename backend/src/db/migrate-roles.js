/**
 * Crée uniquement la table user_roles (si manquante).
 * Usage : npm run db:migrate:roles
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, '../../../database/migrations/002_user_multiple_roles.sql');

async function main() {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    const check = await client.query(
      `SELECT COUNT(*)::int AS n FROM user_roles`
    );
    console.log('✓ Table user_roles créée.');
    console.log(`✓ ${check.rows[0].n} liaison(s) utilisateur ↔ rôle.`);
  } catch (err) {
    console.error('Erreur:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
