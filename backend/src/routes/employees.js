import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db/pool.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { requirePermission } from '../middleware/requirePermission.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { generateEmployeeMatricule } from '../utils/codes.js';
import { pickPrimaryRole, setUserRoles } from '../utils/permissions.js';
import { logAudit } from '../middleware/audit.js';
import {
  isZoneManager,
  canAccessAllPvs,
  pvCartSqlClause,
  pvEmployeeSqlClause,
  requiresPvIsolation,
  resolveDeliveryPointId,
  assertEmployeePvAccess,
} from '../utils/pvScope.js';
import {
  assertDgNotRemoved,
  assertManualDgNotAllowed,
  DG_UNIQUE_MESSAGE,
} from '../utils/dgEmployee.js';
import { deleteEmployee } from '../utils/employeeDelete.js';

const router = Router();
router.use(authenticate);

const FN_TO_ROLES = {
  vendeur: ['vendeur'],
  caissier: ['caissier'],
  vendeur_caissier: ['vendeur', 'caissier'],
  controleur: ['controleur'],
  gestionnaire: ['gestionnaire'],
  comptable: ['comptable'],
  assistant: ['assistant'],
  dg: ['administrateur'],
};

const PV_REQUIRED_FUNCTIONS = ['vendeur', 'caissier', 'vendeur_caissier', 'gestionnaire'];

function requiresDeliveryPoint(fn) {
  return PV_REQUIRED_FUNCTIONS.includes(fn);
}

