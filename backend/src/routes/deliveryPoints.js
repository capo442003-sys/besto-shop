import { Router } from 'express';

import pool from '../db/pool.js';

import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

import { isPvScoped, isZoneManager, canAccessAllPvs, requiresPvIsolation } from '../utils/pvScope.js';



const router = Router();

router.use(authenticate);



router.get('/', asyncHandler(async (req, res) => {

  if (requiresPvIsolation(req.user)) {
    if (isZoneManager(req.user)) {
      const ids = req.user.allowed_delivery_point_ids || [];
      if (!ids.length) return res.json([]);
      const { rows } = await pool.query(
        'SELECT * FROM delivery_points WHERE id = ANY($1::int[]) AND is_active = TRUE ORDER BY code',
        [ids]
      );
      return res.json(rows);
    }
    if (req.user.delivery_point_id) {
      const { rows } = await pool.query(
        'SELECT * FROM delivery_points WHERE id = $1 AND is_active = TRUE',
        [req.user.delivery_point_id]
      );
      return res.json(rows);
    }
    return res.json([]);
  }

  const { rows } = await pool.query('SELECT * FROM delivery_points WHERE is_active = TRUE ORDER BY code');
  res.json(rows);
}));



export default router;

