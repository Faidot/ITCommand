"use client";

/**
 * Who can sign in to one provider account.
 *
 * The account is the bill and the console; these are the people. They are
 * separate rows because they do not share a second factor — which is the whole
 * point of the panel. An AWS account can be marked "security key" and still
 * contain one person with nothing, and until now there was nowhere to say so.
 *
 * Two numbers are called out at the top for that reason: how many can change
 * things, and how many have no MFA. Everything else is detail.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Loader2, Pencil, Plus, ShieldAlert, ShieldCheck, Trash2, UserCheck, UserCog, X,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  ACCOUNT_ROLE_CHOICES,
  AccountLogin,
  LOGIN_KIND_CHOICES,
  MFA_TYPE_CHOICES,
  ProviderAccount,
  errorMessage,
  normalizeAccountLogin,
  resultsOf,
} from "../estate-types";

interface AppUser {
  id: number;
  full_name?: string;
  email: string;
}

const BLANK = {
  login: "",
  login_kind: "EMAIL",
  role: "MEMBER",
  mfa_type: "UNKNOWN",
  user: "",
  display_name: "",
  notes: "",
  is_active: true,
};

type Draft = typeof BLANK;

function toDraft(person: AccountLogin): Draft {
  return {
    login: person.login,
    login_kind: person.login_kind,
    role: person.role,
    mfa_type: person.mfa_type,
    user: person.user ? String(person.user) : "",
    display_name: person.display_name,
    notes: person.notes,
    is_active: person.is_active,
  };
}

/**
 * The people editor itself, without a dialog around it.
 *
 * Used inline on the account detail page and inside `PeopleSheet` from the
 * accounts table. One implementation on purpose: two would drift, and the one
 * that drifted would be the one somebody was using to decide who still has
 * access.
 */
