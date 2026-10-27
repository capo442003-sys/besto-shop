import bcrypt from 'bcryptjs';
import pool from '../src/db/pool.js';

const hash = await bcrypt.hash('admin123', 10);
await pool.query(
  `UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE username = 'admin'`,
  [hash]
);
console.log('✓ Mot de passe admin réinitialisé (admin / admin123)');
await pool.end();
