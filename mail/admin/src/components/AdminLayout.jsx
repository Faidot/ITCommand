import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../context/AdminAuthContext.jsx';

// Sidebar navigation definition.
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true, icon: '📊' },
  { to: '/imap', label: 'IMAP', icon: '📥' },
  { to: '/smtp', label: 'SMTP', icon: '📤' },
  { to: '/domain', label: 'Domain & Branding', icon: '🌐' },
  { to: '/security', label: 'Security', icon: '🔒' },
  { to: '/sessions', label: 'User Sessions', icon: '👥' },
  { to: '/logs', label: 'Logs', icon: '📜' },
];

/**
 * Application shell: fixed sidebar with nav links, topbar with the logged-in
 * admin username + logout, and an <Outlet/> for the active page.
 */
export default function AdminLayout() {
  const { user, logout } = useAdminAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 dark:bg-slate-900">
      {/* Backdrop for mobile sidebar */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform bg-slate-900 transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-slate-700 px-5">
          <span className="text-xl">📬</span>
          <span className="text-lg font-bold text-white">TeraMailer</span>
          <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Admin
          </span>
        </div>
        <nav className="space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `nav-link ${isActive ? 'nav-link-active' : ''}`
              }
            >
              <span aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:px-6">
          <div className="flex items-center gap-3">
            {/* Mobile menu toggle */}
            <button
              type="button"
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 lg:hidden"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Toggle navigation"
            >
              ☰
            </button>
            <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              TeraMailer Admin
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-slate-600 dark:text-slate-300 sm:inline">
              Signed in as{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {user?.username || 'admin'}
              </span>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="btn-secondary"
            >
              {loggingOut ? 'Logging out…' : 'Logout'}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
