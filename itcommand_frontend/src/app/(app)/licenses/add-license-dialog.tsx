"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface LicenseInitial {
  id: number;
  product?: number;
  product_name?: string;
  product_vendor?: string;
  license_type: string;
  seats_total: number | null;
  purchase_date: string | null;
  expiry_date: string | null;
  cost: number | string;
  billing_cycle: string | null;
  notes?: string;
  is_active?: boolean;
  auto_renew?: boolean;
}

export function AddLicenseDialog({
  onSuccess,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  initial,
}: {
  onSuccess: () => void;
  /** Controlled mode: provide both to drive the dialog from a parent. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Pass an existing license to switch the dialog to edit mode (PUT instead of POST). */
  initial?: LicenseInitial | null;
}) {
  const isEdit = !!initial?.id;
  const isControlled = controlledOpen !== undefined;

  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? !!controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (isControlled) setControlledOpen?.(v);
    else setInternalOpen(v);
  };

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Product state
  const [products, setProducts] = useState<any[]>([]);
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [newProduct, setNewProduct] = useState({ name: "", vendor: "", category: "OTHER" });

  // Step 2: License state
  const [license, setLicense] = useState({
    license_key: "",
    license_type: "SUBSCRIPTION",
    seats_total: "",
    purchase_date: "",
    expiry_date: "",
    cost: "",
    billing_cycle: "YEARLY",
    notes: ""
  });

  useEffect(() => {
    if (open) {
      fetchProducts();
      if (isEdit && initial) {
        // Edit mode: skip product step (product is immutable on a license).
        setStep(2);
        setIsNewProduct(false);
        setSelectedProductId(initial.product ? String(initial.product) : "");
        setNewProduct({ name: "", vendor: "", category: "OTHER" });
        setLicense({
          license_key: "", // Blank means "keep existing encrypted key".
          license_type: initial.license_type || "SUBSCRIPTION",
          seats_total: initial.seats_total != null ? String(initial.seats_total) : "",
          purchase_date: initial.purchase_date || "",
          expiry_date: initial.expiry_date || "",
          cost: initial.cost != null ? String(initial.cost) : "",
          billing_cycle: initial.billing_cycle || "YEARLY",
          notes: initial.notes || "",
        });
      } else {
        setStep(1);
        setIsNewProduct(false);
        setSelectedProductId("");
        setNewProduct({ name: "", vendor: "", category: "OTHER" });
        setLicense({
          license_key: "",
          license_type: "SUBSCRIPTION",
          seats_total: "",
          purchase_date: "",
          expiry_date: "",
          cost: "",
          billing_cycle: "YEARLY",
          notes: "",
        });
      }
    }
  }, [open, isEdit, initial]);

  const fetchProducts = async () => {
    try {
      const res = await api.get("/licenses/products/");
      // The endpoint returns a list or a paginated response. Handle both.
      setProducts(res.data.results || res.data);
    } catch {
      toast.error("Failed to load products");
    }
  };

  const handleNext = () => {
    if (isNewProduct) {
      if (!newProduct.name || !newProduct.vendor) {
        toast.error("Product name and vendor are required");
        return;
      }
    } else {
      if (!selectedProductId) {
        toast.error("Please select a product");
        return;
      }
    }
    setStep(2);
  };

  const handleSubmit = async () => {
    // Expiry is only required for recurring billing (monthly/yearly).
    // One-time / perpetual purchases can leave it blank.
    const effectiveCycle = license.license_type === "PERPETUAL" ? "ONE_TIME" : license.billing_cycle;
    const isRecurring = effectiveCycle === "MONTHLY" || effectiveCycle === "YEARLY";
    if (isRecurring && !license.expiry_date) {
      toast.error("Expiry date is required for monthly/yearly billing");
      return;
    }
    if (license.expiry_date) {
      const expiryDateObj = new Date(license.expiry_date);
      if (expiryDateObj <= new Date()) {
        toast.error("Expiry date must be in the future");
        return;
      }
    }

    setLoading(true);
    try {
      let productId: number | string = selectedProductId;

      if (!isEdit && isNewProduct) {
        const productRes = await api.post("/licenses/products/", newProduct);
        productId = productRes.data.id;
      }

      const payload: any = {
        ...license,
        product: isEdit ? initial!.product : productId,
        seats_total: license.seats_total ? parseInt(license.seats_total) : null,
        cost: license.cost ? parseFloat(license.cost) : 0,
        billing_cycle: license.license_type === "PERPETUAL" ? "ONE_TIME" : license.billing_cycle,
        // DRF DateField rejects "" — coerce empty strings to null.
        purchase_date: license.purchase_date || null,
        expiry_date: license.expiry_date || null,
      };
      if (!isEdit) {
        payload.is_active = true;
      }
      // license_key blank on edit = keep existing. Drop the field so the
      // serializer's update() doesn't overwrite the encrypted key.
      if (isEdit && !payload.license_key) {
        delete payload.license_key;
      }

      if (isEdit) {
        await api.put(`/licenses/${initial!.id}/`, payload);
        toast.success("License updated");
      } else {
        await api.post("/licenses/", payload);
        toast.success("License added successfully");
      }
      setOpen(false);
      onSuccess();
    } catch (err: any) {
      const data = err.response?.data;
      toast.error(
        data?.detail
          || (typeof data === "object" && data
              ? Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" | ")
              : isEdit ? "Failed to update license" : "Failed to create license")
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {!isControlled && (
        <Button className="bg-violet-600 hover:bg-violet-700" onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add License
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {isEdit
                ? `Edit ${initial?.product_name || "License"}`
                : step === 1
                  ? "Step 1: Select Software Product"
                  : "Step 2: License Details"}
            </DialogTitle>
          </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-4 mb-4">
              <Button variant={!isNewProduct ? "default" : "outline"} onClick={() => setIsNewProduct(false)} className={!isNewProduct ? "bg-violet-600" : ""}>Select Existing</Button>
              <Button variant={isNewProduct ? "default" : "outline"} onClick={() => setIsNewProduct(true)} className={isNewProduct ? "bg-violet-600" : ""}>Create New</Button>
            </div>

            {!isNewProduct ? (
              <div className="space-y-2">
                <Label>Software Product</Label>
                <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.name} ({p.vendor})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Product Name</Label>
                  <Input value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} placeholder="e.g. Adobe Creative Cloud" />
                </div>
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Input value={newProduct.vendor} onChange={e => setNewProduct({...newProduct, vendor: e.target.value})} placeholder="e.g. Adobe" />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={newProduct.category} onValueChange={(val) => setNewProduct({...newProduct, category: val})}>
                    <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRODUCTIVITY">Productivity</SelectItem>
                      <SelectItem value="DESIGN">Design</SelectItem>
                      <SelectItem value="DEVELOPMENT">Development</SelectItem>
                      <SelectItem value="SECURITY">Security</SelectItem>
                      <SelectItem value="COMMUNICATION">Communication</SelectItem>
                      <SelectItem value="OS">Operating System</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            
            <div className="flex justify-end pt-4">
              <Button onClick={handleNext} className="bg-violet-600 hover:bg-violet-700">Next Step</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto px-1">
            <div className="space-y-2">
              <Label>License Key</Label>
              <Input
                type="password"
                value={license.license_key}
                onChange={e => setLicense({...license, license_key: e.target.value})}
                placeholder={isEdit ? "Leave blank to keep existing key" : "Enter license key (will be encrypted)"}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>License Type</Label>
                <Select value={license.license_type} onValueChange={(val) => setLicense({...license, license_type: val})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERPETUAL">Perpetual</SelectItem>
                    <SelectItem value="SUBSCRIPTION">Subscription</SelectItem>
                    <SelectItem value="VOLUME">Volume</SelectItem>
                    <SelectItem value="OEM">OEM</SelectItem>
                    <SelectItem value="OPEN_SOURCE">Open Source</SelectItem>
                    <SelectItem value="TRIAL">Trial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Total Seats</Label>
                <Input type="number" value={license.seats_total} onChange={e => setLicense({...license, seats_total: e.target.value})} placeholder="Leave blank for unlimited" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cost</Label>
                <Input type="number" step="0.01" value={license.cost} onChange={e => setLicense({...license, cost: e.target.value})} placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <Label>Billing Cycle</Label>
                <Select value={license.billing_cycle} onValueChange={(val) => setLicense({...license, billing_cycle: val})} disabled={license.license_type === "PERPETUAL"}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ONE_TIME">One Time</SelectItem>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="YEARLY">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Purchase Date</Label>
                <Input type="date" value={license.purchase_date} onChange={e => setLicense({...license, purchase_date: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>
                  Expiry Date
                  {(() => {
                    const effectiveCycle = license.license_type === "PERPETUAL" ? "ONE_TIME" : license.billing_cycle;
                    const isRecurring = effectiveCycle === "MONTHLY" || effectiveCycle === "YEARLY";
                    return isRecurring
                      ? <span className="text-red-500 ml-1">*</span>
                      : <span className="text-neutral-400 ml-1 text-xs">(Optional)</span>;
                  })()}
                </Label>
                <Input
                  type="date"
                  value={license.expiry_date}
                  onChange={e => setLicense({...license, expiry_date: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Input value={license.notes} onChange={e => setLicense({...license, notes: e.target.value})} placeholder="Any additional notes..." />
            </div>

            <div className="flex justify-between pt-4">
              {isEdit ? (
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              ) : (
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              )}
              <Button onClick={handleSubmit} disabled={loading} className="bg-violet-600 hover:bg-violet-700">
                {loading ? "Saving..." : isEdit ? "Save changes" : "Save License"}
              </Button>
            </div>
          </div>
        )}

      </DialogContent>
      </Dialog>
    </>
  );
}
