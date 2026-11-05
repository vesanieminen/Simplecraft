/**
 * Voxel world storage. Fixed-size deterministic world (128 x 128 x 64).
 * Generated terrain is stored in `data`; player edits live in `mods` so that
 * the base world can always be regenerated from the seed + theme.
 */

import { AIR, BlockId, ROCK, isSolidBlock, WATER } from './blocks';

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
    const i = idx(x, y, z);
    if (this.data[i] === id) return;
    this.data[i] = id;
    if (recordMod) this.mods.set(i, id);
    this.touchChunksAt(x, z);
    this.revision++;
  }

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

  isSolid(x: number, y: number, z: number): boolean {
    return isSolidBlock(this.get(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  /** highest non-air solid block at column, or -1 */
  surfaceY(x: number, z: number): number {
    for (let y = WORLD_SY - 1; y >= 0; y--) {
      const b = this.get(x, y, z);
      if (b !== AIR && b !== WATER) return y;
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
    this.markAllDirty();
  }

  toSave(): WorldSaveData {
    const mods: Record<string, number> = {};
    for (const [i, v] of this.mods) mods[String(i)] = v;
    const doorFacing: Record<string, number> = {};
    for (const [i, v] of this.doorFacing) doorFacing[String(i)] = v;
    const stairFacing: Record<string, number> = {};
    for (const [i, v] of this.stairFacing) stairFacing[String(i)] = v;
    return {
      version: 3,
      seed: this.seed,
      theme: this.theme,
      mods,
      collectedStars: [...this.collectedStars].sort((a, b) => a - b),
      doorFacing,
      stairFacing,
    };
  }
}
