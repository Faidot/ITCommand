"use client";

import { useEffect, useState } from "react";
import { Building, Search, Plus, Star, MoreHorizontal, FileText, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AddVendorDialog } from "./add-vendor-dialog";
import { ContractCalendarWidget } from "./calendar-widget";
import { useAuthStore } from "@/store/authStore";
import { useBulkSelection, summarizeBulkDelete } from "@/hooks/use-bulk-selection";
import { useMoney, useCurrencyCode } from "@/lib/currency";

export default function VendorsPage() {
  const money = useMoney();
  const router = useRouter();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const [vendors, setVendors] = useState<any[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const sel = useBulkSelection<number>();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const bulkDelete = async () => {
    if (sel.count === 0) return;
    if (!confirm(`Delete ${sel.count} vendor(s)? Vendors linked to assets/contracts/licenses will be skipped.`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post("/vendors/bulk_delete/", { ids: sel.ids });
      const sum = summarizeBulkDelete(res.data);
      if (sum.kind === "success") toast.success(sum.message);
      else toast(sum.message);
      const blocked: any[] = res.data?.blocked || [];
      if (blocked.length) {
        const sample = blocked.slice(0, 3).map((b: any) => `${b.name || b.id}: ${b.reason}`).join(" · ");
        toast(sample, { duration: 5000 });
      }
      sel.clear();
      fetchVendors();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Bulk delete failed.");
    } finally {
      setBulkDeleting(false);
    }
  };

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Dialogs
  const [addVendorOpen, setAddVendorOpen] = useState(false);

  useEffect(() => {
    fetchDashboard();
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      fetchVendors();
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery, categoryFilter, statusFilter]);

  const fetchDashboard = async () => {
    try {
      const res = await api.get("/vendors/dashboard/");
      setDashboard(res.data);
    } catch {
      console.error("Failed to load vendor dashboard");
    }
  };

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append("search", searchQuery);
      if (categoryFilter !== "ALL") params.append("category", categoryFilter);
      if (statusFilter !== "ALL") {
        params.append("is_active", statusFilter === "ACTIVE" ? "true" : "false");
      }
      
      const res = await api.get(`/vendors/?${params.toString()}`);
      setVendors(res.data.results || res.data);
    } catch {
      toast.error("Failed to load vendors");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return money(amount, { decimals: 0 });
  };

  const renderStars = (rating: number) => {
    if (!rating) return <span className="text-neutral-400 text-xs">Unrated</span>;
    return (
      <div className="flex items-center">
        {[1,2,3,4,5].map(i => (
          <Star key={i} className={`w-3 h-3 ${i <= rating ? "text-yellow-400 fill-yellow-400" : "text-neutral-200 dark:text-neutral-800"}`} />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building className="h-6 w-6 text-violet-500" /> Vendor Management
          </h1>
          <p className="text-neutral-500">Manage suppliers, contracts, and procurement payments.</p>
        </div>
        <Button onClick={() => setAddVendorOpen(true)} className="bg-violet-600 hover:bg-violet-700">
          <Plus className="mr-2 h-4 w-4" /> Add Vendor
        </Button>
      </div>

      {dashboard && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4 flex flex-col justify-center">
            <div className="text-neutral-500 text-sm font-medium mb-1">Total Vendors</div>
            <div className="text-3xl font-bold">{dashboard.total_vendors}</div>
          </Card>
          <Card className="p-4 flex flex-col justify-center">
            <div className="text-neutral-500 text-sm font-medium mb-1">Active Contracts</div>
            <div className="text-3xl font-bold text-blue-600">{dashboard.active_contracts}</div>
          </Card>
          <Card className="p-4 flex flex-col justify-center">
            <div className="text-neutral-500 text-sm font-medium mb-1">Expiring Soon</div>
            <div className="text-3xl font-bold text-amber-500">{dashboard.contracts_expiring_within_30_days?.length || 0}</div>
          </Card>
          <Card className="p-4 flex flex-col justify-center">
            <div className="text-neutral-500 text-sm font-medium mb-1">Total Spend (YTD)</div>
            <div className="text-2xl font-bold text-emerald-600">{formatCurrency(dashboard.total_paid_this_year)}</div>
          </Card>
        </div>
      )}

      {dashboard && dashboard.contracts_expiring_within_30_days && dashboard.contracts_expiring_within_30_days.length > 0 && (
        <div className="w-full">
          <h2 className="text-lg font-semibold mb-3">Expiring Contracts Calendar</h2>
          <ContractCalendarWidget contracts={dashboard.contracts_expiring_within_30_days} />
        </div>
      )}

      <div className="flex flex-wrap gap-4 items-center mt-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500" />
          <Input
            placeholder="Search by vendor name or code..."
            className="pl-9 bg-white dark:bg-neutral-900"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Categories</SelectItem>
            <SelectItem value="HARDWARE_SUPPLIER">Hardware</SelectItem>
            <SelectItem value="SOFTWARE_VENDOR">Software</SelectItem>
            <SelectItem value="SERVICE_PROVIDER">Service Provider</SelectItem>
            <SelectItem value="TELECOM">Telecom</SelectItem>
            <SelectItem value="CLOUD">Cloud Provider</SelectItem>
            <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
            <SelectItem value="CONSULTANT">Consultant</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

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

      <Card className="flex-1 bg-white dark:bg-neutral-900 overflow-hidden">
        <Table>
          <TableHeader className="bg-neutral-50 dark:bg-neutral-900/50">
            <TableRow>
              {isAdmin && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={sel.allSelected(vendors.map((v: any) => v.id)) || (sel.someSelected(vendors.map((v: any) => v.id)) ? "indeterminate" : false)}
                    onCheckedChange={() => sel.toggleAll(vendors.map((v: any) => v.id))}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              <TableHead>Vendor</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Primary Contact</TableHead>
              <TableHead>Active Contracts</TableHead>
              <TableHead>Total Spend</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                 <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-10 text-neutral-500">Loading vendors...</TableCell>
              </TableRow>
            ) : vendors.length === 0 ? (
              <TableRow>
                 <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-10 text-neutral-500">No vendors found.</TableCell>
              </TableRow>
            ) : (
              vendors.map((v) => (
                <TableRow
                  key={v.id}
                  data-state={sel.isSelected(v.id) ? "selected" : undefined}
                  className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                  onClick={() => router.push(`/vendors/${v.id}`)}
                >
                  {isAdmin && (
                    <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={sel.isSelected(v.id)}
                        onCheckedChange={() => sel.toggle(v.id)}
                        aria-label={`Select ${v.name}`}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="font-medium text-violet-600 dark:text-violet-400">{v.name}</div>
                    <div className="text-xs text-neutral-500 font-mono">{v.vendor_code}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal">{v.category.replace('_', ' ')}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{v.primary_contact_name || "—"}</div>
                    <div className="text-xs text-neutral-500">{v.primary_contact_email}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="w-3 h-3 text-neutral-400" />
                      <span className="font-medium">{v.active_contracts_count}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium text-neutral-600 dark:text-neutral-300">
                    {formatCurrency(v.total_spend)}
                  </TableCell>
                  <TableCell>
                    {renderStars(v.rating)}
                  </TableCell>
                  <TableCell>
                    {v.is_active ? (
                      <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-0">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="text-neutral-500">Inactive</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <AddVendorDialog 
        open={addVendorOpen} 
        onOpenChange={setAddVendorOpen} 
        onSuccess={() => { fetchVendors(); fetchDashboard(); }} 
      />
    </div>
  );
}
