import { useCallback, useEffect, useRef, useState } from 'react';
import client, { errorMessage } from '../api/client.js';

export const PAGE_SIZE = 25;

// Fetches a paginated list of messages for a folder, with optional search.
// Returns the list plus helpers to change page, refetch, and locally mutate
// items (e.g. mark seen / star) without a full reload.
export default function useMessages(folder, { search = '', state = 'all' } = {}) {
  const [messages, setMessages] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Track the latest request so out-of-order responses don't clobber state.
  const requestId = useRef(0);

  // Reset to page 1 whenever the folder, search term, or filter changes.
  useEffect(() => {
    setPage(1);
  }, [folder, search, state]);

  // `silent` (used by the 5s auto-sync) updates the list in place without
  // toggling the loading spinner or clearing the view on a transient error.
  const fetchMessages = useCallback(
    async (targetPage = page, { silent = false } = {}) => {
      if (!folder) return;
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const { data } = await client.get('/api/messages', {
          params: {
            folder,
            page: targetPage,
            limit: PAGE_SIZE,
            search: search || '',
            state: state || 'all',
          },
        });
        // Ignore stale responses.
        if (id !== requestId.current) return;
        setMessages(Array.isArray(data?.messages) ? data.messages : []);
        setTotal(data?.total ?? 0);
        setTotalPages(data?.totalPages ?? 1);
        setPage(data?.page ?? targetPage);
      } catch (err) {
        if (id !== requestId.current) return;
        // On a silent poll, keep the current list rather than blanking it.
        if (!silent) {
          setError(errorMessage(err, 'Failed to load messages'));
          setMessages([]);
        }
      } finally {
        if (!silent && id === requestId.current) setLoading(false);
      }
    },
    [folder, page, search, state]
  );

  // Refetch whenever folder / search / filter / page changes.
  useEffect(() => {
    fetchMessages(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, search, state, page]);

  const goToPage = useCallback(
    (next) => {
      setPage((prev) => {
        const target = Math.max(1, Math.min(next, totalPages || 1));
        return target === prev ? prev : target;
      });
    },
    [totalPages]
  );

  // Locally patch a message (by uid) — used for optimistic seen/flag updates.
  const patchMessage = useCallback((uid, patch) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.uid === uid
          ? {
              ...m,
              ...patch,
              flags: patch.flags ? { ...m.flags, ...patch.flags } : m.flags,
            }
          : m
      )
    );
  }, []);

  // Remove messages locally (e.g. after delete/move) so the UI updates instantly.
  const removeMessages = useCallback((uids) => {
    const set = new Set(uids);
    setMessages((prev) => prev.filter((m) => !set.has(m.uid)));
    setTotal((t) => Math.max(0, t - set.size));
  }, []);

  return {
    messages,
    page,
    total,
    totalPages,
    loading,
    error,
    setPage: goToPage,
    refetch: fetchMessages,
    patchMessage,
    removeMessages,
  };
}