function parseDeliveryPointId(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function parseOptionalSalary(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

function assertDeliveryPointForFunction(fn, deliveryPointId) {
  if (requiresDeliveryPoint(fn) && !deliveryPointId) {
    const err = new Error('Point de vente requis pour cette fonction');
    err.status = 400;
    throw err;
  }
}

async function createEmployeeUser(client, employee, { username, password, name, fn }) {
  const login = (username || employee.matricule).trim().toLowerCase().replace(/\s+/g, '');
  if (!login) throw new Error('Identifiant de connexion invalide');
  const pwd = password || 'bmb1234';
  const roleList = FN_TO_ROLES[fn] || ['vendeur'];
  const primary = pickPrimaryRole(roleList);
  const hash = await bcrypt.hash(pwd, 10);
  const { rows } = await client.query(
    `INSERT INTO users (username, password_hash, full_name, role, employee_id, must_change_password)
     VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id, username`,
    [login, hash, name, primary, employee.id]
  );
  await setUserRoles(rows[0].id, roleList, client);
  return rows[0];
}

router.get('/', asyncHandler(async (req, res) => {
  const { search, function: fn } = req.query;
  const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
  const pvScoped = requiresPvIsolation(req.user);
  let q = `SELECT e.*, u.id AS user_id, u.username AS user_username,
                  dp.code AS delivery_point_code, dp.name AS delivery_point_name
           FROM employees e
           LEFT JOIN users u ON u.employee_id = e.id AND u.is_active = TRUE
           LEFT JOIN delivery_points dp ON dp.id = e.delivery_point_id
           WHERE ${includeInactive ? 'TRUE' : 'e.is_active = TRUE'}`;
  const params = [];
  if (isZoneManager(req.user)) {
    const ids = req.user.allowed_delivery_point_ids || [];
    if (ids.length) {
      params.push(ids);
      q += ` AND e.delivery_point_id = ANY($${params.length}::int[])`;
    }
  } else if (pvScoped) {
    if (!req.user.delivery_point_id) {
      q += ' AND FALSE';
    } else {
      params.push(req.user.delivery_point_id);
      q += ` AND e.delivery_point_id = $${params.length}`;
    }
  } else if (canAccessAllPvs(req.user) && req.query.delivery_point_id) {
    const adminPv = parseDeliveryPointId(req.query.delivery_point_id);
    if (adminPv) {
      params.push(adminPv);
      q += ` AND e.delivery_point_id = $${params.length}`;
    }
  }
  if (search) {
    params.push(`%${search}%`);
    q += ` AND (e.name ILIKE $${params.length} OR e.matricule ILIKE $${params.length})`;
  }
  if (fn) {
    params.push(fn);
    q += ` AND e.function = $${params.length}`;
  }
  q += ' ORDER BY e.is_active DESC, e.name LIMIT 120';
  let summaryQ = `SELECT COUNT(*)::int AS count,
    COALESCE(SUM(monthly_salary), 0)::float AS total_salary
    FROM employees e WHERE e.is_active = TRUE`;
  const summaryParams = [];
  if (isZoneManager(req.user)) {
    const ids = req.user.allowed_delivery_point_ids || [];
    if (ids.length) {
      summaryParams.push(ids);
      summaryQ += ` AND e.delivery_point_id = ANY($${summaryParams.length}::int[])`;
    }
  } else if (pvScoped) {
    if (!req.user.delivery_point_id) {
      summaryQ += ' AND FALSE';
    } else {
      summaryParams.push(req.user.delivery_point_id);
      summaryQ += ` AND e.delivery_point_id = $${summaryParams.length}`;
    }
  } else if (canAccessAllPvs(req.user) && req.query.delivery_point_id) {
    const adminPv = parseDeliveryPointId(req.query.delivery_point_id);
    if (adminPv) {
      summaryParams.push(adminPv);
      summaryQ += ` AND e.delivery_point_id = $${summaryParams.length}`;
    }
  }
  if (search) {
    summaryParams.push(`%${search}%`);
    summaryQ += ` AND (e.name ILIKE $${summaryParams.length} OR e.matricule ILIKE $${summaryParams.length})`;
  }
  if (fn) {
    summaryParams.push(fn);
    summaryQ += ` AND e.function = $${summaryParams.length}`;
  }
  const [listRes, summaryRes] = await Promise.all([
    pool.query(q, params),
    pool.query(summaryQ, summaryParams),
  ]);
  const summary = summaryRes.rows[0] || { count: 0, total_salary: 0 };
  res.json({
    items: listRes.rows,
    summary,
    truncated: listRes.rows.length < (summary.count || 0),
  });
}));

router.post('/', requirePermission('employes', 'create'), asyncHandler(async (req, res) => {
  const {
    name,
    function: fn,
    monthly_salary,
    address,
    contact,
    hire_date,
    delivery_point_id,
    create_account,
    account_username,
    account_password,
  } = req.body;

  if (!name?.trim()) return res.status(400).json({ message: 'Nom requis' });

  const employeeFn = fn || 'vendeur';
  const pvId = resolveDeliveryPointId(req.user, delivery_point_id);

  try {
    assertManualDgNotAllowed(employeeFn);
    assertDeliveryPointForFunction(employeeFn, pvId);
  } catch (e) {
    return res.status(e.status || 400).json({ message: e.message });
  }

  const matricule = await generateEmployeeMatricule(pool, contact);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO employees (name, matricule, function, monthly_salary, address, contact, hire_date, delivery_point_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name.trim(), matricule, employeeFn, parseOptionalSalary(monthly_salary), address, contact, hire_date, pvId]
    );
    const employee = rows[0];

    let account = null;
    if (create_account) {
      account = await createEmployeeUser(client, employee, {
        username: account_username,
        password: account_password,
        name: name.trim(),
        fn: fn || 'vendeur',
      });
    }

    await client.query('COMMIT');
    await logAudit(req.user.id, 'create', 'employee', employee.id, {
      matricule: employee.matricule,
      name: employee.name,
    });
    res.status(201).json({ ...employee, user_id: account?.id, user_username: account?.username });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(400).json({ message: 'Matricule ou identifiant déjà utilisé' });
    if (e.status === 400) return res.status(400).json({ message: e.message });
    throw e;
  } finally {
    client.release();
  }
}));

