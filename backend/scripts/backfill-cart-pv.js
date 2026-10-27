/**
 * Renseigne sales_carts.delivery_point_id depuis le vendeur ou le client.
 * node backend/scripts/backfill-cart-pv.js
 */
import pool from '../src/db/pool.js';

async function main() {
  const fromSeller = await pool.query(`
    UPDATE sales_carts sc
    SET delivery_point_id = e.delivery_point_id, updated_at = NOW()
    FROM employees e
    WHERE sc.delivery_point_id IS NULL
      AND sc.seller_id = e.id
      AND e.delivery_point_id IS NOT NULL
    RETURNING sc.id
  `);
  const fromClient = await pool.query(`
    UPDATE sales_carts sc
    SET delivery_point_id = c.delivery_point_id, updated_at = NOW()
    FROM clients c
    WHERE sc.delivery_point_id IS NULL
      AND sc.client_id = c.id
      AND c.delivery_point_id IS NOT NULL
      AND c.code != 'COMPTOIR'
    RETURNING sc.id
  `);
  const remaining = await pool.query(
    `SELECT COUNT(*)::int AS n FROM sales_carts WHERE delivery_point_id IS NULL AND status != 'annule'`
  );
  console.log(`Paniers mis à jour (vendeur): ${fromSeller.rowCount}`);
  console.log(`Paniers mis à jour (client): ${fromClient.rowCount}`);
  console.log(`Paniers encore sans PV: ${remaining.rows[0]?.n ?? 0}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
