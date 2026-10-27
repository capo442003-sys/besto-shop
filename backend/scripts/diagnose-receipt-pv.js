/**
 * Vérifie l'isolation des reçus par PV vendeur (lecture seule).
 * node backend/scripts/diagnose-receipt-pv.js [username]
 */
import pool from '../src/db/pool.js';

const username = process.argv[2] || 'sanou';

async function main() {
  const { rows: users } = await pool.query(
    `SELECT u.id, u.username, u.full_name, u.employee_id,
            e.name AS employee_name, e.delivery_point_id,
            dp.code AS pv_code, dp.name AS pv_name
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     LEFT JOIN delivery_points dp ON dp.id = e.delivery_point_id
     WHERE LOWER(u.username) = LOWER($1) OR LOWER(e.name) LIKE LOWER($2)
     LIMIT 5`,
    [username, `%${username}%`]
  );
  console.log('Utilisateurs:', users);

  const sample = await pool.query(`
    SELECT sc.cart_number, sc.delivery_point_id AS cart_pv,
           dp1.code AS cart_pv_code,
           seller_emp.name AS seller_name,
           seller_emp.delivery_point_id AS seller_pv,
           dp2.code AS seller_pv_code,
           c.code AS client_code,
           cp.amount, cp.created_at
    FROM cart_payments cp
    JOIN sales_carts sc ON sc.id = cp.cart_id
    INNER JOIN employees seller_emp ON seller_emp.id = sc.seller_id
    LEFT JOIN delivery_points dp1 ON dp1.id = sc.delivery_point_id
    LEFT JOIN delivery_points dp2 ON dp2.id = seller_emp.delivery_point_id
    LEFT JOIN clients c ON c.id = sc.client_id
    ORDER BY cp.created_at DESC
    LIMIT 15
  `);
  console.log('\nDerniers reçus (PV panier vs PV vendeur):');
  for (const r of sample.rows) {
    console.log(
      `${r.cart_number} | panier=${r.cart_pv_code || r.cart_pv} | vendeur=${r.seller_name}@${r.seller_pv_code || r.seller_pv} | ${r.amount}`
    );
  }

  if (users[0]?.delivery_point_id) {
    const pv = users[0].delivery_point_id;
    const visible = await pool.query(`
      SELECT COUNT(*)::int AS n
      FROM cart_payments cp
      JOIN sales_carts sc ON sc.id = cp.cart_id
      INNER JOIN employees seller_emp ON seller_emp.id = sc.seller_id
      WHERE seller_emp.delivery_point_id = $1
    `, [pv]);
    const foreign = await pool.query(`
      SELECT COUNT(*)::int AS n
      FROM cart_payments cp
      JOIN sales_carts sc ON sc.id = cp.cart_id
      INNER JOIN employees seller_emp ON seller_emp.id = sc.seller_id
      WHERE seller_emp.delivery_point_id IS DISTINCT FROM $1
    `, [pv]);
    console.log(`\nPour PV ${users[0].pv_code} (id=${pv}): visibles=${visible.rows[0].n}, autres PV=${foreign.rows[0].n}`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
