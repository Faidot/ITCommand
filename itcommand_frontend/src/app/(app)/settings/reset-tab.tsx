"use client";

/**
 * Factory reset — the one screen in the app that destroys data it cannot get
 * back.
 *
 * The design goal is not to make it hard to find; it is to make the
 * consequence impossible to miss. So the counts are loaded and shown *before*
 * the button is pressed rather than inside a "are you sure?" dialog: "delete
 * all data" is an abstraction, and "4,812 records across 37 modules, leaving
 * two accounts" is not.
 *
 * Nothing here is reachable for a non-superadmin, and the API enforces the
 * same rule — this component hiding the button is a courtesy, not the control.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

interface RecordCount {
  model: string;
  label: string;
  count: number;
}

interface Preview {
  records: RecordCount[];
  total_records: number;
  users_deleted: number;
  users_kept: { id: number; email: string; name: string }[];
  confirm_phrase: string;
}

export function ResetTab({ role }: { role?: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const isSuper = role === "SUPERADMIN";

  const load = useCallback(() => {
    if (!isSuper) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api.get<Preview>("/settings/reset/preview/")
      .then((r) => setPreview(r.data))
      .catch(() => toast.error("Could not read what a reset would delete."))
      .finally(() => setLoading(false));
  }, [isSuper]);

  useEffect(() => { load(); }, [load]);

  if (!isSuper) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Resetting the app is restricted to a Super Administrator.
        </CardContent>
      </Card>
    );
  }

  const phraseOk =
    preview != null && phrase.trim() === preview.confirm_phrase;

  const run = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await api.post<{ records_deleted: number; users_deleted: number }>(
        "/settings/reset/",
        { confirm: phrase.trim(), password },
      );
      toast.success(
        `Reset complete — ${res.data.records_deleted} records and ` +
        `${res.data.users_deleted} users deleted.`,
      );
      // Every store in the app is now holding records that no longer exist.
      // A full reload is the only honest way back to a consistent screen.
      window.location.href = "/dashboard";
    } catch (reason) {
      const detail = (reason as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      toast.error(detail || "The reset failed. Nothing was deleted.");
      setBusy(false);
    }
  };

  const close = (next: boolean) => {
    if (busy) return;   // never leave a wipe half-observed
    setOpen(next);
    if (!next) { setPhrase(""); setPassword(""); }
  };

  return (
    <Card className="border-red-300 dark:border-red-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
          <ShieldAlert className="h-5 w-5" /> Reset the app
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
          <p className="flex items-start gap-2 font-medium text-red-800 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            This deletes every record in every module. It cannot be undone and
            there is no backup taken first.
          </p>
          <ul className="mt-2 ml-6 list-disc space-y-0.5 text-red-700 dark:text-red-400">
            <li>Every vault credential, integration key and exchange rate</li>
            <li>The vault master password — the vault must be set up again</li>
            <li>The audit log, apart from one entry recording this reset</li>
            <li>Every user except Super Administrators</li>
          </ul>
          <p className="mt-2 text-red-700 dark:text-red-400">
            Roles are restored to their shipped defaults.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">
            Counting what a reset would delete…
          </p>
        ) : preview ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-red-300 text-red-700">
                {preview.total_records.toLocaleString()} records
              </Badge>
              <Badge variant="outline" className="border-red-300 text-red-700">
                {preview.records.length} modules with data
              </Badge>
              <Badge variant="outline" className="border-red-300 text-red-700">
                {preview.users_deleted} user{preview.users_deleted === 1 ? "" : "s"}
              </Badge>
              <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                {preview.users_kept.length} kept
              </Badge>
            </div>

            {preview.records.length > 0 && (
              <ScrollArea className="h-48 rounded-lg border">
                <table className="w-full text-sm">
                  <tbody className="divide-y">
                    {preview.records.map((r) => (
                      <tr key={r.model}>
                        <td className="px-3 py-1.5">{r.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                          {r.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}

            <div className="text-sm">
              <p className="font-medium">These accounts will remain:</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {preview.users_kept.map((u) => (
                  <Badge key={u.id} variant="outline" className="font-normal">
                    {u.email}
                  </Badge>
                ))}
              </div>
            </div>

            <Button variant="destructive" onClick={() => setOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" /> Reset the app
            </Button>
          </>
        ) : null}

        <Dialog open={open} onOpenChange={close}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="text-red-700 dark:text-red-400">
                Delete everything?
              </DialogTitle>
              <DialogDescription>
                {preview?.total_records.toLocaleString()} records and{" "}
                {preview?.users_deleted} user
                {preview?.users_deleted === 1 ? "" : "s"} will be deleted. This
                cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="reset-phrase">
                  Type <span className="font-mono font-semibold">{preview?.confirm_phrase}</span> to confirm
                </Label>
                <Input
                  id="reset-phrase"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reset-password">Your password</Label>
                <Input
                  id="reset-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void run()}
                disabled={busy || !phraseOk || password.length === 0}
              >
                {busy
                  ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  : <Trash2 className="mr-2 h-4 w-4" />}
                Delete everything
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