router.post('/:id/create-account', requirePermission('employes', 'create'), asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const emp = await client.query('SELECT * FROM employees WHERE id = $1 AND is_active = TRUE', [req.params.id]);
    if (!emp.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Employé introuvable' });
    }
    try {
      await assertEmployeePvAccess(req.user, emp.rows[0], client);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(e.status || 403).json({ message: e.message });
    }
    const existing = await client.query(
      'SELECT id FROM users WHERE employee_id = $1 AND is_active = TRUE',
      [req.params.id]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Cet employé a déjà un compte' });
    }
    if (emp.rows[0].function === 'dg') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: DG_UNIQUE_MESSAGE });
    }
    const account = await createEmployeeUser(client, emp.rows[0], {
      username,
      password,
      name: emp.rows[0].name,
      fn: emp.rows[0].function,
    });
    await client.query('COMMIT');
    res.status(201).json(account);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(400).json({ message: 'Identifiant déjà utilisé' });
    res.status(400).json({ message: e.message });
  } finally {
    client.release();
  }
}));

router.put('/:id', requirePermission('employes', 'edit'), asyncHandler(async (req, res) => {
  const { name, function: fn, monthly_salary, address, contact, hire_date, delivery_point_id, is_active } = req.body;
  const employeeId = parseInt(req.params.id, 10);
  const current = await pool.query(
    'SELECT id, function, is_active, delivery_point_id FROM employees WHERE id = $1',
    [employeeId]
  );
  if (!current.rows.length) return res.status(404).json({ message: 'Employé introuvable' });

  try {
    await assertEmployeePvAccess(req.user, current.rows[0]);
  } catch (e) {
    return res.status(e.status || 403).json({ message: e.message });
  }

  const pvId = delivery_point_id !== undefined
    ? resolveDeliveryPointId(req.user, delivery_point_id)
    : current.rows[0].delivery_point_id;

  const nextFn = fn ?? current.rows[0].function;
  const nextActive = is_active !== undefined ? is_active !== false : current.rows[0].is_active;

  try {
    assertManualDgNotAllowed(nextFn, current.rows[0].function);
    await assertDgNotRemoved(employeeId, nextFn);
    assertDeliveryPointForFunction(nextFn, pvId);
    if (current.rows[0].function === 'dg' && nextActive === false) {
      return res.status(400).json({ message: 'Le Directeur général (DG) ne peut pas être désactivé.' });
    }
  } catch (e) {
    return res.status(e.status || 400).json({ message: e.message });
  }

  const { rows } = await pool.query(
    `UPDATE employees SET name=$1, function=$2, monthly_salary=$3, address=$4, contact=$5, hire_date=$6,
     delivery_point_id=$7, is_active=$8, updated_at=NOW()
     WHERE id=$9 RETURNING *`,
    [name, nextFn, parseOptionalSalary(monthly_salary), address, contact, hire_date || null, pvId, nextActive, employeeId]
  );
  if (!rows.length) return res.status(404).json({ message: 'Employé introuvable' });

  if (is_active === false) {
    await pool.query(
      'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE employee_id = $1',
      [employeeId]
    );
  }

  await logAudit(req.user.id, 'update', 'employee', employeeId, {
    matricule: rows[0].matricule,
    name: rows[0].name,
    is_active: rows[0].is_active,
  });
  res.json(rows[0]);
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const employeeId = parseInt(req.params.id, 10);
  try {
    await assertEmployeePvAccess(req.user, employeeId);
  } catch (e) {
    return res.status(e.status || 403).json({ message: e.message });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const employee = await deleteEmployee(client, employeeId, { actingUserId: req.user.id });
    await client.query('COMMIT');
    await logAudit(req.user.id, 'delete', 'employee', employeeId, {
      matricule: employee.matricule,
      name: employee.name,
      permanent: true,
    });
    res.json({ message: `Employé ${employee.name} supprimé` });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.status || 500).json({ message: e.message });
  } finally {
    client.release();
  }
}));

