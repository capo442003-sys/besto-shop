/**
 * Sauvegarde PostgreSQL vers Google Drive (manuel ou cron Windows)
 * Usage : npm run backup:gdrive --prefix backend
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDatabaseBackup } from '../src/services/backupService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

try {
  const result = await runDatabaseBackup(null, { uploadToDrive: true });
  console.log(`✓ Sauvegarde terminée : ${result.filename}`);
  if (result.google_drive_file_id) {
    console.log(`✓ Google Drive : ${result.google_drive_file_id}`);
  }
} catch (err) {
  console.error('✗ Sauvegarde échouée:', err.message);
  process.exit(1);
}
