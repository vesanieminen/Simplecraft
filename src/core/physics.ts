/**
 * Voxel AABB physics: per-axis swept collision, ground checks,
 * and overlap tests used to keep kids from being trapped in blocks.
 */

import {
  AIR, isDoorClosedBlock, isStairsBlock, solidHeightOf, StairFacing, stairBoxes, VoxelBox, WATER,
} from './blocks';
import { idx as worldIdx, World } from './world';

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

/** an AABB from the mesher's box notation (min corner, max corner) */
function boxOf([x0, y0, z0, x1, y1, z1]: VoxelBox): Aabb {
  return { x: x0, y: y0, z: z0, w: x1 - x0, h: y1 - y0, d: z1 - z0 };
}

/**
 * The solid boxes inside a voxel cell — the physics twin of what the mesher
 * draws. A full block is one box filling the cell; a slab and a treasure chest
 * are squat boxes; a stair cell is TWO boxes (the tall half plus the half-high
 * tread); a CLOSED door is the thin standing panel, half a block deep and
 * oriented by world.doorFacing. Empty for air, water, plants and open doors.
 */
export function solidBoxesOf(world: World, x: number, y: number, z: number): Aabb[] {
  const id = world.get(x, y, z);
  if (id === AIR) return [];
  if (isStairsBlock(id)) {
    const facing = (world.stairFacing.get(worldIdx(x, y, z)) ?? 0) as StairFacing;
    const { tall, low } = stairBoxes(x, y, z, facing);
    return [boxOf(tall), boxOf(low)];
  }
  const h = solidHeightOf(id);
  if (h <= 0) return [];
  if (isDoorClosedBlock(id)) {
    const facing = world.doorFacing.get(worldIdx(x, y, z)) ?? 0;
    return [facing === 0
      ? { x: x + 0.25, y, z, w: 0.5, h: 1, d: 1 }
      : { x, y, z: z + 0.25, w: 1, h: 1, d: 0.5 }];
  }
  return [{ x, y, z, w: 1, h, d: 1 }];
}

/** do two boxes overlap when you look down on them from above? */
function planarOverlap(a: Aabb, b: Aabb): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.d && a.z + a.d > b.z;
}

function collides(world: World, a: Aabb): boolean {
  const x0 = Math.floor(a.x), x1 = Math.floor(a.x + a.w - 1e-6);
  const y0 = Math.floor(a.y), y1 = Math.floor(a.y + a.h - 1e-6);
  const z0 = Math.floor(a.z), z1 = Math.floor(a.z + a.d - 1e-6);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        // slabs, stairs, doors…: partial blocks only fill part of their cell
        for (const b of solidBoxesOf(world, x, y, z)) {
          if (boxesOverlap(a, b)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Top of the highest solid part under the feet — lands must snap onto
 * it, which for a slab is half a cell and for a stair cell whichever half
 * the kid is standing over.
 */
function supportTop(world: World, box: Aabb): number {
  const y0 = Math.floor(box.y + EPS);
  const x0 = Math.floor(box.x), x1 = Math.floor(box.x + box.w - 1e-6);
  const z0 = Math.floor(box.z), z1 = Math.floor(box.z + box.d - 1e-6);
  let best = -Infinity;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (const b of solidBoxesOf(world, x, y0, z)) {
        if (!planarOverlap(box, b)) continue;
        best = Math.max(best, b.y + b.h);
      }
    }
  }
  return Number.isFinite(best) ? best : Math.floor(box.y) + 1;
}

/**
 * Top of the low part of the block the box is walking into (used for step-ups):
 * the row of cells just past the leading edge at foot level. Of everything there
 * that is taller than their feet, the LOWEST top wins — the tread of a stair
 * before its tall half, so one step at a time is always enough.
 */
function stepLift(world: World, box: Aabb, axis: 'x' | 'z', dir: number): number | null {
  const y0 = Math.floor(box.y + EPS);
  const cells: [number, number][] = [];
  if (axis === 'x') {
    const bx = dir > 0 ? Math.floor(box.x + box.w - 1e-6) : Math.floor(box.x + 1e-6);
    for (let z = Math.floor(box.z); z <= Math.floor(box.z + box.d - 1e-6); z++) cells.push([bx, z]);
  } else {
    const bz = dir > 0 ? Math.floor(box.z + box.d - 1e-6) : Math.floor(box.z + 1e-6);
    for (let x = Math.floor(box.x); x <= Math.floor(box.x + box.w - 1e-6); x++) cells.push([x, bz]);
  }
  let best: number | null = null;
  for (const [cx, cz] of cells) {
    for (const b of solidBoxesOf(world, cx, y0, cz)) {
      if (!planarOverlap(box, b)) continue;
      const top = b.y + b.h;
      if (top <= box.y + EPS) continue; // below their feet: nothing to climb
      if (best === null || top < best) best = top;
    }
  }
  return best;
}

/**
 * Snap the box out of everything it is currently overlapping along one
 * horizontal axis, onto the NEAREST solid face in the direction of travel.
 * For plain cubes this is the old cell-edge clamp; for a closed door the
 * kid stops right at the visible panel instead of half a block short of it.
 */
function faceSnap(world: World, box: Aabb, axis: 'x' | 'z', dir: number): void {
  const x0 = Math.floor(box.x), x1 = Math.floor(box.x + box.w - 1e-6);
  const y0 = Math.floor(box.y), y1 = Math.floor(box.y + box.h - 1e-6);
  const z0 = Math.floor(box.z), z1 = Math.floor(box.z + box.d - 1e-6);
  let best = dir > 0 ? Infinity : -Infinity;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (const b of solidBoxesOf(world, x, y, z)) {
          if (!b || !boxesOverlap(box, b)) continue;
          if (axis === 'x') best = dir > 0 ? Math.min(best, b.x - box.w - EPS) : Math.max(best, b.x + b.w + EPS);
          else best = dir > 0 ? Math.min(best, b.z - box.d - EPS) : Math.max(best, b.z + b.d + EPS);
        }
      }
    }
  }
  if (!Number.isFinite(best)) return; // cannot find a face (should not happen): leave as is
  if (axis === 'x') box.x = best;
  else box.z = best;
}

