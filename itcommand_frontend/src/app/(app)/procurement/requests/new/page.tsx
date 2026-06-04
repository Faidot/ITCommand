"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Upload } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuthStore } from "@/store/authStore";

interface PRItem {
  id?: number;
  item_name: string;
  description: string;
  quantity: number;
  unit: string;
  estimated_unit_price: number;
  category: string;
}

export default function NewPurchaseRequestPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [budgetCategories, setBudgetCategories] = useState<any[]>([]);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    department: "",
    priority: "NORMAL",
    justification: "",
    preferred_vendor: "",
    required_by_date: "",
    budget_category: "",
    notes: "",
  });

  const [items, setItems] = useState<PRItem[]>([
    { item_name: "", description: "", quantity: 1, unit: "pcs", estimated_unit_price: 0, category: "OTHER" },
  ]);

  const [files, setFiles] = useState<File[]>([]);

  useEffect(() => {
    fetchLookups();
  }, []);

  const fetchLookups = async () => {
    try {
      const [deptRes, vendorRes, catRes] = await Promise.all([
        api.get("/departments/"),
        api.get("/vendors/?is_active=true"),
        api.get("/finance/categories/"),
      ]);
      setDepartments(deptRes.data.results || deptRes.data);
      setVendors(vendorRes.data.results || vendorRes.data);
      setBudgetCategories(catRes.data.results || catRes.data);

      // Auto-fill department from user
      if (user?.department) {
        setFormData((prev) => ({ ...prev, department: String(user.department) }));
      }
    } catch {
      console.error("Failed to load lookups");
    }
  };

  const updateItem = (index: number, field: keyof PRItem, value: any) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const addItem = () => {
    setItems((prev) => [...prev, { item_name: "", description: "", quantity: 1, unit: "pcs", estimated_unit_price: 0, category: "OTHER" }]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const totalEstimated = items.reduce((sum, item) => sum + item.quantity * item.estimated_unit_price, 0);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 }).format(amount);

  const handleSave = async (submitAfter: boolean) => {
    if (!formData.title.trim()) {
      toast.error("Title is required");
      return;
    }

    const validItems = items.filter((i) => i.item_name.trim());
    if (validItems.length === 0) {
      toast.error("Add at least one item");
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        ...formData,
        department: formData.department ? parseInt(formData.department) : null,
        preferred_vendor: formData.preferred_vendor ? parseInt(formData.preferred_vendor) : null,
        budget_category: formData.budget_category ? parseInt(formData.budget_category) : null,
        required_by_date: formData.required_by_date || null,
        items: validItems.map((i) => ({
          item_name: i.item_name,
          description: i.description,
          quantity: i.quantity,
          unit: i.unit,
          estimated_unit_price: i.estimated_unit_price,
          category: i.category,
        })),
      };

      const res = await api.post("/procurement/requests/", payload);
      const prId = res.data.id;

      // Upload files if any
      for (const file of files) {
        const fd = new FormData();
        fd.append("document", file);
        fd.append("document_type", "QUOTATION");
        fd.append("pr", prId);
        try {
          await api.post(`/procurement/requests/${prId}/documents/`, fd, {
            headers: { "Content-Type": "multipart/form-data" },
          });
        } catch {
          console.error("Failed to upload document");
        }
      }

      if (submitAfter) {
        await api.post(`/procurement/requests/${prId}/submit/`);
        toast.success("Purchase Request submitted for approval!");
      } else {
        toast.success("Purchase Request saved as draft.");
      }

      router.push(`/procurement/requests/${prId}`);
    } catch (err: any) {
      console.error("API Error:", err.response?.data);
      if (err.response?.data && typeof err.response.data === "object") {
        const errors = Object.entries(err.response.data)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
          .join(" | ");
        toast.error(`Error: ${errors}`);
      } else {
        toast.error("Failed to save PR");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto p-4">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push("/procurement/requests")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Purchase Request</h1>
          <p className="text-neutral-500 text-sm">Fill in the details below and add items to request procurement.</p>
        </div>
      </div>

      {/* Section 1: Request Details */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Request Details</h2>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Title <span className="text-red-500">*</span></Label>
            <Input value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} placeholder="e.g. Q2 Laptop Refresh for Engineering" />
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Brief description of this purchase request..." />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Department</Label>
              <Select value={formData.department} onValueChange={(v) => setFormData({ ...formData, department: v })}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Required By</Label>
              <Input type="date" value={formData.required_by_date} onChange={(e) => setFormData({ ...formData, required_by_date: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Preferred Vendor</Label>
              <Select value={formData.preferred_vendor} onValueChange={(v) => setFormData({ ...formData, preferred_vendor: v })}>
                <SelectTrigger><SelectValue placeholder="Select vendor..." /></SelectTrigger>
                <SelectContent>
                  {vendors.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Budget Category</Label>
              <Select value={formData.budget_category} onValueChange={(v) => setFormData({ ...formData, budget_category: v })}>
                <SelectTrigger><SelectValue placeholder="Select category..." /></SelectTrigger>
                <SelectContent>
                  {budgetCategories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Justification</Label>
            <Textarea value={formData.justification} onChange={(e) => setFormData({ ...formData, justification: e.target.value })} placeholder="Why is this purchase needed?" className="h-20" />
          </div>
        </div>
      </Card>

      {/* Section 2: Items */}
      <Card className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Items</h2>
          <Button variant="outline" size="sm" onClick={addItem}>
            <Plus className="w-4 h-4 mr-1" /> Add Item
          </Button>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Item Name</TableHead>
                <TableHead className="w-[120px]">Category</TableHead>
                <TableHead className="w-[70px]">Qty</TableHead>
                <TableHead className="w-[80px]">Unit</TableHead>
                <TableHead className="w-[120px]">Unit Price</TableHead>
                <TableHead className="w-[100px] text-right">Total</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Input
                      value={item.item_name}
                      onChange={(e) => updateItem(index, "item_name", e.target.value)}
                      placeholder="Item name..."
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    <Select value={item.category} onValueChange={(v) => updateItem(index, "category", v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HARDWARE">Hardware</SelectItem>
                        <SelectItem value="SOFTWARE">Software</SelectItem>
                        <SelectItem value="PERIPHERAL">Peripheral</SelectItem>
                        <SelectItem value="SERVICE">Service</SelectItem>
                        <SelectItem value="CONSUMABLE">Consumable</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" min={1}
                      value={item.quantity}
                      onChange={(e) => updateItem(index, "quantity", parseInt(e.target.value) || 1)}
                      className="h-8 text-sm w-16"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={item.unit}
                      onChange={(e) => updateItem(index, "unit", e.target.value)}
                      className="h-8 text-sm w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number" step="0.01" min={0}
                      value={item.estimated_unit_price}
                      onChange={(e) => updateItem(index, "estimated_unit_price", parseFloat(e.target.value) || 0)}
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell className="text-right font-medium text-sm">
                    {formatCurrency(item.quantity * item.estimated_unit_price)}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600" onClick={() => removeItem(index)} disabled={items.length <= 1}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-end mt-4 pt-4 border-t">
          <div className="text-right">
            <div className="text-sm text-neutral-500">Estimated Total</div>
            <div className="text-2xl font-bold text-violet-600">{formatCurrency(totalEstimated)}</div>
          </div>
        </div>
      </Card>

      {/* Section 3: Attachments */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Attachments</h2>
        <div className="space-y-3">
          <Input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            multiple
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              setFiles((prev) => [...prev, ...selected]);
            }}
          />
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-neutral-50 dark:bg-neutral-800 p-2 rounded-md">
                  <span className="flex items-center gap-2">
                    <Upload className="w-4 h-4 text-neutral-400" /> {f.name}
                  </span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3 pb-8">
        <Button variant="outline" onClick={() => router.push("/procurement/requests")}>Cancel</Button>
        <Button variant="outline" onClick={() => handleSave(false)} disabled={loading}>
          {loading ? "Saving..." : "Save as Draft"}
        </Button>
        <Button className="bg-violet-600 hover:bg-violet-700" onClick={() => handleSave(true)} disabled={loading}>
          {loading ? "Submitting..." : "Submit for Approval"}
        </Button>
      </div>
    </div>
  );
}
