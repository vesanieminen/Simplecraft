/**
 * Voxel world storage. Fixed-size deterministic world (128 x 128 x 64).
 * Generated terrain is stored in `data`; player edits live in `mods` so that
 * the base world can always be regenerated from the seed + theme.
 */

import { AIR, BlockId, ROCK, isSolidBlock, isWaterId, WATER_FLOW } from './blocks';

export const WORLD_SX = 128;
export const WORLD_SY = 64; // height
export const WORLD_SZ = 128;
export const WATER_LEVEL = 9;
export const CHUNK = 16;
export const CHUNKS_X = WORLD_SX / CHUNK;
export const CHUNKS_Z = WORLD_SZ / CHUNK;

export function idx(x: number, y: number, z: number): number {
  return (x * WORLD_SZ + z) * WORLD_SY + y;
}

/** the save format this build writes; the server pins the same number */
export const SAVE_VERSION = 6;

export interface WorldSaveData {
  version: number;
  seed: number;
  /** world theme index (see WORLD_THEMES); 0 = classic meadow */
  theme?: number;
  /** map of flat index -> block id (player modifications only) */
  mods: Record<string, number>;
  /** indices of collected star pickups */
  collectedStars: number[];
  /**
   * Which way each placed door swings: flat index -> 0 (panel thin along X)
   * or 1 (thin along Z). Doors remember this even while open, so the panel
   * stands where the kid meant it to. Added in version 2.
   */
  doorFacing?: Record<string, number>;
  /**
   * Which way each stair points: flat index -> which half of the cell is the
   * tall part (see core/blocks.ts StairFacing). Added in version 3.
   */
  stairFacing?: Record<string, number>;
  /**
   * Travelling water (core/water.ts): flat index -> flow depth (0 deepest by
   * the source, shallower as it spreads). Added in version 4. WATER sources
   * themselves (the sea, and any a kid places from the palette) are eternal —
   * floods are steered by breaking the *flowing* cells or filling them in.
   */
  waterLevels?: Record<string, number>;
  /**
   * Which wall each ladder is nailed to: flat index -> the direction its
   * climbing side faces (see core/blocks.ts LadderFacing). Added in version 5.
   */
  ladderFacing?: Record<string, number>;
  /**
   * Which way each mine cart is facing on the track: flat index -> direction
   * + 1 (see core/rails.ts DIRS). Added in version 6. A cart that has been
   * picked up leaves a 0 behind on purpose: the server merge is per key and
   * last-write-wins, so the 0 is what stops an old cart coming back.
   */
  carts?: Record<string, number>;
  /** wall-clock ms of the last write, for the "My Worlds" last-played list */
  savedAt?: number;
}

/** one row in the saved-worlds list (My Worlds menu): enough to pick a world */
export interface SavedWorldInfo {
  seed: number;
  theme: number;
  /** when this world was last saved (wall-clock ms) */
  savedAt?: number;
  /** how many saved edits the world has ("blocks built") */
  mods?: number;
}

export class World {
  seed: number;
  theme = 0;
  readonly data: Uint8Array;
  readonly mods = new Map<number, BlockId>();
  /** chunk keys (cx*CHUNKS_X+cz) that need remeshing */
  readonly dirtyChunks = new Set<number>();
  collectedStars = new Set<number>();
  /** flat index -> swing axis of a placed door (0: thin along x, 1: thin along z) */
  readonly doorFacing = new Map<number, number>();
  /** flat index -> which half of a stair cell is the tall part (see StairFacing) */
  readonly stairFacing = new Map<number, number>();
  /** flat index -> which wall a ladder is nailed to (see LadderFacing) */
  readonly ladderFacing = new Map<number, number>();
  /** flat index -> flow depth of a WATER_FLOW cell (0 deep … 6 nearly puddle) */
  readonly waterLevel = new Map<number, number>();
  /**
   * flat index -> which way a mine cart is facing, stored as direction + 1 so
   * that 0 can mean "this cart was picked up" (see WorldSaveData.carts).
   */
  readonly carts = new Map<number, number>();
  /** bumped on every change so listeners (autosave) can debounce */
  revision = 0;

