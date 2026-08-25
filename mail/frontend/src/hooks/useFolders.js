import { useCallback, useEffect, useState } from 'react';
import client, { errorMessage } from '../api/client.js';

// Fixed display order + role metadata for the well-known special folders.
// Folders whose role is not in this map are listed afterward under "Folders".
export const ROLE_ORDER = [
  'inbox',
  'flagged', // "Starred"
  'sent',
  'drafts',
  'junk', // "Spam"
  'trash',
  'archive',
  'all',
];

export const ROLE_LABELS = {
  inbox: 'Inbox',
  flagged: 'Starred',
  sent: 'Sent',
  drafts: 'Drafts',
  junk: 'Spam',
  trash: 'Trash',
  archive: 'Archive',
  all: 'All Mail',
};

// Sort: special-role folders first (by ROLE_ORDER), then everything else
// alphabetically by display name.
function sortFolders(folders) {
  return [...folders].sort((a, b) => {
    const ai = a.role ? ROLE_ORDER.indexOf(a.role) : -1;
    const bi = b.role ? ROLE_ORDER.indexOf(b.role) : -1;
    const aSpecial = ai !== -1;
    const bSpecial = bi !== -1;
    if (aSpecial && bSpecial) return ai - bi;
    if (aSpecial) return -1;
    if (bSpecial) return 1;
    return (a.name || a.path).localeCompare(b.name || b.path);
  });
}

// Fetches the folder list (with total/unread counts) and exposes refetch().
export default function useFolders() {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const { data } = await client.get('/api/folders');
      const list = Array.isArray(data?.folders) ? data.folders : [];
      // Only show selectable, subscribed folders in the tree.
      const visible = list.filter((f) => f.selectable !== false);
      setFolders(sortFolders(visible));
    } catch (err) {
      setError(errorMessage(err, 'Failed to load folders'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Convenience: find the INBOX path (role inbox) or fall back to "INBOX".
  const inboxPath =
    folders.find((f) => f.role === 'inbox')?.path || 'INBOX';

  return { folders, loading, error, refetch, inboxPath };
}
