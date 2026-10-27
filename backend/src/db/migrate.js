import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './pool.js';
import { resolveDatabaseDir } from './sqlPaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const databaseDir = resolveDatabaseDir();
const schemaPath = path.join(databaseDir, 'schema.sql');
const migrationsDir = path.join(databaseDir, 'migrations');

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS ok`,
    [tableName]
  );
  return rows[0].ok;
}

async function columnExists(client, tableName, columnName) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS ok`,
    [tableName, columnName]
  );
  return rows[0].ok;
}

async function viewExists(client, viewName) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.views
       WHERE table_schema = 'public' AND table_name = $1
     ) AS ok`,
    [viewName]
  );
  return rows[0].ok;
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function isMigrationRecorded(client, filename) {
  const { rows } = await client.query(
    'SELECT 1 FROM schema_migrations WHERE filename = $1',
    [filename]
  );
  return rows.length > 0;
}

async function recordMigration(client, filename) {
  await client.query(
    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
    [filename]
  );
}

/** Détecte si une migration a déjà été appliquée sur une base v1.0 (sans journal). */
async function alreadyAppliedOnLegacyDb(client, filename) {
  if (filename.startsWith('002_')) return tableExists(client, 'user_roles');
  if (filename.startsWith('003_')) return tableExists(client, 'cart_payments');
  if (filename.startsWith('004_')) {
    const { rows } = await client.query('SELECT COUNT(*)::int AS c FROM product_stock');
    return rows[0].c > 0;
  }
  if (filename.startsWith('005_')) {
    const { rows } = await client.query(
      `SELECT 1 FROM roles WHERE code = 'controleur' LIMIT 1`
    );
    return rows.length > 0;
  }
  if (filename.startsWith('006_')) return tableExists(client, 'purchase_order_payments');
  if (filename.startsWith('007_')) return columnExists(client, 'store_settings', 'login_image_1_url');
  if (filename.startsWith('008_')) return columnExists(client, 'users', 'must_change_password');
  if (filename.startsWith('009_')) return columnExists(client, 'daily_cash', 'closed_at');
  if (filename.startsWith('010_')) return tableExists(client, 'product_price_history');
  if (filename.startsWith('011_')) return viewExists(client, 'cash_closure');
  if (filename.startsWith('012_')) {
    const { rows } = await client.query(
      `SELECT 1 FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'employee_function' AND e.enumlabel = 'dg'`
    );
    return rows.length > 0;
  }
  if (filename.startsWith('013_')) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS c FROM employees WHERE function = 'dg' AND is_active = TRUE`
    );
    return rows[0].c <= 1;
  }
  if (filename.startsWith('016_')) return columnExists(client, 'store_settings', 'google_drive_email');
  if (filename.startsWith('030_')) return columnExists(client, 'daily_cash', 'delivery_point_id');
  return false;
}

async function runSqlFile(client, filePath, label) {
  const sql = fs.readFileSync(filePath, 'utf8');
  await client.query(sql);
  console.log(`✓ ${label}`);
}

async function backfillLegacyMigrations(client) {
  const { rows } = await client.query('SELECT COUNT(*)::int AS c FROM schema_migrations');
  if (rows[0].c > 0) return;

  const hasUsers = await tableExists(client, 'users');
  if (!hasUsers) return;

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let marked = 0;
  for (const file of files) {
    if (await alreadyAppliedOnLegacyDb(client, file)) {
      await recordMigration(client, file);
      marked += 1;
    }
  }
  if (marked) {
    console.log(`— ${marked} migration(s) existante(s) enregistrée(s) (base v1.0 → journal)`);
  }
}

async function migrate() {
  const client = await pool.connect();
  try {
    const hasUsers = await tableExists(client, 'users');

    if (!hasUsers) {
      await runSqlFile(client, schemaPath, 'Schéma principal (nouvelle base)');
    }

    await ensureMigrationsTable(client);

    if (hasUsers) {
      await backfillLegacyMigrations(client);
    }

    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        if (await isMigrationRecorded(client, file)) {
          console.log(`— ${file} (déjà appliqué)`);
          continue;
        }
        const full = path.join(migrationsDir, file);
        try {
          await runSqlFile(client, full, file);
          await recordMigration(client, file);
        } catch (err) {
          if (err.code === '42P07' || err.code === '42710') {
            console.log(`— ${file} (déjà appliqué)`);
            await recordMigration(client, file);
          } else {
            throw err;
          }
        }
      }
    }

    if (!(await tableExists(client, 'user_roles'))) {
      console.error('✗ La table user_roles est absente. Vérifiez PostgreSQL.');
      process.exit(1);
    }

    if (!(await tableExists(client, 'daily_cash'))) {
      console.warn('⚠️  Table daily_cash absente — exécutez à nouveau db:migrate');
    }

    console.log('✓ Migrations terminées.');
  } catch (err) {
    console.error('Erreur migration:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
