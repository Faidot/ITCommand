// IT Command — popup controller.
// Pure UI: it asks the background worker for state/matches/secrets/devices and
// tells the active tab's content script to fill. No tokens are handled here.

const $ = (id) => document.getElementById(id);
const sendBg = (type, payload) =>
  new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));

const views = ["settingsView", "loginView", "mainView"];
function show(view) {
  views.forEach((v) => $(v).classList.toggle("hidden", v !== view));
}

let activeTab = null;
let currentDomain = "";
let appUrl = "";
let vaultUnlocked = false;
let vaultExpiresAt = null;
let timerInterval = null;
let activeTabName = "passwords";
let currentDevice = null;

function hostFromUrl(url) {
  try { return new URL(url).hostname; } catch { return ""; }
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
  $("appUrl").value = state.appUrl || "";
  $("autofillToggle").checked = state.autofill !== false;
  appUrl = (state.appUrl || "").replace(/\/+$/, "");

  $("footer").classList.toggle("hidden", !state.loggedIn);
  $("userLabel").textContent = state.user ? `${state.user.full_name || ""} · ${state.user.email || ""}` : "";

  if (!state.loggedIn) { show("loginView"); return; }

  vaultUnlocked = state.vaultUnlocked;
  vaultExpiresAt = state.vaultExpiresAt;
  show("mainView");
  renderTab();
}

function renderTab() {
  $("passwordsPanel").classList.toggle("hidden", activeTabName !== "passwords");
  $("networkPanel").classList.toggle("hidden", activeTabName !== "network");
  $("tabPasswords").classList.toggle("active", activeTabName === "passwords");
  $("tabNetwork").classList.toggle("active", activeTabName === "network");
  if (activeTabName === "passwords") renderPasswords();
  else loadNetworkDevice();
}

// ── Passwords ───────────────────────────────────────────────────

