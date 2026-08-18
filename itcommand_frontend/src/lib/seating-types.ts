/* Shared types + element catalog for the Seating / Floor Designer. */

export type ElementType =
  | "WORKSTATION"
  | "CABIN"
  | "HOT_DESK"
  | "MEETING_ROOM"
  | "DESK"
  | "CHAIR"
  | "TABLE"
  | "WALL"
  | "DOOR"
  | "PLANT"
  | "ROOM"
  | "TEXT"
  | "CAFE"
  | "RECEPTION"
  | "PRINTER"
  | "WHITEBOARD";

export type ElementGroup = "Seats" | "Furniture" | "Structure" | "Amenities";

export interface ElementDef {
  type: ElementType;
  label: string;
  group: ElementGroup;
  w: number; // default footprint width (px)
  h: number; // default footprint depth (px)
  color: string; // default fill (hex)
  height3d: number; // extruded height for the 3D view (px)
  assignable: boolean; // gets a linked Seat so people can be placed on it
}

/** Pixels per floor grid-unit. Floor.width_units * CELL = canvas width. */
export const CELL = 40;

export const ELEMENTS: Record<ElementType, ElementDef> = {
  WORKSTATION:  { type: "WORKSTATION",  label: "Workstation",  group: "Seats",     w: 84,  h: 64,  color: "#3b82f6", height3d: 30,  assignable: true },
  CABIN:        { type: "CABIN",        label: "Cabin",        group: "Seats",     w: 124, h: 104, color: "#6366f1", height3d: 36,  assignable: true },
  HOT_DESK:     { type: "HOT_DESK",     label: "Hot Desk",     group: "Seats",     w: 72,  h: 56,  color: "#14b8a6", height3d: 28,  assignable: true },
  MEETING_ROOM: { type: "MEETING_ROOM", label: "Meeting Room", group: "Seats",     w: 200, h: 144, color: "#64748b", height3d: 10,  assignable: true },
  DESK:         { type: "DESK",         label: "Desk",         group: "Furniture", w: 96,  h: 52,  color: "#d97706", height3d: 30,  assignable: false },
  CHAIR:        { type: "CHAIR",        label: "Chair",        group: "Furniture", w: 38,  h: 38,  color: "#9ca3af", height3d: 42,  assignable: false },
  TABLE:        { type: "TABLE",        label: "Table",        group: "Furniture", w: 120, h: 72,  color: "#f59e0b", height3d: 28,  assignable: false },
  PLANT:        { type: "PLANT",        label: "Plant",        group: "Furniture", w: 40,  h: 40,  color: "#16a34a", height3d: 72,  assignable: false },
  WALL:         { type: "WALL",         label: "Wall",         group: "Structure", w: 240, h: 16,  color: "#475569", height3d: 120, assignable: false },
  DOOR:         { type: "DOOR",         label: "Door",         group: "Structure", w: 52,  h: 16,  color: "#92400e", height3d: 108, assignable: false },
  ROOM:         { type: "ROOM",         label: "Room Area",    group: "Structure", w: 260, h: 200, color: "#e2e8f0", height3d: 4,   assignable: true  },
  TEXT:         { type: "TEXT",         label: "Text Label",   group: "Structure", w: 140, h: 32,  color: "#1e293b", height3d: 2,   assignable: false },
  CAFE:         { type: "CAFE",         label: "Cafe / Pantry", group: "Amenities", w: 240, h: 170, color: "#f97316", height3d: 6,   assignable: false },
  RECEPTION:    { type: "RECEPTION",    label: "Reception",    group: "Amenities", w: 170, h: 76,  color: "#0ea5e9", height3d: 44,  assignable: true  },
  PRINTER:      { type: "PRINTER",      label: "Printer",      group: "Amenities", w: 54,  h: 48,  color: "#6b7280", height3d: 84,  assignable: false },
  WHITEBOARD:   { type: "WHITEBOARD",   label: "Whiteboard",   group: "Amenities", w: 140, h: 18,  color: "#f1f5f9", height3d: 128, assignable: false },
};

export const ELEMENT_LIST: ElementDef[] = Object.values(ELEMENTS);

/** Element types that can be assigned to a person. */
export const ASSIGNABLE_TYPES = new Set<ElementType>([
  "WORKSTATION", "CABIN", "HOT_DESK", "MEETING_ROOM", "DESK", "ROOM",
  "CHAIR", "RECEPTION",
]);

/** A canvas object as held in editor state. */
export interface FloorObject {
  cid: string;          // stable client id (for React keys, never sent)
  id: number | null;    // server id (null = not yet persisted)
  object_type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;     // degrees
  elevation: number;    // px off the floor (3D)
  z_index: number;
  locked: boolean;
  label: string;
  color: string;        // hex; "" => element default
  style: Record<string, unknown>;
  // read-only, from the server
  seat: number | null;
  seat_code: string | null;
  is_occupied: boolean;
  current_assignment: any | null;
}

let cidCounter = 0;
export function newCid(): string {
  cidCounter += 1;
  return `c${Date.now().toString(36)}_${cidCounter}`;
}

