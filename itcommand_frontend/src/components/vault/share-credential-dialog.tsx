"use client";

import { useEffect, useState } from "react";
import { Loader2, Share2, UserCheck, UserX, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";

interface ShareableUser {
  id: number;
  name: string;
  role: string;
  has_personal_key: boolean;
}

interface ExistingShare {
  recipient_id: number;
  name: string;
  shared_at: string;
  last_revealed_at: string | null;
  reveal_count: number;
}

/**
 * Owner-facing dialog to privately (end-to-end) share a credential with specific
 * users. Sharing seals the secret to each recipient's public key — only they,
 * with their personal vault password, can open it. Recipients must have set up a
 * personal vault password first; those who haven't are shown as unavailable.
 */
export function ShareCredentialDialog({
  credentialId,
  credentialTitle,
  open,
  onOpenChange,
  onShared,
}: {
  credentialId: number | null;
  credentialTitle: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onShared?: () => void;
}) {
  const [users, setUsers] = useState<ShareableUser[]>([]);
  const [existing, setExisting] = useState<ExistingShare[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!credentialId) return;
    setLoading(true);
    try {
      const [u, s] = await Promise.all([
        api.get("/vault/credentials/shareable_users/"),
        api.get(`/vault/credentials/${credentialId}/shares/`),
      ]);
      setUsers(u.data || []);
      setExisting(s.data || []);
      setSelected(new Set());
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to load sharing info.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, credentialId]);

  const sharedIds = new Set(existing.map((e) => e.recipient_id));
  const candidates = users.filter((u) => !sharedIds.has(u.id));

  const toggle = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (checked) n.add(id); else n.delete(id);
      return n;
    });
  };

  const doShare = async () => {
    if (!credentialId || selected.size === 0) return;
    setSubmitting(true);
    try {
      const res = await api.post(`/vault/credentials/${credentialId}/share/`, {
        recipient_ids: Array.from(selected),
      });
      const sharedCount = res.data?.shared?.length || 0;
      const skipped = res.data?.skipped || [];
      if (sharedCount) toast.success(`Shared with ${sharedCount} user${sharedCount > 1 ? "s" : ""}.`);
      skipped.forEach((s: any) => toast.warning(`${s.name || "User"}: ${s.reason}`));
      await load();
      onShared?.();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Sharing failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async (recipientId: number) => {
    if (!credentialId) return;
    try {
      await api.post(`/vault/credentials/${credentialId}/unshare/`, {
        recipient_ids: [recipientId],
      });
      toast.success("Access revoked.");
      await load();
      onShared?.();
    } catch {
      toast.error("Failed to revoke access.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-blue-600" /> Share privately
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium">{credentialTitle}</span> — end-to-end encrypted to each
            recipient. Only they can open it with their personal vault password.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-neutral-500 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Currently shared with */}
            {existing.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Shared with</p>
                <div className="space-y-1.5">
                  {existing.map((e) => (
                    <div key={e.recipient_id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <span className="inline-flex items-center gap-1.5 font-medium">
                          <UserCheck className="w-3.5 h-3.5 text-emerald-600" /> {e.name}
                        </span>
                        <p className="text-[11px] text-neutral-400">
                          {e.reveal_count > 0 ? `Opened ${e.reveal_count}×` : "Not opened yet"}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                        onClick={() => revoke(e.recipient_id)} title="Revoke access">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add recipients */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Add people</p>
              {candidates.length === 0 ? (
                <p className="text-sm text-neutral-400 py-2">No other vault users available to share with.</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {candidates.map((u) => (
                    <label
                      key={u.id}
                      className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                        u.has_personal_key ? "cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900" : "opacity-60"
                      }`}
                    >
                      <Checkbox
                        checked={selected.has(u.id)}
                        disabled={!u.has_personal_key}
                        onCheckedChange={(v) => toggle(u.id, !!v)}
                      />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{u.name}</span>
                        <Badge variant="outline" className="ml-2 text-[10px]">{u.role}</Badge>
                      </div>
                      {!u.has_personal_key && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600">
                          <ShieldAlert className="w-3.5 h-3.5" /> No personal key yet
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-neutral-400 inline-flex items-center gap-1">
                <UserX className="w-3 h-3" /> Users without a personal vault password can&apos;t receive shares until they set one.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={doShare} disabled={submitting || selected.size === 0}>
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Share2 className="w-4 h-4 mr-2" />}
            Share with {selected.size || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