  constructor(seed: number, theme = 0) {
    this.seed = seed;
    this.theme = theme;
    this.data = new Uint8Array(WORLD_SX * WORLD_SY * WORLD_SZ);
  }

  /** wipe in place so existing references (players, chunks) stay valid */
  resetFor(seed: number, theme: number): void {
    this.seed = seed;
    this.theme = theme;
    this.data.fill(0);
    this.mods.clear();
    this.collectedStars.clear();
    this.doorFacing.clear();
    this.stairFacing.clear();
    this.ladderFacing.clear();
    this.waterLevel.clear();
    this.carts.clear();
    this.revision++;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < WORLD_SX && y < WORLD_SY && z < WORLD_SZ;
  }

  get(x: number, y: number, z: number): BlockId {
    if (y < 0) return ROCK; // below the world is solid rock
    if (!this.inBounds(x, y, z)) return AIR;
    return this.data[idx(x, y, z)];
  }

  set(x: number, y: number, z: number, id: BlockId, recordMod = true): void {
    if (!this.inBounds(x, y, z)) return;
    // A non-id (a `undefined` sneaking through an `as any` in a test) used to
    // write AIR: the cell quietly emptied and the caller never heard a word.
    if (!Number.isInteger(id)) return;
    const i = idx(x, y, z);
    if (this.data[i] === id) return;
    this.data[i] = id;
    // whatever stood here, its flow-depth (if any) is history — the water
    // manager re-reads/re-stores what the new cell needs
    this.waterLevel.delete(i);
    if (recordMod) this.mods.set(i, id);
    this.touchChunksAt(x, z);
    this.revision++;
    if (this.onCellChanged) this.onCellChanged(x, y, z, id);
  }

  /** flow depth of a WATER_FLOW cell; -1 for anything else (sources are depth 0) */
  flowLevelAt(x: number, y: number, z: number): number {
    if (this.get(x, y, z) !== WATER_FLOW) return -1;
    return this.waterLevel.get(idx(x, y, z)) ?? 7;
  }

  /**
   * Fires whenever a cell's block id actually changes — from a build button,
   * an explosion, a test harness or the simulations themselves. Gravity sand
   * listens here so *every* change of support is noticed, whoever caused it.
   */
  onCellChanged: ((x: number, y: number, z: number, id: BlockId) => void) | null = null;

