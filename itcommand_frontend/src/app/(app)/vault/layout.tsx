"use client";

import { useEffect, useState, useCallback } from "react";
import { Lock, Clock } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useVaultStore } from "@/store/vaultStore";
import { useAuthStore } from "@/store/authStore";
import { VaultLockScreen } from "@/components/vault-lock-screen";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";

export default function VaultLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const { expiresAt, loadFromStorage, clear, isUnlocked, setExpiry } = useVaultStore();
  const [, force] = useState(0);
  const [bootstrapped, setBootstrapped] = useState(false);

  // Load token from sessionStorage on mount
  useEffect(() => {
    loadFromStorage();
    setBootstrapped(true);
  }, [loadFromStorage]);

  // Protected vault API calls slide the server session. The API client mirrors
  // the authoritative expiry and broadcasts it so this countdown stays current.
  useEffect(() => {
    const onExpiry = (event: Event) => {
      const expiresAt = (event as CustomEvent<{ expiresAt?: string }>).detail?.expiresAt;
      if (expiresAt) setExpiry(expiresAt);
    };
    window.addEventListener("it-command:vault-expiry", onExpiry);
    return () => window.removeEventListener("it-command:vault-expiry", onExpiry);
  }, [setExpiry]);

  // Refresh ticker so the countdown updates and auto-locks at zero
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const lockNow = useCallback(async () => {
    try {
      await api.post("/vault/lock/", {});
    } catch {
      /* silent */
    }
    clear();
    toast.message("Vault locked");
  }, [clear]);

  // Auto-lock when time runs out
  useEffect(() => {
    if (!expiresAt) return;
    const ms = expiresAt.getTime() - Date.now();
    if (ms <= 0) {
      clear();
      return;
    }
    const id = setTimeout(() => {
      clear();
      toast.message("Vault auto-locked (session expired)");
    }, ms);
    return () => clearTimeout(id);
  }, [expiresAt, clear]);

  if (user && !can(user, "vault", "view")) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="bg-red-50 text-red-900 p-4 rounded-xl border border-red-200">
          <h2 className="font-bold mb-2">Access Denied</h2>
          <p>You don&apos;t have permission to view the Vault.</p>
        </div>
      </div>
    );
  }

  if (!bootstrapped) {
    return <div className="p-8 text-center text-neutral-500 text-sm">Loading…</div>;
  }

  if (!isUnlocked()) {
    return <VaultLockScreen onUnlocked={() => force((n) => n + 1)} />;
  }

  // Compute remaining time for the badge
  const remainingMs = expiresAt ? expiresAt.getTime() - Date.now() : 0;
  const mm = Math.max(0, Math.floor(remainingMs / 60000));
  const ss = Math.max(0, Math.floor((remainingMs % 60000) / 1000));

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 flex items-center justify-end gap-2 text-xs text-neutral-500">
        <Clock className="w-3.5 h-3.5" />
        <span className="font-mono">{mm}:{ss.toString().padStart(2, "0")} left</span>
        <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={lockNow}>
          <Lock className="w-3 h-3 mr-1" /> Lock now
        </Button>
      </div>
      {children}
    </div>
  );
}
