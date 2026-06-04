"use client";

import { useEffect, useState, useMemo } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus, Search, Building2, MoreHorizontal, Link as LinkIcon, Edit, Trash2,
  Copy, AlertTriangle, DollarSign, Calendar, Download, ExternalLink,
  LayoutGrid, List, RefreshCcw, Users, Mail, ChevronRight, Briefcase,
  CheckCircle2, PauseCircle, XCircle, FlaskConical, Shield,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";

// ───────────── Types ─────────────

export interface AccountWorkspace {
  id: number;
  name: string;
  platform: string;
  login_email: string;
  account_url: string | null;
  owner_name: string;
  subscription_plan: string | null;
  renewal_date: string | null;
  monthly_cost: string | null;
  annual_cost: number | null;
  status: "ACTIVE" | "TRIAL" | "PAUSED" | "CANCELLED";
  billing_cycle: "MONTHLY" | "QUARTERLY" | "ANNUAL" | "CUSTOM";
  seats: number | null;
  billing_email: string;
  support_url: string | null;
  auto_renew: boolean;
  last_renewed_at: string | null;
  notes: string | null;
  created_by_name: string;
  credential_count: number;
}

interface Stats {
  total: number;
  active: number;
  trial: number;
  paused: number;
  cancelled: number;
  expired: number;
  renewing_soon: number;
  monthly_total: number;
  annual_total: number;
  by_status: Record<string, number>;
}

interface LinkedCredential {
  id: number;
  title: string;
  username: string;
  category: string;
  is_favorite: boolean;
  is_shared: boolean;
  has_totp: boolean;
}

// ───────────── Form schema ─────────────

