import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getPrimaryHomeRole } from '../utils/homeRole';
import { getRoleHomeConfig } from './home/roleHomeConfigs';
import Dashboard from './Dashboard';
import RoleHome from './home/RoleHome';

/** Accueil adapté au rôle — structure BMB d’origine */
export default function HomePage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const role = getPrimaryHomeRole(user);
  const config = getRoleHomeConfig(role);

  if (searchParams.get('view') === 'role') {
    return <RoleHome role={role} />;
  }

  if (role === 'gestionnaire' && searchParams.get('view') !== 'analytics') {
    return <Dashboard gestionnaireMode />;
  }

  if (role === 'administrateur' && searchParams.get('view') !== 'role') {
    return <Dashboard adminMode fromRoleHome={searchParams.get('view') === 'analytics'} />;
  }

  if (searchParams.get('view') === 'analytics' || (config.analytics && searchParams.get('view') !== 'role')) {
    return <Dashboard fromRoleHome={searchParams.get('view') === 'analytics'} />;
  }

  return <RoleHome role={role} />;
}
