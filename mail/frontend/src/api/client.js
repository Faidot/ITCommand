import axios from 'axios';

// Base URL of the backend.
// - If VITE_API_URL is defined (even as an empty string), use it verbatim.
//   An empty string means "same origin" (relative URLs) — used by the
//   single-port production build that serves the SPA + API together.
// - If it's not defined at all, fall back to localhost:5000 for local dev.
export const API_URL =
  import.meta.env.VITE_API_URL !== undefined
    ? import.meta.env.VITE_API_URL
    : 'http://localhost:5000';

// ---------------------------------------------------------------------------
// CSRF token storage
// The backend issues a CSRF token in the login response and in GET /api/auth/me.
// We keep it in a module-scoped variable and inject it on every mutating request
// via a request interceptor.
// ---------------------------------------------------------------------------
let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token || null;
}

export function getCsrfToken() {
  return csrfToken;
}

// ---------------------------------------------------------------------------
// 401 handling
// We can't import React Router here (this is a plain module), so we let the app
// register a callback that gets invoked on any 401. AuthContext registers a
// handler that clears auth state; App's ProtectedRoute then redirects to /login.
// As a hard fallback we also navigate the browser if no handler is set.
// ---------------------------------------------------------------------------
let onUnauthorized = null;

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Shared axios instance. withCredentials ensures the session cookie is sent.
const client = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
  },
});

// Request interceptor: attach the CSRF header to all mutating methods.
client.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();
  if (['post', 'put', 'patch', 'delete'].includes(method) && csrfToken) {
    config.headers = config.headers || {};
    config.headers['x-csrf-token'] = csrfToken;
  }
  return config;
});

// Response interceptor: on 401, clear auth and redirect to login.
// We avoid redirect loops by ignoring 401s coming from the /me probe and the
// login endpoint itself (those are handled explicitly by the caller).
client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || '';
    const isAuthProbe =
      url.includes('/api/auth/me') || url.includes('/api/auth/login');

    if (status === 401 && !isAuthProbe) {
      setCsrfToken(null);
      if (typeof onUnauthorized === 'function') {
        onUnauthorized();
      } else if (
        typeof window !== 'undefined' &&
        window.location.pathname !== '/login'
      ) {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);

// Helper: turn an axios error into a human-readable message.
export function errorMessage(error, fallback = 'Something went wrong') {
  return (
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

// ---------------------------------------------------------------------------
// Attachment download URL builder (uses the session cookie via the browser).
// ---------------------------------------------------------------------------
export function attachmentUrl(uid, part, folder) {
  return `${API_URL}/api/messages/${uid}/attachments/${encodeURIComponent(
    part
  )}?folder=${encodeURIComponent(folder)}`;
}

export default client;
