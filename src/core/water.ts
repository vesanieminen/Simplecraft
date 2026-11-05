/**
 * Water flows like the big game: a source (WATER) is eternal and pushes
 * water into the air around it — straight down at the same depth, sideways
 * one step shallower (core depth 0..6). Travelling water (WATER_FLOW) shows
 * how deep its supply is: it shallows as it spreads, piles into pits, and —
 * when its chain back to a source is broken — dries up cell by cell.
 *
 * The sim is event-driven through `World.onCellChanged`: only cells near a
 * change get re-evaluated, so the sea sits perfectly still until somebody
 * digs into it. Each step re-reads every dirty cell's depth from the best
 * supply it can see (a neighbour one step deeper, or water falling in from
 * above) and wakes its neighbours when that depth changes — so cutting a
 * chain makes levels climb until they fall past the reach limit and drain.
 * A group of flow cells can never agree to support each other forever: the
 * shallowest one always needs someone deeper.
 */

import { AIR, isCrossBlock, isWaterId, WATER, WATER_FLOW } from './blocks';
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

  private setFlow(x: number, y: number, z: number, level: number): void {
    const i = idx(x, y, z);
    const cur = this.world.get(x, y, z);
    if (cur === WATER) return; // a source is always deeper than any flow
    if (cur === WATER_FLOW && (this.world.waterLevel.get(i) ?? MAX_WATER_LEVEL) <= level) return;
    // water washes over flowers and grass tufts; solid things stand their ground
    if (cur !== AIR && !isCrossBlock(cur)) return;
    this.world.set(x, y, z, WATER_FLOW);
    this.world.waterLevel.set(i, level);
    if (cur === WATER_FLOW) this.world.touchAt(x, z); // same id, deeper now: remesh
    // a deeper cell here re-evaluates itself and everything next to it
    this.dirty.add(i);
    this.notify(x, y, z);
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
    if (y > 1) this.setFlow(x, y - 1, z, level); // pours straight down, full depth
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
