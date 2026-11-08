/**
 * Water flows like the big game: a source (WATER) is eternal and pushes
 * water into the air around it — straight down at the same depth, sideways
 * one step shallower (core depth 0..6). Travelling water (WATER_FLOW) shows
 * how deep its supply is: it shallows as it spreads, piles into pits, and —
 * when its chain back to a source is broken — dries up cell by cell, starting
 * at the shallow end and working back towards the spring. That is also what
 * pulling a spring out with a bucket looks like: the flood runs home.
 *
 * Falling water plunges (see FALL_REACH), so digging a shaft under a puddle
 * empties it down the shaft in one step instead of creeping down it.
 *
 * The sim is event-driven through `World.onCellChanged`: only cells near a
 * change get re-evaluated, so the sea sits perfectly still until somebody
 * digs into it. Each step re-reads every dirty cell's depth from the best
 * supply it can see (a neighbour one step deeper, or water falling in from
 * above) and wakes its neighbours when that depth changes — so cutting a
 * chain makes levels climb until they fall past the reach limit and drain.
 * A group of flow cells can never agree to support each other forever: the
 * shallowest one always needs someone deeper.
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

/** max horizontal reach of a source, in cells (Minecraft's water is 7) */
export const MAX_WATER_LEVEL = 6;
/** game seconds between flow steps — water visibly creeps, ~5 cells a second */
const STEP_SECONDS = 0.2;
/** re-evaluations per step, so draining a flood never spikes a frame */
const STEP_BUDGET = 240;
/** how deep a source's surface sits below the top of its cell (the big game
 *  draws water a hair under the block line, and that is what makes a shoreline
 *  read as water rather than as a blue cube) */
export const SOURCE_SURFACE = 0.92;
/** a puddle at the end of a source's reach is never drawn thinner than this */
export const MIN_WATER_SURFACE = 0.22;
/** how far one step lets falling water plunge, in cells */
const FALL_REACH = 24;

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
  const below = world.get(x, y - 1, z);
  if (!isWaterId(below) && solidHeightOf(below) <= 0) return 1; // falling: a full column
  if (id === WATER) return SOURCE_SURFACE;
  const level = world.flowLevelAt(x, y, z);
  return Math.max(MIN_WATER_SURFACE, SOURCE_SURFACE - level * 0.12);
}

export class WaterFlow {
  /** flat indices of water cells that need re-thinking on the next step */
  private dirty = new Set<number>();
  private acc = 0;

  constructor(private world: World) {}

  /** forget everything (a new world is being built) */
  reset(): void {
    this.dirty.clear();
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

  private step(): void {
    if (this.dirty.size === 0) return;
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
    this.notify(x, y, z);
  }

  private evaluate(i: number): void {
    const [x, y, z] = unidx(i);
    const id = this.world.get(x, y, z);
    if (id === WATER) {
      this.spread(x, y, z, 0);
      return;
    }
    if (id !== WATER_FLOW) return;

    // best supply: a neighbour one step deeper, or water falling in from above
    let best = MAX_WATER_LEVEL + 1;
    const above = this.levelAt(x, y + 1, z);
    if (above >= 0) best = Math.min(best, above); // falling water keeps its depth
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const l = this.levelAt(x + dx, y, z + dz);
      if (l >= 0) best = Math.min(best, l + 1);
    }
    if (best > MAX_WATER_LEVEL) {
      this.drain(x, y, z); // no chain back to any source: it dries up
      return;
    }
    if (best !== (this.world.waterLevel.get(i) ?? MAX_WATER_LEVEL)) {
      this.world.waterLevel.set(i, best);
      this.world.touchAt(x, z); // shape changed (same id): remesh + autosave
      // a shallower cell here means every neighbour's supply got worse too —
      // wake them, or a cut-off flood would hold itself up forever
      this.notify(x, y, z);
    }
    this.spread(x, y, z, best);
  }

  private spread(x: number, y: number, z: number, level: number): void {
    // Water falls first, and it falls the whole way down: a cliff or a freshly
    // dug shaft fills in one step instead of creeping down it a cell at a time,
    // the way water drops in the big game.
    let fy = y;
    for (let n = 0; n < FALL_REACH && fy > 1; n++) {
      if (!this.setFlow(x, fy - 1, z, level)) break;
      fy--;
    }
    if (level < MAX_WATER_LEVEL) {
      // side spread regardless of what is under the target — water reaching
      // the edge of a ledge pours over it, like the big game
      this.setFlow(x + 1, y, z, level + 1);
      this.setFlow(x - 1, y, z, level + 1);
      this.setFlow(x, y, z + 1, level + 1);
      this.setFlow(x, y, z - 1, level + 1);
    }
  }
}
