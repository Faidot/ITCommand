"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import api from "@/lib/api";
import { toast } from "sonner";

export function AddContractDialog({ vendorId, open, onOpenChange, onSuccess }: { vendorId: number, open: boolean, onOpenChange: (open: boolean) => void, onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    contract_type: "SERVICE",
    start_date: "",
    end_date: "",
    value: "",
    currency: "PKR",
    payment_terms: "",
    auto_renew: false,
    status: "DRAFT",
    description: "",
    terms_summary: ""
  });
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = async () => {
    if (!formData.title) {
      toast.error("Contract title is required");
      return;
    }
    
    setLoading(true);
    try {
      const data = new FormData();
      data.append('vendor', vendorId.toString());
      data.append('title', formData.title);
      data.append('contract_type', formData.contract_type);
      if (formData.start_date) data.append('start_date', formData.start_date);
      if (formData.end_date) data.append('end_date', formData.end_date);
      if (formData.value) data.append('value', formData.value);
      data.append('currency', formData.currency);
      data.append('payment_terms', formData.payment_terms);
      data.append('auto_renew', formData.auto_renew ? 'true' : 'false');
      data.append('status', formData.status);
      data.append('description', formData.description);
      data.append('terms_summary', formData.terms_summary);
      
      if (file) {
        data.append('document', file);
      }

      await api.post("/vendors/contracts/", data, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      toast.success("Contract added successfully");
      onOpenChange(false);
      onSuccess();
      setFormData({
        title: "", contract_type: "SERVICE", start_date: "", end_date: "", value: "",
        currency: "PKR", payment_terms: "", auto_renew: false, status: "DRAFT",
        description: "", terms_summary: ""
      });
      setFile(null);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to add contract");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Vendor Contract</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4 pr-2">
          <div className="space-y-2">
            <Label>Contract Title <span className="text-red-500">*</span></Label>
            <Input value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} placeholder="e.g. Annual AMC 2024" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Contract Type</Label>
              <Select value={formData.contract_type} onValueChange={(v) => setFormData({...formData, contract_type: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AMC">Annual Maintenance Contract (AMC)</SelectItem>
                  <SelectItem value="SLA">Service Level Agreement (SLA)</SelectItem>
                  <SelectItem value="PURCHASE">Purchase Agreement</SelectItem>
                  <SelectItem value="SERVICE">Service Agreement</SelectItem>
                  <SelectItem value="LICENSE">Software License</SelectItem>
                  <SelectItem value="NDA">Non-Disclosure Agreement</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="EXPIRED">Expired</SelectItem>
                  <SelectItem value="TERMINATED">Terminated</SelectItem>
                  <SelectItem value="RENEWED">Renewed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Date</Label>
              <Input type="date" value={formData.start_date} onChange={e => setFormData({...formData, start_date: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label>End Date</Label>
              <Input type="date" value={formData.end_date} onChange={e => setFormData({...formData, end_date: e.target.value})} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Value</Label>
              <Input type="number" step="0.01" value={formData.value} onChange={e => setFormData({...formData, value: e.target.value})} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={formData.currency} onValueChange={(v) => setFormData({...formData, currency: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PKR">PKR</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                  <SelectItem value="GBP">GBP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Payment Terms</Label>
            <Input value={formData.payment_terms} onChange={e => setFormData({...formData, payment_terms: e.target.value})} placeholder="e.g. Net 30, Quarterly advance" />
          </div>

          <div className="flex items-center space-x-2 my-4">
            <Checkbox 
              id="auto-renew" 
              checked={formData.auto_renew} 
              onCheckedChange={(c) => setFormData({...formData, auto_renew: c === true})} 
            />
            <label htmlFor="auto-renew" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Contract Auto-renews
            </label>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          </div>

          <div className="space-y-2">
            <Label>Terms Summary</Label>
            <Textarea value={formData.terms_summary} onChange={e => setFormData({...formData, terms_summary: e.target.value})} placeholder="Brief bullet points of key terms..." />
          </div>

          <div className="space-y-2 pt-2">
            <Label>Upload Document (PDF/DOCX)</Label>
            <Input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
        </div>

        <div className="pt-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-violet-600 hover:bg-violet-700">
            {loading ? "Saving..." : "Save Contract"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
