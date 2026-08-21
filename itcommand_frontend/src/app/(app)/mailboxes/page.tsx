"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Mail, RefreshCw, Search, ShieldAlert, KeyRound, Ban, RotateCcw,
  Trash2, Plus, Copy, Check, Link2, HardDrive, Clock,
} from "lucide-react";

import api from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Mailbox {
  id: number;
  address: string;
  domain: string;
  user: number | null;
  user_email: string | null;
  user_name: string | null;
  user_is_active: boolean | null;
  is_shared: boolean;
  quota_mb: number | null;
  disk_used_mb: number;
  usage_percent: number | null;
  suspended: boolean;
  status: "ACTIVE" | "SUSPENDED" | "PENDING_DELETION" | "MISSING" | "PURGED";
  exists_in_cpanel: boolean;
  pending_deletion: boolean;
  days_until_purge: number | null;
  deletion_requested_by: string;
  deletion_reason: string;
  last_synced_at: string | null;
}

interface Summary {
  total: number; linked: number; shared: number;
  suspended: number; pending_deletion: number; missing: number;
  last_synced_at: string | null;
}

const STATUS_STYLE: Record<Mailbox["status"], string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  SUSPENDED: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  PENDING_DELETION: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  MISSING: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  PURGED: "bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500",
};
const STATUS_LABEL: Record<Mailbox["status"], string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  PENDING_DELETION: "Deleting",
  MISSING: "Not on server",
  PURGED: "Purged",
};

