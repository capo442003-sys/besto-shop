import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { ensureComptoirClient } from '../utils/comptoirClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function truncateAllTables(client) {
  const { rows } = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE 'pg_%'
    ORDER BY tablename
  `);

  if (rows.length === 0) return 0;

  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  await client.query(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  return rows.length;
}

async function seedReferenceData(client) {
  const seedSql = fs.readFileSync(path.join(__dirname, '../../../database/seed.sql'), 'utf8');
  await client.query(seedSql);

  const hash = await bcrypt.hash('admin123', 10);
  const ins = await client.query(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES ($1, $2, $3, 'administrateur') RETURNING id`,
    ['admin', hash, 'Administrateur BESTO SHOP']
  );
  await client.query(
    'INSERT INTO user_roles (user_id, role) VALUES ($1, $2)',
    [ins.rows[0].id, 'administrateur']
  );
  const { rows: emp } = await client.query(
    `INSERT INTO employees (name, matricule, function, hire_date)
     VALUES ('Administrateur BESTO SHOP', 'BSEMP-ADMIN-001', 'dg', CURRENT_DATE)
     RETURNING id`
  );
  await client.query('UPDATE users SET employee_id = $1 WHERE id = $2', [emp[0].id, ins.rows[0].id]);
}

/** Vide toutes les données métier et réinitialise les données de référence. */
export async function resetAllData(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tableCount = await truncateAllTables(client);
    await seedReferenceData(client);
    await client.query('COMMIT');
    await ensureComptoirClient();
    return { tableCount };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
