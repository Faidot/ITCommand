"use client";
import { useEffect, useState } from "react";
import { Network, AlertTriangle, Activity, MapPin, Layers, Server, Gauge } from "lucide-react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "next/navigation";

const DOT: Record<string, string> = { ONLINE: "bg-emerald-500", OFFLINE: "bg-red-500", MAINTENANCE: "bg-yellow-500", DECOMMISSIONED: "bg-neutral-400" };

export default function NetworkDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [warrantyDays, setWarrantyDays] = useState("30");

  const load = (days: string) => {
    setLoading(true);
    api.get(`/network/dashboard/?warranty_days=${days}`).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(warrantyDays); }, [warrantyDays]);

  if (loading && !data) return <div className="p-8 text-center text-neutral-500">Loading...</div>;
  if (!data) return <div className="p-8 text-center text-red-500">Failed to load dashboard</div>;

  const s = data.device_count_by_status || {};
  const t = data.device_count_by_type || {};

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Network className="h-6 w-6 text-violet-500" />Network Overview</h1>
          <p className="text-neutral-500">Monitor devices, IP pools, and infrastructure health.</p>
        </div>
        {data.avg_uptime != null && (
          <Card className="px-4 py-2 flex items-center gap-2"><Gauge className="w-4 h-4 text-violet-500" /><div><div className="text-xs text-neutral-500">Avg Uptime</div><div className="font-bold">{data.avg_uptime}%</div></div></Card>
        )}
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="p-4"><div className="text-neutral-500 text-sm mb-1">Total Devices</div><div className="text-3xl font-bold">{data.total_devices}</div></Card>
        <Card className="p-4 border-emerald-200"><div className="text-emerald-600 text-sm mb-1 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Online</div><div className="text-3xl font-bold text-emerald-600">{s.ONLINE || 0}</div></Card>
        <Card className="p-4 border-red-200"><div className="text-red-600 text-sm mb-1 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Offline</div><div className="text-3xl font-bold text-red-600">{s.OFFLINE || 0}</div></Card>
        <Card className="p-4 border-yellow-200"><div className="text-yellow-600 text-sm mb-1 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" />Maintenance</div><div className="text-3xl font-bold text-yellow-600">{s.MAINTENANCE || 0}</div></Card>
        <Card className="p-4 border-neutral-200"><div className="text-neutral-500 text-sm mb-1">Decommissioned</div><div className="text-3xl font-bold text-neutral-400">{s.DECOMMISSIONED || 0}</div></Card>
      </div>

      {/* Device Type Breakdown */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {Object.entries(t).map(([type, count]) => (
          <Card key={type} className="p-3 text-center cursor-pointer hover:border-violet-300 transition-colors" onClick={() => router.push(`/network/devices?type=${type}`)}>
            <div className="text-xs text-neutral-500 uppercase">{type.replace('_', ' ')}</div>
            <div className="text-xl font-bold mt-1">{count as number}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Devices by Location */}
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-violet-500" />Devices by Location</h3>
          {data.devices_by_location?.length ? (
            <div className="space-y-2">
              {data.devices_by_location.map((l: any, i: number) => {
                const max = Math.max(...data.devices_by_location.map((x: any) => x.count));
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-sm w-32 truncate">{l.name}</span>
                    <div className="flex-1 bg-neutral-100 dark:bg-neutral-800 rounded-full h-2.5"><div className="h-2.5 rounded-full bg-violet-500" style={{ width: `${(l.count / max) * 100}%` }} /></div>
                    <span className="text-sm font-medium w-8 text-right">{l.count}</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-neutral-500 text-sm">No location data.</p>}
        </Card>

        {/* Rack Utilization */}
        <Card className="p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Server className="w-4 h-4 text-violet-500" />Rack Utilization</h3>
          {data.rack_utilization?.length ? (
            <div className="space-y-3">
              {data.rack_utilization.map((r: any) => (
                <div key={r.id} className="flex items-center gap-3 cursor-pointer" onClick={() => router.push('/network/rack-view')}>
                  <span className="text-sm w-32 truncate">{r.name}</span>
                  <div className="flex-1 bg-neutral-100 dark:bg-neutral-800 rounded-full h-2.5"><div className={`h-2.5 rounded-full ${r.pct > 80 ? 'bg-red-500' : r.pct > 50 ? 'bg-yellow-500' : 'bg-emerald-500'}`} style={{ width: `${r.pct}%` }} /></div>
                  <span className="text-xs text-neutral-500 w-16 text-right">{r.used_u}/{r.total_u}U</span>
                </div>
              ))}
            </div>
          ) : <p className="text-neutral-500 text-sm">No rack locations.</p>}
        </Card>
      </div>

      {/* Offline Devices */}
      {data.offline_devices?.length > 0 && (
        <Card className="overflow-hidden border-red-100">
          <div className="p-4 border-b bg-red-50 dark:bg-red-900/10"><h3 className="font-semibold text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Offline Devices</h3></div>
          <Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Type</TableHead><TableHead>IP</TableHead><TableHead>Offline For</TableHead><TableHead>Last Seen</TableHead></TableRow></TableHeader>
            <TableBody>{data.offline_devices.map((d: any) => (
              <TableRow key={d.id} className="cursor-pointer hover:bg-red-50/50" onClick={() => router.push(`/network/devices/${d.id}`)}>
                <TableCell className="font-medium text-red-600">{d.device_name}<span className="text-xs text-neutral-400 ml-2">{d.device_code}</span></TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{d.device_type}</Badge></TableCell>
                <TableCell className="font-mono text-sm">{d.ip_address || "—"}</TableCell>
                <TableCell className="text-sm">{d.offline_for_days != null ? <Badge variant={d.offline_for_days > 7 ? "destructive" : "secondary"}>{d.offline_for_days}d</Badge> : "—"}</TableCell>
                <TableCell className="text-sm text-neutral-500">{d.last_seen_online ? new Date(d.last_seen_online).toLocaleString() : "Never"}</TableCell>
              </TableRow>
            ))}</TableBody></Table>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Warranty timeline with window selector */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Warranty Expiring</h3>
            <Select value={warrantyDays} onValueChange={setWarrantyDays}><SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="30">30 days</SelectItem><SelectItem value="60">60 days</SelectItem><SelectItem value="90">90 days</SelectItem><SelectItem value="180">6 months</SelectItem>
            </SelectContent></Select>
          </div>
          {data.devices_with_expiring_warranty?.length ? (
            <Table><TableHeader><TableRow><TableHead>Device</TableHead><TableHead>Expiry</TableHead><TableHead className="text-right">Days</TableHead></TableRow></TableHeader>
              <TableBody>{data.devices_with_expiring_warranty.map((w: any) => (
                <TableRow key={w.id} className="cursor-pointer hover:bg-neutral-50" onClick={() => router.push(`/network/devices/${w.id}`)}>
                  <TableCell className="font-medium">{w.device_name}</TableCell>
                  <TableCell className="text-sm">{w.warranty_expiry}</TableCell>
                  <TableCell className="text-right"><Badge variant={w.days_remaining <= 14 ? "destructive" : "secondary"}>{w.days_remaining}d</Badge></TableCell>
                </TableRow>
              ))}</TableBody></Table>
          ) : <p className="text-neutral-500 text-sm">No devices expiring in this window.</p>}
        </Card>

        {/* VLAN breakdown + recent activity */}
        <div className="space-y-6">
          <Card className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Layers className="w-4 h-4 text-violet-500" />VLAN Breakdown</h3>
            {data.vlan_breakdown?.length ? (
              <div className="flex flex-wrap gap-2">
                {data.vlan_breakdown.map((v: any) => (
                  <span key={v.vlan} className="px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-800 text-sm">VLAN {v.vlan} <span className="text-neutral-500">· {v.count}</span></span>
                ))}
              </div>
            ) : <p className="text-neutral-500 text-sm">No VLANs assigned.</p>}
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-violet-500" />Recent Status Activity</h3>
            {data.recent_activity?.length ? (
              <div className="space-y-2">
                {data.recent_activity.slice(0, 8).map((a: any) => (
                  <div key={a.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded px-1 py-0.5" onClick={() => router.push(`/network/devices/${a.device_id}`)}>
                    <span className={`w-2 h-2 rounded-full ${DOT[a.new_status] || "bg-neutral-400"}`} />
                    <span className="font-medium">{a.device_name}</span>
                    <span className="text-neutral-500">{a.old_status ? `${a.old_status} → ` : ""}{a.new_status}</span>
                    <span className="text-xs text-neutral-400 ml-auto">{new Date(a.created_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-neutral-500 text-sm">No recent activity.</p>}
          </Card>
        </div>
      </div>

      {/* IP Pool Summary */}
      {data.ip_pools_summary?.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold text-lg mb-4">IP Address Pools</h3>
          <div className="space-y-3">
            {data.ip_pools_summary.map((p: any) => {
              const pct = p.total > 0 ? Math.round((p.used / p.total) * 100) : 0;
              return (
                <div key={p.id} className="flex items-center gap-4 p-3 bg-neutral-50 dark:bg-neutral-800 rounded-lg cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700" onClick={() => router.push(`/network/ip-manager?pool=${p.id}`)}>
                  <div className="flex-1"><div className="font-medium">{p.name}</div><div className="text-xs text-neutral-500 font-mono">{p.network}</div></div>
                  <div className="text-sm text-neutral-500">{p.used}/{p.total} used</div>
                  <div className="w-32 bg-neutral-200 dark:bg-neutral-700 rounded-full h-2.5">
                    <div className={`h-2.5 rounded-full ${pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
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
