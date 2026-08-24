import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react';
import client, {
  setCsrfToken,
  setUnauthorizedHandler,
  errorMessage,
} from '../api/client.js';

const AuthContext = createContext(null);

// Default app config used before /api/auth/me resolves or as a fallback.
const DEFAULT_APP = {
  name: 'TeraMailer',
  domain: '',
  allowedDomains: [],
  logo: '',
  maxUploadMb: 25,
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [app, setApp] = useState(DEFAULT_APP);
  const [loading, setLoading] = useState(true); // true until /me resolves

  // Clear all client-side auth state. Called on logout and on 401.
  const clearAuth = useCallback(() => {
    setUser(null);
    setCsrfToken(null);
  }, []);

  // Register a global 401 handler so api/client can drop us back to login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearAuth();
    });
    return () => setUnauthorizedHandler(null);
  }, [clearAuth]);

  // On mount, attempt to restore the session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await client.get('/api/auth/me');
        if (cancelled) return;
        setUser(data.user);
        setCsrfToken(data.csrfToken);
        if (data.app) setApp({ ...DEFAULT_APP, ...data.app });
      } catch {
        // Not authenticated (401) or network error — treat as logged out.
        if (!cancelled) clearAuth();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clearAuth]);

  // Log in with email + password. Throws on failure with a readable message.
  const login = useCallback(async (email, password) => {
    try {
      const { data } = await client.post('/api/auth/login', {
        email,
        password,
      });
      setUser(data.user);
      setCsrfToken(data.csrfToken);
      if (data.app) setApp({ ...DEFAULT_APP, ...data.app });
      return data.user;
    } catch (err) {
      throw new Error(errorMessage(err, 'Login failed'));
    }
  }, []);

  // Log out: best-effort server call, then clear local state regardless.
  const logout = useCallback(async () => {
    try {
      await client.post('/api/auth/logout');
    } catch {
      // Ignore — we clear local state either way.
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  const value = {
    user,
    app,
    loading,
    isAuthenticated: !!user,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
