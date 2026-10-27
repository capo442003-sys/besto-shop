import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { pickPrimaryRole, setUserRoles, getUserRoles } from '../utils/permissions.js';
import { setUserDeliveryPoints, loadUserDeliveryPointIds } from '../utils/userDeliveryPoints.js';
import { logAudit } from '../middleware/audit.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validatePasswordStrength } from '../utils/passwordPolicy.js';
import { resetAllData } from '../services/resetDataService.js';
import { sanitizeStoreForClient } from '../services/storeDriveService.js';
import { deleteDeliveryPoint } from '../utils/deliveryPointDelete.js';
import { deleteUser } from '../utils/userDelete.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const safe = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext) ? ext : '.png';
    cb(null, `store-logo-${Date.now()}${safe}`);
  },
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Format image invalide (PNG, JPG, GIF, WebP, SVG)'));
  },
});

const loginImageStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const slot = ['1', '2', '3'].includes(String(req.params.slot)) ? req.params.slot : '1';
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const safe = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.jpg';
    cb(null, `login-bg-${slot}${safe}`);
  },
});

const uploadLoginImage = multer({
  storage: loginImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Format image invalide (PNG, JPG, GIF, WebP)'));
  },
});

function deleteUploadedFile(url) {
  if (!url?.startsWith('/api/uploads/')) return;
  const filename = path.basename(url.split('?')[0]);
  const filePath = path.join(uploadsDir, filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

const router = Router();

router.get('/store', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM store_settings LIMIT 1');
  res.json(sanitizeStoreForClient(rows[0] || {}));
}));

router.use(authenticate);

const VALID_ROLES = [
  'administrateur', 'vendeur', 'caissier', 'controleur', 'gestionnaire', 'comptable', 'assistant', 'responsable_zone',
];

router.get('/roles', requireAdmin, (_req, res) => {
  res.json([
    { code: 'vendeur', label: 'Vendeur' },
    { code: 'caissier', label: 'Caissier' },
    { code: 'controleur', label: 'Contrôleur' },
    { code: 'gestionnaire', label: 'Gestionnaire' },
    { code: 'comptable', label: 'Comptable' },
    { code: 'assistant', label: 'Assistant' },
    { code: 'responsable_zone', label: 'Responsable de zone' },
    { code: 'administrateur', label: 'Administrateur' },
  ]);
});

router.put('/store', requireAdmin, async (req, res) => {
  const {
    store_name, logo_url, address, phone, phone_2, phone_3, email, pos_confirm_add_line,
    inventory_lock, theme, pos_idle_minutes,
  } = req.body;
  const { rows } = await pool.query(
    `UPDATE store_settings SET store_name=$1, logo_url=$2, address=$3, phone=$4, phone_2=$5, phone_3=$6, email=$7,
     pos_confirm_add_line = COALESCE($8, pos_confirm_add_line),
     inventory_lock = COALESCE($9, inventory_lock),
     theme = COALESCE($10, theme),
     pos_idle_minutes = COALESCE($11, pos_idle_minutes),
     updated_at=NOW()
     WHERE id = (SELECT id FROM store_settings LIMIT 1) RETURNING *`,
    [
      store_name, logo_url ?? null, address, phone, phone_2, phone_3, email, pos_confirm_add_line,
      inventory_lock, theme, pos_idle_minutes,
    ]
  );
  await logAudit(req.user.id, 'update', 'store_settings', rows[0]?.id || null, {
    store_name: rows[0]?.store_name,
  });
  res.json(sanitizeStoreForClient(rows[0]));
});

