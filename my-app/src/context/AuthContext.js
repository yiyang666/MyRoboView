import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, apiUrl, clearStoredToken, getStoredToken, setStoredToken } from '../utils/apiClient';
import { getPostLoginPath } from '../hooks/useOperatorShell';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    clearStoredToken();
    setUser(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const refreshMe = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setReady(true);
      return;
    }
    try {
      const res = await apiFetch('/api/v1/auth/me', { method: 'GET' });
      if (!res.ok) {
        setUser(null);
        setReady(true);
        return;
      }
      const data = await res.json();
      if (data.success !== false && data.username) {
        setUser({ username: data.username, role: data.role || 'user' });
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      navigate('/login', { replace: true });
    };
    window.addEventListener('roboview:auth-expired', onExpired);
    return () => window.removeEventListener('roboview:auth-expired', onExpired);
  }, [navigate]);

  const login = useCallback(
    async (username, password) => {
      const res = await fetch(apiUrl('/api/v1/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || '登录失败');
      }
      if (!data.token) {
        throw new Error('服务器未返回令牌');
      }
      setStoredToken(data.token);
      const u = data.user || {};
      setUser({
        username: u.username || username,
        role: u.role || 'user',
      });
      navigate(getPostLoginPath(), { replace: true });
    },
    [navigate]
  );

  const value = useMemo(
    () => ({
      user,
      ready,
      login,
      logout,
      refreshMe,
      isAdmin: user?.role === 'admin',
      isDeveloper: user?.role === 'developer' || user?.role === 'admin',
    }),
    [user, ready, login, logout, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
