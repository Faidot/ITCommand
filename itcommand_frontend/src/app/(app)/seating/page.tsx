"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Map as MapIcon, Building, Plus, RefreshCw, Save, Boxes, Grid3x3,
  ZoomIn, ZoomOut, Magnet, Settings2, Search, Trash2, ArrowLeft, Clock,
} from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { useAuthStore } from "@/store/authStore";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

import { ElementPalette } from "@/components/seating/element-palette";
import { PropertiesPanel } from "@/components/seating/properties-panel";
import { FloorCanvas2D } from "@/components/seating/floor-canvas-2d";
import { FloorManagerDialog } from "@/components/seating/floor-manager";
import { OfficeGallery, OfficeWithCounts } from "@/components/seating/office-gallery";
import { PendingSheet, PendingAssignment } from "@/components/seating/pending-sheet";
import {
  ASSIGNABLE_TYPES, CELL, ElementType, FloorObject, fromServer, makeCluster,
  makeObject, toServer,
} from "@/lib/seating-types";

const FloorCanvas3D = dynamic(
  () => import("@/components/seating/floor-canvas-3d").then((m) => m.FloorCanvas3D),
  { ssr: false, loading: () => <Loading3D /> }
);

function Loading3D() {
  return (
    <div className="flex-1 flex items-center justify-center bg-slate-200 dark:bg-slate-900 text-neutral-500 text-sm">
      Loading 3D view…
    </div>
  );
}