router.post('/reset-data', requireAdmin, asyncHandler(async (req, res) => {
  const { password, confirm_text } = req.body;
  if (confirm_text !== 'REINITIALISER') {
    return res.status(400).json({ message: 'Tapez REINITIALISER pour confirmer' });
  }
  if (!password) {
    return res.status(400).json({ message: 'Mot de passe administrateur requis' });
  }
  const { rows: userRows } = await pool.query(
    'SELECT password_hash FROM users WHERE id = $1 AND is_active = TRUE',
    [req.user.id]
  );
  if (!userRows.length) {
    return res.status(401).json({ message: 'Utilisateur introuvable' });
  }
  const valid = await bcrypt.compare(password, userRows[0].password_hash);
  if (!valid) {
    return res.status(403).json({ message: 'Mot de passe incorrect' });
  }
  try {
    const { tableCount } = await resetAllData(pool);
    await logAudit(req.user.id, 'delete', 'database', null, { action: 'reset_all_data', tableCount });
    res.json({
      message: 'Données réinitialisées. Compte admin : admin / admin123',
      tableCount,
    });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Réinitialisation impossible' });
  }
}));

router.post('/store/logo', requireAdmin, (req, res, next) => {
  uploadLogo.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload impossible' });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Fichier logo requis' });
  const { rows: prev } = await pool.query('SELECT logo_url FROM store_settings LIMIT 1');
  if (prev[0]?.logo_url) deleteUploadedFile(prev[0].logo_url);
  // Nettoyer d’anciens fichiers store-logo* orphelins (changement d’extension)
  try {
    for (const name of fs.readdirSync(uploadsDir)) {
      if (/^store-logo/i.test(name) && name !== req.file.filename) {
        fs.unlinkSync(path.join(uploadsDir, name));
      }
    }
  } catch {
    /* ignore */
  }
  const logo_url = `/api/uploads/${req.file.filename}`;
  const { rows } = await pool.query(
    `UPDATE store_settings SET logo_url=$1, updated_at=NOW()
     WHERE id = (SELECT id FROM store_settings LIMIT 1) RETURNING *`,
    [logo_url]
  );
  await logAudit(req.user.id, 'update', 'store_settings', rows[0]?.id || null, { change: 'logo_upload' });
  res.json(sanitizeStoreForClient(rows[0]));
});

router.delete('/store/logo', requireAdmin, asyncHandler(async (_req, res) => {
  const { rows: current } = await pool.query('SELECT logo_url FROM store_settings LIMIT 1');
  deleteUploadedFile(current[0]?.logo_url);
  const { rows } = await pool.query(
    `UPDATE store_settings SET logo_url=NULL, updated_at=NOW()
     WHERE id = (SELECT id FROM store_settings LIMIT 1) RETURNING *`
  );
  await logAudit(req.user.id, 'delete', 'store_settings', rows[0]?.id || null, { change: 'logo_removed' });
  res.json(rows[0]);
}));

router.post('/store/login-image/:slot', requireAdmin, (req, res, next) => {
  uploadLoginImage.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload impossible' });
    next();
  });
}, async (req, res) => {
  const slot = ['1', '2', '3'].includes(String(req.params.slot)) ? req.params.slot : null;
  if (!slot) return res.status(400).json({ message: 'Emplacement invalide (1, 2 ou 3)' });
  if (!req.file) return res.status(400).json({ message: 'Fichier image requis' });

  const column = `login_image_${slot}_url`;
  const { rows: current } = await pool.query(`SELECT ${column} AS url FROM store_settings LIMIT 1`);
  deleteUploadedFile(current[0]?.url);

  const imageUrl = `/api/uploads/${req.file.filename}`;
  const { rows } = await pool.query(
    `UPDATE store_settings SET ${column}=$1, updated_at=NOW()
     WHERE id = (SELECT id FROM store_settings LIMIT 1) RETURNING *`,
    [imageUrl]
  );
  await logAudit(req.user.id, 'update', 'store_settings', rows[0]?.id || null, {
    change: `login_image_${slot}_upload`,
  });
  res.json(rows[0]);
});

