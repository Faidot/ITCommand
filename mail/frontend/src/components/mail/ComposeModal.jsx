import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { useToast } from '../../context/ToastContext.jsx';
import Spinner from '../ui/Spinner.jsx';

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

// Small toolbar button for the Tiptap editor.
function ToolBtn({ active, onClick, label, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep editor focus
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-elevated ${
        active ? 'bg-gray-200 text-primary dark:bg-dark-border' : ''
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Gmail-style compose window. Driven by the useCompose() instance passed in via
 * `compose`. Supports new / reply / reply-all / forward (mode is carried on the
 * draft), Cc/Bcc, a Tiptap rich-text body, and drag-drop attachments.
 */
export default function ComposeModal({ compose, maxUploadMb = 25, onSent }) {
  const { isOpen, draft, sending, close, send } = compose;
  const toast = useToast();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [files, setFiles] = useState([]);
  const [minimized, setMinimized] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
    ],
    content: '',
  });

  // Sync local form + editor whenever the modal opens with a (new) draft.
  useEffect(() => {
    if (!isOpen) return;
    setTo(draft.to || '');
    setCc(draft.cc || '');
    setBcc(draft.bcc || '');
    setSubject(draft.subject || '');
    setShowCc(!!draft.showCc || !!draft.cc);
    setShowBcc(!!draft.showBcc || !!draft.bcc);
    setFiles([]);
    setMinimized(false);
    if (editor) editor.commands.setContent(draft.html || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, draft, editor]);

  if (!isOpen) return null;

  const titleFor = () => {
    if (draft.mode === 'forward') return 'Forward message';
    if (draft.mode === 'reply' || draft.mode === 'replyAll') return 'Reply';
    return 'New message';
  };

  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    setFiles((prev) => [...prev, ...incoming]);
  };

  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const totalBytes = files.reduce((s, f) => s + f.size, 0);
  const overLimit = totalBytes > maxUploadMb * 1024 * 1024;

  const handleSend = async () => {
    if (!to.trim()) {
      toast.error('Please add at least one recipient');
      return;
    }
    if (overLimit) {
      toast.error(`Attachments exceed the ${maxUploadMb} MB limit`);
      return;
    }
    const html = editor ? editor.getHTML() : draft.html || '';
    try {
      await send(
        {
          ...draft,
          to,
          cc: showCc ? cc : '',
          bcc: showBcc ? bcc : '',
          subject,
          html,
        },
        files
      );
      toast.success('Message sent');
      onSent && onSent();
      close();
    } catch (err) {
      toast.error(err.message || 'Failed to send message');
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-end justify-center sm:bottom-0 sm:right-6 sm:left-auto sm:top-auto sm:items-end sm:justify-end"
      // Backdrop only on mobile (full-screen sheet); desktop is a docked card.
      aria-modal="true"
      role="dialog"
    >
      {/* Mobile backdrop */}
      <div className="absolute inset-0 bg-black/30 sm:hidden" onClick={close} aria-hidden="true" />

      <div
        className={`relative flex w-full flex-col overflow-hidden bg-white shadow-compose dark:bg-dark-surface sm:w-[34rem] sm:rounded-t-lg ${
          minimized ? 'h-12' : 'h-full sm:h-[36rem]'
        }`}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
      >
        {/* Header */}
        <div className="flex items-center justify-between bg-gray-100 px-4 py-2 dark:bg-dark-elevated">
          <span className="truncate text-sm font-medium text-gray-800 dark:text-gray-100">
            {subject?.trim() || titleFor()}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMinimized((m) => !m)}
              className="rounded p-1 text-gray-500 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-dark-border"
              aria-label={minimized ? 'Expand' : 'Minimize'}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                {minimized ? <path d="M4 14h16v2H4z" /> : <path d="M19 13H5v-2h14v2z" />}
              </svg>
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded p-1 text-gray-500 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-dark-border"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>

        {!minimized && (
          <>
            {/* Recipients + subject */}
            <div className="border-b border-gray-200 px-4 dark:border-dark-border">
              <div className="flex items-center border-b border-gray-100 py-1 dark:border-dark-border/60">
                <input
                  type="text"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="To"
                  className="flex-1 bg-transparent py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none dark:text-gray-100"
                  aria-label="To"
                />
                <div className="flex gap-2 text-xs text-gray-500">
                  {!showCc && (
                    <button type="button" onClick={() => setShowCc(true)} className="hover:text-gray-700 dark:hover:text-gray-300">
                      Cc
                    </button>
                  )}
                  {!showBcc && (
                    <button type="button" onClick={() => setShowBcc(true)} className="hover:text-gray-700 dark:hover:text-gray-300">
                      Bcc
                    </button>
                  )}
                </div>
              </div>

              {showCc && (
                <input
                  type="text"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="Cc"
                  className="w-full border-b border-gray-100 bg-transparent py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none dark:border-dark-border/60 dark:text-gray-100"
                  aria-label="Cc"
                />
              )}
              {showBcc && (
                <input
                  type="text"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  placeholder="Bcc"
                  className="w-full border-b border-gray-100 bg-transparent py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none dark:border-dark-border/60 dark:text-gray-100"
                  aria-label="Bcc"
                />
              )}

              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                className="w-full bg-transparent py-1.5 text-sm font-medium text-gray-800 placeholder-gray-400 focus:outline-none dark:text-gray-100"
                aria-label="Subject"
              />
            </div>

            {/* Formatting toolbar */}
            {editor && (
              <div className="flex items-center gap-0.5 border-b border-gray-200 px-2 py-1 dark:border-dark-border">
                <ToolBtn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="Bold">
                  <span className="text-sm font-bold">B</span>
                </ToolBtn>
                <ToolBtn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="Italic">
                  <span className="text-sm italic">I</span>
                </ToolBtn>
                <ToolBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} label="Strikethrough">
                  <span className="text-sm line-through">S</span>
                </ToolBtn>
                <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-dark-border" />
                <ToolBtn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Bulleted list">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M4 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0-6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0 12a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM8 19h13v-2H8v2zm0-6h13v-2H8v2zm0-8v2h13V5H8z" /></svg>
                </ToolBtn>
                <ToolBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Numbered list">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h13V5H7zm0 14h13v-2H7v2zm0-6h13v-2H7v2z" /></svg>
                </ToolBtn>
                <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-dark-border" />
                <ToolBtn
                  active={editor.isActive('link')}
                  onClick={() => {
                    const prev = editor.getAttributes('link').href || '';
                    const url = window.prompt('Link URL', prev);
                    if (url === null) return;
                    if (url === '') editor.chain().focus().unsetLink().run();
                    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
                  }}
                  label="Insert link"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" /></svg>
                </ToolBtn>
              </div>
            )}

            {/* Editor body */}
            <div className="relative flex-1 overflow-y-auto px-4 py-3">
              <EditorContent editor={editor} className="text-gray-900 dark:text-gray-100" />
              {dragOver && (
                <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary-light/70 text-sm font-medium text-primary dark:bg-primary/20">
                  Drop files to attach
                </div>
              )}
            </div>

            {/* Attachments */}
            {files.length > 0 && (
              <div className="max-h-32 overflow-y-auto border-t border-gray-200 px-4 py-2 dark:border-dark-border">
                <div className="flex flex-wrap gap-2">
                  {files.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-2 rounded-full bg-gray-100 py-1 pl-3 pr-2 text-xs text-gray-700 dark:bg-dark-elevated dark:text-gray-200"
                    >
                      <span className="max-w-[12rem] truncate">{f.name}</span>
                      <span className="text-gray-400">{formatSize(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="rounded-full p-0.5 hover:bg-gray-200 dark:hover:bg-dark-border"
                        aria-label={`Remove ${f.name}`}
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                      </button>
                    </span>
                  ))}
                </div>
                {overLimit && (
                  <p className="mt-1 text-xs text-unread">Total size {formatSize(totalBytes)} exceeds {maxUploadMb} MB limit.</p>
                )}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center gap-3 border-t border-gray-200 px-4 py-3 dark:border-dark-border">
              <button type="button" onClick={handleSend} disabled={sending} className="btn-primary px-6">
                {sending ? <Spinner size="sm" className="text-white" /> : 'Send'}
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="icon-btn h-9 w-9"
                aria-label="Attach files"
                title="Attach files"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z" /></svg>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <span className="ml-auto text-xs text-gray-400">
                {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''} · ${formatSize(totalBytes)}` : `Max ${maxUploadMb} MB`}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
