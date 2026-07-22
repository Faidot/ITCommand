"use client";

import { Fragment, useEffect, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Building,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Layers,
  Lock,
  MapPin,
  Network,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users as UsersIcon,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plug, CalendarDays, Copy } from "lucide-react";
import { useSettingsStore } from "@/store/settingsStore";
import { Textarea } from "@/components/ui/textarea";
import { FloorManagerPanel } from "@/components/seating/floor-manager";
import { NetworkSettingsTab } from "@/components/network/network-settings";
import { ExtensionInstallGuide } from "@/components/extension/install-guide";
import { useExtensionInstalled } from "@/hooks/useExtensionInstalled";

// ───────────────────────── Types ─────────────────────────

interface AssetCategory {
  id: number;
  name: string;
  code?: string;
  icon?: string;
  description?: string;
  is_serialized: boolean;
  bulk_allowed: boolean;
  spec_schema: SpecField[];
  is_active: boolean;
  asset_count?: number;
  created_at?: string;
}

interface SpecField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "bool";
  required?: boolean;
  options?: string[];
}

interface Location {
  id: number;
  name: string;
  code?: string;
  address?: string;
  description?: string;
  is_active: boolean;
  asset_count?: number;
}

interface VendorLite {
  id: number;
  name: string;
  vendor_code?: string;
  is_active: boolean;
}

// ───────────────────────── Page ─────────────────────────