router.delete('/store/login-image/:slot', requireAdmin, asyncHandler(async (req, res) => {
  const slot = ['1', '2', '3'].includes(String(req.params.slot)) ? req.params.slot : null;
  if (!slot) return res.status(400).json({ message: 'Emplacement invalide (1, 2 ou 3)' });

  const column = `login_image_${slot}_url`;
  const { rows: current } = await pool.query(`SELECT ${column} AS url FROM store_settings LIMIT 1`);
  deleteUploadedFile(current[0]?.url);

  const { rows } = await pool.query(
    `UPDATE store_settings SET ${column}=NULL, updated_at=NOW()
     WHERE id = (SELECT id FROM store_settings LIMIT 1) RETURNING *`
  );
  await logAudit(req.user.id, 'delete', 'store_settings', rows[0]?.id || null, {
    change: `login_image_${slot}_removed`,
  });
  res.json(rows[0]);
}));

function mapUserRow(row) {
  let roles = row.roles;
  if (typeof roles === 'string') {
    if (roles.startsWith('{')) {
      const inner = roles.slice(1, -1);
      roles = inner ? inner.split(',').map((s) => s.trim()) : [];
    } else {
      roles = [roles];
    }
  }
  if (!Array.isArray(roles) || !roles.length) {
    roles = row.role ? [row.role] : [];
  }
  return { ...row, roles };
}

router.get('/users', requireAdmin, asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT u.id, u.username, u.full_name, u.role::text AS role, u.is_active, u.created_at,
           COALESCE(
             (SELECT array_agg(ur.role::text ORDER BY ur.role::text)
              FROM user_roles ur WHERE ur.user_id = u.id),
             ARRAY[u.role::text]
           ) AS roles
    FROM users u
    ORDER BY u.is_active DESC, u.full_name
  `);
  res.json(rows.map(mapUserRow));
}));

router.get('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, full_name, role::text AS role, is_active FROM users WHERE id = $1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Utilisateur introuvable' });
  const roles = await getUserRoles(parseInt(req.params.id, 10));
  const deliveryPoints = await loadUserDeliveryPointIds(parseInt(req.params.id, 10), roles);
  res.json({
    ...rows[0],
    roles,
    delivery_point_ids: deliveryPoints.map((r) => r.delivery_point_id),
    delivery_points: deliveryPoints.map((r) => ({
      id: r.delivery_point_id,
      code: r.code,
      name: r.name,
    })),
  });
}));

router.post('/users', requireAdmin, asyncHandler(async (req, res) => {
  const { username, password, full_name, roles, delivery_point_ids } = req.body;
  const roleList = (roles?.length ? roles : [req.body.role]).filter((r) => VALID_ROLES.includes(r));
  if (!username || !password || !full_name || !roleList.length) {
    return res.status(400).json({ message: 'Nom, identifiant, mot de passe et au moins un rôle requis' });
  }
  const policyErr = validatePasswordStrength(password);
  if (policyErr) return res.status(400).json({ message: policyErr });
  const primary = pickPrimaryRole(roleList);
  const hash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (username, password_hash, full_name, role, must_change_password)
       VALUES ($1,$2,$3,$4,TRUE) RETURNING id, username, full_name, role, is_active`,
      [username, hash, full_name, primary]
    );
    await setUserRoles(rows[0].id, roleList, client);
    if (roleList.includes('responsable_zone')) {
      await setUserDeliveryPoints(rows[0].id, delivery_point_ids, client);
    }
    await client.query('COMMIT');
    await logAudit(req.user.id, 'create', 'user', rows[0].id, { username: rows[0].username });
    res.status(201).json({ ...rows[0], roles: roleList });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(400).json({ message: 'Cet identifiant existe déjà' });
    res.status(500).json({ message: e.message });
  } finally {
    client.release();
  }
}));

