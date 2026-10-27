/**
 * Supprime les articles de démo alimentaire (ancien seed BMB).
 * Usage: node backend/scripts/purge-food-demo.js
 */
import pool from '../src/db/pool.js';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(`
      SELECT id, reference, name
      FROM products
      WHERE reference LIKE 'BMBPR-%'
         OR reference ~* '^BESTO-0[1-4]-'
         OR name ILIKE '%riz %'
         OR name ILIKE 'farine%'
         OR name ILIKE 'huile%'
         OR name ILIKE 'sucre%'
         OR name ILIKE '%25kg%'
         OR name ILIKE '%50kg%'
         OR name ILIKE '%20L%'
    `);
    console.log('À supprimer:', found.rows.length);
    for (const r of found.rows) console.log(' -', r.reference, r.name);

    const ids = found.rows.map((r) => r.id);
    if (ids.length) {
      await client.query('DELETE FROM product_stock WHERE product_id = ANY($1::int[])', [ids]);
      await client.query(
        `DELETE FROM product_price_history WHERE product_id = ANY($1::int[])`,
        [ids],
      ).catch(() => {});
      // Ne pas casser l'historique de ventes : désactiver plutôt si lié
      const linked = await client.query(
        `SELECT DISTINCT product_id FROM sale_lines WHERE product_id = ANY($1::int[])
         UNION
         SELECT DISTINCT product_id FROM cart_items WHERE product_id = ANY($1::int[])`,
        [ids],
      ).catch(() => ({ rows: [] }));

      const linkedIds = new Set(linked.rows.map((r) => r.product_id));
      const pure = ids.filter((id) => !linkedIds.has(id));
      const soft = ids.filter((id) => linkedIds.has(id));

      if (pure.length) {
        const del = await client.query(
          `DELETE FROM products WHERE id = ANY($1::int[]) RETURNING reference, name`,
          [pure],
        );
        console.log('Supprimés:', del.rowCount);
      }
      if (soft.length) {
        await client.query(
          `UPDATE products SET name = '[ARCHIVÉ] ' || name, is_active = FALSE
           WHERE id = ANY($1::int[]) AND name NOT LIKE '[ARCHIVÉ]%'`,
          [soft],
        ).catch(async () => {
          await client.query(
            `UPDATE products SET name = '[ARCHIVÉ] ' || name WHERE id = ANY($1::int[]) AND name NOT LIKE '[ARCHIVÉ]%'`,
            [soft],
          );
        });
        console.log('Archivés (liés à des ventes):', soft.length);
      }
    }

    await client.query(`
      DELETE FROM categories c
      WHERE c.name IN ('Alimentaires', 'Boissons', 'Agricoles', 'Agroalimentaire')
        AND NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id)
    `);

    for (const n of ['Hommes', 'Femmes', 'Enfants', 'Chaussures', 'Accessoires']) {
      await client.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [n]);
    }

    await client.query('COMMIT');
    const left = await client.query(
      `SELECT p.reference, p.name, c.name AS cat
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY p.name LIMIT 30`,
    );
    console.log('Catalogue restant:', left.rows);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
