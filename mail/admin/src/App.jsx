import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminAuthProvider, useAdminAuth } from './context/AdminAuthContext.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import AdminLogin from './pages/AdminLogin.jsx';
import Dashboard from './pages/Dashboard.jsx';
import IMAPConfig from './pages/IMAPConfig.jsx';
import SMTPConfig from './pages/SMTPConfig.jsx';
import DomainConfig from './pages/DomainConfig.jsx';
import SecurityConfig from './pages/SecurityConfig.jsx';
import UserSessions from './pages/UserSessions.jsx';
import Logs from './pages/Logs.jsx';

/**
 * Guards admin routes. While the session is being restored we show a spinner;
 * unauthenticated users are redirected to the login page.
 */
function AdminProtectedRoute({ children }) {
  const { user, loading } = useAdminAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <span className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-brand-600" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default function App() {
  return (
    <AdminAuthProvider>
      {/* App is served under /admin in production. */}
      <BrowserRouter basename="/admin">
        <Routes>
          {/* Public route */}
          <Route path="/login" element={<AdminLogin />} />

          {/* Protected routes share the AdminLayout shell */}
          <Route
            element={
              <AdminProtectedRoute>
                <AdminLayout />
              </AdminProtectedRoute>
            }
          >
            <Route path="/" element={<Dashboard />} />
            <Route path="/imap" element={<IMAPConfig />} />
            <Route path="/smtp" element={<SMTPConfig />} />
            <Route path="/domain" element={<DomainConfig />} />
            <Route path="/security" element={<SecurityConfig />} />
            <Route path="/sessions" element={<UserSessions />} />
            <Route path="/logs" element={<Logs />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AdminAuthProvider>
  );
}
