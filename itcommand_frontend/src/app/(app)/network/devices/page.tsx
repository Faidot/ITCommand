"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HardDrive, Search, Plus, Download, X } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

const SC: Record<string,string> = { ONLINE:"bg-emerald-100 text-emerald-800", OFFLINE:"bg-red-100 text-red-800", MAINTENANCE:"bg-yellow-100 text-yellow-800", DECOMMISSIONED:"bg-neutral-200 text-neutral-500" };

export default function NetworkDevicesPage() {
  const router = useRouter(); const sp = useSearchParams();
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(sp.get("type") || "ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [locations, setLocations] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkLocation, setBulkLocation] = useState("");
  const [form, setForm] = useState<any>({ device_name:"",device_type:"SERVER",brand:"",model:"",serial_number:"",ip_address:"",mac_address:"",hostname:"",subnet_mask:"",gateway:"",vlan_id:"",dns_primary:"",dns_secondary:"",location:"",rack_unit_start:"",rack_unit_size:"1",os_name:"",os_version:"",firmware_version:"",cpu_info:"",ram_gb:"",storage_info:"",purchase_date:"",warranty_expiry:"",vendor:"",status:"OFFLINE",notes:"" });

  useEffect(() => {
    api.get("/network/locations/").then(r=>setLocations(r.data.results||r.data)).catch(()=>{});
    api.get("/vendors/?is_active=true").then(r=>setVendors(r.data.results||r.data)).catch(()=>{});
  }, []);

  useEffect(() => { const h = setTimeout(()=>fetchDevices(),300); return ()=>clearTimeout(h); }, [search,typeFilter,statusFilter]);

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if(search) p.append("search",search);
      if(typeFilter!=="ALL") p.append("device_type",typeFilter);
      if(statusFilter!=="ALL") p.append("status",statusFilter);
      const r = await api.get(`/network/devices/?${p}`);
      setDevices(r.data.results||r.data);
    } catch { toast.error("Failed to load devices"); }
    finally { setLoading(false); }
  };

  const toggle = (id: number) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const toggleAll = () => setSelected(s => s.size === devices.length ? new Set() : new Set(devices.map(d => d.id)));

  const applyBulk = async () => {
    if (selected.size === 0) return;
    if (!bulkStatus && !bulkLocation) { toast.error("Pick a status or location to apply"); return; }
    try {
      const payload: any = { ids: Array.from(selected) };
      if (bulkStatus) payload.status = bulkStatus;
      if (bulkLocation) payload.location = bulkLocation === "NONE" ? null : parseInt(bulkLocation);
      const r = await api.post("/network/devices/bulk-update/", payload);
      toast.success(`Updated ${r.data.updated} device(s)`);
      setSelected(new Set()); setBulkStatus(""); setBulkLocation(""); fetchDevices();
    } catch { toast.error("Bulk update failed"); }
  };

  const handleExport = async () => {
    try {
      const r = await api.get("/network/export/", { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([r.data]));
      const link = document.createElement("a");
      link.href = url; link.setAttribute("download", "network_inventory.xlsx");
      document.body.appendChild(link); link.click(); link.remove();
    } catch { toast.error("Export failed"); }
  };

  const handleSave = async () => {
    if(!form.device_name){toast.error("Device name required");return;}
    setSaving(true);
    try {
      const payload:any = {...form};
      ['location','vendor','vlan_id','rack_unit_start','rack_unit_size','ram_gb'].forEach(k=>{payload[k]=payload[k]?parseInt(payload[k]):null;});
      ['ip_address','mac_address','hostname','subnet_mask','gateway','dns_primary','dns_secondary','serial_number','os_name','os_version','firmware_version','cpu_info','storage_info','purchase_date','warranty_expiry','notes','brand','model'].forEach(k=>{if(!payload[k])payload[k]=null;});
      const r = await api.post("/network/devices/",payload);
      toast.success("Device added"); setAddOpen(false); fetchDevices();
      router.push(`/network/devices/${r.data.id}`);
    } catch(e:any) {
      const d=e.response?.data;
      if(d&&typeof d==='object'){const err=Object.entries(d).map(([k,v])=>`${k}: ${Array.isArray(v)?v.join(", "):v}`).join(" | ");toast.error(err);}
      else toast.error("Failed to add device");
    } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><HardDrive className="h-6 w-6 text-violet-500"/>Network Devices</h1><p className="text-neutral-500">Manage servers, switches, routers, and more.</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}><Download className="mr-2 h-4 w-4"/>Export</Button>
          <Button onClick={()=>setAddOpen(true)} className="bg-violet-600 hover:bg-violet-700"><Plus className="mr-2 h-4 w-4"/>Add Device</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[200px]"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500"/><Input placeholder="Search name, IP, MAC, hostname..." className="pl-9" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <Select value={typeFilter} onValueChange={setTypeFilter}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Type"/></SelectTrigger><SelectContent>
          <SelectItem value="ALL">All Types</SelectItem><SelectItem value="SERVER">Server</SelectItem><SelectItem value="SWITCH">Switch</SelectItem><SelectItem value="ROUTER">Router</SelectItem><SelectItem value="FIREWALL">Firewall</SelectItem><SelectItem value="ACCESS_POINT">Access Point</SelectItem><SelectItem value="NAS">NAS</SelectItem><SelectItem value="UPS">UPS</SelectItem><SelectItem value="VM">VM</SelectItem><SelectItem value="OTHER">Other</SelectItem>
        </SelectContent></Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-[150px]"><SelectValue placeholder="Status"/></SelectTrigger><SelectContent>
          <SelectItem value="ALL">All Status</SelectItem><SelectItem value="ONLINE">Online</SelectItem><SelectItem value="OFFLINE">Offline</SelectItem><SelectItem value="MAINTENANCE">Maintenance</SelectItem><SelectItem value="DECOMMISSIONED">Decommissioned</SelectItem>
        </SelectContent></Select>
      </div>

      {selected.size>0&&(
        <Card className="p-3 flex flex-wrap items-center gap-3 border-violet-200 bg-violet-50/50 dark:bg-violet-900/10">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Select value={bulkStatus} onValueChange={setBulkStatus}><SelectTrigger className="w-[150px] h-8"><SelectValue placeholder="Set status..."/></SelectTrigger><SelectContent>
            <SelectItem value="ONLINE">Online</SelectItem><SelectItem value="OFFLINE">Offline</SelectItem><SelectItem value="MAINTENANCE">Maintenance</SelectItem><SelectItem value="DECOMMISSIONED">Decommissioned</SelectItem>
          </SelectContent></Select>
          <Select value={bulkLocation} onValueChange={setBulkLocation}><SelectTrigger className="w-[170px] h-8"><SelectValue placeholder="Set location..."/></SelectTrigger><SelectContent>
            <SelectItem value="NONE">Unassigned</SelectItem>{locations.map(l=><SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
          </SelectContent></Select>
          <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={applyBulk}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={()=>setSelected(new Set())}><X className="w-4 h-4 mr-1"/>Clear</Button>
        </Card>
      )}

      <Card className="overflow-hidden">
        <Table><TableHeader className="bg-neutral-50 dark:bg-neutral-900/50"><TableRow>
          <TableHead className="w-10"><Checkbox checked={devices.length>0&&selected.size===devices.length} onCheckedChange={toggleAll}/></TableHead>
          <TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>IP Address</TableHead><TableHead>Hostname</TableHead><TableHead>Location</TableHead><TableHead>VLAN</TableHead><TableHead>Status</TableHead><TableHead>Last Seen</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {loading?<TableRow><TableCell colSpan={10} className="text-center py-10 text-neutral-500">Loading...</TableCell></TableRow>:
          devices.length===0?<TableRow><TableCell colSpan={10} className="text-center py-10 text-neutral-500">No devices found.</TableCell></TableRow>:
          devices.map(d=>(
            <TableRow key={d.id} className="cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50" onClick={()=>router.push(`/network/devices/${d.id}`)}>
              <TableCell onClick={e=>e.stopPropagation()}><Checkbox checked={selected.has(d.id)} onCheckedChange={()=>toggle(d.id)}/></TableCell>
              <TableCell className="font-mono text-xs">{d.device_code}</TableCell>
              <TableCell className="font-medium text-violet-600">{d.device_name}</TableCell>
              <TableCell><Badge variant="outline" className="text-xs">{d.device_type.replace('_',' ')}</Badge></TableCell>
              <TableCell className="font-mono text-sm">{d.ip_address||"—"}</TableCell>
              <TableCell className="text-sm">{d.hostname||"—"}</TableCell>
              <TableCell className="text-sm">{d.location_name||"—"}</TableCell>
              <TableCell className="text-sm">{d.vlan_id||"—"}</TableCell>
              <TableCell><Badge className={`border-0 text-xs ${SC[d.status]||""}`}>{d.status}</Badge></TableCell>
              <TableCell className="text-xs text-neutral-500">{d.last_seen_online?new Date(d.last_seen_online).toLocaleString():"Never"}</TableCell>
            </TableRow>
          ))}
        </TableBody></Table>
      </Card>

      {/* Add Device Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}><DialogContent className="sm:max-w-[650px] max-h-[90vh] flex flex-col"><DialogHeader><DialogTitle>Add Network Device</DialogTitle></DialogHeader>
        <Tabs defaultValue="identity" className="w-full flex-col">
          <TabsList className="grid w-full grid-cols-5 mb-4"><TabsTrigger value="identity">Identity</TabsTrigger><TabsTrigger value="network">Network</TabsTrigger><TabsTrigger value="location">Location</TabsTrigger><TabsTrigger value="system">System</TabsTrigger><TabsTrigger value="lifecycle">Lifecycle</TabsTrigger></TabsList>
          <div className="overflow-y-auto pr-2" style={{maxHeight:'55vh'}}>
            <TabsContent value="identity" className="space-y-3 mt-0">
              <div className="space-y-2"><Label>Device Name *</Label><Input value={form.device_name} onChange={e=>setForm({...form,device_name:e.target.value})} placeholder="e.g. Core Switch 01"/></div>
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Type</Label><Select value={form.device_type} onValueChange={v=>setForm({...form,device_type:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>
                <SelectItem value="SERVER">Server</SelectItem><SelectItem value="SWITCH">Switch</SelectItem><SelectItem value="ROUTER">Router</SelectItem><SelectItem value="FIREWALL">Firewall</SelectItem><SelectItem value="ACCESS_POINT">Access Point</SelectItem><SelectItem value="NAS">NAS</SelectItem><SelectItem value="UPS">UPS</SelectItem><SelectItem value="PATCH_PANEL">Patch Panel</SelectItem><SelectItem value="VM">VM</SelectItem><SelectItem value="OTHER">Other</SelectItem>
              </SelectContent></Select></div><div className="space-y-2"><Label>Brand</Label><Input value={form.brand} onChange={e=>setForm({...form,brand:e.target.value})} placeholder="Cisco"/></div></div>
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Model</Label><Input value={form.model} onChange={e=>setForm({...form,model:e.target.value})}/></div><div className="space-y-2"><Label>Serial Number</Label><Input value={form.serial_number} onChange={e=>setForm({...form,serial_number:e.target.value})}/></div></div>
            </TabsContent>
            <TabsContent value="network" className="space-y-3 mt-0">
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>IP Address</Label><Input value={form.ip_address} onChange={e=>setForm({...form,ip_address:e.target.value})} placeholder="192.168.1.1"/></div><div className="space-y-2"><Label>MAC Address</Label><Input value={form.mac_address} onChange={e=>setForm({...form,mac_address:e.target.value})} placeholder="AA:BB:CC:DD:EE:FF"/></div></div>
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Hostname</Label><Input value={form.hostname} onChange={e=>setForm({...form,hostname:e.target.value})}/></div><div className="space-y-2"><Label>VLAN ID</Label><Input type="number" value={form.vlan_id} onChange={e=>setForm({...form,vlan_id:e.target.value})}/></div></div>
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Subnet Mask</Label><Input value={form.subnet_mask} onChange={e=>setForm({...form,subnet_mask:e.target.value})} placeholder="255.255.255.0"/></div><div className="space-y-2"><Label>Gateway</Label><Input value={form.gateway} onChange={e=>setForm({...form,gateway:e.target.value})}/></div></div>
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>DNS Primary</Label><Input value={form.dns_primary} onChange={e=>setForm({...form,dns_primary:e.target.value})}/></div><div className="space-y-2"><Label>DNS Secondary</Label><Input value={form.dns_secondary} onChange={e=>setForm({...form,dns_secondary:e.target.value})}/></div></div>
            </TabsContent>
            <TabsContent value="location" className="space-y-3 mt-0">
              <div className="space-y-2"><Label>Location</Label><Select value={form.location} onValueChange={v=>setForm({...form,location:v})}><SelectTrigger><SelectValue placeholder="Select..."/></SelectTrigger><SelectContent>{locations.map(l=><SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Rack Unit Start</Label><Input type="number" value={form.rack_unit_start} onChange={e=>setForm({...form,rack_unit_start:e.target.value})}/></div><div className="space-y-2"><Label>Rack Unit Size (U)</Label><Input type="number" value={form.rack_unit_size} onChange={e=>setForm({...form,rack_unit_size:e.target.value})}/></div></div>
            </TabsContent>
            <TabsContent value="system" className="space-y-3 mt-0">
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>OS Name</Label><Input value={form.os_name} onChange={e=>setForm({...form,os_name:e.target.value})} placeholder="Ubuntu Server"/></div><div className="space-y-2"><Label>OS Version</Label><Input value={form.os_version} onChange={e=>setForm({...form,os_version:e.target.value})}/></div></div>
              <div className="space-y-2"><Label>Firmware Version</Label><Input value={form.firmware_version} onChange={e=>setForm({...form,firmware_version:e.target.value})}/></div>
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>CPU Info</Label><Input value={form.cpu_info} onChange={e=>setForm({...form,cpu_info:e.target.value})} placeholder="Intel Xeon E5-2680"/></div><div className="space-y-2"><Label>RAM (GB)</Label><Input type="number" value={form.ram_gb} onChange={e=>setForm({...form,ram_gb:e.target.value})}/></div></div>
              <div className="space-y-2"><Label>Storage Info</Label><Textarea value={form.storage_info} onChange={e=>setForm({...form,storage_info:e.target.value})} placeholder="e.g. 4x 1TB SSD RAID 10"/></div>
            </TabsContent>
            <TabsContent value="lifecycle" className="space-y-3 mt-0">
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Status</Label><Select value={form.status} onValueChange={v=>setForm({...form,status:v})}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="ONLINE">Online</SelectItem><SelectItem value="OFFLINE">Offline</SelectItem><SelectItem value="MAINTENANCE">Maintenance</SelectItem><SelectItem value="DECOMMISSIONED">Decommissioned</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Vendor</Label><Select value={form.vendor} onValueChange={v=>setForm({...form,vendor:v})}><SelectTrigger><SelectValue placeholder="Select..."/></SelectTrigger><SelectContent>{vendors.map(v=><SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent></Select></div></div>
              <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Purchase Date</Label><Input type="date" value={form.purchase_date} onChange={e=>setForm({...form,purchase_date:e.target.value})}/></div><div className="space-y-2"><Label>Warranty Expiry</Label><Input type="date" value={form.warranty_expiry} onChange={e=>setForm({...form,warranty_expiry:e.target.value})}/></div></div>
              <div className="space-y-2"><Label>Notes</Label><Textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div>
            </TabsContent>
          </div>
        </Tabs>
        <div className="pt-4 border-t mt-4 flex justify-end gap-2"><Button variant="outline" onClick={()=>setAddOpen(false)}>Cancel</Button><Button className="bg-violet-600 hover:bg-violet-700" onClick={handleSave} disabled={saving}>{saving?"Saving...":"Add Device"}</Button></div>
      </DialogContent></Dialog>
    </div>
  );
}
