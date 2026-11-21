/**
 * Deterministic, seeded terrain generation for Elocraft.
 * Style: rolling meadows, a welcoming flat starting meadow, forests,
 * lakes with sandy beaches, small caves, flowers and trees.
 */

import {
  AIR, CHEST, C_WHITE, DIRT, FLOWER_RED, FLOWER_YELLOW, GRASS, LEAVES, POWERED_RAIL, RAIL, ROCK, SAND, STONE,
  TALLGRASS, WATER, WOOD,
} from './blocks';
import { WATER_LEVEL, World, WORLD_SX, WORLD_SY, WORLD_SZ } from './world';

// ---------- deterministic noise ----------

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 9746345761) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 2D value noise, bilinear-smoothed */
function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = smooth(xf), v = smooth(yf), w = smooth(zf);
  const c000 = hash3(xi, yi, zi, seed), c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed), c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed), c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;
  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

function fbm2(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x * freq, y * freq, seed + o * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---------- themes ----------

export interface WorldTheme {
  name: string;
  icon: string;
  /** generation parameters */
  waterDelta: number;
  ampMul: number;
  lakeThresh: number;
  lakeCarve: number;
  treeMul: number;
  flowerMul: number;
  meadowR: number;
  rockAbove: number; // surface becomes bare stone above this height
  snowAbove: number; // capped peaks turn snow-white above this
}

export const WORLD_THEMES: WorldTheme[] = [
  {
    name: 'Meadow', icon: '🌱', waterDelta: 0, ampMul: 1, lakeThresh: 0.55,
    lakeCarve: 46, treeMul: 1, flowerMul: 1, meadowR: 15, rockAbove: 21, snowAbove: 99,
  },
  {
    name: 'Islands', icon: '🏝️', waterDelta: 2, ampMul: 0.7, lakeThresh: 0.5,
    lakeCarve: 58, treeMul: 1.2, flowerMul: 1.2, meadowR: 12, rockAbove: 99, snowAbove: 99,
  },
  {
    name: 'Mountains', icon: '⛰️', waterDelta: -1, ampMul: 1.9, lakeThresh: 0.48,
    lakeCarve: 70, treeMul: 0.75, flowerMul: 0.7, meadowR: 12, rockAbove: 25, snowAbove: 33,
  },
  {
    name: 'Deep Forest', icon: '🌲', waterDelta: 0, ampMul: 1.1, lakeThresh: 0.54,
    lakeCarve: 42, treeMul: 2.6, flowerMul: 1.5, meadowR: 10, rockAbove: 23, snowAbove: 99,
  },
];

export function themeOf(idx: number | undefined): WorldTheme {
  return WORLD_THEMES[(idx ?? 0) % WORLD_THEMES.length];
}

// ---------- generation ----------

export interface GeneratedWorld {
  spawnX: number;
  spawnZ: number;
  spawnY: number;
  /**
   * Where the world's abandoned railway keeps a cart (the middle of the line),
   * or null if the seed could not find level ground for one. The track itself
   * is part of the terrain — like the sea and the treasure chests it comes back
   * from the seed at every boot, so it needs no save field of its own.
   */
  cartSite: [number, number, number] | null;
}

export const DEFAULT_SEED = 20261102;

/** how many treasure chests one world hides */
export const CHESTS_PER_WORLD = 12;
/** how much track an abandoned mine lays down, at most */
export const MINE_RAIL_LENGTH = 26;
/** every so often the abandoned line has a red rail left in it, to throw a cart along */
export const MINE_POWERED_EVERY = 7;
/** how far from the starting meadow a mine may start (the family's first walk) */
export const MINE_MIN_DISTANCE = 26;

/** heightmap for a seed+theme (shared by terrain gen and world previews) */
export function computeHeights(seed: number, theme: WorldTheme): Uint8Array {
  const seedA = seed & 0xffff;
  const cx = WORLD_SX / 2, cz = WORLD_SZ / 2;
  const waterLevel = WATER_LEVEL + theme.waterDelta;
  const heights = new Uint8Array(WORLD_SX * WORLD_SZ);
  for (let x = 0; x < WORLD_SX; x++) {
    for (let z = 0; z < WORLD_SZ; z++) {
      let h = 10 + fbm2(x / 22, z / 22, seedA, 4) * 14 * theme.ampMul;
      // lakes: a couple of low basins driven by a second noise field
      const lakeNoise = fbm2(x / 30 + 5.7, z / 30 + 9.3, seedA + 77, 3);
      if (lakeNoise > theme.lakeThresh) h -= (lakeNoise - theme.lakeThresh) * theme.lakeCarve;
      // gentle bowl near borders so edges dip into water (nicer horizon)
      const edge = Math.min(x, z, WORLD_SX - 1 - x, WORLD_SZ - 1 - z);
      if (edge < 8) h -= (8 - edge) * 0.55;
      // flatten the starting meadow with a gentle approach slope
      const d = Math.hypot(x - cx, z - cz);
      if (d < theme.meadowR + 12) {
        const t = Math.min(1, Math.max(0, (theme.meadowR + 12 - d) / 12));
        h = h * (1 - t) + (waterLevel + 3) * t;
      }
      heights[x * WORLD_SZ + z] = Math.max(2, Math.min(WORLD_SY - 20, Math.round(h)));
    }
  }
  return heights;
}

export function generateTerrain(world: World, theme?: WorldTheme): GeneratedWorld {
  const { seed, data } = world;
  const th = theme ?? themeOf(world.theme);
  world.theme = WORLD_THEMES.indexOf(th) >= 0 ? WORLD_THEMES.indexOf(th) : 0;
  const seedA = seed & 0xffff;
  const waterLevel = WATER_LEVEL + th.waterDelta;

  // starting meadow center (flat, open, welcoming)
  const cx = WORLD_SX / 2, cz = WORLD_SZ / 2;
  const meadowR = th.meadowR;

  // 1. heightmap
  const heights = computeHeights(seed, th);

  // 2. fill columns
  for (let x = 0; x < WORLD_SX; x++) {
    for (let z = 0; z < WORLD_SZ; z++) {
      const h = heights[x * WORLD_SZ + z];
      const nearWater = h <= waterLevel + 1;
      const rocky = h > th.rockAbove;
      const snowy = h >= th.snowAbove;
      for (let y = 0; y < WORLD_SY; y++) {
        let b: number = AIR;
        if (y === 0) b = ROCK;
        else if (y <= h - 4) b = STONE;
        else if (y <= h) b = nearWater ? SAND : (rocky ? STONE : DIRT);
        else if (y <= waterLevel) b = WATER;
        data[(x * WORLD_SZ + z) * WORLD_SY + y] = b;
      }
      // grass top (sand at beaches, stone on high peaks, snow on the very top)
      if (h > waterLevel && data[(x * WORLD_SZ + z) * WORLD_SY + h] !== AIR) {
        const top = nearWater ? SAND : snowy ? C_WHITE : rocky ? STONE : GRASS;
        data[(x * WORLD_SZ + z) * WORLD_SY + h] = top;
      }
    }
  }

  // 3. caves — small friendly pockets, never touching the meadow
  for (let x = 2; x < WORLD_SX - 2; x++) {
    for (let z = 2; z < WORLD_SZ - 2; z++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d < meadowR + 4) continue;
      const h = heights[x * WORLD_SZ + z];
      for (let y = 2; y < Math.min(h - 2, waterLevel + 4); y++) {
        const c = noise3(x / 7, y / 5.5, z / 7, seedA + 555);
        if (c > 0.66) {
          const i = (x * WORLD_SZ + z) * WORLD_SY + y;
          if (data[i] === STONE || data[i] === DIRT) data[i] = AIR;
        }
      }
    }
  }

  // 4. trees around the meadow and in forest belts
  for (let x = 3; x < WORLD_SX - 3; x++) {
    for (let z = 3; z < WORLD_SZ - 3; z++) {
      const h = heights[x * WORLD_SZ + z];
      if (h <= waterLevel + 1 || h > th.rockAbove) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d < meadowR) continue; // keep the meadow open
      const forest = fbm2(x / 16 + 3.1, z / 16 + 7.7, seedA + 31, 2);
      const base = d < meadowR + 8 ? 0.045 : forest > 0.55 ? 0.16 : 0.02;
      const chance = Math.min(0.4, base * th.treeMul);
      if (hash2(x, z, seedA + 909) >= chance) continue;
      // clear spacing
      let tooClose = false;
      for (let ox = -2; ox <= 2 && !tooClose; ox++) {
        for (let oz = -2; oz <= 2; oz++) {
          const t = data[((x + ox) * WORLD_SZ + (z + oz)) * WORLD_SY + h + 1];
          if (t === WOOD) { tooClose = true; break; }
        }
      }
      if (tooClose) continue;
      plantTree(world, x, h + 1, z, seedA);
    }
  }

  // 5. flowers & tufts on the meadow and fields
  for (let x = 1; x < WORLD_SX - 1; x++) {
    for (let z = 1; z < WORLD_SZ - 1; z++) {
      const h = heights[x * WORLD_SZ + z];
      if (h <= waterLevel + 1) continue;
      const i = (x * WORLD_SZ + z) * WORLD_SY + h;
      if (data[i] !== GRASS) continue;
      const above = (x * WORLD_SZ + z) * WORLD_SY + h + 1;
      if (data[above] !== AIR) continue;
      const d = Math.hypot(x - cx, z - cz);
      const r = hash2(x, z, seedA + 4242);
      const dens = (d < meadowR ? 0.07 : 0.03) * th.flowerMul;
      if (r < dens) data[above] = r < dens * 0.35 ? FLOWER_RED : r < dens * 0.7 ? FLOWER_YELLOW : TALLGRASS;
    }
  }

  // 6. treasure chests — a dozen hidden around the map, never on the starting
  // meadow, so the first one is a proper walk (and a reward for exploring).
  // They come from the seed, so the same world hides the same treasures.
  let chests = 0;
  const chestSpots: [number, number][] = [];
  for (let x = 4; x < WORLD_SX - 4 && chests < CHESTS_PER_WORLD; x++) {
    for (let z = 4; z < WORLD_SZ - 4 && chests < CHESTS_PER_WORLD; z++) {
      if (hash2(x, z, seedA + 9091) > 0.003) continue;
      if (Math.hypot(x - cx, z - cz) < meadowR + 8) continue;
      if (chestSpots.some(([sx, sz]) => Math.abs(sx - x) < 7 && Math.abs(sz - z) < 7)) continue;
      const h = heights[x * WORLD_SZ + z];
      if (h <= waterLevel + 1 || h >= WORLD_SY - 4) continue; // dry ground, room for the lid
      const i = (x * WORLD_SZ + z) * WORLD_SY + h;
      const ground = data[i];
      if (ground !== GRASS && ground !== SAND && ground !== DIRT && ground !== STONE) continue;
      if (data[i + 1] !== AIR) continue; // the cell above is free: no trees or roofs on the lid
      data[i] = CHEST;
      chestSpots.push([x, z]);
      chests++;
    }
  }

  // 7. the abandoned railway — a line of track laid along the contours, far from
  // the starting meadow, with a cart sitting in the middle of it. Like the
  // chests it comes out of the seed, so the same world always hides the same
  // line, and nobody has to build a single rail to find a ride.
  const cartSite = generateMine(world, data, heights, cx, cz, meadowR, waterLevel, seedA);

  world.markAllDirty();

  const spawnY = heights[cx * WORLD_SZ + cz] + 1;
  return { spawnX: cx + 0.5, spawnZ: cz + 0.5, spawnY, cartSite };
}

