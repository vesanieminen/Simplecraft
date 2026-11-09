/**
 * Water flows like the big game: a source (WATER) is eternal and pushes
 * water into the air around it — straight down at the same depth, sideways
 * one step shallower (core depth 0..24) and ONLY where there is ground under
 * the target cell. Travelling water (WATER_FLOW) shows how deep its supply is:
 * it shallows as it spreads, piles into pits, and — when its chain back to a
 * source is broken — dries up from the shallow end inward. That is also what
 * pulling a spring out with a bucket looks like: the flood runs home.
 *
 * Falling water plunges the whole way in one step, so digging a shaft under a
 * puddle empties it down the shaft instead of creeping down it. Over a ledge,
 * water drops rather than leaning out, and a cell left in mid-air feeds only
 * the column under it (see `pouring`): the hillside gets a waterfall, not a
 * shelf of blue slabs hanging in the air.
 *
 * The sim is event-driven through `World.onCellChanged`: only cells near a
 * change get re-evaluated, so the sea sits perfectly still until somebody
 * digs into it. Each step re-reads every dirty cell's depth from the best
 * supply it can see — a neighbour strictly deeper than itself, or water
 * falling in from above — and wakes its neighbours when that depth changes.
 * Because "strictly deeper" is the only thing that holds a cell up, a group of
 * flow cells can never agree to support each other: the moment the chain to a
 * source goes, the shallowest cell fails and the failure walks back down the
 * channel towards where the water came from.
 *
 * `waterSurfaceHeight` turns a cell's depth into the height the mesher draws,
 * so a shallow flood lies flat and a source stands nearly full.
 */

import { AIR, isCrossBlock, isWaterId, solidHeightOf, WATER, WATER_FLOW } from './blocks';
import { idx, World, WORLD_SY, WORLD_SZ } from './world';

/** flat index back to x/y/z — the inverse of World.idx */
function unidx(i: number): [number, number, number] {
  const x = Math.floor(i / (WORLD_SZ * WORLD_SY));
  const rest = i - x * WORLD_SZ * WORLD_SY;
  const z = Math.floor(rest / WORLD_SY);
  return [x, rest - z * WORLD_SY, z];
}

/**
 * How deep a flow cell can get before it gives up, in depth steps. This is a
 * safety bound, not the reach the player sees: what actually stops water is
 * running out of ground to stand on (see `supported`), and a cut-off flood
 * collapses from the shallow end long before this. It stays generous (24) so a
 * stream running off a hill never visibly stops at a tidy ring the way the old
 * six-cell limit did.
 */
export const MAX_WATER_LEVEL = 24;
/** game seconds between flow steps — water visibly creeps, ~5 cells a second */
const STEP_SECONDS = 0.2;
/** re-evaluations per round, so draining a flood never spikes a frame */
const STEP_BUDGET = 240;
/** how many cells deep one step may propagate a drain (see `drain`) */
const CASCADE_CELLS = 4;
/** how deep a source's surface sits below the top of its cell (the big game
 *  draws water a hair under the block line, and that is what makes a shoreline
 *  read as water rather than as a blue cube) */
export const SOURCE_SURFACE = 0.92;
/** a puddle at the end of a source's reach is never drawn thinner than this */
export const MIN_WATER_SURFACE = 0.22;
/** how fast the surface falls away with depth, per level. Deliberately gentle:
 *  a five-cell soak should read as a damp sheet, not as a staircase of tiles. */
const SURFACE_STEP = 0.06;

/**
 * How high the water in a cell is drawn, 0..1 of the cell. This is the shape
 * language of a flood: a source stands nearly full, travelling water shallows
 * one step per cell away from it, and a column pouring through the air draws
 * full so a waterfall reads as a waterfall instead of a floating ribbon.
 * (Physics keeps treating every wet cell as a whole cell — this is the look.)
 */
export function waterSurfaceHeight(world: World, x: number, y: number, z: number): number {
  const id = world.get(x, y, z);
  if (!isWaterId(id)) return 0;
  if (isWaterId(world.get(x, y + 1, z))) return 1; // submerged: the surface is higher up the column
  const below = world.get(x, y - 1, z);
  if (!isWaterId(below) && solidHeightOf(below) <= 0) return 1; // falling: a full column
  if (id === WATER) return SOURCE_SURFACE;
  if (isWaterId(below)) return SOURCE_SURFACE; // the brim of a body of water, not a sheet
  // a one-cell sheet lying on the ground: the reach it is at says how thin
  const level = world.flowLevelAt(x, y, z);
  return Math.max(MIN_WATER_SURFACE, SOURCE_SURFACE - level * SURFACE_STEP);
}

