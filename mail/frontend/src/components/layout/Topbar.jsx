import { useState, useRef, useEffect } from 'react';
import SearchBar from '../mail/SearchBar.jsx';
import Avatar from '../ui/Avatar.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

// Top application bar: hamburger (mobile), logo/app name, search, dark toggle,
// user avatar + account menu with logout.
export default function Topbar({ onToggleSidebar }) {
  const { isDark, toggleTheme } = useTheme();
  const { user, app, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close the account menu on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  return (
    <header className="no-print z-20 flex h-16 shrink-0 items-center gap-2 border-b border-gray-200 bg-sidebar px-2 sm:gap-4 sm:px-4 dark:border-dark-border dark:bg-dark-surface">
      {/* Hamburger (mobile) */}
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle menu"
        className="icon-btn"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
          <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
        </svg>
      </button>

      {/* Logo + app name */}
      <div className="flex shrink-0 items-center gap-2">
        {app?.logo ? (
          <img
            src={app.logo}
            alt={app.name}
            className="h-8 w-8 rounded object-contain"
          />
        ) : (
          <svg viewBox="0 0 24 24" className="h-8 w-8 fill-primary">
            <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
          </svg>
        )}
        <span className="hidden text-xl font-medium text-gray-700 sm:inline dark:text-gray-200">
          {app?.name || 'TeraMailer'}
        </span>
      </div>

      {/* Search */}
      <div className="mx-auto w-full max-w-2xl">
        <SearchBar />
      </div>

      {/* Right-side actions */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Dark mode toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Light mode' : 'Dark mode'}
          className="icon-btn"
        >
          {isDark ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
              <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37a.996.996 0 0 0-1.41 0 .996.996 0 0 0 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0a.996.996 0 0 0 0-1.41l-1.06-1.06zm1.06-10.96a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36a.996.996 0 0 0 0-1.41.996.996 0 0 0-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
              <path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" />
            </svg>
          )}
        </button>

        {/* Account menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="rounded-full focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <Avatar email={user?.email} size="sm" />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-dark-border dark:bg-dark-elevated"
            >
              <div className="flex items-center gap-3 border-b border-gray-100 p-4 dark:border-dark-border">
                <Avatar email={user?.email} size="lg" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                    {user?.email}
                  </p>
                  <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                    {app?.domain || app?.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  logout();
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-dark-surface"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
                </svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
