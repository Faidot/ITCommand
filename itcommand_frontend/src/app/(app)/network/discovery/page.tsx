"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  EyeOff,
  Loader2,
  Plus,
  RadarIcon,
  RefreshCw,
  Router,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import api from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuthStore } from "@/store/authStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DiscoveredHost {
  id: number;
  ip_address: string;
  mac_address: string;
  hostname: string;
  vendor_guess: string;
  open_ports: number[];
  discovered_via: string;
  state: "NEW" | "LINKED" | "IGNORED";
  matched_device_id: number | null;
  matched_device_name: string | null;
  times_seen: number;
  last_seen_at: string;
}

interface ScanRun {
  id: number;
  target: string;
  status: string;
  hosts_scanned: number;
  hosts_found: number;
  hosts_new: number;
  message: string;
  started_by_name: string | null;
  started_at: string;
  duration_seconds: number | null;
}

interface Options {
  pools: { id: number; name: string; target: string }[];
  integrations: {
    id: number;
    name: string;
    kind: string;
    kind_label: string;
    is_enabled: boolean;
    last_status: string;
  }[];
  kinds: {
    value: string;
    label: string;
    description: string;
    help: string;
    default_port: number;
    needs_username: boolean;
  }[];
  device_types: { value: string; label: string }[];
  max_hosts: number;
}

function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { results?: T[] }).results)) {
    return (data as { results: T[] }).results;
  }
  return [];
}

function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return detail || fallback;
}

const STATE_STYLES: Record<string, string> = {
  NEW: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300",
  LINKED:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
  IGNORED: "border-neutral-200 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800",
};

