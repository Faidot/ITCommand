// Small count/label badge. Used for unread counts in the sidebar.
// variant: 'default' (gray) | 'unread' (red) | 'primary' (blue)
const VARIANTS = {
  default:
    'bg-gray-200 text-gray-700 dark:bg-dark-elevated dark:text-gray-200',
  unread: 'bg-unread text-white',
  primary: 'bg-primary text-white',
};

export default function Badge({
  children,
  variant = 'default',
  className = '',
}) {
  if (children === 0 || children === null || children === undefined) return null;
  return (
    <span
      className={`inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold leading-none ${
        VARIANTS[variant] || VARIANTS.default
      } ${className}`}
    >
      {typeof children === 'number' && children > 999 ? '999+' : children}
    </span>
  );
}
