import { Router } from 'express';
import fs from 'fs';
import pool from '../db/pool.js';
import config from '../config/index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { listBackups, backupDir } from '../services/backupService.js';
import { buildCashDaySummary } from '../services/cashClosureService.js';
import { runDataHealthChecks } from '../services/dataHealthService.js';

const router = Router();

router.get('/status', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const [db, lowStock, backups, cashToday, cashYesterday, disk] = await Promise.all([
    pool.query('SELECT NOW() AS now, current_database() AS db_name'),
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM (
         SELECT p.id FROM products p
         JOIN product_stock ps ON ps.product_id = p.id
         JOIN delivery_points dp ON dp.id = ps.delivery_point_id AND dp.is_active = TRUE
         WHERE p.is_active = TRUE
         GROUP BY p.id, p.min_stock
         HAVING MAX(ps.quantity) <= p.min_stock
       ) x`
    ),
    listBackups(1).catch(() => []),
    buildCashDaySummary(today).catch(() => null),
    buildCashDaySummary(yesterday).catch(() => null),
    Promise.resolve(getDiskFree()),
  ]);

  res.json({
    version: config.appVersion,
    node_env: config.nodeEnv,
    database: db.rows[0]?.db_name,
    server_time: db.rows[0]?.now,
    low_stock_count: lowStock.rows[0]?.cnt ?? 0,
    last_backup_at: backups[0]?.created_at || null,
    backup_dir: backupDir,
    disk_free_mb: disk,
    cash_today_closed: Boolean(cashToday?.is_closed),
    cash_yesterday_closed: Boolean(cashYesterday?.is_closed),
    inventory_lock: await getInventoryLock(),
  });
}));

router.get('/data-health', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const report = await runDataHealthChecks();
  res.json(report);
}));

router.get('/sessions', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT sl.id, sl.user_id, sl.username, sl.action, sl.ip_address,
            sl.user_agent, sl.created_at, u.full_name
     FROM session_log sl
     LEFT JOIN users u ON u.id = sl.user_id
     ORDER BY sl.created_at DESC
     LIMIT 200`
  );
  res.json(rows);
}));

router.get('/data-health', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  res.json(await runDataHealthChecks());
}));

router.get('/sessions', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  const { rows } = await pool.query(
    `SELECT sl.*, u.full_name
     FROM session_log sl
     LEFT JOIN users u ON u.id = sl.user_id
     ORDER BY sl.created_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json(rows);
}));

router.get('/changelog', (_req, res) => {
  res.json({
    version: config.appVersion,
    entries: [
      { version: '1.2.0', date: '2026-05-23', highlights: ['Import données', 'Clôture caisse Z', 'Recherche globale', 'Thème sombre', 'Écran adaptatif', 'Sécurité renforcée'] },
      { version: '1.0.0', date: '2026-01-01', highlights: ['Version initiale magasin'] },
    ],
  });
});

async function getInventoryLock() {
  const { rows } = await pool.query('SELECT inventory_lock FROM store_settings LIMIT 1');
  return Boolean(rows[0]?.inventory_lock);
}

function getDiskFree() {
  try {
    if (!fs.existsSync(backupDir)) return null;
    return null;
  } catch {
    return null;
  }
}

export default router;
