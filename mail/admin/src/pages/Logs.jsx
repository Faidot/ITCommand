import { useCallback, useEffect, useRef, useState } from 'react';
import adminClient, { extractError } from '../api/adminClient.js';

const LEVELS = ['ALL', 'ERROR', 'WARN', 'INFO'];
const LIMIT = 500;
const AUTO_REFRESH_INTERVAL = 5000; // 5s

// Pick a text color class for a log line based on its level token.
function lineColor(line) {
  if (/\[ERROR\]/.test(line)) return 'text-red-400';
  if (/\[WARN\]/.test(line)) return 'text-yellow-400';
  if (/\[INFO\]/.test(line)) return 'text-sky-300';
  return 'text-slate-300';
}

export default function Logs() {
  const [level, setLevel] = useState('ALL');
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);

  const timerRef = useRef(null);
  const scrollRef = useRef(null);

  const fetchLogs = useCallback(
    async (lvl, { silent } = {}) => {
      if (!silent) setLoading(true);
      try {
        const params = { limit: LIMIT };
        // Backend expects ERROR/WARN/INFO; omit param for ALL.
        if (lvl && lvl !== 'ALL') params.level = lvl;
        const { data } = await adminClient.get('/api/admin/logs', { params });
        setLines(Array.isArray(data.lines) ? data.lines : []);
        setError('');
      } catch (err) {
        setError(extractError(err, 'Failed to load logs.'));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    []
  );

  // Refetch whenever the level changes.
  useEffect(() => {
    fetchLogs(level);
  }, [level, fetchLogs]);

  // Auto-refresh: poll every 5s while enabled. Cleanup on unmount / toggle off.
  useEffect(() => {
    if (!autoRefresh) return undefined;
    timerRef.current = setInterval(() => {
      fetchLogs(level, { silent: true });
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, [autoRefresh, level, fetchLogs]);

  // Keep the viewport pinned to the bottom on new lines (tail behavior).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white">Logs</h2>

        <div className="flex flex-wrap items-center gap-3">
          {/* Level filter buttons */}
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
            {LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setLevel(lvl)}
                className={`px-3 py-1.5 text-xs font-semibold transition ${
                  level === lvl
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                {lvl === 'ALL' ? 'All' : lvl}
              </button>
            ))}
          </div>

          {/* Auto-refresh toggle */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh (5s)
          </label>

          <button
            type="button"
            className="btn-secondary"
            onClick={() => fetchLogs(level)}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Log viewer */}
      <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2 text-xs text-slate-400">
          <span>
            Showing last {LIMIT} lines
            {level !== 'ALL' ? ` · ${level}` : ''}
          </span>
          <span>{lines.length} entries</span>
        </div>

        <div
          ref={scrollRef}
          className="h-[60vh] overflow-y-auto p-4 font-mono text-xs leading-relaxed"
        >
          {loading ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              <span className="h-6 w-6 animate-spin rounded-full border-4 border-slate-600 border-t-brand-500" />
            </div>
          ) : lines.length === 0 ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              No log entries.
            </div>
          ) : (
            lines.map((line, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap break-all ${lineColor(line)}`}
              >
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