export default function NetworkDiscoveryPage() {
  const { user } = useAuthStore();
  const canScan = can(user, "network", "add");

  const [options, setOptions] = useState<Options | null>(null);
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [scans, setScans] = useState<ScanRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [mode, setMode] = useState<"pool" | "range" | "integration">("range");
  const [pool, setPool] = useState("");
  const [integration, setIntegration] = useState("");
  const [range, setRange] = useState("");
  const [probePorts, setProbePorts] = useState(false);
  const [stateFilter, setStateFilter] = useState("NEW");
  const [search, setSearch] = useState("");

  const [promoting, setPromoting] = useState<DiscoveredHost | null>(null);
  const emptyPromote = {
    device_name: "", device_type: "OTHER", brand: "", model: "", serial_number: "",
    ip_address: "", mac_address: "", hostname: "", subnet_mask: "", gateway: "",
    vlan_id: "", dns_primary: "", dns_secondary: "", location: "", vendor: "",
    rack_unit_start: "", rack_unit_size: "1", os_name: "", os_version: "",
    firmware_version: "", cpu_info: "", ram_gb: "", storage_info: "",
    purchase_date: "", warranty_expiry: "", status: "ONLINE", notes: "", port_count: "",
  };
  const [promoteForm, setPromoteForm] = useState<Record<string, string>>(emptyPromote);
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([]);
  const [vendors, setVendors] = useState<{ id: number; name: string }[]>([]);
  const setPF = (patch: Record<string, string>) => setPromoteForm((f) => ({ ...f, ...patch }));

  const load = useCallback(async () => {
    try {
      const [optionsRes, hostsRes, scansRes] = await Promise.all([
        api.get("/network/discovery-options/"),
        api.get(`/network/discovered/?state=${stateFilter}${search ? `&search=${encodeURIComponent(search)}` : ""}`),
        api.get("/network/scans/"),
      ]);
      setOptions(optionsRes.data);
      setHosts(listOf<DiscoveredHost>(hostsRes.data));
      setScans(listOf<ScanRun>(scansRes.data).slice(0, 5));
    } catch {
      toast.error("Could not load discovery data");
    } finally {
      setLoading(false);
    }
  }, [stateFilter, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api.get("/network/locations/").then((r) => setLocations(listOf<{ id: number; name: string }>(r.data))).catch(() => {});
    api.get("/vendors/?is_active=true").then((r) => setVendors(listOf<{ id: number; name: string }>(r.data))).catch(() => {});
  }, []);

  const runScan = async () => {
    const body: Record<string, unknown> = { probe_ports: probePorts };
    if (mode === "pool") {
      if (!pool) return toast.error("Choose an IP pool");
      body.pool = Number(pool);
    } else if (mode === "integration") {
      if (!integration) return toast.error("Choose a device to ask");
      body.integration = Number(integration);
    } else {
      if (!range.trim()) return toast.error("Enter a range like 192.168.1.0/24");
      body.target = range.trim();
    }

    setScanning(true);
    try {
      const res = await api.post("/network/scan/", body);
      const scan = res.data as ScanRun;
      if (scan.status === "FAILED") toast.error(scan.message || "Scan failed");
      else toast.success(scan.message || "Scan complete");
      await load();
    } catch (error) {
      toast.error(errorText(error, "Scan failed"));
    } finally {
      setScanning(false);
    }
  };

  const act = async (host: DiscoveredHost, path: string) => {
    setBusyId(host.id);
    try {
      await api.post(`/network/discovered/${host.id}/${path}/`);
      await load();
    } catch (error) {
      toast.error(errorText(error, "Action failed"));
    } finally {
      setBusyId(null);
    }
  };

  const submitPromote = async () => {
    if (!promoting) return;
    if (!promoteForm.device_name.trim()) return toast.error("Device name required");
    setBusyId(promoting.id);
    try {
      const res = await api.post(`/network/discovered/${promoting.id}/promote/`, promoteForm);
      toast.success(res.data?.detail || "Added to inventory");
      setPromoting(null);
      await load();
    } catch (error) {
      toast.error(errorText(error, "Could not add the device"));
    } finally {
      setBusyId(null);
    }
  };

  const openPromote = (host: DiscoveredHost) => {
    setPromoting(host);
    setPromoteForm({
      ...emptyPromote,
      device_name: host.hostname || `${host.vendor_guess || "Device"} ${host.ip_address}`,
      brand: host.vendor_guess || "",
      ip_address: host.ip_address || "",
      mac_address: host.mac_address || "",
      hostname: host.hostname || "",
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Network discovery</h1>
        <p className="text-sm text-muted-foreground">
          Find what is actually on your network, then add the devices worth tracking
          to your inventory.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            <RadarIcon className="h-4 w-4" /> Run a scan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="scan-mode">Scan by</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
                <SelectTrigger id="scan-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="range">IP range</SelectItem>
                  <SelectItem value="pool">Saved IP pool</SelectItem>
                  <SelectItem value="integration">Ask a router / firewall</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "range" && (
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="scan-range">Range</Label>
                <Input
                  id="scan-range"
                  value={range}
                  onChange={(e) => setRange(e.target.value)}
                  placeholder="192.168.1.0/24"
                />
                <p className="text-xs text-muted-foreground">
                  Up to {options?.max_hosts ?? 1024} addresses per scan — a /22 or narrower.
                </p>
              </div>
            )}

            {mode === "pool" && (
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="scan-pool">IP pool</Label>
                <Select value={pool} onValueChange={setPool}>
                  <SelectTrigger id="scan-pool">
                    <SelectValue placeholder={options?.pools.length ? "Choose a pool" : "No pools defined yet"} />
                  </SelectTrigger>
                  <SelectContent>
                    {options?.pools.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name} — {p.target}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {mode === "integration" && (
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="scan-integration">Device</Label>
                <Select value={integration} onValueChange={setIntegration}>
                  <SelectTrigger id="scan-integration">
                    <SelectValue
                      placeholder={
                        options?.integrations.length
                          ? "Choose a device"
                          : "No routers or firewalls configured yet"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {options?.integrations.map((i) => (
                      <SelectItem key={i.id} value={String(i.id)}>
                        {i.name} ({i.kind_label}){i.is_enabled ? "" : " — disabled"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  A sweep only sees this server&apos;s own network segment. Asking the
                  router reveals every VLAN it serves.
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {mode !== "integration" && (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={probePorts} onCheckedChange={setProbePorts} />
                Also check common ports (slower, hints at what each host is)
              </label>
            )}
            <Button
              onClick={() => void runScan()}
              disabled={scanning || !canScan}
              title={canScan ? undefined : "You need permission to add network devices"}
            >
              {scanning ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning…</>
              ) : (
                <><RadarIcon className="mr-2 h-4 w-4" /> Start scan</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {scans.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Recent scans
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Found</TableHead>
                  <TableHead>New</TableHead>
                  <TableHead>Took</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.map((scan) => (
                  <TableRow key={scan.id}>
                    <TableCell className="font-medium">{scan.target || "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={scan.status === "COMPLETED" ? STATE_STYLES.LINKED : STATE_STYLES.IGNORED}
                      >
                        {scan.status}
                      </Badge>
                      {scan.status === "FAILED" && (
                        <span className="ml-2 text-xs text-red-600">{scan.message}</span>
                      )}
                    </TableCell>
                    <TableCell>{scan.hosts_found}</TableCell>
                    <TableCell>{scan.hosts_new}</TableCell>
                    <TableCell>{scan.duration_seconds != null ? `${scan.duration_seconds}s` : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(scan.started_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Discovered hosts
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="IP, hostname, MAC…"
                className="h-9 w-52 pl-8"
              />
            </div>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="NEW">New</SelectItem>
                <SelectItem value="LINKED">Added</SelectItem>
                <SelectItem value="IGNORED">Ignored</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => void load()} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {hosts.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {stateFilter === "NEW"
                ? "Nothing new. Run a scan to look for devices."
                : "Nothing here."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Identity</TableHead>
                  <TableHead>Seen</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hosts.map((host) => (
                  <TableRow key={host.id}>
                    <TableCell>
                      <div className="font-medium">{host.ip_address}</div>
                      {host.mac_address && (
                        <div className="font-mono text-xs text-muted-foreground">{host.mac_address}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{host.hostname || "—"}</div>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                        {host.vendor_guess && <span>{host.vendor_guess}</span>}
                        {host.open_ports.length > 0 && (
                          <span>· ports {host.open_ports.join(", ")}</span>
                        )}
                      </div>
                      {host.matched_device_name && host.state !== "LINKED" && (
                        <Badge variant="outline" className={`mt-1 ${STATE_STYLES.LINKED}`}>
                          Already in inventory
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      ×{host.times_seen}
                      <br />
                      {new Date(host.last_seen_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-xs">{host.discovered_via}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {host.state === "NEW" && canScan && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === host.id}
                              onClick={() => openPromote(host)}
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" /> Add
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === host.id}
                              onClick={() => void act(host, "ignore")}
                            >
                              <EyeOff className="mr-1 h-3.5 w-3.5" /> Ignore
                            </Button>
                          </>
                        )}
                        {host.state === "LINKED" && (
                          <Badge variant="outline" className={STATE_STYLES.LINKED}>
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            {host.matched_device_name || "Added"}
                          </Badge>
                        )}
                        {host.state === "IGNORED" && canScan && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === host.id}
                            onClick={() => void act(host, "reset")}
                          >
                            Un-ignore
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!promoting} onOpenChange={(open) => !open && setPromoting(null)}>
        <DialogContent className="sm:max-w-[650px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add to inventory</DialogTitle>
            <DialogDescription>
              Creates a network device record for {promoting?.ip_address}. Fields are
              pre-filled from the scan — complete the rest as needed.
            </DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="identity" className="w-full flex-col">
            <TabsList className="grid w-full grid-cols-5 mb-4">
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="network">Network</TabsTrigger>
              <TabsTrigger value="location">Location</TabsTrigger>
              <TabsTrigger value="system">System</TabsTrigger>
              <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
            </TabsList>
            <div className="overflow-y-auto pr-2" style={{ maxHeight: "55vh" }}>
              <TabsContent value="identity" className="space-y-3 mt-0">
                <div className="space-y-2"><Label>Device Name *</Label><Input value={promoteForm.device_name} onChange={(e) => setPF({ device_name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Type</Label>
                    <Select value={promoteForm.device_type} onValueChange={(v) => setPF({ device_type: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{options?.device_types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Brand</Label><Input value={promoteForm.brand} onChange={(e) => setPF({ brand: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Model</Label><Input value={promoteForm.model} onChange={(e) => setPF({ model: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Serial Number</Label><Input value={promoteForm.serial_number} onChange={(e) => setPF({ serial_number: e.target.value })} /></div>
                </div>
                <div className="space-y-2"><Label>Interfaces / Ports</Label><Input type="number" min="0" value={promoteForm.port_count} onChange={(e) => setPF({ port_count: e.target.value })} placeholder="e.g. 24" /><p className="text-xs text-muted-foreground">Creates numbered interfaces you can wire in the topology map.</p></div>
              </TabsContent>
              <TabsContent value="network" className="space-y-3 mt-0">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>IP Address</Label><Input value={promoteForm.ip_address} onChange={(e) => setPF({ ip_address: e.target.value })} /></div>
                  <div className="space-y-2"><Label>MAC Address</Label><Input value={promoteForm.mac_address} onChange={(e) => setPF({ mac_address: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Hostname</Label><Input value={promoteForm.hostname} onChange={(e) => setPF({ hostname: e.target.value })} /></div>
                  <div className="space-y-2"><Label>VLAN ID</Label><Input type="number" value={promoteForm.vlan_id} onChange={(e) => setPF({ vlan_id: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Subnet Mask</Label><Input value={promoteForm.subnet_mask} onChange={(e) => setPF({ subnet_mask: e.target.value })} placeholder="255.255.255.0" /></div>
                  <div className="space-y-2"><Label>Gateway</Label><Input value={promoteForm.gateway} onChange={(e) => setPF({ gateway: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>DNS Primary</Label><Input value={promoteForm.dns_primary} onChange={(e) => setPF({ dns_primary: e.target.value })} /></div>
                  <div className="space-y-2"><Label>DNS Secondary</Label><Input value={promoteForm.dns_secondary} onChange={(e) => setPF({ dns_secondary: e.target.value })} /></div>
                </div>
                {promoting?.open_ports && promoting.open_ports.length > 0 && (
                  <p className="text-xs text-muted-foreground">Open ports seen: {promoting.open_ports.join(", ")}</p>
                )}
              </TabsContent>
              <TabsContent value="location" className="space-y-3 mt-0">
                <div className="space-y-2"><Label>Location</Label>
                  <Select value={promoteForm.location} onValueChange={(v) => setPF({ location: v })}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>{locations.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Rack Unit Start</Label><Input type="number" value={promoteForm.rack_unit_start} onChange={(e) => setPF({ rack_unit_start: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Rack Unit Size (U)</Label><Input type="number" value={promoteForm.rack_unit_size} onChange={(e) => setPF({ rack_unit_size: e.target.value })} /></div>
                </div>
              </TabsContent>
              <TabsContent value="system" className="space-y-3 mt-0">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>OS Name</Label><Input value={promoteForm.os_name} onChange={(e) => setPF({ os_name: e.target.value })} /></div>
                  <div className="space-y-2"><Label>OS Version</Label><Input value={promoteForm.os_version} onChange={(e) => setPF({ os_version: e.target.value })} /></div>
                </div>
                <div className="space-y-2"><Label>Firmware Version</Label><Input value={promoteForm.firmware_version} onChange={(e) => setPF({ firmware_version: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>CPU Info</Label><Input value={promoteForm.cpu_info} onChange={(e) => setPF({ cpu_info: e.target.value })} /></div>
                  <div className="space-y-2"><Label>RAM (GB)</Label><Input type="number" value={promoteForm.ram_gb} onChange={(e) => setPF({ ram_gb: e.target.value })} /></div>
                </div>
                <div className="space-y-2"><Label>Storage Info</Label><Textarea value={promoteForm.storage_info} onChange={(e) => setPF({ storage_info: e.target.value })} placeholder="e.g. 4x 1TB SSD RAID 10" /></div>
              </TabsContent>
              <TabsContent value="lifecycle" className="space-y-3 mt-0">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Status</Label>
                    <Select value={promoteForm.status} onValueChange={(v) => setPF({ status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ONLINE">Online</SelectItem><SelectItem value="OFFLINE">Offline</SelectItem>
                        <SelectItem value="MAINTENANCE">Maintenance</SelectItem><SelectItem value="DECOMMISSIONED">Decommissioned</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>Vendor</Label>
                    <Select value={promoteForm.vendor} onValueChange={(v) => setPF({ vendor: v })}>
                      <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                      <SelectContent>{vendors.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Purchase Date</Label><Input type="date" value={promoteForm.purchase_date} onChange={(e) => setPF({ purchase_date: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Warranty Expiry</Label><Input type="date" value={promoteForm.warranty_expiry} onChange={(e) => setPF({ warranty_expiry: e.target.value })} /></div>
                </div>
                <div className="space-y-2"><Label>Notes</Label><Textarea value={promoteForm.notes} onChange={(e) => setPF({ notes: e.target.value })} /></div>
              </TabsContent>
            </div>
          </Tabs>
          <DialogFooter className="pt-4 border-t mt-4">
            <Button variant="outline" onClick={() => setPromoting(null)}>Cancel</Button>
            <Button onClick={() => void submitPromote()} disabled={busyId === promoting?.id}>
              Add device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
