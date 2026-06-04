"use client";

import { useRef, useCallback, useState } from "react";
import { ELEMENTS, ElementType, FloorObject, effectiveColor } from "@/lib/seating-types";
import { SeatTooltip } from "@/components/seating/seat-tooltip";

type Corner = "nw" | "ne" | "sw" | "se";
const CORNER_SIGN: Record<Corner, [number, number]> = {
  nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1],
};

interface MoveState {
  mode: "move";
  startPX: number; startPY: number;
  /** start positions of every object being moved */
  starts: { cid: string; x: number; y: number }[];
  moved: boolean;
  /** the object the drag started on */
  originCid: string;
  wasMulti: boolean;
}
interface ResizeState {
  mode: "resize";
  cid: string;
  startObj: FloorObject;
  corner: Corner;
  anchorX: number; anchorY: number;
}
interface RotateState {
  mode: "rotate";
  cid: string;
  startObj: FloorObject;
}
interface MarqueeState {
  mode: "marquee";
  startPX: number; startPY: number;
  curPX: number; curPY: number;
}
type DragState = MoveState | ResizeState | RotateState | MarqueeState;

function rot(vx: number, vy: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [vx * c - vy * s, vx * s + vy * c];
}

export function FloorCanvas2D({
  objects,
  width,
  height,
  zoom,
  selectedCids,
  editable,
  snap,
  pendingSeatIds,
  onSelectionChange,
  onChange,
  onChangeMany,
  onAddAt,
  onOpenObject,
  onOpenAsset,
  onOpenAllAssets,
}: {
  objects: FloorObject[];
  width: number;
  height: number;
  zoom: number;
  selectedCids: string[];
  editable: boolean;
  snap: boolean;
  pendingSeatIds?: number[];
  onSelectionChange: (cids: string[]) => void;
  onChange: (cid: string, patch: Partial<FloorObject>) => void;
  onChangeMany: (updates: { cid: string; patch: Partial<FloorObject> }[]) => void;
  onAddAt: (type: ElementType, x: number, y: number) => void;
  onOpenObject: (obj: FloorObject) => void;
  onOpenAsset?: (assetId: number) => void;
  onOpenAllAssets?: (userId: number) => void;
}) {
  const pendingSet = new Set(pendingSeatIds || []);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [hoverCid, setHoverCid] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  }, []);
  const scheduleHide = useCallback(() => {
    cancelHide();
    hoverTimer.current = setTimeout(() => setHoverCid(null), 220);
  }, [cancelHide]);

  const selSet = new Set(selectedCids);
  const single = selectedCids.length === 1 ? objects.find((o) => o.cid === selectedCids[0]) : null;

  const toCanvas = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return [0, 0];
      return [(clientX - rect.left) / zoom, (clientY - rect.top) / zoom];
    },
    [zoom]
  );

  const snapVal = (v: number) => (snap ? Math.round(v / 8) * 8 : Math.round(v));

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const [px, py] = toCanvas(e.clientX, e.clientY);

      if (d.mode === "move") {
        const dx = snapVal(px - d.startPX);
        const dy = snapVal(py - d.startPY);
        if (Math.abs(px - d.startPX) > 3 || Math.abs(py - d.startPY) > 3) d.moved = true;
        onChangeMany(
          d.starts.map((s) => ({ cid: s.cid, patch: { x: s.x + dx, y: s.y + dy } }))
        );
      } else if (d.mode === "resize") {
        const o = d.startObj;
        const ax = d.anchorX, ay = d.anchorY;
        const [lx, ly] = rot(px - ax, py - ay, -o.rotation);
        const newW = Math.max(14, Math.abs(lx));
        const newH = Math.max(14, Math.abs(ly));
        const cx = (ax + px) / 2;
        const cy = (ay + py) / 2;
        onChange(d.cid, {
          width: Math.round(newW),
          height: Math.round(newH),
          x: Math.round(cx - newW / 2),
          y: Math.round(cy - newH / 2),
        });
      } else if (d.mode === "rotate") {
        const o = d.startObj;
        const cx = o.x + o.width / 2;
        const cy = o.y + o.height / 2;
        let ang = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
        ang = snap ? Math.round(ang / 15) * 15 : Math.round(ang);
        onChange(d.cid, { rotation: ((ang % 360) + 360) % 360 });
      } else if (d.mode === "marquee") {
        d.curPX = px; d.curPY = py;
        setMarquee({ ...d });
      }
    },
    [onChange, onChangeMany, toCanvas, snap]
  );

  const endDrag = useCallback(() => {
    const d = drag.current;
    if (d?.mode === "marquee") {
      const x1 = Math.min(d.startPX, d.curPX);
      const y1 = Math.min(d.startPY, d.curPY);
      const x2 = Math.max(d.startPX, d.curPX);
      const y2 = Math.max(d.startPY, d.curPY);
      if (x2 - x1 < 4 && y2 - y1 < 4) {
        onSelectionChange([]); // plain click on empty space
      } else {
        const hit = objects.filter(
          (o) => o.x < x2 && o.x + o.width > x1 && o.y < y2 && o.y + o.height > y1
        );
        onSelectionChange(hit.map((o) => o.cid));
      }
      setMarquee(null);
    } else if (d?.mode === "move") {
      // a plain click on a member of a multi-selection collapses to single
      if (!d.moved && d.wasMulti) onSelectionChange([d.originCid]);
    }
    drag.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [objects, onPointerMove, onSelectionChange]);

  const attach = () => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };

  // pointer down on an object body
  const beginObjectDrag = (e: React.PointerEvent, obj: FloorObject) => {
    if (!editable) { onSelectionChange([obj.cid]); return; }
    e.stopPropagation();

    // shift/ctrl → toggle membership, no drag
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const next = new Set(selSet);
      if (next.has(obj.cid)) next.delete(obj.cid);
      else next.add(obj.cid);
      onSelectionChange(Array.from(next));
      return;
    }

    const inSel = selSet.has(obj.cid);
    const movingCids = inSel ? selectedCids : [obj.cid];
    if (!inSel) onSelectionChange([obj.cid]);

    if (obj.locked) return; // selected, but locked objects don't move

    const movable = objects.filter((o) => movingCids.includes(o.cid) && !o.locked);
    const [px, py] = toCanvas(e.clientX, e.clientY);
    drag.current = {
      mode: "move",
      startPX: px, startPY: py,
      starts: movable.map((o) => ({ cid: o.cid, x: o.x, y: o.y })),
      moved: false,
      originCid: obj.cid,
      wasMulti: inSel && selectedCids.length > 1,
    };
    attach();
  };

  const beginResize = (e: React.PointerEvent, obj: FloorObject, corner: Corner) => {
    if (!editable || obj.locked) return;
    e.stopPropagation();
    const [sx, sy] = CORNER_SIGN[corner];
    const cx = obj.x + obj.width / 2;
    const cy = obj.y + obj.height / 2;
    const [ox, oy] = rot((-sx * obj.width) / 2, (-sy * obj.height) / 2, obj.rotation);
    drag.current = { mode: "resize", cid: obj.cid, startObj: obj, corner, anchorX: cx + ox, anchorY: cy + oy };
    attach();
  };

  const beginRotate = (e: React.PointerEvent, obj: FloorObject) => {
    if (!editable || obj.locked) return;
    e.stopPropagation();
    drag.current = { mode: "rotate", cid: obj.cid, startObj: obj };
    attach();
  };

  // pointer down on empty canvas → marquee select
  const beginMarquee = (e: React.PointerEvent) => {
    if (!editable) { onSelectionChange([]); return; }
    const [px, py] = toCanvas(e.clientX, e.clientY);
    drag.current = { mode: "marquee", startPX: px, startPY: py, curPX: px, curPY: py };
    setMarquee(drag.current as MarqueeState);
    attach();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-floor-element") as ElementType;
    if (!type || !ELEMENTS[type]) return;
    const [px, py] = toCanvas(e.clientX, e.clientY);
    const def = ELEMENTS[type];
    onAddAt(type, snapVal(px - def.w / 2), snapVal(py - def.h / 2));
  };

  const hoverObj = hoverCid ? objects.find((o) => o.cid === hoverCid) : null;

  return (
    <div className="flex-1 overflow-auto bg-neutral-100 dark:bg-neutral-950 p-10 flex items-start justify-center">
      <div
        ref={canvasRef}
        onPointerDown={beginMarquee}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
        onDrop={handleDrop}
        className="relative shrink-0 bg-white dark:bg-neutral-900 border-2 border-neutral-300 dark:border-neutral-700 shadow-xl"
        style={{ width: width * zoom, height: height * zoom }}
      >
        {/* scaled inner layer */}
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width, height,
            transform: `scale(${zoom})`,
            backgroundImage:
              "linear-gradient(#eef2f7 1px, transparent 1px), linear-gradient(90deg, #eef2f7 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        >
          {[...objects]
            .sort((a, b) => a.z_index - b.z_index)
            .map((o) => (
              <ObjectView
                key={o.cid}
                obj={o}
                selected={selSet.has(o.cid)}
                soloSelected={single?.cid === o.cid}
                pending={!!(o.seat && pendingSet.has(o.seat))}
                editable={editable}
                onBeginDrag={beginObjectDrag}
                onBeginResize={beginResize}
                onBeginRotate={beginRotate}
                onOpen={() => onOpenObject(o)}
                onHover={(h) => {
                  if (h) { cancelHide(); setHoverCid(o.cid); }
                  else { scheduleHide(); }
                }}
              />
            ))}

          {/* marquee rectangle */}
          {marquee && (
            <div
              className="absolute border-2 border-violet-500 bg-violet-500/10 pointer-events-none"
              style={{
                left: Math.min(marquee.startPX, marquee.curPX),
                top: Math.min(marquee.startPY, marquee.curPY),
                width: Math.abs(marquee.curPX - marquee.startPX),
                height: Math.abs(marquee.curPY - marquee.startPY),
              }}
            />
          )}
        </div>

        {/* Hover tooltip — rendered unscaled in the outer layer, interactive */}
        {hoverObj && hoverObj.is_occupied && hoverObj.current_assignment && (
          <div
            className="absolute z-50"
            style={{
              left: (hoverObj.x + hoverObj.width / 2) * zoom,
              top: hoverObj.y * zoom - 8,
              transform: "translate(-50%, -100%)",
            }}
          >
            <SeatTooltip
              assignment={hoverObj.current_assignment}
              seatCode={hoverObj.seat_code}
              onPointerEnter={cancelHide}
              onPointerLeave={scheduleHide}
              onOpenAsset={onOpenAsset}
              onOpenAllAssets={
                hoverObj.current_assignment?.user && onOpenAllAssets
                  ? () => onOpenAllAssets(hoverObj.current_assignment.user)
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ObjectView({
  obj,
  selected,
  soloSelected,
  pending,
  editable,
  onBeginDrag,
  onBeginResize,
  onBeginRotate,
  onOpen,
  onHover,
}: {
  obj: FloorObject;
  selected: boolean;
  soloSelected: boolean;
  pending: boolean;
  editable: boolean;
  onBeginDrag: (e: React.PointerEvent, o: FloorObject) => void;
  onBeginResize: (e: React.PointerEvent, o: FloorObject, c: Corner) => void;
  onBeginRotate: (e: React.PointerEvent, o: FloorObject) => void;
  onOpen: () => void;
  onHover: (hovering: boolean) => void;
}) {
  const def = ELEMENTS[obj.object_type];
  const color = effectiveColor(obj);
  const isText = obj.object_type === "TEXT";
  const isRoom = obj.object_type === "ROOM";

  return (
    <div
      className="absolute select-none"
      style={{
        left: obj.x, top: obj.y, width: obj.width, height: obj.height,
        transform: `rotate(${obj.rotation}deg)`,
        zIndex: obj.z_index + 1,
      }}
      onDoubleClick={(e) => { e.stopPropagation(); onOpen(); }}
      onPointerDown={(e) => onBeginDrag(e, obj)}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <div
        className="w-full h-full flex flex-col items-center justify-center overflow-hidden text-center"
        style={{
          background: isText ? "transparent" : isRoom ? `${color}33` : color,
          border: isRoom ? `2px dashed ${color}` : isText ? "1px dashed transparent" : `1px solid rgba(0,0,0,.18)`,
          borderRadius: obj.object_type === "CHAIR" || obj.object_type === "PLANT" ? "50%" : 6,
          cursor: editable && !obj.locked ? "move" : "pointer",
          boxShadow: selected ? "0 0 0 2px #7c3aed" : undefined,
          color: isText ? color : pickText(color),
        }}
      >
        {isText ? (
          <span className="text-sm font-semibold px-1 truncate w-full">{obj.label || "Label"}</span>
        ) : obj.is_occupied && obj.current_assignment ? (
          <>
            <div
              className="rounded-full bg-white/90 flex items-center justify-center font-bold"
              style={{ width: 22, height: 22, color, fontSize: 10 }}
            >
              {obj.current_assignment.user_name?.charAt(0) || "?"}
            </div>
            <span className="text-[9px] font-medium leading-tight mt-0.5 px-1 truncate w-full">
              {obj.current_assignment.user_name}
            </span>
          </>
        ) : (
          <span className="text-[9px] font-semibold uppercase opacity-80 px-1 truncate w-full leading-tight">
            {obj.label || obj.seat_code || def.label}
          </span>
        )}
      </div>

      {/* handles only when this is the single selected object */}
      {soloSelected && editable && !obj.locked && (
        <>
          {(["nw", "ne", "sw", "se"] as Corner[]).map((corner) => (
            <div
              key={corner}
              onPointerDown={(e) => onBeginResize(e, obj, corner)}
              className="absolute bg-white border-2 border-violet-600 rounded-sm"
              style={{
                width: 11, height: 11,
                left: corner.includes("w") ? -6 : undefined,
                right: corner.includes("e") ? -6 : undefined,
                top: corner.includes("n") ? -6 : undefined,
                bottom: corner.includes("s") ? -6 : undefined,
                cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
              }}
            />
          ))}
          <div
            onPointerDown={(e) => onBeginRotate(e, obj)}
            className="absolute bg-violet-600 rounded-full border-2 border-white"
            style={{ width: 13, height: 13, left: "50%", top: -28, transform: "translateX(-50%)", cursor: "grab" }}
          />
          <div className="absolute bg-violet-600" style={{ width: 2, height: 16, left: "50%", top: -16, transform: "translateX(-50%)" }} />
        </>
      )}
      {obj.locked && selected && (
        <div className="absolute inset-0 ring-2 ring-amber-400 rounded-md pointer-events-none" />
      )}
      {pending && (
        <div
          className="absolute -top-1 -right-1 rounded-full bg-amber-500 border-2 border-white text-white text-[8px] font-bold flex items-center justify-center shadow"
          style={{ width: 14, height: 14 }}
          title="Pending change"
        >
          !
        </div>
      )}
    </div>
  );
}

function pickText(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return "#fff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1e293b" : "#ffffff";
}
