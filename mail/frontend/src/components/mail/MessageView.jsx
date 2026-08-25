import { useEffect, useRef, useState } from 'react';
import Avatar from '../ui/Avatar.jsx';
import Spinner from '../ui/Spinner.jsx';
import AttachmentBar from './AttachmentBar.jsx';

function formatFullDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function addr(a) {
  if (!a) return '';
  if (a.name) return a.name;
  return a.address || '';
}

function joinAddr(list) {
  return (list || []).map((a) => addr(a) || a.address).filter(Boolean).join(', ');
}

// Text + icon toolbar button (Dappr-style).
function ToolButton({ icon, label, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-black/[0.05] dark:hover:bg-white/5 ${
        active ? 'text-accent' : 'text-gray-600 dark:text-gray-300'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
        {icon}
      </svg>
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

// Move-to dropdown listing target folders (excludes the current one).
function MoveMenu({ folders, currentFolder, onMove }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const targets = (folders || []).filter((f) => f.path !== currentFolder && f.selectable !== false);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="icon-btn" aria-label="Move to" title="Move to">
        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z" /></svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-dark-border dark:bg-dark-elevated">
          <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Move to</p>
          {targets.length === 0 && <p className="px-3 py-2 text-sm text-gray-400">No other folders</p>}
          {targets.map((f) => (
            <button
              key={f.path}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onMove(f.path);
              }}
              className="block w-full truncate px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-dark-surface"
              title={f.path}
            >
              {f.name || f.path}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Full message reader. The HTML body (already sanitised server-side) is rendered
 * inside a sandboxed iframe for style isolation; the iframe auto-sizes to its
 * content. Toolbar exposes reply / reply-all / forward / delete / move / mark
 * unread / print.
 */
export default function MessageView({
  message,
  loading,
  error,
  folder,
  folders,
  onClose,
  onReply,
  onReplyAll,
  onForward,
  onDelete,
  onMove,
  onToggleStar,
  onMarkUnread,
  onRetry,
}) {
  const iframeRef = useRef(null);
  const [iframeHeight, setIframeHeight] = useState(300);

  // Auto-size the iframe to its content once loaded.
  const handleIframeLoad = () => {
    try {
      const doc = iframeRef.current?.contentWindow?.document;
      if (doc?.body) {
        const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
        setIframeHeight(h + 24);
      }
    } catch {
      /* cross-origin — leave default height */
    }
  };

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white dark:bg-dark-surface">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-white px-6 text-center dark:bg-dark-surface">
        <p className="text-sm text-unread">{error}</p>
        {onRetry && (
          <button onClick={onRetry} className="btn-secondary">
            Try again
          </button>
        )}
      </div>
    );
  }

  if (!message) {
    return (
      <div className="hidden h-full w-full flex-col items-center justify-center gap-3 bg-white text-gray-400 dark:bg-dark-surface md:flex">
        <svg viewBox="0 0 24 24" className="h-16 w-16 fill-current">
          <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
        </svg>
        <p className="text-sm">Select a message to read</p>
      </div>
    );
  }

  const env = message.envelope || {};
  const fromFirst = (env.from && env.from[0]) || {};
  const flagged = message.flags?.flagged;

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>
  html,body{margin:0;padding:0;}
  body{font-family:Roboto,Arial,system-ui,sans-serif;font-size:14px;line-height:1.5;color:#202124;padding:8px 4px;word-wrap:break-word;overflow-wrap:break-word;}
  img{max-width:100%;height:auto;}
  a{color:#1a73e8;}
  table{max-width:100%;}
  blockquote{margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#5f6368;}
  pre{white-space:pre-wrap;}
</style></head><body>${message.html || '<p style="color:#9aa0a6">(This message has no content.)</p>'}</body></html>`;

  return (
    <div className="flex h-full w-full flex-col bg-white dark:bg-dark-surface">
      {/* Toolbar */}
      <div className="no-print flex items-center gap-0.5 border-b border-black/5 px-2 py-2 dark:border-white/5">
        <button type="button" onClick={onClose} className="icon-btn h-9 w-9 md:hidden" aria-label="Back" title="Back">
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
        </button>

        <ToolButton onClick={onReply} label="Reply" icon={<path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />} />
        <ToolButton onClick={onReplyAll} label="Reply all" icon={<path d="M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />} />
        <ToolButton onClick={onForward} label="Forward" icon={<path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z" />} />
        <ToolButton onClick={onDelete} label="Delete" icon={<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />} />
        <ToolButton
          onClick={onToggleStar}
          label="Important"
          active={flagged}
          icon={
            flagged ? (
              <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
            ) : (
              <path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z" />
            )
          }
        />

        <div className="ml-auto flex items-center gap-0.5">
          <MoveMenu folders={folders} currentFolder={folder} onMove={onMove} />
          <button type="button" onClick={onMarkUnread} className="icon-btn h-9 w-9" aria-label="Mark as unread" title="Mark as unread">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" /></svg>
          </button>
          <button type="button" onClick={() => window.print()} className="icon-btn h-9 w-9" aria-label="Print" title="Print">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z" /></svg>
          </button>
        </div>
      </div>

      {/* Scrollable content (printable) */}
      <div className="print-area flex-1 overflow-y-auto">
        {/* Subject */}
        <div className="px-6 pt-6 lg:px-10">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {env.subject || '(no subject)'}
          </h1>
        </div>

        {/* Sender header */}
        <div className="mt-1 flex items-start gap-3 border-b border-black/5 px-6 py-4 dark:border-white/5 lg:px-10">
          <Avatar name={addr(fromFirst)} email={fromFirst.address} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {addr(fromFirst) || '(unknown sender)'}
              </span>
              {fromFirst.address && fromFirst.name && (
                <span className="text-sm text-gray-500 dark:text-gray-400">&lt;{fromFirst.address}&gt;</span>
              )}
            </div>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              to {joinAddr(env.to) || 'me'}
              {env.cc && env.cc.length ? `, cc ${joinAddr(env.cc)}` : ''}
            </p>
          </div>
          <time className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
            {formatFullDate(env.date || message.internalDate)}
          </time>
        </div>

        {/* Body (sandboxed, sanitised HTML) */}
        <div className="px-6 pt-5 lg:px-10">
          <iframe
            ref={iframeRef}
            title="Message body"
            sandbox="allow-same-origin allow-popups"
            srcDoc={srcDoc}
            onLoad={handleIframeLoad}
            className="w-full rounded bg-white"
            style={{ height: `${iframeHeight}px`, border: 'none' }}
          />
        </div>

        {/* Attachments */}
        <AttachmentBar uid={message.uid} folder={folder} attachments={message.attachments} />
      </div>
    </div>
  );
}