export function PeopleManager({
  account,
  active: isOpen,
  onChanged,
  canEdit,
}: {
  account: ProviderAccount | null;
  /** Loads only while this is true, so the dialog does not fetch when shut. */
  active: boolean;
  /** Fired after any write, so a caller can refresh its MFA rollup. */
  onChanged?: () => void;
  canEdit: boolean;
}) {
  const open = isOpen;
  const [people, setPeople] = useState<AccountLogin[] | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    setPeople(null);
    try {
      const response = await api.get<unknown>("/estate/account-users/", {
        params: { account: account.id, page_size: 200 },
      });
      setPeople(resultsOf(response.data, normalizeAccountLogin));
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not load the people on this account."));
      setPeople([]);
    }
  }, [account]);

  useEffect(() => {
    if (!open || !account) return;
    void load();
    api.get<unknown>("/users/", { params: { page_size: 500 } })
      .then((r) => {
        const raw = r.data as { results?: AppUser[] } | AppUser[];
        setUsers(Array.isArray(raw) ? raw : raw.results ?? []);
      })
      // A missing user list only costs the convenience of linking a person;
      // the login itself still saves, so this must not block the panel.
      .catch(() => setUsers([]));
  }, [open, account, load]);

  const save = async () => {
    if (!account || !draft) return;
    if (!draft.login.trim()) {
      toast.error("Enter the username or email this person signs in with.");
      return;
    }
    setSaving(true);
    const body = {
      provider_account: account.id,
      login: draft.login.trim(),
      login_kind: draft.login_kind,
      role: draft.role,
      mfa_type: draft.mfa_type,
      user: draft.user ? Number(draft.user) : null,
      display_name: draft.display_name.trim(),
      notes: draft.notes,
      is_active: draft.is_active,
    };
    try {
      if (editingId) await api.patch(`/estate/account-users/${editingId}/`, body);
      else await api.post("/estate/account-users/", body);
      toast.success(editingId ? "Login updated." : "Login added.");
      setDraft(null);
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not save that login."));
    } finally {
      setSaving(false);
    }
  };

  const setPerson = async (person: AccountLogin, userId: number | null) => {
    try {
      await api.patch(`/estate/account-users/${person.id}/`, { user: userId });
      toast.success(userId ? "Login assigned." : "Login unlinked from that person.");
      await load();
      onChanged?.();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not change who this login belongs to."));
    }
  };

  const remove = async (person: AccountLogin) => {
    if (!confirm(`Remove ${person.login} from this account?`)) return;
    try {
      await api.delete(`/estate/account-users/${person.id}/`);
      toast.success("Login removed.");
      await load();
      onChanged?.();
    } catch (reason) {
      toast.error(errorMessage(reason, "Could not remove that login."));
    }
  };

  const active = (people ?? []).filter((p) => p.is_active);
  const withoutMfa = active.filter((p) => p.mfa_type === "NONE");
  const privileged = active.filter((p) => p.is_privileged);

  return (
    <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{active.length} with access</Badge>
            <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">
              {privileged.length} can change things
            </Badge>
            {withoutMfa.length > 0 ? (
              <Badge className="border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                <ShieldAlert className="mr-1 h-3 w-3" />
                {withoutMfa.length} with no MFA
              </Badge>
            ) : active.length > 0 ? (
              <Badge className="border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                <ShieldCheck className="mr-1 h-3 w-3" /> everyone has MFA
              </Badge>
            ) : null}
          </div>

          {people === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : people.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nobody is listed yet. Add the individual logins — the root login,
              and each person&apos;s own — so leavers and missing second factors
              become findable.
            </p>
          ) : (
            <ScrollArea className="max-h-72 rounded-lg border">
              <div className="divide-y">
                {people.map((person) => (
                  <div
                    key={person.id}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm ${
                      person.is_active ? "" : "opacity-55"
                    }`}
                  >
                    <span className="font-medium">{person.name}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {person.login}
                    </code>
                    <Badge variant="outline" className="text-[10px]">
                      {person.role_label}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        person.mfa_severity === "critical"
                          ? "border-red-300 text-red-700 dark:text-red-400"
                          : person.mfa_severity === "warning"
                          ? "border-amber-300 text-amber-700 dark:text-amber-400"
                          : person.mfa_severity === "ok"
                          ? "border-emerald-300 text-emerald-700 dark:text-emerald-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {person.mfa_label}
                    </Badge>
                    {!person.is_active && (
                      <Badge variant="outline" className="text-[10px]">removed</Badge>
                    )}
                    {canEdit && (
                      person.user ? (
                        <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                          <UserCheck className="h-3 w-3" />
                          {person.user_name || person.user_email}
                          <button
                            type="button"
                            title="Unlink this person"
                            className="ml-0.5 opacity-60 hover:opacity-100"
                            onClick={() => void setPerson(person, null)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ) : (
                        <Select
                          value="none"
                          onValueChange={(v) => void setPerson(person, Number(v))}
                        >
                          <SelectTrigger className="h-6 w-[132px] text-[11px]">
                            <SelectValue placeholder="Assign to…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none" disabled>Assign to…</SelectItem>
                            {users.map((u) => (
                              <SelectItem key={u.id} value={String(u.id)}>
                                {u.full_name || u.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    )}
                    {canEdit && (
                      <div className="ml-auto flex gap-1">
                        <Button
                          type="button" variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => { setDraft(toDraft(person)); setEditingId(person.id); }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button" variant="ghost" size="icon"
                          className="h-7 w-7 text-red-600"
                          onClick={() => void remove(person)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {canEdit && !draft && (
            <Button type="button" variant="outline" onClick={() => { setDraft({ ...BLANK }); setEditingId(null); }}>
              <Plus className="mr-2 h-4 w-4" /> Add a login
            </Button>
          )}

          {canEdit && draft && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {editingId ? "Edit login" : "New login"}
                </p>
                <Button
                  type="button" variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => { setDraft(null); setEditingId(null); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="p-login">Login *</Label>
                  <Input
                    id="p-login"
                    value={draft.login}
                    placeholder="iam:alice or alice@example.com"
                    onChange={(e) => setDraft({ ...draft, login: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>What is it?</Label>
                  <Select
                    value={draft.login_kind}
                    onValueChange={(v) => setDraft({ ...draft, login_kind: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LOGIN_KIND_CHOICES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Person</Label>
                  <Select
                    value={draft.user || "none"}
                    onValueChange={(v) => setDraft({ ...draft, user: v === "none" ? "" : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="Not linked" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not in IT Command</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.full_name || u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-name">Name if not linked</Label>
                  <Input
                    id="p-name"
                    value={draft.display_name}
                    placeholder="Deploy robot, contractor…"
                    onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Role</Label>
                  <Select value={draft.role} onValueChange={(v) => setDraft({ ...draft, role: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_ROLE_CHOICES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Second factor</Label>
                  <Select value={draft.mfa_type} onValueChange={(v) => setDraft({ ...draft, mfa_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MFA_TYPE_CHOICES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="p-notes">Notes</Label>
                <Textarea
                  id="p-notes" rows={2} value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={draft.is_active}
                    onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
                  />
                  Still has access
                </label>
                <Button type="button" onClick={() => void save()} disabled={saving}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingId ? "Save" : "Add"}
                </Button>
              </div>
            </div>
          )}
    </div>
  );
}


/** The same editor, in a dialog, for the accounts table. */
export function PeopleSheet({
  account,
  open,
  onOpenChange,
  onChanged,
  canEdit,
}: {
  account: ProviderAccount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
  canEdit: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            People on {account?.account_email}
          </DialogTitle>
          <DialogDescription>
            Everyone with their own login to this {account?.provider_name} account.
            The account is one bill; these are the ways in.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto pr-1">
          <PeopleManager
            account={account}
            active={open}
            onChanged={onChanged}
            canEdit={canEdit}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
