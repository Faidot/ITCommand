"use client";

import { useCallback, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Html } from "@react-three/drei";
import { ELEMENTS, FloorObject, effectiveColor } from "@/lib/seating-types";
import { Furniture } from "@/components/seating/furniture-3d";
import { SeatTooltip } from "@/components/seating/seat-tooltip";

const SCALE = 40; // px per 3D unit

export function FloorCanvas3D({
  objects,
  width,
  height,
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
  selectedCids: string[];
  pendingSeatIds?: number[];
  onSelect: (cid: string | null) => void;
  onOpenObject: (obj: FloorObject) => void;
  onOpenAsset?: (assetId: number) => void;
  onOpenAllAssets?: (userId: number) => void;
}) {
  const pendingSet = new Set(pendingSeatIds || []);
  const fw = width / SCALE;
  const fh = height / SCALE;
  const span = Math.max(fw, fh);

  return (
    <div className="flex-1 bg-gradient-to-b from-sky-100 to-slate-300 dark:from-slate-800 dark:to-slate-950">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [span * 0.45, span * 0.85, fh * 0.9 + 3], fov: 50 }}
        onPointerMissed={() => onSelect(null)}
      >
        <ambientLight intensity={0.8} />
        <hemisphereLight args={["#ffffff", "#7c869b", 0.55]} />
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

        {/* Floor slab */}
        <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[fw, fh]} />
          <meshStandardMaterial color="#eef2f7" roughness={0.95} />
        </mesh>
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

        {objects.map((o) => (
          <Object3D
            key={o.cid}
            obj={o}
            floorW={fw}
            floorH={fh}
            selected={selectedCids.includes(o.cid)}
            pending={!!(o.seat && pendingSet.has(o.seat))}
            onSelect={() => onSelect(o.cid)}
            onOpen={() => onOpenObject(o)}
            onOpenAsset={onOpenAsset}
            onOpenAllAssets={onOpenAllAssets}
          />
        ))}

        <OrbitControls
          makeDefault
          enableDamping
          target={[0, 0, 0]}
          minDistance={2}
          maxDistance={span * 4}
          maxPolarAngle={Math.PI / 2.05}
        />
      </Canvas>
    </div>
  );
}

function Object3D({
  obj,
  floorW,
  floorH,
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

  return (
    <group position={[cx, elev, cz]} rotation-y={rotY}>
      {/* clickable group */}
      <group
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onDoubleClick={(e) => { e.stopPropagation(); onOpen(); }}
        onPointerOver={(e) => { e.stopPropagation(); cancelHide(); setHovered(true); }}
        onPointerOut={(e) => { e.stopPropagation(); scheduleHide(); }}
      >
        <Furniture
          type={obj.object_type}
          w={w} d={d} color={color}
          occupied={obj.is_occupied}
          style={obj.style}
        />
        {/* invisible hit area so thin/empty elements are still clickable */}
        <mesh position={[0, Math.max(def.height3d, 12) / SCALE / 2, 0]}>
          <boxGeometry args={[Math.max(w, 0.3), Math.max(def.height3d, 12) / SCALE, Math.max(d, 0.3)]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>

      {/* pending change marker — small amber ball above */}
      {pending && (
        <mesh position={[0, (Math.max(def.height3d, 30) / SCALE) + elev + 0.55, 0]}>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.6} />
        </mesh>
      )}

      {/* selection ring on the floor */}
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]}>
          <ringGeometry args={[Math.max(w, d) * 0.52, Math.max(w, d) * 0.52 + 0.12, 48]} />
          <meshBasicMaterial color="#7c3aed" transparent opacity={0.9} />
        </mesh>
      )}

      {/* rich hover tooltip with user details + assets */}
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

      {/* label / occupant tag */}
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
