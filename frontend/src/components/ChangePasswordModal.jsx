import { useState } from 'react';
import api from '../api/client';

export default function ChangePasswordModal({ user, mustChange, onSuccess }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError('Les deux mots de passe ne correspondent pas');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/change-password', {
        current_password: mustChange ? undefined : currentPassword,
        new_password: newPassword,
      });
      onSuccess();
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de changer le mot de passe');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="confirm-overlay" role="presentation">
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pwd-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="pwd-title" className="confirm-dialog__title">
          {mustChange ? 'Changement de mot de passe obligatoire' : 'Changer le mot de passe'}
        </h3>
        <p className="confirm-dialog__message">
          {mustChange
            ? `Bonjour ${user?.full_name || user?.username}, pour sécuriser BESTO SHOP vous devez définir un nouveau mot de passe (8 caractères minimum, lettres et chiffres).`
            : 'Saisissez votre mot de passe actuel et le nouveau.'}
        </p>
        <form onSubmit={submit}>
          {!mustChange && (
            <div className="form-group" style={{ marginBottom: '.75rem' }}>
              <label>Mot de passe actuel</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          )}
          <div className="form-group" style={{ marginBottom: '.75rem' }}>
            <label>Nouveau mot de passe</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="form-group" style={{ marginBottom: '.75rem' }}>
            <label>Confirmer</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p className="alert alert-error" style={{ marginBottom: '.75rem' }}>{error}</p>}
          <div className="confirm-dialog__actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Enregistrement…' : 'Enregistrer le mot de passe'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
