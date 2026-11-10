/**
 * Water flows the way it does in the big game — the rules here are Minecraft's:
 *
 *  • A source (WATER) is eternal and pushes water out: straight DOWN at the
 *    same depth, and SIDEWAYS up to exactly SEVEN cells (core depth 1..7), one
 *    step shallower per cell. `MAX_WATER_LEVEL` (7) is that reach — the tidy
 *    ring a flood stops at, not a runaway bound.
 *  • Surface heights are the nine steps of the big game: a source (and a
 *    full-strength plunge) stands 8/9, and travelling water loses exactly one
 *    ninth per cell of reach — level 7 draws 1/9. Submerged cells and falling
 *    columns draw full. (`waterSurfaceHeight`)
 *  • A cell with nothing under it does not lean — it falls STRAIGHT DOWN, the
 *    whole drop in one step, and a fall costs nothing: the drop lands at FULL
 *    STRENGTH, so a waterfall's pool runs the full seven again from where the
 *    water lands and a stream that steps down a hillside travels much farther
 *    than one that stays on the flat. A source over a hole stays put and pours.
 *  • Sideways spread is steered by the big game's flow weights: before it
 *    commits, a cell looks `DROP_SEARCH` cells of flat walking for a way down
 *    in each direction and only flows the ways that reach a drop soonest. A
 *    spring near an edge drains to it as a one-cell-wide stream instead of
 *    fanning out over every shelf; on flat ground with no drop in reach it
 *    spreads its seven cells symmetrically, as it always did.
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
 * supply it can see — a neighbour strictly deeper than itself, or a stream
 * falling into it from above — and wakes its neighbours when that depth
 * changes. Because "strictly deeper" is the only thing that holds a cell up,
 * a group of flow cells can never agree to support each other: the moment the
 * chain to a source goes, the shallowest cell fails and the failure walks back
 * down the channel towards where the water came from.
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

/** the four directions water can run sideways */
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * How far travelling water reaches from its supply: a source is level 0, the
 * cells it touches are level 1 … the outermost ring is level 7, and level 8
 * never gets written. A fall costs nothing (see `fall`), so the seven starts
 * again from where a waterfall lands — exactly as in the big game.
 */
