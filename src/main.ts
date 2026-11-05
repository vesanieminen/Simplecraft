import './ui/styles.css';
import {
  AIR, CHEST, CHEST_OPEN, DOOR, DOOR_OPEN, DOOR_TOP, DOOR_TOP_OPEN, DYNAMITE, FLOWER_RED, FLOWER_YELLOW,
  GRASS, LEAVES, PLANKS, ROCK, SAND, SAPLING, SCORCH, SLAB, STAIRS, STONE, TALLGRASS, WATER, WOOD,
} from './core/blocks';
import { WORLD_SX, WORLD_SY, WORLD_SZ, CHUNK } from './core/world';
import { buildChunkGeometry } from './core/mesher';
import { Game } from './game';
import { VirtualPadSource } from './input/virtual';

async function boot(): Promise<void> {
  const game = new Game();
  await game.init();

  const w = window as unknown as {
    __lbw?: {
      game: Game;
      addVirtualPad: () => VirtualPadSource;
      /** world size + block ids, handy for tests and debugging */
      dims: { sx: number; sy: number; sz: number; chunk: number };
      ids: Record<string, number>;
      /** the mesher on demand: what one chunk of the current world would look like */
      chunkGeometry: typeof buildChunkGeometry;
    };
  };
  // test/demo hook: virtual controllers drive the same input abstraction
  w.__lbw = {
    game,
    addVirtualPad: () => game.addVirtualPad('xbox'),
    dims: { sx: WORLD_SX, sy: WORLD_SY, sz: WORLD_SZ, chunk: CHUNK },
    ids: {
      AIR, GRASS, STONE, SAND, ROCK, WATER, WOOD, PLANKS, LEAVES,
      FLOWER_RED, FLOWER_YELLOW, TALLGRASS, DYNAMITE, SCORCH,
      SAPLING, DOOR, DOOR_OPEN, DOOR_TOP, DOOR_TOP_OPEN, SLAB, STAIRS, CHEST, CHEST_OPEN,
    },
    chunkGeometry: buildChunkGeometry,
  };
}

void boot();
