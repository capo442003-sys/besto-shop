import pool from '../db/pool.js';

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

export async function logSession(userId, username, action, req) {
  try {
    await pool.query(
      `INSERT INTO session_log (user_id, username, action, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [userId, username, action, clientIp(req), req.headers['user-agent']?.slice(0, 500) || null]
    );
  } catch (e) {
    console.error('session_log:', e.message);
  }
}
