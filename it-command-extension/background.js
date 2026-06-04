// IT Command — background service worker.
// Owns all network calls to the IT Command API, plus JWT + vault-session storage.
// Content scripts and the popup talk to the API only through here, so the vault
// token and access token never live in page contexts.

const DEFAULT_SERVER = "http://localhost:8000/api";

const KEYS = {
  settings: "it_settings", // { serverUrl, autofill }
  auth: "it_auth",         // { access, refresh, user }
  vault: "it_vault",       // { token, expiresAt }
};

// ───────────────────────── storage helpers ─────────────────────────

function getStore(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, (r) => resolve(r[key])));
}
function setStore(key, value) {
  return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, resolve));
}
function delStore(key) {
  return new Promise((resolve) => chrome.storage.local.remove(key, resolve));
}

async function getSettings() {
  const s = (await getStore(KEYS.settings)) || {};
  return {
    serverUrl: (s.serverUrl || DEFAULT_SERVER).replace(/\/+$/, ""),
    autofill: s.autofill !== false, // default ON
  };
}

// ───────────────────────── API fetch ─────────────────────────

async function rawFetch(path, { method = "GET", body, useVault = false } = {}) {
  const { serverUrl } = await getSettings();
  const auth = (await getStore(KEYS.auth)) || {};
  const vault = (await getStore(KEYS.vault)) || {};

  const headers = { "Content-Type": "application/json" };
  if (auth.access) headers["Authorization"] = `Bearer ${auth.access}`;
  if (useVault && vault.token) headers["X-Vault-Token"] = vault.token;

  return fetch(`${serverUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Fetch with one transparent access-token refresh on 401.
async function apiFetch(path, opts = {}) {
  let res = await rawFetch(path, opts);
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await rawFetch(path, opts);
  }
  return res;
}

async function tryRefresh() {
  const auth = (await getStore(KEYS.auth)) || {};
  if (!auth.refresh) return false;
  const { serverUrl } = await getSettings();
  try {
    const res = await fetch(`${serverUrl}/auth/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: auth.refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    await setStore(KEYS.auth, { ...auth, access: data.access });
    return true;
  } catch {
    return false;
  }
}

// ───────────────────────── actions ─────────────────────────

async function getState() {
  const settings = await getSettings();
  const auth = (await getStore(KEYS.auth)) || {};
  const vault = (await getStore(KEYS.vault)) || {};
  const vaultUnlocked = !!vault.token && !!vault.expiresAt && new Date(vault.expiresAt).getTime() > Date.now();
  return {
    serverUrl: settings.serverUrl,
    autofill: settings.autofill,
    loggedIn: !!auth.access,
    user: auth.user || null,
    vaultUnlocked,
    vaultExpiresAt: vault.expiresAt || null,
  };
}

async function login({ email, password }) {
  const { serverUrl } = await getSettings();
  const res = await fetch(`${serverUrl}/auth/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.detail || "Login failed." };
  await setStore(KEYS.auth, { access: data.access, refresh: data.refresh, user: data.user });
  return { ok: true, user: data.user };
}

async function logout() {
  await delStore(KEYS.auth);
  await delStore(KEYS.vault);
  return { ok: true };
}

async function unlockVault({ masterPassword }) {
  const res = await apiFetch("/vault/unlock/", {
    method: "POST",
    body: { master_password: masterPassword },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.detail || "Unlock failed." };
  await setStore(KEYS.vault, { token: data.token, expiresAt: data.expires_at });
  return { ok: true, expiresAt: data.expires_at };
}

async function lockVault() {
  try {
    await apiFetch("/vault/lock/", { method: "POST", useVault: true });
  } catch {
    /* best effort */
  }
  await delStore(KEYS.vault);
  return { ok: true };
}

async function getMatches({ domain }) {
  const state = await getState();
  if (!state.loggedIn) return { ok: false, error: "not_logged_in", matches: [] };
  if (!state.vaultUnlocked) return { ok: false, error: "vault_locked", matches: [] };
  const res = await apiFetch(`/vault/credentials/match/?domain=${encodeURIComponent(domain)}`, { useVault: true });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "vault_locked", matches: [] };
  }
  const data = await res.json().catch(() => []);
  return { ok: true, matches: Array.isArray(data) ? data : [] };
}

async function reveal({ id }) {
  const res = await apiFetch(`/vault/credentials/${id}/reveal/`, { useVault: true });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.detail || "Reveal failed." };
  return { ok: true, password: data.password };
}

async function saveSettings({ serverUrl, autofill }) {
  const current = await getSettings();
  await setStore(KEYS.settings, {
    serverUrl: serverUrl !== undefined ? serverUrl : current.serverUrl,
    autofill: autofill !== undefined ? autofill : current.autofill,
  });
  return { ok: true };
}

// ───────────────────────── message router ─────────────────────────

const HANDLERS = {
  GET_STATE: getState,
  LOGIN: login,
  LOGOUT: logout,
  UNLOCK_VAULT: unlockVault,
  LOCK_VAULT: lockVault,
  GET_MATCHES: getMatches,
  REVEAL: reveal,
  SAVE_SETTINGS: saveSettings,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler) {
    sendResponse({ ok: false, error: "unknown_action" });
    return false;
  }
  Promise.resolve(handler(msg.payload || {}))
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true; // keep the message channel open for the async response
});
