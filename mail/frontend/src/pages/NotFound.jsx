import { Link } from 'react-router-dom';

// 404 page for unmatched routes.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-4 text-center dark:bg-dark-canvas">
      <svg viewBox="0 0 24 24" className="h-16 w-16 fill-gray-300 dark:fill-dark-border">
        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
      </svg>
      <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-100">404</h1>
      <p className="text-gray-500 dark:text-gray-400">This page could not be found.</p>
      <Link to="/" className="btn-primary mt-2">
        Back to mailbox
      </Link>
    </div>
  );
}
