import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import { backupDir } from '../services/backupService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportsDir = path.join(__dirname, '../../backups/reports');

let started = false;

async function writeDailySalesReport() {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT dp.code AS pv_code, dp.name AS pv_name,
            COUNT(sc.id)::int AS paniers,
            COALESCE(SUM(sc.total_amount), 0)::float AS ca,
            COALESCE(SUM(sc.amount_paid), 0)::float AS encaisse
     FROM delivery_points dp
     LEFT JOIN sales_carts sc ON sc.delivery_point_id = dp.id
       AND sc.status = 'finalise'
       AND DATE(sc.validated_at) = $1::date
     WHERE dp.is_active = TRUE
     GROUP BY dp.id, dp.code, dp.name
     ORDER BY dp.code`,
    [today]
  );

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const header = 'pv_code;pv_name;paniers;ca;encaisse';
  const lines = rows.map((r) => [
    r.pv_code,
    `"${String(r.pv_name || '').replace(/"/g, '""')}"`,
    r.paniers,
    Math.round(r.ca),
    Math.round(r.encaisse),
  ].join(';'));

  const filename = `ventes-jour-${today}.csv`;
  const filepath = path.join(reportsDir, filename);
  fs.writeFileSync(filepath, [header, ...lines].join('\n'), 'utf8');
  console.log(`✓ Rapport ventes journalier : ${filepath} (${rows.length} PV)`);
}

export function startScheduledReports() {
  if (started) return;
  if (process.env.REPORTS_CRON_ENABLED === '0' || process.env.REPORTS_CRON_ENABLED === 'false') {
    return;
  }

  const schedule = process.env.REPORTS_CRON || '0 22 * * *';
  const timezone = process.env.REPORTS_TZ || 'Africa/Conakry';

  if (!cron.validate(schedule)) {
    console.error(`⚠️  REPORTS_CRON invalide : ${schedule}`);
    return;
  }

  cron.schedule(schedule, async () => {
    try {
      await writeDailySalesReport();
    } catch (err) {
      console.error('✗ Rapport planifié échoué:', err.message);
    }
  }, { timezone });

  started = true;
  console.log(`✓ Export ventes planifié (${schedule}, ${timezone}) → ${backupDir}/reports`);
}
