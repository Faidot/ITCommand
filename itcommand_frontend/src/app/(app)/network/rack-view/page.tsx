"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Server } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TC: Record<string, string> = {
  SERVER: "bg-blue-200 border-blue-400 text-blue-800",
  SWITCH: "bg-emerald-200 border-emerald-400 text-emerald-800",
  ROUTER: "bg-purple-200 border-purple-400 text-purple-800",
  FIREWALL: "bg-red-200 border-red-400 text-red-800",
  UPS: "bg-yellow-200 border-yellow-400 text-yellow-800",
  NAS: "bg-cyan-200 border-cyan-400 text-cyan-800",
  PATCH_PANEL: "bg-orange-200 border-orange-400 text-orange-800",
};

export default function RackViewPage() {
  const router = useRouter();
  const [locations, setLocations] = useState<any[]>([]);
  const [selectedLoc, setSelectedLoc] = useState("");
  const [devices, setDevices] = useState<any[]>([]);
  const maxU = 42;

  useEffect(() => {
    api.get("/network/locations/").then(r => {
      const d = r.data.results || r.data;
      setLocations(d);
      const racks = d.filter((l: any) => ['SERVER_ROOM', 'RACK', 'CABINET'].includes(l.location_type));
      if (racks.length > 0) setSelectedLoc(String(racks[0].id));
    }).catch(() => toast.error("Could not load rack locations."));
  }, []);

  useEffect(() => {
    if (selectedLoc) {
      api.get(`/network/devices/?location=${selectedLoc}`).then(r => setDevices(r.data.results || r.data)).catch(() => {});
    }
  }, [selectedLoc]);

  // Build rack map
  const rackMap: Record<number, any> = {};
  devices.forEach(d => {
    if (d.rack_unit_start) {
      for (let u = d.rack_unit_start; u < d.rack_unit_start + (d.rack_unit_size || 1); u++) {
        rackMap[u] = d;
      }
    }
  });

  const rackLocations = locations.filter(l => ['SERVER_ROOM', 'RACK', 'CABINET'].includes(l.location_type));

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto p-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Server className="h-6 w-6 text-violet-500" />Rack View</h1>
        <p className="text-neutral-500">Visual rack unit layout.</p>
      </div>

      <Select value={selectedLoc} onValueChange={setSelectedLoc}>
        <SelectTrigger className="w-[300px]"><SelectValue placeholder="Select location..." /></SelectTrigger>
        <SelectContent>{rackLocations.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent>
      </Select>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(TC).map(([type, cls]) => (
          <span key={type} className="flex items-center gap-1">
            <span className={`w-3 h-3 rounded-sm border ${cls}`} />
            {type.replace('_', ' ')}
          </span>
        ))}
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-neutral-100 border border-neutral-300" /> Empty</span>
      </div>

      <Card className="p-4 overflow-x-auto">
        <div className="min-w-[400px]">
          {Array.from({ length: maxU }, (_, i) => i + 1).map(u => {
            const device = rackMap[u];
            const isStart = device && device.rack_unit_start === u;
            const isOccupied = !!device;

            if (isOccupied && !isStart) return null; // Skip continuation rows

            const span = device ? (device.rack_unit_size || 1) : 1;

            return (
              <div key={u} className="flex items-stretch border-b border-neutral-200 dark:border-neutral-700"
                style={{ minHeight: `${span * 32}px` }}>
                <div className="w-12 flex items-center justify-center text-xs text-neutral-400 font-mono border-r border-neutral-200 dark:border-neutral-700 shrink-0">
                  U{u}
                </div>
                {isOccupied ? (
                  <div
                    className={`flex-1 flex items-center px-3 gap-3 cursor-pointer border-l-4 transition-colors ${TC[device.device_type] || 'bg-neutral-200 border-neutral-400 text-neutral-700'}`}
                    onClick={() => router.push(`/network/devices/${device.id}`)}
                    title={`${device.device_name} (${device.device_code})`}
                  >
                    <span className="font-medium text-sm">{device.device_name}</span>
                    <Badge variant="outline" className="text-[10px]">{device.device_type.replace('_', ' ')}</Badge>
                    {device.ip_address && <span className="text-xs font-mono opacity-70">{device.ip_address}</span>}
                    <span className="text-xs opacity-50 ml-auto">{span}U</span>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center px-3 text-xs text-neutral-400 bg-neutral-50 dark:bg-neutral-900/30">
                    Empty
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
