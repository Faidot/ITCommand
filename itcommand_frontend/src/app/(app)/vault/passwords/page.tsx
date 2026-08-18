"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus, Search, Shield, Copy, Eye, EyeOff, Lock, Edit, Trash2,
  GitBranch, Database, Server, Share2, Globe, Cloud, Layout,
  Star, StarOff, RefreshCw, ExternalLink, Download, AlertTriangle, Clock,
  LayoutGrid, List, KeySquare, MoreHorizontal, X, Tag as TagIcon,
  ShieldCheck, ClipboardCheck, FileKey2, Copy as CopyIcon, Wand2,
  Mail, ChevronRight, Building2, Wifi, Key, FileText,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { downloadBlob } from "@/lib/download";
import { canVerifyClipboard, clearClipboardIfUnchanged, copyText } from "@/lib/clipboard";
import { useAuthStore } from "@/store/authStore";
import { ShareCredentialDialog } from "@/components/vault/share-credential-dialog";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ───────────── Types ─────────────

export interface VaultCredential {
  id: number;
  title: string;
  username: string;
  masked_password?: string;
  url: string | null;
  category: string;
  workspace_tag: string;
  notes: string | null;
  tags: string[];
  workspace: number | null;
  workspace_name: string | null;
  workspace_platform: string | null;
  has_totp: boolean;
  has_recovery_codes: boolean;
  has_custom_fields: boolean;
  created_by_name: string;
  is_shared: boolean;
  visibility: "ORG" | "PRIVATE";
  is_owner: boolean;
  shared_with: { id: number; name: string; shared_at: string }[];
  share_count: number;
  is_favorite: boolean;
  last_revealed_at: string | null;
  last_revealed_by_name: string | null;
  reveal_count: number;
  rotation_due_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Stats {
  total: number;
  favorites: number;
  shared: number;
  rotation_due_soon: number;
  by_category: Record<string, number>;
  with_totp: number;
}

interface WorkspaceLite {
  id: number;
  name: string;
  platform: string;
}

interface CustomField {
  key: string;
  value: string;
}

// ───────────── Form schema ─────────────

const formSchema = z.object({
  title: z.string().min(2),
  username: z.string().min(1),
  password: z.string().optional(),
  url: z.string().optional(),
  category: z.string(),
  workspace_tag: z.string().optional(),
  workspace: z.string().optional(),
  notes: z.string().optional(),
  is_shared: z.boolean(),
  rotation_due_at: z.string().optional(),
  tags_input: z.string().optional(),
  totp_secret: z.string().optional(),
  recovery_codes_input: z.string().optional(), // newline separated
});

type FormValues = z.infer<typeof formSchema>;

const COPY_CLEAR_MS = 30_000;
const REVEAL_HIDE_MS = 15_000;

const CATEGORY_OPTIONS = [
  { value: "GITHUB", label: "GitHub" },
  { value: "GOOGLE", label: "Google" },
  { value: "AWS", label: "AWS" },
  { value: "AZURE", label: "Azure" },
  { value: "DATABASE", label: "Database" },
  { value: "SERVER", label: "Server" },
  { value: "SOCIAL", label: "Social" },
  { value: "EMAIL", label: "Email" },
  { value: "SSH", label: "SSH Key" },
  { value: "API", label: "API Key" },
  { value: "WIFI", label: "Wi-Fi" },
  { value: "OTHER", label: "Other" },
];

// ───────────── Page ─────────────

export default function PasswordsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [credentials, setCredentials] = useState<VaultCredential[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceLite[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [workspaceFilter, setWorkspaceFilter] = useState("ALL");
  const [tagFilter, setTagFilter] = useState("ALL");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sharedOnly, setSharedOnly] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCred, setEditingCred] = useState<VaultCredential | null>(null);
  const [extraCustomFields, setExtraCustomFields] = useState<CustomField[]>([]);

  // Selection mode
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Detail drawer
  const [detailId, setDetailId] = useState<number | null>(null);

  // Private (end-to-end) sharing dialog
  const [shareTarget, setShareTarget] = useState<VaultCredential | null>(null);