export const MAX_WATER_LEVEL = 7;
/** game seconds between flow steps — water visibly creeps, ~5 cells a second */
const STEP_SECONDS = 0.2;
/** re-evaluations per round, so draining a flood never spikes a frame */
const STEP_BUDGET = 240;
/** how many cells deep one step may propagate a drain (see `drain`) */
const CASCADE_CELLS = 4;
/** how far sideways a cell looks, in cells of flat walking, for a way down */
const DROP_SEARCH = 4;
/** the weight a direction carries when no drop is anywhere near (the big game's 1000) */
const NO_WAY_DOWN = 1000;
/** how many falls one step may chain straight through (a long staircase) */
const FALL_CHAIN = 24;

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
  /**
   * How far the way-down search found a drop to walk to, per cell, for the
   * step in hand — terrain only moves between steps, so one cache per step.
   */
  private drops = new Map<number, number[]>();
  /** how deep into a drain cascade this step currently is (see `drain`) */
  private cascade = 0;
  /** how many falls this step has chained straight through (see `FALL_CHAIN`) */
  private chaining = 0;
  /**
   * Flow steps taken since the world was loaded. The e2e measures how long a
   * flood takes in *sim* steps rather than wall clock — headless Chromium runs
   * game time at roughly half speed, so a `waitForTimeout` guess is meaningless.
   */
  steps = 0;
  private acc = 0;

  constructor(private world: World) {}

  /** forget everything (a new world is being built) */
  reset(): void {
    this.dirty.clear();
    this.pouring.clear();
    this.drops.clear();
    this.acc = 0;
    this.steps = 0;
  }

  /**
   * Is this wet cell caught in a drop — water that is on its way down, so it
   * draws as a full cell and never leans sideways? The e2e uses it to tell a
   * waterfall's stream (fine) from water that piled up and stood there (not).
   */
  isPouring(x: number, y: number, z: number): boolean {
    return this.pouring.has(idx(x, y, z));
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
    this.steps++;
    this.cascade = 0;
    this.chaining = 0;
    this.drops.clear(); // the terrain under the flood may have moved
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
    if (!this.world.inBounds(x, y, z)) return false; // never write phantoms off the map's edge
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
    for (const [dx, dz] of SIDES) {
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
    // cut-off flood collapse from the shallow end inward), or a stream falling
    // in from above. A fall lands at full strength, so the cell it drops into
    // is held up at depth 0: that is the "depth value 0" of the big game's
    // block below a flow, and the reason a waterfall's pool starts its seven
    // cells over again instead of trickling out two cells past the cliff foot.
    const cur = this.world.waterLevel.get(i) ?? MAX_WATER_LEVEL;
    let best = MAX_WATER_LEVEL + 1;
    const above = this.levelAt(x, y + 1, z);
    if (above >= 0) best = Math.min(best, this.pouring.has(idx(x, y + 1, z)) ? 0 : above);
    for (const [dx, dz] of SIDES) {
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
    for (const [dx, dz] of SIDES) {
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

  /** somewhere water could go: empty, a plant it can wash over, or its own channel */
  private flowable(x: number, y: number, z: number): boolean {
    if (!this.world.inBounds(x, y, z)) return false;
    const id = this.world.get(x, y, z);
    return isWaterId(id) || id === AIR || isCrossBlock(id);
  }

  /**
   * Where water goes from a cell `level` deep. Three rules, and they are the
   * whole shape language:
   *
   *   1. a cell with nothing under it falls STRAIGHT DOWN, the whole drop in
   *      one step, and lands at full strength — the pool runs the full reach
   *      again from where the water lands;
   *   2. a cell still caught in a drop goes down and nowhere else, which is
   *      what keeps a waterfall one cell wide instead of a curtain;
   *   3. everything else spreads SIDEWAYS, one step shallower (to a cap of
   *      seven cells from the supply), and only towards the nearest way down
   *      (see `flowWeights`) — so a hillside gets a narrow stream down the
   *      fall rather than a shallow lake over every shelf. Reach only ever
   *      holds water back on the flat: a thin cell perched beside a drop
   *      still goes over it, because down outranks distance.
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
      const landed = this.fall(x, this.world.get(x, y, z) === WATER ? y - 1 : y, z, level);
      this.cascadeFall(x, landed, z);
      return;
    }
    const weights = this.flowWeights(x, y, z);
    const best = Math.min(...weights);
    for (let d = 0; d < SIDES.length; d++) {
      if (weights[d] > best) continue; // the big game only flows the lowest-weight ways
      const [dx, dz] = SIDES[d];
      const tx = x + dx, tz = z + dz;
      if (this.supported(tx, y, tz)) {
        if (level >= MAX_WATER_LEVEL) continue; // reach, not terrain, ends a flood on the flat
        this.setFlow(tx, y, tz, level + 1);
      } else {
        // out of ground: over the edge, straight down, and it runs again from
        // wherever it comes to rest — the "great angle" the eye expects. The
        // big game checks down before reach, so even the thin last cell of a
        // reach pours off a cliff it happens to be sitting next to.
        const landed = this.fall(tx, y, tz, level + 1);
        this.cascadeFall(tx, landed, tz);
      }
    }
  }

  /**
   * Let a fall that just landed start spreading in the SAME step, so a long
   * staircase drains top to bottom in a couple of steps instead of one step
   * per step. Bounded by `FALL_CHAIN`; anything deeper is already dirty and
   * goes on the next step.
   */
  private cascadeFall(x: number, y: number, z: number): void {
    if (y <= 0 || this.chaining >= FALL_CHAIN) return;
    if (this.pouring.has(idx(x, y, z))) return; // still mid-drop: nothing to spread
    this.chaining++;
    this.spread(x, y, z, this.levelAt(x, y, z));
    this.chaining--;
  }

  /**
   * A drop: fill a column from `start` down to wherever it finally finds
   * ground, one falling cell per block so the waterfall draws as one
   * continuous ribbon instead of a dotted line. Everything below the first
   * cell lands at FULL strength (the big game gives the block under a flow a
   * depth of 0), which is why a pool at the foot of a fall spreads its whole
   * seven cells even when the stream that fed it was a thin trickle, and why
   * a fall never leaves a tall stack of shallow water standing where the
   * ground gave out. Cells left in mid-air are marked as falling (see
   * `spread`); the one that lands is not, so that is where a stream starts to
   * spread out again. A drop that meets water hands its strength to that
   * surface, which is what stops a waterfall pouring into a pond from just
   * stacking a column over it.
   * @returns the cell the drop came to rest in, 0 when it hit rock
   */
  private fall(x: number, start: number, z: number, level: number): number {
    let fy = start;
    while (fy > 0) {
      if (!this.world.inBounds(x, fy, z)) return 0;
      const cur = this.world.get(x, fy, z);
      if (isWaterId(cur) && fy !== start) {
        // the stream ran into water: the surface it met takes the full supply
        const j = idx(x, fy, z);
        if (cur === WATER_FLOW && this.world.flowLevelAt(x, fy, z) > 0) {
          this.world.waterLevel.set(j, 0);
          this.world.touchAt(x, z);
          this.dirty.add(j);
          this.notify(x, fy, z);
        }
        return fy;
      }
      if (!this.setFlow(x, fy, z, fy === start ? level : 0)) return 0; // solid: the drop ends here
      const j = idx(x, fy, z);
      if (this.standsOnGround(x, fy, z)) {
        this.pouring.delete(j); // the foot of the fall: this is where it runs sideways again
        return fy;
      }
      this.pouring.add(j);
      fy--;
    }
    return 0;
  }

  /** solid ground directly under this cell — water's idea of a footing */
  private standsOnGround(x: number, y: number, z: number): boolean {
    return solidHeightOf(this.world.get(x, y - 1, z)) > 0;
  }

  /**
   * The big game's flow weights: every direction a cell could flow to starts
   * at `NO_WAY_DOWN`, and the ones that can reach a drop by walking no more
   * than `DROP_SEARCH` cells of flat ground take the distance to it. `spread`
   * then only flows the lowest-weight ways, so water beelines for the edge —
   * one cell wide — and only fans out over flat floors where nothing drops.
   */
  private flowWeights(x: number, y: number, z: number): number[] {
    const key = idx(x, y, z);
    const seen = this.drops.get(key);
    if (seen) return seen;
    const weights = SIDES.map(([dx, dz]) => this.dropDistance(x, y, z, dx, dz));
    this.drops.set(key, weights);
    return weights;
  }

  /**
   * How far the cell this water would flow into is from a way down: 0 when
   * that very cell has no ground under it (the edge), n when the drop is n
   * cells of flat walking beyond it, `NO_WAY_DOWN` when nothing gives out
   * within `DROP_SEARCH`.
   */
  private dropDistance(x: number, y: number, z: number, dx: number, dz: number): number {
    const sx = x + dx, sz = z + dz;
    if (!this.flowable(sx, y, sz)) return NO_WAY_DOWN; // a wall is not a direction
    if (!this.supported(sx, y, sz)) return 0; // the next cell is the edge
    const seen = new Set<number>([idx(sx, y, sz)]);
    let frontier = [idx(sx, y, sz)];
    for (let step = 1; step <= DROP_SEARCH && frontier.length; step++) {
      const next: number[] = [];
      for (const j of frontier) {
        const [cx, , cz] = unidx(j);
        for (const [ax, az] of SIDES) {
          const nx = cx + ax, nz = cz + az;
          if (!this.flowable(nx, y, nz)) continue;
          if (!this.supported(nx, y, nz)) return step; // found a way down this far out
          const k = idx(nx, y, nz);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push(k);
        }
      }
      frontier = next;
    }
    return NO_WAY_DOWN;
  }
}
