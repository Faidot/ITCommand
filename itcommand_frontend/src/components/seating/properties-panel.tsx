"use client";

import {
  Lock, Unlock, Trash2, Copy, UserPlus, UserMinus, MoveUp, MoveDown,
  SlidersHorizontal, Boxes,
} from "lucide-react";
import {
  ASSIGNABLE_TYPES, ELEMENTS, FloorObject, MAX_WALL_HEIGHT, MIN_WALL_HEIGHT,
  WALL_HEIGHT_TYPES, effectiveColor, wallHeightOf,
} from "@/lib/seating-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const SWATCHES = [
  "#3b82f6", "#6366f1", "#14b8a6", "#64748b", "#d97706",
  "#f59e0b", "#16a34a", "#ef4444", "#ec4899", "#0ea5e9",
];

export function PropertiesPanel({
  objs,
  onChange,
  onDelete,
  onDuplicate,
  onBringToFront,
  onSendToBack,
  onAssign,
  onVacate,
  floorWallHeight = 3,
}: {
  objs: FloorObject[];
  /** Fallback height for rooms and walls that have not overridden it. */
  floorWallHeight?: number;
  onChange: (patch: Partial<FloorObject>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onAssign: () => void;
  onVacate: () => void;
}) {
  // ── nothing selected
  if (objs.length === 0) {
    return (
      <div className="w-64 shrink-0 border-l bg-neutral-50 dark:bg-neutral-950 p-4">
        <PanelHeader />
        <p className="text-sm text-neutral-400 mt-6 text-center">
          Select an element to edit it. Drag on empty floor to box-select several.
        </p>
      </div>
    );
  }

  // ── multiple selected
  if (objs.length > 1) {
    const occupied = objs.filter((o) => o.is_occupied).length;
    return (
      <div className="w-64 shrink-0 border-l bg-neutral-50 dark:bg-neutral-950 overflow-y-auto">
        <div className="p-3 border-b flex items-center justify-between">
          <PanelHeader inline />
          <Badge variant="outline" className="text-[10px]">{objs.length} selected</Badge>
        </div>
        <div className="p-3 space-y-3">
          <div className="rounded-md border p-2.5 bg-white dark:bg-neutral-900 text-sm">
            <div className="flex items-center gap-2">
              <Boxes className="w-4 h-4 text-violet-500" />
              <span className="font-medium">{objs.length} elements</span>
            </div>
            <p className="text-[11px] text-neutral-500 mt-1">
              Drag any one of them to move the whole group. {occupied > 0 && `${occupied} occupied.`}
            </p>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-1">
              Recolor all
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ color: c })}
                  className="w-6 h-6 rounded-full border-2 border-transparent hover:scale-110 transition-transform"
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          <Button size="sm" variant="outline" className="h-8 text-xs w-full" onClick={onDuplicate}>
            <Copy className="w-3 h-3 mr-1" /> Duplicate all
          </Button>
          <Button
            size="sm" variant="outline"
            className="h-8 text-xs w-full text-red-600 border-red-200 hover:bg-red-50"
            onClick={onDelete}
          >
            <Trash2 className="w-3 h-3 mr-1" /> Delete {objs.length} elements
          </Button>
        </div>
      </div>
    );
  }

  // ── single selected
  const obj = objs[0];
  const def = ELEMENTS[obj.object_type];
  const assignable = ASSIGNABLE_TYPES.has(obj.object_type);
  const num = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className="w-64 shrink-0 border-l bg-neutral-50 dark:bg-neutral-950 overflow-y-auto">
      <div className="p-3 border-b flex items-center justify-between">
        <PanelHeader inline />
        <Badge variant="outline" className="text-[10px]">{def.label}</Badge>
      </div>

      <div className="p-3 space-y-4">
        {assignable && (
          <div className="rounded-md border p-2.5 bg-white dark:bg-neutral-900">
            <div className="text-[11px] text-neutral-500 mb-1.5">Seat status</div>
            {obj.is_occupied && obj.current_assignment ? (
              <>
                <div className="text-sm font-medium">{obj.current_assignment.user_name}</div>
                <div className="text-[11px] text-neutral-500">
                  {obj.current_assignment.user_designation || obj.current_assignment.user_department || "—"}
                </div>
                {obj.current_assignment.user_email && (
                  <div className="text-[11px] text-neutral-400 truncate">{obj.current_assignment.user_email}</div>
                )}
                <div className="flex gap-1.5 mt-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={onAssign}>
                    <UserPlus className="w-3 h-3 mr-1" /> Reassign
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs flex-1 text-red-600" onClick={onVacate}>
                    <UserMinus className="w-3 h-3 mr-1" /> Vacate
                  </Button>
                </div>
              </>
            ) : obj.id ? (
              <Button size="sm" className="h-7 text-xs w-full bg-violet-600 hover:bg-violet-700" onClick={onAssign}>
                <UserPlus className="w-3 h-3 mr-1" /> Assign person
              </Button>
            ) : (
              <p className="text-[11px] text-neutral-400">Save the layout to enable assignment.</p>
            )}
            {obj.seat_code && (
              <div className="text-[10px] text-neutral-400 mt-1.5">Seat code: {obj.seat_code}</div>
            )}
          </div>
        )}

        <Field label="Label">
          <Input value={obj.label} onChange={(e) => onChange({ label: e.target.value })} placeholder={def.label} className="h-8 text-sm" />
        </Field>

        {assignable && (
          <Field label="Seat code (optional)">
            <Input value={obj.seat_code || ""} onChange={(e) => onChange({ seat_code: e.target.value })} placeholder="auto" className="h-8 text-sm font-mono" />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="X"><Input type="number" value={Math.round(obj.x)} onChange={(e) => onChange({ x: num(e.target.value) })} className="h-8 text-sm" /></Field>
          <Field label="Y"><Input type="number" value={Math.round(obj.y)} onChange={(e) => onChange({ y: num(e.target.value) })} className="h-8 text-sm" /></Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Width"><Input type="number" value={Math.round(obj.width)} onChange={(e) => onChange({ width: Math.max(12, num(e.target.value)) })} className="h-8 text-sm" /></Field>
          <Field label="Height"><Input type="number" value={Math.round(obj.height)} onChange={(e) => onChange({ height: Math.max(12, num(e.target.value)) })} className="h-8 text-sm" /></Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Rotation°"><Input type="number" value={Math.round(obj.rotation)} onChange={(e) => onChange({ rotation: num(e.target.value) % 360 })} className="h-8 text-sm" /></Field>
          <Field label="Elevation (3D)"><Input type="number" value={Math.round(obj.elevation)} onChange={(e) => onChange({ elevation: Math.max(0, num(e.target.value)) })} className="h-8 text-sm" /></Field>
        </div>

        {WALL_HEIGHT_TYPES.has(obj.object_type) && (
          <Field label="Wall height (3D, grid units)">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.1"
                min={MIN_WALL_HEIGHT}
                max={MAX_WALL_HEIGHT}
                value={wallHeightOf(obj, floorWallHeight)}
                onChange={(e) =>
                  onChange({
                    style: {
                      ...obj.style,
                      wallHeight: Math.min(
                        MAX_WALL_HEIGHT,
                        Math.max(MIN_WALL_HEIGHT, num(e.target.value) || floorWallHeight),
                      ),
                    },
                  })
                }
                className="h-8 text-sm"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-[11px]"
                title="Match the floor's wall height"
                onClick={() => {
                  // Delete rather than write the floor's number in: the room
                  // should keep following the floor if the floor changes.
                  const next = { ...obj.style };
                  delete next.wallHeight;
                  onChange({ style: next });
                }}
              >
                Auto
              </Button>
            </div>
          </Field>
        )}

        <Field label="Color">
          <div className="flex flex-wrap gap-1.5">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ color: c })}
                className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                  effectiveColor(obj) === c ? "border-neutral-900 dark:border-white" : "border-transparent"
                }`}
                style={{ background: c }}
              />
            ))}
            <button
              type="button"
              onClick={() => onChange({ color: "" })}
              title="Reset to default"
              className="w-6 h-6 rounded-full border-2 border-dashed border-neutral-300 text-[9px] text-neutral-400"
            >
              ✕
            </button>
          </div>
        </Field>

        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={onBringToFront}>
            <MoveUp className="w-3 h-3 mr-1" /> Front
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={onSendToBack}>
            <MoveDown className="w-3 h-3 mr-1" /> Back
          </Button>
        </div>

        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={obj.locked ? "default" : "outline"}
            className="h-7 text-xs flex-1"
            onClick={() => onChange({ locked: !obj.locked })}
          >
            {obj.locked ? <Lock className="w-3 h-3 mr-1" /> : <Unlock className="w-3 h-3 mr-1" />}
            {obj.locked ? "Locked" : "Unlocked"}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onDuplicate} title="Duplicate">
            <Copy className="w-3 h-3" />
          </Button>
        </div>

        <Button size="sm" variant="outline" className="h-8 text-xs w-full text-red-600 border-red-200 hover:bg-red-50" onClick={onDelete}>
          <Trash2 className="w-3 h-3 mr-1" /> Delete element
        </Button>
      </div>
    </div>
  );
}

function PanelHeader({ inline }: { inline?: boolean }) {
  return (
    <div className={`text-xs font-semibold uppercase tracking-wide text-neutral-500 flex items-center gap-1.5 ${inline ? "" : ""}`}>
      <SlidersHorizontal className="w-3.5 h-3.5" /> Properties
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</label>
      {children}
    </div>
  );
}
