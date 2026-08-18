"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function IPManagerPage() {
  const sp = useSearchParams(); const router = useRouter();
  const [pools, setPools] = useState<any[]>([]);
  const [selectedPool, setSelectedPool] = useState(sp.get("pool") || "");
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedIp, setSelectedIp] = useState<any>(null);

  useEffect(() => {
    api.get("/network/ip-pools/").then(r => {
      const d = r.data.results || r.data;
      setPools(d);
      if (!selectedPool && d.length > 0) setSelectedPool(String(d[0].id));
    }).catch(() => toast.error("Could not load IP pools."));
  }, []);

  useEffect(() => { if (selectedPool) fetchUsage(); }, [selectedPool]);

  const fetchUsage = async () => {
    setLoading(true);
    try { const r = await api.get(`/network/ip-pools/${selectedPool}/usage/`); setUsage(r.data); }
    catch { toast.error("Failed to load IP usage"); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Globe className="h-6 w-6 text-violet-500" />IP Address Manager</h1>
        <p className="text-neutral-500">Visual IP allocation and management.</p>
      </div>

      <Select value={selectedPool} onValueChange={setSelectedPool}>
        <SelectTrigger className="w-[300px]"><SelectValue placeholder="Select IP Pool..." /></SelectTrigger>
        <SelectContent>{pools.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name} ({p.network_address}/{p.cidr_prefix})</SelectItem>)}</SelectContent>
      </Select>

      {usage && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 text-center"><div className="text-sm text-neutral-500">Total IPs</div><div className="text-2xl font-bold">{usage.total}</div></Card>
            <Card className="p-4 text-center border-blue-200"><div className="text-sm text-blue-600">Used</div><div className="text-2xl font-bold text-blue-600">{usage.used}</div></Card>
            <Card className="p-4 text-center border-emerald-200"><div className="text-sm text-emerald-600">Free</div><div className="text-2xl font-bold text-emerald-600">{usage.free}</div></Card>
            <Card className="p-4 text-center"><div className="text-sm text-neutral-500">Utilization</div><div className="text-2xl font-bold">{usage.total > 0 ? Math.round((usage.used / usage.total) * 100) : 0}%</div></Card>
          </div>

          <Card className="p-4">
            <div className="flex items-center gap-4 mb-4 text-xs">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-200 border border-emerald-300" /> Free</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-blue-200 border border-blue-300" /> Used</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-neutral-300 border border-neutral-400" /> Reserved</span>
            </div>
            {loading ? <div className="text-center py-10 text-neutral-500">Loading...</div> :
              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}>
                {usage.ips?.map((ip: any) => {
                  const bg = ip.status === 'free' ? 'bg-emerald-100 hover:bg-emerald-200 border-emerald-200 cursor-pointer' :
                    ip.status === 'used' ? 'bg-blue-100 hover:bg-blue-200 border-blue-200 cursor-pointer' :
                      'bg-neutral-200 border-neutral-300';
                  return (
                    <div key={ip.ip} className={`border rounded-md p-1 text-center text-xs font-mono transition-colors ${bg}`}
                      onClick={() => { setSelectedIp(ip); setDetailOpen(true); }}
                      title={ip.status === 'used' ? ip.device?.device_name : ip.status === 'reserved' ? ip.label : 'Free'}>
                      {ip.ip.split('.').pop()}
                    </div>
                  );
                })}
              </div>
            }
          </Card>
        </>
      )}

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>IP: {selectedIp?.ip}</DialogTitle></DialogHeader>
          {selectedIp && (
            <div className="space-y-3 py-2">
              <Badge className={`border-0 text-xs ${selectedIp.status === 'free' ? 'bg-emerald-100 text-emerald-800' : selectedIp.status === 'used' ? 'bg-blue-100 text-blue-800' : 'bg-neutral-200 text-neutral-600'}`}>{selectedIp.status.toUpperCase()}</Badge>
              {selectedIp.status === 'used' && selectedIp.device && (
                <div className="space-y-1 text-sm">
                  <div><span className="text-neutral-500">Device:</span> <strong>{selectedIp.device.device_name}</strong></div>
                  <div><span className="text-neutral-500">Code:</span> {selectedIp.device.device_code}</div>
                  <button className="text-violet-600 hover:underline mt-2" onClick={() => { setDetailOpen(false); router.push(`/network/devices/${selectedIp.device.id}`); }}>View Device →</button>
                </div>
              )}
              {selectedIp.status === 'reserved' && <div className="text-sm">{selectedIp.label}</div>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