/**
 * The abandoned railway. It starts somewhere well away from the starting
 * meadow and follows the land: track is a plate nailed to the ground, so the
 * line only goes where the ground is level enough to have one laid on it —
 * which is what gives it its bends, its little climbs and its dead ends. Every
 * few sleepers there is a red one left in the line, so a cart shoved at one end
 * makes it all the way to the other.
 *
 * Returns where the cart stands (the middle of the line), or null when the seed
 * found nowhere flat enough.
 */
function generateMine(
  world: World, data: Uint8Array, heights: Uint8Array,
  cx: number, cz: number, meadowR: number, waterLevel: number, seedA: number,
): [number, number, number] | null {
  const flat = (id: number): boolean => id === GRASS || id === SAND || id === DIRT || id === STONE;

  for (let tryIdx = 0; tryIdx < 24; tryIdx++) {
    // a starting column, chosen from the seed, away from home and out of the sea
    const sx = 6 + Math.floor(hash2(tryIdx, 11, seedA + 313) * (WORLD_SX - 12));
    const sz = 6 + Math.floor(hash2(tryIdx, 29, seedA + 787) * (WORLD_SZ - 12));
    if (Math.hypot(sx - cx, sz - cz) < meadowR + MINE_MIN_DISTANCE) continue;
    if (heights[sx * WORLD_SZ + sz] <= waterLevel + 1) continue;

    // the line wanders: mostly straight on, sometimes a step sideways, and it
    // gives up where the land gets too steep for a plate of track
    const dir = Math.floor(hash2(sx, sz, seedA + 1234) * 4);
    const line: [number, number, number][] = [];
    let x = sx, z = sz, d = dir;
    for (let n = 0; n < MINE_RAIL_LENGTH; n++) {
      if (x < 3 || z < 3 || x > WORLD_SX - 4 || z > WORLD_SZ - 4) break;
      const h = heights[x * WORLD_SZ + z];
      const prev = line[line.length - 1];
      if (prev && Math.abs(h + 1 - prev[1]) > 1) break; // too steep for a rail
      const ground = data[(x * WORLD_SZ + z) * WORLD_SY + h];
      if (!flat(ground)) break;
      if (data[(x * WORLD_SZ + z) * WORLD_SY + h + 1] !== AIR) break; // a tree is standing there
      if (prev && Math.hypot(x - prev[0], z - prev[2]) !== 1) break; // no diagonals
      line.push([x, h + 1, z]);
      if (n % MINE_POWERED_EVERY === MINE_POWERED_EVERY - 1) {
        data[(x * WORLD_SZ + z) * WORLD_SY + h + 1] = POWERED_RAIL;
      } else {
        data[(x * WORLD_SZ + z) * WORLD_SY + h + 1] = RAIL;
      }
      if (hash2(x, z, seedA + 4717) < 0.22) d = (d + (hash2(x, z, seedA + 99) < 0.5 ? 1 : 3)) % 4;
      x += [[1, 0], [-1, 0], [0, 1], [0, -1]][d][0];
      z += [[1, 0], [-1, 0], [0, 1], [0, -1]][d][1];
    }
    if (line.length < 10) continue; // not a railway, just a few sleepers
    const mid = line[Math.floor(line.length / 2)];
    return mid;
  }
  void world;
  return null;
}

