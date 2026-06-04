# IT Command — Browser Extension

Auto-fills passwords from your IT Command vault. When you open a site, if the
vault holds a credential whose saved URL matches the site, the extension can fill
the username and password for you.

> Scope: **passwords only** for now. The architecture (background worker + message
> router) is set up so more modules can be added later without reworking auth.

## How it works

- **Background service worker** (`background.js`) owns every API call and holds the
  JWT access/refresh tokens and the vault session token. Page contexts never see them.
- **Content script** (`content.js`) finds the login fields on a page, auto-fills a
  single matching credential on load (never auto-submits), and fills on demand.
- **Popup** (`popup.html/js`) is the control panel: sign in, unlock the vault, and
  pick which credential to fill for the current tab.

Two unlock layers mirror the web app:
1. **Sign in** with your IT Command account (email + password) → JWT.
2. **Unlock the vault** with the org master password → a time-limited session.

The vault session slides its expiry on use and auto-locks when it runs out, just
like the web app.

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
   (or **Copy** to copy the password to the clipboard).

Toggle **Auto-fill on page load** off in settings if you prefer to fill only from
the popup.

## Matching

A credential matches a site when its saved **URL** host equals the site host, or
one is a subdomain of the other (e.g. a `github.com` credential matches
`www.github.com`). Add a URL to a credential in the vault for it to be offered.

Only credentials you can already reveal in the web app are offered. Items shared
privately with you (end-to-end) are **not** auto-filled here yet — they require
your personal vault password, which this version doesn't prompt for.

## Security notes

- Tokens live in `chrome.storage.local`, scoped to the extension. Signing out or
  locking clears them.
- The content script requests a password only at the moment of filling; it isn't
  cached in the page.
- Calls go through the background worker so the page never holds your tokens.
- No icons are bundled yet — Chrome shows a default icon. Drop PNGs in and add an
  `"icons"` / `action.default_icon` block to the manifest to brand it.

## Firefox

Firefox supports MV3 but differs on the background worker and CORS handling for
extension requests. This build targets Chromium (Chrome/Edge/Brave). A Firefox
port would mainly swap the background declaration and re-test the API calls.
