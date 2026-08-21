# Mailbox provisioning

Creating a user in IT Command also creates their cPanel mailbox, and the two
share one password. This is the "one credential" model from the mail blueprint
arriving at the moment of account creation rather than being retrofitted.

IT Command owns the mailbox lifecycle — creation, suspension, quotas. The mail
app only reads mail and never touches any of this.

## What happens when you create a user

1. A 20-character password is generated (no `l I 1 O 0` — it gets typed by hand).
2. cPanel `Email::add_pop` creates the mailbox with that password.
3. The user's `auth_source` becomes `MAILBOX`, so Dovecot is their authority.
4. `set_unusable_password()` runs, so **no Django hash exists** for them —
   there is no second way into that account.
5. The password is returned to the browser once and never stored anywhere.

Untick **Create a company mailbox** for contractors and service accounts. They
stay `LOCAL` with a Django password, exactly as before.

## Setting it up

Settings → Integrations → cPanel. You need:

| Field | Where it comes from |
|---|---|
| API token | cPanel → Security → Manage API Tokens → Create |
| cPanel username | The account that owns the mail domain |
| Hostname | e.g. `cpanel.yourhost.com` |
| Mail domain | e.g. `terafort.com` |
| Default quota | MB. `0` is refused — cPanel reads it as unlimited |

The token only needs Email module access. It is encrypted at rest with the
same key the vault uses, like every other integration.

Then confirm it works before you rely on it:

```bash
python manage.py cpanel_check          # read-only; creates nothing
python manage.py cpanel_check --list   # print every mailbox found
```

Or use **Test connection** in Settings → Integrations → cPanel, which does the
same thing and works before you enable the integration.

### Then verify creation actually works

`cpanel_check` proves authentication and `Email::list_pops`. It never touches
`Email::add_pop` or `Email::suspend_login`, which are the calls whose parameter
names differ between cPanel releases.

```bash
python manage.py cpanel_verify --address itcommand-selftest@terafort.com
```

This creates a **real mailbox**, confirms it appears, suspends it, unsuspends
it, and prints the password so you can try it in webmail. It refuses any
address that does not look disposable, and refuses one that already exists, so
it can never touch a real person's mail. The mailbox is left in place unless
you pass `--cleanup`.

If a call fails you get cPanel's own error text, which usually names the
parameter it did not like — enough to correct the `# VERIFY` lines in
`core/cpanel.py`.

## Backfilling existing users

For accounts that predate this. Matches users to mailboxes cPanel **already
has**, by exact email. Creates nothing.

```bash
python manage.py link_mailboxes           # dry run, changes nothing
python manage.py link_mailboxes --apply
```

Linked users authenticate against Dovecot afterwards and their local hash is
made unusable, so **they cannot sign in until `MAIL_AUTH_ENABLED=true`**. To
undo: set `auth_source` back to `LOCAL` and issue a password reset.

## Offboarding

Deactivating a user calls `Email::suspend_login`. IMAP and webmail access stop
immediately; **every message is kept** and it reverses in one call. Nothing is
destroyed.

`delete_mailbox` exists in `core/cpanel.py` but nothing calls it — no view, no
command, no service. It refuses to run without an explicit
`i_understand_this_deletes_mail=True`, and a test asserts nothing routes around
that guard. Deleting a mailbox is permanent and is not something an API request
should be able to cause.

## Failure behaviour

| Situation | What happens |
xw|---|---|
| cPanel not configured | Silent. Local account with a Django password, exactly as before the feature existed. |
| cPanel configured but unreachable | **201 with a warning.** The user is created with a working local password so they are not stranded; the response says no mailbox was made. Not a 500 — hiding it behind an error would have someone create the user twice. |
| Mailbox already exists | Linked, not created. **No password is returned** — we did not set one and do not know the real one. |
| cPanel refuses (quota, bad domain) | Same as unreachable: account created, warning shown. |

A user is never switched to `MAILBOX` unless a mailbox genuinely exists — that
combination would leave someone unable to sign in anywhere.

## Not verified against a real server

I have not been able to test against your cPanel host. cPanel has renamed UAPI
arguments between releases, and these are marked `# VERIFY` in
`core/cpanel.py`:

- `Email::add_pop` — whether `email` takes the local part or the full address
- `skip_update_db=1` — whether it is accepted on your build
- `Email::suspend_login` — whether `email` takes the full address

`cpanel_check` proves authentication and `Email::list_pops` only. **Create one
real user and confirm before a bulk rollout.** If a parameter name is wrong you
will get a `CpanelRejected` with cPanel's own error text, which is usually
enough to correct it.