export class WaterFlow {
  /** flat indices of water cells that need re-thinking on the next step */
  private dirty = new Set<number>();
  /**
   * Cells a drop left in mid-air. They are water, they may even have water
   * under them, but they are falling and must not spread sideways (see
   * `spread`). Cleared as soon as a cell comes to rest on solid ground.
   */
  private pouring = new Set<number>();
  /** how deep into a drain cascade this step currently is (see `drain`) */
  private cascade = 0;
  private acc = 0;

  constructor(private world: World) {}

  /** forget everything (a new world is being built) */
  reset(): void {
    this.dirty.clear();
    this.pouring.clear();
    this.acc = 0;
  }

  /** how much of a cell is water: -1 dry, 0 deep … MAX_WATER_LEVEL puddle */
  private levelAt(x: number, y: number, z: number): number {
    const id = this.world.get(x, y, z);
    if (id === WATER) return 0;
    if (id === WATER_FLOW) return this.world.waterLevel.get(idx(x, y, z)) ?? MAX_WATER_LEVEL;
    return -1;
  }

  /**
   * The world hook: any changed cell wakes the water around it. Terrain
   * generation writes cells directly (no hook), exactly like sand — a fresh
   * world's sea starts still.
   */
  notify(x: number, y: number, z: number): void {
    const wake = (xx: number, yy: number, zz: number): void => {
      if (isWaterId(this.world.get(xx, yy, zz))) this.dirty.add(idx(xx, yy, zz));
    };
    wake(x, y, z);
    wake(x + 1, y, z); wake(x - 1, y, z);
    wake(x, y + 1, z); wake(x, y - 1, z);
    wake(x, y, z + 1); wake(x, y, z - 1);
  }

  update(dt: number): void {
    this.acc += dt;
    while (this.acc >= STEP_SECONDS) {
      this.acc -= STEP_SECONDS;
      this.step();
    }
  }

  /**
   * One flow step: whatever the changes dirtied, plus the cascade each drained
   * cell started (see `drain`).
   */
  private step(): void {
    if (this.dirty.size === 0) return;
    this.cascade = 0;
    const batch: number[] = [];
    for (const i of this.dirty) {
      batch.push(i);
      this.dirty.delete(i);
      if (batch.length >= STEP_BUDGET) break;
    }
    for (const i of batch) this.evaluate(i);
  }

  /**
   * Fill one cell with travelling water `level` deep.
   * @returns true when the cell ends up holding water at least that deep —
   *   which is how a falling column knows it may keep falling through it.
   */
  private setFlow(x: number, y: number, z: number, level: number): boolean {
    const i = idx(x, y, z);
    const cur = this.world.get(x, y, z);
    if (cur === WATER) return false; // a source is always deeper than any flow
    if (cur === WATER_FLOW) {
      if ((this.world.waterLevel.get(i) ?? MAX_WATER_LEVEL) <= level) return true; // already at least this deep
    } else if (cur !== AIR && !isCrossBlock(cur)) {
      return false; // solid things stand their ground
    }
    // water washes over flowers and grass tufts
    this.world.set(x, y, z, WATER_FLOW);
    this.world.waterLevel.set(i, level);
    if (cur === WATER_FLOW) this.world.touchAt(x, z); // same id, deeper now: remesh
    // a deeper cell here re-evaluates itself and everything next to it
    this.dirty.add(i);
    this.notify(x, y, z);
    return true;
  }

