import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from 'react';
import adminClient, {
  setCsrfToken,
  extractError,
} from '../api/adminClient.js';

const AdminAuthContext = createContext(null);

/**
 * Provides the authenticated admin user plus login/logout actions.
 * On mount it probes GET /api/admin/me to restore an existing session and to
 * obtain a fresh CSRF token.
 */
export function AdminAuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); // true until first /me resolves

  // Restore session on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await adminClient.get('/api/admin/me');
        if (cancelled) return;
        setUser(data.user || null);
        setCsrfToken(data.csrfToken);
      } catch {
        // 401 (or network error) => treated as logged out.
        if (!cancelled) {
          setUser(null);
          setCsrfToken(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Log in with username/password. Returns nothing on success, throws on error.
  const login = useCallback(async (username, password) => {
    try {
      const { data } = await adminClient.post('/api/admin/login', {
        username,
        password,
      });
      setUser(data.user || null);
      setCsrfToken(data.csrfToken);
      return data.user;
    } catch (error) {
      // Surface a clean message for the login page to display.
      throw new Error(extractError(error, 'Invalid credentials.'));
    }
  }, []);

  // Log out. Always clears local state even if the network call fails.
  const logout = useCallback(async () => {
    try {
      await adminClient.post('/api/admin/logout');
    } catch {
      // Ignore: we clear local state regardless.
    } finally {
      setUser(null);
      setCsrfToken(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout]
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
    </AdminAuthContext.Provider>
  );
}

// Hook for consuming the auth context.
export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error('useAdminAuth must be used within an AdminAuthProvider');
  }
  return ctx;
}
