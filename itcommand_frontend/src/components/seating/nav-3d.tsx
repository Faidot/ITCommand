"use client";

/**
 * Getting around the floor.
 *
 * Two modes, because looking at a plan and standing in it are different jobs:
 *
 * **Plan** uses MapControls rather than OrbitControls. On a floor plan the
 * thing you do constantly is slide across it, and OrbitControls puts that on
 * the right mouse button while the left one spins the model — which is why
 * moving around felt like a fight. MapControls swaps them: drag to pan, right
 * drag to orbit, wheel zooms toward the cursor rather than the centre.
 *
 * **Walk** puts the camera at head height and drives it with WASD and the
 * mouse, so you can go and stand at somebody's desk. Pointer lock is what
 * makes mouse-look work at all; Esc gives the cursor back.
 */

import { useEffect, useRef } from "react";
import { MapControls, PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { EYE_HEIGHT } from "@/components/seating/architecture-3d";

export type NavMode = "plan" | "walk";

/** Metres per second. Shift multiplies it. */
const WALK_SPEED = 3.4;
const RUN_MULTIPLIER = 2.2;

const MOVEMENT_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export function PlanControls({ maxDistance }: { maxDistance: number }) {
  return (
    <MapControls
      makeDefault
      enableDamping
      dampingFactor={0.09}
      // Toward the cursor, not the middle of the screen: on a wide plan the
      // thing you want to look at is almost never in the centre.
      zoomToCursor
      panSpeed={1.1}
      rotateSpeed={0.65}
      zoomSpeed={0.9}
      minDistance={1.5}
      maxDistance={maxDistance}
      // Just shy of the horizon, so the camera cannot end up under the floor
      // looking up at the underside of everything.
      maxPolarAngle={Math.PI / 2.08}
    />
  );
}

/**
 * First-person walk. WASD to move, mouse to look, shift to hurry.
 *
 * Movement is flattened to the ground plane and the eye height is pinned, so
 * looking down at a desk does not sink you into the floor — which is what
 * happens if you just translate along the camera's forward vector.
 */
export function WalkControls({
  bounds,
  onExit,
}: {
  bounds: { w: number; h: number };
  onExit: () => void;
}) {
  const { camera } = useThree();
  const pressed = useRef<Set<string>>(new Set());
  const forward = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (MOVEMENT_KEYS[e.code] || e.code === "ShiftLeft" || e.code === "ShiftRight") {
        // Arrow keys scroll the page and space-like keys can activate the last
        // focused control; neither is wanted while walking.
        e.preventDefault();
        pressed.current.add(e.code);
      }
    };
    const up = (e: KeyboardEvent) => pressed.current.delete(e.code);
    // Clear held keys when the tab loses focus, or a key held during an
    // alt-tab keeps the camera drifting after you come back.
    const clear = () => pressed.current.clear();

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  useFrame((_, delta) => {
    let x = 0;
    let z = 0;
    pressed.current.forEach((code) => {
      const move = MOVEMENT_KEYS[code];
      if (move) { x += move[0]; z += move[1]; }
    });
    if (x === 0 && z === 0) {
      camera.position.y = EYE_HEIGHT;
      return;
    }

    const running =
      pressed.current.has("ShiftLeft") || pressed.current.has("ShiftRight");
    // Capped: a long frame after a stall must not teleport you across the room.
    const step = WALK_SPEED * (running ? RUN_MULTIPLIER : 1) * Math.min(delta, 0.1);

    camera.getWorldDirection(forward.current);
    forward.current.y = 0;
    forward.current.normalize();
    right.current.crossVectors(forward.current, camera.up).normalize();

    const length = Math.hypot(x, z) || 1;   // no diagonal speed bonus
    camera.position.addScaledVector(forward.current, (z / length) * step);
    camera.position.addScaledVector(right.current, (x / length) * step);

    // Stay on the floor plate. Walking off into empty space is disorienting
    // and there is nothing out there to look at.
    const margin = 0.35;
    camera.position.x = THREE.MathUtils.clamp(
      camera.position.x, -bounds.w / 2 + margin, bounds.w / 2 - margin,
    );
    camera.position.z = THREE.MathUtils.clamp(
      camera.position.z, -bounds.h / 2 + margin, bounds.h / 2 - margin,
    );
    camera.position.y = EYE_HEIGHT;
  });

  return <PointerLockControls makeDefault onUnlock={onExit} />;
}