/** how far above their feet a kid auto-steps up without jumping */
const STEP_UP = 0.55;

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
    if (tryStepUp(world, box, 'x', vx)) {
      // walked up onto a stairs block — keep going, no wall
    } else {
      hitWall = true;
      // stop right at the solid face we walked into — the cell edge for a
      // cube, the visible half-deep panel for a closed door
      if (vx !== 0) faceSnap(world, box, 'x', vx > 0 ? 1 : -1);
      vx = 0;
    }
  }

  // ---- Y ----
  box.y += vy * step;
  if (collides(world, box)) {
    if (vy < 0) {
      hitGround = true;
      box.y = supportTop(world, box);
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
    if (tryStepUp(world, box, 'z', vz)) {
      // as above: a stairs step, not a wall
    } else {
      hitWall = true;
      if (vz !== 0) faceSnap(world, box, 'z', vz > 0 ? 1 : -1);
      vz = 0;
    }
  }

  return { vx, vy, vz, hitGround, hitCeil, hitWall };
}

/**
 * Steps, not walls: if the box stands on the ground and walks into a block
 * whose solid top is a comfortable step height above their feet (a slab, or the
 * tread half of a stair), lift them onto it instead of stopping. Kids never
 * have to think about jumping up a step.
 */
function tryStepUp(world: World, box: Aabb, axis: 'x' | 'z', v: number): boolean {
  if (v === 0) return false;
  if (!grounded(world, box)) return false;
  const dir = v > 0 ? 1 : -1;
  const top = stepLift(world, box, axis, dir);
  if (top === null) return false;
  const lift = top - box.y;
  if (lift <= EPS || lift > STEP_UP + EPS) return false;
  if (collides(world, { ...box, y: top + EPS })) return false;
  box.y = top + EPS;
  return true;
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

/**
 * How much of the body (0..1) is under water, sampled up the middle of the
 * player. Buoyancy hangs off this: deep under pushes you up, shallow water
 * just lets you wade and settle.
 */
export function submergedFraction(world: World, box: Aabb): number {
  const x = Math.floor(box.x + box.w / 2), z = Math.floor(box.z + box.d / 2);
  let wet = 0;
  for (const dy of [0.2, 0.7, 1.15, 1.6]) if (world.get(x, Math.floor(box.y + dy), z) === WATER) wet++;
  return wet / 4;
}
