import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
const VAULT_TOKEN_KEY = "vault_unlock_token";
const VAULT_EXPIRES_KEY = "vault_unlock_expires";
const VAULT_EXPIRY_EVENT = "it-command:vault-expiry";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

let vaultExpirySync: Promise<void> | null = null;

function persistVaultExpiry(value: unknown) {
  if (typeof window === "undefined" || typeof value !== "string") return false;
  const expiresAt = new Date(value);
  if (!Number.isFinite(expiresAt.getTime())) return false;

  const normalized = expiresAt.toISOString();
  sessionStorage.setItem(VAULT_EXPIRES_KEY, normalized);
  window.dispatchEvent(new CustomEvent(VAULT_EXPIRY_EVENT, {
    detail: { expiresAt: normalized },
  }));
  return true;
}

function responsePath(response: any) {
  const rawUrl = String(response?.config?.url || "");
  try {
    return new URL(rawUrl, API_BASE_URL).pathname;
  } catch {
    return rawUrl;
  }
}

function expiryFromResponse(response: any): unknown {
  const headers = response?.headers || {};
  const headerExpiry = typeof headers.get === "function"
    ? headers.get("x-vault-expires-at") || headers.get("x-vault-expiry")
    : headers["x-vault-expires-at"] || headers["x-vault-expiry"];
  if (headerExpiry) return headerExpiry;
  if (!responsePath(response).includes("/vault/")) return undefined;
  return response?.data?.unlock_expires_at || response?.data?.expires_at;
}

function isProtectedVaultRequest(response: any) {
  if (typeof window === "undefined" || !sessionStorage.getItem(VAULT_TOKEN_KEY)) return false;
  const pathname = responsePath(response);
  if (!pathname.includes("/vault/")) return false;
  return ![
    "/vault/unlock/",
    "/vault/lock/",
    "/vault/master/status/",
    "/vault/master/set/",
  ].some((suffix) => pathname.endsWith(suffix));
}

/**
 * Vault permissions slide the server-side unlock session on each protected
 * request. The status endpoint exposes the resulting expiry, so mirror it into
 * the browser store without requiring every vault endpoint to repeat it.
 */
function syncVaultExpiry() {
  if (typeof window === "undefined" || vaultExpirySync) return;
  const access = localStorage.getItem("access_token");
  const vaultToken = sessionStorage.getItem(VAULT_TOKEN_KEY);
  if (!access || !vaultToken) return;

  vaultExpirySync = axios.get(`${API_BASE_URL}/vault/master/status/`, {
    headers: {
      Authorization: `Bearer ${access}`,
      "X-Vault-Token": vaultToken,
    },
  }).then((response) => {
    if (response.data?.unlocked) {
      persistVaultExpiry(response.data.unlock_expires_at);
    }
  }).catch(() => {
    // The original request already succeeded. A failed reconciliation should
    // not turn that success into a user-visible error.
  }).finally(() => {
    vaultExpirySync = null;
  });
}

// Request interceptor to attach JWT access token (and vault unlock token if present)
api.interceptors.request.use(
  (config) => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("access_token");
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      const vaultToken = sessionStorage.getItem(VAULT_TOKEN_KEY);
      const vaultExp = sessionStorage.getItem(VAULT_EXPIRES_KEY);
      if (vaultToken && vaultExp && new Date(vaultExp).getTime() > Date.now()) {
        config.headers["X-Vault-Token"] = vaultToken;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => {
    const hasExpiry = persistVaultExpiry(expiryFromResponse(response));
    if (!hasExpiry && isProtectedVaultRequest(response)) syncVaultExpiry();
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // If 401 and we haven't retried yet, try refreshing the token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = localStorage.getItem("refresh_token");
        if (refreshToken) {
          const response = await axios.post(
            `${API_BASE_URL}/auth/token/refresh/`,
            { refresh: refreshToken }
          );

          const { access, refresh } = response.data;
          localStorage.setItem("access_token", access);
          // SimpleJWT can rotate refresh tokens. Keep the newest token or the
          // next refresh will retry an already-blacklisted one.
          if (refresh) localStorage.setItem("refresh_token", refresh);

          originalRequest.headers.Authorization = `Bearer ${access}`;
          return api(originalRequest);
        }
      } catch (refreshError) {
        // Refresh failed — clear tokens and redirect to login
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
