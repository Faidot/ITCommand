"use client";

import { useEffect, useMemo, useState } from "react";
import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Laptop,
  MoreHorizontal,
  Plus,
  Search,
  UserCircle,
  Tag,
  MonitorSmartphone,
  CheckCircle2,
  XCircle,
  AlertCircle,
  History,
  MessageSquare,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  TrendingDown,
  Wrench,
  DollarSign,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { InlineCombobox, ComboboxOption } from "@/components/inline-combobox";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useBulkSelection, summarizeBulkDelete } from "@/hooks/use-bulk-selection";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export interface SpecField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "bool";
  required?: boolean;
  options?: string[];
}

export interface AssetCategory {
  id: number;
  name: string;
  is_serialized?: boolean;
  bulk_allowed?: boolean;
  spec_schema?: SpecField[];
}

export interface Asset {
  id: number;
  asset_tag: string;
  name: string;
  category: number | null;
  category_name?: string;
  asset_type: string;
  status: string;
  condition: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  purchase_price: string | null;
  unit_price: string | null;
  vendor: number | null;
  vendor_name?: string;
  warranty_expiry: string | null;
  depreciation_method?: string;
  useful_life_months?: number | null;
  salvage_value?: string | null;
  assigned_to: number | null;
  assigned_user_name?: string;
  location: string | null;
  notes: string | null;
  // Quantity (bulk)
  quantity_total?: number;
  quantity_assigned?: number;
  quantity_available?: number;
  is_bulk?: boolean;
  // Computed (read-only from API)
  monthly_depreciation?: string | null;
  accumulated_depreciation?: string | null;
  current_book_value?: string | null;
  months_in_service?: number | null;
  is_fully_depreciated?: boolean;
  days_until_warranty_expiry?: number | null;
  warranty_status?: string;
  total_maintenance_cost?: string | null;
  total_cost_of_ownership?: string | null;
}

export interface AssetUnitAssignment {
  id: number;
  asset: number;
  user: number | null;
  user_name?: string;
  user_email?: string;
  assigned_by: number | null;
  assigned_by_name?: string;
  assigned_date: string;
  returned_date: string | null;
  is_active: boolean;
  notes?: string;
}

export interface AssetMaintenanceRecord {
  id: number;
  asset: number;
  event_type: string;
  event_type_display?: string;
  description: string;
  cost: string;
  vendor: number | null;
  vendor_name?: string;
  performed_on: string;
  downtime_days: number;
  affected_quantity: number;
  created_by_name?: string;
  created_at: string;
}

export interface UserDetail {
  id: number;
  full_name: string;
}

const formSchema = z.object({
  name: z.string().min(2),
  category: z.string().optional(),
  asset_type: z.string(),
  status: z.string(),
  condition: z.string(),
  brand: z.string().optional(),
  model: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: z.string().optional(),
  purchase_price: z.string().optional(),
  unit_price: z.string().optional(),
  vendor: z.string().optional(),       // stores vendor id as string
  warranty_expiry: z.string().optional(),
  location_ref: z.string().optional(), // stores location id as string
  notes: z.string().optional(),
});

interface VendorOption {
  id: number;
  name: string;
  vendor_code?: string;
}

interface LocationOption {
  id: number;
  name: string;
}

