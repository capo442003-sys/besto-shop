import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccessReglement } from '../utils/sellerScope';

export default function ModuleGuard({ module, action = 'view', requireAfterSalePayment = false, children }) {
  const { user, loading, can } = useAuth();
  if (loading) return <div className="page">Chargement...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (requireAfterSalePayment && !canAccessReglement(user)) {
    return (
      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>Accès refusé</h3>
        <p style={{ color: 'var(--text-muted)' }}>
          Les vendeurs peuvent encaisser uniquement lors de la validation d&apos;une vente en caisse.
        </p>
      </div>
    );
  }
  if (!can(module, action)) {
    return (
      <div className="card" style={{ marginTop: '1rem' }}>
        <h3>Accès refusé</h3>
        <p style={{ color: 'var(--text-muted)' }}>Vous n&apos;avez pas les droits pour accéder à cette section.</p>
      </div>
    );
  }
  return children;
}
