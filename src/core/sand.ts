/**
 * Sand obeys gravity: a sand block with nothing under it drops straight
 * down — through air, sinking through water, squashing the little plants it
 * lands on, and coming to rest on the first solid thing (gently; a kid
 * caught underneath just gets a soft thud over their head, never hurt).
 *
 * The sim only watches sand it has been told about: every changed cell
 * notifies the sand at and above it, so digging out under a sand cliff
 * starts the whole column — each cell's own `world.set` re-notifies the one
 * above it, and they all tumble down together.
 */

import {
  AIR, BlockId, isCrossBlock, isSolidBlock, SAND, WATER,
} from './blocks';
import { idx, World, WORLD_SY, WORLD_SZ } from './world';

/** game seconds between drop steps — sand falls ~8 cells a second */
const STEP_SECONDS = 0.12;
/** how many cells one step may move, so a demolished sandcastle never spikes the frame */
const STEP_BUDGET = 48;

export interface SandHooks {
  /** something precious occupies this cell: sand comes to rest above it */
  blockedAt(x: number, y: number, z: number): boolean;
  /** falling sand finished its trip: a soft sandy thud, please */
  landed(x: number, y: number, z: number): void;
  /** falling sand squashed a plant (flower, tallgrass, sapling) on the way down */
  crushed(x: number, y: number, z: number, id: BlockId): void;
}

/** flat index back to x/y/z — the inverse of World.idx */
function unidx(i: number): [number, number, number] {
  const x = Math.floor(i / (WORLD_SZ * WORLD_SY));
  const rest = i - x * WORLD_SZ * WORLD_SY;
  const z = Math.floor(rest / WORLD_SY);
  return [x, rest - z * WORLD_SY, z];
}

export class SandGravity {
  /** flat indices of sand cells known to be unsupported */
  private falling = new Set<number>();
  /** of those, the ones that have actually moved at least once (landing = thud) */
  private moved = new Set<number>();
  private acc = 0;

  constructor(private world: World, private hooks: SandHooks) {}

  /** forget everything we were watching (a new world is being built) */
  reset(): void {
    this.falling.clear();
    this.moved.clear();
    this.acc = 0;
  }

  /** how many sand cells are currently falling (tests like a quiet number) */
  get fallingCount(): number {
    return this.falling.size;
  }

  /**
   * The cell at (x,y,z) changed: does the sand at it or right above it need
   * to start falling? The sim's own `world.set`s land here too, which is how
   * a column keeps going once the first block lets go.
   */
  notify(x: number, y: number, z: number): void {
    this.track(x, y, z);
    this.track(x, y + 1, z);
  }

  private track(x: number, y: number, z: number): void {
    if (y > 1 && this.world.get(x, y, z) === SAND && !this.supported(x, y, z)) {
      this.falling.add(idx(x, y, z));
    }
  }

  /** is there something solid to rest on in the cell directly below? water is not. */
  private supported(x: number, y: number, z: number): boolean {
    return y <= 1 || isSolidBlock(this.world.get(x, y - 1, z));
  }

  /** advance on game time (skipped while the world is frozen) */
  update(dt: number): void {
    this.acc = Math.min(this.acc + dt, 0.5); // never let a lag spike dump a burst
    while (this.acc >= STEP_SECONDS) {
      this.acc -= STEP_SECONDS;
      this.step();
    }
  }

  /** one drop step: every watched sand cell moves one cell down or lands */
  private step(): void {
    const w = this.world;
    let budget = STEP_BUDGET;
    // snapshot, so a block never drops more than one cell per step no matter
    // what the sim's own notifies add mid-step
    for (const i of Array.from(this.falling)) {
      if (budget <= 0) break;
      budget--;
      const [x, y, z] = unidx(i);
      if (w.get(x, y, z) !== SAND) {
        this.falling.delete(i);
        this.moved.delete(i);
        continue;
      }
      if (this.supported(x, y, z) || this.hooks.blockedAt(x, y - 1, z)) {
        this.land(i, x, y, z);
        continue;
      }
      const below = w.get(x, y - 1, z);
      const j = idx(x, y - 1, z);
      if (below === WATER) {
        w.set(x, y - 1, z, SAND);
        w.set(x, y, z, WATER); // the displaced water slides up into the freed cell
      } else {
        if (isCrossBlock(below)) {
          this.hooks.crushed(x, y - 1, z, below);
          w.set(x, y - 1, z, AIR);
        }
        w.set(x, y - 1, z, SAND);
        w.set(x, y, z, AIR);
      }
      this.falling.delete(i);
      this.moved.delete(i);
      this.falling.add(j);
      this.moved.add(j);
    }
  }

  private land(i: number, x: number, y: number, z: number): void {
    this.falling.delete(i);
    if (this.moved.delete(i)) this.hooks.landed(x, y, z);
  }
}
