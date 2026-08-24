import { attachmentUrl } from '../../api/client.js';

// Human-readable byte size.
function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

// Pick a simple icon based on the content type.
function fileIcon(contentType = '') {
  const ct = contentType.toLowerCase();
  if (ct.startsWith('image/')) {
    return (
      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
    );
  }
  if (ct.includes('pdf')) {
    return (
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    );
  }
  return (
    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z" />
  );
}

// Displays a message's attachments as downloadable chips.
// Each link points at the streaming endpoint; cookies are sent automatically.
export default function AttachmentBar({ uid, folder, attachments }) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="border-t border-gray-200 px-4 py-4 dark:border-dark-border sm:px-6">
      <p className="mb-3 text-sm font-medium text-gray-600 dark:text-gray-300">
        {attachments.length} attachment
        {attachments.length > 1 ? 's' : ''}
      </p>
      <div className="flex flex-wrap gap-3">
        {attachments.map((att) => (
          <a
            key={att.part}
            href={attachmentUrl(uid, att.part, folder)}
            target="_blank"
            rel="noopener noreferrer"
            // The endpoint sets Content-Disposition: attachment, so this both
            // downloads the file and works across browsers with the cookie.
            download={att.filename || undefined}
            className="group flex w-56 items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 transition-colors hover:border-primary hover:bg-primary-light dark:border-dark-border dark:bg-dark-surface dark:hover:border-primary"
            title={`Download ${att.filename || att.part}`}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8 shrink-0 fill-gray-400 group-hover:fill-primary"
            >
              {fileIcon(att.contentType)}
            </svg>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                {att.filename || att.part}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {formatSize(att.size)}
              </p>
            </div>
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5 shrink-0 fill-gray-400 group-hover:fill-primary"
            >
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
          </a>
        ))}
      </div>
    </div>
  );
}
