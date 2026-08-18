"use client";

import { ElementType } from "@/lib/seating-types";

/* ───────────────── helpers ───────────────── */

function shade(hex: string, amt: number): string {
  let h = (hex || "#888888").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h || "888888", 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

function Box({
  p, s, color, opacity = 1, rough = 0.7,
}: {
  p: [number, number, number];
  s: [number, number, number];
  color: string;
  opacity?: number;
  rough?: number;
}) {
  return (
    <mesh position={p} castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial
        color={color}
        roughness={rough}
        metalness={0.06}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}

function Cyl({
  p, rt, rb, h, color, segs = 16,
}: {
  p: [number, number, number];
  rt: number;
  rb: number;
  h: number;
  color: string;
  segs?: number;
}) {
  return (
    <mesh position={p} castShadow receiveShadow>
      <cylinderGeometry args={[rt, rb, h, segs]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.1} />
    </mesh>
  );
}

/* ───────────────── occupant ───────────────── */

function Person({ x = 0, z = 0 }: { x?: number; z?: number }) {
  return (
    <group position={[x, 0, z]}>
      {/* hips */}
      <mesh position={[0, 0.5, 0.04]} castShadow>
        <boxGeometry args={[0.34, 0.2, 0.3]} />
        <meshStandardMaterial color="#374151" roughness={0.8} />
      </mesh>
      {/* torso */}
      <mesh position={[0, 0.82, -0.02]} castShadow>
        <capsuleGeometry args={[0.17, 0.32, 4, 12]} />
        <meshStandardMaterial color="#4c6ef5" roughness={0.7} />
      </mesh>
      {/* head */}
      <mesh position={[0, 1.15, -0.02]} castShadow>
        <sphereGeometry args={[0.135, 18, 18]} />
        <meshStandardMaterial color="#f1c8a0" roughness={0.8} />
      </mesh>
    </group>
  );
}

/* ───────────────── primitives: chair, table, desk ───────────────── */

function Chair({ w, d, color }: { w: number; d: number; color: string }) {
  const seatY = 0.44;
  const base = Math.min(w, d) * 0.4;
  return (
    <group>
      {/* star base */}
      <Cyl p={[0, 0.05, 0]} rt={base} rb={base * 0.6} h={0.07} color="#1f2937" />
      {/* gas post */}
      <Cyl p={[0, seatY / 2 + 0.05, 0]} rt={0.045} rb={0.045} h={seatY - 0.05} color="#374151" />
      {/* seat pad */}
      <Box p={[0, seatY, 0]} s={[w * 0.74, 0.1, d * 0.72]} color={color} rough={0.85} />
      {/* backrest */}
      <Box p={[0, seatY + 0.3, -d * 0.3]} s={[w * 0.68, 0.5, 0.09]} color={shade(color, -18)} rough={0.85} />
    </group>
  );
}

function Stool({ w, d, color }: { w: number; d: number; color: string }) {
  const r = Math.min(w, d) * 0.34;
  return (
    <group>
      <Cyl p={[0, 0.04, 0]} rt={r * 0.9} rb={r} h={0.06} color="#1f2937" />
      <Cyl p={[0, 0.27, 0]} rt={0.04} rb={0.04} h={0.42} color="#374151" />
      <Cyl p={[0, 0.5, 0]} rt={r} rb={r} h={0.08} color={color} />
    </group>
  );
}

function TableTop({ w, d, color, topY = 0.7 }: { w: number; d: number; color: string; topY?: number }) {
  const legColor = shade(color, -40);
  const lx = w / 2 - 0.12;
  const lz = d / 2 - 0.12;
  return (
    <group>
      <Box p={[0, topY, 0]} s={[w, 0.07, d]} color={color} rough={0.5} />
      {[[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].map(([x, z], i) => (
        <Box key={i} p={[x, topY / 2, z]} s={[0.09, topY, 0.09]} color={legColor} />
      ))}
    </group>
  );
}

function Monitor({ z, color = "#1e293b" }: { z: number; color?: string }) {
  return (
    <group position={[0, 0.72, z]}>
      {/* stand */}
      <Box p={[0, 0.12, 0]} s={[0.22, 0.04, 0.16]} color="#475569" />
      <Box p={[0, 0.26, 0]} s={[0.06, 0.24, 0.06]} color="#475569" />
      {/* screen */}
      <Box p={[0, 0.5, 0]} s={[0.78, 0.46, 0.05]} color={color} rough={0.3} />
      <Box p={[0, 0.5, 0.03]} s={[0.72, 0.4, 0.02]} color="#3b82f6" rough={0.2} />
    </group>
  );
}

function DeskUnit({ w, d, color }: { w: number; d: number; color: string }) {
  const topY = 0.72;
  const legColor = shade(color, -45);
  return (
    <group>
      {/* surface */}
      <Box p={[0, topY, 0]} s={[w, 0.06, d]} color={color} rough={0.45} />
      {/* side panels */}
      <Box p={[-w / 2 + 0.05, topY / 2, 0]} s={[0.07, topY, d * 0.84]} color={legColor} />
      <Box p={[w / 2 - 0.05, topY / 2, 0]} s={[0.07, topY, d * 0.84]} color={legColor} />
      {/* modesty panel */}
      <Box p={[0, topY * 0.62, -d / 2 + 0.06]} s={[w * 0.9, topY * 0.5, 0.05]} color={legColor} />
      {/* monitor + keyboard */}
      <Monitor z={-d * 0.28} />
      <Box p={[0, topY + 0.05, d * 0.12]} s={[w * 0.42, 0.03, d * 0.2]} color="#1e293b" />
    </group>
  );
}

/* ───────────────── composite elements ───────────────── */

function Workstation({ w, d, color, occupied }: FurnitureProps) {
  const deskD = d * 0.56;
  const chairD = d * 0.42;
  return (
    <group>
      <group position={[0, 0, -d / 2 + deskD / 2]}>
        <DeskUnit w={w} d={deskD} color={color} />
      </group>
      <group position={[0, 0, d / 2 - chairD / 2 - 0.05]} rotation-y={Math.PI}>
        <Chair w={w * 0.62} d={chairD} color={shade(color, -30)} />
      </group>
      {occupied && <Person z={d * 0.16} />}
    </group>
  );
}

function HotDesk({ w, d, color, occupied }: FurnitureProps) {
  const deskD = d * 0.58;
  return (
    <group>
      <group position={[0, 0, -d / 2 + deskD / 2]}>
        <TableTop w={w} d={deskD} color={color} topY={0.7} />
        <Monitor z={-d * 0.18} />
      </group>
      <group position={[0, 0, d * 0.18]}>
        <Stool w={w * 0.5} d={d * 0.4} color={shade(color, -30)} />
      </group>
      {occupied && <Person z={d * 0.18} />}
    </group>
  );
}

function Cabin({ w, d, color, occupied }: FurnitureProps) {
  const panelH = 1.3;
  const panel = shade(color, 6);
  return (
    <group>
      {/* partitions: back + 2 sides */}
      <Box p={[0, panelH / 2, -d / 2 + 0.04]} s={[w, panelH, 0.08]} color={panel} />
      <Box p={[-w / 2 + 0.04, panelH / 2, 0]} s={[0.08, panelH, d]} color={panel} />
      <Box p={[w / 2 - 0.04, panelH / 2, 0]} s={[0.08, panelH, d]} color={panel} />
      {/* desk inside */}
      <group position={[0, 0, -d * 0.16]}>
        <DeskUnit w={w * 0.82} d={d * 0.42} color={shade(color, -25)} />
      </group>
      {/* chair */}
      <group position={[0, 0, d * 0.18]} rotation-y={Math.PI}>
        <Chair w={w * 0.5} d={d * 0.4} color={shade(color, -40)} />
      </group>
      {occupied && <Person z={d * 0.12} />}
    </group>
  );
}

function MeetingRoom({ w, d, color, occupied }: FurnitureProps) {
  const tableW = w * 0.56;
  const tableD = d * 0.5;
  const perSide = Math.max(2, Math.min(4, Math.round(tableW / 0.7)));
  const chairs: React.ReactNode[] = [];
  for (let i = 0; i < perSide; i++) {
    const cx = -tableW / 2 + tableW / (perSide + 1) * (i + 1);
    chairs.push(
      <group key={`n${i}`} position={[cx, 0, -tableD / 2 - d * 0.12]}>
        <Chair w={w * 0.22} d={d * 0.16} color={shade(color, -30)} />
      </group>
    );
    chairs.push(
      <group key={`s${i}`} position={[cx, 0, tableD / 2 + d * 0.12]} rotation-y={Math.PI}>
        <Chair w={w * 0.22} d={d * 0.16} color={shade(color, -30)} />
      </group>
    );
  }
  return (
    <group>
      {/* glass walls */}
      {[
        { p: [0, 0.8, -d / 2 + 0.03], s: [w, 1.6, 0.06] },
        { p: [0, 0.8, d / 2 - 0.03], s: [w, 1.6, 0.06] },
        { p: [-w / 2 + 0.03, 0.8, 0], s: [0.06, 1.6, d] },
        { p: [w / 2 - 0.03, 0.8, 0], s: [0.06, 1.6, d] },
      ].map((g, i) => (
        <Box key={i} p={g.p as [number, number, number]} s={g.s as [number, number, number]}
          color="#bae6fd" opacity={0.22} rough={0.1} />
      ))}
      <TableTop w={tableW} d={tableD} color={color} topY={0.72} />
      {chairs}
      {occupied && <Person z={0} />}
    </group>
  );
}

function Desk({ w, d, color, occupied }: FurnitureProps) {
  return (
    <group>
      <DeskUnit w={w} d={d} color={color} />
      {occupied && <Person z={d * 0.34} />}
    </group>
  );
}

function Table({ w, d, color }: FurnitureProps) {
  return <TableTop w={w} d={d} color={color} topY={0.7} />;
}

function ChairElement({ w, d, color, occupied }: FurnitureProps) {
  return (
    <group>
      <Chair w={w} d={d} color={color} />
      {occupied && <Person z={0} />}
    </group>
  );
}

/** A desktop computer set: monitor + keyboard + mouse. Screen faces -Z. */
function Computer() {
  return (
    <group position={[0, 0.735, 0]}>
      {/* monitor stand */}
      <Box p={[0, 0.02, 0.03]} s={[0.22, 0.03, 0.14]} color="#475569" />
      <Box p={[0, 0.17, 0.03]} s={[0.05, 0.3, 0.05]} color="#475569" />
      {/* screen */}
      <Box p={[0, 0.42, 0.05]} s={[0.58, 0.36, 0.04]} color="#1e293b" rough={0.3} />
      <Box p={[0, 0.42, 0.027]} s={[0.52, 0.3, 0.02]} color="#3b82f6" rough={0.12} />
      {/* keyboard + mouse toward the person (-Z) */}
      <Box p={[0, 0.03, -0.22]} s={[0.42, 0.03, 0.15]} color="#1e293b" />
      <Box p={[0.3, 0.03, -0.2]} s={[0.08, 0.03, 0.11]} color="#1e293b" />
    </group>
  );
}

/** A long shared bench desk with a computer at every seat on both sides. */
function BenchTable({ w, d, color, perSide }: { w: number; d: number; color: string; perSide: number }) {
  const topY = 0.7;
  const legColor = shade(color, -42);
  const lx = w / 2 - 0.14;
  const lz = d / 2 - 0.14;
  const seats = Math.max(1, perSide);
  const computers: React.ReactNode[] = [];
  for (let i = 0; i < seats; i++) {
    const cx = -w / 2 + (w / seats) * (i + 0.5);
    computers.push(
      <group key={`t${i}`} position={[cx, 0, -d * 0.2]}><Computer /></group>
    );
    computers.push(
      <group key={`b${i}`} position={[cx, 0, d * 0.2]} rotation-y={Math.PI}><Computer /></group>
    );
  }
  return (
    <group>
      {/* shared top */}
      <Box p={[0, topY, 0]} s={[w, 0.07, d]} color={color} rough={0.5} />
      {/* cable spine down the middle */}
      <Box p={[0, topY - 0.12, 0]} s={[w * 0.96, 0.16, 0.12]} color={legColor} />
      {/* legs */}
      {[[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].map(([x, z], i) => (
        <Box key={i} p={[x, topY / 2, z]} s={[0.1, topY, 0.1]} color={legColor} />
      ))}
      {computers}
    </group>
  );
}

function Plant({ w, d, color }: FurnitureProps) {
  const r = Math.min(w, d) * 0.42;
  return (
    <group>
      {/* pot */}
      <Cyl p={[0, 0.17, 0]} rt={r} rb={r * 0.72} h={0.34} color="#b45309" />
      <Cyl p={[0, 0.35, 0]} rt={r * 1.05} rb={r} h={0.04} color="#92400e" />
      {/* foliage */}
      <mesh position={[0, 0.66, 0]} castShadow>
        <sphereGeometry args={[r * 1.05, 16, 16]} />
        <meshStandardMaterial color={shade(color, 12)} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.96, 0]} castShadow>
        <sphereGeometry args={[r * 0.8, 16, 16]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
    </group>
  );
}

function Cafe({ w, d, color, occupied }: FurnitureProps) {
  // counter along the back edge + a coffee machine, plus 2 bistro tables
  const tableR = Math.min(w, d) * 0.13;
  const bistro = (bx: number, bz: number, key: string) => (
    <group key={key} position={[bx, 0, bz]}>
      {/* pedestal table */}
      <Cyl p={[0, 0.36, 0]} rt={0.05} rb={0.05} h={0.72} color="#94a3b8" />
      <Cyl p={[0, 0.04, 0]} rt={tableR * 0.8} rb={tableR} h={0.06} color="#64748b" />
      <Cyl p={[0, 0.74, 0]} rt={tableR} rb={tableR} h={0.05} color="#e2e8f0" />
      {/* two stools */}
      <Stool w={tableR * 1.4} d={tableR * 1.4} color="#f97316" />
      <group position={[tableR * 2.4, 0, 0]}>
        <Stool w={tableR * 1.4} d={tableR * 1.4} color="#f97316" />
      </group>
    </group>
  );
  return (
    <group>
      {/* floor pad */}
      <Box p={[0, 0.03, 0]} s={[w, 0.06, d]} color={shade(color, 70)} rough={0.95} />
      {/* counter */}
      <Box p={[0, 0.45, -d / 2 + 0.22]} s={[w * 0.82, 0.9, 0.4]} color={shade(color, -20)} />
      <Box p={[0, 0.93, -d / 2 + 0.22]} s={[w * 0.84, 0.06, 0.46]} color="#e2e8f0" />
      {/* coffee machine */}
      <Box p={[-w * 0.26, 1.12, -d / 2 + 0.22]} s={[0.3, 0.36, 0.26]} color="#1f2937" />
      <Box p={[w * 0.1, 1.06, -d / 2 + 0.22]} s={[0.34, 0.22, 0.24]} color="#cbd5e1" />
      {bistro(-w * 0.2, d * 0.16, "b1")}
      {bistro(w * 0.16, d * 0.22, "b2")}
      {occupied && <Person z={d * 0.16} />}
    </group>
  );
}

function Reception({ w, d, color, occupied }: FurnitureProps) {
  return (
    <group>
      {/* curved-ish counter: front desk panel + top */}
      <Box p={[0, 0.55, -d * 0.05]} s={[w, 1.1, d * 0.5]} color={color} />
      <Box p={[0, 1.13, -d * 0.05]} s={[w * 1.04, 0.08, d * 0.6]} color="#e2e8f0" />
      {/* lower work surface behind */}
      <Box p={[0, 0.74, d * 0.26]} s={[w * 0.9, 0.05, d * 0.32]} color={shade(color, -20)} />
      {/* logo block */}
      <Box p={[0, 1.35, -d * 0.05]} s={[w * 0.32, 0.3, 0.06]} color={shade(color, 40)} />
      {/* chair behind */}
      <group position={[0, 0, d * 0.3]} rotation-y={Math.PI}>
        <Chair w={w * 0.3} d={d * 0.3} color="#475569" />
      </group>
      {occupied && <Person z={d * 0.26} />}
    </group>
  );
}

function Printer({ w, d, color }: FurnitureProps) {
  const bw = Math.min(w, 1.2);
  return (
    <group>
      {/* body */}
      <Box p={[0, 0.45, 0]} s={[bw, 0.9, d]} color={color} />
      {/* scanner lid */}
      <Box p={[0, 0.96, 0]} s={[bw, 0.12, d]} color={shade(color, 25)} />
      {/* paper tray */}
      <Box p={[0, 0.32, d * 0.55]} s={[bw * 0.8, 0.05, d * 0.5]} color={shade(color, 35)} />
      {/* control panel */}
      <Box p={[bw * 0.28, 0.92, d * 0.4]} s={[bw * 0.3, 0.04, d * 0.3]} color="#1e293b" />
      {/* output stack */}
      <Box p={[0, 0.74, 0]} s={[bw * 0.6, 0.04, d * 0.55]} color="#f8fafc" />
    </group>
  );
}

function Whiteboard({ w, color }: FurnitureProps) {
  return (
    <group>
      {/* legs */}
      <Box p={[-w / 2 + 0.1, 0.55, 0]} s={[0.07, 1.1, 0.07]} color="#64748b" />
      <Box p={[w / 2 - 0.1, 0.55, 0]} s={[0.07, 1.1, 0.07]} color="#64748b" />
      <Box p={[0, 0.12, 0]} s={[w * 0.7, 0.06, 0.5]} color="#475569" />
      {/* board */}
      <Box p={[0, 1.55, 0]} s={[w, 0.9, 0.06]} color="#f8fafc" rough={0.25} />
      <Box p={[0, 1.55, 0.04]} s={[w * 0.94, 0.82, 0.02]} color="#ffffff" rough={0.15} />
      {/* tray */}
      <Box p={[0, 1.08, 0.06]} s={[w * 0.9, 0.05, 0.1]} color="#cbd5e1" />
    </group>
  );
}

/* ───────────────── dispatcher ───────────────── */

interface FurnitureProps {
  w: number;
  d: number;
  color: string;
  occupied: boolean;
}

export function Furniture({
  type, w, d, color, occupied, style,
}: { type: ElementType; style?: Record<string, unknown> } & FurnitureProps) {
  const props = { w, d, color, occupied };
  switch (type) {
    case "WORKSTATION": return <Workstation {...props} />;
    case "HOT_DESK": return <HotDesk {...props} />;
    case "CABIN": return <Cabin {...props} />;
    case "MEETING_ROOM": return <MeetingRoom {...props} />;
    case "DESK": return <Desk {...props} />;
    case "TABLE":
      return style?.bench
        ? <BenchTable w={w} d={d} color={color} perSide={Number(style.perSide) || 5} />
        : <Table {...props} />;
    case "CHAIR": return <ChairElement {...props} />;
    case "PLANT": return <Plant {...props} />;
    // WALL, DOOR and ROOM are drawn by architecture-3d.tsx instead: a wall
    // has to know which doors are set into it, and a single-object renderer
    // cannot see its neighbours.
    case "CAFE": return <Cafe {...props} />;
    case "RECEPTION": return <Reception {...props} />;
    case "PRINTER": return <Printer {...props} />;
    case "WHITEBOARD": return <Whiteboard {...props} />;
    case "TEXT": return null;
    default: return <Workstation {...props} />;
  }
}
