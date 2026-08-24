/**
 * StatusBadge — shows a colored dot + label reflecting connectivity status.
 *
 * Props:
 *  - ok:        boolean | null | undefined  (null/undefined => "unknown")
 *  - latencyMs: number (optional)           shown as "(NN ms)" when ok
 *  - error:     string (optional)           tooltip when not ok
 *  - label:     string (optional)           overrides the auto label
 */
export default function StatusBadge({ ok, latencyMs, error, label }) {
  const unknown = ok === null || ok === undefined;

  // Choose colors + default text based on state.
  const dotColor = unknown
    ? 'bg-slate-400'
    : ok
    ? 'bg-green-500'
    : 'bg-red-500';

  const textColor = unknown
    ? 'text-slate-500'
    : ok
    ? 'text-green-700 dark:text-green-400'
    : 'text-red-700 dark:text-red-400';

  const text = label || (unknown ? 'Unknown' : ok ? 'Online' : 'Down');

  return (
    <span
      className={`inline-flex items-center gap-2 text-sm font-medium ${textColor}`}
      title={!ok && error ? error : undefined}
    >
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotColor}`} />
      <span>{text}</span>
      {ok && typeof latencyMs === 'number' && (
        <span className="text-xs font-normal text-slate-400">
          ({latencyMs} ms)
        </span>
      )}
    </span>
  );
}
