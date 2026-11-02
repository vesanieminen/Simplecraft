/**
 * Voxel AABB physics: per-axis swept collision, ground checks,
 * and overlap tests used to keep kids from being trapped in blocks.
 */

import { WATER } from './blocks';
import { World } from './world';

export interface Aabb {
  x: number; y: number; z: number; // min corner
  w: number; h: number; d: number;
}

export const PLAYER_W = 0.62;
export const PLAYER_H = 1.72;
const EPS = 1e-4;

export function playerAabb(px: number, py: number, pz: number): Aabb {
  return { x: px - PLAYER_W / 2, y: py, z: pz - PLAYER_W / 2, w: PLAYER_W, h: PLAYER_H, d: PLAYER_W };
}

export function blockAabb(x: number, y: number, z: number): Aabb {
  return { x, y, z, w: 1, h: 1, d: 1 };
}

export function boxesOverlap(a: Aabb, b: Aabb): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x
    && a.y < b.y + b.h && a.y + a.h > b.y
    && a.z < b.z + b.d && a.z + a.d > b.z;
}

function collides(world: World, a: Aabb): boolean {
  const x0 = Math.floor(a.x), x1 = Math.floor(a.x + a.w - 1e-6);
  const y0 = Math.floor(a.y), y1 = Math.floor(a.y + a.h - 1e-6);
  const z0 = Math.floor(a.z), z1 = Math.floor(a.z + a.d - 1e-6);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (world.isSolid(x, y, z)) return true;
      }
    }
  }
  return false;
}

/** true if any solid block overlaps the AABB (used for safe placement) */
export function aabbOverlapsSolid(world: World, a: Aabb): boolean {
  return collides(world, a);
}

export interface MoveResult {
  vx: number; vy: number; vz: number;
  hitGround: boolean; hitCeil: boolean; hitWall: boolean;
}

/**
 * Move an AABB by velocity*step with per-axis resolution.
 * Mutates `box`. Returns the (possibly zeroed) velocity components.
 */
export function moveAabb(world: World, box: Aabb, vx: number, vy: number, vz: number, step: number): MoveResult {
  let hitGround = false, hitCeil = false, hitWall = false;

  // ---- X ----
  box.x += vx * step;
  if (collides(world, box)) {
    hitWall = true;
    if (vx > 0) {
      const bx = Math.floor(box.x + box.w - 1e-6);
      box.x = bx - box.w - EPS;
    } else if (vx < 0) {
      const bx = Math.floor(box.x);
      box.x = bx + 1 + EPS;
    }
    vx = 0;
  }

  // ---- Y ----
  box.y += vy * step;
  if (collides(world, box)) {
    if (vy < 0) {
      hitGround = true;
      const by = Math.floor(box.y);
      box.y = by + 1;
    } else if (vy > 0) {
      hitCeil = true;
      const by = Math.floor(box.y + box.h - 1e-6);
      box.y = by - box.h - EPS;
    }
    vy = 0;
  }

  // ---- Z ----
  box.z += vz * step;
  if (collides(world, box)) {
    hitWall = true;
    if (vz > 0) {
      const bz = Math.floor(box.z + box.d - 1e-6);
      box.z = bz - box.d - EPS;
    } else if (vz < 0) {
      const bz = Math.floor(box.z);
      box.z = bz + 1 + EPS;
    }
    vz = 0;
  }

  return { vx, vy, vz, hitGround, hitCeil, hitWall };
}

/** is there solid ground directly beneath the feet? */
export function grounded(world: World, box: Aabb): boolean {
  const feet: Aabb = { x: box.x + 0.04, y: box.y - 0.08, z: box.z + 0.04, w: box.w - 0.08, h: 0.07, d: box.d - 0.08 };
  return collides(world, feet);
}

/** block id at the body center-ish (for water/swim checks) */
export function bodyBlock(world: World, box: Aabb): number {
  return world.get(Math.floor(box.x + box.w / 2), Math.floor(box.y + 0.9), Math.floor(box.z + box.d / 2));
}

export function inWater(world: World, box: Aabb): boolean {
  return bodyBlock(world, box) === WATER || world.get(
    Math.floor(box.x + box.w / 2), Math.floor(box.y + 0.2), Math.floor(box.z + box.d / 2),
  ) === WATER;
}

/**
 * True while the player is in water but their head is out of it — the state
 * where they can push off the surface and jump out onto the shore. Fully
 * submerged kids cannot (they have to kick up to the surface first).
 */
export function headClearOfWater(world: World, box: Aabb): boolean {
  return world.get(
    Math.floor(box.x + box.w / 2), Math.floor(box.y + PLAYER_H - 0.1), Math.floor(box.z + box.d / 2),
  ) !== WATER;
}
