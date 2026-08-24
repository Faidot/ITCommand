// Presentational toast components. The ToastProvider (context/ToastContext.jsx)
// owns the toast state and renders <ToastContainer> with the active toasts.

const TYPE_STYLES = {
  success: 'bg-green-600 text-white',
  error: 'bg-unread text-white',
  info: 'bg-gray-800 text-white dark:bg-dark-elevated',
  warning: 'bg-amber-500 text-white',
};

const TYPE_ICONS = {
  success: (
    <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  ),
  error: (
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
  ),
  info: (
    <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
  ),
  warning: (
    <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
  ),
};

function Toast({ toast, onDismiss }) {
  const style = TYPE_STYLES[toast.type] || TYPE_STYLES.info;
  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-lg px-4 py-3 shadow-lg animate-[fadeIn_0.15s_ease-out] ${style}`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current">
        {TYPE_ICONS[toast.type] || TYPE_ICONS.info}
      </svg>
      <span className="flex-1 text-sm">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="rounded p-1 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
          <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="no-print pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

export default Toast;