router.put('/users/:id', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { username, full_name, password, roles, is_active, delivery_point_ids } = req.body;

  if (!full_name?.trim() || !username?.trim()) {
    return res.status(400).json({ message: 'Nom et identifiant requis' });
  }

  const roleList = roles ? (roles || []).filter((r) => VALID_ROLES.includes(r)) : null;
  if (roleList && !roleList.length) {
    return res.status(400).json({ message: 'Au moins un rôle requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dup = await client.query(
      'SELECT id FROM users WHERE username = $1 AND id != $2',
      [username.trim(), userId]
    );
    if (dup.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cet identifiant est déjà utilisé' });
    }

    if (password?.trim()) {
      const policyErr = validatePasswordStrength(password);
      if (policyErr) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: policyErr });
      }
      const hash = await bcrypt.hash(password, 10);
      await client.query(
        `UPDATE users SET username=$1, full_name=$2, password_hash=$3, is_active=$4,
         must_change_password = FALSE, updated_at=NOW()
         WHERE id=$5`,
        [username.trim(), full_name.trim(), hash, is_active !== false, userId]
      );
    } else {
      await client.query(
        `UPDATE users SET username=$1, full_name=$2, is_active=$3, updated_at=NOW() WHERE id=$4`,
        [username.trim(), full_name.trim(), is_active !== false, userId]
      );
    }

    if (roleList) {
      await setUserRoles(userId, roleList, client);
      if (roleList.includes('responsable_zone')) {
        await setUserDeliveryPoints(userId, delivery_point_ids, client);
      } else {
        await setUserDeliveryPoints(userId, [], client);
      }
    } else if (delivery_point_ids) {
      const rolesCurrent = await getUserRoles(userId);
      if (rolesCurrent.includes('responsable_zone')) {
        await setUserDeliveryPoints(userId, delivery_point_ids, client);
      }
    }

    await client.query('COMMIT');

    const rolesFinal = await getUserRoles(userId);
    const { rows } = await pool.query(
      'SELECT id, username, full_name, role::text AS role, is_active FROM users WHERE id = $1',
      [userId]
    );
    await logAudit(req.user.id, 'update', 'user', userId, { username: rows[0].username });
    res.json(mapUserRow({ ...rows[0], roles: rolesFinal }));
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: e.message });
  } finally {
    client.release();
  }
});

router.delete('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (req.user.id === userId) {
    return res.status(400).json({ message: 'Vous ne pouvez pas supprimer votre propre compte' });
  }

  const { rows: existing } = await pool.query(
    'SELECT id, username, full_name FROM users WHERE id = $1',
    [userId]
  );
  if (!existing.length) return res.status(404).json({ message: 'Utilisateur introuvable' });

  const user = existing[0];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await deleteUser(client, userId);
    await client.query('COMMIT');
    await logAudit(req.user.id, 'delete', 'user', userId, {
      username: user.username,
      full_name: user.full_name,
      permanent: true,
    });
    res.json({ message: `Utilisateur ${user.username} supprimé` });
  } catch (e) {
    await client.query('ROLLBACK');
    const status = e.message?.includes('dernier administrateur') ? 400 : 500;
    res.status(status).json({ message: e.message });
  } finally {
    client.release();
  }
}));

router.get('/delivery-points', requireAdmin, asyncHandler(async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM delivery_points ORDER BY is_active DESC, code');
  res.json(rows);
}));

