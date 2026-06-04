// IT Command — popup controller.
// Pure UI: it asks the background worker for state/matches/secrets and tells the
// active tab's content script to fill. No tokens are handled here directly.

const $ = (id) => document.getElementById(id);
const sendBg = (type, payload) =>
  new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));

const views = ["settingsView", "loginView", "unlockView", "matchesView"];
function show(view) {
  views.forEach((v) => $(v).classList.toggle("hidden", v !== view));
}

let activeTab = null;
let currentDomain = "";
let vaultExpiresAt = null;
let timerInterval = null;

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function getActiveTab() {
  return new Promise((resolve) =>
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] || null))
  );
}

// ── render flow based on state ──────────────────────────────────

async function refresh() {
  const state = await sendBg("GET_STATE");
  $("serverUrl").value = state.serverUrl || "";
  $("autofillToggle").checked = state.autofill !== false;

  // Footer visibility
  $("footer").classList.toggle("hidden", !state.loggedIn);
  $("userLabel").textContent = state.user ? `${state.user.full_name || ""} · ${state.user.email || ""}` : "";

  if (!state.loggedIn) {
    show("loginView");
    return;
  }
  if (!state.vaultUnlocked) {
    show("unlockView");
    return;
  }
  vaultExpiresAt = state.vaultExpiresAt;
  startTimer();
  await loadMatches();
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const tick = () => {
    if (!vaultExpiresAt) return;
    const ms = new Date(vaultExpiresAt).getTime() - Date.now();
    if (ms <= 0) {
      clearInterval(timerInterval);
      $("vaultTimer").textContent = "locked";
      refresh();
      return;
    }
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    $("vaultTimer").textContent = `${m}:${String(s).padStart(2, "0")} left`;
  };
  tick();
  timerInterval = setInterval(tick, 1000);
}

async function loadMatches() {
  show("matchesView");
  $("domainLabel").textContent = currentDomain || "this site";
  const list = $("matchesList");
  list.innerHTML = "";
  $("emptyMatches").classList.add("hidden");

  if (!currentDomain) {
    $("emptyMatches").classList.remove("hidden");
    $("emptyMatches").textContent = "Open a website tab to see matches.";
    return;
  }

  const res = await sendBg("GET_MATCHES", { domain: currentDomain });
  if (!res?.ok) {
    if (res?.error === "vault_locked") return refresh();
    $("emptyMatches").classList.remove("hidden");
    $("emptyMatches").textContent = "Couldn't load matches.";
    return;
  }
  if (!res.matches.length) {
    $("emptyMatches").classList.remove("hidden");
    $("emptyMatches").textContent = "No saved credentials for this site.";
    return;
  }

  for (const m of res.matches) {
    list.appendChild(renderItem(m));
  }
}

function renderItem(m) {
  const row = document.createElement("div");
  row.className = "item";

  const meta = document.createElement("div");
  meta.className = "meta";
  const title = document.createElement("div");
  title.className = "it-title";
  title.textContent = m.title;
  const user = document.createElement("div");
  user.className = "it-user";
  user.textContent = m.username;
  meta.append(title, user);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "mini";
  copyBtn.textContent = "Copy";
  copyBtn.onclick = () => copyPassword(m, copyBtn);

  const fillBtn = document.createElement("button");
  fillBtn.className = "mini fill";
  fillBtn.textContent = "Fill";
  fillBtn.onclick = () => fillCredential(m, fillBtn);

  actions.append(copyBtn, fillBtn);
  row.append(meta, actions);
  return row;
}

async function fillCredential(m, btn) {
  btn.disabled = true;
  btn.textContent = "…";
  const r = await sendBg("REVEAL", { id: m.id });
  if (!r?.ok) {
    btn.textContent = "Error";
    setTimeout(() => { btn.textContent = "Fill"; btn.disabled = false; }, 1500);
    return;
  }
  if (activeTab?.id != null) {
    chrome.tabs.sendMessage(
      activeTab.id,
      { type: "FILL", username: m.username, password: r.password },
      () => {
        // Ignore lastError (e.g. no content script on chrome:// pages).
        void chrome.runtime.lastError;
        btn.textContent = "Filled";
        setTimeout(() => { btn.textContent = "Fill"; btn.disabled = false; }, 1200);
        window.close();
      }
    );
  } else {
    btn.disabled = false;
    btn.textContent = "Fill";
  }
}

async function copyPassword(m, btn) {
  const r = await sendBg("REVEAL", { id: m.id });
  if (!r?.ok) return;
  try {
    await navigator.clipboard.writeText(r.password);
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = "Copy"; }, 1200);
  } catch {
    btn.textContent = "Failed";
    setTimeout(() => { btn.textContent = "Copy"; }, 1200);
  }
}

// ── wire up controls ────────────────────────────────────────────

function setError(id, text) {
  $(id).textContent = text || "";
}

$("settingsBtn").onclick = () => show("settingsView");
$("closeSettings").onclick = () => refresh();

function originPatternFor(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

$("saveSettings").onclick = async () => {
  const serverUrl = $("serverUrl").value.trim();

  // Ensure the extension is allowed to call this host. Static dev hosts are
  // already granted; a custom host needs a runtime grant (this click is a user
  // gesture, so chrome.permissions.request is allowed here).
  const pattern = originPatternFor(serverUrl);
  if (pattern) {
    const already = await new Promise((res) =>
      chrome.permissions.contains({ origins: [pattern] }, (r) => res(!!r))
    );
    if (!already) {
      const granted = await new Promise((res) =>
        chrome.permissions.request({ origins: [pattern] }, (r) => res(!!r))
      );
      if (!granted) {
        setError("loginError", "Permission to reach that server was denied.");
        // Still save the URL; the user can retry granting later.
      }
    }
  }

  await sendBg("SAVE_SETTINGS", { serverUrl, autofill: $("autofillToggle").checked });
  refresh();
};

$("loginBtn").onclick = async () => {
  setError("loginError", "");
  const res = await sendBg("LOGIN", {
    email: $("email").value.trim(),
    password: $("password").value,
  });
  if (!res?.ok) return setError("loginError", res?.error || "Login failed.");
  $("password").value = "";
  refresh();
};

$("unlockBtn").onclick = async () => {
  setError("unlockError", "");
  const res = await sendBg("UNLOCK_VAULT", { masterPassword: $("masterPassword").value });
  if (!res?.ok) return setError("unlockError", res?.error || "Unlock failed.");
  $("masterPassword").value = "";
  refresh();
};

$("lockBtn").onclick = async () => { await sendBg("LOCK_VAULT"); refresh(); };
$("logoutBtn").onclick = async () => { await sendBg("LOGOUT"); refresh(); };

// Submit on Enter within each form view.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (!$("loginView").classList.contains("hidden")) $("loginBtn").click();
  else if (!$("unlockView").classList.contains("hidden")) $("unlockBtn").click();
});

// ── init ────────────────────────────────────────────────────────

(async () => {
  activeTab = await getActiveTab();
  currentDomain = activeTab ? hostFromUrl(activeTab.url || "") : "";
  refresh();
})();
