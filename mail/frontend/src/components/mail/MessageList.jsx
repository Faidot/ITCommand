import Spinner from '../ui/Spinner.jsx';
import { PAGE_SIZE } from '../../hooks/useMessages.js';

// Relative-ish date formatting.
function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays < 7 && diffDays >= 0) return d.toLocaleDateString([], { weekday: 'short' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

function senderOf(envelope, isSentLike) {
  const list = isSentLike ? envelope?.to || envelope?.from : envelope?.from;
  const first = (list && list[0]) || {};
  return { name: first.name || first.address || '(unknown)', address: first.address || '' };
}

function StarButton({ flagged, onToggle }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={flagged ? 'Unstar' : 'Star'}
      className={`shrink-0 transition-colors ${
        flagged ? 'text-accent' : 'text-gray-300 hover:text-gray-400 dark:text-gray-600'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
        {flagged ? (
          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        ) : (
          <path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z" />
        )}
      </svg>
    </button>
  );
}

function BulkToolbar({ count, onClear, onDelete, onMarkRead, onMarkUnread }) {
  return (
    <div className="flex items-center gap-1 border-b border-black/5 px-3 py-2 dark:border-white/5">
      <button type="button" onClick={onClear} className="icon-btn h-8 w-8" title="Clear selection">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
      </button>
      <span className="mr-1 text-sm font-medium text-gray-600 dark:text-gray-300">{count} selected</span>
      <button type="button" onClick={onDelete} className="icon-btn h-8 w-8" title="Delete">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
      </button>
      <button type="button" onClick={onMarkRead} className="icon-btn h-8 w-8" title="Mark as read">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /></svg>
      </button>
      <button type="button" onClick={onMarkUnread} className="icon-btn h-8 w-8" title="Mark as unread">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" /></svg>
      </button>
    </div>
  );
}

export default function MessageList({
  messages,
  loading,
  error,
  page,
  total,
  totalPages,
  selectedUid,
  selectedIds,
  isSentLike = false,
  onOpen,
  onToggleStar,
  onToggleSelect,
  onClearSelection,
  onBulkDelete,
  onBulkMarkRead,
  onBulkMarkUnread,
  onContextMenu,
  onPageChange,
  onRefresh,
}) {
  const hasSelection = selectedIds && selectedIds.size > 0;
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex h-full flex-col">
      {hasSelection && (
        <BulkToolbar
          count={selectedIds.size}
          onClear={onClearSelection}
          onDelete={onBulkDelete}
          onMarkRead={onBulkMarkRead}
          onMarkUnread={onBulkMarkUnread}
        />
      )}

      {/* List body */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex h-40 items-center justify-center">
            <Spinner size="lg" />
          </div>
        )}

        {error && !loading && (
          <div className="flex h-40 flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-sm text-unread">{error}</p>
            <button onClick={onRefresh} className="btn-secondary">Try again</button>
          </div>
        )}

        {!loading && !error && messages.length === 0 && (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-gray-400">
            <svg viewBox="0 0 24 24" className="h-10 w-10 fill-current"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" /></svg>
            <p className="text-sm">No messages here</p>
          </div>
        )}

        {!loading &&
          !error &&
          messages.map((msg) => {
            const seen = msg.flags?.seen;
            const flagged = msg.flags?.flagged;
            const { name } = senderOf(msg.envelope, isSentLike);
            const isActive = msg.uid === selectedUid;
            const isChecked = selectedIds?.has(msg.uid);

            return (
              <div
                key={msg.uid}
                onClick={() => onOpen(msg)}
                onContextMenu={(e) => onContextMenu && onContextMenu(e, msg)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(msg)}
                className={`group relative flex cursor-pointer gap-3 border-b border-black/[0.04] px-4 py-3 transition-colors dark:border-white/[0.04] ${
                  isActive
                    ? "bg-primary-light/70 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary before:content-[''] dark:bg-primary/10"
                    : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                }`}
              >
                {/* Left gutter: unread dot, swapped for a checkbox on hover/select */}
                <div className="relative flex w-4 shrink-0 justify-center pt-1.5">
                  <span
                    className={`h-2.5 w-2.5 rounded-full bg-accent ${seen ? 'invisible' : ''} ${
                      isChecked ? 'hidden' : 'group-hover:hidden'
                    }`}
                  />
                  <input
                    type="checkbox"
                    checked={!!isChecked}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleSelect(msg.uid)}
                    aria-label="Select message"
                    className={`absolute top-1 h-4 w-4 cursor-pointer accent-[#f97316] ${
                      isChecked ? 'block' : 'hidden group-hover:block'
                    }`}
                  />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${seen ? 'font-medium text-gray-700 dark:text-gray-300' : 'font-bold text-gray-900 dark:text-white'}`}>
                      {name}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">{formatDate(msg.envelope?.date || msg.internalDate)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {(flagged || !seen) && <StarButton flagged={flagged} onToggle={() => onToggleStar(msg)} />}
                    <span className={`truncate text-sm ${seen ? 'text-gray-600 dark:text-gray-400' : 'font-semibold text-gray-800 dark:text-gray-200'}`}>
                      {msg.envelope?.subject || '(no subject)'}
                    </span>
                    {msg.hasAttachments && (
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 fill-gray-400" aria-label="Has attachments">
                        <path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z" />
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Pagination footer */}
      {!loading && !error && total > 0 && (
        <div className="flex items-center justify-between border-t border-black/5 px-3 py-2 text-xs text-gray-500 dark:border-white/5 dark:text-gray-400">
          <button type="button" onClick={onRefresh} className="icon-btn h-8 w-8" title="Refresh">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" /></svg>
          </button>
          <span>{start}–{end} of {total}</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="icon-btn h-8 w-8 disabled:opacity-30" title="Newer">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
            </button>
            <button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="icon-btn h-8 w-8 disabled:opacity-30" title="Older">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
