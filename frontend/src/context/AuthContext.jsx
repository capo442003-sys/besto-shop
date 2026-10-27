import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';
import { normalizeRoles } from '../utils/roles';
import { defaultCan } from '../utils/permissionDefaults';
import {
  initAuthStorage,
  getToken,
  setToken,
  getStoredUser,
  setStoredUser,
  clearAuth,
} from '../utils/authStorage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    initAuthStorage();
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api.get('/auth/me')
      .then((res) => {
        const u = res.data;
        setUser(u);
        setStoredUser(u);
      })
      .catch(() => {
        clearAuth();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const { data } = await api.post('/auth/login', { username, password });
    setToken(data.token);
    setStoredUser(data.user);
    setUser(data.user);
    setLoading(false);
    try {
      const me = await api.get('/auth/me');
      setUser(me.data);
      setStoredUser(me.data);
      return me.data;
    } catch {
      return data.user;
    }
  };

  const refreshUser = async () => {
    const { data } = await api.get('/auth/me');
    setUser(data);
    setStoredUser(data);
    return data;
  };

  const logout = () => {
    api.post('/auth/logout').catch(() => {});
    clearAuth();
    setUser(null);
  };

  const userRoles = () => normalizeRoles(user?.roles, user?.role);

  const can = (module, action = 'view') => {
    if (!user) return false;
    const roles = userRoles();
    if (roles.includes('administrateur')) return true;
    const key = { view: 'can_view', create: 'can_create', edit: 'can_edit', delete: 'can_delete', print: 'can_print' }[action];
    const perm = user.permissions?.find((p) => p.module_code === module || p.module_code === 'all');
    if (perm?.[key]) return true;
    return defaultCan(roles, module, action);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, can, userRoles }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
