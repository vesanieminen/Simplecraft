/**
 * Water flows the way it does in the big game — the rules here are Minecraft's:
 *
 *  • A source (WATER) is eternal and pushes water out: straight DOWN at the
 *    same depth, and SIDEWAYS up to exactly SEVEN cells (core depth 1..7), one
 *    step shallower per cell. `MAX_WATER_LEVEL` (7) is that reach — the tidy
 *    ring a flood stops at, not a runaway bound.
 *  • Surface heights are the nine steps of the big game: a source (and a
 *    level-0 plunge) stands 8/9, and travelling water loses exactly one ninth
 *    per cell of reach — level 7 draws 1/9. Submerged cells and falling
 *    columns draw full. (`waterSurfaceHeight`)
 *  • A cell with nothing under it does not lean — it falls STRAIGHT DOWN and
 *    keeps its depth, so a waterfall lands full-strength and its pool runs the
 *    full seven again from the base. A source over a hole stays put and pours.
 *  • Two sources FEED A THIRD: a flow cell with two source blocks beside it —
 *    or one beside and one above — has enough supply to become a source itself.
 *    That is the 2×2 scoop and the infinite-water farm.
 *  • Where our model deliberately diverges from Java: a flood cut off from its
 *    chain to a source DRIES from the shallow end inward (Bedrock behaviour,
 *    and the one the water bucket depends on — pull the spring and the flood
 *    runs home). Java's water never drains on its own.
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
 * How far travelling water reaches from its supply: a source is level 0, the
 * cells it touches are level 1 … the outermost ring is level 7, and level 8
 * never gets written. Falling water keeps its level, so the seven starts
 * again from where a waterfall lands — exactly as in the big game.
 */
export const MAX_WATER_LEVEL = 7;
/** game seconds between flow steps — water visibly creeps, ~5 cells a second */
const STEP_SECONDS = 0.2;
/** re-evaluations per round, so draining a flood never spikes a frame */
const STEP_BUDGET = 240;
/** how many cells deep one step may propagate a drain (see `drain`) */
const CASCADE_CELLS = 4;

/**
 * How high the water in a cell is drawn, 0..1 of the cell — the nine steps of
 * the big game's fluid surface: (8 − level) / 9, so a source or a full-strength
 * plunge stands 8/9 and the last cell of a reach draws a thin 1/9 sheet.
 * Submerged cells (water above) and cells caught mid-fall draw full, so a
 * waterfall reads as a waterfall instead of a floating ribbon.
 * (Physics keeps treating every wet cell as a whole cell — this is the look.)
 */
export function waterSurfaceHeight(world: World, x: number, y: number, z: number): number {
  const id = world.get(x, y, z);
  if (!isWaterId(id)) return 0;
  if (isWaterId(world.get(x, y + 1, z))) return 1; // submerged: the surface is higher up the column
  const below = world.get(x, y - 1, z);
  if (!isWaterId(below) && solidHeightOf(below) <= 0) return 1; // falling: a full column
  const level = id === WATER ? 0 : world.flowLevelAt(x, y, z);
  return (8 - Math.max(0, Math.min(MAX_WATER_LEVEL, level))) / 9;
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

    // Two sources feed a third: a flow with source water squeezing in from two
    // sides — beside-beside, or beside-below a source — has enough supply to
    // become a source itself. This is the 2×2 scoop, the infinite-water farm,
    // and why digging a corner off the sea leaves a spring behind.
    if (this.makesSource(x, y, z)) {
      this.world.waterLevel.delete(i);
      this.world.set(x, y, z, WATER); // different id: world.set remeshes + wakes all sims
      this.spread(x, y, z, 0);
      return;
    }

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
   * Enough supply for a flow cell to become a source (see `evaluate`): two
   * sources squeezing in from the sides, or one from the side with another
   * one sitting right above. A source is never born in mid-air — the cell
   * needs ground or settled water under it, same as in the big game.
   */
  private makesSource(x: number, y: number, z: number): boolean {
    if (!this.supported(x, y, z)) return false;
    let side = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (this.world.get(x + dx, y, z + dz) === WATER) side++;
    }
    if (side >= 2) return true;
    return side >= 1 && this.world.get(x, y + 1, z) === WATER;
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
   *   1. a cell with something under it spreads SIDEWAYS, one step shallower
   *      (to a cap of seven cells from the supply), and only into neighbours
   *      that have something under them too;
   *   2. a cell with nothing under it does not lean — it falls STRAIGHT DOWN,
   *      keeping its depth, so the pool at the bottom runs the full reach
   *      again from where the water landed.
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
    // one step. Because a drop's own cells were once free to spread sideways
    // from mid-air, one spring at the top of a hill backed the whole slope up
    // into a shallow lake and left blue plates hanging over the steps. A cell
    // in mid-air — or one a drop put there — only ever feeds the column below
    // it, so the water lands, and only then starts running again.
    if (!this.supported(x, y, z) || this.pouring.has(i)) {
      // A source over a hole never moves: it stays full and pours from its
      // underside, the way a spring poured into a dug shaft does.
      this.fall(x, this.world.get(x, y, z) === WATER ? y - 1 : y, z, level);
      return;
    }
    if (level >= MAX_WATER_LEVEL) return; // seven cells out is the reach, full stop
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
