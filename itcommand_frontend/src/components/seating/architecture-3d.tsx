"use client";

/**
 * The building: walls, rooms and doors.
 *
 * These used to be drawn like furniture — a translucent box for a wall, a
 * knee-high kerb for a room — which is why an empty floor looked like it had
 * no walls at all. The perimeter was rendered at 35% opacity precisely so you
 * could see over it, and the result was that you could see *through* it.
 *
 * The fix is not "make them opaque", because then the near wall hides the room
 * behind it. It is to make them solid and hide whichever walls stand between
 * you and what you are looking at — the way an architect's cutaway model
 * works. `useCutaway` below does that in one dot product per wall per frame:
 * a wall is hidden when the camera is on its outward side. Walk *inside* the
 * building and the camera is on the inward side of every wall, so all four
 * come back and you are in a room.
 *
 * Doors are real openings, not decals. A door dropped onto a wall splits that
 * wall into segments with a gap and a lintel over it, so you can see and walk
 * through the hole. That is done by intersecting footprints here rather than
 * with CSG, which would have meant a new dependency for one effect.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { FloorObject } from "@/lib/seating-types";

/** Metres-ish per stored pixel. Matches SCALE in the canvas. */
export const SCALE = 40;

/** Head height for walk mode, and the height a door reaches. */
export const EYE_HEIGHT = 1.7;
const DOOR_HEIGHT = 2.1;

function shade(hex: string, amt: number): string {
  let h = (hex || "#888888").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h || "888888", 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  return (
    "#" +
    (((clamp((n >> 16) + amt) << 16) |
      (clamp(((n >> 8) & 255) + amt) << 8) |
      clamp((n & 255) + amt)) >>> 0)
      .toString(16)
      .padStart(6, "0")
  );
}

/**
 * Hide this mesh while the camera sits on the outward side of it.
 *
 * One dot product per frame, and it is what lets the walls be solid. From
 * outside, the walls between you and the room disappear; from inside, none of
 * them do.
 */
function useCutaway(
  ref: React.RefObject<THREE.Object3D>,
  normal: [number, number, number],
  centre: [number, number, number],
  enabled: boolean,
) {
  // Spread into the dependency list rather than passed as one: these arrive as
  // fresh array literals every render, so depending on identity would rebuild
  // both vectors on every frame for no change in value.
  const [nx, ny, nz] = normal;
  const [cx, cy, cz] = centre;
  const n = useMemo(() => new THREE.Vector3(nx, ny, nz).normalize(), [nx, ny, nz]);
  const c = useMemo(() => new THREE.Vector3(cx, cy, cz), [cx, cy, cz]);
  const scratch = useRef(new THREE.Vector3());

  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!mesh) return;
    if (!enabled) {
      mesh.visible = true;
      return;
    }
    mesh.visible = scratch.current.copy(camera.position).sub(c).dot(n) <= 0;
  });
}

function CutawayWall({
  position,
  size,
  normal,
  color,
  cutaway,
}: {
  position: [number, number, number];
  size: [number, number, number];
  normal: [number, number, number];
  color: string;
  cutaway: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useCutaway(ref, normal, position, cutaway);
  return (
    <mesh ref={ref} position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.92} metalness={0.02} />
    </mesh>
  );
}

/**
 * The outer shell of the floor. Solid, and cut away from whichever side you
 * are looking from.
 */
