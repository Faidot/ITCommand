"use client";

import { useEffect, useState } from "react";
import { Lock, ShieldAlert, ShieldCheck, KeyRound, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import api from "@/lib/api";
import { useVaultStore } from "@/store/vaultStore";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface MasterStatus {
  is_set: boolean;
  set_by: string | null;
  set_at: string | null;
  rotation_count: number;
  session_ttl_minutes: number;
  unlocked: boolean;
  unlock_expires_at: string | null;
}

export function VaultLockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { user } = useAuthStore();
  const setUnlock = useVaultStore((s) => s.setUnlock);

  const [status, setStatus] = useState<MasterStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isSuperadmin = user?.role === "SUPERADMIN";

  const loadStatus = async () => {
    try {
      setLoadingStatus(true);
      const res = await api.get("/vault/master/status/");
      setStatus(res.data);
    } catch {
      toast.error("Failed to load vault status");
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    try {
      const res = await api.post("/vault/unlock/", { master_password: password });
      setUnlock(res.data.token, res.data.expires_at);
      toast.success("Vault unlocked");
      setPassword("");
      onUnlocked();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Incorrect master password");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingStatus) {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <div className="text-neutral-500 text-sm">Checking vault status…</div>
      </div>
    );
  }

  // Master password not yet set
  if (status && !status.is_set) {
    return (
      <div className="flex items-center justify-center min-h-[70vh] p-4">
        <Card className="w-full max-w-md border-amber-200 bg-amber-50/40 dark:bg-amber-950/20">
          <CardHeader className="text-center">
            <div className="mx-auto p-3 rounded-full bg-amber-100 dark:bg-amber-900/40 w-fit mb-2">
              <ShieldAlert className="w-6 h-6 text-amber-700 dark:text-amber-300" />
            </div>
            <CardTitle>Vault is not configured</CardTitle>
            <CardDescription>
              A Super Administrator must set the Vault master password before this section can be used.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-3">
            {isSuperadmin ? (
              <Link href="/settings?tab=vault">
                <Button>
                  <KeyRound className="w-4 h-4 mr-2" /> Configure now in Master Settings
                </Button>
              </Link>
            ) : (
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                Please contact your Super Administrator to enable the Vault.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-[70vh] p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto p-3 rounded-full bg-emerald-100 dark:bg-emerald-900/40 w-fit mb-2">
            <Lock className="w-6 h-6 text-emerald-700 dark:text-emerald-300" />
          </div>
          <CardTitle>Unlock the Vault</CardTitle>
          <CardDescription>
            This section is protected by a separate master password set by the Super Administrator.
            Your session will auto-lock after {status?.session_ttl_minutes ?? 30} minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={unlock} className="space-y-3">
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Vault master password"
                autoFocus
                disabled={submitting}
                className="pr-10"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !password}>
              <ShieldCheck className="w-4 h-4 mr-2" />
              {submitting ? "Unlocking…" : "Unlock Vault"}
            </Button>
            {status?.set_by && (
              <p className="text-[11px] text-neutral-500 text-center">
                Last set by {status.set_by}
                {status.set_at ? ` on ${new Date(status.set_at).toLocaleDateString()}` : ""}
                {" "}· Rotations: {status.rotation_count}
              </p>
            )}
            {isSuperadmin && (
              <Link href="/settings?tab=vault" className="block">
                <Button type="button" variant="outline" size="sm" className="w-full">
                  <KeyRound className="w-3.5 h-3.5 mr-2" /> Rotate master password
                </Button>
              </Link>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