function renderPasswords() {
  $("unlockBox").classList.toggle("hidden", vaultUnlocked);
  $("matchesBox").classList.toggle("hidden", !vaultUnlocked);
  if (vaultUnlocked) { startTimer(); loadMatches(); }
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
  for (const m of res.matches) list.appendChild(renderItem(m));
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

// ── Network ─────────────────────────────────────────────────────

const STATUS_COLOR = { ONLINE: "#10b981", OFFLINE: "#ef4444", MAINTENANCE: "#eab308", DECOMMISSIONED: "#a3a3a3" };

async function loadNetworkDevice() {
  $("netHostLabel").textContent = currentDomain || "this site";
  $("deviceCard").classList.add("hidden");
  $("noDevice").classList.add("hidden");
  $("netLoading").classList.remove("hidden");

  const res = await sendBg("GET_NETWORK_DEVICE", { host: currentDomain });
  $("netLoading").classList.add("hidden");

  if (!res?.ok) {
    $("noDevice").classList.remove("hidden");
    $("noDevice").innerHTML = res?.error === "no_permission"
      ? "You don't have access to the Network module."
      : "Couldn't reach the server.";
    return;
  }

  currentDevice = res.device;
  if (!currentDevice) {
    $("noDevice").classList.remove("hidden");
    $("noDeviceHost").textContent = currentDomain || "this site";
    $("noDevice").classList.remove("hidden");
    return;
  }
  renderDeviceCard(currentDevice);
}

function renderDeviceCard(d) {
  $("deviceCard").classList.remove("hidden");
  $("devDot").style.background = STATUS_COLOR[d.status] || "#a3a3a3";
  $("devName").textContent = d.device_name;
  $("devMeta").textContent = `${(d.device_type || "").replace("_", " ")} · ${d.status}`;
  $("devCode").textContent = d.device_code || "";

  const rows = [
    ["IP", d.ip_address],
    ["Hostname", d.hostname],
    ["Location", d.location_name],
    ["Uptime", d.uptime_percent != null ? `${d.uptime_percent}%` : null],
    ["Warranty", d.warranty_expiry],
  ].filter(([, v]) => v);
  $("devRows").innerHTML = rows
    .map(([k, v]) => `<div class="drow"><span>${k}</span><b>${v}</b></div>`)
    .join("");

  // Disable the button matching the current status.
  document.querySelectorAll(".status-actions .mini").forEach((b) => {
    b.disabled = b.dataset.status === d.status;
  });
}

async function setDeviceStatus(status) {
  if (!currentDevice) return;
  const res = await sendBg("SET_DEVICE_STATUS", { id: currentDevice.id, status });
  if (!res?.ok) return;
  currentDevice.status = status;
  if (res.device?.uptime_percent != null) currentDevice.uptime_percent = res.device.uptime_percent;
  renderDeviceCard(currentDevice);
}

// ── wire up controls ────────────────────────────────────────────

function setError(id, text) { $(id).textContent = text || ""; }

$("settingsBtn").onclick = () => show("settingsView");
$("closeSettings").onclick = () => refresh();

$("tabPasswords").onclick = () => { activeTabName = "passwords"; renderTab(); };
$("tabNetwork").onclick = () => { activeTabName = "network"; renderTab(); };
$("netRefresh").onclick = () => loadNetworkDevice();

document.querySelectorAll(".status-actions .mini").forEach((b) => {
  b.onclick = () => setDeviceStatus(b.dataset.status);
});

$("openDeviceBtn").onclick = () => {
  if (!currentDevice || !appUrl) return;
  chrome.tabs.create({ url: `${appUrl}/network/devices/${currentDevice.id}` });
};

$("reportToggle").onclick = () => {
  const f = $("reportForm");
  f.classList.toggle("hidden");
  if (!f.classList.contains("hidden") && currentDomain && !$("ticketTitle").value) {
    $("ticketTitle").value = `Issue on ${currentDevice?.device_name || currentDomain}`;
  }
};

$("ticketSubmit").onclick = async () => {
  setError("ticketMsg", "");
  const title = $("ticketTitle").value.trim();
  if (!title) return setError("ticketMsg", "Add a short summary.");
  const desc = $("ticketDesc").value.trim()
    || `Reported from ${currentDomain}${currentDevice ? ` (device ${currentDevice.device_code})` : ""}.`;
  $("ticketSubmit").disabled = true;
  $("ticketSubmit").textContent = "…";
  const res = await sendBg("CREATE_TICKET", { title, description: desc, priority: $("ticketPriority").value });
  $("ticketSubmit").disabled = false;
  $("ticketSubmit").textContent = "Send";
  if (!res?.ok) return setError("ticketMsg", res?.error || "Failed.");
  setError("ticketMsg", `Created ${res.ticket?.ticket_number || "ticket"} ✓`);
  $("ticketTitle").value = "";
  $("ticketDesc").value = "";
  setTimeout(() => { $("reportForm").classList.add("hidden"); setError("ticketMsg", ""); }, 1800);
};

function originPatternFor(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.host}/*`; } catch { return null; }
}

$("saveSettings").onclick = async () => {
  const serverUrl = $("serverUrl").value.trim();
  const pattern = originPatternFor(serverUrl);
  if (pattern) {
    const already = await new Promise((res) =>
      chrome.permissions.contains({ origins: [pattern] }, (r) => res(!!r))
    );
    if (!already) {
      const granted = await new Promise((res) =>
        chrome.permissions.request({ origins: [pattern] }, (r) => res(!!r))
      );
      if (!granted) setError("loginError", "Permission to reach that server was denied.");
    }
  }
  await sendBg("SAVE_SETTINGS", { serverUrl, appUrl: $("appUrl").value.trim(), autofill: $("autofillToggle").checked });
  refresh();
};

$("loginBtn").onclick = async () => {
  setError("loginError", "");
  const res = await sendBg("LOGIN", { email: $("email").value.trim(), password: $("password").value });
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

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (!$("loginView").classList.contains("hidden")) $("loginBtn").click();
  else if (!$("mainView").classList.contains("hidden") && !$("unlockBox").classList.contains("hidden")) $("unlockBtn").click();
});

// ── init ────────────────────────────────────────────────────────

(async () => {
  activeTab = await getActiveTab();
  currentDomain = activeTab ? hostFromUrl(activeTab.url || "") : "";
  refresh();
})();
