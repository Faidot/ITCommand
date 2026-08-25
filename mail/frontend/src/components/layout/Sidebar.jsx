import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import Spinner from '../ui/Spinner.jsx';
import Avatar from '../ui/Avatar.jsx';
import client, { errorMessage } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';

// Display labels (Dappr-style) keyed by folder role.
const LABELS = {
  inbox: 'Inbox',
  flagged: 'Important',
  sent: 'Sent',
  drafts: 'Drafts',
  trash: 'Deleted',
  junk: 'Spam',
  archive: 'Archive',
  all: 'All Mail',
};

const SPECIAL_ORDER = ['inbox', 'flagged', 'sent', 'drafts', 'trash', 'junk', 'archive', 'all'];

const ICONS = {
  inbox: <path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H5V5h14v10z" />,
  flagged: <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />,
  sent: <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />,
  drafts: <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />,
  trash: <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />,
  junk: <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" />,
  archive: <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5z" />,
  all: <path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />,
  folder: <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />,
};

function Icon({ role, className = 'h-[18px] w-[18px]' }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-current`}>
      {ICONS[role] || ICONS.folder}
    </svg>
  );
}

function FolderRow({ folder, collapsed, onNavigate }) {
  const label = LABELS[folder.role] || folder.name || folder.path;
  const showBadge = !['sent', 'drafts'].includes(folder.role) && folder.unread > 0;
  return (
    <NavLink
      to={`/folder/${encodeURIComponent(folder.path)}`}
      onClick={onNavigate}
      end
      title={label}
      className={({ isActive }) =>
        `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
          collapsed ? 'sm:justify-center sm:px-0' : ''
        } ${
          isActive
            ? 'bg-white/25 font-semibold text-white'
            : 'text-white/80 hover:bg-white/15 hover:text-white'
        }`
      }
    >
      <span className="relative shrink-0">
        <Icon role={folder.role} />
        {showBadge && (
          <span className={`absolute -right-1.5 -top-1.5 hidden h-2 w-2 rounded-full bg-white ${collapsed ? 'sm:block' : ''}`} />
        )}
      </span>
      <span className={`flex-1 truncate ${collapsed ? 'sm:hidden' : ''}`}>{label}</span>
      {showBadge && (
        <span className={`inline-flex min-w-[22px] items-center justify-center rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-primary ${collapsed ? 'sm:hidden' : ''}`}>
          {folder.unread > 999 ? '999+' : folder.unread}
        </span>
      )}
    </NavLink>
  );
}

/**
 * Unified dark, collapsible sidebar (replaces the old icon rail + light folder
 * column). Static column on desktop (toggles between text + icon-only modes);
 * slide-in drawer on mobile.
 */
export default function Sidebar({
  folders,
  loading,
  error,
  onAddFolder,
  onCompose,
  collapsed,
  onToggleCollapse,
  isOpen,
  onClose,
}) {
  const toast = useToast();
  const { user, app, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onClick = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenuOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const brand = (app?.name || 'TeraMailer').trim();
  const initial = brand.charAt(0).toUpperCase();
  const logo = app?.logo;

  const specialFolders = SPECIAL_ORDER.map((role) => folders.find((f) => f.role === role)).filter(Boolean);
  const customFolders = folders.filter((f) => !f.role || !SPECIAL_ORDER.includes(f.role));

  const handleAddFolder = async () => {
    const name = window.prompt('New folder name');
    if (!name || !name.trim()) return;
    setAdding(true);
    try {
      await client.post('/api/folders', { name: name.trim() });
      toast.success(`Folder "${name.trim()}" created`);
      onAddFolder && onAddFolder();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create folder'));
    } finally {
      setAdding(false);
    }
  };

  const hide = collapsed ? 'sm:hidden' : '';

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && <div className="fixed inset-0 z-30 bg-black/50 sm:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-gradient-to-b from-primary to-primary-dark text-white/85 transition-all duration-200 ease-out sm:static sm:z-auto sm:translate-x-0 ${
          isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        } ${collapsed ? 'sm:w-[76px]' : 'sm:w-64'}`}
      >
        {/* Header: brand logo + collapse toggle (desktop) / close (mobile) */}
        <div className={`flex items-center gap-2 px-4 pb-2 pt-4 ${collapsed ? 'sm:flex-col sm:gap-3 sm:px-2' : ''}`}>
          {logo ? (
            <img
              src={logo}
              alt={brand}
              title={brand}
              className={`object-contain ${collapsed ? 'h-7 w-full' : 'h-9 max-w-[150px] object-left'}`}
            />
          ) : (
            <>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-lg font-extrabold text-ink" title={brand}>
                {initial}
              </div>
              <span className={`flex-1 truncate text-2xl font-bold tracking-tight text-white ${hide}`}>{brand}</span>
            </>
          )}

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden h-8 w-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white sm:ml-auto sm:flex"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label="Toggle sidebar"
          >
            <svg viewBox="0 0 24 24" className={`h-5 w-5 fill-current transition-transform ${collapsed ? 'rotate-180' : ''}`}>
              <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
            </svg>
          </button>

          {/* Mobile close */}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white sm:hidden"
            aria-label="Close menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        </div>

        {/* Compose */}
        <button
          type="button"
          onClick={() => {
            onCompose();
            onClose && onClose();
          }}
          className={`mx-3 mb-2 mt-1 flex items-center gap-3 rounded-xl bg-white/20 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/30 ${
            collapsed ? 'sm:mx-3 sm:justify-center sm:px-0' : ''
          }`}
          title="Compose"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
          <span className={hide}>Compose</span>
        </button>

        {/* Folder nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-2">
          {loading && (
            <div className="flex justify-center py-8">
              <Spinner className="text-white" />
            </div>
          )}
          {error && !loading && <p className={`px-2 py-3 text-sm text-red-100 ${hide}`}>{error}</p>}

          {!loading && !error && (
            <>
              {specialFolders.map((f) => (
                <FolderRow key={f.path} folder={f} collapsed={collapsed} onNavigate={onClose} />
              ))}

              {/* Folders section */}
              <div className={`flex items-center justify-between px-3 pb-1 pt-5 ${hide}`}>
                <span className="text-xs font-semibold uppercase tracking-wide text-white/60">Folders</span>
              </div>

              <button
                type="button"
                onClick={handleAddFolder}
                disabled={adding}
                title="Add folder"
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-50 ${
                  collapsed ? 'sm:justify-center sm:px-0' : ''
                }`}
              >
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border border-current">
                  <svg viewBox="0 0 24 24" className="h-3 w-3 fill-current"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
                </span>
                <span className={hide}>Add Folder</span>
              </button>

              {customFolders.map((f) => (
                <FolderRow key={f.path} folder={f} collapsed={collapsed} onNavigate={onClose} />
              ))}
            </>
          )}
        </nav>

        {/* Footer: theme + account */}
        <div className="mt-auto space-y-1 border-t border-white/10 px-3 py-3">
          <button
            type="button"
            onClick={toggleTheme}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/80 transition-colors hover:bg-white/15 hover:text-white ${
              collapsed ? 'sm:justify-center sm:px-0' : ''
            }`}
            title={isDark ? 'Light mode' : 'Dark mode'}
          >
            {isDark ? (
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-current"><path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-current"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z" /></svg>
            )}
            <span className={hide}>{isDark ? 'Light mode' : 'Dark mode'}</span>
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-white/15 ${
                collapsed ? 'sm:justify-center sm:px-0' : ''
              }`}
              title={user?.email}
            >
              <Avatar email={user?.email} size="sm" />
              <div className={`min-w-0 flex-1 text-left ${hide}`}>
                <p className="truncate text-sm font-medium text-white">{user?.email}</p>
                <p className="truncate text-xs text-white/60">{app?.domain || brand}</p>
              </div>
            </button>

            {menuOpen && (
              <div className="absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-xl border border-black/5 bg-white shadow-2xl dark:border-white/10 dark:bg-dark-elevated">
                <div className="flex items-center gap-3 border-b border-gray-100 p-3 dark:border-dark-border">
                  <Avatar email={user?.email} size="md" />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-100">{user?.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-dark-surface"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" /></svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
