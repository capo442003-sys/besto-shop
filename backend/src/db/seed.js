import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import pool from './pool.js';
import { ensureComptoirClient } from '../utils/comptoirClient.js';

import { resolveDatabaseDir } from './sqlPaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function seed() {
  const client = await pool.connect();
  try {
    const seedSql = fs.readFileSync(path.join(resolveDatabaseDir(), 'seed.sql'), 'utf8');
    await client.query(seedSql);
    console.log('✓ Données de référence (seed.sql) vérifiées');

    // Rebrand + métier vêtements/chaussures (installations déjà seedées)
    await client.query(`
      UPDATE store_settings
      SET store_name = 'BESTO SHOP'
      WHERE store_name ILIKE '%BMB%'
         OR store_name ILIKE '%alimentaire%'
         OR store_name IS NULL
         OR TRIM(store_name) = ''
    `);
    // Purge démo alimentaire BMB (Riz, Farine, Huile, Sucre…)
    const food = await client.query(`
      SELECT id FROM products
      WHERE reference LIKE 'BMBPR-%'
         OR name ILIKE 'Riz %'
         OR name ILIKE 'Farine%'
         OR name ILIKE 'Huile%'
         OR name ILIKE 'Sucre%'
         OR name ILIKE '%végétale%'
    `);
    const foodIds = food.rows.map((r) => r.id);
    if (foodIds.length) {
      await client.query('DELETE FROM product_stock WHERE product_id = ANY($1::int[])', [foodIds]);
      await client.query('DELETE FROM product_price_history WHERE product_id = ANY($1::int[])', [foodIds]).catch(() => {});
      const del = await client.query(
        'DELETE FROM products WHERE id = ANY($1::int[]) RETURNING reference, name',
        [foodIds],
      );
      console.log(`✓ Articles alimentaires démo purgés (${del.rowCount})`);
    }

    await client.query(`
      DELETE FROM categories c
      WHERE c.name IN ('Alimentaires', 'Boissons', 'Agricoles', 'Agroalimentaire')
        AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id)
    `);
    await client.query(`
      DELETE FROM supplier_product_types t
      WHERE t.name IN ('Riz', 'Farine', 'Huile', 'Sucre', 'Boissons')
        AND NOT EXISTS (
          SELECT 1 FROM suppliers s WHERE s.product_type_id = t.id
        )
    `).catch(() => {});


    const { rows } = await client.query('SELECT id FROM users WHERE username = $1', ['admin']);
    if (rows.length > 0) {
      await client.query(
        'INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING',
        [rows[0].id, 'administrateur']
      );
    }
    if (rows.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      const ins = await client.query(
        `INSERT INTO users (username, password_hash, full_name, role)
         VALUES ($1, $2, $3, 'administrateur') RETURNING id`,
        ['admin', hash, 'Administrateur BESTO']
      );
      await client.query(
        'INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING',
        [ins.rows[0].id, 'administrateur']
      );
      console.log('✓ Utilisateur admin créé (admin / admin123)');
    }

    const adminRow = await client.query(
      `SELECT u.id FROM users u WHERE u.username = 'admin' AND u.employee_id IS NULL LIMIT 1`
    );
    if (adminRow.rows.length) {
      const { ensureAdminDgEmployee } = await import('../utils/dgEmployee.js');
      await ensureAdminDgEmployee(adminRow.rows[0].id);
      console.log('✓ Fiche employé liée au compte admin');
    }

    const prodCount = await client.query('SELECT COUNT(*) FROM products');
    if (parseInt(prodCount.rows[0].count, 10) === 0) {
      const cat = await client.query(
        "SELECT id FROM categories WHERE name IN ('Hommes','Femmes','Chaussures') ORDER BY id LIMIT 1"
      );
      const categoryId = cat.rows[0]?.id;
      const products = [
        { name: 'T-shirt coton Homme', ref: 'BESTO-TEE-001', achat: 45000, gros: 65000, detail: 85000, min: 10 },
        { name: 'Jean slim Femme', ref: 'BESTO-JEA-001', achat: 120000, gros: 160000, detail: 220000, min: 5 },
        { name: 'Baskets urban', ref: 'BESTO-SHO-001', achat: 180000, gros: 240000, detail: 320000, min: 8 },
        { name: 'Sac bandoulière', ref: 'BESTO-ACC-001', achat: 70000, gros: 95000, detail: 135000, min: 5 },
      ];
      for (const p of products) {
        const ins = await client.query(
          `INSERT INTO products (name, reference, category_id, purchase_price, wholesale_price, retail_price, min_stock)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [p.name, p.ref, categoryId, p.achat, p.gros, p.detail, p.min]
        );
        const pvs = await client.query('SELECT id FROM delivery_points');
        for (const pv of pvs.rows) {
          await client.query(
            `INSERT INTO product_stock (product_id, delivery_point_id, quantity) VALUES ($1,$2,$3)
             ON CONFLICT (product_id, delivery_point_id) DO NOTHING`,
            [ins.rows[0].id, pv.id, 50]
          );
        }
      }
      console.log('✓ Produits de démonstration créés');
    }

    const empCount = await client.query('SELECT COUNT(*) FROM employees');
    const pv1 = await client.query("SELECT id FROM delivery_points WHERE code = 'PV1' LIMIT 1");
    const pv1Id = pv1.rows[0]?.id || null;
    if (parseInt(empCount.rows[0].count, 10) === 0) {
      await client.query(
        `INSERT INTO employees (name, matricule, function, monthly_salary, contact, hire_date, delivery_point_id)
         VALUES ('Mamadou Diallo', 'BESTO-EMP-23-05-26-001', 'vendeur', 2500000, '620000001', CURRENT_DATE, $1),
                ('Fatoumata Bah', 'BESTO-EMP-23-05-26-002', 'caissier', 2200000, '620000002', CURRENT_DATE, $1)`,
        [pv1Id]
      );
      console.log('✓ Employés de démonstration créés');
    }

    console.log('✓ Seed terminé.');
    await ensureComptoirClient();
    console.log('✓ Client Comptoir vérifié');
  } catch (err) {
    console.error('Erreur seed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