  private drain(x: number, y: number, z: number): void {
    this.world.set(x, y, z, AIR);
    this.pouring.delete(idx(x, y, z));
    this.notify(x, y, z);
    // Whatever was upstream just lost the only thing holding it up, so let it
    // know in the SAME step: that is the wave that runs back up a cut channel
    // when a kid scoops the spring out, instead of a queue of cells each
    // waiting their turn. It is capped at CASCADE_CELLS deep per step so the
    // dry line visibly travels rather than teleporting.
    if (this.cascade >= CASCADE_CELLS) return;
    this.cascade++;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (this.world.get(nx, y, nz) === WATER_FLOW) this.evaluate(idx(nx, y, nz));
    }
    if (this.world.get(x, y + 1, z) === WATER_FLOW) this.evaluate(idx(x, y + 1, z));
    this.cascade--;
  }

  private evaluate(i: number): void {
    const [x, y, z] = unidx(i);
    const id = this.world.get(x, y, z);
    if (id === WATER) {
      this.spread(x, y, z, 0);
      return;
    }
    if (id !== WATER_FLOW) return;

    // Best supply: a horizontally adjacent cell that is DEEPER than us (only a
    // strictly deeper neighbour can hold water up — that is what stops a pond
    // from propping itself up when its spring goes away, and what makes a
    // cut-off flood collapse from the shallow end inward), or water falling in
    // from above, which keeps its depth.
    const cur = this.world.waterLevel.get(i) ?? MAX_WATER_LEVEL;
    let best = MAX_WATER_LEVEL + 1;
    const above = this.levelAt(x, y + 1, z);
    if (above >= 0) best = Math.min(best, above); // falling water keeps its depth
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const l = this.levelAt(x + dx, y, z + dz);
      if (l >= 0 && l < cur) best = Math.min(best, l + 1);
    }
    if (best > MAX_WATER_LEVEL) {
      this.drain(x, y, z); // nothing deeper beside or above it: it dries up
      return;
    }
    if (best !== cur) {
      this.world.waterLevel.set(i, best);
      this.world.touchAt(x, z); // shape changed (same id): remesh + autosave
      // a shallower cell here means every neighbour's supply got worse too —
      // wake them, or a cut-off flood would hold itself up forever
      this.notify(x, y, z);
    }
    this.spread(x, y, z, best);
  }

  /**
   * Something to stand on: water only spreads sideways into a cell with ground
   * (or settled water) under it. Over an edge it does not lean out — it drops
   * straight down instead, which is what a waterfall is, and it is the whole
   * reason a hillside flood stopped drawing as a stack of blue slabs hanging
   * in the air. Water below counts as a footing: that is how a pit fills level
   * by level instead of only ever in the one column under the spring. Holding a
   * cell UP is a different question, and `evaluate` answers it the strict way.
   */
  private supported(x: number, y: number, z: number): boolean {
    const below = this.world.get(x, y - 1, z);
    return isWaterId(below) || solidHeightOf(below) > 0;
  }

  /**
   * Where water goes from a cell `level` deep. Two rules, and they are the
   * whole shape language:
   *
 *   1. a cell with something under it spreads SIDEWAYS, one step shallower,
   *      and only into neighbours that have something under them too;
   *   2. a cell with nothing under it does not lean — it falls STRAIGHT DOWN.
   *
   * That is the 90° the old version got wrong. It let a sheet spread into thin
   * air beside every step of a hillside and hang there, so a flood on a slope
   * drew as a diagonal stack of blue plates. Now a hillside gets a waterfall:
   * the water runs along each flat until it runs out of ground, drops the whole
   * way to the next flat, and runs from there.
   */
  private spread(x: number, y: number, z: number, level: number): void {
    const i = idx(x, y, z);
    if (this.standsOnGround(x, y, z)) this.pouring.delete(i); // settled: it may spread again
    // Falling water goes down and nowhere else, and it falls the whole way in
    // one step. That is the 90° the old model got wrong: because a drop's own
    // cells were free to spread sideways from mid-air, one spring at the top of
    // a hill backed the whole slope up into a shallow lake and left blue plates
    // hanging over the steps. A cell in mid-air — or one a drop put there —
    // only ever feeds the column below it, so the water lands, and only then
    // starts running again from where it landed.
    if (!this.supported(x, y, z) || this.pouring.has(i)) {
      this.fall(x, y, z, level);
      return;
    }
    if (level >= MAX_WATER_LEVEL) return; // the safety bound, not a ring the player sees
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const tx = x + dx, tz = z + dz;
      if (this.supported(tx, y, tz)) this.setFlow(tx, y, tz, level + 1);
      else this.fall(tx, y, tz, level + 1); // out of ground: over the edge, straight down
    }
  }

  /**
   * A drop: fill a column from `y` down to wherever it finally finds ground,
   * one falling cell per block so the waterfall draws as one continuous ribbon
   * instead of a dotted line. Cells left in mid-air are marked as falling (see
   * `spread`); the one that lands is not, so that is where a stream starts to
   * spread out again.
   */
  private fall(x: number, y: number, z: number, level: number): void {
    let fy = y;
    while (fy > 1) {
      if (!this.setFlow(x, fy, z, level)) break; // a wall, or a deeper source
      const j = idx(x, fy, z);
      if (this.standsOnGround(x, fy, z)) this.pouring.delete(j);
      else this.pouring.add(j);
      fy--;
    }
  }

  /** solid ground directly under this cell — water's idea of a footing */
  private standsOnGround(x: number, y: number, z: number): boolean {
    return solidHeightOf(this.world.get(x, y - 1, z)) > 0;
  }
}
