import axios from 'axios';

// Base URL of the backend API.
// If VITE_API_URL is defined (even empty => same-origin/relative) use it;
// otherwise fall back to localhost:5000 for local dev.
const API_URL =
  import.meta.env.VITE_API_URL !== undefined
    ? import.meta.env.VITE_API_URL
    : 'http://localhost:5000';

// ---------------------------------------------------------------------------
// CSRF token handling.
// The token is returned by POST /api/admin/login and GET /api/admin/me.
// We keep it in a module-level variable and inject it into the
// `x-csrf-token` header for every mutating request (POST/PUT/PATCH/DELETE).
// ---------------------------------------------------------------------------
let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

export function getCsrfToken() {
  return csrfToken;
}

// Methods that require a CSRF token.
const MUTATING_METHODS = ['post', 'put', 'patch', 'delete'];

// Axios instance shared across the app.
const adminClient = axios.create({
  baseURL: API_URL,
  withCredentials: true, // send/receive the session cookie
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach the CSRF token on mutating requests.
adminClient.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();
  if (MUTATING_METHODS.includes(method) && csrfToken) {
    config.headers = config.headers || {};
    config.headers['x-csrf-token'] = csrfToken;
  }
  return config;
});

// ---------------------------------------------------------------------------
// 401 handling.
// On an unauthorized response we clear the token and redirect to the login
// page. We avoid redirect loops by skipping when already on /admin/login and
// by skipping the /me probe (the AdminAuthContext handles that case itself).
// ---------------------------------------------------------------------------
adminClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || '';
    if (status === 401) {
      csrfToken = null;
      const isMeProbe = url.includes('/api/admin/me');
      const onLoginPage = window.location.pathname.startsWith('/admin/login');
      if (!isMeProbe && !onLoginPage) {
        // Hard redirect keeps app state clean after auth loss.
        window.location.href = '/admin/login';
      }
    }
    return Promise.reject(error);
  }
);

// Helper to pull a human-readable error message out of an axios error.
export function extractError(error, fallback = 'Something went wrong.') {
  return (
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

export default adminClient;
