import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { canAccessReglement } from '../../utils/sellerScope';

export default function CaisseHub() {
  const { can, user } = useAuth();
  const showReglement = canAccessReglement(user);

  return (
    <div className="bmb-hub">
      <header className="bmb-hub__header">
        <h1>Module Caisse</h1>
        <p>Choisissez une action pour démarrer</p>
      </header>
      <div className="bmb-hub__cards">
        {can('ventes', 'create') && (
          <Link to="/caisse/vendre" className="bmb-hub-card">
            <h2>Vendre</h2>
            <p>Créer une vente, ajouter des produits au panier et facturer le client.</p>
          </Link>
        )}
        {showReglement && (
          <Link to="/caisse/encaisser" className="bmb-hub-card">
            <h2>Encaisser</h2>
            <p>Encaisser un montant, enregistrer un paiement et imprimer le reçu.</p>
          </Link>
        )}
      </div>
    </div>
  );
}
