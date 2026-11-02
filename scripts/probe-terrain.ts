/**
 * Terrain sanity probe (no browser): prints stats for every world theme.
 *   npx tsx scripts/probe-terrain.ts [seed]
 */
import { AIR, FLOWER_RED, FLOWER_YELLOW, LEAVES, TALLGRASS, WATER, WOOD } from '../src/core/blocks';
import { generateTerrain, themeOf, WORLD_THEMES } from '../src/core/terrain';
import { World, WORLD_SX, WORLD_SY, WORLD_SZ } from '../src/core/world';

const seed = Number(process.argv[2] ?? 20261102);

for (let t = 0; t < WORLD_THEMES.length; t++) {
  const w = new World(seed, t);
  const gen = generateTerrain(w, themeOf(t));

  let air = 0, water = 0, wood = 0, leaves = 0, plants = 0;
  let sumH = 0, minH = WORLD_SY, maxH = 0;
  for (let x = 0; x < WORLD_SX; x++) {
    for (let z = 0; z < WORLD_SZ; z++) {
      let h = 0;
      for (let y = 0; y < WORLD_SY; y++) {
        const b = w.data[(x * WORLD_SZ + z) * WORLD_SY + y];
        if (b === AIR) air++;
        else if (b === WATER) water++;
        else if (b === WOOD) wood++;
        else if (b === LEAVES) leaves++;
        else { h = y; if (b === FLOWER_RED || b === FLOWER_YELLOW || b === TALLGRASS) plants++; }
      }
      sumH += h;
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
    }
  }
  const cols = WORLD_SX * WORLD_SZ;
  console.log(
    `${WORLD_THEMES[t].icon} ${WORLD_THEMES[t].name.padEnd(11)}`,
    `spawn (${gen.spawnX}, ${gen.spawnY}, ${gen.spawnZ})`,
    `height ${minH}-${maxH} avg ${(sumH / cols).toFixed(1)}`,
    `water ${((water / (w.data.length)) * 100).toFixed(1)}%`,
    `trees ${Math.round(wood / 5)} leaves ${leaves} plants ${plants}`,
  );
}
console.log('world size:', WORLD_SX, WORLD_SY, WORLD_SZ, '=', WORLD_SX * WORLD_SY * WORLD_SZ, 'blocks');
