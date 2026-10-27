import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAudit } from '../middleware/audit.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM categories ORDER BY name');
  res.json(rows);
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: 'Nom requis' });
  const { rows } = await pool.query('INSERT INTO categories (name) VALUES ($1) RETURNING *', [name.trim()]);
  await logAudit(req.user.id, 'create', 'category', rows[0].id, { name: rows[0].name });
  res.status(201).json(rows[0]);
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const categoryId = parseInt(req.params.id, 10);
  const existing = await pool.query('SELECT id, name FROM categories WHERE id = $1', [categoryId]);
  if (!existing.rows.length) return res.status(404).json({ message: 'Catégorie introuvable' });
  await pool.query('DELETE FROM categories WHERE id = $1', [categoryId]);
  await logAudit(req.user.id, 'delete', 'category', categoryId, { name: existing.rows[0].name });
  res.json({ message: 'Catégorie supprimée' });
}));

export default router;
