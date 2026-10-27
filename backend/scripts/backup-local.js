/**
 * Sauvegarde locale PostgreSQL (sans Google Drive)
 * Usage: npm run backup:db
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDatabaseBackup } from '../src/services/backupService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

try {
  const result = await runDatabaseBackup();
  console.log('✓ Sauvegarde OK:', result.filepath);
  process.exit(0);
} catch (err) {
  console.error('✗ Échec sauvegarde:', err.message);
  process.exit(1);
}
