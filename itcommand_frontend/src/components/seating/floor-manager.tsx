"use client";

import { useCallback, useEffect, useState } from "react";
import { Building, Grid3x3, Layers, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { CELL } from "@/lib/seating-types";

interface Office { id: number; name: string; address?: string; }
interface Floor {
  id: number; office: number; floor_name: string; floor_number: number;
  width_units: number; height_units: number; wall_height_units: number;
}

/**
 * Self-contained Offices + Floors manager. Used both inside Master Settings
 * (as a panel) and on the Seating page (wrapped in a dialog).
 */
export function FloorManagerPanel({
  editable,
  active = true,
  onChanged,
}: {
  editable: boolean;
  active?: boolean;
  onChanged?: (officeId?: number, floorId?: number) => void;
}) {
  const [offices, setOffices] = useState<Office[]>([]);
  const [officeId, setOfficeId] = useState<number | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);

  const [newOffice, setNewOffice] = useState({ name: "", address: "" });
  const [newFloor, setNewFloor] = useState({
    floor_name: "", floor_number: "1", width_units: "20", height_units: "15",
    wall_height_units: "3",
  });

  const loadOffices = useCallback(async () => {
    try {
      const res = await api.get("/seating/offices/");
      const data: Office[] = res.data.results || res.data;
      setOffices(data);
      setOfficeId((cur) => cur ?? (data[0]?.id ?? null));
    } catch {
      toast.error("Failed to load offices");
    }
  }, []);

  const loadFloors = useCallback(async (oid: number) => {
    try {
      const res = await api.get(`/seating/offices/${oid}/floors/`);
      setFloors(res.data);
    } catch {
      toast.error("Failed to load floors");
    }
  }, []);

  useEffect(() => { if (active) loadOffices(); }, [active, loadOffices]);
  useEffect(() => {
    if (officeId != null) loadFloors(officeId);
    else setFloors([]);
  }, [officeId, loadFloors]);

  const createOffice = async () => {
    if (!newOffice.name.trim()) return toast.error("Office name required");
    try {
      const r = await api.post("/seating/offices/", {
        name: newOffice.name, address: newOffice.address || "", floor_count: 1,
      });
      toast.success("Office added");
      setNewOffice({ name: "", address: "" });
      await loadOffices();
      setOfficeId(r.data.id);
      onChanged?.(r.data.id);
    } catch {
      toast.error("Failed to create office");
    }
  };

  const deleteOffice = async (id: number) => {
    if (!confirm("Delete this office and all its floors / seats?")) return;
    try {
      await api.delete(`/seating/offices/${id}/`);
      toast.success("Office deleted");
      setOfficeId(null);
      await loadOffices();
      onChanged?.();
    } catch {
      toast.error("Failed to delete office");
    }
  };

  const createFloor = async () => {
    if (officeId == null) return toast.error("Select an office first");
    if (!newFloor.floor_name.trim()) return toast.error("Floor name required");
    try {
      const r = await api.post("/seating/floors/", {
        office: officeId,
        floor_name: newFloor.floor_name,
        floor_number: parseInt(newFloor.floor_number) || 1,
        width_units: Math.max(6, parseInt(newFloor.width_units) || 20),
        height_units: Math.max(6, parseInt(newFloor.height_units) || 15),
        wall_height_units: Math.max(0, parseInt(newFloor.wall_height_units) || 3),
      });
      toast.success("Floor added");
      setNewFloor({
        floor_name: "", floor_number: String(floors.length + 2),
        width_units: "20", height_units: "15", wall_height_units: "3",
      });
      await loadFloors(officeId);
      onChanged?.(officeId, r.data.id);
    } catch {
      toast.error("Failed to create floor");
    }
  };

  const updateFloorDims = async (floor: Floor, patch: Partial<Floor>) => {
    try {
      await api.patch(`/seating/floors/${floor.id}/`, patch);
      if (officeId != null) await loadFloors(officeId);
      onChanged?.(officeId ?? undefined, floor.id);
    } catch {
      toast.error("Failed to update floor");
    }
  };

  const deleteFloor = async (id: number) => {
    if (!confirm("Delete this floor and all its seats?")) return;
    try {
      await api.delete(`/seating/floors/${id}/`);
      toast.success("Floor deleted");
      if (officeId != null) await loadFloors(officeId);
      onChanged?.(officeId ?? undefined);
    } catch {
      toast.error("Failed to delete floor");
    }
  };

  if (!editable) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Only administrators can manage offices and floors.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Offices */}
      <section>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Building className="w-4 h-4" /> Office Locations
        </h3>
        <div className="space-y-1.5 mb-3">
          {offices.map((o) => (
            <div
              key={o.id}
              onClick={() => setOfficeId(o.id)}
              className={`flex items-center gap-2 rounded border p-2 text-sm cursor-pointer ${
                officeId === o.id ? "border-violet-400 bg-violet-50/50 dark:bg-violet-950/30" : ""
              }`}
            >
              <Building className="w-3.5 h-3.5 text-neutral-400" />
              <span className="font-medium flex-1">{o.name}</span>
              <span className="text-xs text-neutral-400">{o.address}</span>
              <Button
                size="icon" variant="ghost" className="h-6 w-6 text-red-500"
                onClick={(e) => { e.stopPropagation(); deleteOffice(o.id); }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
          {offices.length === 0 && <p className="text-xs text-neutral-400">No offices yet.</p>}
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input
            placeholder="Office name" value={newOffice.name}
            onChange={(e) => setNewOffice({ ...newOffice, name: e.target.value })}
            className="h-8 text-sm"
          />
          <Input
            placeholder="Address / location (optional)" value={newOffice.address}
            onChange={(e) => setNewOffice({ ...newOffice, address: e.target.value })}
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8" onClick={createOffice}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </div>
      </section>

      {/* Floors */}
      <section className="border-t pt-4">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <Grid3x3 className="w-4 h-4" /> Floors
          {officeId != null && (
            <span className="text-xs text-neutral-400 font-normal">
              — {offices.find((o) => o.id === officeId)?.name}
            </span>
          )}
        </h3>
        {officeId == null ? (
          <p className="text-xs text-neutral-400">Select an office above.</p>
        ) : (
          <>
            <div className="space-y-1.5 mb-3">
              {floors.map((f) => (
                <div key={f.id} className="flex items-center gap-2 rounded border p-2 text-sm">
                  <Layers className="w-3.5 h-3.5 text-neutral-400" />
                  <span className="font-medium flex-1">{f.floor_name}</span>
                  <label className="text-[11px] text-neutral-400">W</label>
                  <Input
                    type="number" defaultValue={f.width_units} className="h-7 w-16 text-xs"
                    onBlur={(e) => {
                      const v = Math.max(6, parseInt(e.target.value) || 20);
                      if (v !== f.width_units) updateFloorDims(f, { width_units: v });
                    }}
                  />
                  <label className="text-[11px] text-neutral-400">H</label>
                  <Input
                    type="number" defaultValue={f.height_units} className="h-7 w-16 text-xs"
                    onBlur={(e) => {
                      const v = Math.max(6, parseInt(e.target.value) || 15);
                      if (v !== f.height_units) updateFloorDims(f, { height_units: v });
                    }}
                  />
                  <label className="text-[11px] text-neutral-400" title="Wall / room height (grid units) shown in 3D">Z</label>
                  <Input
                    type="number" min={0} defaultValue={f.wall_height_units ?? 3} className="h-7 w-16 text-xs"
                    title="Wall / room height (grid units) shown in 3D — 0 for an open floor"
                    onBlur={(e) => {
                      const v = Math.max(0, parseInt(e.target.value) || 0);
                      if (v !== (f.wall_height_units ?? 3)) updateFloorDims(f, { wall_height_units: v });
                    }}
                  />
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => deleteFloor(f.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              {floors.length === 0 && <p className="text-xs text-neutral-400">No floors yet.</p>}
            </div>
            <div className="grid grid-cols-[1.4fr_.6fr_.6fr_.6fr_.6fr_auto] gap-2 items-center">
              <Input
                placeholder="Floor name" value={newFloor.floor_name}
                onChange={(e) => setNewFloor({ ...newFloor, floor_name: e.target.value })}
                className="h-8 text-sm"
              />
              <Input
                placeholder="#" type="number" value={newFloor.floor_number} title="Floor number"
                onChange={(e) => setNewFloor({ ...newFloor, floor_number: e.target.value })}
                className="h-8 text-sm"
              />
              <Input
                placeholder="W" type="number" value={newFloor.width_units} title="Width units"
                onChange={(e) => setNewFloor({ ...newFloor, width_units: e.target.value })}
                className="h-8 text-sm"
              />
              <Input
                placeholder="H" type="number" value={newFloor.height_units} title="Height units"
                onChange={(e) => setNewFloor({ ...newFloor, height_units: e.target.value })}
                className="h-8 text-sm"
              />
              <Input
                placeholder="Z" type="number" min={0} value={newFloor.wall_height_units}
                title="Wall / room height (grid units) shown in 3D"
                onChange={(e) => setNewFloor({ ...newFloor, wall_height_units: e.target.value })}
                className="h-8 text-sm"
              />
              <Button size="sm" className="h-8" onClick={createFloor}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add
              </Button>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1.5">
              W &amp; H are grid units ({CELL}px each); Z is the wall / room height shown in 3D (0 = open floor).
            </p>
          </>
        )}
      </section>
    </div>
  );
}

export function FloorManagerDialog({
  open,
  onOpenChange,
  editable,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editable: boolean;
  onChanged?: (officeId?: number, floorId?: number) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-violet-500" /> Manage Offices &amp; Floors
          </DialogTitle>
        </DialogHeader>
        <FloorManagerPanel editable={editable} active={open} onChanged={onChanged} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
