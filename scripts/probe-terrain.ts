import { World, WORLD_SX, WORLD_SZ, WATER_LEVEL } from '../src/core/world';
import { generateTerrain } from '../src/core/terrain';
import { AIR, WATER } from '../src/core/blocks';

const w = new World(20261102);
const gen = generateTerrain(w);
console.log('spawn:', gen);

let air = 0, solid = 0, water = 0;
for (let i = 0; i < w.data.length; i++) {
  if (w.data[i] === AIR) air++;
  else if (w.data[i] === WATER) water++;
  else solid++;
}
console.log({ air, solid, water, total: w.data.length });

// column profile through the middle
const z = 32;
let line = '';
for (let x = 0; x < WORLD_SX; x += 1) {
  const s = w.surfaceY(x, z);
  line += s < 0 ? ' ' : String(Math.min(9, s)).slice(-1);
}
console.log('surfaceY profile z=32:');
console.log(line);

// print a column at x=32 (spawn) top to bottom
console.log('column x=32 z=32 from y=20..0:');
for (let y = 20; y >= 0; y--) {
  console.log(y, w.get(32, y, 32));
}
