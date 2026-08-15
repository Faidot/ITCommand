"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, Html } from "@react-three/drei";
import { Footprints, Move3d } from "lucide-react";

import { ELEMENTS, FloorObject, effectiveColor } from "@/lib/seating-types";
import { Furniture } from "@/components/seating/furniture-3d";
import { SeatTooltip } from "@/components/seating/seat-tooltip";
import {
  DoorLeaf, EYE_HEIGHT, NO_ROOM_OPENINGS, Opening, PerimeterWalls, RoomOpenings,
  RoomShell, SCALE, WallRun, isWallVertical, openingsForRoom, openingsForWall,
} from "@/components/seating/architecture-3d";
import { NavMode, PlanControls, WalkControls } from "@/components/seating/nav-3d";

/** Types this file draws itself, because they need to know about each other. */
const ARCHITECTURE = new Set(["WALL", "DOOR", "ROOM"]);

/** Shared, so a wall with no doors keeps the same array identity every render. */
const NO_OPENINGS: Opening[] = [];

/** How close you have to stand to open a door with E. */
const DOOR_REACH = 2.6;

export function FloorCanvas3D({
  objects,
  width,
  height,
  wallHeightUnits = 3,
  selectedCids,
  pendingSeatIds,
  onSelect,
  onOpenObject,
  onOpenAsset,
  onOpenAllAssets,
}: {
  objects: FloorObject[];
  width: number;
  height: number;
  wallHeightUnits?: number;
  selectedCids: string[];
  pendingSeatIds?: number[];
  onSelect: (cid: string | null) => void;
  onOpenObject: (obj: FloorObject) => void;
  onOpenAsset?: (assetId: number) => void;
  onOpenAllAssets?: (userId: number) => void;
}) {
  const pendingSet = useMemo(() => new Set(pendingSeatIds || []), [pendingSeatIds]);
  const fw = width / SCALE;
  const fh = height / SCALE;
  const span = Math.max(fw, fh);
  const wallH = Math.max(0, wallHeightUnits || 0);

  const [mode, setMode] = useState<NavMode>("plan");
  //: Doors are opened by clicking them. Kept here rather than on the record —
  //: which door is standing open is how you are looking at the floor right
  //: now, not a fact about the building worth saving for everyone.
  const [openDoors, setOpenDoors] = useState<Set<string>>(new Set());
  const toggleDoor = useCallback((cid: string) => {
    setOpenDoors((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid); else next.add(cid);
      return next;
    });
  }, []);

  //: Every door on the floor, so walls and rooms can knock openings in
  //: themselves. Recomputed only when the objects change.
  const { doors, wallOpenings, roomOpenings } = useMemo(() => {
    const allDoors = objects.filter((o) => o.object_type === "DOOR");
    const walls = new Map<string, Opening[]>();
    const rooms = new Map<string, RoomOpenings>();
    for (const o of objects) {
      if (o.object_type === "WALL") walls.set(o.cid, openingsForWall(o, allDoors));
      else if (o.object_type === "ROOM") rooms.set(o.cid, openingsForRoom(o, allDoors));
    }
    return { doors: allDoors, wallOpenings: walls, roomOpenings: rooms };
  }, [objects]);

  const walking = mode === "walk";

  return (
    <div className="relative flex-1 bg-gradient-to-b from-sky-100 to-slate-300 dark:from-slate-800 dark:to-slate-950">
      <NavToolbar mode={mode} onChange={setMode} />

      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [span * 0.45, span * 0.85, fh * 0.9 + 3], fov: 55 }}
        onPointerMissed={() => onSelect(null)}
      >
        <ambientLight intensity={0.75} />
        <hemisphereLight args={["#ffffff", "#7c869b", 0.5]} />
        <directionalLight
          position={[fw, span * 1.8, fh]}
          intensity={1.15}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-span}
          shadow-camera-right={span}
          shadow-camera-top={span}
          shadow-camera-bottom={-span}
        />

        <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[fw, fh]} />
          <meshStandardMaterial color="#eef2f7" roughness={0.95} />
        </mesh>

        {/* Solid, and cut away from whichever side you are looking from. */}
        <PerimeterWalls fw={fw} fh={fh} h={wallH} cutaway={!walking} />

        {/* A construction grid is a plan-view aid; standing in the room it is
            just a pattern painted on the carpet. */}
        {!walking && (
          <Grid
            position={[0, 0.003, 0]}
            args={[fw, fh]}
            cellSize={1}
            cellThickness={0.6}
            cellColor="#cbd5e1"
            sectionSize={5}
            sectionThickness={1}
            sectionColor="#94a3b8"
            fadeDistance={span * 5}
            infiniteGrid={false}
          />
        )}

        {objects.map((o) => (
          <Object3D
            key={o.cid}
            obj={o}
            floorW={fw}
            floorH={fh}
            wallH={wallH}
            walking={walking}
            doorOpen={openDoors.has(o.cid)}
            onToggleDoor={() => toggleDoor(o.cid)}
            wallOpenings={wallOpenings.get(o.cid)}
            roomOpenings={roomOpenings.get(o.cid)}
            selected={selectedCids.includes(o.cid)}
            pending={!!(o.seat && pendingSet.has(o.seat))}
            onSelect={() => onSelect(o.cid)}
            onOpen={() => onOpenObject(o)}
            onOpenAsset={onOpenAsset}
            onOpenAllAssets={onOpenAllAssets}
          />
        ))}

        {walking ? (
          <>
            <DropToEyeLevel />
            <DoorReach
              doors={doors}
              floorW={fw}
              floorH={fh}
              onToggle={toggleDoor}
            />
            <WalkControls bounds={{ w: fw, h: fh }} onExit={() => setMode("plan")} />
          </>
        ) : (
          <PlanControls maxDistance={span * 4} />
        )}
      </Canvas>

      {walking && <WalkHint />}
    </div>
  );
}

