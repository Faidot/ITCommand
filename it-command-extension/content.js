// IT Command — content script.
// Finds login fields on the page, auto-fills a single matching credential on
// load, and fills on demand when the popup asks. It never holds the access or
// vault token — all secrets come from the background worker on request.

(() => {
  const sendBg = (type, payload) =>
    new Promise((resolve) => chrome.runtime.sendMessage({ type, payload }, resolve));

  // ── field detection ─────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  }

  function findPasswordField() {
    const fields = Array.from(document.querySelectorAll('input[type="password"]')).filter(isVisible);
    return fields[0] || null;
  }

  // The username field is the best visible text/email input that appears before
  // the password field (or one flagged via autocomplete/name/id heuristics).
  function findUsernameField(passwordEl) {
    const candidates = Array.from(
      document.querySelectorAll(
        'input[type="text"], input[type="email"], input[autocomplete="username"], input:not([type])'
      )
    ).filter(isVisible);
    if (!candidates.length) return null;

    if (passwordEl) {
      const pwTop = passwordEl.getBoundingClientRect().top;
      const before = candidates.filter((el) => el.getBoundingClientRect().top <= pwTop);
      if (before.length) return before[before.length - 1];
    }
    const hinted = candidates.find((el) =>
      /user|email|login|account/i.test(`${el.name} ${el.id} ${el.autocomplete} ${el.placeholder}`)
    );
    return hinted || candidates[0];
  }

  // ── filling (React/Vue-friendly) ────────────────────────────────

  function setValue(el, value) {
    if (!el) return false;
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus();
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    return el.value === value;
  }

  function fill(username, password) {
    const pw = findPasswordField();
    const user = findUsernameField(pw);
    const filledUsername = !!(user && username && setValue(user, username));
    const filledPassword = !!(pw && password && setValue(pw, password));
    return {
      // A password fill is the meaningful success condition. A nearby text
      // field by itself must not make the popup claim the login was filled.
      ok: filledPassword,
      filledUsername,
      filledPassword,
      error: filledPassword ? null : "no_password_field",
    };
  }

  function flash(ok) {
    const pw = findPasswordField();
    if (!pw) return;
    const prev = pw.style.outline;
    pw.style.outline = ok ? "2px solid #10b981" : "2px solid #ef4444";
    setTimeout(() => { pw.style.outline = prev; }, 1200);
  }

  // ── auto-fill on load (single match only) ───────────────────────

  async function autofillOnLoad() {
    if (!findPasswordField()) return; // no login form here
    const state = await sendBg("GET_STATE");
    if (!state || !state.loggedIn || !state.vaultUnlocked || state.autofill === false) return;

    const host = location.hostname;
    const res = await sendBg("GET_MATCHES", { domain: host });
    if (!res?.ok || !res.matches?.length) return;

    // Only auto-fill when there's exactly one match, to avoid filling the wrong
    // account. Multiple matches are handled from the popup.
    if (res.matches.length !== 1) return;
    const m = res.matches[0];
    const r = await sendBg("REVEAL", { id: m.id });
    if (!r?.ok) return;
    const result = fill(m.username, r.password);
    flash(result.ok);
  }

  // ── popup-driven fill ───────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "FILL") {
      const result = fill(msg.username, msg.password);
      flash(result.ok);
      sendResponse(result);
      return false;
    }
    if (msg?.type === "HAS_LOGIN_FORM") {
      sendResponse({ ok: true, hasForm: !!findPasswordField() });
      return false;
    }
    return false;
  });

  // ── presence handshake (lets the web app know the extension is installed) ──
  // The app and this content script share the page's window message bus even
  // though they run in isolated JS worlds. The app pings; we pong. We also set a
  // DOM marker and broadcast a hello on load so the app can detect us even if it
  // mounted before this script ran.

  const VERSION = (() => {
    try { return chrome.runtime.getManifest().version; } catch { return "0"; }
  })();

  function markPresence() {
    try { document.documentElement.setAttribute("data-it-command", VERSION); } catch { /* noop */ }
  }

  function announce(type) {
    window.postMessage({ source: "it-command-extension", type, version: VERSION }, "*");
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data && data.source === "it-command-web" && data.type === "PING") {
      announce("PONG");
    }
  });

  markPresence();
  announce("HELLO");

  // Run after the page settles; many SPA login forms mount late.
  if (document.readyState === "complete") setTimeout(autofillOnLoad, 600);
  else window.addEventListener("load", () => setTimeout(autofillOnLoad, 600));
})();
