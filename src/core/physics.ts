/**
 * Voxel AABB physics: per-axis swept collision, ground checks,
 * and overlap tests used to keep kids from being trapped in blocks.
 */

import { isDoorClosedBlock, solidHeightOf, WATER } from './blocks';
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

/**
 * The solid box inside a voxel cell — the physics twin of what the mesher
 * draws. Full blocks fill the cell; stairs fill its lower half; a CLOSED
 * door is the thin standing panel (half a block deep, centred in the cell,
 * oriented by world.doorFacing). Null for air, water, plants and open doors.
 */
export function solidBoxOf(world: World, x: number, y: number, z: number): Aabb | null {
  const id = world.get(x, y, z);
  const h = solidHeightOf(id);
  if (h <= 0) return null;
  if (isDoorClosedBlock(id)) {
    const facing = world.doorFacing.get(worldIdx(x, y, z)) ?? 0;
    return facing === 0
      ? { x: x + 0.25, y, z, w: 0.5, h: 1, d: 1 }
      : { x, y, z: z + 0.25, w: 1, h: 1, d: 0.5 };
  }
  return { x, y, z, w: 1, h, d: 1 };
}

function collides(world: World, a: Aabb): boolean {
  const x0 = Math.floor(a.x), x1 = Math.floor(a.x + a.w - 1e-6);
  const y0 = Math.floor(a.y), y1 = Math.floor(a.y + a.h - 1e-6);
  const z0 = Math.floor(a.z), z1 = Math.floor(a.z + a.d - 1e-6);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        // stairs, doors…: partial blocks only fill part of their cell
        const b = solidBoxOf(world, x, y, z);
        if (b && boxesOverlap(a, b)) return true;
      }
    }
  }
  return false;
}

/**
 * Top of the highest solid part under the feet — lands must snap onto
 * it, which for a stairs block is half a cell, not a whole one.
 */
function supportTop(world: World, box: Aabb): number {
  const y0 = Math.floor(box.y + EPS);
  const x0 = Math.floor(box.x), x1 = Math.floor(box.x + box.w - 1e-6);
  const z0 = Math.floor(box.z), z1 = Math.floor(box.z + box.d - 1e-6);
  let best = -Infinity;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      const b = solidBoxOf(world, x, y0, z);
      if (b) best = Math.max(best, b.y + b.h);
    }
  }
  return Number.isFinite(best) ? best : Math.floor(box.y) + 1;
}

/**
 * Top of the block the box is walking into (used for stair step-ups):
 * the row of cells just past the leading edge at foot level.
 */
function stepLift(world: World, box: Aabb, axis: 'x' | 'z', dir: number): number | null {
  const y0 = Math.floor(box.y + EPS);
  let best: number | null = null;
  if (axis === 'x') {
    const bx = dir > 0 ? Math.floor(box.x + box.w - 1e-6) : Math.floor(box.x + 1e-6);
    const z0 = Math.floor(box.z), z1 = Math.floor(box.z + box.d - 1e-6);
    for (let z = z0; z <= z1; z++) {
      const b = solidBoxOf(world, bx, y0, z);
      if (b) best = best === null ? b.y + b.h : Math.max(best, b.y + b.h);
    }
  } else {
    const bz = dir > 0 ? Math.floor(box.z + box.d - 1e-6) : Math.floor(box.z + 1e-6);
    const x0 = Math.floor(box.x), x1 = Math.floor(box.x + box.w - 1e-6);
    for (let x = x0; x <= x1; x++) {
      const b = solidBoxOf(world, x, y0, bz);
      if (b) best = best === null ? b.y + b.h : Math.max(best, b.y + b.h);
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
        const b = solidBoxOf(world, x, y, z);
        if (!b || !boxesOverlap(box, b)) continue;
        if (axis === 'x') best = dir > 0 ? Math.min(best, b.x - box.w - EPS) : Math.max(best, b.x + b.w + EPS);
        else best = dir > 0 ? Math.min(best, b.z - box.d - EPS) : Math.max(best, b.z + b.d + EPS);
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
 * Stairs, not walls: if the box stands on the ground and walks into a block
 * whose solid top is a comfortable step height above their feet (a stairs
 * block), lift them onto it instead of stopping. Kids never have to think
 * about jumping up a step.
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
