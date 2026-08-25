"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Mail, RefreshCw, ShieldCheck, Server, Send, Globe, Users,
  Loader2, Plus, X, LogOut,
} from "lucide-react";

import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

/**
 * TeraMailer's admin panel, hosted here.
 *
 * It used to live on its own port behind its own admin password. Bringing it
 * in means one set of roles guards it — superadmin only — and every change
 * writes an IT Command audit row naming who made it, which TeraMailer's own
 * panel could never do because it only ever knew that "admin" logged in.
 */

interface Config {
  app?: { name?: string; domain?: string; allowedDomains?: string[]; maxUploadMb?: number };
  imap?: { host?: string; port?: number; tls?: boolean };
  smtp?: { host?: string; port?: number; secure?: boolean; requireTLS?: boolean };
  security?: { sessionTTL?: number; maxLoginAttempts?: number; lockoutDuration?: number };
}

interface Dashboard {
  activeSessions?: number;
  imapConnections?: number;
  imapStatus?: { ok?: boolean };
  smtpStatus?: { ok?: boolean };
}

type Section = "domain" | "imap" | "smtp" | "security";

interface SessionRow {
  id?: string; sessionId?: string; email?: string; ip?: string; loginTime?: number;
}

export function MailsTab({ role }: { role?: string }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [setupHint, setSetupHint] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Config>({});
  const [newDomain, setNewDomain] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/mail-settings/");
      setConnected(data.configured);
      if (!data.configured) {
        setSetupHint(data.detail ?? "");
        return;
      }
      setDraft(data.config ?? {});
      setDashboard(data.dashboard ?? null);
      // A stats failure must not hide the settings somebody came here to change.
      if (data.dashboard_error) toast.warning(`Live status unavailable: ${data.dashboard_error}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "Could not reach the mail service");
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (role !== "SUPERADMIN") {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Only a Superadmin can change mail server settings. Mailboxes themselves —
        creating them, passwords, storage — are under <strong>Mailboxes</strong> and
        are open to Admins too.
      </Card>
    );
  }

  if (loading) return <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>;

  if (connected === false) {
    return (
      <Card className="p-6">
        <h3 className="mb-2 flex items-center gap-2 font-semibold">
          <Mail className="h-4 w-4" /> Mail service not connected
        </h3>
        <p className="mb-3 text-sm text-muted-foreground">{setupHint}</p>
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{`# itcommand_backend/.env
TERAMAILER_URL=http://127.0.0.1:5000
TERAMAILER_PUBLIC_URL=http://localhost:5000
TERAMAILER_SHARED_SECRET=<a long random string>

# mail/backend/.env  — the SAME string
ITC_SHARED_SECRET=<the same long random string>`}</pre>
        <Button className="mt-3" variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Check again
        </Button>
      </Card>
    );
  }

  const save = async (section: Section, values: object) => {
    setBusy(section);
    try {
      await api.post("/mail-settings/", { section, values });
      toast.success("Saved");
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "That change was refused");
    } finally {
      setBusy(null);
    }
  };

  const test = async (target: "imap" | "smtp") => {
    setBusy(`test-${target}`);
    try {
      const { data } = await api.post("/mail-settings/test/", { target });
      if (data.ok) toast.success(data.message);
      else toast.error(data.message);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "The test could not run");
    } finally {
      setBusy(null);
    }
  };

  const domains = draft.app?.allowedDomains ?? [];
  const setApp = (patch: object) =>
    setDraft((d) => ({ ...d, app: { ...(d.app ?? {}), ...patch } }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Signed in now" value={dashboard?.activeSessions ?? "—"} />
        <Stat label="IMAP connections" value={dashboard?.imapConnections ?? "—"} />
        <Stat label="IMAP" value={dashboard?.imapStatus?.ok ? "Reachable" : "Down"}
              tone={dashboard?.imapStatus?.ok ? "ok" : "bad"} />
        <Stat label="SMTP" value={dashboard?.smtpStatus?.ok ? "Reachable" : "Down"}
              tone={dashboard?.smtpStatus?.ok ? "ok" : "bad"} />
      </div>

      <Panel icon={<Globe className="h-4 w-4" />} title="Who may sign in"
             note="Only addresses on these domains can open the webmail. Everyone else is refused, whatever their mailbox password is.">
        <div className="mb-3 flex flex-wrap gap-2">
          {domains.length === 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              No domains listed — <strong>every</strong> mailbox the server accepts can sign in.
            </p>
          )}
          {domains.map((d) => (
            <Badge key={d} variant="outline" className="gap-1 py-1">
              {d}
              <button onClick={() => setApp({ allowedDomains: domains.filter((x) => x !== d) })}
                      className="ml-1 text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder="terafort.org" value={newDomain}
                 onChange={(e) => setNewDomain(e.target.value)} />
          <Button variant="outline" disabled={!newDomain.trim()}
                  onClick={() => {
                    setApp({ allowedDomains: [...domains, newDomain.trim().toLowerCase()] });
                    setNewDomain("");
                  }}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <SaveRow busy={busy === "domain"}
                 onSave={() => save("domain", {
                   name: draft.app?.name, domain: draft.app?.domain,
                   allowedDomains: domains, maxUploadMb: draft.app?.maxUploadMb,
                 })} />
      </Panel>

      <Panel icon={<Server className="h-4 w-4" />} title="Incoming mail (IMAP)"
             note="Where the webmail reads mail from. cPanel's SSL/TLS settings: port 993 with TLS on.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Server" value={draft.imap?.host ?? ""}
                 onChange={(v) => setDraft((d) => ({ ...d, imap: { ...d.imap, host: v } }))} />
          <Field label="Port" value={String(draft.imap?.port ?? "")} type="number"
                 onChange={(v) => setDraft((d) => ({ ...d, imap: { ...d.imap, port: Number(v) } }))} />
          <Toggle label="Use TLS" checked={draft.imap?.tls ?? true}
                  onChange={(v) => setDraft((d) => ({ ...d, imap: { ...d.imap, tls: v } }))} />
        </div>
        <SaveRow busy={busy === "imap"} testing={busy === "test-imap"}
                 onTest={() => test("imap")}
                 onSave={() => save("imap", {
                   host: draft.imap?.host, port: draft.imap?.port, tls: draft.imap?.tls,
                 })} />
      </Panel>

      <Panel icon={<Send className="h-4 w-4" />} title="Outgoing mail (SMTP)"
             note="Port 465 is implicit TLS, so Secure must be on. Port 587 is STARTTLS and needs it off — getting this pair the wrong way round is the usual cause of sending failing.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Server" value={draft.smtp?.host ?? ""}
                 onChange={(v) => setDraft((d) => ({ ...d, smtp: { ...d.smtp, host: v } }))} />
          <Field label="Port" value={String(draft.smtp?.port ?? "")} type="number"
                 onChange={(v) => setDraft((d) => ({ ...d, smtp: { ...d.smtp, port: Number(v) } }))} />
          <Toggle label="Secure (implicit TLS)" checked={draft.smtp?.secure ?? true}
                  onChange={(v) => setDraft((d) => ({ ...d, smtp: { ...d.smtp, secure: v } }))} />
        </div>
        {draft.smtp?.port === 587 && draft.smtp?.secure && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Port 587 with Secure on will not connect. Turn Secure off for 587, or use 465.
          </p>
        )}
        {draft.smtp?.port === 465 && draft.smtp?.secure === false && (
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
            Port 465 needs Secure on — it is TLS from the first byte.
          </p>
        )}
        <SaveRow busy={busy === "smtp"} testing={busy === "test-smtp"}
                 onTest={() => test("smtp")}
                 onSave={() => save("smtp", {
                   host: draft.smtp?.host, port: draft.smtp?.port, secure: draft.smtp?.secure,
                 })} />
      </Panel>

      <Panel icon={<ShieldCheck className="h-4 w-4" />} title="Sign-in security"
             note="How long a webmail session lasts, and how hard it is to guess a password.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Session length (seconds)" type="number"
                 value={String(draft.security?.sessionTTL ?? "")}
                 onChange={(v) => setDraft((d) => ({ ...d, security: { ...d.security, sessionTTL: Number(v) } }))} />
          <Field label="Attempts before lockout" type="number"
                 value={String(draft.security?.maxLoginAttempts ?? "")}
                 onChange={(v) => setDraft((d) => ({ ...d, security: { ...d.security, maxLoginAttempts: Number(v) } }))} />
          <Field label="Lockout (seconds)" type="number"
                 value={String(draft.security?.lockoutDuration ?? "")}
                 onChange={(v) => setDraft((d) => ({ ...d, security: { ...d.security, lockoutDuration: Number(v) } }))} />
        </div>
        <SaveRow busy={busy === "security"}
                 onSave={() => save("security", {
                   sessionTTL: draft.security?.sessionTTL,
                   maxLoginAttempts: draft.security?.maxLoginAttempts,
                   lockoutDuration: draft.security?.lockoutDuration,
                 })} />
      </Panel>

      <SessionsPanel />
    </div>
  );
}

function SessionsPanel() {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const { data } = await api.get("/mail-settings/sessions/");
      setRows(Array.isArray(data) ? data : data.sessions ?? []);
      setOpen(true);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "Could not read the sessions");
    } finally { setBusy(false); }
  };

  return (
    <Panel icon={<Users className="h-4 w-4" />} title="Who is signed in"
           note="Live webmail sessions. Ending one signs that person out immediately; their mail is untouched.">
      {!open ? (
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Show sessions
        </Button>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody is signed in to the webmail.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {rows.map((s) => (
            <div key={s.id ?? s.sessionId} className="flex items-center gap-3 p-3 text-sm">
              <span className="flex-1">
                <span className="block font-medium">{s.email}</span>
                <span className="block text-xs text-muted-foreground">
                  {s.ip} · since {s.loginTime ? new Date(s.loginTime).toLocaleString() : "—"}
                </span>
              </span>
              <Button size="sm" variant="ghost" className="text-destructive"
                      onClick={async () => {
                        try {
                          await api.delete(
                            `/mail-settings/sessions/?id=${encodeURIComponent(String(s.id ?? s.sessionId))}`);
                          toast.success("Signed out");
                          void load();
                        } catch { toast.error("Could not end that session"); }
                      }}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Panel({ icon, title, note, children }: {
  icon: React.ReactNode; title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <h3 className="flex items-center gap-2 font-semibold">{icon} {title}</h3>
      {note && <p className="mb-4 mt-1 text-sm text-muted-foreground">{note}</p>}
      {children}
    </Card>
  );
}

function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium">{label}</label>
      <div className="flex h-10 items-center">
        <Switch checked={checked} onCheckedChange={onChange} />
      </div>
    </div>
  );
}

function SaveRow({ busy, onSave, onTest, testing }: {
  busy?: boolean; onSave: () => void; onTest?: () => void; testing?: boolean;
}) {
  return (
    <div className="mt-4 flex gap-2">
      <Button disabled={busy} onClick={onSave}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
      </Button>
      {onTest && (
        <Button variant="outline" disabled={testing} onClick={onTest}>
          {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                   : <ShieldCheck className="mr-2 h-4 w-4" />}
          Test connection
        </Button>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: {
  label: string; value: React.ReactNode; tone?: "ok" | "bad";
}) {
  const colour = tone === "ok" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "bad" ? "text-red-600 dark:text-red-400" : "";
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${colour}`}>{value}</p>
    </Card>
  );
}
