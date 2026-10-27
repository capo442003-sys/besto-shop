/**
 * Vérifie PostgreSQL avant le démarrage (BESTO SHOP).
 * Code 0 = OK, 1 = base inaccessible (le serveur peut quand même démarrer).
 */
import pool from '../src/db/pool.js';

try {
  await pool.query('SELECT 1');
  console.log('✓ PostgreSQL accessible');
  process.exit(0);
} catch (err) {
  console.error('✗ PostgreSQL inaccessible:', err.message);
  console.error('  → Vérifiez DATABASE_URL dans backend\\.env');
  console.error('  → Démarrez le service PostgreSQL');
  console.error('  → Mot de passe attendu : Bmbgestion2026 (pas Bbmgestion2026)');
  process.exit(1);
} finally {
  await pool.end();
}
