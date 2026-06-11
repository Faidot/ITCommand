"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Share2, Server, Network as NetIcon } from "lucide-react";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUS_FILL: Record<string, string> = {
  ONLINE: "#10b981", OFFLINE: "#ef4444", MAINTENANCE: "#eab308", DECOMMISSIONED: "#a3a3a3",
};
// Lower tier = closer to the top (edge of the network).
const TIER: Record<string, number> = {
  ROUTER: 0, FIREWALL: 0, CABLE_MODEM: 0,
  SWITCH: 1, ACCESS_POINT: 1, PATCH_PANEL: 1,
  SERVER: 2, NAS: 2, VM: 2, UPS: 2, OTHER: 2,
};

const NODE_W = 150, NODE_H = 54, X_GAP = 30, Y_GAP = 90, PAD = 40;

export default function TopologyPage() {
  const router = useRouter();
  const [data, setData] = useState<any>({ nodes: [], edges: [] });
  const [locations, setLocations] = useState<any[]>([]);
  const [loc, setLoc] = useState("ALL");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/network/locations/").then(r => setLocations(r.data.results || r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const q = loc !== "ALL" ? `?location=${loc}` : "";
    api.get(`/network/topology/${q}`).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [loc]);

  const layout = useMemo(() => {
    const tiers: Record<number, any[]> = {};
    data.nodes.forEach((n: any) => {
      const t = TIER[n.type] ?? 2;
      (tiers[t] ||= []).push(n);
    });
    const pos: Record<number, { x: number; y: number; node: any }> = {};
    let maxRowW = 0;
    Object.keys(tiers).map(Number).sort((a, b) => a - b).forEach((t) => {
      const row = tiers[t];
      const rowW = row.length * NODE_W + (row.length - 1) * X_GAP;
      maxRowW = Math.max(maxRowW, rowW);
      row.forEach((n, i) => {
        pos[n.id] = { x: PAD + i * (NODE_W + X_GAP), y: PAD + t * (NODE_H + Y_GAP), node: n };
      });
    });
    // Center each tier row against the widest row.
    Object.keys(tiers).map(Number).forEach((t) => {
      const row = tiers[t];
      const rowW = row.length * NODE_W + (row.length - 1) * X_GAP;
      const offset = (maxRowW - rowW) / 2;
      row.forEach((n) => { pos[n.id].x += offset; });
    });
    const tierCount = Object.keys(tiers).length;
    return {
      pos,
      width: maxRowW + PAD * 2,
      height: tierCount * NODE_H + (tierCount - 1) * Y_GAP + PAD * 2,
    };
  }, [data]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto p-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Share2 className="h-6 w-6 text-violet-500" />Network Topology</h1>
          <p className="text-neutral-500">How devices interconnect, drawn from port links.</p>
        </div>
        <Select value={loc} onValueChange={setLoc}>
          <SelectTrigger className="w-[240px]"><SelectValue placeholder="All locations" /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">All locations</SelectItem>{locations.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(STATUS_FILL).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1"><span className="w-3 h-3 rounded-full" style={{ background: c }} />{s}</span>
        ))}
      </div>

      <Card className="p-4 overflow-auto">
        {loading ? <div className="text-center py-16 text-neutral-500">Loading topology…</div> :
          data.nodes.length === 0 ? <div className="text-center py-16 text-neutral-500">No devices to display.</div> :
            <svg width={Math.max(layout.width, 320)} height={Math.max(layout.height, 200)} className="min-w-full">
              {/* edges */}
              {data.edges.map((e: any, i: number) => {
                const a = layout.pos[e.source], b = layout.pos[e.target];
                if (!a || !b) return null;
                return (
                  <line key={i}
                    x1={a.x + NODE_W / 2} y1={a.y + NODE_H / 2}
                    x2={b.x + NODE_W / 2} y2={b.y + NODE_H / 2}
                    stroke={e.is_uplink ? "#6366f1" : "#cbd5e1"}
                    strokeWidth={e.is_uplink ? 2.5 : 1.5}
                    strokeDasharray={e.is_uplink ? "" : "4 3"} />
                );
              })}
              {/* nodes */}
              {Object.values(layout.pos).map(({ x, y, node }) => (
                <g key={node.id} transform={`translate(${x},${y})`} className="cursor-pointer"
                  onClick={() => router.push(`/network/devices/${node.id}`)}>
                  <rect width={NODE_W} height={NODE_H} rx={8}
                    fill="white" stroke="#e5e7eb" strokeWidth={1.5}
                    className="dark:fill-neutral-800 hover:stroke-violet-400" />
                  <circle cx={14} cy={NODE_H / 2} r={5} fill={STATUS_FILL[node.status] || "#a3a3a3"} />
                  <text x={28} y={22} fontSize={12} fontWeight={600} fill="currentColor" className="text-neutral-800 dark:text-neutral-100">
                    {node.name.length > 16 ? node.name.slice(0, 15) + "…" : node.name}
                  </text>
                  <text x={28} y={38} fontSize={10} fill="#94a3b8">
                    {node.type.replace("_", " ")}{node.ip ? ` · ${node.ip}` : ""}
                  </text>
                </g>
              ))}
            </svg>}
      </Card>

      <div className="flex gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1"><NetIcon className="w-3.5 h-3.5" /> {data.nodes.length} devices</span>
        <span className="flex items-center gap-1"><Server className="w-3.5 h-3.5" /> {data.edges.length} links</span>
        <span><span className="inline-block w-4 border-t-2 border-indigo-500 align-middle mr-1" /> uplink</span>
      </div>
    </div>
  );
}
