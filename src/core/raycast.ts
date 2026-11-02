/**
 * Voxel ray traversal (Amanatides & Woo DDA) plus the kid-friendly
 * "generous targeting" helper that samples a small cross pattern.
 */

import { AIR, BlockId, blockDef } from './blocks';
import { World } from './world';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface RayHit {
  block: BlockId;
  /** block cell containing the hit */
  x: number;
  y: number;
  z: number;
  /** the empty cell just before the hit (placement position) */
  px: number;
  py: number;
  pz: number;
  dist: number;
}

export function raycastVoxel(
  world: World,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
  hitTest: (id: BlockId) => boolean,
): RayHit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - ox) / dx : stepX < 0 ? (x - ox) / dx : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) / dy : stepY < 0 ? (y - oy) / dy : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) / dz : stepZ < 0 ? (z - oz) / dz : Infinity;
  let px = x, py = y, pz = z;
  let t = 0;

  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const id = world.get(x, y, z);
    if (id !== AIR && hitTest(id)) {
      return { block: id, x, y, z, px, py, pz, dist: t };
    }
    px = x; py = y; pz = z;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ;
    }
  }
  return null;
}

/** Target anything except air. */
export const hitSolid = (id: BlockId) => id !== AIR && !blockDef(id).cross;
/** For removal: everything placeable counts (including plants). */
export const hitAny = (id: BlockId) => id !== AIR;

/**
 * Forgiving aim: try the center ray; if it misses, sample a few offsets.
 * Children never have to line up a pixel-perfect crosshair.
 */
export function generousTarget(
  world: World,
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  up: Vec3,
  right: Vec3,
): RayHit | null {
  const NUDGE = 0.12; // world units offset at ~1 block distance
  const center = raycastVoxel(world, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxDist, hitSolid);
  if (center) return center;
  const samples: [number, number][] = [[NUDGE, 0], [-NUDGE, 0], [0, NUDGE], [0, -NUDGE], [NUDGE, NUDGE], [-NUDGE, -NUDGE]];
  let best: RayHit | null = null;
  for (const [a, b] of samples) {
    const dx = dir.x + right.x * a + up.x * b;
    const dy = dir.y + right.y * a + up.y * b;
    const dz = dir.z + right.z * a + up.z * b;
    const len = Math.hypot(dx, dy, dz);
    const hit = raycastVoxel(world, origin.x, origin.y, origin.z, dx / len, dy / len, dz / len, maxDist, hitSolid);
    if (hit && (!best || hit.dist < best.dist)) best = hit;
  }
  return best;
}