export function PerimeterWalls({
  fw,
  fh,
  h,
  cutaway,
}: {
  fw: number;
  fh: number;
  h: number;
  cutaway: boolean;
}) {
  if (h <= 0) return null;
  const t = 0.14;
  const y = h / 2;
  const colour = "#e7ebf1";
  const skirting = "#cbd5e1";

  const walls: {
    position: [number, number, number];
    size: [number, number, number];
    normal: [number, number, number];
  }[] = [
    { position: [0, y, -fh / 2 + t / 2], size: [fw, h, t], normal: [0, 0, -1] },
    { position: [0, y, fh / 2 - t / 2], size: [fw, h, t], normal: [0, 0, 1] },
    { position: [-fw / 2 + t / 2, y, 0], size: [t, h, fh], normal: [-1, 0, 0] },
    { position: [fw / 2 - t / 2, y, 0], size: [t, h, fh], normal: [1, 0, 0] },
  ];

  return (
    <group>
      {walls.map((wall, i) => (
        <group key={i}>
          <CutawayWall {...wall} color={colour} cutaway={cutaway} />
          {/* A skirting board reads as "this is a room" far faster than a
              flat slab does, and it stays put when the wall above is cut. */}
          <mesh
            position={[wall.position[0], 0.06, wall.position[2]]}
            receiveShadow
          >
            <boxGeometry args={[wall.size[0], 0.12, wall.size[2]]} />
            <meshStandardMaterial color={skirting} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** An opening in a wall, in the wall's own left-to-right coordinates. */
export interface Opening {
  /** Centre offset along the wall, 0 being the wall's midpoint. */
  at: number;
  width: number;
}

/**
 * Which doors sit on which wall.
 *
 * Both are rectangles the user positioned by hand, so "on" means the door's
 * centre lands inside the wall's footprint once rotated into the wall's own
 * frame. That is more forgiving than requiring an exact overlap, which is what
 * anybody dragging a door onto a wall actually produces.
 */
/**
 * Is this wall drawn as a tall thin rectangle rather than a rotated wide one?
 *
 * Both are how people draw a vertical wall, and the two produce completely
 * different local axes. Everything downstream works in "along the wall" terms,
 * so the distinction is settled once, here.
 */
export function isWallVertical(wall: FloorObject): boolean {
  return wall.height > wall.width;
}

/** A door's position in a wall's own frame: along its length, and across it. */
function toWallFrame(wall: FloorObject, door: FloorObject) {
  const dx = door.x + door.width / 2 - (wall.x + wall.width / 2);
  const dy = door.y + door.height / 2 - (wall.y + wall.height / 2);
  // The mesh is rotated by this angle, so undoing it is the plain inverse
  // rotation — not the inverse of the negated angle, which mirrors the result
  // and puts every opening at the wrong end of a rotated wall.
  const angle = (-wall.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const localX = dx * cos - dy * sin;
  const localZ = dx * sin + dy * cos;
  return isWallVertical(wall)
    ? { along: localZ, across: localX }
    : { along: localX, across: localZ };
}

export function openingsForWall(wall: FloorObject, doors: FloorObject[]): Opening[] {
  const vertical = isWallVertical(wall);
  const halfLength = (vertical ? wall.height : wall.width) / 2;
  // Generous across the wall's thickness: a door is usually a little thicker
  // than the wall it is set into, and nobody aligns them to the pixel.
  const reach = (vertical ? wall.width : wall.height) / 2 + 26;

  const found: Opening[] = [];
  for (const door of doors) {
    const { along, across } = toWallFrame(wall, door);
    if (Math.abs(across) > reach) continue;
    if (Math.abs(along) > halfLength) continue;
    const doorLength = Math.max(door.width, door.height);
    found.push({ at: along / SCALE, width: doorLength / SCALE });
  }
  return found.sort((a, b) => a.at - b.at);
}

/**
 * A wall, with the door openings knocked out of it.
 *
 * Rendered as the solid runs between openings plus a lintel over each, so the
 * gap is a hole you can see and walk through rather than a door drawn on top
 * of an unbroken wall.
 */
export function WallRun({
  w,
  d,
  h,
  color,
  openings,
}: {
  w: number;
  d: number;
  h: number;
  color: string;
  openings: Opening[];
}) {
  const thickness = Math.max(d, 0.12);
  const doorH = Math.min(DOOR_HEIGHT, h * 0.86);

  const segments = useMemo(() => {
    const runs: { from: number; to: number }[] = [];
    let cursor = -w / 2;
    for (const opening of openings) {
      const from = Math.max(-w / 2, opening.at - opening.width / 2);
      const to = Math.min(w / 2, opening.at + opening.width / 2);
      if (from > cursor) runs.push({ from: cursor, to: from });
      cursor = Math.max(cursor, to);
    }
    if (cursor < w / 2) runs.push({ from: cursor, to: w / 2 });
    return runs.filter((r) => r.to - r.from > 0.01);
  }, [w, openings]);

  return (
    <group>
      {segments.map((run, i) => (
        <mesh
          key={`s${i}`}
          position={[(run.from + run.to) / 2, h / 2, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[run.to - run.from, h, thickness]} />
          <meshStandardMaterial color={color} roughness={0.92} />
        </mesh>
      ))}
      {/* Lintel: the wall above each opening still has to be there. */}
      {openings.map((opening, i) =>
        h > doorH ? (
          <mesh
            key={`l${i}`}
            position={[opening.at, doorH + (h - doorH) / 2, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[opening.width, h - doorH, thickness]} />
            <meshStandardMaterial color={color} roughness={0.92} />
          </mesh>
        ) : null,
      )}
    </group>
  );
}

/** Openings on each side of a room, in that side's own coordinates. */
export interface RoomOpenings {
  north: Opening[];
  south: Opening[];
  west: Opening[];
  east: Opening[];
}

export const NO_ROOM_OPENINGS: RoomOpenings = {
  north: [], south: [], west: [], east: [],
};

/**
 * Work out which side of a room each door belongs to, and where along it.
 *
 * A door is assigned to the side it is nearest, then offset along that side.
 * Nearest-side rather than exact overlap for the same reason as
 * `openingsForWall`: somebody dragging a door onto a room edge lands close to
 * it, not exactly on it, and a door that produced no opening would look like a
 * bug in the wall rather than a misplaced door.
 */
export function openingsForRoom(room: FloorObject, doors: FloorObject[]): RoomOpenings {
  const rx = room.x + room.width / 2;
  const ry = room.y + room.height / 2;
  const angle = (-room.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfW = room.width / 2;
  const halfH = room.height / 2;
  //: How far off a wall a door may sit and still be taken as set into it.
  const TOLERANCE = 40;

  const result: RoomOpenings = { north: [], south: [], west: [], east: [] };

  for (const door of doors) {
    const dx = door.x + door.width / 2 - rx;
    const dy = door.y + door.height / 2 - ry;
    const localX = dx * cos - dy * sin;
    const localZ = dx * sin + dy * cos;

    // Distance to each of the four sides, in the room's own frame.
    const sides = [
      { key: "north" as const, gap: Math.abs(localZ + halfH), along: localX, span: halfW },
      { key: "south" as const, gap: Math.abs(localZ - halfH), along: localX, span: halfW },
      { key: "west" as const, gap: Math.abs(localX + halfW), along: localZ, span: halfH },
      { key: "east" as const, gap: Math.abs(localX - halfW), along: localZ, span: halfH },
    ];
    const nearest = sides.reduce((a, b) => (b.gap < a.gap ? b : a));
    if (nearest.gap > TOLERANCE) continue;          // not on this room at all
    if (Math.abs(nearest.along) > nearest.span) continue;  // past the corner

    result[nearest.key].push({
      at: nearest.along / SCALE,
      width: door.width / SCALE,
    });
  }

  for (const key of ["north", "south", "west", "east"] as const) {
    result[key].sort((a, b) => a.at - b.at);
  }
  return result;
}

/**
 * A room: a floor pad and four full-height walls, cut away like the perimeter
 * so the room does not become an opaque box when seen from outside.
 *
 * It used to be a 0.5-unit kerb, which is why rooms read as rugs rather than
 * rooms.
 */
export function RoomShell({
  w,
  d,
  h,
  color,
  openings,
  cutaway,
}: {
  w: number;
  d: number;
  h: number;
  color: string;
  openings: RoomOpenings;
  cutaway: boolean;
}) {
  const t = 0.12;
  const wallColour = shade(color, -18);

  return (
    <group>
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial color={shade(color, 26)} roughness={0.96} />
      </mesh>

      <RoomWall length={w} t={t} h={h} colour={wallColour}
        position={[0, 0, -d / 2 + t / 2]} rotation={0}
        normal={[0, 0, -1]} cutaway={cutaway} openings={openings.north} />
      <RoomWall length={w} t={t} h={h} colour={wallColour}
        position={[0, 0, d / 2 - t / 2]} rotation={0}
        normal={[0, 0, 1]} cutaway={cutaway} openings={openings.south} />
      <RoomWall length={d} t={t} h={h} colour={wallColour}
        position={[-w / 2 + t / 2, 0, 0]} rotation={Math.PI / 2}
        normal={[-1, 0, 0]} cutaway={cutaway} openings={openings.west} />
      <RoomWall length={d} t={t} h={h} colour={wallColour}
        position={[w / 2 - t / 2, 0, 0]} rotation={Math.PI / 2}
        normal={[1, 0, 0]} cutaway={cutaway} openings={openings.east} />
    </group>
  );
}

function RoomWall({
  length, t, h, colour, position, rotation, normal, cutaway, openings,
}: {
  length: number;
  t: number;
  h: number;
  colour: string;
  position: [number, number, number];
  rotation: number;
  normal: [number, number, number];
  cutaway: boolean;
  openings: Opening[];
}) {
  const ref = useRef<THREE.Group>(null);
  useCutaway(ref, normal, [position[0], h / 2, position[2]], cutaway);
  return (
    <group ref={ref} position={position} rotation-y={rotation}>
      <WallRun w={length} d={t} h={h} color={colour} openings={openings} />
    </group>
  );
}

/**
 * A door leaf that swings.
 *
 * The old one was frozen at 40° open, which is why a closed room never looked
 * closed. This one animates between shut and open on click, and the swing is
 * eased in `useFrame` rather than snapped so it reads as a door rather than a
 * state change.
 */
export function DoorLeaf({
  w,
  d,
  h,
  color,
  open,
}: {
  w: number;
  d: number;
  h: number;
  color: string;
  open: boolean;
}) {
  const leaf = useRef<THREE.Group>(null);
  const thickness = Math.max(d, 0.1);
  const doorH = Math.min(DOOR_HEIGHT, h * 0.86);
  const frame = shade(color, -18);
  const panel = shade(color, 22);
  const target = open ? -Math.PI * 0.55 : 0;

  useFrame((_, delta) => {
    const group = leaf.current;
    if (!group) return;
    // Framerate-independent easing: a fixed lerp factor would swing faster on
    // a 144Hz screen than a 60Hz one.
    const t = 1 - Math.pow(0.0015, delta);
    group.rotation.y += (target - group.rotation.y) * t;
  });

  return (
    <group>
      {/* jambs and head */}
      <mesh position={[-w / 2 + 0.04, doorH / 2, 0]} castShadow>
        <boxGeometry args={[0.08, doorH, thickness * 1.15]} />
        <meshStandardMaterial color={frame} roughness={0.8} />
      </mesh>
      <mesh position={[w / 2 - 0.04, doorH / 2, 0]} castShadow>
        <boxGeometry args={[0.08, doorH, thickness * 1.15]} />
        <meshStandardMaterial color={frame} roughness={0.8} />
      </mesh>
      <mesh position={[0, doorH - 0.04, 0]} castShadow>
        <boxGeometry args={[w, 0.08, thickness * 1.15]} />
        <meshStandardMaterial color={frame} roughness={0.8} />
      </mesh>

      {/* hinged at the left jamb */}
      <group ref={leaf} position={[-w / 2 + 0.08, 0, 0]}>
        <mesh position={[(w - 0.16) / 2, doorH / 2 - 0.05, 0]} castShadow>
          <boxGeometry args={[w - 0.16, doorH - 0.1, thickness * 0.55]} />
          <meshStandardMaterial color={panel} roughness={0.65} />
        </mesh>
        <mesh
          position={[w - 0.3, doorH * 0.47, thickness * 0.45]}
          castShadow
        >
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.25} />
        </mesh>
      </group>
    </group>
  );
}
