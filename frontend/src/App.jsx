import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import ModuleGuard from './components/ModuleGuard';
import Login from './pages/Login';
import HomePage from './pages/HomePage';
import VentesModule from './pages/ventes/VentesModule';
import Vendre from './pages/ventes/Vendre';
import InventaireVentes from './pages/ventes/InventaireVentes';
import Clients from './pages/ventes/Clients';
import FacturesProforma from './pages/ventes/FacturesProforma';
import RecusEncaissement from './pages/ventes/RecusEncaissement';
import Reglement from './pages/ventes/Reglement';
import BonsCommande from './pages/ventes/BonsCommande';
import ProduitsModule from './pages/produits/ProduitsModule';
import Stocks from './pages/produits/Stocks';
import ListeProduits from './pages/produits/ListeProduits';
import Fournisseurs from './pages/produits/Fournisseurs';
import InventairePhysique from './pages/produits/InventairePhysique';
import EmployesModule from './pages/employes/EmployesModule';
import ListeEmployes from './pages/employes/ListeEmployes';
import Salaires from './pages/employes/Salaires';
import Plannings from './pages/employes/Plannings';
import StatsVentes from './pages/employes/StatsVentes';
import FinancesModule from './pages/finances/FinancesModule';
import Caisse from './pages/finances/Caisse';
import Historique from './pages/finances/Historique';
import Charges from './pages/finances/Charges';
import Bilan from './pages/finances/Bilan';
import ParametresModule from './pages/parametres/ParametresModule';
import Magasin from './pages/parametres/Magasin';
import Utilisateurs from './pages/parametres/Utilisateurs';
import PointsVente from './pages/parametres/PointsVente';
import JournalAudit from './pages/parametres/JournalAudit';
import ImportDonnees from './pages/parametres/ImportDonnees';
import EtatSysteme from './pages/parametres/EtatSysteme';
import SanteDonnees from './pages/parametres/SanteDonnees';
import PermissionsMatrix from './pages/parametres/PermissionsMatrix';
import SessionsConnexions from './pages/parametres/SessionsConnexions';

import AppLoading from './components/AppLoading';
import ChangePasswordModal from './components/ChangePasswordModal';

function PrivateRoute({ children }) {
  const { user, loading, refreshUser } = useAuth();
  if (loading) return <AppLoading message="Initialisation de votre espace…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) {
    return (
      <ChangePasswordModal
        user={user}
        mustChange
        onSuccess={() => refreshUser()}
      />
    );
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<ModuleGuard module="dashboard"><HomePage /></ModuleGuard>} />

        <Route path="ventes" element={<ModuleGuard module="ventes"><VentesModule /></ModuleGuard>}>
          <Route index element={<Navigate to="vendre" replace />} />
          <Route path="vendre" element={<ModuleGuard module="ventes" action="create"><Vendre /></ModuleGuard>} />
          <Route path="reglement" element={<ModuleGuard module="ventes" action="view" requireAfterSalePayment><Reglement /></ModuleGuard>} />
          <Route path="inventaire" element={<InventaireVentes />} />
          <Route path="clients" element={<Clients />} />
          <Route path="factures" element={<FacturesProforma />} />
          <Route path="recus" element={<ModuleGuard module="ventes" action="view" requireAfterSalePayment><RecusEncaissement /></ModuleGuard>} />
          <Route path="bons-commande" element={<BonsCommande />} />
        </Route>

        <Route path="produits" element={<ModuleGuard module="produits"><ProduitsModule /></ModuleGuard>}>
          <Route index element={<Navigate to="stocks" replace />} />
          <Route path="stocks" element={<Stocks />} />
          <Route path="liste" element={<ListeProduits />} />
          <Route path="inventaire" element={<InventairePhysique />} />
          <Route path="fournisseurs" element={<Fournisseurs />} />
        </Route>

        <Route path="employes" element={<ModuleGuard module="employes"><EmployesModule /></ModuleGuard>}>
          <Route index element={<Navigate to="liste" replace />} />
          <Route path="liste" element={<ListeEmployes />} />
          <Route path="salaires" element={<Salaires />} />
          <Route path="plannings" element={<Plannings />} />
          <Route path="stats" element={<StatsVentes />} />
        </Route>

        <Route path="finances" element={<ModuleGuard module="finances"><FinancesModule /></ModuleGuard>}>
          <Route index element={<Navigate to="caisse" replace />} />
          <Route path="caisse" element={<Caisse />} />
          <Route path="historique" element={<Historique />} />
          <Route path="charges" element={<Charges />} />
          <Route path="bilan" element={<Bilan />} />
        </Route>

        <Route path="parametres" element={<ModuleGuard module="parametres"><ParametresModule /></ModuleGuard>}>
          <Route index element={<Navigate to="magasin" replace />} />
          <Route path="magasin" element={<Magasin />} />
          <Route path="utilisateurs" element={<Utilisateurs />} />
          <Route path="points-vente" element={<PointsVente />} />
          <Route path="audit" element={<JournalAudit />} />
          <Route path="sante-donnees" element={<SanteDonnees />} />
          <Route path="import" element={<ImportDonnees />} />
          <Route path="systeme" element={<EtatSysteme />} />
          <Route path="permissions" element={<PermissionsMatrix />} />
          <Route path="sessions" element={<SessionsConnexions />} />
        </Route>

        {/* Anciennes routes v2 → redirections */}
        <Route path="caisse" element={<Navigate to="/ventes/vendre" replace />} />
        <Route path="caisse/vendre" element={<Navigate to="/ventes/vendre" replace />} />
        <Route path="caisse/encaisser" element={<Navigate to="/ventes/reglement" replace />} />
        <Route path="stock" element={<Navigate to="/produits/stocks" replace />} />
        <Route path="stock/*" element={<Navigate to="/produits/stocks" replace />} />
        <Route path="clients" element={<Navigate to="/ventes/clients" replace />} />
        <Route path="clients/*" element={<Navigate to="/ventes/clients" replace />} />
        <Route path="admin" element={<Navigate to="/parametres/magasin" replace />} />
        <Route path="admin/*" element={<Navigate to="/parametres/magasin" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
