import { Router } from 'express';
import pool from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { pvClientSqlClause, pvCartSqlClause } from '../utils/pvScope.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ products: [], clients: [], carts: [], orders: [] });

  const like = `%${q}%`;
  const requestedPv = req.query.delivery_point_id;

  const clientParams = [like];
  const clientPv = pvClientSqlClause(req.user, 'c', clientParams.length + 1, requestedPv);
  clientParams.push(...clientPv.params);

  const cartParams = [like];
  const cartPv = pvCartSqlClause(req.user, 'sc', cartParams.length + 1, requestedPv);
  cartParams.push(...cartPv.params);

  const orderParams = [like];
  const orderPv = pvClientSqlClause(req.user, 'c', orderParams.length + 1, requestedPv);
  orderParams.push(...orderPv.params);

  const [products, clients, carts, orders] = await Promise.all([
    pool.query(
      `SELECT id, name, reference FROM products
       WHERE is_active = TRUE AND (name ILIKE $1 OR reference ILIKE $1)
       ORDER BY name LIMIT 12`,
      [like]
    ),
    pool.query(
      `SELECT id, name, code FROM clients c
       WHERE is_active = TRUE AND (name ILIKE $1 OR code ILIKE $1 OR contact ILIKE $1)
       ${clientPv.sql}
       ORDER BY name LIMIT 12`,
      clientParams
    ),
    pool.query(
      `SELECT sc.id, sc.cart_number, sc.status, sc.total_amount FROM sales_carts sc
       WHERE sc.cart_number ILIKE $1 AND sc.status != 'annule'
       ${cartPv.sql}
       ORDER BY sc.created_at DESC LIMIT 8`,
      cartParams
    ),
    pool.query(
      `SELECT po.id, po.order_number, po.status, po.total_amount
       FROM purchase_orders po
       LEFT JOIN clients c ON c.id = po.client_id
       WHERE po.order_number ILIKE $1
       ${orderPv.sql}
       ORDER BY po.created_at DESC LIMIT 8`,
      orderParams
    ),
  ]);

  res.json({
    products: products.rows,
    clients: clients.rows,
    carts: carts.rows,
    orders: orders.rows,
  });
}));

export default router;
