import { useCallback, useEffect, useState } from 'react';
import adminClient, { extractError } from '../api/adminClient.js';

// Format epoch ms into a readable local datetime.
function formatTime(ms) {
  if (typeof ms !== 'number' || !ms) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

// Compact relative "time ago" helper for last activity.
function timeAgo(ms) {
  if (typeof ms !== 'number' || !ms) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return '';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function UserSessions() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actioningId, setActioningId] = useState(null); // id being force-logged-out
  const [actionError, setActionError] = useState('');

  const fetchSessions = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await adminClient.get('/api/admin/sessions');
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setError('');
    } catch (err) {
      setError(extractError(err, 'Failed to load sessions.'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Force logout a session, then refetch the list.
  const handleForceLogout = async (id) => {
    setActionError('');
    setActioningId(id);
    try {
      await adminClient.delete(`/api/admin/sessions/${encodeURIComponent(id)}`);
      await fetchSessions({ silent: true });
    } catch (err) {
      setActionError(extractError(err, 'Failed to force logout.'));
    } finally {
      setActioningId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">
          User Sessions
        </h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => fetchSessions()}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}
      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {actionError}
        </div>
      )}

      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-slate-500">
            <span className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-brand-600" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            No active sessions.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-700/40">
                <tr>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">IP</th>
                  <th className="px-4 py-3 font-medium">Login Time</th>
                  <th className="px-4 py-3 font-medium">Last Activity</th>
                  <th className="px-4 py-3 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    className="border-t border-slate-100 dark:border-slate-700/60"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800 dark:text-slate-100">
                        {s.email || '—'}
                      </div>
                      {s.userAgent && (
                        <div
                          className="max-w-xs truncate text-xs text-slate-400"
                          title={s.userAgent}
                        >
                          {s.userAgent}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {s.ip || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {formatTime(s.loginTime)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      <div>{formatTime(s.lastActivity)}</div>
                      <div className="text-xs text-slate-400">
                        {timeAgo(s.lastActivity)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="btn-danger px-3 py-1.5 text-xs"
                        onClick={() => handleForceLogout(s.id)}
                        disabled={actioningId === s.id}
                      >
                        {actioningId === s.id ? 'Working…' : 'Force Logout'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