/** Map a raw server FloorMapObject into editor state. */
export function fromServer(raw: any): FloorObject {
  return {
    cid: newCid(),
    id: raw.id ?? null,
    object_type: (raw.object_type === "SEAT" ? "WORKSTATION" : raw.object_type) as ElementType,
    x: raw.x ?? 0,
    y: raw.y ?? 0,
    width: raw.width ?? 80,
    height: raw.height ?? 60,
    rotation: raw.rotation ?? 0,
    elevation: raw.elevation ?? 0,
    z_index: raw.z_index ?? 0,
    locked: !!raw.locked,
    label: raw.label ?? "",
    color: raw.color ?? "",
    style: raw.style ?? {},
    seat: raw.seat ?? null,
    seat_code: raw.seat_code ?? null,
    is_occupied: !!raw.is_occupied,
    current_assignment: raw.current_assignment ?? null,
  };
}

/** Build the payload object for save_layout. */
export function toServer(o: FloorObject) {
  return {
    id: o.id && o.id > 0 ? o.id : undefined,
    object_type: o.object_type,
    x: o.x, y: o.y, width: o.width, height: o.height,
    rotation: o.rotation, elevation: o.elevation, z_index: o.z_index,
    locked: o.locked, label: o.label, color: o.color, style: o.style,
    seat_code: o.seat_code || undefined,
  };
}

/** Create a fresh object of a type at a given top-left position. */
export function makeObject(type: ElementType, x: number, y: number, z: number): FloorObject {
  const def = ELEMENTS[type];
  return {
    cid: newCid(),
    id: null,
    object_type: type,
    x: Math.round(x),
    y: Math.round(y),
    width: def.w,
    height: def.h,
    rotation: 0,
    elevation: 0,
    z_index: z,
    locked: false,
    label: type === "TEXT" ? "Label" : "",
    color: "",
    style: {},
    seat: null,
    seat_code: null,
    is_occupied: false,
    current_assignment: null,
  };
}

export function effectiveColor(o: FloorObject): string {
  return o.color || ELEMENTS[o.object_type].color;
}

/* ───────────── Clusters: ready-made multi-object layouts ───────────── */

export interface ClusterDef {
  id: string;
  label: string;
  perSide: number; // chairs per long side
}

export const CLUSTERS: ClusterDef[] = [
  { id: "bench10", label: "Bench Desk · 10 seats", perSide: 5 },
  { id: "bench6",  label: "Bench Desk · 6 seats",  perSide: 3 },
  { id: "bench4",  label: "Bench Desk · 4 seats",  perSide: 2 },
];

/**
 * Build a bench-desk cluster: one long shared table with chairs on both
 * long sides. Each chair is an independent, assignable seat.
 */
export function makeCluster(id: string, x: number, y: number, startZ: number): FloorObject[] {
  const def = CLUSTERS.find((c) => c.id === id);
  if (!def) return [];
  const per = def.perSide;
  const seatPitch = 84;
  const chairW = 46, chairH = 46;
  const tableW = per * seatPitch;
  const tableH = 104;
  const gap = 8;

  const objs: FloorObject[] = [];
  let z = startZ;

  const table = makeObject("TABLE", Math.round(x), Math.round(y + chairH + gap), z++);
  table.width = tableW;
  table.height = tableH;
  table.label = def.label;
  // Tag it as a bench desk so the 3D view renders a computer at every seat.
  table.style = { bench: true, perSide: per };
  objs.push(table);

  const topY = y;
  const botY = y + chairH + gap + tableH + gap;

  for (let i = 0; i < per; i++) {
    const cx = Math.round(x + seatPitch * i + (seatPitch - chairW) / 2);
    const top = makeObject("CHAIR", cx, Math.round(topY), z++);
    top.width = chairW; top.height = chairH; top.rotation = 0;
    objs.push(top);
    const bot = makeObject("CHAIR", cx, Math.round(botY), z++);
    bot.width = chairW; bot.height = chairH; bot.rotation = 180;
    objs.push(bot);
  }
  return objs;
}

/* ───────────────────── structure heights ───────────────────── */

/** Types whose wall height can be set per object, in floor grid units. */
export const WALL_HEIGHT_TYPES = new Set<ElementType>(["WALL", "ROOM"]);

/** Shortest and tallest a wall may be set to, in grid units. */
export const MIN_WALL_HEIGHT = 0.4;
export const MAX_WALL_HEIGHT = 12;

/**
 * How tall this object's walls should stand, in grid units.
 *
 * Stored on `style` rather than as its own column: it is one number on two of
 * seventeen element types, and `style` is already the persisted home for
 * per-type settings like a table's bench layout.
 *
 * Falls back to the floor's own wall height, so a room added to a 4-unit floor
 * matches it without anybody setting anything.
 */
export function wallHeightOf(obj: FloorObject, floorWallHeight: number): number {
  const raw = obj.style?.wallHeight;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return Math.max(MIN_WALL_HEIGHT, floorWallHeight || 2.7);
  }
  return Math.min(MAX_WALL_HEIGHT, Math.max(MIN_WALL_HEIGHT, value));
}
