"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save, Plus, Send, Activity, Wifi, WifiOff, Wrench } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const SC:Record<string,string> = {ONLINE:"bg-emerald-100 text-emerald-800",OFFLINE:"bg-red-100 text-red-800",MAINTENANCE:"bg-yellow-100 text-yellow-800",DECOMMISSIONED:"bg-neutral-200 text-neutral-500"};
const DOT:Record<string,string> = {ONLINE:"bg-emerald-500",OFFLINE:"bg-red-500",MAINTENANCE:"bg-yellow-500",DECOMMISSIONED:"bg-neutral-400"};

export default function DeviceDetailPage(){
  const params=useParams(); const router=useRouter();
  const devId=params.id as string;
  const [dev,setDev]=useState<any>(null);
  const [loading,setLoading]=useState(true);
  const [ports,setPorts]=useState<any[]>([]);
  const [editingPorts,setEditingPorts]=useState(false);
  const [noteText,setNoteText]=useState("");
  const [devices,setDevices]=useState<any[]>([]);

  useEffect(()=>{fetchDevice();api.get("/network/devices/").then(r=>setDevices(r.data.results||r.data)).catch(()=>{});},[devId]);

  const fetchDevice=async()=>{
    try{const r=await api.get(`/network/devices/${devId}/`);setDev(r.data);setPorts(r.data.ports||[]);}
    catch{toast.error("Failed to load device");}
    finally{setLoading(false);}
  };

  const addPort=()=>setPorts(p=>[...p,{port_number:p.length+1,port_name:"",port_type:"ETHERNET",connected_to_device:null,connected_to_port:null,speed_mbps:1000,is_uplink:false,description:""}]);

  const savePorts=async()=>{
    try{await api.put(`/network/devices/${devId}/ports/`,{ports});toast.success("Ports saved");setEditingPorts(false);fetchDevice();}
    catch{toast.error("Failed to save ports");}
  };

  const addNote=async()=>{
    if(!noteText.trim())return;
    try{await api.post(`/network/devices/${devId}/notes/`,{note:noteText});toast.success("Note added");setNoteText("");fetchDevice();}
    catch{toast.error("Failed to add note");}
  };

  const setStatus=async(newStatus:string)=>{
    if(dev?.status===newStatus)return;
    try{await api.post(`/network/devices/${devId}/set-status/`,{status:newStatus});toast.success(`Marked ${newStatus.toLowerCase()}`);fetchDevice();}
    catch{toast.error("Failed to update status");}
  };

  const STATUS_ACTIONS=[
    {key:"ONLINE",label:"Online",icon:Wifi,cls:"text-emerald-600 hover:bg-emerald-50 border-emerald-200"},
    {key:"OFFLINE",label:"Offline",icon:WifiOff,cls:"text-red-600 hover:bg-red-50 border-red-200"},
    {key:"MAINTENANCE",label:"Maintenance",icon:Wrench,cls:"text-yellow-600 hover:bg-yellow-50 border-yellow-200"},
  ];

  if(loading)return <div className="p-8 text-center text-neutral-500">Loading...</div>;
  if(!dev)return <div className="p-8 text-center text-red-500">Device not found</div>;

  return(
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" onClick={()=>router.push('/network/devices')}><ArrowLeft className="h-5 w-5"/></Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`w-3 h-3 rounded-full ${DOT[dev.status]}`}/>
            <h1 className="text-2xl font-bold">{dev.device_name}</h1>
            <Badge variant="outline" className="font-mono text-xs">{dev.device_code}</Badge>
            <Badge variant="outline" className="text-xs">{dev.device_type.replace('_',' ')}</Badge>
            <Badge className={`border-0 ${SC[dev.status]}`}>{dev.status}</Badge>
          </div>
          {dev.brand&&<p className="text-sm text-neutral-500 mt-1">{dev.brand} {dev.model}</p>}
        </div>
        <div className="flex gap-2">
          {STATUS_ACTIONS.map(a=>(
            <Button key={a.key} size="sm" variant="outline" disabled={dev.status===a.key} className={dev.status===a.key?"opacity-40":a.cls} onClick={()=>setStatus(a.key)}>
              <a.icon className="w-3.5 h-3.5 mr-1"/>{a.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-3"><div className="text-xs text-neutral-500">IP Address</div><div className="font-mono font-medium mt-1">{dev.ip_address||"—"}</div></Card>
        <Card className="p-3"><div className="text-xs text-neutral-500">MAC Address</div><div className="font-mono font-medium mt-1 text-sm">{dev.mac_address||"—"}</div></Card>
        <Card className="p-3"><div className="text-xs text-neutral-500">Hostname</div><div className="font-medium mt-1">{dev.hostname||"—"}</div></Card>
        <Card className="p-3"><div className="text-xs text-neutral-500">VLAN</div><div className="font-medium mt-1">{dev.vlan_id||"—"}</div></Card>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-3"><div className="text-xs text-neutral-500">Location</div><div className="font-medium mt-1">{dev.location_name||"—"}</div></Card>
        <Card className="p-3"><div className="text-xs text-neutral-500">Vendor</div><div className="font-medium mt-1">{dev.vendor_name||"—"}</div></Card>
        <Card className="p-3"><div className="text-xs text-neutral-500">Last Seen Online</div><div className="font-medium mt-1 text-sm">{dev.last_seen_online?new Date(dev.last_seen_online).toLocaleString():"Never"}</div></Card>
        <Card className="p-3"><div className="text-xs text-neutral-500">Uptime</div><div className="font-medium mt-1">{dev.uptime_percent?`${dev.uptime_percent}%`:"—"}</div></Card>
      </div>

      {/* System & Lifecycle Info */}
      {(dev.os_name||dev.cpu_info)&&<Card className="p-4"><h3 className="font-semibold mb-2">System Info</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        {dev.os_name&&<div><span className="text-neutral-500">OS:</span> {dev.os_name} {dev.os_version}</div>}
        {dev.firmware_version&&<div><span className="text-neutral-500">Firmware:</span> {dev.firmware_version}</div>}
        {dev.cpu_info&&<div><span className="text-neutral-500">CPU:</span> {dev.cpu_info}</div>}
        {dev.ram_gb&&<div><span className="text-neutral-500">RAM:</span> {dev.ram_gb} GB</div>}
        {dev.storage_info&&<div className="col-span-2"><span className="text-neutral-500">Storage:</span> {dev.storage_info}</div>}
      </div></Card>}

      <Card className="p-4"><h3 className="font-semibold mb-2">Lifecycle</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div><span className="text-neutral-500">Purchase:</span> {dev.purchase_date||"—"}</div>
        <div><span className="text-neutral-500">Warranty:</span> {dev.warranty_expiry||"—"}</div>
        <div><span className="text-neutral-500">Rack:</span> {dev.rack_unit_start?`U${dev.rack_unit_start}-U${dev.rack_unit_start+(dev.rack_unit_size||1)-1}`:"—"}</div>
        <div><span className="text-neutral-500">Serial:</span> {dev.serial_number||"—"}</div>
      </div></Card>

      <Tabs defaultValue="ports" className="w-full">
        <TabsList className="grid w-full grid-cols-3"><TabsTrigger value="ports">Port Map</TabsTrigger><TabsTrigger value="health">Health Timeline</TabsTrigger><TabsTrigger value="notes">Notes</TabsTrigger></TabsList>

        <TabsContent value="ports">
          <Card className="p-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">Ports ({ports.length})</h3>
              <div className="flex gap-2">
                {editingPorts&&<Button size="sm" variant="outline" onClick={addPort}><Plus className="w-3 h-3 mr-1"/>Add Port</Button>}
                {editingPorts?<Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={savePorts}><Save className="w-3 h-3 mr-1"/>Save</Button>:
                <Button size="sm" variant="outline" onClick={()=>setEditingPorts(true)}>Edit Port Map</Button>}
              </div>
            </div>
            {ports.length===0?<p className="text-neutral-500 text-sm">No ports configured.</p>:
            <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Speed</TableHead><TableHead>Connected To</TableHead><TableHead>Uplink</TableHead></TableRow></TableHeader>
              <TableBody>{ports.map((p,i)=>(
                <TableRow key={i}>
                  <TableCell>{editingPorts?<Input className="h-7 w-14" type="number" value={p.port_number} onChange={e=>{const v=[...ports];v[i].port_number=parseInt(e.target.value)||0;setPorts(v);}}/>:p.port_number}</TableCell>
                  <TableCell>{editingPorts?<Input className="h-7 w-24" value={p.port_name||""} onChange={e=>{const v=[...ports];v[i].port_name=e.target.value;setPorts(v);}}/>:p.port_name||"—"}</TableCell>
                  <TableCell>{editingPorts?<Select value={p.port_type} onValueChange={val=>{const v=[...ports];v[i].port_type=val;setPorts(v);}}><SelectTrigger className="h-7 w-24"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="ETHERNET">Ethernet</SelectItem><SelectItem value="FIBER">Fiber</SelectItem><SelectItem value="USB">USB</SelectItem><SelectItem value="CONSOLE">Console</SelectItem><SelectItem value="MGMT">Mgmt</SelectItem></SelectContent></Select>:<Badge variant="outline" className="text-xs">{p.port_type}</Badge>}</TableCell>
                  <TableCell>{editingPorts?<Input className="h-7 w-20" type="number" value={p.speed_mbps||""} onChange={e=>{const v=[...ports];v[i].speed_mbps=parseInt(e.target.value)||null;setPorts(v);}}/>:p.speed_mbps?`${p.speed_mbps} Mbps`:"—"}</TableCell>
                  <TableCell>{editingPorts?<Select value={p.connected_to_device?String(p.connected_to_device):""} onValueChange={val=>{const v=[...ports];v[i].connected_to_device=val?parseInt(val):null;setPorts(v);}}><SelectTrigger className="h-7 w-40"><SelectValue placeholder="None"/></SelectTrigger><SelectContent>{devices.filter(d=>d.id!==parseInt(devId)).map(d=><SelectItem key={d.id} value={String(d.id)}>{d.device_name}</SelectItem>)}</SelectContent></Select>:p.connected_to_device_name||"—"}</TableCell>
                  <TableCell>{editingPorts?<Checkbox checked={p.is_uplink} onCheckedChange={c=>{const v=[...ports];v[i].is_uplink=!!c;setPorts(v);}}/>:p.is_uplink?<Badge className="bg-blue-100 text-blue-700 border-0 text-xs">Uplink</Badge>:""}</TableCell>
                </TableRow>
              ))}</TableBody></Table>}
          </Card>
        </TabsContent>

        <TabsContent value="health">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2"><Activity className="w-4 h-4 text-violet-500"/>Status Timeline</h3>
              {dev.uptime_percent!=null&&<Badge variant="outline" className="text-xs">Uptime {dev.uptime_percent}%</Badge>}
            </div>
            {(!dev.recent_status_logs||dev.recent_status_logs.length===0)?<p className="text-neutral-500 text-sm">No status changes recorded yet.</p>:
            <div className="relative pl-5 space-y-4 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-neutral-200 dark:before:bg-neutral-700">
              {dev.recent_status_logs.map((l:any)=>(
                <div key={l.id} className="relative">
                  <span className={`absolute -left-[18px] top-1 w-3 h-3 rounded-full ring-2 ring-white dark:ring-neutral-900 ${DOT[l.new_status]||"bg-neutral-400"}`}/>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {l.old_status&&<><Badge className={`border-0 text-[10px] ${SC[l.old_status]||""}`}>{l.old_status}</Badge><span className="text-neutral-400">→</span></>}
                    <Badge className={`border-0 text-[10px] ${SC[l.new_status]||""}`}>{l.new_status}</Badge>
                    <span className="text-xs text-neutral-500">{new Date(l.created_at).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">{l.note||""}{l.changed_by_name?` · by ${l.changed_by_name}`:""}</div>
                </div>
              ))}
            </div>}
          </Card>
        </TabsContent>

        <TabsContent value="notes">
          <Card className="p-4">
            <div className="flex gap-2 mb-4"><Input value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="Add a note..." className="flex-1"/><Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={addNote}><Send className="w-4 h-4"/></Button></div>
            {dev.device_notes?.length===0?<p className="text-neutral-500 text-sm">No notes yet.</p>:
            <div className="space-y-3">{dev.device_notes?.map((n:any)=>(
              <div key={n.id} className="p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg">
                <div className="flex justify-between"><strong className="text-sm">{n.created_by_name||"Unknown"}</strong><span className="text-xs text-neutral-500">{new Date(n.created_at).toLocaleString()}</span></div>
                <p className="text-sm mt-1">{n.note}</p>
              </div>
            ))}</div>}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