router.get('/salaries', asyncHandler(async (req, res) => {
  const { month, year } = req.query;
  let q = `SELECT sp.*, e.name, e.matricule FROM salary_payments sp JOIN employees e ON e.id = sp.employee_id WHERE 1=1`;
  const params = [];
  const empPv = pvEmployeeSqlClause(req.user, 'e', params.length + 1, req.query.delivery_point_id);
  if (empPv.sql) {
    q += empPv.sql;
    params.push(...empPv.params);
  }
  if (month) { params.push(month); q += ` AND sp.month = $${params.length}`; }
  if (year) { params.push(year); q += ` AND sp.year = $${params.length}`; }
  q += ' ORDER BY sp.year DESC, sp.month DESC';
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

router.post('/salaries', requirePermission('employes', 'create'), asyncHandler(async (req, res) => {
  const { employee_id, month, year, amount, notes } = req.body;
  try {
    await assertEmployeePvAccess(req.user, employee_id);
  } catch (e) {
    return res.status(e.status || 403).json({ message: e.message });
  }
  const { rows } = await pool.query(
    `INSERT INTO salary_payments (employee_id, month, year, amount, paid_at, notes)
     VALUES ($1,$2,$3,$4,NOW(),$5) RETURNING *`,
    [employee_id, month, year, amount, notes]
  );
  const emp = await pool.query('SELECT name, matricule FROM employees WHERE id = $1', [employee_id]);
  await logAudit(req.user.id, 'payment', 'salary_payment', rows[0].id, {
    employee_name: emp.rows[0]?.name,
    matricule: emp.rows[0]?.matricule,
    month,
    year,
    amount,
  });
  res.status(201).json(rows[0]);
}));

router.get('/schedules', asyncHandler(async (req, res) => {
  const { date_from, date_to, employee_id } = req.query;
  let q = `SELECT ws.*, e.name FROM work_schedules ws JOIN employees e ON e.id = ws.employee_id WHERE 1=1`;
  const params = [];
  const empPv = pvEmployeeSqlClause(req.user, 'e', params.length + 1, req.query.delivery_point_id);
  if (empPv.sql) {
    q += empPv.sql;
    params.push(...empPv.params);
  }
  if (employee_id) { params.push(employee_id); q += ` AND ws.employee_id = $${params.length}`; }
  if (date_from) { params.push(date_from); q += ` AND ws.schedule_date >= $${params.length}`; }
  if (date_to) { params.push(date_to); q += ` AND ws.schedule_date <= $${params.length}`; }
  q += ' ORDER BY ws.schedule_date DESC';
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

router.post('/schedules', requirePermission('employes', 'create'), asyncHandler(async (req, res) => {
  const { employee_id, schedule_date, start_time, end_time, notes } = req.body;
  try {
    await assertEmployeePvAccess(req.user, employee_id);
  } catch (e) {
    return res.status(e.status || 403).json({ message: e.message });
  }
  const { rows } = await pool.query(
    `INSERT INTO work_schedules (employee_id, schedule_date, start_time, end_time, notes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [employee_id, schedule_date, start_time, end_time, notes]
  );
  const emp = await pool.query('SELECT name FROM employees WHERE id = $1', [employee_id]);
  await logAudit(req.user.id, 'create', 'work_schedule', rows[0].id, {
    employee_name: emp.rows[0]?.name,
    schedule_date,
  });
  res.status(201).json(rows[0]);
}));

router.get('/sales-stats', asyncHandler(async (req, res) => {
  const { date_from, date_to } = req.query;
  const params = [];
  let q = `
    SELECT e.id, e.name, e.matricule,
           COUNT(DISTINCT sc.id) AS paniers_count,
           COALESCE(SUM(sc.total_amount), 0) AS total_ventes
    FROM employees e
    LEFT JOIN sales_carts sc ON sc.seller_id = e.id AND sc.status = 'finalise'`;
  if (date_from) { params.push(date_from); q += ` AND sc.validated_at >= $${params.length}`; }
  if (date_to) { params.push(date_to); q += ` AND sc.validated_at <= $${params.length}`; }
  const empPv = pvEmployeeSqlClause(req.user, 'e', params.length + 1, req.query.delivery_point_id);
  if (empPv.sql) {
    q += empPv.sql;
    params.push(...empPv.params);
  }
  const cartPv = pvCartSqlClause(req.user, 'sc', params.length + 1, req.query.delivery_point_id);
  if (cartPv.sql) {
    q += cartPv.sql;
    params.push(...cartPv.params);
  }
  q += ' GROUP BY e.id ORDER BY total_ventes DESC';
  const { rows } = await pool.query(q, params);
  res.json(rows);
}));

export default router;
