"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Share2, Server, Network as NetIcon, Link2, X } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  // Visual connect mode
  const [connectMode, setConnectMode] = useState(false);
  const [asUplink, setAsUplink] = useState(false);
  const [source, setSource] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Interface picker dialog
  const [pickOpen, setPickOpen] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<number | null>(null);
  const [srcPorts, setSrcPorts] = useState<any[]>([]);
  const [tgtPorts, setTgtPorts] = useState<any[]>([]);
  const [srcPort, setSrcPort] = useState("AUTO");
  const [tgtPort, setTgtPort] = useState("AUTO");
  const nameOf = (id: number | null) => (id == null ? "" : layout.pos[id]?.node?.name || "device");

  useEffect(() => {
    api.get("/network/locations/").then(r => setLocations(r.data.results || r.data)).catch(() => {});
  }, []);

  const fetchTopology = () => {
    setLoading(true);
    const q = loc !== "ALL" ? `?location=${loc}` : "";
    api.get(`/network/topology/${q}`).then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(fetchTopology, [loc]);

  const openPicker = async (target: number) => {
    if (source === null || source === target) return;
    setPendingTarget(target);
    setSrcPort("AUTO"); setTgtPort("AUTO");
    setSrcPorts([]); setTgtPorts([]);
    setPickOpen(true);
    try {
      const [a, b] = await Promise.all([
        api.get(`/network/devices/${source}/ports/`),
        api.get(`/network/devices/${target}/ports/`),
      ]);
      setSrcPorts(a.data || []);
      setTgtPorts(b.data || []);
    } catch { /* dialog still works with auto ports */ }
  };

  const doConnect = async () => {
    if (source === null || pendingTarget === null) return;
    setBusy(true);
    try {
      await api.post("/network/topology/", {
        source, target: pendingTarget, is_uplink: asUplink,
        source_port: srcPort === "AUTO" ? null : parseInt(srcPort),
        target_port: tgtPort === "AUTO" ? null : parseInt(tgtPort),
      });
      toast.success("Devices linked");
      setPickOpen(false); setPendingTarget(null); setSource(null);
      fetchTopology();
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Could not link devices");
    } finally {
      setBusy(false);
    }
  };

  const portLabel = (p: any) =>
    `${p.port_name || `Port ${p.port_number}`}${p.connected_to_device ? ` · used → ${p.connected_to_device_name || "device"}` : ""}`;

  const disconnect = async (a: number, b: number) => {
    setBusy(true);
    try {
      await api.delete("/network/topology/", { data: { source: a, target: b } });
      toast.success("Link removed");
      fetchTopology();
    } catch {
      toast.error("Could not remove link");
    } finally {
      setBusy(false);
    }
  };

  const onNodeClick = (id: number) => {
    if (!connectMode) { router.push(`/network/devices/${id}`); return; }
    if (source === null) { setSource(id); return; }
    if (source === id) { setSource(null); return; }
    openPicker(id);
  };

  const exitConnect = () => { setConnectMode(false); setSource(null); };

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
        <div className="flex items-center gap-2">
          {connectMode ? (
            <>
              <label className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300 select-none">
                <Checkbox checked={asUplink} onCheckedChange={v => setAsUplink(!!v)} /> Uplink
              </label>
              <Button variant="outline" size="sm" onClick={exitConnect}><X className="h-4 w-4 mr-1" />Done</Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConnectMode(true)}><Link2 className="h-4 w-4 mr-1" />Connect devices</Button>
          )}
          <Select value={loc} onValueChange={setLoc}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="All locations" /></SelectTrigger>
            <SelectContent><SelectItem value="ALL">All locations</SelectItem>{locations.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {connectMode && (
        <div className="rounded-md border border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/40 px-4 py-2.5 text-sm text-violet-800 dark:text-violet-200">
          {source === null
            ? "Click a device to start a link, then click the device to connect it to. Click a line to remove that link."
            : `Selected "${layout.pos[source]?.node?.name || "device"}". Now click the device to connect it to. Click it again to cancel.`}
        </div>
      )}

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
                const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H / 2;
                const x2 = b.x + NODE_W / 2, y2 = b.y + NODE_H / 2;
                return (
                  <g key={i}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke={e.is_uplink ? "#6366f1" : "#cbd5e1"}
                      strokeWidth={e.is_uplink ? 2.5 : 1.5}
                      strokeDasharray={e.is_uplink ? "" : "4 3"} />
                    {connectMode && (
                      <line x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke="transparent" strokeWidth={14}
                        className="cursor-pointer"
                        onClick={() => !busy && disconnect(e.source, e.target)}>
                        <title>Remove this link</title>
                      </line>
                    )}
                  </g>
                );
              })}
              {/* nodes */}
              {Object.values(layout.pos).map(({ x, y, node }) => {
                const selected = source === node.id;
                return (
                  <g key={node.id} transform={`translate(${x},${y})`} className="cursor-pointer"
                    onClick={() => !busy && onNodeClick(node.id)}>
                    <rect width={NODE_W} height={NODE_H} rx={8}
                      fill="white"
                      stroke={selected ? "#7c3aed" : "#e5e7eb"} strokeWidth={selected ? 2.5 : 1.5}
                      className={`dark:fill-neutral-800 ${connectMode ? "hover:stroke-violet-500" : "hover:stroke-violet-400"}`} />
                    <circle cx={14} cy={NODE_H / 2} r={5} fill={STATUS_FILL[node.status] || "#a3a3a3"} />
                    <text x={28} y={22} fontSize={12} fontWeight={600} fill="currentColor" className="text-neutral-800 dark:text-neutral-100">
                      {node.name.length > 16 ? node.name.slice(0, 15) + "…" : node.name}
                    </text>
                    <text x={28} y={38} fontSize={10} fill="#94a3b8">
                      {node.type.replace("_", " ")}{node.ip ? ` · ${node.ip}` : ""}
                    </text>
                  </g>
                );
              })}
            </svg>}
      </Card>

      <div className="flex gap-4 text-xs text-neutral-500">
        <span className="flex items-center gap-1"><NetIcon className="w-3.5 h-3.5" /> {data.nodes.length} devices</span>
        <span className="flex items-center gap-1"><Server className="w-3.5 h-3.5" /> {data.edges.length} links</span>
        <span><span className="inline-block w-4 border-t-2 border-indigo-500 align-middle mr-1" /> uplink</span>
      </div>

      <Dialog open={pickOpen} onOpenChange={o => { setPickOpen(o); if (!o) setPendingTarget(null); }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Connect interfaces</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-neutral-500">
            Choose which interface links <span className="font-medium">{nameOf(source)}</span> to <span className="font-medium">{nameOf(pendingTarget)}</span>.
          </p>
          <div className="grid grid-cols-2 gap-4 mt-2">
            <div className="space-y-2">
              <Label>{nameOf(source)} interface</Label>
              <Select value={srcPort} onValueChange={setSrcPort}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Auto (next free)</SelectItem>
                  {srcPorts.map(p => <SelectItem key={p.id} value={String(p.port_number)}>{portLabel(p)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{nameOf(pendingTarget)} interface</Label>
              <Select value={tgtPort} onValueChange={setTgtPort}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">Auto (next free)</SelectItem>
                  {tgtPorts.map(p => <SelectItem key={p.id} value={String(p.port_number)}>{portLabel(p)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-sm text-neutral-600 dark:text-neutral-300 select-none mt-2">
            <Checkbox checked={asUplink} onCheckedChange={v => setAsUplink(!!v)} /> Mark as uplink
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPickOpen(false)}>Cancel</Button>
            <Button className="bg-violet-600 hover:bg-violet-700" onClick={doConnect} disabled={busy}>{busy ? "Linking…" : "Connect"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
