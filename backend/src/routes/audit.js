import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
router.use(authenticate);
router.use(requireAdmin);

function buildAuditQuery(query) {
  const limit = Math.min(parseInt(query.limit, 10) || 200, 2000);
  const params = [];
  let where = 'WHERE 1=1';

  if (query.user_id) {
    params.push(parseInt(query.user_id, 10));
    where += ` AND a.user_id = $${params.length}`;
  }
  if (query.action) {
    params.push(String(query.action).trim());
    where += ` AND a.action = $${params.length}`;
  }
  if (query.entity_type) {
    params.push(String(query.entity_type).trim());
    where += ` AND a.entity_type = $${params.length}`;
  }
  if (query.date_from) {
    params.push(query.date_from);
    where += ` AND a.created_at >= $${params.length}::date`;
  }
  if (query.date_to) {
    params.push(query.date_to);
    where += ` AND a.created_at < ($${params.length}::date + INTERVAL '1 day')`;
  }
  if (query.search) {
    params.push(`%${String(query.search).trim()}%`);
    where += ` AND (
      u.username ILIKE $${params.length}
      OR u.full_name ILIKE $${params.length}
      OR a.action ILIKE $${params.length}
      OR a.entity_type ILIKE $${params.length}
      OR a.details::text ILIKE $${params.length}
    )`;
  }

  params.push(limit);
  const sql = `
    SELECT a.*, u.username, u.full_name
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT $${params.length}`;

  return { sql, params, limit };
}

router.get('/', asyncHandler(async (req, res) => {
  const retentionMonths = Math.min(36, Math.max(1, parseInt(req.query.retention_months, 10) || 12));
  if (req.query.auto_purge === 'true') {
    await pool.query(
      `DELETE FROM audit_log WHERE created_at < NOW() - ($1::text || ' months')::interval`,
      [String(retentionMonths)]
    );
  }

  const { sql, params } = buildAuditQuery(req.query);
  const { rows } = await pool.query(sql, params);
  res.json(rows);
}));

router.get('/users', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.username, u.full_name
     FROM audit_log a
     JOIN users u ON u.id = a.user_id
     ORDER BY u.full_name`
  );
  res.json(rows);
}));

router.post('/purge', asyncHandler(async (req, res) => {
  const months = Math.min(36, Math.max(1, parseInt(req.body.retention_months, 10) || 12));
  const { rowCount } = await pool.query(
    `DELETE FROM audit_log WHERE created_at < NOW() - ($1::text || ' months')::interval`,
    [String(months)]
  );
  res.json({ message: `${rowCount} entrée(s) supprimée(s)`, deleted: rowCount });
}));

router.get('/export', asyncHandler(async (req, res) => {
  const { sql, params } = buildAuditQuery({ ...req.query, limit: 5000 });
  const { rows } = await pool.query(sql, params);

  const escape = (v) => {
    const s = v == null ? '' : String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header = ['Date', 'Utilisateur', 'Action', 'Entité', 'ID entité', 'Détails'];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      r.created_at,
      r.full_name || r.username || '',
      r.action,
      r.entity_type || '',
      r.entity_id ?? '',
      typeof r.details === 'object' ? JSON.stringify(r.details) : (r.details || ''),
    ].map(escape).join(';'));
  }

  const bom = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="journal-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(bom + lines.join('\n'));
}));

export default router;
