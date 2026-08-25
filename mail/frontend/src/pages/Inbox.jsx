import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useLayout } from '../components/layout/Layout.jsx';
import useMessages from '../hooks/useMessages.js';
import { COMPOSE_MODE } from '../hooks/useCompose.js';
import client, { errorMessage } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import MessageList from '../components/mail/MessageList.jsx';
import MessageView from '../components/mail/MessageView.jsx';
import SearchBar from '../components/mail/SearchBar.jsx';
import ContextMenu from '../components/mail/ContextMenu.jsx';

const FLAG_STARRED = '\\Flagged';
const FLAG_SEEN = '\\Seen';

const FOLDER_TITLES = {
  inbox: 'Inbox',
  flagged: 'Important',
  sent: 'Sent',
  drafts: 'Drafts',
  trash: 'Deleted',
  junk: 'Spam',
  archive: 'Archive',
  all: 'All Mail',
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'read', label: 'Read' },
  { key: 'unread', label: 'Unread' },
];

export default function Inbox() {
  const { folderPath } = useParams();
  const [searchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const { folders, compose, onNewMail } = useLayout();
  const toast = useToast();

  const folder = folderPath ? decodeURIComponent(folderPath) : folders.inboxPath || 'INBOX';

  const [filter, setFilter] = useState('all');
  const msgs = useMessages(folder, { search, state: filter });

  const folderMeta = useMemo(
    () => folders.folders.find((f) => f.path === folder),
    [folders.folders, folder]
  );
  const isSentLike = ['sent', 'drafts'].includes(folderMeta?.role);
  const folderTitle = FOLDER_TITLES[folderMeta?.role] || folderMeta?.name || 'Inbox';

  const [selectedUid, setSelectedUid] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [ctx, setCtx] = useState(null); // right-click menu: { x, y, msg }

  // Reset transient state when folder/search/filter change.
  useEffect(() => {
    setSelectedUid(null);
    setDetail(null);
    setDetailError(null);
    setSelectedIds(new Set());
  }, [folder, search, filter]);

  // Reset the read/unread filter when switching folders.
  useEffect(() => {
    setFilter('all');
  }, [folder]);

  // Live updates: refetch the current page on mailbox change (IMAP IDLE / SSE).
  useEffect(() => {
    return onNewMail(() => msgs.refetch(msgs.page));
  }, [onNewMail, msgs.refetch, msgs.page]);

  // Auto-sync: silently re-poll the current folder + unread counts every 5s.
  // No spinner, no page reload — the list just updates in place. Skips polling
  // while the tab is hidden to avoid needless server load.
  useEffect(() => {
    const POLL_MS = 5000;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      msgs.refetch(msgs.page, { silent: true });
      folders.refetch();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [msgs.refetch, msgs.page, folders.refetch]);

  /* ---- Open / close ---- */
  const openMessage = useCallback(
    async (msg) => {
      setSelectedUid(msg.uid);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const { data } = await client.get(`/api/messages/${msg.uid}`, { params: { folder } });
        setDetail(data);
        if (!msg.flags?.seen) {
          msgs.patchMessage(msg.uid, { flags: { seen: true } });
          folders.refetch();
        }
      } catch (err) {
        setDetailError(errorMessage(err, 'Failed to load message'));
      } finally {
        setDetailLoading(false);
      }
    },
    [folder, msgs, folders]
  );

  const closeMessage = useCallback(() => {
    setSelectedUid(null);
    setDetail(null);
    setDetailError(null);
  }, []);

  /* ---- Star ---- */
  const toggleStar = useCallback(
    async (msg) => {
      const next = !msg.flags?.flagged;
      msgs.patchMessage(msg.uid, { flags: { flagged: next } });
      if (detail && detail.uid === msg.uid) setDetail((d) => ({ ...d, flags: { ...d.flags, flagged: next } }));
      try {
        await client.post('/api/messages/flag', {
          folder,
          uids: [msg.uid],
          add: next ? [FLAG_STARRED] : [],
          remove: next ? [] : [FLAG_STARRED],
        });
      } catch (err) {
        msgs.patchMessage(msg.uid, { flags: { flagged: !next } });
        toast.error(errorMessage(err, 'Could not update star'));
      }
    },
    [folder, msgs, detail, toast]
  );

  /* ---- Selection ---- */
  const toggleSelect = useCallback((uid) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  /* ---- Mutations ---- */
  const handleDelete = useCallback(
    async (uids) => {
      if (!uids.length) return;
      try {
        await client.post('/api/messages/delete', { folder, uids });
        msgs.removeMessages(uids);
        if (uids.includes(selectedUid)) closeMessage();
        clearSelection();
        folders.refetch();
        toast.success(uids.length > 1 ? `${uids.length} messages deleted` : 'Message deleted');
      } catch (err) {
        toast.error(errorMessage(err, 'Delete failed'));
      }
    },
    [folder, msgs, selectedUid, closeMessage, clearSelection, folders, toast]
  );

  const handleMark = useCallback(
    async (uids, seen) => {
      if (!uids.length) return;
      uids.forEach((u) => msgs.patchMessage(u, { flags: { seen } }));
      try {
        await client.post('/api/messages/flag', {
          folder,
          uids,
          add: seen ? [FLAG_SEEN] : [],
          remove: seen ? [] : [FLAG_SEEN],
        });
        clearSelection();
        folders.refetch();
      } catch (err) {
        toast.error(errorMessage(err, 'Could not update messages'));
      }
    },
    [folder, msgs, clearSelection, folders, toast]
  );

  const handleMove = useCallback(
    async (uids, destination) => {
      if (!uids.length) return;
      try {
        await client.post('/api/messages/move', { folder, destination, uids });
        msgs.removeMessages(uids);
        if (uids.includes(selectedUid)) closeMessage();
        clearSelection();
        folders.refetch();
        toast.success('Message moved');
      } catch (err) {
        toast.error(errorMessage(err, 'Move failed'));
      }
    },
    [folder, msgs, selectedUid, closeMessage, clearSelection, folders, toast]
  );

  const handleCopy = useCallback(
    async (uids, destination) => {
      if (!uids.length) return;
      try {
        await client.post('/api/messages/copy', { folder, destination, uids });
        folders.refetch();
        toast.success('Message copied');
      } catch (err) {
        toast.error(errorMessage(err, 'Copy failed'));
      }
    },
    [folder, folders, toast]
  );

  // Open compose (reply/forward) directly from a list item by loading its detail.
  const openReplyFor = useCallback(
    async (msg, mode) => {
      try {
        const { data } = await client.get(`/api/messages/${msg.uid}`, { params: { folder } });
        compose.openReply(data, mode);
        if (!msg.flags?.seen) {
          msgs.patchMessage(msg.uid, { flags: { seen: true } });
          folders.refetch();
        }
      } catch (err) {
        toast.error(errorMessage(err, 'Could not open message'));
      }
    },
    [folder, compose, msgs, folders, toast]
  );

  /* ---- Reading-pane actions ---- */
  const reply = () => detail && compose.openReply(detail, COMPOSE_MODE.REPLY);
  const replyAll = () => detail && compose.openReply(detail, COMPOSE_MODE.REPLY_ALL);
  const forward = () => detail && compose.openReply(detail, COMPOSE_MODE.FORWARD);
  const markUnreadAndClose = () => {
    if (!detail) return;
    handleMark([detail.uid], false);
    closeMessage();
  };

  /* ---- Context menu ---- */
  const openContext = useCallback((e, msg) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, msg });
  }, []);

  const buildContextItems = (msg) => {
    const icon = (d) => (
      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
        {d}
      </svg>
    );
    const targets = folders.folders.filter((f) => f.path !== folder && f.selectable !== false);
    const junk = folders.folders.find((f) => f.role === 'junk');
    const archive = folders.folders.find((f) => f.role === 'archive');
    const moveSub = targets.map((f) => ({
      label: FOLDER_TITLES[f.role] || f.name || f.path,
      onClick: () => handleMove([msg.uid], f.path),
    }));
    const copySub = targets.map((f) => ({
      label: FOLDER_TITLES[f.role] || f.name || f.path,
      onClick: () => handleCopy([msg.uid], f.path),
    }));

    return [
      { label: 'Open', icon: icon(<path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />), onClick: () => openMessage(msg) },
      { label: 'Reply', icon: icon(<path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />), onClick: () => openReplyFor(msg, COMPOSE_MODE.REPLY) },
      { label: 'Reply All', icon: icon(<path d="M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z" />), onClick: () => openReplyFor(msg, COMPOSE_MODE.REPLY_ALL) },
      { label: 'Forward', icon: icon(<path d="M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z" />), onClick: () => openReplyFor(msg, COMPOSE_MODE.FORWARD) },
      { type: 'separator' },
      { label: msg.flags?.seen ? 'Mark as unread' : 'Mark as read', icon: icon(<path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />), onClick: () => handleMark([msg.uid], !msg.flags?.seen) },
      ...(junk ? [{ label: 'Move to Junk', icon: icon(<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />), onClick: () => handleMove([msg.uid], junk.path) }] : []),
      { label: msg.flags?.flagged ? 'Unstar' : 'Star', icon: icon(<path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24z" />), onClick: () => toggleStar(msg) },
      ...(archive ? [{ label: 'Archive', icon: icon(<path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5z" />), onClick: () => handleMove([msg.uid], archive.path) }] : []),
      { label: 'Move to', icon: icon(<path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z" />), submenu: moveSub, disabled: moveSub.length === 0 },
      { label: 'Copy to', icon: icon(<path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2z" />), submenu: copySub, disabled: copySub.length === 0 },
      { type: 'separator' },
      { label: 'Delete', danger: true, icon: icon(<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />), onClick: () => handleDelete([msg.uid]) },
    ];
  };

  return (
    <div className="flex h-full">
      {/* List column */}
      <div
        className={`flex h-full w-full flex-col md:w-[360px] md:shrink-0 md:border-r md:border-black/5 lg:w-[400px] dark:md:border-white/5 ${
          selectedUid ? 'hidden md:flex' : 'flex'
        }`}
      >
        {/* List header */}
        <div className="shrink-0 px-5 pb-4 pt-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{folderTitle}</h2>
            <button
              type="button"
              onClick={() => compose.openNew()}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white transition-colors hover:bg-ink-soft"
              title="Compose"
              aria-label="Compose"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg>
            </button>
          </div>

          <SearchBar />

          {/* All / Read / Unread filter */}
          <div className="mt-3 inline-flex rounded-full bg-black/[0.05] p-1 dark:bg-white/5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  filter === f.key
                    ? 'bg-ink text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <MessageList
            messages={msgs.messages}
            loading={msgs.loading}
            error={msgs.error}
            page={msgs.page}
            total={msgs.total}
            totalPages={msgs.totalPages}
            selectedUid={selectedUid}
            selectedIds={selectedIds}
            isSentLike={isSentLike}
            onOpen={openMessage}
            onToggleStar={toggleStar}
            onToggleSelect={toggleSelect}
            onClearSelection={clearSelection}
            onBulkDelete={() => handleDelete([...selectedIds])}
            onBulkMarkRead={() => handleMark([...selectedIds], true)}
            onBulkMarkUnread={() => handleMark([...selectedIds], false)}
            onContextMenu={openContext}
            onPageChange={msgs.setPage}
            onRefresh={() => msgs.refetch(msgs.page)}
          />
        </div>
      </div>

      {/* Reading pane */}
      <div className={`min-w-0 flex-1 ${selectedUid ? 'flex' : 'hidden md:flex'}`}>
        <MessageView
          message={detail}
          loading={detailLoading}
          error={detailError}
          folder={folder}
          folders={folders.folders}
          onClose={closeMessage}
          onReply={reply}
          onReplyAll={replyAll}
          onForward={forward}
          onDelete={() => detail && handleDelete([detail.uid])}
          onMove={(dest) => detail && handleMove([detail.uid], dest)}
          onToggleStar={() => detail && toggleStar(detail)}
          onMarkUnread={markUnreadAndClose}
          onRetry={() => selectedUid && openMessage({ uid: selectedUid, flags: { seen: true } })}
        />
      </div>

      {/* Right-click context menu */}
      <ContextMenu
        open={!!ctx}
        x={ctx?.x || 0}
        y={ctx?.y || 0}
        onClose={() => setCtx(null)}
        items={ctx ? buildContextItems(ctx.msg) : []}
      />
    </div>
  );
}
