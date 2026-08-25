import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import ComposeModal from '../mail/ComposeModal.jsx';
import useFolders from '../../hooks/useFolders.js';
import useCompose from '../../hooks/useCompose.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { API_URL } from '../../api/client.js';

const COLLAPSE_KEY = 'teramailer:sidebar-collapsed';

// Context exposing shell-level state (folders + compose) to nested pages.
const LayoutContext = createContext(null);
export function useLayout() {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within Layout');
  return ctx;
}

export default function Layout() {
  const { user, app } = useAuth();
  const toast = useToast();
  const folders = useFolders();
  const compose = useCompose(user?.email);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  // Subscribers (Inbox) register a callback invoked on mailbox change.
  const mailListeners = useRef(new Set());
  const onNewMail = useCallback((fn) => {
    mailListeners.current.add(fn);
    return () => mailListeners.current.delete(fn);
  }, []);
  const notifyListeners = useCallback((payload) => {
    mailListeners.current.forEach((fn) => {
      try {
        fn(payload);
      } catch {
        /* ignore listener errors */
      }
    });
  }, []);

  // Server-Sent Events: live mailbox updates.
  useEffect(() => {
    if (!user) return;
    let es;
    try {
      es = new EventSource(`${API_URL}/api/messages/events`, { withCredentials: true });
    } catch {
      return;
    }
    const handleMail = (event) => {
      let payload = {};
      try {
        payload = JSON.parse(event.data);
      } catch {
        payload = {};
      }
      if (payload.type === 'new') {
        toast.info(payload.count > 1 ? `${payload.count} new messages` : 'New mail');
      }
      folders.refetch();
      notifyListeners(payload);
    };
    es.addEventListener('mail', handleMail);
    return () => {
      es.removeEventListener('mail', handleMail);
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const layoutValue = { folders, compose, onNewMail, app, openSidebar: () => setMobileOpen(true) };

  return (
    <LayoutContext.Provider value={layoutValue}>
      <div className="flex h-screen w-full overflow-hidden bg-white dark:bg-dark-canvas">
        <Sidebar
          folders={folders.folders}
          loading={folders.loading}
          error={folders.error}
          onAddFolder={folders.refetch}
          onCompose={() => compose.openNew()}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          isOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Mobile top bar */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-black/5 bg-white px-3 dark:border-white/5 dark:bg-dark-surface sm:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-black/5 dark:text-gray-300"
              aria-label="Open menu"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" /></svg>
            </button>
            <span className="font-semibold text-gray-800 dark:text-gray-100">{app?.name || 'TeraMailer'}</span>
          </div>

          <main className="min-h-0 flex-1 overflow-hidden bg-white dark:bg-dark-surface">
            <Outlet />
          </main>
        </div>

        {/* Floating compose (mobile) */}
        {!compose.isOpen && (
          <button
            type="button"
            onClick={() => compose.openNew()}
            aria-label="Compose"
            className="no-print fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-white shadow-compose transition-transform hover:scale-105 sm:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" /></svg>
          </button>
        )}

        <ComposeModal
          compose={compose}
          maxUploadMb={app?.maxUploadMb || 25}
          onSent={() => {
            folders.refetch();
            notifyListeners({ type: 'sent' });
          }}
        />
      </div>
    </LayoutContext.Provider>
  );
}
