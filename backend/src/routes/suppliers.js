import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { generateSupplierCode } from '../utils/codes.js';
import { logAudit } from '../middleware/audit.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
router.use(authenticate);

router.get('/types', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM supplier_product_types ORDER BY name');
  res.json(rows);
}));

router.post('/types', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'INSERT INTO supplier_product_types (name) VALUES ($1) RETURNING *',
    [req.body.name]
  );
  res.status(201).json(rows[0]);
}));

router.delete('/types/:id', requireAdmin, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM supplier_product_types WHERE id = $1', [req.params.id]);
  res.json({ message: 'Type supprimé' });
}));

router.get('/', asyncHandler(async (req, res) => {
  const { search } = req.query;
  let q = `SELECT s.*, t.name AS product_type_name FROM suppliers s
           LEFT JOIN supplier_product_types t ON t.id = s.product_type_id
           WHERE s.is_active = TRUE`;
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    q += ` AND (s.name ILIKE $1 OR s.code ILIKE $1)`;
  }
  q += ' ORDER BY s.name';
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { name, status, product_type_id, address, country, city, contact } = req.body;
  const code = await generateSupplierCode(pool, status || 'entreprise', contact);
  const { rows } = await pool.query(
    `INSERT INTO suppliers (name, code, status, product_type_id, address, country, city, contact)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [name, code, status, product_type_id, address, country, city, contact]
  );
  await logAudit(req.user.id, 'create', 'supplier', rows[0].id, { code: rows[0].code, name: rows[0].name });
  res.status(201).json(rows[0]);
}));

router.put('/:id', async (req, res) => {
  const supplierId = parseInt(req.params.id, 10);
  const { name, status, product_type_id, address, country, city, contact } = req.body;
  const { rows } = await pool.query(
    `UPDATE suppliers SET name=$1, status=$2, product_type_id=$3, address=$4, country=$5, city=$6, contact=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [name, status, product_type_id, address, country, city, contact, supplierId]
  );
  if (!rows.length) return res.status(404).json({ message: 'Fournisseur introuvable' });
  await logAudit(req.user.id, 'update', 'supplier', supplierId, { code: rows[0].code, name: rows[0].name });
  res.json(rows[0]);
});

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const supplierId = parseInt(req.params.id, 10);
  const { rows } = await pool.query('SELECT id, code, name FROM suppliers WHERE id = $1', [supplierId]);
  if (!rows.length) return res.status(404).json({ message: 'Fournisseur introuvable' });
  await pool.query('UPDATE suppliers SET is_active = FALSE WHERE id = $1', [supplierId]);
  await logAudit(req.user.id, 'delete', 'supplier', supplierId, { code: rows[0].code, name: rows[0].name });
  res.json({ message: 'Fournisseur désactivé' });
}));

export default router;
