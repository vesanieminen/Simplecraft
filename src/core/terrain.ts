/**
 * Deterministic, seeded terrain generation for Little Block World.
 * Style: rolling meadows, a welcoming flat starting meadow, forests,
 * lakes with sandy beaches, small caves, flowers and trees.
 */

import {
  AIR, DIRT, FLOWER_RED, FLOWER_YELLOW, GRASS, LEAVES, ROCK, SAND, STONE, TALLGRASS, WATER, WOOD,
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

// ---------- generation ----------

export interface GeneratedWorld {
  spawnX: number;
  spawnZ: number;
  spawnY: number;
}

export const DEFAULT_SEED = 20261102;

export function generateTerrain(world: World): GeneratedWorld {
  const { seed, data } = world;
  const seedA = seed & 0xffff;

  // starting meadow center (flat, open, welcoming)
  const cx = WORLD_SX / 2, cz = WORLD_SZ / 2;
  const meadowR = 13;

  // 1. heightmap
  const heights = new Int16Array(WORLD_SX * WORLD_SZ);
  for (let x = 0; x < WORLD_SX; x++) {
    for (let z = 0; z < WORLD_SZ; z++) {
      let h = 10 + fbm2(x / 22, z / 22, seedA, 4) * 14; // 10..24
      // lakes: a couple of low basins driven by a second noise field
      const lakeNoise = fbm2(x / 30 + 5.7, z / 30 + 9.3, seedA + 77, 3);
      if (lakeNoise > 0.62) h -= (lakeNoise - 0.62) * 40; // carve lakes
      // gentle bowl near borders so edges dip into water (nicer horizon)
      const edge = Math.min(x, z, WORLD_SX - 1 - x, WORLD_SZ - 1 - z);
      if (edge < 8) h -= (8 - edge) * 0.55;
      // flatten the starting meadow
      const d = Math.hypot(x - cx, z - cz);
      if (d < meadowR + 6) {
        const t = Math.min(1, Math.max(0, (meadowR + 6 - d) / 6));
        h = h * (1 - t) + (WATER_LEVEL + 2) * t;
      }
      heights[x * WORLD_SZ + z] = Math.max(2, Math.min(WORLD_SY - 20, Math.round(h)));
    }
  }

  // 2. fill columns
  for (let x = 0; x < WORLD_SX; x++) {
    for (let z = 0; z < WORLD_SZ; z++) {
      const h = heights[x * WORLD_SZ + z];
      const nearWater = h <= WATER_LEVEL + 1;
      for (let y = 0; y < WORLD_SY; y++) {
        let b: number = AIR;
        if (y === 0) b = ROCK;
        else if (y <= h - 4) b = STONE;
        else if (y <= h) b = nearWater ? SAND : (h > 21 ? STONE : DIRT);
        else if (y <= WATER_LEVEL) b = WATER;
        data[(x * WORLD_SZ + z) * WORLD_SY + y] = b;
      }
      // grass top
      if (h > WATER_LEVEL && data[(x * WORLD_SZ + z) * WORLD_SY + h] !== AIR) {
        const top = nearWater ? SAND : h > 21 ? STONE : GRASS;
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
      for (let y = 2; y < Math.min(h - 2, WATER_LEVEL + 4); y++) {
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
      if (h <= WATER_LEVEL + 1 || h > 21) continue;
      const d = Math.hypot(x - cx, z - cz);
      if (d < meadowR) continue; // keep the meadow open
      const forest = fbm2(x / 16 + 3.1, z / 16 + 7.7, seedA + 31, 2);
      const chance = d < meadowR + 8 ? 0.045 : forest > 0.55 ? 0.16 : 0.02;
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
      if (h <= WATER_LEVEL + 1) continue;
      const i = (x * WORLD_SZ + z) * WORLD_SY + h;
      if (data[i] !== GRASS) continue;
      const above = (x * WORLD_SZ + z) * WORLD_SY + h + 1;
      if (data[above] !== AIR) continue;
      const d = Math.hypot(x - cx, z - cz);
      const r = hash2(x, z, seedA + 4242);
      const dens = d < meadowR ? 0.16 : 0.05;
      if (r < dens) data[above] = r < dens * 0.35 ? FLOWER_RED : r < dens * 0.7 ? FLOWER_YELLOW : TALLGRASS;
    }
  }

  world.markAllDirty();

  const spawnY = heights[cx * WORLD_SZ + cz] + 1;
  return { spawnX: cx + 0.5, spawnZ: cz + 0.5, spawnY };
}

function plantTree(world: World, x: number, y: number, z: number, seed: number): void {
  const trunk = 4 + Math.floor(hash2(x, z, seed + 77) * 3); // 4..6
  for (let i = 0; i < trunk; i++) world.set(x, y + i, z, WOOD, false);
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
        if (world.get(bx, by, bz) === AIR) world.set(bx, by, bz, LEAVES, false);
      }
    }
  }
}