/**
 * Put the camera on the floor when walk mode starts.
 *
 * Entering from a bird's-eye orbit otherwise leaves you looking at the room
 * from thirty metres up while WASD slides you around at that altitude.
 */
function DropToEyeLevel() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.y = EYE_HEIGHT;
    camera.lookAt(0, EYE_HEIGHT, 0);
    // Mount only: after this the walk controls own the camera, and re-running
    // would yank it back to the middle of the room mid-stride.
  }, [camera]);
  return null;
}

/**
 * Open the door you are standing at, with E.
 *
 * Nearest-door rather than what the crosshair is on: aiming at a door handle
 * while walking is a game-controls problem nobody asked to have, and standing
 * in a doorway is unambiguous about which door you mean.
 */
function DoorReach({
  doors,
  floorW,
  floorH,
  onToggle,
}: {
  doors: FloorObject[];
  floorW: number;
  floorH: number;
  onToggle: (cid: string) => void;
}) {
  const { camera } = useThree();
  const positions = useMemo(
    () =>
      doors.map((door) => ({
        cid: door.cid,
        x: (door.x + door.width / 2) / SCALE - floorW / 2,
        z: (door.y + door.height / 2) / SCALE - floorH / 2,
      })),
    [doors, floorW, floorH],
  );
  const latest = useRef(positions);
  latest.current = positions;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyE") return;
      let nearest: string | null = null;
      let best = DOOR_REACH;
      for (const door of latest.current) {
        const distance = Math.hypot(
          camera.position.x - door.x,
          camera.position.z - door.z,
        );
        if (distance < best) { best = distance; nearest = door.cid; }
      }
      if (nearest) onToggle(nearest);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [camera, onToggle]);

  return null;
}

