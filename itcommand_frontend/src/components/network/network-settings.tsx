"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Server, Globe } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LOC_TYPES = ["SERVER_ROOM", "RACK", "CABINET", "FLOOR", "BUILDING", "CLOUD"];

function LocationsManager() {
  const [items, setItems] = useState<any[]>([]);
  const [offices, setOffices] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ name: "", location_type: "SERVER_ROOM", office: "", description: "" });

  const load = () => api.get("/network/locations/").then(r => setItems(r.data.results || r.data)).catch(() => {});
  useEffect(() => { load(); api.get("/seating/offices/").then(r => setOffices(r.data.results || r.data)).catch(() => {}); }, []);

  const openNew = () => { setEditing(null); setForm({ name: "", location_type: "SERVER_ROOM", office: "", description: "" }); setOpen(true); };
  const openEdit = (it: any) => { setEditing(it); setForm({ name: it.name, location_type: it.location_type, office: it.office ? String(it.office) : "", description: it.description || "" }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast.error("Name required"); return; }
    const payload = { ...form, office: form.office ? parseInt(form.office) : null };
    try {
      if (editing) await api.patch(`/network/locations/${editing.id}/`, payload);
      else await api.post("/network/locations/", payload);
      toast.success("Saved"); setOpen(false); load();
    } catch { toast.error("Save failed"); }
  };

  const remove = async (it: any) => {
    if (!confirm(`Delete location "${it.name}"?`)) return;
    try { await api.delete(`/network/locations/${it.id}/`); toast.success("Deleted"); load(); }
    catch { toast.error("Delete failed (devices may be linked)"); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base"><Server className="w-4 h-4 text-violet-500" />Network Locations</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" />Add</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Office</TableHead><TableHead className="text-right">Devices</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-neutral-500 py-6">No locations yet.</TableCell></TableRow> :
              items.map(it => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{it.location_type?.replace("_", " ")}</Badge></TableCell>
                  <TableCell className="text-sm text-neutral-500">{it.office_name || "—"}</TableCell>
                  <TableCell className="text-right">{it.device_count ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(it)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => remove(it)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"} Network Location</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Main Server Room" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Type</Label><Select value={form.location_type} onValueChange={v => setForm({ ...form, location_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{LOC_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1"><Label>Office</Label><Select value={form.office || "NONE"} onValueChange={v => setForm({ ...form, office: v === "NONE" ? "" : v })}><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger><SelectContent><SelectItem value="NONE">None</SelectItem>{offices.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="space-y-1"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function IPPoolsManager() {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ name: "", network_address: "", subnet_mask: "255.255.255.0", cidr_prefix: "24", gateway: "", vlan_id: "", description: "" });

  const load = () => api.get("/network/ip-pools/").then(r => setItems(r.data.results || r.data)).catch(() => {});
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm({ name: "", network_address: "", subnet_mask: "255.255.255.0", cidr_prefix: "24", gateway: "", vlan_id: "", description: "" }); setOpen(true); };
  const openEdit = (it: any) => { setEditing(it); setForm({ name: it.name, network_address: it.network_address, subnet_mask: it.subnet_mask, cidr_prefix: String(it.cidr_prefix), gateway: it.gateway || "", vlan_id: it.vlan_id ? String(it.vlan_id) : "", description: it.description || "" }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim() || !form.network_address.trim()) { toast.error("Name and network address required"); return; }
    const payload = { ...form, cidr_prefix: parseInt(form.cidr_prefix) || 24, vlan_id: form.vlan_id ? parseInt(form.vlan_id) : null, gateway: form.gateway || null };
    try {
      if (editing) await api.patch(`/network/ip-pools/${editing.id}/`, payload);
      else await api.post("/network/ip-pools/", payload);
      toast.success("Saved"); setOpen(false); load();
    } catch { toast.error("Save failed"); }
  };

  const remove = async (it: any) => {
    if (!confirm(`Delete pool "${it.name}"?`)) return;
    try { await api.delete(`/network/ip-pools/${it.id}/`); toast.success("Deleted"); load(); }
    catch { toast.error("Delete failed"); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base"><Globe className="w-4 h-4 text-violet-500" />IP Address Pools</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" />Add</Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Network</TableHead><TableHead>Gateway</TableHead><TableHead>VLAN</TableHead><TableHead className="text-right">Used/Total</TableHead><TableHead className="w-20" /></TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-neutral-500 py-6">No pools yet.</TableCell></TableRow> :
              items.map(it => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell className="font-mono text-sm">{it.network_address}/{it.cidr_prefix}</TableCell>
                  <TableCell className="font-mono text-sm">{it.gateway || "—"}</TableCell>
                  <TableCell>{it.vlan_id || "—"}</TableCell>
                  <TableCell className="text-right text-sm">{it.used_ips ?? 0}/{it.total_ips ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(it)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500" onClick={() => remove(it)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"} IP Pool</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Office LAN" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Network Address *</Label><Input value={form.network_address} onChange={e => setForm({ ...form, network_address: e.target.value })} placeholder="192.168.1.0" /></div>
              <div className="space-y-1"><Label>CIDR Prefix</Label><Input type="number" value={form.cidr_prefix} onChange={e => setForm({ ...form, cidr_prefix: e.target.value })} placeholder="24" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Gateway</Label><Input value={form.gateway} onChange={e => setForm({ ...form, gateway: e.target.value })} placeholder="192.168.1.1" /></div>
              <div className="space-y-1"><Label>VLAN ID</Label><Input type="number" value={form.vlan_id} onChange={e => setForm({ ...form, vlan_id: e.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label>Subnet Mask</Label><Input value={form.subnet_mask} onChange={e => setForm({ ...form, subnet_mask: e.target.value })} /></div>
            <div className="space-y-1"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function NetworkSettingsTab() {
  return (
    <div className="space-y-6">
      <LocationsManager />
      <IPPoolsManager />
    </div>
  );
}
