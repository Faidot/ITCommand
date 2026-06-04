"use client";

import { useEffect, useState } from "react";
import { X, Puzzle, KeyRound } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useExtensionInstalled } from "@/hooks/useExtensionInstalled";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ExtensionInstallGuide } from "./install-guide";

const DISMISS_KEY = "it_ext_prompt_dismissed";
const VAULT_ROLES = ["MANAGER", "ADMIN", "SUPERADMIN"];

/**
 * Floating bottom-corner nudge to install the IT Command browser extension.
 * Shown only when: the user can use the vault, the extension is NOT detected,
 * and the user hasn't dismissed it. Disappears the moment the extension is
 * detected (no popup once installed).
 */
export function ExtensionInstallPrompt() {
  const { user } = useAuthStore();
  const { state } = useExtensionInstalled();
  const [dismissed, setDismissed] = useState(true); // assume dismissed until we read storage
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
  }, []);

  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const canUseVault = !!user?.role && VAULT_ROLES.includes(user.role);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* noop */ }
  };

  // Render nothing while checking, when installed, dismissed, ineligible, or mobile.
  if (state !== "not-installed" || dismissed || !canUseVault || isMobile) return null;

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 w-[330px] max-w-[calc(100vw-2rem)] rounded-xl border bg-background shadow-lg animate-in slide-in-from-bottom-4 fade-in">
        <div className="p-4">
          <div className="flex items-start gap-3">
            <div className="grid place-items-center w-9 h-9 rounded-lg bg-emerald-600 text-white shrink-0">
              <Puzzle className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-sm">Install the IT Command extension</div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Auto-fill your vault passwords on any site, right from the browser.
              </p>
            </div>
            <button
              onClick={dismiss}
              className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 p-1"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button size="sm" className="flex-1" onClick={() => setOpen(true)}>
              <KeyRound className="w-3.5 h-3.5 mr-1.5" /> Add to browser
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Puzzle className="w-5 h-5 text-emerald-600" /> Add IT Command to your browser
            </DialogTitle>
            <DialogDescription>Password auto-fill from your vault. More modules coming.</DialogDescription>
          </DialogHeader>
          <ExtensionInstallGuide />
        </DialogContent>
      </Dialog>
    </>
  );
}
