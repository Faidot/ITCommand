import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { FullPageSpinner } from './components/ui/Spinner.jsx';
import Layout from './components/layout/Layout.jsx';
import Login from './pages/Login.jsx';
import Inbox from './pages/Inbox.jsx';
import NotFound from './pages/NotFound.jsx';

// Guards routes that require an authenticated session.
// While the initial /api/auth/me probe is in flight we show a full-page spinner.
function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner label="Loading your mailbox…" />;

  if (!isAuthenticated) {
    // Remember where the user was headed so we can return after login.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

// Redirects authenticated users away from the login page.
function PublicOnlyRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <Login />
          </PublicOnlyRoute>
        }
      />

      {/* Authenticated app shell. The optional :folderPath param selects the
          IMAP folder (URL-encoded). When absent we default to INBOX. */}
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Inbox />} />
        <Route path="/folder/:folderPath" element={<Inbox />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