  const [revealedPasswords, setRevealedPasswords] = useState<{ [key: number]: string }>({});
  const [lastAccessed, setLastAccessed] = useState<{ [key: number]: Date }>({});
  const timersRef = useRef<{ [key: number]: ReturnType<typeof setTimeout> }>({});

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "", username: "", password: "", url: "", category: "OTHER",
      workspace_tag: "", workspace: "", notes: "", is_shared: false,
      rotation_due_at: "", tags_input: "", totp_secret: "", recovery_codes_input: "",
    },
  });

  // ───── Fetchers

  const fetchCredentials = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (categoryFilter !== "ALL") params.append("category", categoryFilter);
      if (workspaceFilter !== "ALL") params.append("workspace", workspaceFilter);
      if (tagFilter !== "ALL") params.append("tag", tagFilter);
      if (searchQuery) params.append("search", searchQuery);
      if (favoritesOnly) params.append("favorites_only", "1");
      if (sharedOnly) params.append("shared_only", "1");

      const res = await api.get(`/vault/credentials/?${params.toString()}`);
      setCredentials(res.data);
    } catch (err: any) {
      if (err.response?.status === 403 || err.response?.status === 401) {
        sessionStorage.removeItem("vault_unlock_token");
        sessionStorage.removeItem("vault_unlock_expires");
        window.location.reload();
        return;
      }
      const detail = err.response?.data?.detail || err.message || "";
      toast.error(`Failed to load credentials.${detail ? ` ${detail}` : ""}`);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get("/vault/credentials/stats/");
      setStats(res.data);
    } catch {/* silent */}
  };

  const fetchWorkspaces = async () => {
    try {
      const res = await api.get("/vault/workspaces/?page_size=200");
      const data: WorkspaceLite[] = (res.data || []).map((w: any) => ({
        id: w.id, name: w.name, platform: w.platform,
      }));
      setWorkspaces(data);
    } catch {/* silent */}
  };

  const fetchTags = async () => {
    try {
      const res = await api.get("/vault/credentials/tags/");
      setAllTags(res.data || []);
    } catch {/* silent */}
  };

  useEffect(() => {
    const handler = setTimeout(() => { fetchCredentials(); }, 400);
    return () => clearTimeout(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, categoryFilter, workspaceFilter, tagFilter, favoritesOnly, sharedOnly]);

  useEffect(() => {
    fetchStats();
    fetchTags();
  }, [credentials.length]);

  useEffect(() => { fetchWorkspaces(); }, []);

  // ───── Dialog open/close

  const openAddDialog = () => {
    setEditingCred(null);
    setExtraCustomFields([]);
    form.reset({
      title: "", username: "", password: "", url: "", category: "OTHER",
      workspace_tag: "", workspace: "", notes: "", is_shared: false,
      rotation_due_at: "", tags_input: "", totp_secret: "", recovery_codes_input: "",
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = async (c: VaultCredential) => {
    setEditingCred(c);
    form.reset({
      title: c.title, username: c.username, password: "", url: c.url || "",
      category: c.category, workspace_tag: c.workspace_tag || "",
      workspace: c.workspace ? String(c.workspace) : "",
      notes: c.notes || "", is_shared: c.is_shared,
      rotation_due_at: c.rotation_due_at || "",
      tags_input: (c.tags || []).join(", "),
      totp_secret: "", recovery_codes_input: "",
    });

    // Prefetch extras for editing
    setExtraCustomFields([]);
    if (c.has_totp || c.has_recovery_codes || c.has_custom_fields) {
      try {
        const r = await api.get(`/vault/credentials/${c.id}/reveal_extras/`);
        if (r.data?.totp_secret) form.setValue("totp_secret", r.data.totp_secret);
        if (r.data?.recovery_codes?.length) {
          form.setValue("recovery_codes_input", r.data.recovery_codes.join("\n"));
        }
        if (r.data?.custom_fields) {
          setExtraCustomFields(
            Object.entries(r.data.custom_fields).map(([key, value]) => ({
              key, value: String(value),
            }))
          );
        }
      } catch {/* silent */}
    }
    setIsDialogOpen(true);
  };

  // ───── Mutators

  const parseTags = (raw?: string): string[] =>
    (raw || "").split(",").map((t) => t.trim()).filter(Boolean);

  const parseRecoveryCodes = (raw?: string): string[] =>
    (raw || "").split(/[\n,]+/).map((c) => c.trim()).filter(Boolean);

  const buildCustomFields = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const f of extraCustomFields) {
      const k = f.key.trim();
      if (k) out[k] = f.value;
    }
    return out;
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const payload: any = {
        title: values.title,
        username: values.username,
        url: values.url || "",
        category: values.category,
        workspace_tag: values.workspace_tag || "",
        workspace: values.workspace ? Number(values.workspace) : null,
        notes: values.notes || "",
        is_shared: values.is_shared,
        rotation_due_at: values.rotation_due_at || null,
        tags: parseTags(values.tags_input),
      };

      // Password — required on create, optional on edit
      if (values.password) payload.password = values.password;

      // Extras — always send (empty string clears)
      payload.totp_secret = values.totp_secret || "";
      payload.recovery_codes = parseRecoveryCodes(values.recovery_codes_input);
      payload.custom_fields = buildCustomFields();

      if (editingCred) {
        if (!payload.password) delete payload.password;
        await api.put(`/vault/credentials/${editingCred.id}/`, payload);
        toast.success("Credential updated.");
      } else {
        if (!payload.password) return toast.error("Password is required for new credentials.");
        await api.post("/vault/credentials/", payload);
        toast.success("Credential saved securely.");
      }
      setIsDialogOpen(false);
      fetchCredentials();
    } catch (err: any) {
      const data = err.response?.data;
      toast.error(data?.detail || (typeof data === "string" ? data : JSON.stringify(data || {})) || "An error occurred.");
    }
  };

  const deleteCred = async (id: number) => {
    if (!confirm("Delete this credential? This cannot be undone.")) return;
    try {
      await api.delete(`/vault/credentials/${id}/`);
      toast.success("Credential deleted.");
      fetchCredentials();
    } catch {
      toast.error("Failed to delete credential.");
    }
  };

  const duplicateCred = async (id: number) => {
    try {
      await api.post(`/vault/credentials/${id}/duplicate/`, {});
      toast.success("Credential duplicated.");
      fetchCredentials();
    } catch {
      toast.error("Duplicate failed.");
    }
  };

  const copyToClipboard = async (text: string, type: string) => {
    if (!(await copyText(text))) {
      toast.error(`Could not copy the ${type.toLowerCase()}. Select it and copy by hand.`);
      return;
    }
    // Only promise the auto-clear where we can actually keep it. Reading the
    // clipboard back needs a permission that writing does not, and telling
    // someone their password will disappear in 30 seconds when it will not is
    // the kind of false reassurance this screen exists to avoid.
    if (canVerifyClipboard()) {
      toast.success(`${type} copied — clipboard auto-clears in ${Math.round(COPY_CLEAR_MS / 1000)}s.`);
      setTimeout(() => { void clearClipboardIfUnchanged(text); }, COPY_CLEAR_MS);
    } else {
      toast.success(`${type} copied. Clear your clipboard when you are done.`);
    }
  };

  const revealPassword = async (id: number) => {
    if (revealedPasswords[id]) {
      if (timersRef.current[id]) clearTimeout(timersRef.current[id]);
      setRevealedPasswords((prev) => {
        const n = { ...prev }; delete n[id]; return n;
      });
      return;
    }
    try {
      const res = await api.get(`/vault/credentials/${id}/reveal/`);
      const pwd = res.data.password;
      setRevealedPasswords((prev) => ({ ...prev, [id]: pwd }));
      setLastAccessed((prev) => ({ ...prev, [id]: new Date() }));
      if (timersRef.current[id]) clearTimeout(timersRef.current[id]);
      timersRef.current[id] = setTimeout(() => {
        setRevealedPasswords((prev) => {
          const n = { ...prev }; delete n[id]; return n;
        });
      }, REVEAL_HIDE_MS);
    } catch {
      toast.error("Failed to decrypt password.");
    }
  };

  const toggleFavorite = async (id: number) => {
    try {
      await api.post(`/vault/credentials/${id}/toggle_favorite/`, {});
      fetchCredentials();
    } catch {
      toast.error("Failed to update favorite.");
    }
  };

  // ───── Generator

  const generatePassword = async (target: "form" | "copy" = "form") => {
    try {
      const res = await api.get("/vault/generate-password/?length=20&symbols=true");
      const pwd = res.data.password;
      if (target === "form") {
        form.setValue("password", pwd, { shouldValidate: true, shouldDirty: true });
      }
      if (await copyText(pwd)) {
        toast.success("Strong password generated and copied to clipboard.");
      } else {
        toast.success("Strong password generated. Copy it from the field.");
      }
    } catch {
      toast.error("Failed to generate password.");
    }
  };

  // ───── Bulk actions

  const toggleSelect = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (checked) n.add(id); else n.delete(id);
      return n;
    });
  };
  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(credentials.map((c) => c.id)) : new Set());
  };
  const clearSelection = () => { setSelectedIds(new Set()); };

  const bulkAction = async (action: string, value?: any) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      await api.post("/vault/credentials/bulk_action/", { ids, action, value });
      const verbMap: Record<string, string> = {
        delete: "deleted", favorite_on: "favorited", favorite_off: "unfavorited",
        share_on: "shared", share_off: "unshared",
        set_category: "categorized", set_workspace: "linked", add_tag: "tagged", remove_tag: "untagged",
      };
      toast.success(`${ids.length} credential${ids.length > 1 ? "s" : ""} ${verbMap[action] || "updated"}.`);
      setSelectedIds(new Set());
      fetchCredentials();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Bulk action failed.");
    }
  };

  // ───── Export

  const exportCsv = () => {
    const rows = [
      ["title", "username", "url", "category", "workspace", "workspace_tag", "tags",
        "is_shared", "rotation_due_at", "reveal_count", "last_revealed_at", "created_by"],
      ...credentials.map((c) => [
        c.title, c.username, c.url ?? "", c.category, c.workspace_name ?? "",
        c.workspace_tag, (c.tags || []).join("|"), String(c.is_shared),
        c.rotation_due_at ?? "", String(c.reveal_count), c.last_revealed_at ?? "", c.created_by_name ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(csv, `vault-credentials-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv");
    toast.success("Metadata exported (passwords are never included).");
  };

  // ───── Strength

  const getPasswordStrength = (pwd: string | undefined) => {
    if (!pwd) return { label: "", pct: 0, color: "bg-neutral-200" };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (pwd.length >= 16) score++;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
    if (/\d/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;
    const tiers = [
      { label: "Very weak", pct: 15, color: "bg-red-500" },
      { label: "Weak", pct: 30, color: "bg-orange-500" },
      { label: "Fair", pct: 50, color: "bg-amber-500" },
      { label: "Good", pct: 70, color: "bg-blue-500" },
      { label: "Strong", pct: 88, color: "bg-emerald-500" },
      { label: "Excellent", pct: 100, color: "bg-emerald-600" },
    ];
    return tiers[Math.min(score, tiers.length - 1)];
  };

  const pwdWatch = form.watch("password");
  const pwdStrength = getPasswordStrength(pwdWatch);

  // ───── UI helpers

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case "GITHUB": return <GitBranch className="w-5 h-5" />;
      case "DATABASE": return <Database className="w-5 h-5" />;
      case "SERVER": return <Server className="w-5 h-5" />;
      case "GOOGLE": return <Globe className="w-5 h-5" />;
      case "AWS":
      case "AZURE": return <Cloud className="w-5 h-5" />;
      case "SOCIAL": return <Share2 className="w-5 h-5" />;
      case "EMAIL": return <Mail className="w-5 h-5" />;
      case "SSH": return <KeySquare className="w-5 h-5" />;
      case "API": return <Key className="w-5 h-5" />;
      case "WIFI": return <Wifi className="w-5 h-5" />;
      default: return <Layout className="w-5 h-5" />;
    }
  };

  const rotationBadge = (dateStr: string | null) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (days < 0) return <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="w-2.5 h-2.5 mr-1" />Rotation overdue</Badge>;
    if (days <= 7) return <Badge className="text-[10px] bg-amber-100 text-amber-800 hover:bg-amber-200 border-0"><Clock className="w-2.5 h-2.5 mr-1" />Rotate in {days}d</Badge>;
    return null;
  };

  const dueSoonItems = useMemo(
    () => credentials.filter((c) => {
      if (!c.rotation_due_at) return false;
      const days = Math.ceil((new Date(c.rotation_due_at).getTime() - Date.now()) / 86_400_000);
      return days <= 7;
    }),
    [credentials]
  );

  const detailCred = useMemo(
    () => credentials.find((c) => c.id === detailId) || null,
    [credentials, detailId]
  );

  if (!isAdmin) {
    return <div className="p-8 text-center text-red-500">Access Denied. Admin privileges required.</div>;
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto h-full p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-600" /> Password Vault
          </h1>
          <p className="text-neutral-500">
            Securely store credentials, MFA secrets, recovery codes, and link them to platform workspaces.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={selectionMode ? "default" : "outline"}
            onClick={() => { setSelectionMode((v) => !v); setSelectedIds(new Set()); }}
          >
            <ClipboardCheck className="mr-2 h-4 w-4" />
            {selectionMode ? "Done" : "Select"}
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" /> Add Credential
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <SummaryTile label="Total" value={stats.total} />
          <SummaryTile label="Favorites" value={stats.favorites} icon={<Star className="w-4 h-4 text-amber-500" />} />
          <SummaryTile label="Shared" value={stats.shared} icon={<Share2 className="w-4 h-4 text-blue-500" />} />
          <SummaryTile label="With MFA" value={stats.with_totp} icon={<ShieldCheck className="w-4 h-4 text-emerald-500" />} />
          <SummaryTile
            label="Rotate ≤7d"
            value={stats.rotation_due_soon}
            icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
            tone={stats.rotation_due_soon > 0 ? "warn" : undefined}
          />
        </div>
      )}

      {dueSoonItems.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4" /> {dueSoonItems.length} credential{dueSoonItems.length > 1 ? "s" : ""} need rotation soon
          </div>
          <div className="mt-1 text-xs text-amber-800 dark:text-amber-300 truncate">
            {dueSoonItems.slice(0, 5).map((c) => c.title).join(" · ")}
            {dueSoonItems.length > 5 ? ` and ${dueSoonItems.length - 5} more` : ""}
          </div>
        </div>
      )}

      {/* Filters row */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500" />
          <Input
            placeholder="Search title, username, tag, URL, workspace…"
            className="pl-9 bg-white dark:bg-neutral-900"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Categories</SelectItem>
            {CATEGORY_OPTIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
          <SelectTrigger className="w-[180px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Workspace" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Workspaces</SelectItem>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {allTags.length > 0 && (
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-[160px] bg-white dark:bg-neutral-900">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Tags</SelectItem>
              {allTags.map((t) => (<SelectItem key={t} value={t}>#{t}</SelectItem>))}
            </SelectContent>
          </Select>
        )}

        <Button
          variant={favoritesOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setFavoritesOnly((v) => !v)}
        >
          <Star className={`w-4 h-4 mr-2 ${favoritesOnly ? "fill-current" : ""}`} />
          Favorites
        </Button>
        <Button
          variant={sharedOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setSharedOnly((v) => !v)}
        >
          <Share2 className="w-4 h-4 mr-2" />
          Shared
        </Button>

        <div className="ml-auto inline-flex border rounded-md overflow-hidden bg-white dark:bg-neutral-900">
          <button
            onClick={() => setViewMode("grid")}
            className={`px-2 py-1 ${viewMode === "grid" ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
            title="Grid"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-2 py-1 ${viewMode === "list" ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
            title="List"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectionMode && (
        <div className="sticky top-0 z-10 rounded-lg border bg-white dark:bg-neutral-900 shadow-sm p-2 flex flex-wrap items-center gap-2">
          <Checkbox
            checked={selectedIds.size > 0 && selectedIds.size === credentials.length}
            onCheckedChange={(v) => toggleSelectAll(!!v)}
          />
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>

          <Select onValueChange={(v) => bulkAction("set_category", v)}>
            <SelectTrigger size="sm" className="w-[140px]"><SelectValue placeholder="Set category" /></SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select onValueChange={(v) => bulkAction("set_workspace", v === "_clear" ? null : Number(v))}>
            <SelectTrigger size="sm" className="w-[160px]"><SelectValue placeholder="Link to workspace" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="_clear">(none)</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button size="sm" variant="outline" onClick={() => bulkAction("favorite_on")} disabled={!selectedIds.size}>
            <Star className="w-3.5 h-3.5 mr-1" /> Favorite
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkAction("favorite_off")} disabled={!selectedIds.size}>
            <StarOff className="w-3.5 h-3.5 mr-1" /> Unfavorite
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkAction("share_on")} disabled={!selectedIds.size}>
            <Share2 className="w-3.5 h-3.5 mr-1" /> Share
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulkAction("share_off")} disabled={!selectedIds.size}>
            <Share2 className="w-3.5 h-3.5 mr-1" /> Unshare
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!selectedIds.size}
            onClick={() => {
              if (confirm(`Delete ${selectedIds.size} credential(s)? This cannot be undone.`)) bulkAction("delete");
            }}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
          </Button>

          {selectedIds.size > 0 && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={clearSelection}>
              <X className="w-3.5 h-3.5 mr-1" /> Clear
            </Button>
          )}
        </div>
      )}

      {/* Body */}
      {isLoading ? (
        <div className="text-center py-10 text-neutral-500">Decrypting vault…</div>
      ) : credentials.length === 0 ? (
        <div className="text-center py-10 text-neutral-500">No credentials found in the vault.</div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {credentials.map((c) => (
            <CredentialCard
              key={c.id}
              c={c}
              selectionMode={selectionMode}
              selected={selectedIds.has(c.id)}
              onSelect={(v) => toggleSelect(c.id, v)}
              revealed={revealedPasswords[c.id]}
              onReveal={() => revealPassword(c.id)}
              onCopy={(text, type) => copyToClipboard(text, type)}
              onEdit={() => openEditDialog(c)}
              onDelete={() => deleteCred(c.id)}
              onDuplicate={() => duplicateCred(c.id)}
              onFavorite={() => toggleFavorite(c.id)}
              onOpenDetails={() => setDetailId(c.id)}
              onShare={() => setShareTarget(c)}
              lastAccessed={lastAccessed[c.id]}
              icon={getCategoryIcon(c.category)}
              rotationChip={rotationBadge(c.rotation_due_at)}
            />
          ))}
        </div>
      ) : (
        <CredentialList
          items={credentials}
          selectionMode={selectionMode}
          selectedIds={selectedIds}
          onSelect={(id, v) => toggleSelect(id, v)}
          onSelectAll={(v) => toggleSelectAll(v)}
          revealedMap={revealedPasswords}
          lastAccessedMap={lastAccessed}
          onReveal={revealPassword}
          onCopy={copyToClipboard}
          onEdit={openEditDialog}
          onDelete={deleteCred}
          onDuplicate={duplicateCred}
          onFavorite={toggleFavorite}
          onOpenDetails={(id) => setDetailId(id)}
          onShare={(c) => setShareTarget(c)}
          rotationChip={rotationBadge}
          icon={getCategoryIcon}
        />
      )}

      {/* CREATE / EDIT DIALOG */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[640px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCred ? "Edit Credential" : "Add Secure Credential"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
              <Tabs defaultValue="basics" className="w-full">
                <TabsList>
                  <TabsTrigger value="basics"><Key className="w-3.5 h-3.5 mr-1" /> Basics</TabsTrigger>
                  <TabsTrigger value="link"><Building2 className="w-3.5 h-3.5 mr-1" /> Link & Tags</TabsTrigger>
                  <TabsTrigger value="security"><ShieldCheck className="w-3.5 h-3.5 mr-1" /> Security Extras</TabsTrigger>
                  <TabsTrigger value="notes"><FileText className="w-3.5 h-3.5 mr-1" /> Notes</TabsTrigger>
                </TabsList>

                <TabsContent value="basics" className="space-y-4 pt-3">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl><Input placeholder="Prod Database" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username / Email</FormLabel>
                          <FormControl><Input placeholder="admin" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <FormLabel>Password {editingCred && <span className="text-xs text-neutral-400 font-normal">(blank keeps current)</span>}</FormLabel>
                            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={() => generatePassword("form")}>
                              <Wand2 className="w-3 h-3 mr-1" /> Generate
                            </Button>
                          </div>
                          <FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl>
                          {field.value && (
                            <div className="mt-1 flex items-center gap-2">
                              <div className="h-1 flex-1 bg-neutral-200 rounded-full overflow-hidden">
                                <div className={`h-full ${pwdStrength.color} transition-all`} style={{ width: `${pwdStrength.pct}%` }} />
                              </div>
                              <span className="text-[10px] uppercase font-bold text-neutral-500 w-16 text-right">{pwdStrength.label}</span>
                            </div>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {CATEGORY_OPTIONS.map((c) => (
                                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="url"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>URL (Optional)</FormLabel>
                          <FormControl><Input placeholder="https://..." {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="rotation_due_at"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Rotation Due Date (Optional)</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="is_shared"
                    render={({ field }) => (
                      <FormItem className="flex items-start justify-between gap-3 rounded-lg border p-3">
                        <div>
                          <FormLabel>Share with team</FormLabel>
                          <p className="text-xs text-muted-foreground">
                            Visible to all users with vault access (after they unlock).
                          </p>
                        </div>
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </TabsContent>

                <TabsContent value="link" className="space-y-4 pt-3">
                  <FormField
                    control={form.control}
                    name="workspace"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Account Workspace (Optional)</FormLabel>
                        <Select onValueChange={(v) => field.onChange(v === "_none" ? "" : v)} value={field.value || "_none"}>
                          <FormControl><SelectTrigger><SelectValue placeholder="(none)" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="_none">(none)</SelectItem>
                            {workspaces.map((w) => (
                              <SelectItem key={w.id} value={String(w.id)}>{w.name} — {w.platform}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">Group this credential under a managed platform/subscription.</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="workspace_tag"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project / Client Tag (Optional)</FormLabel>
                        <FormControl><Input placeholder="e.g. Client ABC" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="tags_input"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Tags (comma-separated)</FormLabel>
                        <FormControl><Input placeholder="prod, billing, oncall" {...field} /></FormControl>
                        <p className="text-[11px] text-muted-foreground">Tags help quickly filter credentials.</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>

                <TabsContent value="security" className="space-y-4 pt-3">
                  <FormField
                    control={form.control}
                    name="totp_secret"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>TOTP / MFA Secret (Optional)</FormLabel>
                        <FormControl><Input placeholder="Base32 secret from QR — JBSWY3DPEHPK3PXP" className="font-mono" {...field} /></FormControl>
                        <p className="text-[11px] text-muted-foreground">Stored encrypted. Reveal it later to enroll in any authenticator app.</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="recovery_codes_input"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Recovery / Backup Codes (Optional)</FormLabel>
                        <FormControl>
                          <Textarea placeholder={"One per line, e.g.:\nXXXX-YYYY-ZZZZ\nAAAA-BBBB-CCCC"} className="min-h-24 font-mono text-xs" {...field} />
                        </FormControl>
                        <p className="text-[11px] text-muted-foreground">Stored encrypted; never shown in plain text in lists.</p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium">Custom Fields (Optional)</label>
                        <p className="text-[11px] text-muted-foreground">e.g. API base URL, account ID, security questions.</p>
                      </div>
                      <Button type="button" size="sm" variant="outline"
                        onClick={() => setExtraCustomFields((s) => [...s, { key: "", value: "" }])}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add field
                      </Button>
                    </div>
                    {extraCustomFields.length > 0 && (
                      <div className="space-y-2">
                        {extraCustomFields.map((f, i) => (
                          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                            <Input
                              placeholder="Field name"
                              value={f.key}
                              onChange={(e) => setExtraCustomFields((s) => s.map((row, j) => j === i ? { ...row, key: e.target.value } : row))}
                              className="text-xs"
                            />
                            <Input
                              placeholder="Value"
                              value={f.value}
                              onChange={(e) => setExtraCustomFields((s) => s.map((row, j) => j === i ? { ...row, value: e.target.value } : row))}
                              className="text-xs font-mono"
                            />
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8"
                              onClick={() => setExtraCustomFields((s) => s.filter((_, j) => j !== i))}>
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="notes" className="pt-3">
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl><Textarea placeholder="Scope of access, related contacts, anything teammates should know…" className="min-h-36" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>
              </Tabs>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit"><Lock className="w-4 h-4 mr-2" /> {editingCred ? "Update Securely" : "Save Securely"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* DETAIL DRAWER */}
      <CredentialDetailDrawer
        cred={detailCred}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        onEdit={(c) => { setDetailId(null); setTimeout(() => openEditDialog(c), 50); }}
        onCopy={copyToClipboard}
        onReveal={revealPassword}
        revealedMap={revealedPasswords}
        onShare={(c) => { setDetailId(null); setTimeout(() => setShareTarget(c), 50); }}
      />

      {/* PRIVATE SHARE DIALOG */}
      <ShareCredentialDialog
        credentialId={shareTarget?.id ?? null}
        credentialTitle={shareTarget?.title ?? ""}
        open={shareTarget !== null}
        onOpenChange={(v) => { if (!v) setShareTarget(null); }}
        onShared={fetchCredentials}
      />
    </div>
  );
}

// ───────────── Card view item ─────────────

function CredentialCard({
  c, selectionMode, selected, onSelect,
  revealed, onReveal, onCopy, onEdit, onDelete, onDuplicate, onFavorite, onOpenDetails, onShare,
  lastAccessed, icon, rotationChip,
}: {
  c: VaultCredential;
  selectionMode: boolean;
  selected: boolean;
  onSelect: (v: boolean) => void;
  revealed?: string;
  onReveal: () => void;
  onCopy: (text: string, type: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onFavorite: () => void;
  onOpenDetails: () => void;
  onShare: () => void;
  lastAccessed?: Date;
  icon: React.ReactNode;
  rotationChip: React.ReactNode;
}) {
  return (
    <Card className={`relative overflow-hidden group hover:shadow-md transition-all ${selected ? "ring-2 ring-emerald-500" : ""}`}>
      {selectionMode && (
        <div className="absolute left-2 top-2 z-10">
          <Checkbox checked={selected} onCheckedChange={(v) => onSelect(!!v)} />
        </div>
      )}
      <CardHeader className={`pb-2 ${selectionMode ? "pl-9" : ""}`}>
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-neutral-100 dark:bg-neutral-800 rounded-md shrink-0">{icon}</div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate cursor-pointer hover:underline" onClick={onOpenDetails}>{c.title}</CardTitle>
              <div className="flex items-center gap-1 mt-1 flex-wrap">
                {c.workspace_name && (
                  <Badge variant="outline" className="text-[10px]"><Building2 className="w-2.5 h-2.5 mr-0.5" /> {c.workspace_name}</Badge>
                )}
                {c.workspace_tag && <Badge variant="secondary" className="text-xs">{c.workspace_tag}</Badge>}
                {c.visibility === "PRIVATE"
                  ? <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700"><Share2 className="w-2.5 h-2.5 mr-0.5" /> Private{c.share_count ? ` · ${c.share_count}` : ""}</Badge>
                  : c.is_shared && <Badge variant="outline" className="text-[10px]">Shared</Badge>}
                {c.has_totp && <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700"><ShieldCheck className="w-2.5 h-2.5 mr-0.5" /> MFA</Badge>}
                {rotationChip}
              </div>
              {c.tags && c.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.tags.slice(0, 4).map((t) => (
                    <span key={t} className="text-[10px] text-neutral-500 bg-neutral-100 dark:bg-neutral-800 rounded px-1.5">#{t}</span>
                  ))}
                  {c.tags.length > 4 && <span className="text-[10px] text-neutral-400">+{c.tags.length - 4}</span>}
                </div>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onFavorite}
            title={c.is_favorite ? "Remove from favorites" : "Mark favorite"}
          >
            {c.is_favorite
              ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              : <StarOff className="h-4 w-4 text-neutral-400" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        <div className="space-y-1">
          <p className="text-xs text-neutral-500 font-medium">Username</p>
          <div className="flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 px-3 py-2 rounded border border-neutral-200 dark:border-neutral-800">
            <span className="text-sm font-mono truncate">{c.username}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onCopy(c.username, "Username")}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-neutral-500 font-medium">Password</p>
          <div className="flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 px-3 py-2 rounded border border-neutral-200 dark:border-neutral-800">
            <span className="text-sm font-mono tracking-widest truncate">
              {revealed || "••••••••"}
            </span>
            <div className="flex gap-1">
              {revealed && (
                <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600" onClick={() => onCopy(revealed, "Password")}>
                  <Copy className="h-3 w-3" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onReveal}>
                {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </Button>
            </div>
          </div>
        </div>

        {c.url && (
          <a href={c.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline truncate">
            <ExternalLink className="w-3 h-3 shrink-0" /> {c.url}
          </a>
        )}

        {lastAccessed && (
          <p className="text-[10px] text-emerald-600 text-right">
            Revealed {lastAccessed.toLocaleTimeString()} · hides in {REVEAL_HIDE_MS / 1000}s
          </p>
        )}

        {c.last_revealed_at && !lastAccessed && (
          <p className="text-[10px] text-neutral-400">
            Last revealed by {c.last_revealed_by_name || "—"} · {c.reveal_count} total
          </p>
        )}
      </CardContent>
      <CardFooter className="bg-neutral-50 dark:bg-neutral-900/50 py-2 px-4 flex justify-between items-center border-t">
        <button onClick={onOpenDetails} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5">
          Details <ChevronRight className="w-3 h-3" />
        </button>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Edit">
            <Edit className="h-3 w-3" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-3 w-3" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setTimeout(onShare, 50)}>
                <Share2 className="w-3.5 h-3.5 mr-2" /> Share privately
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTimeout(onDuplicate, 50)}>
                <CopyIcon className="w-3.5 h-3.5 mr-2" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:bg-destructive focus:text-destructive-foreground" onSelect={() => setTimeout(onDelete, 50)}>
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardFooter>
    </Card>
  );
}

// ───────────── List view ─────────────

function CredentialList({
  items, selectionMode, selectedIds, onSelect, onSelectAll,
  revealedMap, lastAccessedMap, onReveal, onCopy, onEdit, onDelete, onDuplicate, onFavorite, onOpenDetails, onShare,
  rotationChip, icon,
}: {
  items: VaultCredential[];
  selectionMode: boolean;
  selectedIds: Set<number>;
  onSelect: (id: number, v: boolean) => void;
  onSelectAll: (v: boolean) => void;
  revealedMap: { [k: number]: string };
  lastAccessedMap: { [k: number]: Date };
  onReveal: (id: number) => void;
  onCopy: (text: string, type: string) => void;
  onEdit: (c: VaultCredential) => void;
  onDelete: (id: number) => void;
  onDuplicate: (id: number) => void;
  onFavorite: (id: number) => void;
  onOpenDetails: (id: number) => void;
  onShare: (c: VaultCredential) => void;
  rotationChip: (d: string | null) => React.ReactNode;
  icon: (cat: string) => React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="divide-y">
        {selectionMode && (
          <div className="flex items-center gap-2 px-3 py-2 bg-neutral-50 dark:bg-neutral-900">
            <Checkbox
              checked={selectedIds.size > 0 && selectedIds.size === items.length}
              onCheckedChange={(v) => onSelectAll(!!v)}
            />
            <span className="text-xs text-neutral-500">Select all on this view</span>
          </div>
        )}
        {items.map((c) => {
          const revealed = revealedMap[c.id];
          return (
            <div key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-900/50">
              {selectionMode && (
                <Checkbox checked={selectedIds.has(c.id)} onCheckedChange={(v) => onSelect(c.id, !!v)} />
              )}
              <div className="p-1.5 bg-neutral-100 dark:bg-neutral-800 rounded">{icon(c.category)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <button className="font-medium truncate hover:underline text-left" onClick={() => onOpenDetails(c.id)}>{c.title}</button>
                  {c.is_favorite && <Star className="w-3 h-3 fill-amber-400 text-amber-400" />}
                  {c.workspace_name && <Badge variant="outline" className="text-[10px]"><Building2 className="w-2.5 h-2.5 mr-0.5" />{c.workspace_name}</Badge>}
                  {c.has_totp && <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700"><ShieldCheck className="w-2.5 h-2.5 mr-0.5" />MFA</Badge>}
                  {rotationChip(c.rotation_due_at)}
                </div>
                <div className="text-xs text-neutral-500 truncate font-mono">{c.username}</div>
              </div>
              <div className="hidden sm:flex items-center gap-1 text-xs font-mono">
                <span className="tracking-widest">{revealed || "••••••••"}</span>
                {revealed && (
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600" onClick={() => onCopy(revealed, "Password")}>
                    <Copy className="h-3 w-3" />
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onReveal(c.id)}>
                  {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onFavorite(c.id)} title="Favorite">
                {c.is_favorite ? <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> : <StarOff className="h-3.5 w-3.5 text-neutral-400" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(c)} title="Edit">
                <Edit className="h-3.5 w-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onCopy(c.username, "Username")}>
                    <Copy className="w-3.5 h-3.5 mr-2" /> Copy Username
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTimeout(() => onShare(c), 50)}>
                    <Share2 className="w-3.5 h-3.5 mr-2" /> Share privately
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTimeout(() => onDuplicate(c.id), 50)}>
                    <CopyIcon className="w-3.5 h-3.5 mr-2" /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onOpenDetails(c.id)}>
                    <ChevronRight className="w-3.5 h-3.5 mr-2" /> Open details
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                    onSelect={() => setTimeout(() => onDelete(c.id), 50)}>
                    <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {lastAccessedMap[c.id] && (
                <span className="text-[10px] text-emerald-600 ml-1">just revealed</span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ───────────── Detail drawer ─────────────

function CredentialDetailDrawer({
  cred, open, onClose, onEdit, onCopy, onReveal, revealedMap, onShare,
}: {
  cred: VaultCredential | null;
  open: boolean;
  onClose: () => void;
  onEdit: (c: VaultCredential) => void;
  onCopy: (text: string, type: string) => void;
  onReveal: (id: number) => void;
  revealedMap: { [k: number]: string };
  onShare: (c: VaultCredential) => void;
}) {
  const [extras, setExtras] = useState<{ totp_secret: string | null; recovery_codes: string[]; custom_fields: Record<string, string> } | null>(null);
  const [loadingExtras, setLoadingExtras] = useState(false);

  useEffect(() => {
    setExtras(null);
    if (!cred || !open) return;
    if (!(cred.has_totp || cred.has_recovery_codes || cred.has_custom_fields)) return;
    let cancel = false;
    setLoadingExtras(true);
    api.get(`/vault/credentials/${cred.id}/reveal_extras/`)
      .then((r) => { if (!cancel) setExtras(r.data); })
      .catch(() => { if (!cancel) toast.error("Failed to load extras"); })
      .finally(() => { if (!cancel) setLoadingExtras(false); });
    return () => { cancel = true; };
  }, [cred, open]);

  if (!cred) return null;
  const revealed = revealedMap[cred.id];

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="sm:max-w-md w-[95vw] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-600" /> {cred.title}
          </SheetTitle>
          <SheetDescription>
            <span className="font-mono text-xs">{cred.username}</span>
            {cred.workspace_name && (
              <> · <Badge variant="outline" className="text-[10px] inline-flex"><Building2 className="w-2.5 h-2.5 mr-0.5" />{cred.workspace_name}</Badge></>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="p-4 space-y-4">
          {/* Quick info row */}
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="text-xs">{cred.category}</Badge>
            {cred.visibility === "PRIVATE"
              ? <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700">Private{cred.share_count ? ` · shared with ${cred.share_count}` : ""}</Badge>
              : cred.is_shared && <Badge variant="outline" className="text-[10px]">Shared</Badge>}
            {cred.has_totp && <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700">MFA enrolled</Badge>}
            {cred.rotation_due_at && (
              <Badge variant="outline" className="text-[10px]">Rotate {cred.rotation_due_at}</Badge>
            )}
          </div>

          {/* Username / Password */}
          <FieldRow label="Username" mono>
            <span className="truncate">{cred.username}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onCopy(cred.username, "Username")}>
              <Copy className="w-3 h-3" />
            </Button>
          </FieldRow>

          <FieldRow label="Password" mono>
            <span className="tracking-widest truncate">{revealed || "••••••••"}</span>
            <div className="flex gap-1">
              {revealed && (
                <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-600" onClick={() => onCopy(revealed, "Password")}>
                  <Copy className="w-3 h-3" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onReveal(cred.id)}>
                {revealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </Button>
            </div>
          </FieldRow>

          {cred.url && (
            <FieldRow label="URL">
              <a href={cred.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate text-xs flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> {cred.url}
              </a>
            </FieldRow>
          )}

          {cred.tags && cred.tags.length > 0 && (
            <div>
              <div className="text-xs text-neutral-500 mb-1 flex items-center gap-1"><TagIcon className="w-3 h-3" /> Tags</div>
              <div className="flex flex-wrap gap-1">
                {cred.tags.map((t) => (
                  <span key={t} className="text-[11px] bg-neutral-100 dark:bg-neutral-800 rounded px-2 py-0.5">#{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* Extras */}
          {(cred.has_totp || cred.has_recovery_codes || cred.has_custom_fields) && (
            <div className="rounded-md border p-3 space-y-3">
              <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 flex items-center gap-1">
                <FileKey2 className="w-3.5 h-3.5 text-emerald-600" /> Security Extras
              </div>
              {loadingExtras && <div className="text-xs text-neutral-500">Decrypting…</div>}
              {extras?.totp_secret && (
                <FieldRow label="MFA Secret" mono>
                  <span className="truncate text-xs">{extras.totp_secret}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onCopy(extras.totp_secret!, "TOTP secret")}>
                    <Copy className="w-3 h-3" />
                  </Button>
                </FieldRow>
              )}
              {extras?.recovery_codes && extras.recovery_codes.length > 0 && (
                <div>
                  <div className="text-xs text-neutral-500 mb-1 flex items-center justify-between">
                    <span>Recovery Codes</span>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                      onClick={() => onCopy(extras.recovery_codes.join("\n"), "Recovery codes")}>
                      <Copy className="w-3 h-3 mr-1" /> Copy all
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-1 font-mono text-xs">
                    {extras.recovery_codes.map((code, i) => (
                      <div key={i} className="bg-neutral-50 dark:bg-neutral-900 rounded px-2 py-1 flex items-center justify-between">
                        <span>{code}</span>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => onCopy(code, `Code ${i + 1}`)}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {extras?.custom_fields && Object.keys(extras.custom_fields).length > 0 && (
                <div>
                  <div className="text-xs text-neutral-500 mb-1">Custom fields</div>
                  <div className="space-y-1.5">
                    {Object.entries(extras.custom_fields).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 rounded px-2 py-1 text-xs">
                        <div className="flex flex-col min-w-0">
                          <span className="text-[10px] text-neutral-500">{k}</span>
                          <span className="font-mono truncate">{v}</span>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onCopy(String(v), k)}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {cred.notes && (
            <div className="rounded-md border p-3">
              <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1">Notes</div>
              <p className="text-sm whitespace-pre-wrap">{cred.notes}</p>
            </div>
          )}

          <div className="text-[11px] text-neutral-400 grid grid-cols-2 gap-1">
            <div>Created by</div><div className="text-right">{cred.created_by_name}</div>
            <div>Created</div><div className="text-right">{new Date(cred.created_at).toLocaleDateString()}</div>
            <div>Last updated</div><div className="text-right">{new Date(cred.updated_at).toLocaleDateString()}</div>
            <div>Reveals</div><div className="text-right">{cred.reveal_count}</div>
            {cred.last_revealed_at && (
              <>
                <div>Last revealed</div><div className="text-right">{new Date(cred.last_revealed_at).toLocaleString()}</div>
                <div>By</div><div className="text-right">{cred.last_revealed_by_name}</div>
              </>
            )}
          </div>
        </div>

        <SheetFooter className="border-t p-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="outline" onClick={() => onShare(cred)}><Share2 className="w-4 h-4 mr-2" /> Share</Button>
          <Button onClick={() => onEdit(cred)}><Edit className="w-4 h-4 mr-2" /> Edit</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FieldRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-neutral-500 font-medium">{label}</p>
      <div className={`flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 px-3 py-2 rounded border border-neutral-200 dark:border-neutral-800 text-sm ${mono ? "font-mono" : ""}`}>
        {children}
      </div>
    </div>
  );
}

function SummaryTile({
  label, value, icon, tone,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: "warn";
}) {
  const toneCls = tone === "warn" ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20" : "";
  return (
    <div className={`rounded-lg border p-3 bg-white dark:bg-neutral-900 ${toneCls}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-500">{label}</span>
        {icon}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
