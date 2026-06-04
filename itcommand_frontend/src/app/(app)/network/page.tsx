"use client";
import { useEffect, useState } from "react";
import { Network, HardDrive, Wifi, Server, Shield, Radio, AlertTriangle } from "lucide-react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useRouter } from "next/navigation";

const STATUS_DOT: Record<string,string> = { ONLINE:"bg-emerald-500", OFFLINE:"bg-red-500", MAINTENANCE:"bg-yellow-500", DECOMMISSIONED:"bg-neutral-400" };

export default function NetworkDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get("/network/dashboard/").then(r => setData(r.data)).catch(()=>{}).finally(()=>setLoading(false)); }, []);

  if (loading) return <div className="p-8 text-center text-neutral-500">Loading...</div>;
  if (!data) return <div className="p-8 text-center text-red-500">Failed to load dashboard</div>;

  const s = data.device_count_by_status || {};
  const t = data.device_count_by_type || {};

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Network className="h-6 w-6 text-violet-500"/>Network Overview</h1>
        <p className="text-neutral-500">Monitor devices, IP pools, and infrastructure health.</p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="p-4"><div className="text-neutral-500 text-sm mb-1">Total Devices</div><div className="text-3xl font-bold">{data.total_devices}</div></Card>
        <Card className="p-4 border-emerald-200"><div className="text-emerald-600 text-sm mb-1 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"/>Online</div><div className="text-3xl font-bold text-emerald-600">{s.ONLINE||0}</div></Card>
        <Card className="p-4 border-red-200"><div className="text-red-600 text-sm mb-1 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"/>Offline</div><div className="text-3xl font-bold text-red-600">{s.OFFLINE||0}</div></Card>
        <Card className="p-4 border-yellow-200"><div className="text-yellow-600 text-sm mb-1 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500"/>Maintenance</div><div className="text-3xl font-bold text-yellow-600">{s.MAINTENANCE||0}</div></Card>
        <Card className="p-4 border-neutral-200"><div className="text-neutral-500 text-sm mb-1">Decommissioned</div><div className="text-3xl font-bold text-neutral-400">{s.DECOMMISSIONED||0}</div></Card>
      </div>

      {/* Device Type Breakdown */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {Object.entries(t).map(([type, count]) => (
          <Card key={type} className="p-3 text-center cursor-pointer hover:border-violet-300 transition-colors" onClick={()=>router.push(`/network/devices?type=${type}`)}>
            <div className="text-xs text-neutral-500 uppercase">{type.replace('_',' ')}</div>
            <div className="text-xl font-bold mt-1">{count as number}</div>
          </Card>
        ))}
      </div>

      {/* Offline Devices */}
      {data.offline_devices?.length > 0 && (
        <Card className="overflow-hidden border-red-100">
          <div className="p-4 border-b bg-red-50 dark:bg-red-900/10"><h3 className="font-semibold text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4"/>Offline Devices</h3></div>
          <Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Type</TableHead><TableHead>IP</TableHead><TableHead>Last Seen</TableHead></TableRow></TableHeader>
            <TableBody>{data.offline_devices.map((d:any)=>(
              <TableRow key={d.id} className="cursor-pointer hover:bg-red-50/50" onClick={()=>router.push(`/network/devices/${d.id}`)}>
                <TableCell className="font-medium text-red-600">{d.device_name}<span className="text-xs text-neutral-400 ml-2">{d.device_code}</span></TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{d.device_type}</Badge></TableCell>
                <TableCell className="font-mono text-sm">{d.ip_address||"—"}</TableCell>
                <TableCell className="text-sm text-neutral-500">{d.last_seen_online ? new Date(d.last_seen_online).toLocaleString() : "Never"}</TableCell>
              </TableRow>
            ))}</TableBody></Table>
        </Card>
      )}

      {/* IP Pool Summary */}
      {data.ip_pools_summary?.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold text-lg mb-4">IP Address Pools</h3>
          <div className="space-y-3">
            {data.ip_pools_summary.map((p:any) => {
              const pct = p.total > 0 ? Math.round((p.used / p.total) * 100) : 0;
              return (
                <div key={p.id} className="flex items-center gap-4 p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700" onClick={()=>router.push(`/network/ip-manager?pool=${p.id}`)}>
                  <div className="flex-1"><div className="font-medium">{p.name}</div><div className="text-xs text-neutral-500 font-mono">{p.network}</div></div>
                  <div className="text-sm text-neutral-500">{p.used}/{p.total} used</div>
                  <div className="w-32 bg-neutral-200 dark:bg-neutral-700 rounded-full h-2.5">
                    <div className={`h-2.5 rounded-full ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-emerald-500'}`} style={{width:`${pct}%`}}/>
                  </div>
                  <div className="text-sm font-medium w-10 text-right">{pct}%</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
