"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Settings2,
  Save,
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  Clock,
  Tag,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const PRIORITY_BADGE: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0",
  HIGH: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-0",
  MEDIUM: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-0",
  LOW: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0",
};

interface SLAPolicy {
  id: number;
  priority: string;
  response_hours: number;
  resolution_hours: number;
  description: string;
}

interface TicketCategory {
  id: number;
  name: string;
  description: string;
  icon_name: string;
  is_active: boolean;
  ticket_count?: number;
}

export default function HelpdeskSettingsPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [slas, setSlas] = useState<SLAPolicy[]>([]);
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);

  // SLA inline edit
  const [editingSla, setEditingSla] = useState<number | null>(null);
  const [slaEdits, setSlaEdits] = useState<Partial<SLAPolicy>>({});

  // Category dialog
  const [showCatDialog, setShowCatDialog] = useState(false);
  const [editingCat, setEditingCat] = useState<TicketCategory | null>(null);
  const [catForm, setCatForm] = useState({ name: "", description: "", icon_name: "CircleDot" });

  const fetchData = async () => {
    try {
      setLoading(true);
      const [slaRes, catRes] = await Promise.all([
        api.get("/helpdesk/sla-policies/"),
        api.get("/helpdesk/categories/"),
      ]);
      setSlas(slaRes.data);
      setCategories(catRes.data);
    } catch {
      toast.error("Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ── SLA handlers ──
  const startEditSla = (sla: SLAPolicy) => {
    setEditingSla(sla.id);
    setSlaEdits({
      response_hours: sla.response_hours,
      resolution_hours: sla.resolution_hours,
      description: sla.description,
    });
  };

  const saveSla = async (id: number) => {
    try {
      await api.patch(`/helpdesk/sla-policies/${id}/`, slaEdits);
      toast.success("SLA policy updated");
      setEditingSla(null);
      fetchData();
    } catch {
      toast.error("Failed to update SLA policy");
    }
  };

  // ── Category handlers ──
  const openAddCat = () => {
    setEditingCat(null);
    setCatForm({ name: "", description: "", icon_name: "CircleDot" });
    setShowCatDialog(true);
  };

  const openEditCat = (cat: TicketCategory) => {
    setEditingCat(cat);
    setCatForm({ name: cat.name, description: cat.description, icon_name: cat.icon_name });
    setShowCatDialog(true);
  };

  const saveCat = async () => {
    if (!catForm.name.trim()) {
      toast.error("Name is required");
      return;
    }
    try {
      if (editingCat) {
        await api.patch(`/helpdesk/categories/${editingCat.id}/`, catForm);
        toast.success("Category updated");
      } else {
        await api.post("/helpdesk/categories/", catForm);
        toast.success("Category created");
      }
      setShowCatDialog(false);
      fetchData();
    } catch {
      toast.error("Failed to save category");
    }
  };

  const deleteCat = async (id: number) => {
    if (!confirm("Delete this category?")) return;
    try {
      await api.delete(`/helpdesk/categories/${id}/`);
      toast.success("Category deleted");
      fetchData();
    } catch {
      toast.error("Failed to delete category");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 w-full max-w-5xl mx-auto p-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Settings2 className="h-6 w-6 text-violet-500" /> Helpdesk Settings
        </h1>
        <p className="text-neutral-500">Manage SLA policies and ticket categories</p>
      </div>

      {/* SLA Policies */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-5 w-5 text-violet-500" /> SLA Policies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Priority</TableHead>
                <TableHead>Response Time (hours)</TableHead>
                <TableHead>Resolution Time (hours)</TableHead>
                <TableHead>Description</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {slas.map((sla) => (
                <TableRow key={sla.id}>
                  <TableCell>
                    <Badge className={PRIORITY_BADGE[sla.priority] + " text-xs font-semibold"}>
                      {sla.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {editingSla === sla.id ? (
                      <Input
                        type="number"
                        className="w-20"
                        value={slaEdits.response_hours || ""}
                        onChange={(e) =>
                          setSlaEdits({ ...slaEdits, response_hours: parseInt(e.target.value) || 0 })
                        }
                      />
                    ) : (
                      <span className="font-mono text-sm">{sla.response_hours}h</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editingSla === sla.id ? (
                      <Input
                        type="number"
                        className="w-20"
                        value={slaEdits.resolution_hours || ""}
                        onChange={(e) =>
                          setSlaEdits({ ...slaEdits, resolution_hours: parseInt(e.target.value) || 0 })
                        }
                      />
                    ) : (
                      <span className="font-mono text-sm">{sla.resolution_hours}h</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-neutral-500 max-w-[250px] truncate">
                    {editingSla === sla.id ? (
                      <Input
                        value={slaEdits.description || ""}
                        onChange={(e) => setSlaEdits({ ...slaEdits, description: e.target.value })}
                      />
                    ) : (
                      sla.description
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      {editingSla === sla.id ? (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => saveSla(sla.id)}>
                            <Check className="h-4 w-4 text-emerald-500" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingSla(null)}>
                            <X className="h-4 w-4 text-neutral-400" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => startEditSla(sla)}>
                          <Pencil className="h-4 w-4 text-neutral-400" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Ticket Categories */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-5 w-5 text-violet-500" /> Ticket Categories
          </CardTitle>
          {isAdmin && (
            <Button size="sm" onClick={openAddCat} className="bg-violet-600 hover:bg-violet-700">
              <Plus className="mr-1 h-4 w-4" /> Add Category
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Icon</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Tickets</TableHead>
                <TableHead>Active</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-neutral-400">
                    No categories yet
                  </TableCell>
                </TableRow>
              ) : (
                categories.map((cat) => (
                  <TableRow key={cat.id}>
                    <TableCell className="font-medium">{cat.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-mono">{cat.icon_name}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-neutral-500 max-w-[200px] truncate">
                      {cat.description}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-mono">{cat.ticket_count ?? 0}</span>
                    </TableCell>
                    <TableCell>
                      {cat.is_active ? (
                        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-[10px]">Active</Badge>
                      ) : (
                        <Badge className="bg-neutral-100 text-neutral-500 border-0 text-[10px]">Inactive</Badge>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="ghost" onClick={() => openEditCat(cat)}>
                            <Pencil className="h-4 w-4 text-neutral-400" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteCat(cat.id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Category Dialog */}
      <Dialog open={showCatDialog} onOpenChange={setShowCatDialog}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>{editingCat ? "Edit Category" : "New Category"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Name *</label>
              <Input
                placeholder="e.g. Hardware"
                value={catForm.name}
                onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Icon Name</label>
              <Input
                placeholder="Lucide icon name, e.g. Monitor"
                value={catForm.icon_name}
                onChange={(e) => setCatForm({ ...catForm, icon_name: e.target.value })}
              />
              <p className="text-[10px] text-neutral-400 mt-1">
                Use Lucide icon names: Monitor, Wifi, Mail, KeyRound, AppWindow, CircleDot, etc.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Description</label>
              <Textarea
                placeholder="Brief description..."
                rows={2}
                value={catForm.description}
                onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCatDialog(false)}>Cancel</Button>
            <Button onClick={saveCat} className="bg-violet-600 hover:bg-violet-700">
              <Save className="mr-2 h-4 w-4" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
