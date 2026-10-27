import cron from 'node-cron';
import { cancelAbandonedOpenCartsGlobally } from '../services/salesService.js';

let started = false;

export async function runStaleCartCleanup() {
  const { cancelled } = await cancelAbandonedOpenCartsGlobally();
  return cancelled;
}

export function startScheduledStaleCarts() {
  if (started) return;
  if (process.env.STALE_CART_CRON_ENABLED === '0' || process.env.STALE_CART_CRON_ENABLED === 'false') {
    return;
  }

  const schedule = process.env.STALE_CART_CRON || '*/15 * * * *';
  const timezone = process.env.BACKUP_TZ || 'Africa/Conakry';

  if (!cron.validate(schedule)) {
    console.error(`⚠️  STALE_CART_CRON invalide : ${schedule}`);
    return;
  }

  cron.schedule(schedule, async () => {
    try {
      const cancelled = await runStaleCartCleanup();
      if (cancelled > 0) {
        console.log(`✓ Paniers abandonnés annulés : ${cancelled}`);
      }
    } catch (err) {
      console.error('✗ Nettoyage paniers abandonnés échoué:', err.message);
    }
  }, { timezone });

  started = true;
  console.log(`✓ Annulation auto des paniers abandonnés (${schedule}, ${timezone})`);
}
