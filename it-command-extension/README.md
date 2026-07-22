# IT Command — Browser Extension

Brings IT Command into Chromium-based browsers. It can fill matching credentials
from the password vault, look up the current site in Network inventory, update a
matched device's status, and file a helpdesk ticket without leaving the tab.

## How it works

- **Background service worker** (`background.js`) owns every API call and holds the
  JWT access/refresh tokens and the vault session token. Page contexts never see them.
- **Content script** (`content.js`) finds the login fields on a page, auto-fills a
  single matching credential on load (never auto-submits), and fills on demand.
- **Popup** (`popup.html/js`) is the control panel: sign in, unlock the vault, pick
  a credential to fill, inspect a matched network device, update its status, or
  report an issue.

Two unlock layers mirror the web app:
1. **Sign in** with your IT Command account (email + password) → JWT.
2. **Unlock the vault** with the org master password → a time-limited session.

The server slides the vault session on protected use. The extension reconciles
its countdown with the authoritative server expiry and auto-locks when it runs out.

## Install (Chrome / Edge, unpacked)

1. Make sure the backend is running and reachable (default `http://localhost:8000/api`).
2. Open `chrome://extensions` (or `edge://extensions`).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and select this `it-command-extension/` folder.
5. Pin the **IT Command** icon to the toolbar.

### Point it at your server

Click the gear (⚙) in the popup and set the **Server URL** (e.g.
`http://192.168.62.83:8000/api`). The dev hosts `localhost`, `127.0.0.1` and
`192.168.62.83` are pre-authorized in the manifest. If you use a different host,
Chrome will prompt to grant access the first time (the manifest requests optional
permission for all http/https hosts).

## Use

1. Click the toolbar icon → **Sign in** → **Unlock vault**.
2. Browse to a site you have a credential for. With one match and auto-fill on,
   the fields fill automatically (the password box flashes green).
3. For multiple matches, or to choose manually, open the popup and click **Fill**
   (or **Copy** to copy the password to the clipboard). The button only reports
   **Filled** after the content script confirms a password field was updated; it
   reports **No form** or **Failed** when the page cannot be filled.

Toggle **Auto-fill on page load** off in settings if you prefer to fill only from
the popup.

### Network and helpdesk

Open the **Network** tab in the popup. The extension looks up the current hostname
against IT Command's device inventory. For a match you can inspect its basic
details, mark it online/offline/in maintenance (subject to your permissions), or
open its full device page. The issue form creates a normal IT Command helpdesk
ticket and uses the current site/device as context.

## Matching

A credential matches a site when its saved **URL** host equals the site host, or
one is a subdomain of the other (e.g. a `github.com` credential matches
`www.github.com`). Add a URL to a credential in the vault for it to be offered.

Only credentials you can already reveal in the web app are offered. Items shared
privately with you (end-to-end) are **not** auto-filled here yet — they require
your personal vault password, which this version doesn't prompt for.

## Security notes

- Tokens live in `chrome.storage.local`, scoped to the extension. Signing out
  clears authentication and vault tokens; **Lock** clears the vault token only.
- Rotated JWT refresh tokens replace their predecessors, so later background
  refreshes do not reuse a blacklisted token.
- The content script requests a password only at the moment of filling; it isn't
  cached in the page.
- Calls go through the background worker so the page never holds your tokens.
- No icons are bundled yet — Chrome shows a default icon. Drop PNGs in and add an
  `"icons"` / `action.default_icon` block to the manifest to brand it.

## Firefox

Firefox supports MV3 but differs on the background worker and CORS handling for
extension requests. This build targets Chromium (Chrome/Edge/Brave). A Firefox
port would mainly swap the background declaration and re-test the API calls.
