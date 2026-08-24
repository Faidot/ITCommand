import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Spinner from '../components/ui/Spinner.jsx';

// Login page: email + password, validated against the IMAP server by the
// backend. Shows the configured app name/logo and a readable error on failure.
export default function Login() {
  const { login, app } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas px-4 dark:bg-dark-canvas">
      {/* Soft brand glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl"
      />
      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center gap-3">
          {app?.logo ? (
            <img src={app.logo} alt={app.name} className="h-14 w-auto max-w-[240px] object-contain" />
          ) : (
            <svg viewBox="0 0 24 24" className="h-12 w-12 fill-primary">
              <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
            </svg>
          )}
          <h1 className="text-2xl font-medium text-gray-800 dark:text-gray-100">
            {app?.name || 'TeraMailer'}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Sign in to your mailbox</p>
        </div>

        {/* Card */}
        <form
          onSubmit={onSubmit}
          className="surface space-y-4 p-6 sm:p-8"
        >
          {error && (
            <div className="rounded-md border border-unread/30 bg-unread/10 px-3 py-2 text-sm text-unread">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`you@${app?.domain || 'example.com'}`}
              className="input"
              disabled={submitting}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input pr-10"
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  {showPassword ? (
                    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2z" />
                  ) : (
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
                  )}
                </svg>
              </button>
            </div>
          </div>

          <button type="submit" disabled={submitting} className="btn-accent mt-1 w-full py-2.5">
            {submitting ? <Spinner size="sm" className="text-white" /> : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-400">
          Secured webmail · {app?.name || 'TeraMailer'}
        </p>
      </div>
    </div>
  );
}
