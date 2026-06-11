"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  value: string;
  onChange: (v: string) => void;
  sources: any[];
  /** Called with the newly created source so the parent can refresh its list. */
  onAdded: (source: any) => void;
  placeholder?: string;
  canAdd?: boolean;
};

export function SourceSelect({ value, onChange, sources, onAdded, placeholder = "Select source", canAdd = true }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const addSource = async () => {
    if (!name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const res = await api.post("/finance/sources/", { name: name.trim(), is_active: true });
      toast.success("Source added");
      onAdded(res.data);
      onChange(String(res.data.id));
      setName(""); setOpen(false);
    } catch (e: any) {
      toast.error(e.response?.data?.name?.[0] || "Failed to add source");
    } finally { setSaving(false); }
  };

  return (
    <div className="flex gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="flex-1"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>{sources.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}</SelectContent>
      </Select>
      {canAdd && (
        <Button type="button" variant="outline" size="icon" onClick={() => setOpen(true)} title="Add new source"><Plus className="w-4 h-4" /></Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Income Source</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Source name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addSource()} autoFocus />
            <p className="text-xs text-neutral-500">Sources are shared and also manageable in Settings → Income Sources.</p>
          </div>
          <DialogFooter><Button onClick={addSource} disabled={saving}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
