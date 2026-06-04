"use client";

import {
  Armchair, Box, Coffee, ConciergeBell, DoorOpen, LayoutPanelTop, Monitor,
  Presentation, Printer, Rows3, Sprout, Square, Table2, Type as TypeIcon,
  Users, RectangleHorizontal,
} from "lucide-react";
import {
  CLUSTERS, ELEMENT_LIST, ElementDef, ElementGroup, ElementType,
} from "@/lib/seating-types";

const ICONS: Record<ElementType, React.ComponentType<{ className?: string }>> = {
  WORKSTATION: Monitor,
  CABIN: LayoutPanelTop,
  HOT_DESK: Armchair,
  MEETING_ROOM: Users,
  DESK: Table2,
  CHAIR: Armchair,
  TABLE: Table2,
  WALL: RectangleHorizontal,
  DOOR: DoorOpen,
  PLANT: Sprout,
  ROOM: Square,
  TEXT: TypeIcon,
  CAFE: Coffee,
  RECEPTION: ConciergeBell,
  PRINTER: Printer,
  WHITEBOARD: Presentation,
};

const GROUPS: ElementGroup[] = ["Seats", "Furniture", "Structure", "Amenities"];

export function ElementPalette({
  onAdd,
  onAddCluster,
  disabled,
}: {
  onAdd: (type: ElementType) => void;
  onAddCluster: (clusterId: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="w-48 shrink-0 border-r bg-neutral-50 dark:bg-neutral-950 overflow-y-auto">
      <div className="p-3 border-b">
        <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 flex items-center gap-1.5">
          <Box className="w-3.5 h-3.5" /> Elements
        </div>
        <p className="text-[11px] text-neutral-400 mt-0.5">Drag onto the floor or click to add.</p>
      </div>

      {/* Clusters */}
      <div className="p-2 border-b">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 px-1 mb-1">
          Quick Clusters
        </div>
        <div className="flex flex-col gap-1.5">
          {CLUSTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onAddCluster(c.id)}
              title={`Add ${c.label}`}
              className="flex items-center gap-2 rounded-md border bg-white dark:bg-neutral-900 p-2
                         hover:border-violet-400 hover:shadow-sm active:scale-95 transition-all
                         disabled:opacity-40 disabled:cursor-not-allowed text-left"
            >
              <span className="w-7 h-7 rounded flex items-center justify-center bg-violet-100 text-violet-600 shrink-0">
                <Rows3 className="w-4 h-4" />
              </span>
              <span className="text-[10px] text-neutral-600 dark:text-neutral-300 leading-tight">
                {c.label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {GROUPS.map((group) => (
        <div key={group} className="p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400 px-1 mb-1">
            {group}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {ELEMENT_LIST.filter((e) => e.group === group).map((e) => (
              <PaletteItem key={e.type} def={e} onAdd={onAdd} disabled={disabled} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PaletteItem({
  def,
  onAdd,
  disabled,
}: {
  def: ElementDef;
  onAdd: (t: ElementType) => void;
  disabled?: boolean;
}) {
  const Icon = ICONS[def.type];
  return (
    <button
      type="button"
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-floor-element", def.type);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => !disabled && onAdd(def.type)}
      disabled={disabled}
      title={`Add ${def.label}`}
      className="flex flex-col items-center gap-1 rounded-md border bg-white dark:bg-neutral-900 p-2
                 hover:border-violet-400 hover:shadow-sm active:scale-95 transition-all
                 disabled:opacity-40 disabled:cursor-not-allowed cursor-grab"
    >
      <span
        className="w-7 h-7 rounded flex items-center justify-center"
        style={{ background: `${def.color}22`, color: def.color }}
      >
        <Icon className="w-4 h-4" />
      </span>
      <span className="text-[10px] text-neutral-600 dark:text-neutral-300 leading-tight text-center">
        {def.label}
      </span>
    </button>
  );
}
