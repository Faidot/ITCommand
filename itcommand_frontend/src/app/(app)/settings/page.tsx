"use client";

import { useEffect, useState } from "react";
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
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Trash2,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FloorManagerPanel } from "@/components/seating/floor-manager";
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
        <TabsList>
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
          <TabsTrigger value="offices">
            <Layers className="h-4 w-4 mr-2" /> Offices
          </TabsTrigger>
          <TabsTrigger value="vault">
            <ShieldCheck className="h-4 w-4 mr-2" /> Vault Security
          </TabsTrigger>
          <TabsTrigger value="extension">
            <Puzzle className="h-4 w-4 mr-2" /> Browser Extension
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company"><CompanyTab role={user?.role} /></TabsContent>
        <TabsContent value="categories"><CategoriesTab /></TabsContent>
        <TabsContent value="locations"><LocationsTab /></TabsContent>
        <TabsContent value="vendors"><VendorsTab /></TabsContent>
        <TabsContent value="offices"><OfficesTab role={user?.role} /></TabsContent>
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
            Auto-fills your vault passwords on matching sites. Sign in and unlock the vault from the
            extension, then it offers credentials whose saved URL matches the page. Passwords only for
            now — more modules will use this same extension later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-3 max-w-md">
            <StatBlock label="Status on this browser" value={statusBlock.label} tone={statusBlock.tone} />
            <StatBlock label="Auto-fill" value="Single match, no auto-submit" />
          </div>

          {state === "installed" ? (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>You&apos;re all set</AlertTitle>
              <AlertDescription>
                The extension is active in this browser. Open it from the toolbar to sign in and unlock the vault.
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
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="EUR">EUR (€)</SelectItem>
                      <SelectItem value="GBP">GBP (£)</SelectItem>
                      <SelectItem value="INR">INR (₹)</SelectItem>
                      <SelectItem value="AED">AED (د.إ)</SelectItem>
                      <SelectItem value="CAD">CAD ($)</SelectItem>
                      <SelectItem value="AUD">AUD ($)</SelectItem>
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
