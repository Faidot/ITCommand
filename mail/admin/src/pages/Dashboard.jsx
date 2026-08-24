import { useCallback, useEffect, useRef, useState } from 'react';
import adminClient, { extractError } from '../api/adminClient.js';
import StatusBadge from '../components/StatusBadge.jsx';

// Format an uptime duration (seconds) as "Nd Nh Nm".
function formatUptime(seconds) {
  if (typeof seconds !== 'number' || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

// Small stat card.
function StatCard({ title, children }) {
  return (
    <div className="card">
      <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
        {title}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

const POLL_INTERVAL = 10000; // 10s

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true); // only true on first load
  const [error, setError] = useState('');
  const timerRef = useRef(null);

  const fetchDashboard = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res = await adminClient.get('/api/admin/dashboard');
      setData(res.data);
      setError('');
    } catch (err) {
      setError(extractError(err, 'Failed to load dashboard.'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load + polling every 10s. Cleanup on unmount.
  useEffect(() => {
    fetchDashboard();
    timerRef.current = setInterval(() => fetchDashboard({ silent: true }), POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [fetchDashboard]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-500">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">
          Dashboard
        </h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => fetchDashboard()}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Sessions">
          <div className="text-3xl font-bold text-slate-800 dark:text-white">
            {data?.activeSessions ?? '—'}
          </div>
          {typeof data?.imapConnections === 'number' && (
            <div className="mt-1 text-xs text-slate-400">
              {data.imapConnections} IMAP connections
            </div>
          )}
        </StatCard>

        <StatCard title="IMAP Status">
          <StatusBadge
            ok={data?.imapStatus?.ok}
            latencyMs={data?.imapStatus?.latencyMs}
            error={data?.imapStatus?.error}
          />
          {data?.imapStatus?.error && !data?.imapStatus?.ok && (
            <div className="mt-1 truncate text-xs text-red-400" title={data.imapStatus.error}>
              {data.imapStatus.error}
            </div>
          )}
        </StatCard>

        <StatCard title="SMTP Status">
          <StatusBadge
            ok={data?.smtpStatus?.ok}
            latencyMs={data?.smtpStatus?.latencyMs}
            error={data?.smtpStatus?.error}
          />
          {data?.smtpStatus?.error && !data?.smtpStatus?.ok && (
            <div className="mt-1 truncate text-xs text-red-400" title={data.smtpStatus.error}>
              {data.smtpStatus.error}
            </div>
          )}
        </StatCard>

        <StatCard title="Uptime">
          <div className="text-3xl font-bold text-slate-800 dark:text-white">
            {formatUptime(data?.uptimeSeconds)}
          </div>
          {data?.app?.name && (
            <div className="mt-1 text-xs text-slate-400">{data.app.name}</div>
          )}
        </StatCard>
      </div>

      {/* Recent logins */}
      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Recent Logins
        </h3>
        {data?.recentLogins?.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700">
                  <th className="py-2 pr-4 font-medium">#</th>
                  <th className="py-2 font-medium">User / Event</th>
                </tr>
              </thead>
              <tbody>
                {data.recentLogins.map((entry, i) => (
                  <tr
                    key={`${entry}-${i}`}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-700/60"
                  >
                    <td className="py-2 pr-4 text-slate-400">{i + 1}</td>
                    <td className="py-2 text-slate-700 dark:text-slate-200">
                      {entry}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No recent logins.</p>
        )}
      </div>
    </div>
  );
}
