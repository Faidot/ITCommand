"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";

/**
 * Signing in at the mail app directly, rather than arriving from IT Command.
 *
 * Same two steps and the same enrolment as IT Command's login, because both
 * doors call the same code on the server. Somebody who enrolled there is
 * already enrolled here — there is one mailbox, one password, one authenticator.
 */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api";

type Challenge = {
  ticket: string;
  enrolling: boolean;
  secret?: string;
  uri?: string;
};

export default function MailLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body: object) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, status, data } = await call("/auth/login", { email, password });
    setBusy(false);

    if (status === 404) {
      // Direct login is switched off on this deployment: the handoff from
      // IT Command is the only way in. Say that rather than "not found".
      setError("Open your mailbox from IT Command — this app does not take a "
               + "direct sign-in.");
      return;
    }
    if (!ok) {
      setError(data.detail ?? "Sign-in failed.");
      return;
    }
    setChallenge({
      ticket: data.ticket,
      enrolling: Boolean(data.enrolment_required),
      secret: data.totp_secret,
      uri: data.otpauth_uri,
    });
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await call("/auth/mfa", { ticket: challenge.ticket, code });
    setBusy(false);

    if (!ok) {
      setError(data.detail ?? "That code is not right.");
      setCode("");
      return;
    }
    if (data.recovery_codes) {
      setRecovery(data.recovery_codes);
      return;
    }
    router.push("/inbox");
  }

  if (recovery) {
    return (
      <Shell title="Save your recovery codes">
        <p className="mb-4 text-sm text-muted-foreground">
          Each one signs you in once if you lose your phone. Shown now and never
          again — we keep only hashes.
        </p>
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 font-mono text-sm">
          {recovery.map((c) => <span key={c}>{c}</span>)}
        </div>
        <button onClick={() => router.push("/inbox")}
                className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">
          I have saved them
        </button>
      </Shell>
    );
  }

  if (challenge) {
    return (
      <Shell title={challenge.enrolling ? "Set up your authenticator" : "Enter your code"}>
        {challenge.enrolling ? (
          <>
            <p className="mb-3 text-sm text-muted-foreground">
              Your password was accepted. One more step, once: scan this with Google
              Authenticator, Microsoft Authenticator, Authy or 1Password.
            </p>
            {challenge.uri && (
              <div className="mb-3 flex justify-center rounded-lg bg-white p-4">
                <QRCode value={challenge.uri} size={168} />
              </div>
            )}
            <details className="mb-4">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Can&apos;t scan? Type this instead
              </summary>
              <div className="mt-2 break-all rounded-lg bg-muted p-3 text-center font-mono text-xs">
                {challenge.secret}
              </div>
            </details>
          </>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">
            Enter the six-digit code from your authenticator, or a recovery code.
          </p>
        )}
        <form onSubmit={submitCode}>
          <input autoFocus value={code} onChange={(e) => setCode(e.target.value)}
                 placeholder="123456"
                 className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-widest outline-none focus:border-primary" />
          {error && <p className="mb-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button type="submit" disabled={busy || code.trim().length < 6}
                  className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60">
            {busy ? "Checking…" : "Sign in"}
          </button>
        </form>
        <button onClick={() => { setChallenge(null); setCode(""); setError(null); }}
                className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground">
          ← Start again
        </button>
      </Shell>
    );
  }

  return (
    <Shell title="Terafort Mail">
      <p className="mb-4 text-sm text-muted-foreground">
        Sign in with your mailbox address and its password — the same one that opens
        IT Command. There is only one.
      </p>
      <form onSubmit={submitPassword} className="space-y-3">
        <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
               placeholder="you@terafort.org" autoComplete="username"
               className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
               placeholder="Mailbox password" autoComplete="current-password"
               className="w-full rounded-lg border border-border bg-background px-3 py-2 outline-none focus:border-primary" />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button type="submit" disabled={busy || !email || !password}
                className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60">
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
      <a href={process.env.NEXT_PUBLIC_ITC_URL ?? "https://itcommand.com"}
         className="mt-4 block text-center text-xs text-muted-foreground hover:text-foreground">
        Or open your mailbox from IT Command
      </a>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg">
        <h1 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground">✉</span>
          {title}
        </h1>
        {children}
      </div>
    </main>
  );
}