export default function AssetsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [assets, setAssets] = useState<Asset[]>([]);
  const [users, setUsers] = useState<UserDetail[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const sel = useBulkSelection<number>();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  // Modals
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  // Per-category specs entered in the dialog. Keys come from the selected
  // category's spec_schema. Reset when the user switches categories.
  const [specs, setSpecs] = useState<Record<string, any>>({});
  const [specsErrors, setSpecsErrors] = useState<Record<string, string>>({});
  // Bulk create — only shown when the selected category has bulk_allowed.
  const [bulkQuantity, setBulkQuantity] = useState("1");
  
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [assigningAsset, setAssigningAsset] = useState<Asset | null>(null);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [assignNote, setAssignNote] = useState("");

  const [isReturnDialogOpen, setIsReturnDialogOpen] = useState(false);

  // Drawer
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [assetHistory, setAssetHistory] = useState<any[]>([]);
  const [assetNotes, setAssetNotes] = useState<any[]>([]);
  const [newNote, setNewNote] = useState("");

  // Maintenance
  const [maintenance, setMaintenance] = useState<AssetMaintenanceRecord[]>([]);
  const [newMx, setNewMx] = useState({ event_type: "REPAIR", description: "", cost: "", performed_on: new Date().toISOString().slice(0, 10), affected_quantity: "1" });
  const [addingMx, setAddingMx] = useState(false);

  // Unit assignments (bulk assets)
  const [unitAssignments, setUnitAssignments] = useState<AssetUnitAssignment[]>([]);
  const [unitAssignUser, setUnitAssignUser] = useState<string>("");
  const [unitAssignNote, setUnitAssignNote] = useState("");
  const [unitAssignQty, setUnitAssignQty] = useState<string>("1");
  const [assigningUnit, setAssigningUnit] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      category: "none",
      asset_type: "HARDWARE",
      status: "AVAILABLE",
      condition: "GOOD",
      brand: "",
      model: "",
      serial_number: "",
      purchase_date: "",
      purchase_price: "",
      unit_price: "",
      vendor: "",
      warranty_expiry: "",
      location_ref: "",
      notes: "",
    },
  });

  const fetchDependencies = async () => {
    try {
      const [usersRes, catRes, venRes, locRes] = await Promise.all([
        api.get("/users/"),
        api.get("/asset-categories/"),
        api.get("/vendors/"),
        api.get("/locations/"),
      ]);
      setUsers(usersRes.data.results || usersRes.data);
      setCategories(catRes.data.results || catRes.data);
      setVendors(venRes.data.results || venRes.data);
      setLocations(locRes.data.results || locRes.data);
    } catch {
      toast.error("Failed to load reference data.");
    }
  };

  const createVendorInline = async (name: string): Promise<ComboboxOption> => {
    const res = await api.post("/vendors/", { name, is_active: true });
    const v = res.data;
    setVendors((prev) => [...prev, { id: v.id, name: v.name, vendor_code: v.vendor_code }]);
    return { id: v.id, label: v.name, hint: v.vendor_code };
  };

  const createLocationInline = async (name: string): Promise<ComboboxOption> => {
    const res = await api.post("/locations/", { name, is_active: true });
    const l = res.data;
    setLocations((prev) => [...prev, { id: l.id, name: l.name }]);
    return { id: l.id, label: l.name };
  };

  const fetchAssets = async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (categoryFilter !== "ALL") params.append("category", categoryFilter);
      if (typeFilter !== "ALL") params.append("asset_type", typeFilter);
      if (searchQuery) params.append("search", searchQuery);
      
      const res = await api.get(`/assets/?${params.toString()}`);
      setAssets(res.data);
    } catch (err) {
      toast.error("Failed to load assets.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDependencies();
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      fetchAssets();
    }, 400);
    return () => clearTimeout(handler);
  }, [searchQuery, statusFilter, categoryFilter, typeFilter]);

  // Reactive watch on the selected category id (form value is a string).
  const selectedCategoryId = form.watch("category");
  const selectedCategory = useMemo(() => {
    if (!selectedCategoryId || selectedCategoryId === "none") return null;
    return categories.find((c) => String(c.id) === selectedCategoryId) || null;
  }, [categories, selectedCategoryId]);

  const specSchema: SpecField[] = selectedCategory?.spec_schema || [];

  // When the user switches category in the dialog (not the initial reset),
  // drop any specs that no longer belong to the new category schema.
  useEffect(() => {
    if (!isDialogOpen) return;
    if (!specSchema.length) {
      // No schema → no specs allowed
      if (Object.keys(specs).length) setSpecs({});
      return;
    }
    const allowed = new Set(specSchema.map((f) => f.key));
    const filtered = Object.fromEntries(Object.entries(specs).filter(([k]) => allowed.has(k)));
    if (Object.keys(filtered).length !== Object.keys(specs).length) {
      setSpecs(filtered);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategoryId, isDialogOpen]);

  const openAddDialog = () => {
    setEditingAsset(null);
    setSpecs({});
    setSpecsErrors({});
    setBulkQuantity("1");
    form.reset({
      name: "", category: "none", asset_type: "HARDWARE", status: "AVAILABLE", condition: "GOOD",
      brand: "", model: "", serial_number: "", purchase_date: "", purchase_price: "", unit_price: "",
      vendor: "", warranty_expiry: "", location_ref: "", notes: "",
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (a: Asset) => {
    setEditingAsset(a);
    setSpecs(((a as any).specs as Record<string, any>) || {});
    setSpecsErrors({});
    // Pre-populate quantity so the bulk banner appears with the current value.
    setBulkQuantity(String(a.quantity_total ?? 1));
    form.reset({
      name: a.name,
      category: a.category ? a.category.toString() : "none",
      asset_type: a.asset_type,
      status: a.status,
      condition: a.condition,
      brand: a.brand || "",
      model: a.model || "",
      serial_number: a.serial_number || "",
      purchase_date: a.purchase_date || "",
      purchase_price: a.purchase_price || "",
      unit_price: a.unit_price || "",
      vendor: a.vendor != null ? String(a.vendor) : "",
      warranty_expiry: a.warranty_expiry || "",
      location_ref: (a as any).location_ref != null ? String((a as any).location_ref) : "",
      notes: a.notes || "",
    });
    setIsDialogOpen(true);
  };

  const validateSpecs = (): boolean => {
    const errors: Record<string, string> = {};
    for (const f of specSchema) {
      if (!f.required) continue;
      const v = specs[f.key];
      const isEmpty = v == null || v === "" || (f.type === "bool" && v === undefined);
      if (isEmpty) errors[f.key] = "Required";
    }
    setSpecsErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!validateSpecs()) {
      toast.error("Fill required spec fields");
      return;
    }

    // Bulk-aware quantity: source is the bulkQuantity field which is
    // populated from the asset on edit and defaults to 1 on create.
    // - Create + bulk_allowed category + qty > 1 → bulk mode (sets quantity_total)
    // - Edit → always send the current quantity_total (allows changing it)
    const qty = Math.max(1, parseInt(bulkQuantity || "1", 10) || 1);
    const bulkMode = !editingAsset && !!selectedCategory?.bulk_allowed && qty > 1;

    try {
      // If unit_price is set, the backend will derive purchase_price from
      // unit_price × quantity_total. We still send purchase_price if the
      // user typed one (so non-bulk flows behave as before).
      const unitPriceNum = values.unit_price ? parseFloat(values.unit_price) : null;
      const purchasePriceNum = values.purchase_price ? parseFloat(values.purchase_price) : null;

      const payload: any = {
        ...values,
        category: values.category === "none" ? null : parseInt(values.category!),
        purchase_date: values.purchase_date || null,
        warranty_expiry: values.warranty_expiry || null,
        unit_price: unitPriceNum,
        purchase_price: purchasePriceNum,
        vendor: values.vendor ? parseInt(values.vendor, 10) : null,
        location_ref: values.location_ref ? parseInt(values.location_ref, 10) : null,
        specs,
        // On edit, always send the current quantity (server clamps at
        // quantity_assigned). On create, only send > 1 when in bulk mode.
        quantity_total: editingAsset ? qty : (bulkMode ? qty : 1),
      };
      delete payload.location; // deprecated free-text
      if (bulkMode) {
        // Serial doesn't apply to a bulk row of N identical units.
        delete payload.serial_number;
      }

      if (editingAsset) {
        await api.put(`/assets/${editingAsset.id}/`, payload);
        toast.success("Asset updated.");
      } else if (bulkMode) {
        await api.post("/assets/", payload);
        toast.success(`Created bulk asset (qty ${qty}).`);
      } else {
        await api.post("/assets/", payload);
        toast.success("Asset added to inventory.");
      }
      setIsDialogOpen(false);
      fetchAssets();
    } catch (err: any) {
      toast.error(
        err.response?.data?.detail ||
          JSON.stringify(err.response?.data) ||
          "An error occurred."
      );
    }
  };

  const deleteAsset = async (a: Asset) => {
    if (!confirm(`Delete asset ${a.asset_tag}? This cannot be undone.`)) return;
    try {
      await api.delete(`/assets/${a.id}/`);
      toast.success("Asset deleted.");
      fetchAssets();
    } catch (err: any) {
      // 409 → server tells us the asset is in use; surface the reason.
      toast.error(err.response?.data?.detail || "Failed to delete asset.");
    }
  };

  const bulkDeleteAssets = async () => {
    if (sel.count === 0) return;
    if (!confirm(`Delete ${sel.count} asset(s)? Items currently assigned will be skipped.`)) return;
    setBulkDeleting(true);
    try {
      const res = await api.post("/assets/bulk_delete/", { ids: sel.ids });
      const sum = summarizeBulkDelete(res.data);
      if (sum.kind === "success") toast.success(sum.message);
      else toast.warning?.(sum.message) ?? toast(sum.message);
      // If anything was blocked, show first few reasons for context.
      const blocked: any[] = res.data?.blocked || [];
      if (blocked.length) {
        const sample = blocked.slice(0, 3).map((b: any) => `${b.tag || b.id}: ${b.reason}`).join(" · ");
        toast(sample, { duration: 5000 });
      }
      sel.clear();
      fetchAssets();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Bulk delete failed.");
    } finally {
      setBulkDeleting(false);
    }
  };

  const onAssign = async () => {
    if (!assigningAsset || !selectedUser) return;
    try {
      await api.post(`/assets/${assigningAsset.id}/assign/`, {
        user_id: parseInt(selectedUser),
        note: assignNote
      });
      toast.success("Asset assigned successfully.");
      setIsAssignDialogOpen(false);
      fetchAssets();
    } catch (err: any) {
      toast.error("Failed to assign asset.");
    }
  };

  const onReturn = async () => {
    if (!assigningAsset) return;
    try {
      await api.post(`/assets/${assigningAsset.id}/return_asset/`, {
        note: assignNote
      });
      toast.success("Asset returned to inventory.");
      setIsReturnDialogOpen(false);
      fetchAssets();
    } catch (err: any) {
      toast.error("Failed to return asset.");
    }
  };

  const loadAssetDetails = async (a: Asset) => {
    setSelectedAsset(a);
    setIsDrawerOpen(true);
    setUnitAssignUser("");
    setUnitAssignNote("");
    try {
      const [assetRes, histRes, noteRes, mxRes, unitRes] = await Promise.all([
        api.get(`/assets/${a.id}/`),
        api.get(`/assets/${a.id}/history/`),
        api.get(`/asset-notes/?asset=${a.id}`),
        api.get(`/assets/${a.id}/maintenance/`),
        api.get(`/assets/${a.id}/unit_assignments/`),
      ]);
      setSelectedAsset(assetRes.data);
      setAssetHistory(histRes.data);
      setAssetNotes(noteRes.data);
      setMaintenance(mxRes.data);
      setUnitAssignments(unitRes.data);
    } catch (e) {
      toast.error("Failed to load asset details.");
    }
  };

  const reloadAfterUnitChange = async (id: number) => {
    try {
      const [assetRes, unitRes] = await Promise.all([
        api.get(`/assets/${id}/`),
        api.get(`/assets/${id}/unit_assignments/`),
      ]);
      setSelectedAsset(assetRes.data);
      setUnitAssignments(unitRes.data);
      // Refresh the underlying list so qty counts update there too.
      fetchAssets();
    } catch {
      /* non-blocking */
    }
  };

  const assignUnit = async () => {
    if (!selectedAsset || !unitAssignUser) return;
    const qty = Math.max(1, parseInt(unitAssignQty || "1", 10) || 1);
    setAssigningUnit(true);
    try {
      await api.post(`/assets/${selectedAsset.id}/assign_unit/`, {
        user_id: parseInt(unitAssignUser, 10),
        quantity: qty,
        notes: unitAssignNote,
      });
      toast.success(qty > 1 ? `${qty} units assigned.` : "Unit assigned.");
      setUnitAssignUser("");
      setUnitAssignNote("");
      setUnitAssignQty("1");
      await reloadAfterUnitChange(selectedAsset.id);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Assign failed.");
    } finally {
      setAssigningUnit(false);
    }
  };

  const returnUnit = async (assignmentId: number) => {
    if (!selectedAsset) return;
    if (!confirm("Mark this unit as returned?")) return;
    try {
      await api.post(`/assets/${selectedAsset.id}/return_unit/${assignmentId}/`, {});
      toast.success("Unit returned.");
      await reloadAfterUnitChange(selectedAsset.id);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Return failed.");
    }
  };

  const deleteMaintenance = async (recordId: number) => {
    if (!selectedAsset) return;
    if (!confirm("Delete this maintenance record? This also writes an audit log entry.")) return;
    try {
      await api.delete(`/assets/${selectedAsset.id}/maintenance/${recordId}/`);
      const [assetRes, mxRes] = await Promise.all([
        api.get(`/assets/${selectedAsset.id}/`),
        api.get(`/assets/${selectedAsset.id}/maintenance/`),
      ]);
      setSelectedAsset(assetRes.data);
      setMaintenance(mxRes.data);
      toast.success("Maintenance record deleted.");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Delete failed.");
    }
  };

  const addMaintenance = async () => {
    if (!selectedAsset || !newMx.description.trim()) return;
    setAddingMx(true);
    try {
      await api.post(`/assets/${selectedAsset.id}/maintenance/`, {
        event_type: newMx.event_type,
        description: newMx.description,
        cost: newMx.cost ? parseFloat(newMx.cost) : 0,
        performed_on: newMx.performed_on || undefined,
        affected_quantity: Math.max(1, parseInt(newMx.affected_quantity || "1", 10) || 1),
      });
      const [assetRes, mxRes] = await Promise.all([
        api.get(`/assets/${selectedAsset.id}/`),
        api.get(`/assets/${selectedAsset.id}/maintenance/`),
      ]);
      setSelectedAsset(assetRes.data);
      setMaintenance(mxRes.data);
      setNewMx({ event_type: "REPAIR", description: "", cost: "", performed_on: new Date().toISOString().slice(0, 10), affected_quantity: "1" });
      toast.success("Maintenance record added.");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to add maintenance record.");
    } finally {
      setAddingMx(false);
    }
  };

  const getWarrantyBadge = (s?: string, days?: number | null) => {
    switch (s) {
      case "ACTIVE":
        return <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0"><ShieldCheck className="w-3 h-3 mr-1" /> {days}d left</Badge>;
      case "EXPIRING_SOON":
        return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-0"><ShieldAlert className="w-3 h-3 mr-1" /> {days}d left</Badge>;
      case "EXPIRED":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0"><ShieldX className="w-3 h-3 mr-1" /> Expired</Badge>;
      default:
        return <Badge variant="outline" className="text-neutral-500">No warranty</Badge>;
    }
  };

  const money = (v?: string | null) =>
    v == null || v === ""
      ? "—"
      : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(v));

  const addNote = async () => {
    if (!selectedAsset || !newNote) return;
    try {
      await api.post("/asset-notes/", { asset: selectedAsset.id, note: newNote });
      setNewNote("");
      const noteRes = await api.get(`/asset-notes/?asset=${selectedAsset.id}`);
      setAssetNotes(noteRes.data);
      toast.success("Note added.");
    } catch (e) {
      toast.error("Failed to add note.");
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case "AVAILABLE": return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 border-0"><CheckCircle2 className="w-3 h-3 mr-1" /> Available</Badge>;
      case "ASSIGNED": return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 border-0"><MonitorSmartphone className="w-3 h-3 mr-1" /> Assigned</Badge>;
      case "UNDER_REPAIR": return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 border-0"><AlertCircle className="w-3 h-3 mr-1" /> Repair</Badge>;
      case "RETIRED": return <Badge className="bg-neutral-100 text-neutral-800 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-400 border-0"><XCircle className="w-3 h-3 mr-1" /> Retired</Badge>;
      case "LOST": return <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 border-0"><XCircle className="w-3 h-3 mr-1" /> Lost</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  }

  // Summaries
  const totalAssets = assets.length;
  const assignedAssets = assets.filter(a => a.status === 'ASSIGNED').length;
  const availableAssets = assets.filter(a => a.status === 'AVAILABLE').length;
  const underRepairAssets = assets.filter(a => a.status === 'UNDER_REPAIR').length;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto h-full p-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Asset Inventory</h1>
          <p className="text-neutral-500">Track and manage hardware fleet and system licenses.</p>
        </div>
        {isAdmin && (
          <Button onClick={openAddDialog}>
            <Plus className="mr-2 h-4 w-4" /> Add Asset
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">Total Assets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalAssets}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">Assigned</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{assignedAssets}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">Available</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{availableAssets}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-500">Under Repair</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{underRepairAssets}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500" />
          <Input
            placeholder="Search tag, name, serial..."
            className="pl-9 bg-white dark:bg-neutral-900"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="AVAILABLE">Available</SelectItem>
            <SelectItem value="ASSIGNED">Assigned</SelectItem>
            <SelectItem value="UNDER_REPAIR">Under Repair</SelectItem>
            <SelectItem value="RETIRED">Retired</SelectItem>
            <SelectItem value="LOST">Lost</SelectItem>
          </SelectContent>
        </Select>

        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[150px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px] bg-white dark:bg-neutral-900">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="HARDWARE">Hardware</SelectItem>
            <SelectItem value="SOFTWARE">Software</SelectItem>
            <SelectItem value="LICENSE">License</SelectItem>
            <SelectItem value="PERIPHERAL">Peripheral</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isAdmin && sel.count > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
          <div className="text-sm">
            <span className="font-medium">{sel.count}</span> selected
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={sel.clear}>Clear</Button>
            <Button variant="destructive" size="sm" onClick={bulkDeleteAssets} disabled={bulkDeleting}>
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
                    checked={sel.allSelected(assets.map((a) => a.id)) || (sel.someSelected(assets.map((a) => a.id)) ? "indeterminate" : false)}
                    onCheckedChange={() => sel.toggleAll(assets.map((a) => a.id))}
                    aria-label="Select all"
                  />
                </TableHead>
              )}
              <TableHead>Asset Tag</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type/Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Assignment</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                 <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-10 text-neutral-500">
                    Loading inventory...
                 </TableCell>
              </TableRow>
            ) : assets.length === 0 ? (
              <TableRow>
                 <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-10 text-neutral-500">
                    No assets found.
                 </TableCell>
              </TableRow>
            ) : (
              assets.map((a) => (
                <TableRow key={a.id} data-state={sel.isSelected(a.id) ? "selected" : undefined}>
                  {isAdmin && (
                    <TableCell className="w-10">
                      <Checkbox
                        checked={sel.isSelected(a.id)}
                        onCheckedChange={() => sel.toggle(a.id)}
                        aria-label={`Select ${a.asset_tag}`}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <button onClick={() => loadAssetDetails(a)} className="flex items-center gap-2 font-mono text-sm text-blue-600 hover:underline">
                      <Tag className="w-4 h-4" />
                      {a.asset_tag}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-xs text-neutral-500">{a.brand} {a.model}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="text-sm">{a.asset_type}</span>
                      <span className="text-xs text-neutral-500">{a.category_name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(a.status)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{a.condition}</Badge>
                  </TableCell>
                  <TableCell>
                    {a.is_bulk ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm tabular-nums font-medium">
                          {a.quantity_assigned ?? 0} / {a.quantity_total ?? 1}
                          <span className="text-xs text-muted-foreground font-normal"> assigned</span>
                        </span>
                        <span className="text-[11px] text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {a.quantity_available ?? a.quantity_total ?? 0} available
                        </span>
                      </div>
                    ) : a.assigned_user_name ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                           <AvatarFallback className="text-[10px]">{a.assigned_user_name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm">{a.assigned_user_name}</span>
                      </div>
                    ) : (
                      <span className="text-sm text-neutral-400 italic">Unassigned</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuLabel>Asset Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => setTimeout(() => loadAssetDetails(a), 100)}>
                          View Details
                        </DropdownMenuItem>
                        {isAdmin && (
                          <>
                            <DropdownMenuItem onSelect={() => setTimeout(() => openEditDialog(a), 100)}>
                              Edit Asset
                            </DropdownMenuItem>
                            {!a.is_bulk && a.status === 'AVAILABLE' && (
                              <DropdownMenuItem onSelect={() => setTimeout(() => { setAssigningAsset(a); setSelectedUser(""); setAssignNote(""); setIsAssignDialogOpen(true); }, 100)}>
                                Assign Asset
                              </DropdownMenuItem>
                            )}
                            {!a.is_bulk && a.status === 'ASSIGNED' && (
                              <DropdownMenuItem onSelect={() => setTimeout(() => { setAssigningAsset(a); setAssignNote(""); setIsReturnDialogOpen(true); }, 100)}>
                                Return Asset
                              </DropdownMenuItem>
                            )}
                            {a.is_bulk && (
                              <DropdownMenuItem onSelect={() => setTimeout(() => loadAssetDetails(a), 100)}>
                                Manage units
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:bg-destructive focus:text-destructive-foreground"
                              onSelect={() => setTimeout(() => deleteAsset(a), 100)}
                            >
                              Delete Asset
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* CREATE/EDIT ASSET DIALOG */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAsset ? "Edit Asset" : "Add Asset"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Asset Name</FormLabel>
                      <FormControl>
                        <Input placeholder="MacBook Pro 16" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">No Category</SelectItem>
                          {categories.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Show the quantity banner on create when category supports bulk,
                  and on edit whenever the asset is already a bulk row (or its
                  category supports it). On edit, the minimum is the number of
                  units currently assigned — server enforces this too. */}
              {(() => {
                const categoryBulk = !!selectedCategory?.bulk_allowed;
                const editingBulk = !!editingAsset?.is_bulk;
                const showBanner = (!editingAsset && categoryBulk) || editingBulk || (editingAsset && categoryBulk);
                if (!showBanner) return null;
                const minQty = editingAsset ? (editingAsset.quantity_assigned ?? 0) : 1;
                return (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        {editingAsset ? "Quantity" : `Bulk asset · ${selectedCategory?.name}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {editingAsset ? (
                          <>
                            {editingAsset.quantity_assigned ?? 0} assigned ·{" "}
                            {editingAsset.quantity_available ?? 0} available.{" "}
                            {minQty > 0 && <>Cannot reduce below {minQty} (currently assigned).</>}
                          </>
                        ) : (
                          "One row with this quantity. Assign one unit at a time from the asset details; \"available\" tracks what's still in stock."
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <label className="text-xs text-muted-foreground">Quantity</label>
                      <Input
                        type="number"
                        min={Math.max(1, minQty)}
                        max={9999}
                        value={bulkQuantity}
                        onChange={(e) => setBulkQuantity(e.target.value)}
                        className="w-24 h-9 text-center font-medium"
                      />
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="asset_type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="HARDWARE">Hardware</SelectItem>
                          <SelectItem value="SOFTWARE">Software</SelectItem>
                          <SelectItem value="LICENSE">License</SelectItem>
                          <SelectItem value="PERIPHERAL">Peripheral</SelectItem>
                          <SelectItem value="OTHER">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="AVAILABLE">Available</SelectItem>
                          <SelectItem value="ASSIGNED">Assigned</SelectItem>
                          <SelectItem value="UNDER_REPAIR">Under Repair</SelectItem>
                          <SelectItem value="RETIRED">Retired</SelectItem>
                          <SelectItem value="LOST">Lost</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="condition"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Condition</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Condition" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="NEW">New</SelectItem>
                          <SelectItem value="GOOD">Good</SelectItem>
                          <SelectItem value="FAIR">Fair</SelectItem>
                          <SelectItem value="POOR">Poor</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                 <FormField
                    control={form.control}
                    name="brand"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Brand</FormLabel>
                        <FormControl><Input placeholder="Apple" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                 <FormField
                    control={form.control}
                    name="model"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Model</FormLabel>
                        <FormControl><Input placeholder="M2 Pro" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="serial_number"
                    render={({ field }) => {
                      const bulkMode = !editingAsset && !!selectedCategory?.bulk_allowed
                        && (parseInt(bulkQuantity || "1", 10) || 1) > 1;
                      return (
                        <FormItem>
                          <FormLabel>Serial Number</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={bulkMode ? "Disabled in bulk mode" : "C02XX..."}
                              disabled={bulkMode}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      );
                    }}
                  />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="purchase_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Date</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="warranty_expiry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Warranty Expiry</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {(() => {
                // Show unit_price prominently when bulk is active; total auto-calculates.
                const qty = !editingAsset && selectedCategory?.bulk_allowed
                  ? Math.max(1, parseInt(bulkQuantity || "1", 10) || 1)
                  : (editingAsset?.quantity_total || 1);
                const showBulkPricing = qty > 1;
                const unit = parseFloat(form.watch("unit_price") || "0");
                const autoTotal = showBulkPricing && unit > 0
                  ? (unit * qty).toFixed(2)
                  : null;
                return (
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="unit_price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Unit Price ($)
                            {showBulkPricing && <span className="text-xs text-muted-foreground ml-1">per unit</span>}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              {...field}
                              onChange={(e) => {
                                field.onChange(e);
                                // Auto-fill total when bulk and unit price changes.
                                const v = parseFloat(e.target.value || "0");
                                if (showBulkPricing && v > 0) {
                                  form.setValue("purchase_price", (v * qty).toFixed(2));
                                } else if (!showBulkPricing && v > 0) {
                                  // For non-bulk, mirror unit_price into purchase_price.
                                  form.setValue("purchase_price", v.toFixed(2));
                                }
                              }}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="purchase_price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Total Price ($)
                            {autoTotal && <span className="text-xs text-emerald-600 ml-1">= ${autoTotal} ({qty}× units)</span>}
                          </FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="vendor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vendor</FormLabel>
                      <FormControl>
                        <InlineCombobox
                          value={field.value || null}
                          onChange={(id) => field.onChange(id == null ? "" : String(id))}
                          options={vendors.map((v) => ({ id: v.id, label: v.name, hint: v.vendor_code }))}
                          placeholder="Select vendor…"
                          searchPlaceholder="Search vendors or type to add…"
                          emptyText="No vendors found."
                          onCreate={createVendorInline}
                          createLabel="Add vendor"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="location_ref"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location</FormLabel>
                      <FormControl>
                        <InlineCombobox
                          value={field.value || null}
                          onChange={(id) => field.onChange(id == null ? "" : String(id))}
                          options={locations.map((l) => ({ id: l.id, label: l.name }))}
                          placeholder="Select location…"
                          searchPlaceholder="Search locations or type to add…"
                          emptyText="No locations found."
                          onCreate={createLocationInline}
                          createLabel="Add location"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {selectedCategory && specSchema.length > 0 && (
                <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
                  <div>
                    <div className="text-sm font-medium">{selectedCategory.name} specs</div>
                    <div className="text-xs text-muted-foreground">
                      Defined in master settings · {specSchema.length} field{specSchema.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {specSchema.map((f) => (
                      <SpecInput
                        key={f.key}
                        field={f}
                        value={specs[f.key]}
                        onChange={(v) => {
                          setSpecs((prev) => ({ ...prev, [f.key]: v }));
                          if (specsErrors[f.key]) {
                            setSpecsErrors((prev) => {
                              const { [f.key]: _, ...rest } = prev;
                              return rest;
                            });
                          }
                        }}
                        error={specsErrors[f.key]}
                      />
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                {(() => {
                  const qty = Math.max(1, parseInt(bulkQuantity || "1", 10) || 1);
                  const bulkMode = !editingAsset && !!selectedCategory?.bulk_allowed && qty > 1;
                  return (
                    <Button type="submit">
                      {editingAsset
                        ? "Save Asset"
                        : bulkMode
                        ? `Save (qty ${qty})`
                        : "Save Asset"}
                    </Button>
                  );
                })()}
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ASSIGN ASSET DIALOG */}
      <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Asset</DialogTitle>
            <DialogDescription>Assign {assigningAsset?.asset_tag} to a user.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">User</label>
              <Select value={selectedUser} onValueChange={setSelectedUser}>
                <SelectTrigger>
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {users.map(u => <SelectItem key={u.id} value={u.id.toString()}>{u.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Assignment Note (Optional)</label>
              <Input placeholder="Reason for assignment..." value={assignNote} onChange={e => setAssignNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAssignDialogOpen(false)}>Cancel</Button>
            <Button onClick={onAssign} disabled={!selectedUser}>Assign Asset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RETURN ASSET DIALOG */}
      <Dialog open={isReturnDialogOpen} onOpenChange={setIsReturnDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return Asset</DialogTitle>
            <DialogDescription>Return {assigningAsset?.asset_tag} to inventory.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Return Note (Optional)</label>
              <Input placeholder="Condition upon return..." value={assignNote} onChange={e => setAssignNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReturnDialogOpen(false)}>Cancel</Button>
            <Button onClick={onReturn}>Return Asset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ASSET DETAILS DRAWER */}
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent className="sm:max-w-xl overflow-y-auto w-[400px]">
          <SheetHeader>
            <SheetTitle>Asset Details: {selectedAsset?.asset_tag}</SheetTitle>
            <SheetDescription>{selectedAsset?.name}</SheetDescription>
          </SheetHeader>

          {selectedAsset && isAdmin && (
            <div className="mt-4 flex flex-wrap gap-2 pb-2 border-b">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setIsDrawerOpen(false);
                  openEditDialog(selectedAsset);
                }}
              >
                Edit
              </Button>
              {!selectedAsset.is_bulk && selectedAsset.status === 'AVAILABLE' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAssigningAsset(selectedAsset);
                    setSelectedUser("");
                    setAssignNote("");
                    setIsAssignDialogOpen(true);
                  }}
                >
                  Assign
                </Button>
              )}
              {!selectedAsset.is_bulk && selectedAsset.status === 'ASSIGNED' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setAssigningAsset(selectedAsset);
                    setAssignNote("");
                    setIsReturnDialogOpen(true);
                  }}
                >
                  Return
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive ml-auto"
                onClick={async () => {
                  await deleteAsset(selectedAsset);
                  setIsDrawerOpen(false);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
              </Button>
            </div>
          )}

          {selectedAsset && (
            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-neutral-500">Status</p>
                  <p className="font-medium">{getStatusBadge(selectedAsset.status)}</p>
                </div>
                <div>
                  <p className="text-neutral-500">Condition</p>
                  <p className="font-medium">{selectedAsset.condition}</p>
                </div>
                <div>
                  <p className="text-neutral-500">Brand / Model</p>
                  <p className="font-medium">{selectedAsset.brand || '-'} / {selectedAsset.model || '-'}</p>
                </div>
                <div>
                  <p className="text-neutral-500">Serial Number</p>
                  <p className="font-medium font-mono">{selectedAsset.serial_number || '-'}</p>
                </div>
                <div>
                  <p className="text-neutral-500">Assigned To</p>
                  <p className="font-medium">{selectedAsset.assigned_user_name || 'Unassigned'}</p>
                </div>
                <div>
                  <p className="text-neutral-500">Location</p>
                  <p className="font-medium">{(selectedAsset as any).location_ref_name || selectedAsset.location || '-'}</p>
                </div>
                <div>
                  <p className="text-neutral-500">Purchase Date</p>
                  <p className="font-medium">{selectedAsset.purchase_date || '—'}</p>
                </div>
                <div>
                  <p className="text-neutral-500">Vendor</p>
                  <p className="font-medium">{(selectedAsset as any).vendor_name || '—'}</p>
                </div>
              </div>

              {/* Pricing / Quantity block — always show what we have */}
              <div className="rounded-xl border bg-muted/20 p-4">
                <div className="text-sm font-medium mb-3 flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" /> Pricing
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-[11px] text-neutral-500 uppercase tracking-wider">Unit Price</p>
                    <p className="font-medium tabular-nums">{money(selectedAsset.unit_price)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-neutral-500 uppercase tracking-wider">Quantity</p>
                    <p className="font-medium tabular-nums">{selectedAsset.quantity_total ?? 1}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-neutral-500 uppercase tracking-wider">Total Price</p>
                    <p className="font-medium tabular-nums">{money(selectedAsset.purchase_price)}</p>
                  </div>
                </div>
              </div>

              {/* Bulk asset: quantity and unit assignments */}
              {selectedAsset.is_bulk && (
                <div className="rounded-xl border bg-card p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">Units</div>
                      <div className="text-xs text-muted-foreground">Assign one unit at a time to a user.</div>
                    </div>
                    <div className="flex gap-3 text-sm">
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</div>
                        <div className="font-bold tabular-nums">{selectedAsset.quantity_total ?? 1}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Assigned</div>
                        <div className="font-bold tabular-nums text-blue-600">{selectedAsset.quantity_assigned ?? 0}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Available</div>
                        <div className="font-bold tabular-nums text-emerald-600">{selectedAsset.quantity_available ?? 0}</div>
                      </div>
                    </div>
                  </div>

                  {/* Active assignments */}
                  <div className="space-y-2">
                    {unitAssignments.filter((u) => u.is_active).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No units currently assigned.</p>
                    ) : (
                      unitAssignments.filter((u) => u.is_active).map((u) => (
                        <div key={u.id} className="flex items-center justify-between border rounded-lg p-2.5 text-sm">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-7 w-7">
                              <AvatarFallback className="text-[10px]">{u.user_name?.charAt(0) || "?"}</AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium leading-tight">{u.user_name || u.user_email || "—"}</div>
                              <div className="text-[11px] text-muted-foreground">Since {new Date(u.assigned_date).toLocaleDateString()}</div>
                            </div>
                          </div>
                          {isAdmin && (
                            <Button variant="outline" size="sm" onClick={() => returnUnit(u.id)}>Return</Button>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Assign-units form */}
                  {isAdmin && (selectedAsset.quantity_available ?? 0) > 0 && (() => {
                    const available = selectedAsset.quantity_available ?? 0;
                    const qty = Math.max(1, Math.min(available, parseInt(unitAssignQty || "1", 10) || 1));
                    return (
                    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                      <div className="text-xs font-medium">Assign units</div>
                      <Select value={unitAssignUser} onValueChange={setUnitAssignUser}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select user…" /></SelectTrigger>
                        <SelectContent>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={String(u.id)}>{u.full_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={available}
                          value={unitAssignQty}
                          onChange={(e) => setUnitAssignQty(e.target.value)}
                          className="h-9 text-sm w-24 text-center font-medium"
                        />
                        <span className="text-[11px] text-muted-foreground">of {available} available</span>
                      </div>
                      <Input
                        className="h-9 text-sm"
                        placeholder="Notes (optional)"
                        value={unitAssignNote}
                        onChange={(e) => setUnitAssignNote(e.target.value)}
                      />
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={assignUnit}
                        disabled={assigningUnit || !unitAssignUser || qty < 1 || qty > available}
                      >
                        {assigningUnit ? "Assigning…" : `Assign ${qty} unit${qty === 1 ? "" : "s"}`}
                      </Button>
                    </div>
                    );
                  })()}

                  {/* Returned history (collapsible-ish: show inline, dimmed) */}
                  {unitAssignments.filter((u) => !u.is_active).length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground select-none">
                        {unitAssignments.filter((u) => !u.is_active).length} previous assignment(s)
                      </summary>
                      <div className="mt-2 space-y-1">
                        {unitAssignments.filter((u) => !u.is_active).map((u) => (
                          <div key={u.id} className="flex items-center justify-between text-muted-foreground">
                            <span>{u.user_name || "—"}</span>
                            <span>
                              {new Date(u.assigned_date).toLocaleDateString()}
                              {u.returned_date && ` → ${new Date(u.returned_date).toLocaleDateString()}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {/* Category specs */}
              {(() => {
                const cat = categories.find((c) => c.id === selectedAsset.category);
                const schema = cat?.spec_schema || [];
                const data = ((selectedAsset as any).specs as Record<string, any>) || {};
                if (!schema.length && Object.keys(data).length === 0) return null;
                return (
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <div className="text-sm font-medium mb-3">{cat?.name || "Specs"}</div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {schema.length > 0
                        ? schema.map((f) => (
                            <div key={f.key}>
                              <p className="text-neutral-500">{f.label}</p>
                              <p className="font-medium">{formatSpecValue(data[f.key], f.type)}</p>
                            </div>
                          ))
                        : Object.entries(data).map(([k, v]) => (
                            <div key={k}>
                              <p className="text-neutral-500">{k}</p>
                              <p className="font-medium">{String(v ?? "—")}</p>
                            </div>
                          ))}
                    </div>
                  </div>
                );
              })()}

              {/* Financial / Lifecycle Panel */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border bg-card p-3">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><DollarSign className="w-3 h-3" /> Book value</div>
                  <div className="text-xl font-bold mt-1 tabular-nums">{money(selectedAsset.current_book_value)}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Purchase {money(selectedAsset.purchase_price)}
                  </div>
                </div>
                <div className="rounded-xl border bg-card p-3">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><TrendingDown className="w-3 h-3" /> Depreciation</div>
                  <div className="text-xl font-bold mt-1 tabular-nums">{money(selectedAsset.monthly_depreciation)}<span className="text-xs text-muted-foreground font-normal">/mo</span></div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Accum {money(selectedAsset.accumulated_depreciation)} · {selectedAsset.months_in_service ?? 0}mo
                    {selectedAsset.is_fully_depreciated && <span className="ml-1 text-amber-600">(fully depreciated)</span>}
                  </div>
                </div>
                <div className="rounded-xl border bg-card p-3">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider flex items-center gap-1"><Wrench className="w-3 h-3" /> TCO</div>
                  <div className="text-xl font-bold mt-1 tabular-nums">{money(selectedAsset.total_cost_of_ownership)}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Maint {money(selectedAsset.total_maintenance_cost)}
                  </div>
                </div>
                <div className="rounded-xl border bg-card p-3">
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Warranty</div>
                  <div className="mt-1.5">{getWarrantyBadge(selectedAsset.warranty_status, selectedAsset.days_until_warranty_expiry)}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {selectedAsset.warranty_expiry || "—"}
                  </div>
                </div>
              </div>

              {/* Maintenance Log */}
              <div>
                <h3 className="font-semibold text-lg flex items-center gap-2 border-b pb-2"><Wrench className="w-4 h-4" /> Maintenance Log</h3>
                <div className="mt-4 space-y-3">
                  {maintenance.length === 0 ? (
                    <p className="text-sm text-neutral-500">No maintenance records.</p>
                  ) : (
                    maintenance.map((m) => (
                      <div key={m.id} className="border rounded-lg p-3 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{m.event_type_display || m.event_type}</Badge>
                            <span className="text-xs text-muted-foreground">{m.performed_on}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium tabular-nums">{money(m.cost)}</span>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteMaintenance(m.id)}
                                aria-label="Delete maintenance record"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="mt-1.5">{m.description}</p>
                        {(m.vendor_name || m.downtime_days > 0 || (m.affected_quantity && m.affected_quantity > 1)) && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            {(m.affected_quantity && m.affected_quantity > 1) && (
                              <span>Affected: {m.affected_quantity} unit{m.affected_quantity === 1 ? "" : "s"}</span>
                            )}
                            {(m.affected_quantity && m.affected_quantity > 1) && (m.vendor_name || m.downtime_days > 0) && " · "}
                            {m.vendor_name && <span>Vendor: {m.vendor_name}</span>}
                            {m.vendor_name && m.downtime_days > 0 && " · "}
                            {m.downtime_days > 0 && <span>{m.downtime_days}d downtime</span>}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                  {isAdmin && (
                    <div className="mt-4 flex flex-col gap-2 border rounded-lg p-3 bg-muted/30">
                      <div className="text-xs font-medium">Log new maintenance</div>
                      <div className="grid grid-cols-2 gap-2">
                        <Select value={newMx.event_type} onValueChange={(v) => setNewMx({ ...newMx, event_type: v })}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="REPAIR">Repair</SelectItem>
                            <SelectItem value="UPGRADE">Upgrade</SelectItem>
                            <SelectItem value="SERVICE">Routine Service</SelectItem>
                            <SelectItem value="REPLACEMENT">Part Replacement</SelectItem>
                            <SelectItem value="OTHER">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input type="date" value={newMx.performed_on} onChange={(e) => setNewMx({ ...newMx, performed_on: e.target.value })} className="h-9 text-sm" />
                      </div>
                      <Input placeholder="What was done…" value={newMx.description} onChange={(e) => setNewMx({ ...newMx, description: e.target.value })} className="h-9 text-sm" />
                      <div className="flex gap-2">
                        <Input type="number" step="0.01" placeholder="Cost (USD)" value={newMx.cost} onChange={(e) => setNewMx({ ...newMx, cost: e.target.value })} className="h-9 text-sm flex-1" />
                        {selectedAsset.is_bulk && (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={1}
                              max={selectedAsset.quantity_total ?? 1}
                              value={newMx.affected_quantity}
                              onChange={(e) => setNewMx({ ...newMx, affected_quantity: e.target.value })}
                              className="h-9 text-sm w-20 text-center"
                            />
                            <span className="text-[11px] text-muted-foreground whitespace-nowrap">of {selectedAsset.quantity_total} units</span>
                          </div>
                        )}
                      </div>
                      <Button size="sm" className="self-end" onClick={addMaintenance} disabled={addingMx || !newMx.description.trim()}>
                        {addingMx ? "Adding…" : "Add record"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-lg flex items-center gap-2 border-b pb-2"><History className="w-4 h-4" /> History Timeline</h3>
                <div className="mt-4 space-y-4">
                  {assetHistory.length === 0 ? <p className="text-sm text-neutral-500">No history available.</p> : (
                    assetHistory.map(h => (
                      <div key={h.id} className="text-sm border-l-2 border-neutral-200 dark:border-neutral-800 pl-3 py-1">
                        <p className="font-medium text-neutral-900 dark:text-neutral-100">
                          {h.action} <span className="text-xs text-neutral-500 font-normal">on {new Date(h.timestamp).toLocaleString()}</span>
                        </p>
                        <p className="text-neutral-600 dark:text-neutral-400 text-xs mt-1">
                          {h.from_user_name && `From: ${h.from_user_name}`} {h.to_user_name && `To: ${h.to_user_name}`}
                        </p>
                        {h.note && <p className="text-neutral-500 mt-1 italic">"{h.note}"</p>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-lg flex items-center gap-2 border-b pb-2"><MessageSquare className="w-4 h-4" /> Notes</h3>
                <div className="mt-4 space-y-3">
                  {assetNotes.length === 0 ? <p className="text-sm text-neutral-500">No notes available.</p> : (
                    assetNotes.map(n => (
                      <div key={n.id} className="bg-neutral-50 dark:bg-neutral-900 p-3 rounded-lg text-sm border border-neutral-100 dark:border-neutral-800">
                        <p>{n.note}</p>
                        <p className="text-xs text-neutral-500 mt-2">— {n.created_by_name} at {new Date(n.created_at).toLocaleString()}</p>
                      </div>
                    ))
                  )}
                  {isAdmin && (
                    <div className="mt-4 flex flex-col gap-2">
                      <Input placeholder="Add a new note..." value={newNote} onChange={e => setNewNote(e.target.value)} />
                      <Button size="sm" className="self-end" onClick={addNote} disabled={!newNote}>Add Note</Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
}

// ───────────────────────── Spec helpers ─────────────────────────

function formatSpecValue(v: any, type: SpecField["type"]): string {
  if (v == null || v === "") return "—";
  if (type === "bool") return v ? "Yes" : "No";
  return String(v);
}

// ───────────────────────── Spec Input ─────────────────────────

function SpecInput({
  field,
  value,
  onChange,
  error,
}: {
  field: SpecField;
  value: any;
  onChange: (v: any) => void;
  error?: string;
}) {
  const labelEl = (
    <label className="text-sm font-medium flex items-center gap-1">
      {field.label}
      {field.required && <span className="text-destructive">*</span>}
    </label>
  );

  let control: React.ReactNode;
  switch (field.type) {
    case "number":
      control = (
        <Input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
      break;
    case "date":
      control = (
        <Input type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
      );
      break;
    case "select":
      control = (
        <Select value={value ?? ""} onValueChange={(v) => onChange(v)}>
          <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {(field.options || []).map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "bool":
      control = (
        <div className="flex items-center h-10">
          <Switch checked={!!value} onCheckedChange={(v) => onChange(v)} />
        </div>
      );
      break;
    case "text":
    default:
      control = <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div className="space-y-1.5">
      {labelEl}
      {control}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
