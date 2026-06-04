"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Star } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

const BLANK = {
  name: "",
  category: "OTHER",
  website: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  country: "",
  primary_contact_name: "",
  primary_contact_email: "",
  primary_contact_phone: "",
  tax_number: "",
  rating: 0,
  notes: "",
};

interface VendorDraft {
  id?: number;
  name: string;
  category?: string;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  primary_contact_name?: string | null;
  primary_contact_email?: string | null;
  primary_contact_phone?: string | null;
  tax_number?: string | null;
  rating?: number | null;
  notes?: string | null;
}

export function AddVendorDialog({
  open,
  onOpenChange,
  onSuccess,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  initial?: VendorDraft | null;
}) {
  const [loading, setLoading] = useState(false);
  const isEdit = !!initial?.id;
  const [formData, setFormData] = useState<typeof BLANK>(BLANK);

  // Sync formData when the dialog opens / initial changes.
  useEffect(() => {
    if (open) {
      if (initial) {
        setFormData({
          name: initial.name || "",
          category: initial.category || "OTHER",
          website: initial.website || "",
          email: initial.email || "",
          phone: initial.phone || "",
          address: initial.address || "",
          city: initial.city || "",
          country: initial.country || "",
          primary_contact_name: initial.primary_contact_name || "",
          primary_contact_email: initial.primary_contact_email || "",
          primary_contact_phone: initial.primary_contact_phone || "",
          tax_number: initial.tax_number || "",
          rating: initial.rating || 0,
          notes: initial.notes || "",
        });
      } else {
        setFormData(BLANK);
      }
    }
  }, [open, initial]);

  const handleSubmit = async () => {
    if (!formData.name) {
      toast.error("Vendor name is required");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        ...formData,
        rating: formData.rating > 0 ? formData.rating : null,
      };
      if (isEdit) {
        await api.put(`/vendors/${initial!.id}/`, payload);
        toast.success("Vendor updated");
      } else {
        await api.post("/vendors/", payload);
        toast.success("Vendor added");
      }
      onOpenChange(false);
      onSuccess();
      if (!isEdit) setFormData(BLANK);
    } catch (err: any) {
      console.error("API Error Response:", err.response?.data);
      if (err.response?.data && typeof err.response.data === 'object') {
        const errors = Object.entries(err.response.data)
          .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
          .join(" | ");
        toast.error(`Validation Error: ${errors}`);
      } else {
        toast.error(err.response?.data?.detail || "Failed to save vendor");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${initial?.name || "Vendor"}` : "Add New Vendor"}</DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="company" className="w-full flex-col">
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="company">Company Info</TabsTrigger>
            <TabsTrigger value="contact">Primary Contact</TabsTrigger>
            <TabsTrigger value="notes">Notes & Rating</TabsTrigger>
          </TabsList>

          <div className="overflow-y-auto pr-2 space-y-4" style={{ maxHeight: '60vh' }}>
            <TabsContent value="company" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label>Company Name <span className="text-red-500">*</span></Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Dell Technologies" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={formData.category} onValueChange={(v) => setFormData({...formData, category: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HARDWARE_SUPPLIER">Hardware Supplier</SelectItem>
                      <SelectItem value="SOFTWARE_VENDOR">Software Vendor</SelectItem>
                      <SelectItem value="SERVICE_PROVIDER">Service Provider</SelectItem>
                      <SelectItem value="TELECOM">Telecom</SelectItem>
                      <SelectItem value="CLOUD">Cloud Provider</SelectItem>
                      <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                      <SelectItem value="CONSULTANT">Consultant</SelectItem>
                      <SelectItem value="OTHER">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tax Number (NTN/STRN)</Label>
                  <Input value={formData.tax_number} onChange={e => setFormData({...formData, tax_number: e.target.value})} placeholder="Optional" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="sales@vendor.com" />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="+1 234 567 8900" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Website</Label>
                <Input type="url" value={formData.website} onChange={e => setFormData({...formData, website: e.target.value})} placeholder="https://..." />
              </div>

              <div className="space-y-2">
                <Label>Address</Label>
                <Input value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} placeholder="Street address" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} placeholder="City" />
                </div>
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Input value={formData.country} onChange={e => setFormData({...formData, country: e.target.value})} placeholder="Country" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="contact" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label>Contact Name</Label>
                <Input value={formData.primary_contact_name} onChange={e => setFormData({...formData, primary_contact_name: e.target.value})} placeholder="John Doe" />
              </div>
              <div className="space-y-2">
                <Label>Contact Email</Label>
                <Input type="email" value={formData.primary_contact_email} onChange={e => setFormData({...formData, primary_contact_email: e.target.value})} placeholder="john@vendor.com" />
              </div>
              <div className="space-y-2">
                <Label>Contact Phone</Label>
                <Input value={formData.primary_contact_phone} onChange={e => setFormData({...formData, primary_contact_phone: e.target.value})} placeholder="Direct or mobile number" />
              </div>
            </TabsContent>

            <TabsContent value="notes" className="space-y-4 mt-0">
              <div className="space-y-2">
                <Label>Vendor Rating</Label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star 
                      key={star} 
                      className={`w-8 h-8 cursor-pointer transition-colors ${star <= formData.rating ? "text-yellow-400 fill-yellow-400" : "text-neutral-300 dark:text-neutral-700 hover:text-yellow-200"}`}
                      onClick={() => setFormData({...formData, rating: star})}
                    />
                  ))}
                  <span className="ml-2 text-sm text-neutral-500">{formData.rating > 0 ? `${formData.rating} Stars` : "Unrated"}</span>
                </div>
              </div>
              <div className="space-y-2 pt-4">
                <Label>General Notes</Label>
                <Textarea 
                  value={formData.notes} 
                  onChange={e => setFormData({...formData, notes: e.target.value})} 
                  placeholder="Initial remarks, onboarding context..." 
                  className="h-32" 
                />
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <div className="pt-4 border-t mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-violet-600 hover:bg-violet-700">
            {loading ? "Saving..." : isEdit ? "Save changes" : "Add Vendor"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