  private touchChunksAt(x: number, z: number): void {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx >= 0 && nz >= 0 && nx < CHUNKS_X && nz < CHUNKS_Z) {
          this.dirtyChunks.add(nx * CHUNKS_X + nz);
        }
      }
    }
  }

  markAllDirty(): void {
    for (let cx = 0; cx < CHUNKS_X; cx++) {
      for (let cz = 0; cz < CHUNKS_Z; cz++) this.dirtyChunks.add(cx * CHUNKS_X + cz);
    }
  }

  /**
   * A voxel changed *shape* but kept its block id (a stair spun around): the
   * chunk around it needs remeshing and the save needs to notice.
   */
  touchAt(x: number, z: number): void {
    this.touchChunksAt(x, z);
    this.revision++;
  }

  /** which way a stair cell points (0 for any cell that is not stairs) */
  getStairFacing(x: number, y: number, z: number): number {
    return this.stairFacing.get(idx(x, y, z)) ?? 0;
  }

  /**
   * Point a stair cell a new way. Its block id does not change, so this is the
   * only way the mesher and the autosave hear about the spin.
   */
  setStairFacing(x: number, y: number, z: number, facing: number): void {
    const i = idx(x, y, z);
    if (this.stairFacing.get(i) === facing) return;
    this.stairFacing.set(i, facing);
    this.touchAt(x, z);
  }

  /** which wall a ladder cell is nailed to (0 for any cell that is not a ladder) */
  getLadderFacing(x: number, y: number, z: number): number {
    return this.ladderFacing.get(idx(x, y, z)) ?? 0;
  }

  /**
   * Turn a ladder to face a new way. Its block id does not change, so this is
   * the only way the mesher and the autosave hear about the spin.
   */
  setLadderFacing(x: number, y: number, z: number, facing: number): void {
    const i = idx(x, y, z);
    if (this.ladderFacing.get(i) === facing) return;
    this.ladderFacing.set(i, facing);
    this.touchAt(x, z);
  }

  /**
   * Rewrites the saved cart map from the carts standing in the world right now.
   * Whatever was saved before is written as 0 ("gone") first, because the
   * server merge is last-write-wins and cannot delete: without that, a cart
   * that rolled on, or that a kid picked up, would be waiting for them exactly
   * where it used to be.
   */
  syncCarts(live: Iterable<{ x: number; y: number; z: number; dir: number }>): void {
    for (const i of this.carts.keys()) this.carts.set(i, 0);
    for (const c of live) {
      const i = idx(c.x, c.y, c.z);
      if (i < 0 || i >= this.data.length) continue;
      this.carts.set(i, Math.max(0, Math.min(3, Math.trunc(c.dir))) + 1);
    }
  }

  isSolid(x: number, y: number, z: number): boolean {
    return isSolidBlock(this.get(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  /** highest non-air solid block at column, or -1 */
  surfaceY(x: number, z: number): number {
    for (let y = WORLD_SY - 1; y >= 0; y--) {
      const b = this.get(x, y, z);
      if (b !== AIR && !isWaterId(b)) return y;
    }
    return -1;
  }

  applySave(save: WorldSaveData): void {
    for (const [k, v] of Object.entries(save.mods)) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < this.data.length && v >= 0 && v < 256) {
        this.data[i] = v;
        this.mods.set(i, v);
      }
    }
    for (const s of save.collectedStars) {
      if (Number.isInteger(s) && s >= 0) this.collectedStars.add(s);
    }
    if (save.doorFacing) {
      for (const [k, v] of Object.entries(save.doorFacing)) {
        const i = Number(k);
        if (Number.isInteger(i) && i >= 0 && i < this.data.length && (v === 0 || v === 1)) {
          this.doorFacing.set(i, v);
        }
      }
    }
    if (save.stairFacing) {
      for (const [k, v] of Object.entries(save.stairFacing)) {
        const i = Number(k);
        if (Number.isInteger(i) && i >= 0 && i < this.data.length && v >= 0 && v <= 3) {
          this.stairFacing.set(i, v);
        }
      }
    }
    if (save.waterLevels) {
      for (const [k, v] of Object.entries(save.waterLevels)) {
        const i = Number(k);
        if (Number.isInteger(i) && i >= 0 && i < this.data.length && v >= 0 && v <= 7) {
          this.waterLevel.set(i, v);
        }
      }
    }
    if (save.ladderFacing) {
      for (const [k, v] of Object.entries(save.ladderFacing)) {
        const i = Number(k);
        if (Number.isInteger(i) && i >= 0 && i < this.data.length && v >= 0 && v <= 3) {
          this.ladderFacing.set(i, v);
        }
      }
    }
    if (save.carts) {
      for (const [k, v] of Object.entries(save.carts)) {
        const i = Number(k);
        if (Number.isInteger(i) && i >= 0 && i < this.data.length && v >= 0 && v <= 4) {
          this.carts.set(i, v); // 0 stays 0: it is a grave marker, not a cart
        }
      }
    }
    this.markAllDirty();
  }

  toSave(): WorldSaveData {
    const mods: Record<string, number> = {};
    for (const [i, v] of this.mods) mods[String(i)] = v;
    const doorFacing: Record<string, number> = {};
    for (const [i, v] of this.doorFacing) doorFacing[String(i)] = v;
    const stairFacing: Record<string, number> = {};
    for (const [i, v] of this.stairFacing) stairFacing[String(i)] = v;
    const waterLevels: Record<string, number> = {};
    for (const [i, v] of this.waterLevel) waterLevels[String(i)] = v;
    const ladderFacing: Record<string, number> = {};
    for (const [i, v] of this.ladderFacing) ladderFacing[String(i)] = v;
    const carts: Record<string, number> = {};
    for (const [i, v] of this.carts) carts[String(i)] = v;
    return {
      version: SAVE_VERSION,
      seed: this.seed,
      theme: this.theme,
      mods,
      collectedStars: [...this.collectedStars].sort((a, b) => a - b),
      doorFacing,
      stairFacing,
      waterLevels,
      ladderFacing,
      carts,
    };
  }
}
