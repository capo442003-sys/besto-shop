import cron from 'node-cron';
import config from '../config/index.js';
import { getStoreDriveSettings } from '../services/storeDriveService.js';
import { runDatabaseBackup } from '../services/backupService.js';

let started = false;

export function startScheduledBackup() {
  if (started) return;
  if (process.env.BACKUP_CRON_ENABLED === '0' || process.env.BACKUP_CRON_ENABLED === 'false') {
    return;
  }

  const schedule = process.env.BACKUP_CRON || '0 3 * * *';
  const timezone = process.env.BACKUP_TZ || 'Africa/Conakry';

  if (!cron.validate(schedule)) {
    console.error(`⚠️  BACKUP_CRON invalide : ${schedule}`);
    return;
  }

  cron.schedule(schedule, async () => {
    try {
      const store = await getStoreDriveSettings();
      if (!store.google_drive_refresh_token) return;
      if (store.backup_auto_enabled === false) return;

      const result = await runDatabaseBackup(null, { uploadToDrive: true });
      console.log(`✓ Sauvegarde planifiée (${store.google_drive_email}) : ${result.filename}`);
    } catch (err) {
      console.error('✗ Sauvegarde planifiée échouée:', err.message);
    }
  }, { timezone });

  started = true;
  console.log(`✓ Sauvegarde automatique activée si Google Drive client connecté (${schedule}, ${timezone})`);
}
