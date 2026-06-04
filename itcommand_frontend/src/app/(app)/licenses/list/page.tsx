"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Calendar,
  Eye,
  KeyRound,
  MoreHorizontal,
  Pencil,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/store/authStore";
import { useBulkSelection, summarizeBulkDelete } from "@/hooks/use-bulk-selection";
import { AddLicenseDialog } from "../add-license-dialog";

const LICENSE_TYPE_BADGE: Record<string, string> = {
  PERPETUAL: "bg-blue-100 text-blue-800",
  SUBSCRIPTION: "bg-violet-100 text-violet-800",
  VOLUME: "bg-amber-100 text-amber-800",
  OEM: "bg-neutral-100 text-neutral-800",
  OPEN_SOURCE: "bg-emerald-100 text-emerald-800",
  TRIAL: "bg-rose-100 text-rose-800",
};

interface License {
  id: number;
  product_name: string;
  product_vendor: string;
  license_type: string;
  seats_used: number;
  seats_total: number | null;
  seats_usage_pct: number;
  annual_cost: number;
  billing_cycle: string | null;
  expiry_date: string | null;
  is_expired: boolean;
  is_active: boolean;
  auto_renew?: boolean;
}

export default function LicenseListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("true");

  const sel = useBulkSelection<number>();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Edit dialog
  const [editTarget, setEditTarget] = useState<any | null>(null);

  // Renew dialog
  const [renewTarget, setRenewTarget] = useState<License | null>(null);
  const [renewForm, setRenewForm] = useState({
    new_expiry: "",
    cost: "",
    seats_added: "",
    notes: "",
  });
  const [suggestedExpiry, setSuggestedExpiry] = useState<string | null>(null);
  const [renewing, setRenewing] = useState(false);
  const [runningAuto, setRunningAuto] = useState(false);

  useEffect(() => {
    fetchLicenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  const fetchLicenses = async () => {
    setLoading(true);
    try {
      let url = `/licenses/?search=${encodeURIComponent(search)}`;
      if (statusFilter) url += `&is_active=${statusFilter}`;
      const res = await api.get(url);
      setLicenses(res.data.results || res.data);
    } catch {
      toast.error("Failed to fetch licenses");
    } finally {
      setLoading(false);
    }
  };

  const deleteLicense = async (lic: License) => {
    if (!confirm(`Delete ${lic.product_name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/licenses/${lic.id}/`);
      toast.success("License deleted.");
      fetchLicenses();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to delete license.");
    }
  };

  const bulkDelete = async () => {
    if (sel.count === 0) return;
    if (!confirm(`Delete ${sel.count} license(s)? Licenses with active seat assignments will be skipped.`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post("/licenses/bulk_delete/", { ids: sel.ids });
      const sum = summarizeBulkDelete(res.data);
      if (sum.kind === "success") toast.success(sum.message);
      else toast(sum.message);
      const blocked: any[] = res.data?.blocked || [];
      if (blocked.length) {
        const sample = blocked.slice(0, 3).map((b: any) => `${b.name || b.id}: ${b.reason}`).join(" · ");
        toast(sample, { duration: 5000 });
      }
      sel.clear();
      fetchLicenses();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Bulk delete failed.");
    } finally {
      setBulkDeleting(false);
    }
  };

  const openEdit = async (lic: License) => {
    try {
      // The list serializer omits some fields; fetch the full record so
      // the edit dialog can pre-populate cost / notes / purchase_date.
      const res = await api.get(`/licenses/${lic.id}/`);
      setEditTarget(res.data);
    } catch {
      toast.error("Failed to load license details.");
    }
  };

  const openRenew = async (lic: License) => {
    setRenewTarget(lic);
    setRenewForm({ new_expiry: "", cost: "", seats_added: "", notes: "" });
    setSuggestedExpiry(null);
    try {
      const res = await api.get(`/licenses/${lic.id}/suggest_next_expiry/`);
      if (res.data?.suggested_expiry) {
        setSuggestedExpiry(res.data.suggested_expiry);
        setRenewForm((f) => ({ ...f, new_expiry: res.data.suggested_expiry }));
      }
    } catch {
      /* non-blocking — user can still type the date */
    }
  };

  const runAutoRenewals = async () => {
    setRunningAuto(true);
    try {
      const res = await api.post("/licenses/process_auto_renewals/", {});
      const count: number = res.data?.renewed_count || 0;
      const items: any[] = res.data?.renewed || [];
      if (count === 0) {
        toast("No licenses needed auto-renewal.");
      } else {
        toast.success(`Auto-renewed ${count} license(s).`);
        // Show details for up to 3
        items.slice(0, 3).forEach((r: any) => {
          toast(`${r.name}: ${r.previous_expiry} → ${r.new_expiry}`, { duration: 5000 });
        });
        fetchLicenses();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Auto-renewal run failed.");
    } finally {
      setRunningAuto(false);
    }
  };

  const submitRenew = async () => {
    if (!renewTarget || !renewForm.new_expiry) {
      toast.error("New expiry date is required.");
      return;
    }
    setRenewing(true);
    try {
      const payload: any = { new_expiry: renewForm.new_expiry };
      if (renewForm.cost) payload.cost = parseFloat(renewForm.cost);
      if (renewForm.seats_added) payload.seats_added = parseInt(renewForm.seats_added, 10);
      if (renewForm.notes) payload.notes = renewForm.notes;
      await api.post(`/licenses/${renewTarget.id}/renew/`, payload);
      toast.success(`Renewed until ${renewForm.new_expiry}.`);
      setRenewTarget(null);
      fetchLicenses();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Renewal failed.");
    } finally {
      setRenewing(false);
    }
  };

  const visibleIds = licenses.map((l) => l.id);

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-violet-500" /> All Licenses
          </h1>
          <p className="text-neutral-500">Manage software licenses across the organization</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              onClick={runAutoRenewals}
              disabled={runningAuto}
              title="Process every license with auto_renew=true whose expiry has lapsed"
            >
              <PlayCircle className="h-4 w-4 mr-2" />
              {runningAuto ? "Running…" : "Run auto-renewals"}
            </Button>
          )}
          {isAdmin && <AddLicenseDialog onSuccess={fetchLicenses} />}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-center bg-white dark:bg-neutral-900 p-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
          <Input
            placeholder="Search products or vendors..."
            className="pl-9 bg-neutral-50 dark:bg-neutral-800 border-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {[
            { v: "", label: "All", cls: "bg-violet-100 border-violet-200 text-violet-800" },
            { v: "true", label: "Active", cls: "bg-emerald-100 border-emerald-200 text-emerald-800" },
            { v: "false", label: "Inactive", cls: "bg-neutral-100 border-neutral-200 text-neutral-800" },
          ].map((f) => (
            <Badge
              key={f.v}
              variant="outline"
              className={`cursor-pointer whitespace-nowrap ${statusFilter === f.v ? f.cls : ""}`}
              onClick={() => setStatusFilter(f.v)}
            >
              {f.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {isAdmin && sel.count > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="text-sm"><span className="font-medium">{sel.count}</span> selected</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={sel.clear}>Clear</Button>
            <Button variant="destructive" size="sm" onClick={bulkDelete} disabled={bulkDeleting}>
              {bulkDeleting ? "Deleting…" : `Delete ${sel.count}`}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-neutral-50 dark:bg-neutral-800/50">
              <TableRow>
                {isAdmin && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={sel.allSelected(visibleIds) || (sel.someSelected(visibleIds) ? "indeterminate" : false)}
                      onCheckedChange={() => sel.toggleAll(visibleIds)}
                      aria-label="Select all"
                    />
                  </TableHead>
                )}
                <TableHead>Product</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Cost/Year</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 8 : 6} className="h-24 text-center">
                    <div className="flex justify-center"><div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /></div>
                  </TableCell>
                </TableRow>
              ) : licenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 8 : 6} className="h-24 text-center text-neutral-500">
                    No licenses found.
                  </TableCell>
                </TableRow>
              ) : (
                licenses.map((lic) => (
                  <TableRow
                    key={lic.id}
                    data-state={sel.isSelected(lic.id) ? "selected" : undefined}
                    className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                  >
                    {isAdmin && (
                      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={sel.isSelected(lic.id)}
                          onCheckedChange={() => sel.toggle(lic.id)}
                          aria-label={`Select ${lic.product_name}`}
                        />
                      </TableCell>
                    )}
                    <TableCell className="cursor-pointer" onClick={() => router.push(`/licenses/${lic.id}`)}>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 font-bold text-neutral-500">
                          {lic.product_name.charAt(0)}
                        </div>
                        <div>
                          <div className="font-medium text-sm text-neutral-900 dark:text-neutral-100">{lic.product_name}</div>
                          <div className="text-xs text-neutral-500">{lic.product_vendor}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={`${LICENSE_TYPE_BADGE[lic.license_type] || "bg-neutral-100"} border-0 text-[10px]`}>
                        {lic.license_type.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 w-32">
                        <div className="flex justify-between text-xs">
                          <span>{lic.seats_used} used</span>
                          <span className="text-neutral-500">{lic.seats_total ?? "∞"} total</span>
                        </div>
                        <div className="w-full bg-neutral-200 dark:bg-neutral-700 rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${lic.seats_usage_pct >= 100 ? 'bg-red-500' : 'bg-violet-500'}`}
                            style={{ width: `${Math.min(lic.seats_usage_pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">Rs {lic.annual_cost.toLocaleString()}</div>
                      <div className="text-[10px] text-neutral-500">{lic.billing_cycle ? lic.billing_cycle.replace("_", " ") : "N/A"}</div>
                    </TableCell>
                    <TableCell>
                      {lic.expiry_date ? (
                        <div className="flex items-center gap-2">
                          <span className={`text-sm ${lic.is_expired ? 'text-red-500 font-medium' : ''}`}>{lic.expiry_date}</span>
                          {lic.is_expired && <AlertCircle className="w-3 h-3 text-red-500" />}
                          {lic.auto_renew && (
                            <span title="Auto-renew enabled" className="inline-flex items-center text-violet-600 dark:text-violet-400">
                              <RefreshCw className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-neutral-500">Perpetual</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={lic.is_active ? "default" : "secondary"} className={lic.is_active ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-0" : ""}>
                        {lic.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onSelect={() => router.push(`/licenses/${lic.id}`)}>
                              <Eye className="h-4 w-4 mr-2" /> View
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setTimeout(() => openEdit(lic), 50)}>
                              <Pencil className="h-4 w-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            {(lic.billing_cycle === "MONTHLY" || lic.billing_cycle === "YEARLY") && (
                              <DropdownMenuItem onSelect={() => setTimeout(() => openRenew(lic), 50)}>
                                <RotateCcw className="h-4 w-4 mr-2" /> Renew
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                              onSelect={() => setTimeout(() => deleteLicense(lic), 50)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Renew dialog */}
      <Dialog open={!!renewTarget} onOpenChange={(v) => !v && setRenewTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renew {renewTarget?.product_name}</DialogTitle>
            <DialogDescription>
              {renewTarget?.expiry_date
                ? <>Current expiry: <span className="font-medium">{renewTarget.expiry_date}</span></>
                : "No expiry on file."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> New expiry date
                <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                value={renewForm.new_expiry}
                onChange={(e) => setRenewForm({ ...renewForm, new_expiry: e.target.value })}
              />
              {suggestedExpiry && (
                <div className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                  <span>
                    Suggested from billing cycle ({renewTarget?.billing_cycle?.toLowerCase()}):
                    <span className="font-mono font-medium ml-1 text-violet-600 dark:text-violet-400">{suggestedExpiry}</span>
                  </span>
                  {renewForm.new_expiry !== suggestedExpiry && (
                    <button
                      type="button"
                      className="text-violet-600 hover:underline"
                      onClick={() => setRenewForm({ ...renewForm, new_expiry: suggestedExpiry })}
                    >
                      Use suggestion
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Renewal cost</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={renewForm.cost}
                  onChange={(e) => setRenewForm({ ...renewForm, cost: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Seats added</label>
                <Input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={renewForm.seats_added}
                  onChange={(e) => setRenewForm({ ...renewForm, seats_added: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={renewForm.notes}
                onChange={(e) => setRenewForm({ ...renewForm, notes: e.target.value })}
                placeholder="PO number, renewal contact, terms changes…"
                className="min-h-20"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewTarget(null)} disabled={renewing}>Cancel</Button>
            <Button onClick={submitRenew} disabled={renewing || !renewForm.new_expiry}>
              {renewing ? "Renewing…" : "Renew"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog (reuses AddLicenseDialog in edit mode) */}
      <AddLicenseDialog
        open={!!editTarget}
        onOpenChange={(v) => { if (!v) setEditTarget(null); }}
        onSuccess={() => { setEditTarget(null); fetchLicenses(); }}
        initial={editTarget}
      />
    </div>
  );
}