/**
 * Plant one tree (trunk + rounded canopy) with its feet at x,y,z.
 * Also used when a planted sapling finally grows up.
 */
/**
 * Plant one tree (trunk + rounded canopy) with its feet at x,y,z.
 * Also used when a planted sapling finally grows up — then the tree must be
 * recorded as a player modification, so it survives the reload.
 */
export function plantTree(world: World, x: number, y: number, z: number, seed: number, recordMod = false): void {
  const trunk = 4 + Math.floor(hash2(x, z, seed + 77) * 3); // 4..6
  for (let i = 0; i < trunk; i++) world.set(x, y + i, z, WOOD, recordMod);
  const top = y + trunk;
  // rounded blob canopy
  for (let ox = -2; ox <= 2; ox++) {
    for (let oz = -2; oz <= 2; oz++) {
      for (let oy = -2; oy <= 1; oy++) {
        const dist = Math.abs(ox) + Math.abs(oz) + Math.abs(oy) * 1.2;
        if (dist > 3.1) continue;
        if (ox === 0 && oz === 0 && oy < 0) continue;
        const bx = x + ox, by = top + oy, bz = z + oz;
        if (!world.inBounds(bx, by, bz)) continue;
        if (world.get(bx, by, bz) === AIR) world.set(bx, by, bz, LEAVES, recordMod);
      }
    }
  }
}
