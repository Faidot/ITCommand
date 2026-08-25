import { useEffect, useRef, useState } from 'react';

/**
 * Generic right-click context menu (Dappr-style).
 *
 * Props:
 *  - open:    boolean
 *  - x, y:    cursor coordinates (viewport)
 *  - onClose: () => void
 *  - items:   array of:
 *      { type: 'separator' }
 *      { label, icon?, onClick?, danger?, disabled?, submenu?: [{ label, onClick }] }
 */
export default function ContextMenu({ open, x, y, onClose, items = [] }) {
  const ref = useRef(null);
  const [openSub, setOpenSub] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) setOpenSub(null);
  }, [open, x, y]);

  if (!open) return null;

  // Clamp to the viewport.
  const W = 230;
  const left = Math.min(x, window.innerWidth - W - 8);
  const top = Math.min(y, window.innerHeight - 380);

  const run = (fn) => () => {
    onClose();
    if (fn) fn();
  };

  return (
    <div
      ref={ref}
      style={{ left, top: Math.max(8, top) }}
      className="no-print fixed z-[80] w-[230px] overflow-visible rounded-2xl border border-black/5 bg-white py-1.5 shadow-2xl dark:border-white/10 dark:bg-dark-elevated"
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.type === 'separator') {
          return <div key={`sep-${i}`} className="my-1 h-px bg-black/5 dark:bg-white/10" />;
        }

        const base =
          'flex w-full items-center gap-3 px-4 py-2 text-sm transition-colors disabled:opacity-40';
        const tone = item.danger
          ? 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40'
          : 'text-gray-700 hover:bg-black/[0.05] dark:text-gray-200 dark:hover:bg-white/5';

        // Submenu item (Move to / Copy to)
        if (item.submenu) {
          const isOpen = openSub === i;
          return (
            <div
              key={item.label}
              className="relative"
              onMouseEnter={() => setOpenSub(i)}
              onMouseLeave={() => setOpenSub((s) => (s === i ? null : s))}
            >
              <button type="button" className={`${base} ${tone}`} disabled={item.disabled}>
                {item.icon && <span className="text-gray-400">{item.icon}</span>}
                <span className="flex-1 text-left">{item.label}</span>
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current text-gray-400">
                  <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                </svg>
              </button>
              {isOpen && item.submenu.length > 0 && (
                <div className="absolute left-full top-0 ml-1 max-h-72 w-56 overflow-y-auto rounded-2xl border border-black/5 bg-white py-1.5 shadow-2xl dark:border-white/10 dark:bg-dark-elevated">
                  {item.submenu.map((sub) => (
                    <button
                      key={sub.label}
                      type="button"
                      onClick={run(sub.onClick)}
                      className="block w-full truncate px-4 py-2 text-left text-sm text-gray-700 hover:bg-black/[0.05] dark:text-gray-200 dark:hover:bg-white/5"
                      title={sub.label}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        }

        // Regular item
        return (
          <button
            key={item.label}
            type="button"
            onClick={run(item.onClick)}
            disabled={item.disabled}
            className={`${base} ${tone}`}
            role="menuitem"
          >
            {item.icon && <span className="text-gray-400">{item.icon}</span>}
            <span className="flex-1 text-left">{item.label}</span>
            {item.trailing}
          </button>
        );
      })}
    </div>
  );
}