const formSchema = z.object({
  name: z.string().min(2),
  platform: z.string(),
  login_email: z.string().email(),
  account_url: z.string().optional(),
  owner_name: z.string().min(2),
  subscription_plan: z.string().optional(),
  renewal_date: z.string().optional(),
  monthly_cost: z.string().optional(),
  status: z.string(),
  billing_cycle: z.string(),
  seats: z.string().optional(),
  billing_email: z.string().optional(),
  support_url: z.string().optional(),
  auto_renew: z.boolean(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

const PLATFORM_OPTIONS = [
  "GITHUB", "GOOGLE_WORKSPACE", "AZURE_AD", "SLACK", "JIRA", "FIGMA",
  "AWS", "NOTION", "LINEAR", "CLOUDFLARE", "OTHER",
];

// ───────────── Page ─────────────

export default function WorkspacesPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [workspaces, setWorkspaces] = useState<AccountWorkspace[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "TRIAL" | "PAUSED" | "CANCELLED">("ALL");
  const [cycleFilter, setCycleFilter] = useState<"ALL" | "MONTHLY" | "QUARTERLY" | "ANNUAL" | "CUSTOM">("ALL");
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingWs, setEditingWs] = useState<AccountWorkspace | null>(null);

  const [detailId, setDetailId] = useState<number | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", platform: "OTHER", login_email: "", account_url: "",
      owner_name: "", subscription_plan: "", renewal_date: "", monthly_cost: "",
      status: "ACTIVE", billing_cycle: "MONTHLY", seats: "",
      billing_email: "", support_url: "", auto_renew: true, notes: "",
    },
  });

  const fetchWorkspaces = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (platformFilter !== "ALL") params.append("platform", platformFilter);
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (cycleFilter !== "ALL") params.append("billing_cycle", cycleFilter);
      if (searchQuery) params.append("search", searchQuery);

      const res = await api.get(`/vault/workspaces/?${params.toString()}`);
      setWorkspaces(res.data);
    } catch (err: any) {
      if (err.response?.status === 403 || err.response?.status === 401) {
        sessionStorage.removeItem("vault_unlock_token");
        sessionStorage.removeItem("vault_unlock_expires");
        window.location.reload();
        return;
      }
      const detail = err.response?.data?.detail || err.message || "";
      toast.error(`Failed to load workspaces.${detail ? ` ${detail}` : ""}`);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get("/vault/workspaces/stats/");
      setStats(res.data);
    } catch { /* silent */ }
  };

  useEffect(() => {
    const handler = setTimeout(() => { fetchWorkspaces(); }, 400);
    return () => clearTimeout(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, platformFilter, statusFilter, cycleFilter]);

  useEffect(() => { fetchStats(); }, [workspaces.length]);

  const openAddDialog = () => {
    setEditingWs(null);
    form.reset({
      name: "", platform: "OTHER", login_email: "", account_url: "",
      owner_name: "", subscription_plan: "", renewal_date: "", monthly_cost: "",
      status: "ACTIVE", billing_cycle: "MONTHLY", seats: "",
      billing_email: "", support_url: "", auto_renew: true, notes: "",
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (ws: AccountWorkspace) => {
    setEditingWs(ws);
    form.reset({
      name: ws.name, platform: ws.platform, login_email: ws.login_email, account_url: ws.account_url || "",
      owner_name: ws.owner_name, subscription_plan: ws.subscription_plan || "",
      renewal_date: ws.renewal_date || "", monthly_cost: ws.monthly_cost || "",
      status: ws.status, billing_cycle: ws.billing_cycle,
      seats: ws.seats != null ? String(ws.seats) : "",
      billing_email: ws.billing_email || "", support_url: ws.support_url || "",
      auto_renew: ws.auto_renew, notes: ws.notes || "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const payload: any = {
        ...values,
        renewal_date: values.renewal_date || null,
        monthly_cost: values.monthly_cost ? parseFloat(values.monthly_cost) : null,
        seats: values.seats ? Math.max(0, parseInt(values.seats, 10)) : null,
        billing_email: values.billing_email || "",
      };

      if (editingWs) {
        await api.put(`/vault/workspaces/${editingWs.id}/`, payload);
        toast.success("Workspace updated.");
      } else {
        await api.post("/vault/workspaces/", payload);
        toast.success("Workspace added.");
      }
      setIsDialogOpen(false);
      fetchWorkspaces();
    } catch (err: any) {
      const data = err.response?.data;
      toast.error(data?.detail || (typeof data === "string" ? data : JSON.stringify(data || {})) || "An error occurred.");
    }
  };

  const deleteWs = async (id: number) => {
    if (!confirm("Delete this workspace? Linked credentials will be detached.")) return;
    try {
      await api.delete(`/vault/workspaces/${id}/`);
      toast.success("Workspace deleted.");
      fetchWorkspaces();
    } catch {
      toast.error("Failed to delete workspace.");
    }
  };

  const markRenewed = async (id: number) => {
    try {
      await api.post(`/vault/workspaces/${id}/mark_renewed/`, {});
      toast.success("Renewal recorded — date advanced.");
      fetchWorkspaces();
    } catch {
      toast.error("Failed to mark renewed.");
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied.`);
  };

  const exportCsv = () => {
    const rows = [
      ["name", "platform", "status", "billing_cycle", "seats", "login_email", "billing_email",
        "owner", "plan", "monthly_cost", "annual_cost", "renewal_date", "auto_renew", "account_url"],
      ...workspaces.map((w) => [
        w.name, w.platform, w.status, w.billing_cycle, w.seats ?? "",
        w.login_email, w.billing_email, w.owner_name,
        w.subscription_plan ?? "", w.monthly_cost ?? "", w.annual_cost ?? "",
        w.renewal_date ?? "", String(w.auto_renew), w.account_url ?? "",
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `vault-workspaces-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported workspaces.");
  };

  const renderRenewalBadge = (dateStr: string | null) => {
    if (!dateStr) return <span className="text-neutral-400 text-sm">N/A</span>;
    const renewal = new Date(dateStr);
    const now = new Date();
    const diffTime = renewal.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return <Badge variant="destructive">Expired {Math.abs(diffDays)}d ago</Badge>;
    if (diffDays <= 7) return <Badge className="bg-red-100 text-red-800 hover:bg-red-200 border-0">Renews in {diffDays}d</Badge>;
    if (diffDays <= 30) return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-0">Renews in {diffDays}d</Badge>;
    return <span className="text-sm">{renewal.toLocaleDateString()}</span>;
  };

  const upcoming = useMemo(
    () => workspaces.filter((w) => {
      if (!w.renewal_date) return false;
      const days = Math.ceil((new Date(w.renewal_date).getTime() - Date.now()) / 86_400_000);
      return days <= 30;
    }).sort((a, b) => (a.renewal_date || "").localeCompare(b.renewal_date || "")),
    [workspaces]
  );

  const detailWs = useMemo(
    () => workspaces.find((w) => w.id === detailId) || null,
    [workspaces, detailId]
  );

  const statusBadge = (st: AccountWorkspace["status"]) => {
    switch (st) {
      case "ACTIVE": return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-0 text-[10px]"><CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />Active</Badge>;
      case "TRIAL": return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-0 text-[10px]"><FlaskConical className="w-2.5 h-2.5 mr-0.5" />Trial</Badge>;
      case "PAUSED": return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200 border-0 text-[10px]"><PauseCircle className="w-2.5 h-2.5 mr-0.5" />Paused</Badge>;
      case "CANCELLED": return <Badge variant="outline" className="text-[10px] text-neutral-500"><XCircle className="w-2.5 h-2.5 mr-0.5" />Cancelled</Badge>;
    }
  };

  if (!isAdmin) {
    return <div className="p-8 text-center text-red-500">Access Denied. Admin privileges required.</div>;
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto h-full p-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-600" /> Account Workspaces
          </h1>
          <p className="text-neutral-500">
            Manage organizational SaaS subscriptions, seats, billing cycles, and linked credentials.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" /> Add Workspace
          </Button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <Tile label="Workspaces" value={String(stats.total)} icon={<Building2 className="w-4 h-4 text-blue-500" />} />
          <Tile label="Active" value={String(stats.active)} icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} />
          <Tile label="Trials" value={String(stats.trial)} icon={<FlaskConical className="w-4 h-4 text-blue-500" />} />
          <Tile label="Monthly" value={`$${stats.monthly_total.toFixed(2)}`} icon={<DollarSign className="w-4 h-4 text-emerald-500" />} />
          <Tile label="Annual est." value={`$${stats.annual_total.toFixed(0)}`} icon={<DollarSign className="w-4 h-4 text-emerald-500" />} />
          <Tile label="Renew ≤30d" value={String(stats.renewing_soon)} icon={<Calendar className="w-4 h-4 text-amber-500" />} tone={stats.renewing_soon > 0 ? "warn" : undefined} />
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200 mb-1.5">
            <AlertTriangle className="w-4 h-4" /> Upcoming renewals ({upcoming.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {upcoming.slice(0, 10).map((w) => (
              <span key={w.id} className="text-xs bg-white/60 dark:bg-neutral-900/60 px-2 py-1 rounded border border-amber-200 flex items-center gap-1">
                <span className="font-medium">{w.name}</span>
                <span className="text-amber-700 dark:text-amber-300">· {w.renewal_date}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5 ml-1" onClick={() => markRenewed(w.id)} title="Mark renewed">
                  <RefreshCcw className="w-3 h-3" />
                </Button>
              </span>
            ))}
            {upcoming.length > 10 && (
              <span className="text-xs text-amber-700 dark:text-amber-300">+{upcoming.length - 10} more</span>
            )}
          </div>
        </div>
      )}

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        {(["ALL", "ACTIVE", "TRIAL", "PAUSED", "CANCELLED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors
              ${statusFilter === s
                ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 border-neutral-900 dark:border-neutral-100"
                : "bg-white dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
          >
            {s === "ALL" ? "All Statuses" : s.charAt(0) + s.slice(1).toLowerCase()}
            {stats && s !== "ALL" && (
              <span className="ml-1 text-neutral-400">({(stats as any)[s.toLowerCase()] ?? 0})</span>
            )}
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500" />
          <Input
            placeholder="Search name, email, owner, plan…"
            className="pl-9 bg-white dark:bg-neutral-900"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-[180px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Platforms</SelectItem>
            {PLATFORM_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={cycleFilter} onValueChange={(v) => setCycleFilter(v as any)}>
          <SelectTrigger className="w-[150px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Billing" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All cycles</SelectItem>
            <SelectItem value="MONTHLY">Monthly</SelectItem>
            <SelectItem value="QUARTERLY">Quarterly</SelectItem>
            <SelectItem value="ANNUAL">Annual</SelectItem>
            <SelectItem value="CUSTOM">Custom</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto inline-flex border rounded-md overflow-hidden bg-white dark:bg-neutral-900">
          <button onClick={() => setViewMode("grid")} className={`px-2 py-1 ${viewMode === "grid" ? "bg-neutral-100 dark:bg-neutral-800" : ""}`} title="Grid">
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button onClick={() => setViewMode("table")} className={`px-2 py-1 ${viewMode === "table" ? "bg-neutral-100 dark:bg-neutral-800" : ""}`} title="Table">
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="text-center py-10 text-neutral-500">Loading workspaces…</div>
      ) : workspaces.length === 0 ? (
        <div className="text-center py-10 text-neutral-500">No workspaces found.</div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {workspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              ws={ws}
              statusBadge={statusBadge}
              renderRenewalBadge={renderRenewalBadge}
              onOpenDetails={() => setDetailId(ws.id)}
              onEdit={() => openEditDialog(ws)}
              onDelete={() => deleteWs(ws.id)}
              onMarkRenewed={() => markRenewed(ws.id)}
              onCopyEmail={() => copy(ws.login_email, "Email")}
            />
          ))}
        </div>
      ) : (
        <Card className="flex-1 bg-white dark:bg-neutral-900 overflow-hidden">
          <Table>
            <TableHeader className="bg-neutral-50 dark:bg-neutral-900/50">
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Plan / Cycle</TableHead>
                <TableHead className="text-right">$/mo</TableHead>
                <TableHead>Renewal</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((ws) => (
                <TableRow key={ws.id} className="cursor-pointer" onClick={() => setDetailId(ws.id)}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <button className="font-medium hover:underline text-left" onClick={(e) => { e.stopPropagation(); setDetailId(ws.id); }}>{ws.name}</button>
                      {ws.account_url && (
                        <a href={ws.account_url} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700" onClick={(e) => e.stopPropagation()}>
                          <LinkIcon className="w-3 h-3" />
                        </a>
                      )}
                      {ws.credential_count > 0 && (
                        <Badge variant="outline" className="text-[10px]"><Shield className="w-2.5 h-2.5 mr-0.5" />{ws.credential_count}</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{statusBadge(ws.status)}</TableCell>
                  <TableCell><Badge variant="outline">{ws.platform}</Badge></TableCell>
                  <TableCell className="font-mono text-sm">
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <span className="truncate max-w-[12rem]">{ws.login_email}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copy(ws.login_email, "Email")}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>{ws.owner_name}</TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      <span>{ws.subscription_plan || "Free/Unknown"}</span>
                      <span className="text-[11px] text-neutral-500">{ws.billing_cycle.toLowerCase()}{ws.seats ? ` · ${ws.seats} seats` : ""}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {ws.monthly_cost ? `$${ws.monthly_cost}` : "—"}
                  </TableCell>
                  <TableCell>{renderRenewalBadge(ws.renewal_date)}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onSelect={() => setDetailId(ws.id)}>
                          <ChevronRight className="w-4 h-4 mr-2" /> Open details
                        </DropdownMenuItem>
                        {ws.account_url && (
                          <DropdownMenuItem onSelect={() => window.open(ws.account_url!, "_blank")}>
                            <ExternalLink className="w-4 h-4 mr-2" /> Open account
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => copy(ws.login_email, "Email")}>
                          <Copy className="w-4 h-4 mr-2" /> Copy email
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setTimeout(() => markRenewed(ws.id), 50)}>
                          <RefreshCcw className="w-4 h-4 mr-2" /> Mark renewed
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setTimeout(() => openEditDialog(ws), 100)}>
                          <Edit className="w-4 h-4 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive focus:bg-destructive focus:text-destructive-foreground" onSelect={() => setTimeout(() => deleteWs(ws.id), 100)}>
                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* DIALOG */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[680px] max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingWs ? "Edit Workspace" : "Add Workspace"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Workspace Name</FormLabel>
                      <FormControl><Input placeholder="Terafort GitHub" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="platform"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Platform</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Platform" /></SelectTrigger></FormControl>
                        <SelectContent>
                          {PLATFORM_OPTIONS.map((p) => (
                            <SelectItem key={p} value={p}>{p.replace(/_/g, " ")}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="login_email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Login / Admin Email</FormLabel>
                      <FormControl><Input placeholder="admin@terafort.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="owner_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary Owner</FormLabel>
                      <FormControl><Input placeholder="John Doe" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="TRIAL">Trial</SelectItem>
                          <SelectItem value="PAUSED">Paused</SelectItem>
                          <SelectItem value="CANCELLED">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="billing_cycle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Billing Cycle</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="MONTHLY">Monthly</SelectItem>
                          <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                          <SelectItem value="ANNUAL">Annual</SelectItem>
                          <SelectItem value="CUSTOM">Custom / one-off</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="seats"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Seats (optional)</FormLabel>
                      <FormControl><Input type="number" min={0} placeholder="10" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="subscription_plan"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Plan</FormLabel>
                      <FormControl><Input placeholder="Enterprise" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="monthly_cost"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cost / Period ($)</FormLabel>
                      <FormControl><Input type="number" step="0.01" placeholder="49.99" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="renewal_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Renewal Date</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="billing_email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Billing Email (optional)</FormLabel>
                      <FormControl><Input placeholder="billing@terafort.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="support_url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Support URL (optional)</FormLabel>
                      <FormControl><Input placeholder="https://support…" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="account_url"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account URL (optional)</FormLabel>
                    <FormControl><Input placeholder="https://..." {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="auto_renew"
                render={({ field }) => (
                  <FormItem className="flex items-start justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <FormLabel>Auto-renew</FormLabel>
                      <p className="text-xs text-muted-foreground">Subscription will renew automatically on the renewal date.</p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl><Textarea placeholder="Billing contact, seat count, MFA setup…" className="min-h-20" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit">Save Workspace</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* DETAIL DRAWER */}
      <WorkspaceDetailDrawer
        ws={detailWs}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        onEdit={(w) => { setDetailId(null); setTimeout(() => openEditDialog(w), 50); }}
        onMarkRenewed={(id) => markRenewed(id)}
        onCopy={copy}
        statusBadge={statusBadge}
      />
    </div>
  );
}

// ───────────── Card ─────────────

function WorkspaceCard({
  ws, statusBadge, renderRenewalBadge, onOpenDetails, onEdit, onDelete, onMarkRenewed, onCopyEmail,
}: {
  ws: AccountWorkspace;
  statusBadge: (s: AccountWorkspace["status"]) => React.ReactNode;
  renderRenewalBadge: (d: string | null) => React.ReactNode;
  onOpenDetails: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMarkRenewed: () => void;
  onCopyEmail: () => void;
}) {
  return (
    <Card className="relative overflow-hidden group hover:shadow-md transition-all">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate cursor-pointer hover:underline" onClick={onOpenDetails}>{ws.name}</CardTitle>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              <Badge variant="outline" className="text-[10px]">{ws.platform.replace(/_/g, " ")}</Badge>
              {statusBadge(ws.status)}
              {ws.auto_renew && <Badge variant="outline" className="text-[10px]">Auto-renew</Badge>}
              {ws.credential_count > 0 && (
                <Badge variant="outline" className="text-[10px]"><Shield className="w-2.5 h-2.5 mr-0.5" />{ws.credential_count} creds</Badge>
              )}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpenDetails}>
                <ChevronRight className="w-3.5 h-3.5 mr-2" /> Open details
              </DropdownMenuItem>
              {ws.account_url && (
                <DropdownMenuItem onSelect={() => window.open(ws.account_url!, "_blank")}>
                  <ExternalLink className="w-3.5 h-3.5 mr-2" /> Open account
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onCopyEmail}>
                <Copy className="w-3.5 h-3.5 mr-2" /> Copy email
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTimeout(onMarkRenewed, 50)}>
                <RefreshCcw className="w-3.5 h-3.5 mr-2" /> Mark renewed
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setTimeout(onEdit, 50)}>
                <Edit className="w-3.5 h-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:bg-destructive focus:text-destructive-foreground" onSelect={() => setTimeout(onDelete, 50)}>
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-2 text-sm">
        <div className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
          <Mail className="w-3.5 h-3.5 text-neutral-500" />
          <span className="font-mono text-xs truncate flex-1">{ws.login_email}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCopyEmail}>
            <Copy className="w-3 h-3" />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
          <Briefcase className="w-3.5 h-3.5 text-neutral-500" />
          <span className="text-xs">Owner: <span className="font-medium">{ws.owner_name}</span></span>
        </div>
        {ws.seats != null && (
          <div className="flex items-center gap-2 text-neutral-700 dark:text-neutral-300">
            <Users className="w-3.5 h-3.5 text-neutral-500" />
            <span className="text-xs">{ws.seats} seats</span>
          </div>
        )}
        <div className="flex items-center justify-between border-t pt-2 mt-2">
          <div className="text-xs">
            <span className="text-neutral-500">{ws.billing_cycle.toLowerCase()}: </span>
            <span className="font-medium">{ws.monthly_cost ? `$${ws.monthly_cost}` : "—"}</span>
            {ws.annual_cost != null && (
              <span className="text-neutral-500 ml-1">(${ws.annual_cost.toFixed(0)}/yr)</span>
            )}
          </div>
          <div>{renderRenewalBadge(ws.renewal_date)}</div>
        </div>
      </CardContent>
      <CardFooter className="bg-neutral-50 dark:bg-neutral-900/50 py-2 px-4 flex justify-between items-center border-t">
        <button onClick={onOpenDetails} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5">
          Details <ChevronRight className="w-3 h-3" />
        </button>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMarkRenewed} title="Mark renewed">
            <RefreshCcw className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Edit">
            <Edit className="h-3 w-3" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

// ───────────── Detail Drawer ─────────────

function WorkspaceDetailDrawer({
  ws, open, onClose, onEdit, onMarkRenewed, onCopy, statusBadge,
}: {
  ws: AccountWorkspace | null;
  open: boolean;
  onClose: () => void;
  onEdit: (w: AccountWorkspace) => void;
  onMarkRenewed: (id: number) => void;
  onCopy: (text: string, label: string) => void;
  statusBadge: (s: AccountWorkspace["status"]) => React.ReactNode;
}) {
  const [creds, setCreds] = useState<LinkedCredential[]>([]);
  const [loadingCreds, setLoadingCreds] = useState(false);

  useEffect(() => {
    setCreds([]);
    if (!ws || !open) return;
    let cancel = false;
    setLoadingCreds(true);
    api.get(`/vault/workspaces/${ws.id}/credentials/`)
      .then((r) => { if (!cancel) setCreds(r.data); })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancel) setLoadingCreds(false); });
    return () => { cancel = true; };
  }, [ws, open]);

  if (!ws) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="sm:max-w-md w-[95vw] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" /> {ws.name}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px]">{ws.platform.replace(/_/g, " ")}</Badge>
            {statusBadge(ws.status)}
            {ws.auto_renew && <Badge variant="outline" className="text-[10px]">Auto-renew</Badge>}
          </SheetDescription>
        </SheetHeader>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <DetailRow label="Owner" value={ws.owner_name} />
            <DetailRow label="Plan" value={ws.subscription_plan || "—"} />
            <DetailRow label="Seats" value={ws.seats != null ? String(ws.seats) : "—"} />
            <DetailRow label="Billing cycle" value={ws.billing_cycle.toLowerCase()} />
            <DetailRow label={`Cost / ${ws.billing_cycle.toLowerCase()}`} value={ws.monthly_cost ? `$${ws.monthly_cost}` : "—"} />
            <DetailRow label="Annual est." value={ws.annual_cost != null ? `$${ws.annual_cost.toFixed(2)}` : "—"} />
            <DetailRow label="Renewal" value={ws.renewal_date || "—"} />
            <DetailRow label="Last renewed" value={ws.last_renewed_at || "—"} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 px-3 py-2 rounded border">
              <div>
                <div className="text-[10px] text-neutral-500">Login email</div>
                <div className="font-mono text-sm truncate">{ws.login_email}</div>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onCopy(ws.login_email, "Email")}>
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            {ws.billing_email && (
              <div className="flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 px-3 py-2 rounded border">
                <div>
                  <div className="text-[10px] text-neutral-500">Billing email</div>
                  <div className="font-mono text-sm truncate">{ws.billing_email}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onCopy(ws.billing_email, "Billing email")}>
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              {ws.account_url && (
                <a href={ws.account_url} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="text-xs">
                    <ExternalLink className="w-3 h-3 mr-1.5" /> Open account
                  </Button>
                </a>
              )}
              {ws.support_url && (
                <a href={ws.support_url} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm" className="text-xs">
                    <ExternalLink className="w-3 h-3 mr-1.5" /> Support
                  </Button>
                </a>
              )}
              <Button variant="outline" size="sm" className="text-xs" onClick={() => onMarkRenewed(ws.id)}>
                <RefreshCcw className="w-3 h-3 mr-1.5" /> Mark renewed
              </Button>
            </div>
          </div>

          {/* Linked credentials */}
          <div className="rounded-md border">
            <div className="px-3 py-2 border-b bg-neutral-50 dark:bg-neutral-900 text-xs font-semibold text-neutral-600 dark:text-neutral-300 flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-emerald-600" /> Linked Credentials
              <span className="ml-auto text-neutral-400 font-normal">{creds.length}</span>
            </div>
            {loadingCreds ? (
              <div className="p-3 text-xs text-neutral-500">Loading…</div>
            ) : creds.length === 0 ? (
              <div className="p-3 text-xs text-neutral-500">
                No credentials linked yet. From the Password Vault, set this workspace on a credential to link it here.
              </div>
            ) : (
              <ul className="divide-y">
                {creds.map((c) => (
                  <li key={c.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                    <span className="font-medium truncate flex-1">{c.title}</span>
                    <span className="font-mono text-xs text-neutral-500 truncate">{c.username}</span>
                    {c.has_totp && <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700">MFA</Badge>}
                    {c.is_shared && <Badge variant="outline" className="text-[10px]">Shared</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {ws.notes && (
            <div className="rounded-md border p-3">
              <div className="text-xs font-semibold text-neutral-600 dark:text-neutral-300 mb-1">Notes</div>
              <p className="text-sm whitespace-pre-wrap">{ws.notes}</p>
            </div>
          )}

          <div className="text-[11px] text-neutral-400 grid grid-cols-2 gap-1">
            <div>Added by</div><div className="text-right">{ws.created_by_name}</div>
          </div>
        </div>

        <SheetFooter className="border-t p-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={() => onEdit(ws)}><Edit className="w-4 h-4 mr-2" /> Edit</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

// ───────────── Tiles ─────────────

function Tile({
  label, value, icon, tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "warn" | "danger";
}) {
  const toneCls =
    tone === "warn" ? "border-amber-200 bg-amber-50/50 dark:bg-amber-950/20"
      : tone === "danger" ? "border-red-200 bg-red-50/50 dark:bg-red-950/20"
        : "";
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