export default function SettingsPage() {
  const { user } = useAuthStore();
  const searchParams = useSearchParams();
  const initialTab = searchParams?.get("tab") || "company";

  if (user?.role !== "SUPERADMIN" && user?.role !== "ADMIN") {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            This page is restricted to administrators.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <SettingsIcon className="text-neutral-500" /> Master Settings
        </h1>
        <p className="text-neutral-500">
          Company info, asset categories, locations, vendors, and vault security.
        </p>
      </div>

      <Tabs defaultValue={initialTab} className="space-y-4">
        <TabsList className="flex flex-wrap h-auto justify-start gap-1">
          <TabsTrigger value="company">
            <Building className="h-4 w-4 mr-2" /> Company
          </TabsTrigger>
          <TabsTrigger value="categories">
            <Layers className="h-4 w-4 mr-2" /> Asset Categories
          </TabsTrigger>
          <TabsTrigger value="locations">
            <MapPin className="h-4 w-4 mr-2" /> Locations
          </TabsTrigger>
          <TabsTrigger value="vendors">
            <Building className="h-4 w-4 mr-2" /> Vendors
          </TabsTrigger>
          <TabsTrigger value="income-sources">
            <Layers className="h-4 w-4 mr-2" /> Income Sources
          </TabsTrigger>
          <TabsTrigger value="budget-categories">
            <Layers className="h-4 w-4 mr-2" /> Budget Categories
          </TabsTrigger>
          <TabsTrigger value="financial-years">
            <Layers className="h-4 w-4 mr-2" /> Financial Years
          </TabsTrigger>
          <TabsTrigger value="offices">
            <Layers className="h-4 w-4 mr-2" /> Offices
          </TabsTrigger>
          <TabsTrigger value="network">
            <Network className="h-4 w-4 mr-2" /> Network
          </TabsTrigger>
          <TabsTrigger value="roles">
            <UsersIcon className="h-4 w-4 mr-2" /> Roles &amp; Permissions
          </TabsTrigger>
          <TabsTrigger value="vault">
            <ShieldCheck className="h-4 w-4 mr-2" /> Vault Security
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarDays className="h-4 w-4 mr-2" /> Calendar
          </TabsTrigger>
          <TabsTrigger value="integrations">
            <Plug className="h-4 w-4 mr-2" /> Integrations
          </TabsTrigger>
          <TabsTrigger value="extension">
            <Puzzle className="h-4 w-4 mr-2" /> Browser Extension
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company"><CompanyTab role={user?.role} /></TabsContent>
        <TabsContent value="calendar"><CalendarTab /></TabsContent>
        <TabsContent value="integrations"><IntegrationsTab role={user?.role} /></TabsContent>
        <TabsContent value="categories"><CategoriesTab /></TabsContent>
        <TabsContent value="locations"><LocationsTab /></TabsContent>
        <TabsContent value="vendors"><VendorsTab /></TabsContent>
        <TabsContent value="income-sources"><IncomeSourcesTab /></TabsContent>
        <TabsContent value="budget-categories"><BudgetCategoriesTab /></TabsContent>
        <TabsContent value="financial-years"><FinancialYearsTab /></TabsContent>
        <TabsContent value="offices"><OfficesTab role={user?.role} /></TabsContent>
        <TabsContent value="network"><NetworkSettingsTab /></TabsContent>
        <TabsContent value="roles"><RolesTab role={user?.role} /></TabsContent>
        <TabsContent value="vault"><VaultSecurityTab role={user?.role} /></TabsContent>
        <TabsContent value="extension"><BrowserExtensionTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ───────────────────────── Browser Extension Tab ─────────────────────────

function BrowserExtensionTab() {
  const { state, version } = useExtensionInstalled();

  const statusBlock = {
    checking: { tone: undefined as "ok" | "warn" | undefined, label: "Checking…" },
    installed: { tone: "ok" as const, label: version ? `Installed (v${version})` : "Installed" },
    "not-installed": { tone: "warn" as const, label: "Not installed" },
  }[state];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Puzzle className="w-5 h-5 text-emerald-600" /> IT Command Browser Extension
          </CardTitle>
          <CardDescription>
            Fill matching vault credentials without auto-submitting, look up the current site in Network
            inventory, update a matched device&apos;s status, and create helpdesk tickets from the browser.
            Sign in and unlock the vault inside the extension before using saved credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-3 max-w-md">
            <StatBlock label="Status on this browser" value={statusBlock.label} tone={statusBlock.tone} />
            <StatBlock label="Credential safety" value="Single match, no auto-submit" />
          </div>

          {state === "installed" ? (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>You&apos;re all set</AlertTitle>
              <AlertDescription>
                The extension is active. Open it from the toolbar to sign in, unlock the vault, or inspect the current site&apos;s network device.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="rounded-lg border p-4">
              <ExtensionInstallGuide />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ───────────────────────── Roles & Permissions Tab ─────────────────────────

type ActionKey = "view" | "add" | "edit" | "delete";
type PermMap = Record<string, Record<ActionKey, boolean>>;

interface RbacModule { key: string; label: string; group: string; }
interface RbacAction { key: ActionKey; label: string; }
interface Role {
  id: number;
  name: string;
  slug: string;
  description: string;
  is_system: boolean;
  permissions: PermMap;
  user_count: number;
}

const ACTION_ORDER: ActionKey[] = ["view", "add", "edit", "delete"];

function countGrants(p: PermMap): number {
  let n = 0;
  for (const mod of Object.values(p || {})) for (const v of Object.values(mod)) if (v) n++;
  return n;
}

function RolesTab({ role }: { role?: string }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [modules, setModules] = useState<RbacModule[]>([]);
  const [actions, setActions] = useState<RbacAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);

  const canEdit = role === "SUPERADMIN" || role === "ADMIN";

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        api.get("/roles/"),
        api.get("/roles/catalog/"),
      ]);
      setRoles(r.data.results || r.data);
      setModules(c.data.modules || []);
      setActions(c.data.actions || []);
    } catch {
      toast.error("Failed to load roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const blankPerms = (): PermMap => {
    const p: PermMap = {};
    for (const m of modules) p[m.key] = { view: false, add: false, edit: false, delete: false };
    return p;
  };

  const openCreate = () => {
    setEditing({ id: 0, name: "", slug: "", description: "", is_system: false, permissions: blankPerms(), user_count: 0 });
    setOpen(true);
  };
  const openEdit = (r: Role) => { setEditing({ ...r, permissions: { ...r.permissions } }); setOpen(true); };

  const remove = async (r: Role) => {
    if (!confirm(`Delete role "${r.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/roles/${r.id}/`);
      toast.success("Role deleted");
      fetchAll();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Roles &amp; Permissions</CardTitle>
            <CardDescription>
              Define what each role can do per module — view, add, edit and delete.
              Built-in roles can be tuned; create your own (e.g. HR, Accounts) for finer control.
            </CardDescription>
          </div>
          {canEdit && <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Add Role</Button>}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">Permissions</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : roles.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No roles yet.</TableCell></TableRow>
              ) : roles.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    {r.description && <div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div>}
                  </TableCell>
                  <TableCell>
                    {r.is_system
                      ? <Badge variant="outline">Built-in</Badge>
                      : <Badge variant="secondary">Custom</Badge>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.user_count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.slug === "SUPERADMIN"
                      ? <Badge className="bg-emerald-600 border-0">Full access</Badge>
                      : `${countGrants(r.permissions)} grants`}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title={canEdit ? "Edit" : "View"}>
                      {canEdit && r.slug !== "SUPERADMIN" ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    {canEdit && !r.is_system && (
                      <Button variant="ghost" size="icon" onClick={() => remove(r)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RoleDialog
        open={open}
        onOpenChange={setOpen}
        initial={editing}
        modules={modules}
        actions={actions.length ? actions : ACTION_ORDER.map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1) }))}
        readOnly={!canEdit || editing?.slug === "SUPERADMIN"}
        onSaved={() => { setOpen(false); fetchAll(); }}
      />
    </>
  );
}

function RoleDialog({
  open, onOpenChange, initial, modules, actions, readOnly, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: Role | null;
  modules: RbacModule[];
  actions: RbacAction[];
  readOnly: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Role | null>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(initial); }, [initial]);

  if (!draft) return null;

  const groups = Array.from(new Set(modules.map((m) => m.group)));

  const permOf = (mod: string, act: ActionKey) => !!draft.permissions?.[mod]?.[act];

  const setPerm = (mod: string, act: ActionKey, val: boolean) => {
    const next: PermMap = { ...draft.permissions, [mod]: { ...(draft.permissions[mod] || { view: false, add: false, edit: false, delete: false }), [act]: val } };
    // Selecting any write action implies view.
    if (val && act !== "view") next[mod].view = true;
    // Removing view removes everything for that module.
    if (!val && act === "view") next[mod] = { view: false, add: false, edit: false, delete: false };
    setDraft({ ...draft, permissions: next });
  };

  const setModuleAll = (mod: string, val: boolean) => {
    const next: PermMap = { ...draft.permissions, [mod]: { view: val, add: val, edit: val, delete: val } };
    setDraft({ ...draft, permissions: next });
  };

  const setActionAll = (act: ActionKey, val: boolean) => {
    const next: PermMap = { ...draft.permissions };
    for (const m of modules) {
      const cur = next[m.key] || { view: false, add: false, edit: false, delete: false };
      next[m.key] = { ...cur, [act]: val };
      if (val && act !== "view") next[m.key].view = true;
      if (!val && act === "view") next[m.key] = { view: false, add: false, edit: false, delete: false };
    }
    setDraft({ ...draft, permissions: next });
  };

  const save = async () => {
    if (!draft.name.trim()) { toast.error("Role name is required"); return; }
    setSaving(true);
    try {
      const payload = { name: draft.name.trim(), description: draft.description || "", permissions: draft.permissions };
      if (draft.id) await api.patch(`/roles/${draft.id}/`, payload);
      else await api.post("/roles/", payload);
      toast.success("Saved");
      onSaved();
    } catch (e: any) {
      const data = e.response?.data;
      toast.error(typeof data === "string" ? data : data?.detail || data?.name?.[0] || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[760px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? `${draft.name || "Role"} permissions` : draft.id ? "Edit Role" : "Add Role"}
          </DialogTitle>
          <DialogDescription>
            Choose what this role can do in each module. Ticking Add, Edit or Delete automatically grants View.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. HR"
                disabled={readOnly || draft.is_system}
              />
              {draft.is_system && <p className="text-xs text-muted-foreground">Built-in role name can&apos;t be changed.</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="What this role is for"
                disabled={readOnly}
              />
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Module</TableHead>
                  {actions.map((a) => (
                    <TableHead key={a.key} className="text-center">
                      <div>{a.label}</div>
                      {!readOnly && (
                        <button
                          type="button"
                          className="text-[10px] font-normal text-muted-foreground hover:text-foreground underline"
                          onClick={() => setActionAll(a.key, !modules.every((m) => permOf(m.key, a.key)))}
                        >
                          all
                        </button>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <Fragment key={g}>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={actions.length + 1} className="py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {g}
                      </TableCell>
                    </TableRow>
                    {modules.filter((m) => m.group === g).map((m) => (
                      <TableRow key={m.key}>
                        <TableCell>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm">{m.label}</span>
                            {!readOnly && (
                              <button
                                type="button"
                                className="text-[10px] text-muted-foreground hover:text-foreground underline"
                                onClick={() => setModuleAll(m.key, !ACTION_ORDER.every((a) => permOf(m.key, a)))}
                              >
                                toggle
                              </button>
                            )}
                          </div>
                        </TableCell>
                        {actions.map((a) => (
                          <TableCell key={a.key} className="text-center">
                            <Checkbox
                              checked={permOf(m.key, a.key)}
                              disabled={readOnly}
                              onCheckedChange={(v) => setPerm(m.key, a.key, !!v)}
                            />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button onClick={save} disabled={saving || !draft.name.trim()}>{saving ? "Saving…" : "Save"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Vault Security Tab ─────────────────────────

interface MasterStatus {
  is_set: boolean;
  set_by: string | null;
  set_at: string | null;
  rotation_count: number;
  session_ttl_minutes: number;
  unlocked: boolean;
  unlock_expires_at: string | null;
}

function passwordChecks(pwd: string) {
  return {
    length: pwd.length >= 12,
    upper: /[A-Z]/.test(pwd),
    lower: /[a-z]/.test(pwd),
    digit: /\d/.test(pwd),
    special: /[^A-Za-z0-9]/.test(pwd),
  };
}

function VaultSecurityTab({ role }: { role?: string }) {
  const [status, setStatus] = useState<MasterStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountPwd, setAccountPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [ttl, setTtl] = useState<string>("30");
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  const isSuper = role === "SUPERADMIN";

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await api.get("/vault/master/status/");
      setStatus(res.data);
      if (res.data?.session_ttl_minutes) setTtl(String(res.data.session_ttl_minutes));
    } catch {
      toast.error("Failed to load vault status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStatus(); }, []);

  if (!isSuper) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Only a Super Administrator can configure the Vault master password.
        </CardContent>
      </Card>
    );
  }

  const checks = passwordChecks(newPwd);
  const passesAll = Object.values(checks).every(Boolean);
  const matches = newPwd && newPwd === confirmPwd;

  const generateStrong = async () => {
    try {
      // local generator (no auth header needed) so it works even before unlock
      const length = 20;
      const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
      const lower = "abcdefghijkmnpqrstuvwxyz";
      const digits = "23456789";
      const symbols = "!@#$%^&*()-_=+[]{};:,.?/";
      const all = upper + lower + digits + symbols;
      const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
      let p = pick(upper) + pick(lower) + pick(digits) + pick(symbols);
      for (let i = 0; i < length - 4; i++) p += pick(all);
      p = p.split("").sort(() => Math.random() - 0.5).join("");
      setNewPwd(p);
      setConfirmPwd(p);
      setShowNew(true);
    } catch {
      toast.error("Failed to generate password");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passesAll) return toast.error("Password does not meet strength requirements.");
    if (!matches) return toast.error("New password and confirmation must match.");
    if (!accountPwd) return toast.error("Confirm with your account password.");

    setSaving(true);
    try {
      await api.post("/vault/master/set/", {
        account_password: accountPwd,
        new_password: newPwd,
        confirm_password: confirmPwd,
        session_ttl_minutes: Number(ttl) || 30,
      });
      toast.success(status?.is_set
        ? "Vault master password rotated. All sessions revoked."
        : "Vault master password set. The vault is now ready.");
      setAccountPwd("");
      setNewPwd("");
      setConfirmPwd("");
      // Drop any local unlock token — must re-enter the new one
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("vault_unlock_token");
        sessionStorage.removeItem("vault_unlock_expires");
      }
      loadStatus();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Failed to update master password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" /> Vault Master Password
          </CardTitle>
          <CardDescription>
            A separate password (different from any user account password) that gates the entire Vault section
            — Password Vault and Account Workspaces. Only a Super Administrator can set or rotate it.
            All users who can access the Vault must enter this password to unlock their session.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="grid sm:grid-cols-4 gap-3 mb-5">
              <StatBlock label="Status" value={status?.is_set ? "Configured" : "Not set"} tone={status?.is_set ? "ok" : "warn"} />
              <StatBlock label="Rotations" value={String(status?.rotation_count ?? 0)} />
              <StatBlock label="Set by" value={status?.set_by || "—"} />
              <StatBlock label="Session TTL" value={`${status?.session_ttl_minutes ?? 30} min`} />
            </div>
          )}

          <form onSubmit={submit} className="space-y-4 max-w-xl">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Your account password</label>
              <Input
                type="password"
                value={accountPwd}
                onChange={(e) => setAccountPwd(e.target.value)}
                placeholder="Required to confirm the change"
                autoComplete="current-password"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  {status?.is_set ? "New master password" : "Master password"}
                </label>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={generateStrong}>
                  <RefreshCw className="w-3 h-3 mr-1" /> Generate strong
                </Button>
              </div>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="At least 12 chars, mixed case, digit, special"
                  className="pr-10 font-mono"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowNew((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <RuleList checks={checks} />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Confirm master password</label>
              <Input
                type={showNew ? "text" : "password"}
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder="Retype the password"
                className="font-mono"
                autoComplete="new-password"
              />
              {confirmPwd && !matches && (
                <p className="text-xs text-red-600">Does not match.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Session timeout (minutes)</label>
              <Input
                type="number"
                min={5}
                max={240}
                value={ttl}
                onChange={(e) => setTtl(e.target.value)}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                How long an unlock session lasts after the last vault action. 5–240 minutes.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button type="submit" disabled={saving || !passesAll || !matches || !accountPwd}>
                <KeyRound className="w-4 h-4 mr-2" />
                {saving ? "Saving…" : status?.is_set ? "Rotate master password" : "Set master password"}
              </Button>
              {status?.is_set && (
                <p className="text-xs text-muted-foreground">
                  Rotating will revoke <span className="font-medium">all</span> active unlock sessions.
                </p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function StatBlock({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  const toneCls =
    tone === "ok" ? "border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20"
      : tone === "warn" ? "border-amber-200 bg-amber-50/60 dark:bg-amber-950/20"
        : "";
  return (
    <div className={`rounded-lg border p-3 ${toneCls}`}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5 break-all">{value}</div>
    </div>
  );
}

function RuleList({ checks }: { checks: ReturnType<typeof passwordChecks> }) {
  const rows: Array<[boolean, string]> = [
    [checks.length, "At least 12 characters"],
    [checks.upper, "An uppercase letter (A–Z)"],
    [checks.lower, "A lowercase letter (a–z)"],
    [checks.digit, "A digit (0–9)"],
    [checks.special, "A special character"],
  ];
  return (
    <ul className="text-[11px] grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 mt-2">
      {rows.map(([ok, text], i) => (
        <li key={i} className={ok ? "text-emerald-600" : "text-muted-foreground"}>
          {ok ? "✓" : "•"} {text}
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────── Company Tab ─────────────────────────

const companySchema = z.object({
  company_name: z.string().min(2, "Required"),
  default_currency: z.string().min(1, "Required"),
  fiscal_year_start_month: z.string().min(1, "Required"),
});

function CompanyTab({ role }: { role?: string }) {
  const applySettings = useSettingsStore((state) => state.apply);
  // Currencies come from the admin-managed list of values, so a superadmin can
  // add one in Django admin without a code change.
  const [currencies, setCurrencies] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get("/lov/?group=currency");
        const values = Array.isArray(res.data?.values) ? res.data.values : [];
        if (values.length) setCurrencies(values);
      } catch {
        setCurrencies([{ value: "USD", label: "US Dollar" }]);
      }
    })();
  }, []);
  const [loading, setLoading] = useState(true);

  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    defaultValues: { company_name: "", default_currency: "USD", fiscal_year_start_month: "1" },
  });

  useEffect(() => {
    if (role !== "SUPERADMIN") return;
    api.get("/settings/").then((res) => {
      const d = res.data;
      form.reset({
        company_name: d.company_name || "",
        default_currency: d.default_currency || "USD",
        fiscal_year_start_month: d.fiscal_year_start_month || "1",
      });
      setLoading(false);
    }).catch(() => {
      toast.error("Failed to load settings");
      setLoading(false);
    });
  }, [role, form]);

  if (role !== "SUPERADMIN") {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Company settings are managed by a Super Administrator.
        </CardContent>
      </Card>
    );
  }

  const onSubmit = async (values: z.infer<typeof companySchema>) => {
    try {
      await api.put("/settings/", values);
      // Push into the global store so currency/company updates everywhere
      // immediately, without a page refresh.
      applySettings({
        company_name: values.company_name,
        default_currency: values.default_currency,
        fiscal_year_start_month: Number(values.fiscal_year_start_month),
      });
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    }
  };

  if (loading) return <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading…</CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company &amp; Localisation</CardTitle>
        <CardDescription>Identifies your organisation across the app.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FormField control={form.control} name="company_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="default_currency" render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Currency</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {currencies.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.value} — {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="fiscal_year_start_month" render={({ field }) => (
                <FormItem>
                  <FormLabel>Fiscal Year Start Month</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["1","2","3","4","5","6","7","8","9","10","11","12"].map((m) => (
                        <SelectItem key={m} value={m}>
                          {new Date(2000, parseInt(m,10) - 1, 1).toLocaleString(undefined, { month: "long" })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <Button type="submit"><Save className="w-4 h-4 mr-2" /> Save</Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Asset Categories Tab ─────────────────────────

const SPEC_TYPES: Array<{ value: SpecField["type"]; label: string }> = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Select" },
  { value: "date", label: "Date" },
  { value: "bool", label: "Yes / No" },
];

function CategoriesTab() {
  const [rows, setRows] = useState<AssetCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AssetCategory | null>(null);
  const [open, setOpen] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get("/asset-categories/");
      setRows(res.data.results || res.data);
    } catch {
      toast.error("Failed to load asset categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  const openCreate = () => { setEditing({ id: 0, name: "", is_serialized: true, bulk_allowed: false, spec_schema: [], is_active: true }); setOpen(true); };
  const openEdit = (c: AssetCategory) => { setEditing({ ...c, spec_schema: c.spec_schema || [] }); setOpen(true); };

  const remove = async (c: AssetCategory) => {
    if (!confirm(`Delete category "${c.name}"? Assets in it will lose their category.`)) return;
    try {
      await api.delete(`/asset-categories/${c.id}/`);
      toast.success("Deleted");
      fetch();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Asset Categories</CardTitle>
            <CardDescription>
              Define classes (Laptop, Monitor, Keyboard) and which fields each one captures.
            </CardDescription>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Add Category</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="text-right">Specs</TableHead>
                <TableHead className="text-right">Assets</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No categories yet.</TableCell></TableRow>
              ) : rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-medium">{c.name}</div>
                    {c.description && <div className="text-xs text-muted-foreground line-clamp-1">{c.description}</div>}
                  </TableCell>
                  <TableCell>{c.code ? <Badge variant="outline" className="font-mono text-[11px]">{c.code}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.is_serialized && <Badge variant="outline" className="text-[10px]">Serialized</Badge>}
                      {c.bulk_allowed && <Badge variant="outline" className="text-[10px]">Bulk</Badge>}
                      {!c.is_active && <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{(c.spec_schema || []).length}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.asset_count ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(c)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CategoryDialog open={open} onOpenChange={setOpen} initial={editing} onSaved={() => { setOpen(false); fetch(); }} />
    </>
  );
}

function CategoryDialog({
  open, onOpenChange, initial, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: AssetCategory | null;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<AssetCategory | null>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(initial); }, [initial]);

  if (!draft) return null;

  const updateSpec = (i: number, patch: Partial<SpecField>) => {
    const next = [...draft.spec_schema];
    next[i] = { ...next[i], ...patch };
    setDraft({ ...draft, spec_schema: next });
  };
  const addSpec = () => setDraft({ ...draft, spec_schema: [...draft.spec_schema, { key: "", label: "", type: "text", required: false }] });
  const removeSpec = (i: number) => setDraft({ ...draft, spec_schema: draft.spec_schema.filter((_, j) => j !== i) });

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: draft.name,
        code: draft.code || "",
        icon: draft.icon || "",
        description: draft.description || "",
        is_serialized: draft.is_serialized,
        bulk_allowed: draft.bulk_allowed,
        is_active: draft.is_active,
        spec_schema: draft.spec_schema.map((s) => ({
          key: s.key.trim(),
          label: s.label.trim(),
          type: s.type,
          required: !!s.required,
          ...(s.type === "select" ? { options: (s.options || []).filter((o) => o.trim()) } : {}),
        })).filter((s) => s.key && s.label),
      };
      if (draft.id) {
        await api.put(`/asset-categories/${draft.id}/`, payload);
      } else {
        await api.post("/asset-categories/", payload);
      }
      toast.success("Saved");
      onSaved();
    } catch (e: any) {
      const data = e.response?.data;
      toast.error(typeof data === "string" ? data : data?.detail || JSON.stringify(data) || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft.id ? "Edit Category" : "Add Category"}</DialogTitle>
          <DialogDescription>
            Configure how this asset class behaves and which spec fields it captures.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Laptop" />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Code (optional)</label>
              <Input value={draft.code || ""} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="LAPTOP" className="font-mono" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Description</label>
            <Textarea value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="min-h-20" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ToggleRow label="Serialized" description="Each unit has its own serial." value={draft.is_serialized} onChange={(v) => setDraft({ ...draft, is_serialized: v })} />
            <ToggleRow label="Bulk entry allowed" description="Allow creating N rows at once." value={draft.bulk_allowed} onChange={(v) => setDraft({ ...draft, bulk_allowed: v })} />
            <ToggleRow label="Active" description="Show in asset form." value={draft.is_active} onChange={(v) => setDraft({ ...draft, is_active: v })} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Spec fields</div>
                <div className="text-xs text-muted-foreground">
                  Extra fields shown when creating assets of this category. E.g. for laptops: cpu, ram_gb, storage_gb.
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addSpec}><Plus className="w-3.5 h-3.5 mr-1" /> Add field</Button>
            </div>

            {draft.spec_schema.length === 0 ? (
              <div className="text-xs text-muted-foreground rounded border border-dashed p-3">
                No spec fields yet. Add ones like <span className="font-mono">cpu</span>, <span className="font-mono">ram_gb</span>, <span className="font-mono">storage_gb</span>.
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[28%]">Key</TableHead>
                      <TableHead className="w-[28%]">Label</TableHead>
                      <TableHead className="w-[18%]">Type</TableHead>
                      <TableHead className="w-[14%]">Required</TableHead>
                      <TableHead className="w-[12%] text-right"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.spec_schema.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell><Input value={s.key} onChange={(e) => updateSpec(i, { key: e.target.value.replace(/\s+/g, "_").toLowerCase() })} className="h-8 font-mono text-xs" placeholder="cpu" /></TableCell>
                        <TableCell><Input value={s.label} onChange={(e) => updateSpec(i, { label: e.target.value })} className="h-8 text-xs" placeholder="CPU" /></TableCell>
                        <TableCell>
                          <Select value={s.type} onValueChange={(v) => updateSpec(i, { type: v as SpecField["type"] })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SPEC_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell><Switch checked={!!s.required} onCheckedChange={(v) => updateSpec(i, { required: v })} /></TableCell>
                        <TableCell className="text-right">
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeSpec(i)}><X className="h-4 w-4" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !draft.name.trim()}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void; }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

// ───────────────────────── Locations Tab ─────────────────────────

function LocationsTab() {
  const [rows, setRows] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [saving, setSaving] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get("/locations/");
      setRows(res.data.results || res.data);
    } catch {
      toast.error("Failed to load locations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch(); }, []);

  const openCreate = () => { setEditing({ id: 0, name: "", code: "", address: "", description: "", is_active: true }); setOpen(true); };
  const openEdit = (l: Location) => { setEditing({ ...l }); setOpen(true); };

  const remove = async (l: Location) => {
    if (!confirm(`Delete location "${l.name}"? Assets there will lose their location.`)) return;
    try {
      await api.delete(`/locations/${l.id}/`);
      toast.success("Deleted");
      fetch();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || "Delete failed");
    }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = {
        name: editing.name,
        code: editing.code || "",
        address: editing.address || "",
        description: editing.description || "",
        is_active: editing.is_active,
      };
      if (editing.id) {
        await api.put(`/locations/${editing.id}/`, payload);
      } else {
        await api.post("/locations/", payload);
      }
      toast.success("Saved");
      setOpen(false);
      fetch();
    } catch (e: any) {
      toast.error(e.response?.data?.detail || JSON.stringify(e.response?.data) || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Locations</CardTitle>
            <CardDescription>Where assets physically sit. Used in the asset form.</CardDescription>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Add Location</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Address</TableHead>
                <TableHead className="text-right">Assets</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No locations yet.</TableCell></TableRow>
              ) : rows.map((l) => (
                <TableRow key={l.id} className={!l.is_active ? "opacity-60" : ""}>
                  <TableCell><div className="font-medium">{l.name}</div></TableCell>
                  <TableCell>{l.code ? <Badge variant="outline" className="font-mono text-[11px]">{l.code}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{l.address || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.asset_count ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(l)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(l)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit Location" : "Add Location"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Name</label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="HQ Floor 3 Storage" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Code (optional)</label>
                <Input value={editing.code || ""} onChange={(e) => setEditing({ ...editing, code: e.target.value })} className="font-mono" placeholder="HQ-3-STORE" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Address</label>
                <Textarea value={editing.address || ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} className="min-h-16" />
              </div>
              <ToggleRow label="Active" value={editing.is_active} onChange={(v) => setEditing({ ...editing, is_active: v })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !editing?.name?.trim()}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────────────────── Income Sources Tab ─────────────────────────

function IncomeSourcesTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try {
      const res = await api.get("/finance/sources/");
      setRows(res.data.results || res.data);
    } catch {
      toast.error("Failed to load income sources");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetch(); }, []);

  const openCreate = () => { setEditing({ id: 0, name: "", description: "", is_active: true }); setOpen(true); };
  const openEdit = (s: any) => { setEditing({ ...s }); setOpen(true); };

  const remove = async (s: any) => {
    if (!confirm(`Delete source "${s.name}"? Income/expenses using it will keep their amounts but lose the source label.`)) return;
    try { await api.delete(`/finance/sources/${s.id}/`); toast.success("Deleted"); fetch(); }
    catch (e: any) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = { name: editing.name, description: editing.description || "", is_active: editing.is_active };
      if (editing.id) await api.put(`/finance/sources/${editing.id}/`, payload);
      else await api.post("/finance/sources/", payload);
      toast.success("Saved");
      setOpen(false);
      fetch();
    } catch (e: any) {
      toast.error(e.response?.data?.name?.[0] || e.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Income Sources</CardTitle>
            <CardDescription>The dropdown of funding/income sources used on Income and Expense entries.</CardDescription>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Add Source</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No sources yet.</TableCell></TableRow>
              ) : rows.map((s) => (
                <TableRow key={s.id} className={!s.is_active ? "opacity-60" : ""}>
                  <TableCell><div className="font-medium">{s.name}</div></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.description || "—"}</TableCell>
                  <TableCell>{s.is_active ? <Badge variant="outline">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(s)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Source" : "Add Source"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Name</label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Company Account" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Description (optional)</label>
                <Textarea value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="min-h-16" />
              </div>
              <ToggleRow label="Active" value={editing.is_active} onChange={(v) => setEditing({ ...editing, is_active: v })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !editing?.name?.trim()}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────────────────── Budget Categories Tab ─────────────────────────

function BudgetCategoriesTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try { const res = await api.get("/finance/categories/"); setRows(res.data.results || res.data); }
    catch { toast.error("Failed to load categories"); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const openCreate = () => { setEditing({ id: 0, name: "", description: "", enforce_budget: false }); setOpen(true); };
  const openEdit = (c: any) => { setEditing({ ...c }); setOpen(true); };
  const remove = async (c: any) => {
    if (!confirm(`Delete category "${c.name}"?`)) return;
    try { await api.delete(`/finance/categories/${c.id}/`); toast.success("Deleted"); fetch(); }
    catch (e: any) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload = { name: editing.name, description: editing.description || "", enforce_budget: !!editing.enforce_budget };
      if (editing.id) await api.put(`/finance/categories/${editing.id}/`, payload);
      else await api.post("/finance/categories/", payload);
      toast.success("Saved"); setOpen(false); fetch();
    } catch (e: any) { toast.error(e.response?.data?.name?.[0] || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Budget Categories</CardTitle>
            <CardDescription>Spending categories used across Budget, Expenses, Income and Bills.</CardDescription>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Add Category</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Hard Limit</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading ? (<TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>)
              : rows.length === 0 ? (<TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No categories yet.</TableCell></TableRow>)
              : rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><div className="font-medium">{c.name}</div></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{c.description || "—"}</TableCell>
                  <TableCell>{c.enforce_budget ? <Badge variant="destructive">Enforced</Badge> : <Badge variant="outline">Warn only</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(c)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Category" : "Add Category"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5"><label className="text-sm font-medium">Name</label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Hardware" /></div>
              <div className="space-y-1.5"><label className="text-sm font-medium">Description (optional)</label><Textarea value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="min-h-16" /></div>
              <ToggleRow label="Hard budget limit (block over-budget approvals)" value={!!editing.enforce_budget} onChange={(v) => setEditing({ ...editing, enforce_budget: v })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !editing?.name?.trim()}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────────────────── Financial Years Tab ─────────────────────────

function FinancialYearsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const fetch = async () => {
    setLoading(true);
    try { const res = await api.get("/finance/years/"); setRows(res.data.results || res.data); }
    catch { toast.error("Failed to load financial years"); }
    finally { setLoading(false); }
  };
  useEffect(() => { fetch(); }, []);

  const openCreate = () => { setEditing({ id: 0, name: "", start_date: "", end_date: "", is_active: false }); setOpen(true); };
  const openEdit = (y: any) => { setEditing({ ...y }); setOpen(true); };
  const remove = async (y: any) => {
    if (!confirm(`Delete "${y.name}"? Linked budgets/expenses will lose their year.`)) return;
    try { await api.delete(`/finance/years/${y.id}/`); toast.success("Deleted"); fetch(); }
    catch (e: any) { toast.error(e.response?.data?.detail || "Delete failed"); }
  };
  const save = async () => {
    if (!editing) return;
    if (!editing.name || !editing.start_date || !editing.end_date) { toast.error("Name, start and end dates are required"); return; }
    setSaving(true);
    try {
      const payload = { name: editing.name, start_date: editing.start_date, end_date: editing.end_date, is_active: !!editing.is_active };
      if (editing.id) await api.put(`/finance/years/${editing.id}/`, payload);
      else await api.post("/finance/years/", payload);
      toast.success("Saved"); setOpen(false); fetch();
    } catch (e: any) { toast.error(JSON.stringify(e.response?.data) || "Save failed"); }
    finally { setSaving(false); }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Financial Years</CardTitle>
            <CardDescription>Fiscal years for budgeting. Only one can be active at a time.</CardDescription>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" /> Add Year</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {loading ? (<TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>)
              : rows.length === 0 ? (<TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No years yet.</TableCell></TableRow>)
              : rows.map((y) => (
                <TableRow key={y.id}>
                  <TableCell><div className="font-medium">{y.name}</div></TableCell>
                  <TableCell className="text-sm">{y.start_date}</TableCell>
                  <TableCell className="text-sm">{y.end_date}</TableCell>
                  <TableCell>{y.is_active ? <Badge className="bg-emerald-600 border-0">Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(y)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(y)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Financial Year" : "Add Financial Year"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5"><label className="text-sm font-medium">Name</label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="FY 2025-26" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><label className="text-sm font-medium">Start</label><Input type="date" value={editing.start_date || ""} onChange={(e) => setEditing({ ...editing, start_date: e.target.value })} /></div>
                <div className="space-y-1.5"><label className="text-sm font-medium">End</label><Input type="date" value={editing.end_date || ""} onChange={(e) => setEditing({ ...editing, end_date: e.target.value })} /></div>
              </div>
              <ToggleRow label="Active year" value={!!editing.is_active} onChange={(v) => setEditing({ ...editing, is_active: v })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ───────────────────────── Vendors Tab ─────────────────────────

function VendorsTab() {
  const [rows, setRows] = useState<VendorLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/vendors/").then((res) => {
      setRows(res.data.results || res.data);
      setLoading(false);
    }).catch(() => { toast.error("Failed to load vendors"); setLoading(false); });
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Vendors</CardTitle>
          <CardDescription>Quick reference. Full vendor management lives on its own page.</CardDescription>
        </div>
        <Link href="/vendors">
          <Button variant="outline"><ExternalLink className="w-4 h-4 mr-2" /> Open vendors page</Button>
        </Link>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No vendors yet.</TableCell></TableRow>
            ) : rows.slice(0, 30).map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">{v.name}</TableCell>
                <TableCell>{v.vendor_code ? <Badge variant="outline" className="font-mono text-[11px]">{v.vendor_code}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right">
                  {v.is_active
                    ? <Badge variant="outline" className="border-emerald-200 text-emerald-700 bg-emerald-50">Active</Badge>
                    : <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ───────────────────────── Offices Tab ─────────────────────────

function OfficesTab({ role }: { role?: string }) {
  const editable = role === "SUPERADMIN" || role === "ADMIN";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Office Locations &amp; Floors</CardTitle>
        <CardDescription>
          Add office locations and their floors here. They appear in the Seating Plan&apos;s
          office dropdown, ready to design.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FloorManagerPanel editable={editable} />
      </CardContent>
    </Card>
  );
}


interface IntegrationRow {
  provider: string;
  label: string;
  description: string;
  help: string;
  needs_api_key: boolean;
  credential_label: string;
  default_base_url: string;
  is_enabled: boolean;
  base_url: string;
  has_api_key: boolean;
  last_status: string;
  last_message: string;
  last_sync_at: string | null;
}

function IntegrationsTab({ role }: { role?: string }) {
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, { api_key: string; base_url: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api.get("/integrations/");
      setRows(res.data?.integrations || []);
    } catch {
      toast.error("Could not load integrations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (role !== "SUPERADMIN") {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Only a superadmin can configure integrations.
        </CardContent>
      </Card>
    );
  }
  if (loading) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading…</CardContent></Card>;
  }

  const save = async (row: IntegrationRow, changes: Record<string, unknown>) => {
    setBusy(row.provider);
    try {
      await api.put("/integrations/", { provider: row.provider, ...changes });
      toast.success(`${row.label} updated`);
      setDrafts((d) => ({ ...d, [row.provider]: { api_key: "", base_url: "" } }));
      await load();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not save the integration");
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (row: IntegrationRow) => {
    setBusy(row.provider);
    try {
      const res = await api.post("/integrations/test/", { provider: row.provider });
      if (res.data?.ok) toast.success(res.data.output || "Completed");
      else toast.error(res.data?.output || "The provider returned an error");
      await load();
    } catch {
      toast.error("Could not run the integration");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const draft = drafts[row.provider] || { api_key: "", base_url: "" };
        return (
          <Card key={row.provider}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {row.label}
                {row.is_enabled ? (
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700">Enabled</Badge>
                ) : (
                  <Badge variant="outline">Disabled</Badge>
                )}
                {row.last_status === "OK" && <Badge variant="outline">Last run OK</Badge>}
                {row.last_status === "ERROR" && (
                  <Badge variant="outline" className="border-red-300 text-red-700">Last run failed</Badge>
                )}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{row.description}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">API endpoint</label>
                  <Input
                    value={draft.base_url || row.base_url}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [row.provider]: { ...draft, base_url: e.target.value } }))
                    }
                    placeholder={row.default_base_url}
                  />
                  <p className="text-xs text-muted-foreground">{row.help}</p>
                </div>
                {row.needs_api_key && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">
                      {row.credential_label || "API key"}{" "}
                      {row.has_api_key && <span className="text-emerald-600">(saved)</span>}
                    </label>
                    <Input
                      type="password"
                      value={draft.api_key}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [row.provider]: { ...draft, api_key: e.target.value } }))
                      }
                      placeholder={
                        row.has_api_key
                          ? "Leave blank to keep the current value"
                          : `Paste your ${(row.credential_label || "API key").toLowerCase()}`
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Stored encrypted and never shown again after saving.
                    </p>
                  </div>
                )}
              </div>

              {row.last_message && (
                <p className={`text-xs ${row.last_status === "ERROR" ? "text-red-600" : "text-muted-foreground"}`}>
                  {row.last_sync_at ? `${new Date(row.last_sync_at).toLocaleString()} — ` : ""}
                  {row.last_message}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={busy === row.provider}
                  onClick={() =>
                    void save(row, {
                      base_url: draft.base_url || row.base_url,
                      ...(draft.api_key ? { api_key: draft.api_key } : {}),
                    })
                  }
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  disabled={busy === row.provider}
                  onClick={() => void save(row, { is_enabled: !row.is_enabled })}
                >
                  {row.is_enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy === row.provider || !row.is_enabled}
                  onClick={() => void runNow(row)}
                >
                  Run now
                </Button>
                {row.has_api_key && (
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy === row.provider}
                    onClick={() => void save(row, { clear_api_key: true, is_enabled: false })}
                  >
                    Remove key
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}


interface CalendarFeed {
  is_enabled: boolean;
  url: string;
  include: string[];
  available_sources: { key: string; label: string; module: string }[];
  last_accessed_at: string | null;
  access_count: number;
}

function CalendarTab() {
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const res = await api.get("/calendar/me/");
      setFeed(res.data);
    } catch {
      toast.error("Could not load your calendar feed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (loading) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading…</CardContent></Card>;
  }
  if (!feed) return null;

  const update = async (changes: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await api.patch("/calendar/me/", changes);
      setFeed(res.data);
    } catch {
      toast.error("Could not update the feed");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!confirm("Generate a new link? The current one stops working immediately and you will need to re-add it in your calendar.")) return;
    setBusy(true);
    try {
      const res = await api.post("/calendar/me/", {});
      setFeed(res.data);
      toast.success("New link generated");
    } catch {
      toast.error("Could not regenerate the link");
    } finally {
      setBusy(false);
    }
  };

  const toggleSource = (key: string) => {
    const next = feed.include.includes(key)
      ? feed.include.filter((s) => s !== key)
      : [...feed.include, key];
    void update({ include: next });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your calendar feed</CardTitle>
        <p className="text-sm text-muted-foreground">
          Subscribe from Google Calendar, Outlook or Apple Calendar to see renewals,
          expiries and due dates alongside your own events. Each item includes a
          reminder the day before.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Private link</label>
          <div className="flex flex-wrap gap-2">
            <Input readOnly value={feed.url} className="flex-1 min-w-[16rem] font-mono text-xs" />
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(feed.url);
                toast.success("Link copied");
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copy
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void regenerate()}>
              <RefreshCw className="mr-2 h-4 w-4" /> New link
            </Button>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Treat this like a password — anyone with the link can read these dates.
            Generate a new one if it is ever shared by mistake.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-medium">Add it to Google Calendar</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            <li>Open Google Calendar on a computer</li>
            <li>Left sidebar → <strong>Other calendars</strong> → <strong>+</strong> → <strong>From URL</strong></li>
            <li>Paste the link above and click <strong>Add calendar</strong></li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Google refreshes external calendars on its own schedule, usually every
            few hours — new items may not appear instantly.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">What to include</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {feed.available_sources.map((source) => (
              <label key={source.key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={feed.include.includes(source.key)}
                  onCheckedChange={() => toggleSource(source.key)}
                  disabled={busy}
                />
                {source.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            You will only ever see records your role can already view.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button
            variant={feed.is_enabled ? "outline" : "default"}
            disabled={busy}
            onClick={() => void update({ is_enabled: !feed.is_enabled })}
          >
            {feed.is_enabled ? "Disable feed" : "Enable feed"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {feed.access_count > 0
              ? `Fetched ${feed.access_count} time(s)${feed.last_accessed_at ? ` · last ${new Date(feed.last_accessed_at).toLocaleString()}` : ""}`
              : "Not fetched yet"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
