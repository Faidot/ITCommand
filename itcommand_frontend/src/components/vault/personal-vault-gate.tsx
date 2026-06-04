"use client";

import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Loader2, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";

interface PersonalStatus {
  has_personal_key: boolean;
  created_at: string | null;
  shared_with_me_count: number;
}

/**
 * Gates access to credentials privately shared with the current user behind a
 * *personal vault password*. The first time, the user sets it — this generates
 * their end-to-end keypair on the server (private key encrypted under this
 * password). It is separate from the org master password used to open the vault.
 *
 * Renders `children` only once a personal key exists; otherwise shows the setup
 * card. Exposes a "Manage" action for changing/resetting the personal password.
 */
export function PersonalVaultGate({
  children,
  onStatus,
}: {
  children: React.ReactNode;
  onStatus?: (s: PersonalStatus) => void;
}) {
  const [status, setStatus] = useState<PersonalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await api.get("/vault/personal/status/");
      setStatus(res.data);
      onStatus?.(res.data);
    } catch {
      /* the org vault may be locked; layout handles that */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-neutral-500 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking your personal vault key…
      </div>
    );
  }

  if (!status?.has_personal_key) {
    return <SetupCard onDone={fetchStatus} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-2.5 text-sm">
        <span className="inline-flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-medium">
          <ShieldCheck className="w-4 h-4" /> Personal vault key active — only you can open items shared with you.
        </span>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setManageOpen(true)}>
          <Lock className="w-3.5 h-3.5 mr-1" /> Manage
        </Button>
      </div>
      {children}
      <ManageDialog open={manageOpen} onOpenChange={setManageOpen} onChanged={fetchStatus} />
    </div>
  );
}

// ───────────── First-time setup ─────────────

function SetupCard({ onDone }: { onDone: () => void }) {
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (pwd !== confirm) return toast.error("Passwords do not match.");
    setSubmitting(true);
    try {
      await api.post("/vault/personal/setup/", {
        personal_password: pwd,
        confirm_password: confirm,
      });
      toast.success("Personal vault password set. Teammates can now share with you.");
      setPwd("");
      setConfirm("");
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to set personal password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="max-w-lg mx-auto mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="w-5 h-5 text-emerald-600" /> Set your personal vault password
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-neutral-500">
          To receive and open credentials shared privately with you, set a personal password.
          It generates a private key that only you control — not even an administrator can read
          your shared items without it. This is separate from the vault master password.
        </p>
        <div className="space-y-2">
          <label className="text-sm font-medium">Personal password</label>
          <Input type="password" placeholder="At least 12 chars, mixed case, digit, symbol"
            value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Confirm password</label>
          <Input type="password" placeholder="Re-enter" value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
        </div>
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 p-2.5 text-xs text-amber-800 dark:text-amber-300">
          There is no recovery for this password by design. If you forget it, you can reset your
          key (confirming with your account password), but anything shared with you must be re-shared.
        </div>
        <Button className="w-full" onClick={submit} disabled={submitting || !pwd || !confirm}>
          {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
          Set personal password
        </Button>
      </CardContent>
    </Card>
  );
}

// ───────────── Manage (change / reset) ─────────────

function ManageDialog({
  open, onOpenChange, onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"change" | "reset">("change");
  const [current, setCurrent] = useState("");
  const [accountPwd, setAccountPwd] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setCurrent(""); setAccountPwd(""); setNext(""); setConfirm("");
  };

  const submit = async () => {
    if (next !== confirm) return toast.error("New passwords do not match.");
    setSubmitting(true);
    try {
      if (mode === "change") {
        await api.post("/vault/personal/change-password/", {
          current_password: current, new_password: next, confirm_password: confirm,
        });
        toast.success("Personal password changed. Your shares remain intact.");
      } else {
        const res = await api.post("/vault/personal/reset/", {
          account_password: accountPwd, personal_password: next, confirm_password: confirm,
        });
        toast.success(`Personal key reset. ${res.data?.shares_dropped || 0} shared item(s) cleared — ask owners to re-share.`);
      }
      reset();
      onOpenChange(false);
      onChanged();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Action failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage personal vault password</DialogTitle>
          <DialogDescription>
            Change keeps your shares valid. Reset is for a forgotten password and clears items shared with you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button variant={mode === "change" ? "default" : "outline"} size="sm" onClick={() => setMode("change")}>
            <Lock className="w-3.5 h-3.5 mr-1" /> Change
          </Button>
          <Button variant={mode === "reset" ? "default" : "outline"} size="sm" onClick={() => setMode("reset")}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Forgot / reset
          </Button>
        </div>

        <div className="space-y-3 pt-1">
          {mode === "change" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Current personal password</label>
              <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium">Your account password</label>
              <Input type="password" placeholder="Login password — confirms it's you"
                value={accountPwd} onChange={(e) => setAccountPwd(e.target.value)} />
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">New personal password</label>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Confirm new password</label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {mode === "change" ? "Change password" : "Reset key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
