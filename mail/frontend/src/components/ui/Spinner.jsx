// Simple accessible loading spinner.
const SIZES = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-10 w-10 border-[3px]',
};

export default function Spinner({ size = 'md', className = '' }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-current border-t-transparent text-primary ${
        SIZES[size] || SIZES.md
      } ${className}`}
    />
  );
}

// Full-page centered spinner, used for initial auth/session loading.
export function FullPageSpinner({ label = 'Loading…' }) {
  return (
    <div className="flex h-full min-h-screen w-full flex-col items-center justify-center gap-4 bg-canvas dark:bg-dark-canvas">
      <Spinner size="lg" />
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}