export default function SeatingPlanPage() {
  const { user } = useAuthStore();
  const router = useRouter();
  const editable = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const openAsset = (assetId: number) => router.push(`/assets/${assetId}`);
  const openAllAssets = (_userId: number) => router.push("/assets");

  const [offices, setOffices] = useState<any[]>([]);
  const [selectedOffice, setSelectedOffice] = useState<any>(null);
  const [floors, setFloors] = useState<any[]>([]);
  const [selectedFloor, setSelectedFloor] = useState<any>(null);

  const [objects, setObjects] = useState<FloorObject[]>([]);
  const [selectedCids, setSelectedCids] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  const [view, setView] = useState<"2D" | "3D">("2D");
  const [zoom, setZoom] = useState(0.85);
  const [snap, setSnap] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<any>(null);

  const [users, setUsers] = useState<any[]>([]);

  // dialogs / sheets
  const [assignFor, setAssignFor] = useState<FloorObject | null>(null);
  const [pickedUserId, setPickedUserId] = useState<number | null>(null);
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [floorMgrOpen, setFloorMgrOpen] = useState(false);
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false);

  // Top-level screen: office gallery vs floor designer
  const [screen, setScreen] = useState<"gallery" | "designer">("gallery");

  // Pending changes for the currently-open office
  const [pending, setPending] = useState<PendingAssignment[]>([]);

  const selectedObjects = objects.filter((o) => selectedCids.includes(o.cid));
  const floorW = (selectedFloor?.width_units || 20) * CELL;
  const floorH = (selectedFloor?.height_units || 15) * CELL;

  // ───── data loading

  useEffect(() => { fetchInitial(); }, []);

  const fetchInitial = async () => {
    try {
      const [officesRes, statsRes, usersRes] = await Promise.all([
        api.get("/seating/offices/"),
        api.get("/seating/stats/"),
        api.get("/users/"),
      ]);
      setOffices(officesRes.data.results || officesRes.data);
      setStats(statsRes.data);
      setUsers(usersRes.data.results || usersRes.data);
    } catch {
      toast.error("Failed to load seating data");
    } finally {
      setLoading(false);
    }
  };

  const refreshOffices = async () => {
    try {
      const r = await api.get("/seating/offices/");
      setOffices(r.data.results || r.data);
    } catch {/* silent */}
  };

  /** Pick an office from the gallery card and open its designer. */
  const enterOffice = async (o: any) => {
    setScreen("designer");
    await selectOffice(o);
  };

  const backToGallery = () => {
    if (dirty && !confirm("You have unsaved layout changes. Discard them?")) return;
    setScreen("gallery");
    setSelectedFloor(null);
    setObjects([]);
    setSelectedCids([]);
    setDirty(false);
    refreshOffices();
  };

  const selectOffice = async (office: any) => {
    setSelectedOffice(office);
    setLoading(true);
    try {
      const res = await api.get(`/seating/offices/${office.id}/floors/`);
      setFloors(res.data);
      if (res.data.length > 0) {
        await loadFloor(res.data[0]);
      } else {
        setSelectedFloor(null);
        setObjects([]);
        setLoading(false);
      }
    } catch {
      toast.error("Failed to load floors");
      setLoading(false);
    }
  };

  const loadFloor = async (floor: any) => {
    setSelectedFloor(floor);
    setSelectedCids([]);
    setLoading(true);
    try {
      const res = await api.get(`/seating/floors/${floor.id}/layout/`);
      setObjects((res.data.objects || []).map(fromServer));
      setSelectedFloor(res.data.floor || floor);
      setDirty(false);
    } catch {
      toast.error("Failed to load floor layout");
    } finally {
      setLoading(false);
    }
  };

  const switchFloor = (floor: any) => {
    if (dirty && !confirm("You have unsaved layout changes. Discard them?")) return;
    loadFloor(floor);
  };

  const refreshStats = () => {
    api.get("/seating/stats/").then((r) => setStats(r.data)).catch(() => {});
  };

  // ───── pending seating changes (proposed by HR, await approval)

  const fetchPending = useCallback(async (officeId?: number) => {
    const id = officeId ?? selectedOffice?.id;
    if (!id) { setPending([]); return; }
    try {
      const r = await api.get(`/seating/assignments/?status=PENDING&office=${id}`);
      setPending(r.data.results || r.data);
    } catch {/* silent */}
  }, [selectedOffice?.id]);

  useEffect(() => {
    if (selectedOffice?.id) fetchPending(selectedOffice.id);
    else setPending([]);
  }, [selectedOffice?.id, fetchPending]);

  const approvePending = async (id: number) => {
    try {
      await api.post(`/seating/assignments/${id}/approve/`, {});
      toast.success("Approved & applied");
      if (selectedFloor) await loadFloor(selectedFloor);
      refreshStats();
      fetchPending();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to approve");
    }
  };

  const rejectPending = async (id: number) => {
    if (!confirm("Reject this pending change?")) return;
    try {
      await api.post(`/seating/assignments/${id}/reject/`, {});
      toast.success("Rejected");
      fetchPending();
    } catch {
      toast.error("Failed to reject");
    }
  };

  const closeAssignDialog = () => {
    setAssignFor(null);
    setPickedUserId(null);
    setUserSearchOpen(false);
  };

  const doPropose = async (seatId: number, userId: number) => {
    try {
      await api.post(`/seating/seats/${seatId}/propose/`, { user_id: userId });
      toast.success("Change proposed — awaiting approval");
      closeAssignDialog();
      fetchPending();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to propose change");
    }
  };

  const doProposeVacate = async (seatId: number) => {
    try {
      await api.post(`/seating/seats/${seatId}/propose_vacate/`, {});
      toast.success("Vacate proposed — awaiting approval");
      closeAssignDialog();
      fetchPending();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to propose vacate");
    }
  };

  // ───── object mutations

  const mutate = useCallback((updater: (prev: FloorObject[]) => FloorObject[]) => {
    setObjects(updater);
    setDirty(true);
  }, []);

  const addObject = (type: ElementType, x?: number, y?: number) => {
    if (!editable) return;
    const maxZ = objects.reduce((m, o) => Math.max(m, o.z_index), 0);
    const n = objects.length % 9;
    const obj = makeObject(
      type,
      x ?? 70 + n * 26,
      y ?? 70 + n * 26,
      maxZ + 1
    );
    mutate((prev) => [...prev, obj]);
    setSelectedCids([obj.cid]);
  };

  const addCluster = (clusterId: string, x?: number, y?: number) => {
    if (!editable) return;
    const maxZ = objects.reduce((m, o) => Math.max(m, o.z_index), 0);
    const items = makeCluster(clusterId, x ?? 80, y ?? 80, maxZ + 1);
    if (!items.length) return;
    mutate((prev) => [...prev, ...items]);
    setSelectedCids(items.map((i) => i.cid));
    toast.success(`Added ${items.length} elements`);
  };

  const updateObject = (cid: string, patch: Partial<FloorObject>) => {
    mutate((prev) => prev.map((o) => (o.cid === cid ? { ...o, ...patch } : o)));
  };

  /** Apply a patch to every currently selected object (used by canvas + panel). */
  const applyToSelection = (patch: Partial<FloorObject>) => {
    if (!selectedCids.length) return;
    const set = new Set(selectedCids);
    mutate((prev) => prev.map((o) => (set.has(o.cid) ? { ...o, ...patch } : o)));
  };

  /** Batch position/transform updates from group drag in the canvas. */
  const updateMany = (updates: { cid: string; patch: Partial<FloorObject> }[]) => {
    const map = new Map(updates.map((u) => [u.cid, u.patch]));
    mutate((prev) => prev.map((o) => (map.has(o.cid) ? { ...o, ...map.get(o.cid)! } : o)));
  };

  const deleteSelection = () => {
    if (!selectedCids.length) return;
    const set = new Set(selectedCids);
    mutate((prev) => prev.filter((o) => !set.has(o.cid)));
    setSelectedCids([]);
  };

  const duplicateSelection = () => {
    if (!selectedCids.length) return;
    const set = new Set(selectedCids);
    const maxZ = objects.reduce((m, o) => Math.max(m, o.z_index), 0);
    const copies: FloorObject[] = [];
    objects.filter((o) => set.has(o.cid)).forEach((src, i) => {
      const c = makeObject(src.object_type, src.x + 28, src.y + 28, maxZ + 1 + i);
      c.width = src.width; c.height = src.height;
      c.rotation = src.rotation; c.elevation = src.elevation;
      c.color = src.color; c.label = src.label;
      copies.push(c);
    });
    mutate((prev) => [...prev, ...copies]);
    setSelectedCids(copies.map((c) => c.cid));
  };

  const bringSelectionToFront = () => {
    if (!selectedCids.length) return;
    const maxZ = objects.reduce((m, o) => Math.max(m, o.z_index), 0);
    updateMany(selectedCids.map((cid, i) => ({ cid, patch: { z_index: maxZ + 1 + i } })));
  };
  const sendSelectionToBack = () => {
    if (!selectedCids.length) return;
    const minZ = objects.reduce((m, o) => Math.min(m, o.z_index), 0);
    updateMany(selectedCids.map((cid, i) => ({ cid, patch: { z_index: minZ - 1 - i } })));
  };

  // keyboard delete
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!editable || selectedCids.length === 0) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, selectedCids]);

  // ───── save

  const saveLayout = async () => {
    if (!selectedFloor) return;
    setSaving(true);
    try {
      const res = await api.post(`/seating/floors/${selectedFloor.id}/save_layout/`, {
        objects: objects.map(toServer),
      });
      setObjects((res.data || []).map(fromServer));
      setSelectedCids([]);
      setDirty(false);
      toast.success("Floor layout saved");
      refreshStats();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to save layout");
    } finally {
      setSaving(false);
    }
  };

  // ───── assignment

  const openAssign = (obj: FloorObject) => {
    if (!obj.seat) {
      toast.message("Save the layout first", {
        description: "New seats need to be saved before you can assign people.",
      });
      return;
    }
    setAssignFor(obj);
  };

  const doAssign = async (userId: number) => {
    if (!assignFor?.seat) return;
    try {
      await api.post(`/seating/seats/${assignFor.seat}/assign/`, { user_id: userId });
      toast.success("Seat assigned");
      setAssignFor(null);
      setUserSearchOpen(false);
      if (selectedFloor) await loadFloor(selectedFloor);
      refreshStats();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to assign seat");
    }
  };

  const doVacate = async (obj: FloorObject) => {
    if (!obj.seat) return;
    if (!confirm("Vacate this seat?")) return;
    try {
      await api.post(`/seating/seats/${obj.seat}/vacate/`);
      toast.success("Seat vacated");
      if (selectedFloor) await loadFloor(selectedFloor);
      refreshStats();
    } catch {
      toast.error("Failed to vacate seat");
    }
  };

  // ───── render

  if (loading && objects.length === 0 && !selectedFloor) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const occupied = objects.filter((o) => o.is_occupied).length;
  const seatCount = objects.filter((o) => ASSIGNABLE_TYPES.has(o.object_type)).length;

  // ── Office gallery (entry page)
  if (screen === "gallery") {
    const officesWithCounts: OfficeWithCounts[] = offices.map((o: any) => ({
      id: o.id, name: o.name, address: o.address,
      floor_count: o.floor_count ?? 0,
      seat_count: o.seat_count ?? 0,
      occupied_count: o.occupied_count ?? 0,
      pending_count: o.pending_count ?? 0,
    }));
    return (
      <div className="flex flex-col h-[calc(100vh-3.5rem)] w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <MapIcon className="h-5 w-5 text-violet-500" /> Seating Plan
            </h1>
            <p className="text-xs text-neutral-500">
              Pick an office location to enter its floor designer.
            </p>
          </div>
          {stats && (
            <div className="flex items-center gap-3 text-xs">
              <Stat label="Offices" value={offices.length} />
              <Stat label="Seats" value={stats.total_seats} />
              <Stat label="Occupied" value={stats.occupied_seats} tone="blue" />
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto bg-neutral-50 dark:bg-neutral-950/40">
          {loading ? (
            <div className="flex items-center justify-center min-h-[40vh]">
              <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <OfficeGallery
              offices={officesWithCounts}
              editable={editable}
              onSelect={(o) => enterOffice(o)}
              onAddOffice={() => setFloorMgrOpen(true)}
            />
          )}
        </div>
        <FloorManagerDialog
          open={floorMgrOpen}
          onOpenChange={setFloorMgrOpen}
          editable={editable}
          onChanged={async (officeIdToSelect) => {
            await refreshOffices();
            if (officeIdToSelect) {
              const off = (await api.get("/seating/offices/")).data;
              const list = off.results || off;
              const o = list.find((x: any) => x.id === officeIdToSelect);
              if (o) enterOffice(o);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" className="h-8 -ml-2" onClick={backToGallery}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Offices
          </Button>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <MapIcon className="h-5 w-5 text-violet-500" />
              {selectedOffice?.name || "Floor Designer"}
            </h1>
            <p className="text-xs text-neutral-500 truncate">
              {selectedOffice?.address || "Design 2D / 3D floor plans, place seats & furniture, assign people."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Stat label="Seats (floor)" value={seatCount} />
          <Stat label="Occupied" value={occupied} tone="blue" />
          <Stat label="Free" value={Math.max(0, seatCount - occupied)} tone="emerald" />
          {stats && <Stat label="All seats" value={stats.total_seats} />}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-y bg-neutral-50 dark:bg-neutral-900/60">
        {/* Office location dropdown */}
        <Select
          value={selectedOffice?.id?.toString() || ""}
          onValueChange={(v) => {
            const o = offices.find((x) => x.id.toString() === v);
            if (o) selectOffice(o);
          }}
        >
          <SelectTrigger className="h-8 w-[210px] text-xs bg-white dark:bg-neutral-900">
            <Building className="w-3.5 h-3.5 mr-1 text-neutral-400 shrink-0" />
            <SelectValue placeholder="Select office location" />
          </SelectTrigger>
          <SelectContent>
            {offices.length === 0 ? (
              <div className="px-3 py-2 text-xs text-neutral-400">
                No offices — add one in “Manage floors”.
              </div>
            ) : (
              offices.map((o) => (
                <SelectItem key={o.id} value={o.id.toString()}>{o.name}</SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        {/* Floors */}
        {floors.length > 0 && (
          <Tabs value={selectedFloor?.id?.toString()} onValueChange={(v) => {
            const f = floors.find((x) => x.id.toString() === v);
            if (f) switchFloor(f);
          }}>
            <TabsList className="h-8 bg-transparent border">
              {floors.map((f) => (
                <TabsTrigger key={f.id} value={f.id.toString()}
                  className="text-xs h-6 data-[state=active]:bg-violet-100 data-[state=active]:text-violet-800 dark:data-[state=active]:bg-violet-900/40">
                  {f.floor_name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setFloorMgrOpen(true)}>
          <Settings2 className="w-3.5 h-3.5 mr-1" /> Manage floors
        </Button>

        <div className="h-5 w-px bg-neutral-300 dark:bg-neutral-700 mx-1" />

        {/* View toggle */}
        <div className="inline-flex border rounded-md overflow-hidden bg-white dark:bg-neutral-900">
          <button onClick={() => setView("2D")}
            className={`px-3 py-1 text-xs font-medium flex items-center gap-1 ${view === "2D" ? "bg-violet-600 text-white" : ""}`}>
            <Grid3x3 className="w-3.5 h-3.5" /> 2D
          </button>
          <button onClick={() => setView("3D")}
            className={`px-3 py-1 text-xs font-medium flex items-center gap-1 ${view === "3D" ? "bg-violet-600 text-white" : ""}`}>
            <Boxes className="w-3.5 h-3.5" /> 3D
          </button>
        </div>

        {/* Zoom (2D only) */}
        {view === "2D" && (
          <>
            <div className="inline-flex items-center gap-1">
              <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.15).toFixed(2)))}>
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <span className="text-xs w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
              <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.15).toFixed(2)))}>
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
            </div>
            {editable && (
              <Button size="sm" variant={snap ? "default" : "outline"} className="h-8 text-xs" onClick={() => setSnap((s) => !s)}>
                <Magnet className="w-3.5 h-3.5 mr-1" /> Snap
              </Button>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant={pending.length > 0 ? "default" : "outline"}
            className={`h-8 text-xs ${pending.length > 0 ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
            onClick={() => setPendingSheetOpen(true)}
          >
            <Clock className="w-3.5 h-3.5 mr-1" /> Pending
            {pending.length > 0 && (
              <Badge className="ml-1 h-4 px-1.5 text-[10px] bg-white text-amber-700 hover:bg-white">
                {pending.length}
              </Badge>
            )}
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => selectedFloor && loadFloor(selectedFloor)}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          {editable && (
            <Button size="sm" className="h-8 text-xs bg-violet-600 hover:bg-violet-700"
              onClick={saveLayout} disabled={saving || !selectedFloor || !dirty}>
              <Save className="w-3.5 h-3.5 mr-1" />
              {saving ? "Saving…" : dirty ? "Save layout" : "Saved"}
            </Button>
          )}
        </div>
      </div>

      {/* Main editor */}
      <div className="flex flex-1 min-h-0">
        {editable && view === "2D" && (
          <ElementPalette
            onAdd={(t) => addObject(t)}
            onAddCluster={(id) => addCluster(id)}
            disabled={!selectedFloor}
          />
        )}

        {!selectedFloor ? (
          <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
            No floor selected. Use “Manage floors” to create an office and a floor.
          </div>
        ) : view === "2D" ? (
          <FloorCanvas2D
            objects={objects}
            width={floorW}
            height={floorH}
            zoom={zoom}
            selectedCids={selectedCids}
            editable={editable}
            snap={snap}
            pendingSeatIds={pending.map((p) => p.seat)}
            onSelectionChange={setSelectedCids}
            onChange={updateObject}
            onChangeMany={updateMany}
            onAddAt={addObject}
            onOpenObject={(o) => openAssign(o)}
            onOpenAsset={openAsset}
            onOpenAllAssets={openAllAssets}
          />
        ) : (
          <FloorCanvas3D
            objects={objects}
            width={floorW}
            height={floorH}
            selectedCids={selectedCids}
            pendingSeatIds={pending.map((p) => p.seat)}
            onSelect={(cid) => setSelectedCids(cid ? [cid] : [])}
            onOpenObject={(o) => openAssign(o)}
            onOpenAsset={openAsset}
            onOpenAllAssets={openAllAssets}
          />
        )}

        {editable && (
          <PropertiesPanel
            objs={selectedObjects}
            onChange={(patch) => applyToSelection(patch)}
            onDelete={deleteSelection}
            onDuplicate={duplicateSelection}
            onBringToFront={bringSelectionToFront}
            onSendToBack={sendSelectionToBack}
            onAssign={() => selectedObjects[0] && openAssign(selectedObjects[0])}
            onVacate={() => selectedObjects[0] && doVacate(selectedObjects[0])}
          />
        )}
      </div>

      {/* Legend */}
      <div className="px-4 py-1.5 border-t bg-neutral-50 dark:bg-neutral-900/60 flex flex-wrap gap-4 text-[11px] text-neutral-500 justify-center">
        <Legend color="#3b82f6" label="Workstation" />
        <Legend color="#6366f1" label="Cabin" />
        <Legend color="#14b8a6" label="Hot Desk" />
        <Legend color="#64748b" label="Meeting Room" />
        <Legend color="#d97706" label="Desk / Furniture" />
        <Legend color="#475569" label="Wall / Structure" />
        <span className="text-neutral-400">
          Drag empty floor to box-select · Shift-click to multi-pick · drag a group to move all ·
          double-click a seat to assign · hover to see who sits there · Del removes selection
        </span>
      </div>

      {/* Assign dialog */}
      <Dialog open={!!assignFor} onOpenChange={(v) => !v && closeAssignDialog()}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-6">
              <span>Assign seat</span>
              {assignFor?.seat_code && <Badge variant="outline">{assignFor.seat_code}</Badge>}
            </DialogTitle>
          </DialogHeader>
          {assignFor && (() => {
            const pickedUser = pickedUserId != null
              ? users.find((u) => u.id === pickedUserId)
              : null;
            return (
              <div className="py-3 space-y-3">
                {assignFor.is_occupied && assignFor.current_assignment && !pickedUser && (
                  <div className="rounded-md border bg-neutral-50 dark:bg-neutral-900 p-3 text-sm">
                    Currently:{" "}
                    <span className="font-semibold">
                      {assignFor.current_assignment.user_name}
                    </span>
                  </div>
                )}

                {pickedUser ? (
                  <>
                    <div className="rounded-md border bg-violet-50/50 dark:bg-violet-950/30 p-3 text-sm">
                      <div className="text-[11px] text-violet-700 dark:text-violet-300 uppercase">
                        Assigning to
                      </div>
                      <div className="font-semibold text-base">
                        {pickedUser.full_name || pickedUser.email}
                      </div>
                      <div className="text-[11px] text-neutral-500 truncate">
                        {pickedUser.email}
                      </div>
                      <button
                        type="button"
                        className="text-[11px] text-violet-600 hover:underline mt-1"
                        onClick={() => { setPickedUserId(null); setUserSearchOpen(true); }}
                      >
                        Change person…
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        className="bg-violet-600 hover:bg-violet-700"
                        onClick={() => doAssign(pickedUser.id)}
                      >
                        Apply now
                      </Button>
                      <Button
                        variant="outline"
                        className="border-amber-200 text-amber-700 hover:bg-amber-50"
                        onClick={() => assignFor.seat && doPropose(assignFor.seat, pickedUser.id)}
                      >
                        <Clock className="w-4 h-4 mr-1.5" /> Propose
                      </Button>
                    </div>
                    <p className="text-[11px] text-neutral-500">
                      <span className="font-medium">Apply now</span>: takes effect immediately. {" "}
                      <span className="font-medium">Propose</span>: queues a pending change for approval.
                    </p>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline" className="w-full justify-between"
                      onClick={() => setUserSearchOpen(true)}
                    >
                      <span>{assignFor.is_occupied ? "Reassign to another person…" : "Choose a person…"}</span>
                      <Search className="w-4 h-4 text-muted-foreground" />
                    </Button>

                    {assignFor.is_occupied && (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          className="text-red-600 border-red-200 hover:bg-red-50"
                          onClick={() => { const o = assignFor; closeAssignDialog(); doVacate(o); }}
                        >
                          <Trash2 className="w-4 h-4 mr-1.5" /> Vacate now
                        </Button>
                        <Button
                          variant="outline"
                          className="border-amber-200 text-amber-700 hover:bg-amber-50"
                          onClick={() => assignFor.seat && doProposeVacate(assignFor.seat)}
                        >
                          <Clock className="w-4 h-4 mr-1.5" /> Propose vacate
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* User search — picks a user, then back to the assign dialog */}
      <Dialog open={userSearchOpen} onOpenChange={setUserSearchOpen}>
        <DialogContent className="sm:max-w-[520px] p-0 overflow-hidden">
          <DialogHeader className="p-4 pb-0">
            <DialogTitle>Select a person</DialogTitle>
          </DialogHeader>
          <div className="p-4 pt-3">
            <Command shouldFilter>
              <CommandInput placeholder="Search name or email…" />
              <CommandList>
                <CommandEmpty>No users found.</CommandEmpty>
                <CommandGroup heading="Users">
                  {users.slice(0, 400).map((u) => (
                    <CommandItem
                      key={u.id}
                      value={`${u.full_name || ""} ${u.email || ""}`}
                      onSelect={() => { setPickedUserId(u.id); setUserSearchOpen(false); }}
                    >
                      <span className="font-medium">{u.full_name || u.email}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{u.email}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pending sheet — list, approve, reject */}
      <PendingSheet
        open={pendingSheetOpen}
        onOpenChange={setPendingSheetOpen}
        items={pending}
        onApprove={(id) => approvePending(id)}
        onReject={(id) => rejectPending(id)}
        onJump={(p) => {
          if (p.seat_floor_id) {
            const f = floors.find((fl) => fl.id === p.seat_floor_id);
            if (f) switchFloor(f);
          }
          setPendingSheetOpen(false);
        }}
      />

      {/* Floor manager */}
      <FloorManagerDialog
        open={floorMgrOpen}
        onOpenChange={setFloorMgrOpen}
        editable={editable}
        onChanged={async (officeIdToSelect, floorIdToSelect) => {
          const officesRes = await api.get("/seating/offices/");
          const od = officesRes.data.results || officesRes.data;
          setOffices(od);
          const off = od.find((o: any) => o.id === officeIdToSelect) || od[0];
          if (off) {
            setSelectedOffice(off);
            const fr = await api.get(`/seating/offices/${off.id}/floors/`);
            setFloors(fr.data);
            const fl = fr.data.find((f: any) => f.id === floorIdToSelect) || fr.data[0];
            if (fl) loadFloor(fl);
            else { setSelectedFloor(null); setObjects([]); }
          }
        }}
      />
    </div>
  );
}

// ───────────── small bits ─────────────

function Stat({ label, value, tone }: { label: string; value: number; tone?: "blue" | "emerald" }) {
  const c = tone === "blue" ? "text-blue-600" : tone === "emerald" ? "text-emerald-600" : "text-neutral-800 dark:text-neutral-100";
  return (
    <div className="text-center px-3 border-l first:border-l-0">
      <div className="text-[10px] text-neutral-500 uppercase">{label}</div>
      <div className={`font-bold text-base ${c}`}>{value}</div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm" style={{ background: color }} /> {label}
    </span>
  );
}