export default function MailboxesPage() {
  const { user } = useAuthStore();
  const isSuperadmin = user?.role === "SUPERADMIN";

  const [rows, setRows] = useState<Mailbox[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  // dialogs
  const [pwTarget, setPwTarget] = useState<Mailbox | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [delTarget, setDelTarget] = useState<Mailbox | null>(null);
  const [delReason, setDelReason] = useState("");
  const [purgeTarget, setPurgeTarget] = useState<Mailbox | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [shown, setShown] = useState<{ address: string; password: string; note?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([
        api.get("/mailboxes/", { params: { search: search || undefined, status: filter === "all" ? undefined : filter } }),
        api.get("/mailboxes/summary/"),
      ]);
      setRows(list.data.results ?? list.data);
      setSummary(sum.data);
    } catch {
      toast.error("Could not load mailboxes");
    } finally {
      setLoading(false);
    }
  }, [search, filter]);

  useEffect(() => { void load(); }, [load]);

  const act = async (box: Mailbox, path: string, body?: object, ok?: string) => {
    setBusy(box.id);
    try {
      const res = await api.post(`/mailboxes/${box.id}/${path}/`, body ?? {});
      toast.success(ok ?? res.data.message ?? "Done");
      if (res.data.password) {
        setShown({ address: box.address, password: res.data.password, note: res.data.note });
      }
      await load();
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "That did not work");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setBusy(-1);
    try {
      const res = await api.post("/mailboxes/refresh/");
      toast.success(`Synced ${res.data.on_server} mailbox(es) from cPanel`);
      if (res.data.missing?.length) {
        toast.warning(`${res.data.missing.length} row(s) no longer on the server`);
      }
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "Could not reach cPanel");
    } finally {
      setBusy(null);
    }
  };

  const stats = useMemo(() => ([
    { label: "Mailboxes", value: summary?.total ?? 0 },
    { label: "With a user", value: summary?.linked ?? 0 },
    { label: "Shared", value: summary?.shared ?? 0 },
    { label: "Suspended", value: summary?.suspended ?? 0 },
    { label: "Deleting", value: summary?.pending_deletion ?? 0 },
  ]), [summary]);

  return (
    <div className="space-y-6 p-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Mail className="h-6 w-6" /> Mailboxes
          </h1>
          <p className="text-sm text-muted-foreground">
            Every mailbox on the mail server, including shared addresses nobody owns.
            cPanel is the source of truth — this list is a synced copy.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void refresh()} disabled={busy === -1}>
            <RefreshCw className={`mr-2 h-4 w-4 ${busy === -1 ? "animate-spin" : ""}`} />
            Refresh from cPanel
          </Button>
          <Button onClick={() => { setNewAddress(""); setNewOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Shared mailbox
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search addresses…"
                 value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All mailboxes</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="linked">Has a user</SelectItem>
            <SelectItem value="shared">Shared (no user)</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="pending_deletion">Being deleted</SelectItem>
            <SelectItem value="missing">Not on server</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Storage</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                Loading…
              </TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                No mailboxes yet. Press <strong>Refresh from cPanel</strong> to pull the list in.
              </TableCell></TableRow>
            )}
            {rows.map((box) => (
              <TableRow key={box.id} className={box.status === "PURGED" ? "opacity-50" : ""}>
                <TableCell>
                  <div className="font-medium">{box.address}</div>
                  {box.pending_deletion && (
                    <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                      <Clock className="h-3 w-3" />
                      Purges in {box.days_until_purge} day(s) · asked by {box.deletion_requested_by}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {box.user_email ? (
                    <div>
                      <div className="text-sm">{box.user_name}</div>
                      <div className="text-xs text-muted-foreground">{box.user_email}</div>
                    </div>
                  ) : (
                    <Badge variant="outline" className="gap-1">
                      <Link2 className="h-3 w-3" /> Shared
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {box.quota_mb === null ? (
                    <span className="text-muted-foreground">Unlimited</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>{box.disk_used_mb} / {box.quota_mb} MB</span>
                      {box.usage_percent !== null && box.usage_percent > 85 && (
                        <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                          {box.usage_percent}%
                        </Badge>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={STATUS_STYLE[box.status]}>{STATUS_LABEL[box.status]}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="ghost" disabled={busy === box.id}
                            onClick={() => { setPwTarget(box); setPwValue(""); }}>
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    {box.suspended ? (
                      <Button size="sm" variant="ghost" disabled={busy === box.id}
                              onClick={() => void act(box, "restore")}>
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy === box.id}
                              onClick={() => void act(box, "suspend")}>
                        <Ban className="h-4 w-4" />
                      </Button>
                    )}
                    {box.pending_deletion ? (
                      <>
                        <Button size="sm" variant="outline" disabled={busy === box.id}
                                onClick={() => void act(box, "cancel-deletion")}>
                          Cancel
                        </Button>
                        {isSuperadmin && (
                          <Button size="sm" variant="ghost" className="text-destructive"
                                  onClick={() => { setPurgeTarget(box); setPurgeConfirm(""); }}>
                            <ShieldAlert className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    ) : (
                      box.status !== "PURGED" && (
                        <Button size="sm" variant="ghost" className="text-destructive"
                                disabled={busy === box.id}
                                onClick={() => { setDelTarget(box); setDelReason(""); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* SET PASSWORD */}
      <Dialog open={!!pwTarget} onOpenChange={(o) => !o && setPwTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set password — {pwTarget?.address}</DialogTitle>
            <DialogDescription>
              {pwTarget?.user_email
                ? "This is the password for both IT Command and the mailbox. Changing it here changes both."
                : "Mailbox password only — nobody signs in to IT Command with this address."}
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Leave blank to generate a strong one"
                 value={pwValue} onChange={(e) => setPwValue(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            A typed password must be at least 12 characters, mix three character types, and not
            contain the address or the person&apos;s name.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwTarget(null)}>Cancel</Button>
            <Button onClick={async () => {
              const box = pwTarget!;
              const ok = await act(box, "set-password", pwValue ? { password: pwValue } : {});
              if (ok) setPwTarget(null);
            }}>Set password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* REQUEST DELETION */}
      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {delTarget?.address}?</DialogTitle>
            <DialogDescription>
              The mailbox is suspended immediately, but <strong>no mail is destroyed</strong>. It stays
              fully recoverable for 30 days, then is purged. You can cancel at any point.
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="Reason (optional, kept in the audit log)"
                 value={delReason} onChange={(e) => setDelReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={async () => {
              const ok = await act(delTarget!, "request-deletion", { reason: delReason });
              if (ok) setDelTarget(null);
            }}>Mark for deletion</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PURGE */}
      <Dialog open={!!purgeTarget} onOpenChange={(o) => !o && setPurgeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" /> Permanently delete this mailbox
            </DialogTitle>
            <DialogDescription>
              This destroys <strong>{purgeTarget?.address}</strong> and every message in it. There is
              no undo and no backup on our side.
              {purgeTarget && purgeTarget.days_until_purge !== null && purgeTarget.days_until_purge > 0 && (
                <> It still has {purgeTarget.days_until_purge} day(s) of its grace period left,
                so this will be a forced purge.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <Input placeholder={purgeTarget?.address}
                 value={purgeConfirm} onChange={(e) => setPurgeConfirm(e.target.value)} />
          <p className="text-xs text-muted-foreground">Type the full address to confirm.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeTarget(null)}>Cancel</Button>
            <Button variant="destructive"
                    disabled={purgeConfirm.trim().toLowerCase() !== purgeTarget?.address}
                    onClick={async () => {
                      const ok = await act(purgeTarget!, "purge",
                        { confirm_address: purgeConfirm, force: true });
                      if (ok) setPurgeTarget(null);
                    }}>Delete permanently</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* NEW SHARED MAILBOX */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New shared mailbox</DialogTitle>
            <DialogDescription>
              For addresses nobody owns — info@, support@, billing@. No IT Command account is
              created and nobody signs in to the platform with it.
            </DialogDescription>
          </DialogHeader>
          <Input placeholder="info@terafort.com" value={newAddress}
                 onChange={(e) => setNewAddress(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={async () => {
              setBusy(-2);
              try {
                const res = await api.post("/mailboxes/create-standalone/", { address: newAddress });
                toast.success("Mailbox created");
                setShown({ address: res.data.address, password: res.data.password });
                setNewOpen(false);
                await load();
              } catch (err: any) {
                toast.error(err?.response?.data?.detail
                  ?? err?.response?.data?.password?.[0] ?? "Could not create it");
              } finally { setBusy(null); }
            }}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PASSWORD SHOWN ONCE */}
      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password for {shown?.address}</DialogTitle>
            <DialogDescription>
              Shown once. We do not store it and it cannot be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border bg-muted p-3">
            <code className="flex-1 font-mono text-sm">{shown?.password}</code>
            <Button size="icon" variant="ghost" onClick={async () => {
              if (await copyText(shown?.password ?? "")) {
                setCopied(true); setTimeout(() => setCopied(false), 1500);
              }
            }}>
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          {shown?.note && <p className="text-sm text-muted-foreground">{shown.note}</p>}
          <DialogFooter>
            <Button onClick={() => setShown(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
