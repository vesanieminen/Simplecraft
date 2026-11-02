/**
 * Voxel world storage. Fixed-size deterministic world (64 x 64 x 64).
 * Generated terrain is stored in `data`; player edits live in `mods` so that
 * the base world can always be regenerated from the seed.
 */

import { AIR, BlockId, ROCK, isSolidBlock, WATER } from './blocks';

export const WORLD_SX = 64;
export const WORLD_SY = 64; // height
export const WORLD_SZ = 64;
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
  /** map of flat index -> block id (player modifications only) */
  mods: Record<string, number>;
  /** indices of collected star pickups */
  collectedStars: number[];
}

export class World {
  readonly seed: number;
  readonly data: Uint8Array;
  readonly mods = new Map<number, BlockId>();
  /** chunk keys (cx*CHUNKS_X+cz) that need remeshing */
  readonly dirtyChunks = new Set<number>();
  collectedStars = new Set<number>();
  /** bumped on every change so listeners (autosave) can debounce */
  revision = 0;

  constructor(seed: number) {
    this.seed = seed;
    this.data = new Uint8Array(WORLD_SX * WORLD_SY * WORLD_SZ);
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
    this.markAllDirty();
  }

  toSave(): WorldSaveData {
    const mods: Record<string, number> = {};
    for (const [i, v] of this.mods) mods[String(i)] = v;
    return {
      version: 1,
      seed: this.seed,
      mods,
      collectedStars: [...this.collectedStars].sort((a, b) => a - b),
    };
  }
}