router.post('/delivery-points', requireAdmin, asyncHandler(async (req, res) => {
  const code = req.body.code?.trim().toUpperCase();
  const name = req.body.name?.trim();
  if (!code || !name) {
    return res.status(400).json({ message: 'Code et nom requis' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO delivery_points (code, name) VALUES ($1, $2) RETURNING *',
      [code, name]
    );
    const pvId = rows[0].id;
    const { rows: products } = await client.query('SELECT id FROM products WHERE is_active = TRUE');
    for (const p of products) {
      await client.query(
        `INSERT INTO product_stock (product_id, delivery_point_id, quantity)
         VALUES ($1, $2, 0) ON CONFLICT (product_id, delivery_point_id) DO NOTHING`,
        [p.id, pvId]
      );
    }
    await client.query('COMMIT');
    await logAudit(req.user.id, 'create', 'delivery_point', pvId, {
      code: rows[0].code,
      name: rows[0].name,
      product_stock_rows: products.length,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(400).json({ message: 'Ce code existe déjà' });
    res.status(500).json({ message: e.message });
  } finally {
    client.release();
  }
}));

router.put('/delivery-points/:id', requireAdmin, async (req, res) => {
  const pointId = parseInt(req.params.id, 10);
  const code = req.body.code?.trim().toUpperCase();
  const name = req.body.name?.trim();
  const { is_active } = req.body;

  if (!code || !name) {
    return res.status(400).json({ message: 'Code et nom requis' });
  }

  const dup = await pool.query(
    'SELECT id FROM delivery_points WHERE code = $1 AND id != $2',
    [code, pointId]
  );
  if (dup.rows.length) {
    return res.status(400).json({ message: 'Ce code est déjà utilisé' });
  }

  const { rows } = await pool.query(
    'UPDATE delivery_points SET code=$1, name=$2, is_active=$3 WHERE id=$4 RETURNING *',
    [code, name, is_active !== false, pointId]
  );
  if (!rows.length) return res.status(404).json({ message: 'Point de vente introuvable' });
  await logAudit(req.user.id, 'update', 'delivery_point', pointId, {
    code: rows[0].code,
    name: rows[0].name,
  });
  res.json(rows[0]);
});

router.delete('/delivery-points/:id', requireAdmin, asyncHandler(async (req, res) => {
  const pointId = parseInt(req.params.id, 10);

  const { rows: existing } = await pool.query(
    'SELECT id, code, name FROM delivery_points WHERE id = $1',
    [pointId]
  );
  if (!existing.length) return res.status(404).json({ message: 'Point de vente introuvable' });

  const point = existing[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { employees, carts } = await deleteDeliveryPoint(client, pointId);
    await client.query('COMMIT');
    await logAudit(req.user.id, 'delete', 'delivery_point', pointId, {
      code: point.code,
      name: point.name,
      permanent: true,
      employeesDetached: employees,
      cartsDetached: carts,
    });
    const details = [];
    if (employees > 0) details.push(`${employees} employé(s) détaché(s)`);
    if (carts > 0) details.push(`${carts} vente(s) conservée(s) sans point de vente`);
    const suffix = details.length ? ` (${details.join(', ')})` : '';
    res.json({ message: `Point de vente ${point.code} supprimé${suffix}` });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: e.message });
  } finally {
    client.release();
  }
}));

router.get('/permissions-matrix', requireAdmin, asyncHandler(async (_req, res) => {
  const { rows: roles } = await pool.query(
    `SELECT id, code, COALESCE(label, code) AS label
     FROM roles
     ORDER BY COALESCE(label, code)`
  );
  const { rows: perms } = await pool.query(
    `SELECT rp.role_id, rp.module_code, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete, rp.can_print
     FROM role_permissions rp ORDER BY rp.module_code`
  );
  const modules = [...new Set(perms.map((p) => p.module_code))].sort();
  const matrix = roles.map((role) => ({
    role_id: role.id,
    role_code: role.code,
    role_name: role.label,
    modules: modules.map((mod) => {
      const p = perms.find((x) => x.role_id === role.id && x.module_code === mod);
      return {
        module_code: mod,
        can_view: Boolean(p?.can_view),
        can_create: Boolean(p?.can_create),
        can_edit: Boolean(p?.can_edit),
        can_delete: Boolean(p?.can_delete),
        can_print: Boolean(p?.can_print),
      };
    }),
  }));
  res.json({ modules, roles: matrix });
}));

router.put('/permissions-matrix', requireAdmin, asyncHandler(async (req, res) => {
  const permissions = Array.isArray(req.body?.permissions) ? req.body.permissions : null;
  if (!permissions?.length) {
    return res.status(400).json({ message: 'Liste permissions requise' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of permissions) {
      const roleId = parseInt(item.role_id, 10);
      const moduleCode = String(item.module_code || '').trim();
      if (!roleId || !moduleCode) continue;
      await client.query(
        `INSERT INTO role_permissions (
           role_id, module_code, can_view, can_create, can_edit, can_delete, can_print
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (role_id, module_code)
         DO UPDATE SET
           can_view = EXCLUDED.can_view,
           can_create = EXCLUDED.can_create,
           can_edit = EXCLUDED.can_edit,
           can_delete = EXCLUDED.can_delete,
           can_print = EXCLUDED.can_print`,
        [
          roleId,
          moduleCode,
          Boolean(item.can_view),
          Boolean(item.can_create),
          Boolean(item.can_edit),
          Boolean(item.can_delete),
          Boolean(item.can_print),
        ],
      );
    }
    await client.query('COMMIT');
    await logAudit(req.user.id, 'update', 'role_permissions', null, {
      count: permissions.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: roles } = await pool.query(
    `SELECT id, code, COALESCE(label, code) AS label
     FROM roles
     ORDER BY COALESCE(label, code)`
  );
  const { rows: perms } = await pool.query(
    `SELECT rp.role_id, rp.module_code, rp.can_view, rp.can_create, rp.can_edit, rp.can_delete, rp.can_print
     FROM role_permissions rp ORDER BY rp.module_code`
  );
  const modules = [...new Set(perms.map((p) => p.module_code))].sort();
  const matrix = roles.map((role) => ({
    role_id: role.id,
    role_code: role.code,
    role_name: role.label,
    modules: modules.map((mod) => {
      const p = perms.find((x) => x.role_id === role.id && x.module_code === mod);
      return {
        module_code: mod,
        can_view: Boolean(p?.can_view),
        can_create: Boolean(p?.can_create),
        can_edit: Boolean(p?.can_edit),
        can_delete: Boolean(p?.can_delete),
        can_print: Boolean(p?.can_print),
      };
    }),
  }));
  res.json({ modules, roles: matrix, message: 'Permissions enregistrées' });
}));

router.get('/pv-objectives', requireAdmin, asyncHandler(async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7) + '-01';
  const { rows } = await pool.query(
    `SELECT po.*, dp.code AS pv_code, dp.name AS pv_name
     FROM pv_objectives po
     JOIN delivery_points dp ON dp.id = po.delivery_point_id
     WHERE po.month = DATE_TRUNC('month', $1::date)::date
     ORDER BY dp.code`,
    [month]
  );
  res.json(rows);
}));

router.put('/pv-objectives', requireAdmin, asyncHandler(async (req, res) => {
  const { month, objectives } = req.body || {};
  if (!month || !Array.isArray(objectives)) {
    return res.status(400).json({ message: 'month et objectives requis' });
  }
  const monthDate = new Date(month);
  if (Number.isNaN(monthDate.getTime())) {
    return res.status(400).json({ message: 'Mois invalide' });
  }
  const monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}-01`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of objectives) {
      const pvId = parseInt(item.delivery_point_id, 10);
      const target = parseFloat(item.target_ca);
      if (!pvId || Number.isNaN(target) || target < 0) continue;
      await client.query(
        `INSERT INTO pv_objectives (delivery_point_id, month, target_ca, updated_at)
         VALUES ($1, $2::date, $3, NOW())
         ON CONFLICT (delivery_point_id, month)
         DO UPDATE SET target_ca = EXCLUDED.target_ca, updated_at = NOW()`,
        [pvId, monthKey, target]
      );
    }
    await client.query('COMMIT');
    await logAudit(req.user.id, 'update', 'pv_objectives', null, { month: monthKey, count: objectives.length });
    const { rows } = await pool.query(
      `SELECT po.*, dp.code AS pv_code, dp.name AS pv_name
       FROM pv_objectives po
       JOIN delivery_points dp ON dp.id = po.delivery_point_id
       WHERE po.month = $1::date ORDER BY dp.code`,
      [monthKey]
    );
    res.json(rows);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

export default router;
