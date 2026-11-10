/**
 * The bucket — the palette's one tool instead of a brick.
 *
 * Empty and aimed at water: it comes back full. The kid scoops the *spring*
 * (a WATER source) out of the world, and every cell that spring was feeding
 * loses its chain back to water, so the flood runs home (see core/water.ts):
 * a travelling cell can only stand on a deeper neighbour, so with the spring
 * gone the shallow puddles at the end of the reach are the first to fail, and
 * the whole cut-off flood is dry within a second — the same way the big game
 * lets a removed source empty the channel it was feeding.
 *
 * Full and aimed at a clear cell: it pours that spring back out, and the water
 * sets off spreading down and out again from where it landed.
 *
 * Only a source fills a bucket (like the big game): a handful of travelling
 * water is too thin to carry, and it teaches the difference between a spring
 * and a flood — which is the whole water sim in one sentence.
 */

import { AIR, isCrossBlock, isWaterId, WATER } from './blocks';
import { RayHit } from './raycast';
import { World } from './world';

export type BucketResult =
  | { ok: true; kind: 'filled'; x: number; y: number; z: number }
  | { ok: true; kind: 'poured'; x: number; y: number; z: number }
  | { ok: false; reason: 'nothing' | 'flow' | 'no-room'; x: number; y: number; z: number };

/** A cell a bucket may pour into: clear air, or a flower to be washed over. */
export function pourableAt(world: World, x: number, y: number, z: number): boolean {
  const id = world.get(x, y, z);
  return id === AIR || isCrossBlock(id);
}

/**
 * One press of the build button with a bucket in hand.
 * `aim` is what the kid is looking at; the bucket fills from that cell and
 * pours into the empty cell just in front of it (the same cell a block would
 * go into, so building and pouring feel identical to aim with).
 */
export function useBucket(world: World, full: boolean, aim: RayHit | null): BucketResult {
  if (!aim) return { ok: false, reason: 'nothing', x: 0, y: 0, z: 0 };

  if (!full) {
    // scooping: the cell the kid is looking at has to be a spring
    if (aim.block === WATER) {
      world.set(aim.x, aim.y, aim.z, AIR);
      return { ok: true, kind: 'filled', x: aim.x, y: aim.y, z: aim.z };
    }
    const reason = isWaterId(aim.block) ? 'flow' : 'nothing';
    return { ok: false, reason, x: aim.x, y: aim.y, z: aim.z };
  }

  // pouring: a source appears where the block would have gone
  const { px, py, pz } = aim;
  if (!world.inBounds(px, py, pz) || py <= 0 || !pourableAt(world, px, py, pz)) {
    return { ok: false, reason: 'no-room', x: px, y: py, z: pz };
  }
  world.set(px, py, pz, WATER);
  return { ok: true, kind: 'poured', x: px, y: py, z: pz };
}