function NavToolbar({
  mode,
  onChange,
}: {
  mode: NavMode;
  onChange: (mode: NavMode) => void;
}) {
  return (
    <div className="absolute left-3 top-3 z-10 flex overflow-hidden rounded-lg border bg-background/95 shadow-sm backdrop-blur">
      {([
        { key: "plan" as const, icon: Move3d, label: "Plan" },
        { key: "walk" as const, icon: Footprints, label: "Walk" },
      ]).map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          }`}
          title={
            key === "plan"
              ? "Drag to pan, right-drag to orbit, scroll to zoom"
              : "Walk the floor with W A S D and the mouse"
          }
        >
          <Icon className="h-3.5 w-3.5" /> {label}
        </button>
      ))}
    </div>
  );
}

function WalkHint() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <div className="rounded-full bg-black/70 px-4 py-1.5 text-xs text-white shadow-lg">
        Click to look around · <kbd className="font-semibold">W A S D</kbd> to move ·{" "}
        <kbd className="font-semibold">Shift</kbd> to hurry ·{" "}
        <kbd className="font-semibold">E</kbd> at a door ·{" "}
        <kbd className="font-semibold">Esc</kbd> to stop
      </div>
    </div>
  );
}

function Object3D({
  obj,
  floorW,
  floorH,
  wallH,
  walking,
  doorOpen,
  onToggleDoor,
  wallOpenings,
  roomOpenings,
  selected,
  pending,
  onSelect,
  onOpen,
  onOpenAsset,
  onOpenAllAssets,
}: {
  obj: FloorObject;
  floorW: number;
  floorH: number;
  wallH: number;
  walking: boolean;
  doorOpen: boolean;
  onToggleDoor: () => void;
  wallOpenings?: Opening[];
  roomOpenings?: RoomOpenings;
  selected: boolean;
  pending: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onOpenAsset?: (assetId: number) => void;
  onOpenAllAssets?: (userId: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelHide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  }, []);
  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => setHovered(false), 220);
  }, [cancelHide]);

  const def = ELEMENTS[obj.object_type];
  const w = obj.width / SCALE;
  const d = obj.height / SCALE;
  const elev = obj.elevation / SCALE;
  const color = effectiveColor(obj);

  // 2D top-left → 3D centre. 2D y grows downward → 3D +Z.
  const cx = (obj.x + obj.width / 2) / SCALE - floorW / 2;
  const cz = (obj.y + obj.height / 2) / SCALE - floorH / 2;
  const rotY = (-obj.rotation * Math.PI) / 180;
  const isText = obj.object_type === "TEXT";
  const isDoor = obj.object_type === "DOOR";

  // Interior walls take the floor's wall height rather than a hardcoded one,
  // so a wall drawn on the plan reaches the ceiling like the perimeter does.
  const structureH = Math.max(wallH || 0, 2.4);

  const body = ARCHITECTURE.has(obj.object_type) ? (
    obj.object_type === "WALL" ? (
      // A wall drawn tall-and-thin runs along Z, so it is turned a quarter
      // turn and fed its long side as the length. WallRun then only ever has
      // to cut openings along one axis.
      <group rotation-y={isWallVertical(obj) ? -Math.PI / 2 : 0}>
        <WallRun
          w={isWallVertical(obj) ? d : w}
          d={isWallVertical(obj) ? w : d}
          h={structureH}
          color={color}
          openings={wallOpenings ?? NO_OPENINGS}
        />
      </group>
    ) : obj.object_type === "ROOM" ? (
      <RoomShell
        w={w} d={d} h={structureH} color={color}
        openings={roomOpenings ?? NO_ROOM_OPENINGS}
        cutaway={!walking}
      />
    ) : (
      <DoorLeaf w={w} d={d} h={structureH} color={color} open={doorOpen} />
    )
  ) : (
    <Furniture
      type={obj.object_type}
      w={w} d={d} color={color}
      occupied={obj.is_occupied}
      style={obj.style}
    />
  );

  return (
    <group position={[cx, elev, cz]} rotation-y={rotY}>
      <group
        onClick={(e) => {
          e.stopPropagation();
          // A door's click opens it. Selecting a door does nothing useful in
          // 3D, and opening it is the thing anybody clicking a door wants.
          if (isDoor) onToggleDoor();
          else onSelect();
        }}
        onDoubleClick={(e) => { e.stopPropagation(); if (!isDoor) onOpen(); }}
        onPointerOver={(e) => { e.stopPropagation(); cancelHide(); setHovered(true); }}
        onPointerOut={(e) => { e.stopPropagation(); scheduleHide(); }}
      >
        {body}
        {/* invisible hit area so thin/empty elements are still clickable */}
        <mesh position={[0, Math.max(def.height3d, 12) / SCALE / 2, 0]}>
          <boxGeometry args={[Math.max(w, 0.3), Math.max(def.height3d, 12) / SCALE, Math.max(d, 0.3)]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>

      {isDoor && hovered && !walking && (
        <Html position={[0, 2.3, 0]} center distanceFactor={11} style={{ pointerEvents: "none" }}>
          <div className="whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">
            Click to {doorOpen ? "close" : "open"}
          </div>
        </Html>
      )}

      {pending && (
        <mesh position={[0, (Math.max(def.height3d, 30) / SCALE) + elev + 0.55, 0]}>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.6} />
        </mesh>
      )}

      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
          <ringGeometry args={[Math.max(w, d) * 0.52, Math.max(w, d) * 0.52 + 0.12, 48]} />
          <meshBasicMaterial color="#7c3aed" transparent opacity={0.9} />
        </mesh>
      )}

      {hovered && obj.is_occupied && obj.current_assignment && (
        <Html
          position={[0, (Math.max(def.height3d, 30) / SCALE) + elev + 0.85, 0]}
          center
          distanceFactor={9}
          zIndexRange={[100, 0]}
          style={{ pointerEvents: "auto" }}
        >
          <SeatTooltip
            assignment={obj.current_assignment}
            seatCode={obj.seat_code}
            onPointerEnter={cancelHide}
            onPointerLeave={scheduleHide}
            onOpenAsset={onOpenAsset}
            onOpenAllAssets={
              obj.current_assignment?.user && onOpenAllAssets
                ? () => onOpenAllAssets(obj.current_assignment.user)
                : undefined
            }
          />
        </Html>
      )}

      {(obj.is_occupied || isText || selected) && (
        <Html
          position={[0, (Math.max(def.height3d, 30) / SCALE) + elev + 0.4, 0]}
          center
          distanceFactor={11}
          occlude={false}
          style={{ pointerEvents: "none" }}
        >
          <div
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap shadow"
            style={{
              background: selected ? "#7c3aed" : "rgba(255,255,255,.94)",
              color: selected ? "#fff" : "#1e293b",
            }}
          >
            {isText
              ? obj.label || "Label"
              : obj.is_occupied && obj.current_assignment
              ? obj.current_assignment.user_name
              : obj.label || obj.seat_code || def.label}
          </div>
        </Html>
      )}
    </group>
  );
}
