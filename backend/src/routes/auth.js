import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db/pool.js';
import config from '../config/index.js';
import { authenticate } from '../middleware/auth.js';
import { getUserRoles, getMergedPermissions, pickPrimaryRole, isAdmin } from '../utils/permissions.js';
import { validatePasswordStrength } from '../utils/passwordPolicy.js';
import { logAudit } from '../middleware/audit.js';
import { loginRateLimit, clearLoginAttempts } from '../middleware/loginRateLimit.js';
import { logSession } from '../utils/sessionLog.js';
import { loadUserEmployeeProfile, profileToAuthFields } from '../utils/userEmployee.js';
import { dbErrorMessage, isDbConnectionError } from '../utils/dbErrors.js';
import { validateBody, readTrimmedString } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

const validateLoginBody = validateBody((body) => {
  const username = readTrimmedString(body, 'username', { required: true, min: 2, max: 80, label: 'Nom d’utilisateur' });
  if (username.error) return { error: username.error };
  const password = readTrimmedString(body, 'password', { required: true, min: 1, max: 200, label: 'Mot de passe' });
  if (password.error) return { error: password.error };
  return { value: { username: username.value, password: password.value } };
});

const validateChangePasswordBody = validateBody((body) => {
  const currentPassword = readTrimmedString(body, 'current_password', { required: false, max: 200, label: 'Mot de passe actuel' });
  if (currentPassword.error) return { error: currentPassword.error };
  const newPassword = readTrimmedString(body, 'new_password', { required: true, min: 8, max: 200, label: 'Nouveau mot de passe' });
  if (newPassword.error) return { error: newPassword.error };
  return {
    value: {
      current_password: currentPassword.value,
      new_password: newPassword.value,
    },
  };
});

router.post('/login', loginRateLimit, validateLoginBody, asyncHandler(async (req, res) => {
  try {
    const { username, password } = req.body;
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND is_active = TRUE',
      [username]
    );
    if (!rows.length) {
      await logAudit(null, 'login_failed', 'auth', null, { username: username || '', reason: 'unknown_user' });
      return res.status(401).json({ message: 'Identifiants incorrects' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await logAudit(user.id, 'login_failed', 'auth', user.id, { username, reason: 'bad_password' });
      return res.status(401).json({ message: 'Identifiants incorrects' });
    }
    clearLoginAttempts(req);
    await logSession(user.id, user.username, 'login', req);

    const roles = await getUserRoles(user.id);
    const primaryRole = pickPrimaryRole(roles);
    const permissions = await getMergedPermissions(roles);

    const profile = await loadUserEmployeeProfile(user.id, user.employee_id, roles);
    const authFields = profileToAuthFields(profile);

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: primaryRole,
        roles,
        full_name: user.full_name,
        ...authFields,
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: primaryRole,
        roles,
        permissions,
        ...authFields,
        must_change_password: Boolean(user.must_change_password),
      },
    });
  } catch (err) {
    if (isDbConnectionError(err)) {
      return res.status(503).json({ message: dbErrorMessage(err), db: 'down' });
    }
    res.status(500).json({ message: err.message });
  }
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const roles = await getUserRoles(req.user.id);
  const { rows } = await pool.query(
    'SELECT must_change_password FROM users WHERE id = $1',
    [req.user.id]
  );
  const profile = await loadUserEmployeeProfile(req.user.id, req.user.employee_id, roles);
  const primaryRole = pickPrimaryRole(roles);
  const permissions = await getMergedPermissions(roles);
  res.json({
    id: req.user.id,
    username: req.user.username,
    full_name: req.user.full_name,
    role: primaryRole,
    roles,
    permissions,
    ...profileToAuthFields(profile),
    must_change_password: Boolean(rows[0]?.must_change_password),
  });
}));

router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  await logSession(req.user.id, req.user.username, 'logout', req);
  res.json({ message: 'Déconnexion enregistrée' });
}));

router.post('/change-password', authenticate, validateChangePasswordBody, asyncHandler(async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    const policyErr = validatePasswordStrength(new_password);
    if (policyErr) return res.status(400).json({ message: policyErr });

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ message: 'Utilisateur introuvable' });

    const user = rows[0];
    if (!user.must_change_password) {
      if (!current_password) {
        return res.status(400).json({ message: 'Mot de passe actuel requis' });
      }
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) return res.status(400).json({ message: 'Mot de passe actuel incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2',
      [hash, req.user.id]
    );
    await logAudit(req.user.id, 'update', 'user', req.user.id, { change: 'password_changed' });
    res.json({ message: 'Mot de passe mis à jour' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
}));

export default router;
