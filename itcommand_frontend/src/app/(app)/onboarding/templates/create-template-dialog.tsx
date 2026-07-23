"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

interface LovValue { value: string; label: string; }

/**
 * Create/edit dialog for a checklist template. Controlled by the parent so it
 * can be reused for both "new" (template=null) and "edit" (template set).
 */
export function TemplateDialog({
  open,
  onOpenChange,
  template,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  template?: any | null;
  onSuccess: () => void;
}) {
  const isEdit = !!template;
  const [departments, setDepartments] = useState<any[]>([]);
  const [categories, setCategories] = useState<LovValue[]>([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [processType, setProcessType] = useState("ONBOARDING");
  const [departmentId, setDepartmentId] = useState("none");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!open) return;
    fetchDependencies();
    if (isEdit) hydrateFromTemplate();
    else resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fetchDependencies = async () => {
    try {
      const [deptRes, catRes] = await Promise.all([
        api.get("/departments/"),
        api.get("/lov/?group=onboarding_category"),
      ]);
      setDepartments(deptRes.data.results || deptRes.data);
      setCategories(catRes.data.values || []);
    } catch {
      toast.error("Failed to load form options");
    }
  };

  const defaultCategory = () => categories[0]?.value || "ACCOUNTS";

  const blankItem = () => ({
    id: `new-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    title: "",
    description: "",
    category: defaultCategory(),
    assigned_role: "IT",
    estimated_hours: "",
  });

  const resetForm = () => {
    setName("");
    setProcessType("ONBOARDING");
    setDepartmentId("none");
    setDescription("");
    setItems([blankItem()]);
  };

  const hydrateFromTemplate = () => {
    setName(template.name || "");
    setProcessType(template.process_type || "ONBOARDING");
    setDepartmentId(template.department ? String(template.department) : "none");
    setDescription(template.description || "");
    const rows = (template.items || [])
      .slice()
      .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
      .map((it: any) => ({
        id: String(it.id),
        title: it.title || "",
        description: it.description || "",
        category: it.category || "ACCOUNTS",
        assigned_role: it.assigned_role || "IT",
        estimated_hours: it.estimated_hours != null ? String(it.estimated_hours) : "",
      }));
    setItems(rows.length ? rows : [blankItem()]);
  };

  const handleAddItem = () => setItems((prev) => [...prev, blankItem()]);
  const handleRemoveItem = (id: string) => setItems((prev) => prev.filter((i) => i.id !== id));
  const handleUpdateItem = (id: string, field: string, value: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, [field]: value } : i)));

  const moveItem = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === items.length - 1) return;
    const next = [...items];
    const target = direction === "up" ? index - 1 : index + 1;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return toast.error("Template name is required");
    for (let i = 0; i < items.length; i++) {
      if (!items[i].title.trim()) return toast.error(`Item #${i + 1} is missing a title`);
    }

    setLoading(true);
    try {
      const payload = {
        name,
        process_type: processType,
        department: departmentId === "none" ? null : parseInt(departmentId),
        description,
        is_active: template?.is_active ?? true,
      };

      let templateId: number;
      if (isEdit) {
        await api.patch(`/onboarding/templates/${template.id}/`, payload);
        templateId = template.id;
        // Simplest reliable reconcile: drop existing items, recreate from form.
        await Promise.all(
          (template.items || []).map((it: any) =>
            api.delete(`/onboarding/template-items/${it.id}/`).catch(() => {})
          )
        );
      } else {
        const res = await api.post("/onboarding/templates/", payload);
        templateId = res.data.id;
      }

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await api.post("/onboarding/template-items/", {
          template: templateId,
          title: item.title,
          description: item.description,
          category: item.category,
          assigned_role: item.assigned_role,
          order: i + 1,
          estimated_hours: item.estimated_hours ? parseFloat(item.estimated_hours) : null,
        });
      }

      toast.success(isEdit ? "Template updated" : "Template created successfully");
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || `Failed to ${isEdit ? "update" : "create"} template`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Checklist Template" : "Create Checklist Template"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 space-y-6 py-4">
          {/* Core Info */}
          <div className="space-y-4 p-4 border rounded-lg bg-neutral-50 dark:bg-neutral-900/50">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Template Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. standard developer onboarding" />
              </div>
              <div className="space-y-2">
                <Label>Process Type</Label>
                <Select value={processType} onValueChange={setProcessType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ONBOARDING">Onboarding</SelectItem>
                    <SelectItem value="OFFBOARDING">Offboarding</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Target Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">All Departments (Generic)</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Description</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description..." className="h-16 resize-none" />
              </div>
            </div>
          </div>

          {/* Checklist Items */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold tracking-wider uppercase text-neutral-500">Checklist Items</h3>
              <Badge variant="outline">{items.length} Tasks</Badge>
            </div>

            {items.map((item, index) => (
              <div key={item.id} className="p-4 border rounded-lg space-y-4 relative bg-white dark:bg-neutral-900">
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => moveItem(index, "up")} disabled={index === 0} className="h-6 w-6"><ArrowUp className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => moveItem(index, "down")} disabled={index === items.length - 1} className="h-6 w-6"><ArrowDown className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => handleRemoveItem(item.id)} className="h-6 w-6 text-red-500 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-3 w-3" /></Button>
                </div>

                <div className="flex items-center gap-2 font-mono text-xs text-neutral-400 absolute top-3 left-4">
                  #{index + 1}
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div className="space-y-2 col-span-2">
                    <Label className="text-xs">Task Title</Label>
                    <Input value={item.title} onChange={(e) => handleUpdateItem(item.id, "title", e.target.value)} placeholder="e.g. Create email account" className="h-8 text-sm" />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Category</Label>
                    <Select value={item.category} onValueChange={(v) => handleUpdateItem(item.id, "category", v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs">Assigned Role</Label>
                    <Select value={item.assigned_role} onValueChange={(v) => handleUpdateItem(item.id, "assigned_role", v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IT">IT</SelectItem>
                        <SelectItem value="HR">HR</SelectItem>
                        <SelectItem value="MANAGER">Manager</SelectItem>
                        <SelectItem value="ADMIN">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 col-span-2">
                    <Label className="text-xs">Instructions / Description</Label>
                    <Input value={item.description} onChange={(e) => handleUpdateItem(item.id, "description", e.target.value)} placeholder="Optional instructions..." className="h-8 text-sm" />
                  </div>
                </div>
              </div>
            ))}

            <Button variant="outline" className="w-full border-dashed text-violet-600 hover:text-violet-700" onClick={handleAddItem}>
              <Plus className="mr-2 h-4 w-4" /> Add Task
            </Button>
          </div>
        </div>

        <div className="pt-4 border-t mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-violet-600 hover:bg-violet-700">
            {loading ? "Saving..." : isEdit ? "Update Template" : "Save Template"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Backwards-compatible wrapper: the "Create Template" button + dialog. */
export function CreateTemplateDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="bg-violet-600 hover:bg-violet-700" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Create Template
      </Button>
      <TemplateDialog open={open} onOpenChange={setOpen} template={null} onSuccess={onSuccess} />
    </>
  );
}
