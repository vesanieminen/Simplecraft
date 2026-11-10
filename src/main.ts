import './ui/styles.css';
import {
  AIR, ATLAS_CHEST_BOTTOM, ATLAS_CHEST_INSIDE, ATLAS_CHEST_LID, ATLAS_CHEST_OPEN_TOP, ATLAS_CHEST_SIDE, ATLAS_CELL_COUNT, ATLAS_LADDER,
  BUCKET, CHEST, CHEST_OPEN, DOOR, DOOR_OPEN, DOOR_TOP, DOOR_TOP_OPEN, DYNAMITE, FLOWER_RED, FLOWER_YELLOW,
  GLASS, GRASS, isBucket, LADDER, LEAVES, PLANKS, ROCK, SAND, SAPLING, SCORCH, SLAB, STAIRS, STONE, TALLGRASS, WATER, WATER_FLOW, WOOD,
} from './core/blocks';
import { WORLD_SX, WORLD_SY, WORLD_SZ, CHUNK } from './core/world';
import { buildChunkGeometry } from './core/mesher';
import { waterSurfaceHeight } from './core/water';
import { Game } from './game';
import { GAMEPAD_BUTTON_MAP } from './input/gamepad';
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
      isTool: (id: number) => boolean;
      /** the block atlas, so a test can tell which artwork a face really used */
      atlas: { cells: number; side: number; lid: number; bottom: number; inside: number; treasure: number; ladder: number };
      waterSurfaceAt: (x: number, y: number, z: number) => number;
      /** is this wet cell caught mid-fall (a waterfall's stream), not settled? */
      waterFallingAt: (x: number, y: number, z: number) => boolean;
      /** how many flow steps the sim has taken — the e2e's clock, not wall time */
      waterSteps: () => number;
      weatherNow: (kind: string) => number;
      setDayMode: (mode: string) => void;
      dayPhase: () => number;
      bucketAt: (playerIdx: number, aim: Record<string, number>) => boolean;
      padMap: Record<string, unknown>;
    };
  };
  // test/demo hook: virtual controllers drive the same input abstraction
  w.__lbw = {
    game,
    addVirtualPad: () => game.addVirtualPad('xbox'),
    dims: { sx: WORLD_SX, sy: WORLD_SY, sz: WORLD_SZ, chunk: CHUNK },
    ids: {
      AIR, GRASS, STONE, SAND, ROCK, WATER, WATER_FLOW, WOOD, PLANKS, LEAVES, GLASS,
      FLOWER_RED, FLOWER_YELLOW, TALLGRASS, DYNAMITE, SCORCH, BUCKET,
      SAPLING, DOOR, DOOR_OPEN, DOOR_TOP, DOOR_TOP_OPEN, SLAB, STAIRS, CHEST, CHEST_OPEN, LADDER,
    },
    chunkGeometry: buildChunkGeometry,
    /**
     * The block atlas, in cells: a test that wants to know which artwork a face
     * really used decodes it from the face's UVs (u × cells → the cell).
     */
    atlas: {
      cells: ATLAS_CELL_COUNT, side: ATLAS_CHEST_SIDE, lid: ATLAS_CHEST_LID,
      bottom: ATLAS_CHEST_BOTTOM, inside: ATLAS_CHEST_INSIDE, treasure: ATLAS_CHEST_OPEN_TOP, ladder: ATLAS_LADDER,
    },
    /** is this block id one of the palette's tools (the 🪣)? */
    isTool: (id: number) => isBucket(id),
    /** how tall water draws in a cell: 1 full, or the height of a shallow flow */
    waterSurfaceAt: (x: number, y: number, z: number) =>
      waterSurfaceHeight((window as unknown as { __lbw: { game: Game } }).__lbw.game.world, x, y, z),
    /** is this wet cell water on its way down (a stream) rather than settled? */
    waterFallingAt: (x: number, y: number, z: number) =>
      (window as unknown as { __lbw: { game: Game } }).__lbw.game.water.isPouring(x, y, z),
    /** the flow sim's own clock: how many steps it has actually run */
    waterSteps: () => (window as unknown as { __lbw: { game: Game } }).__lbw.game.water.steps,
    /** force weather from the test console: 'rain' | 'snow' | 'off' */
    weatherNow: (kind: string) => {
      const g = (window as unknown as { __lbw: { game: Game } }).__lbw.game;
      return g.weatherNow(kind === 'off' ? null : kind as 'rain' | 'snow');
    },
    /** park or free the sun from the test console: 'auto' | 'day' | 'night' | 'none' */
    setDayMode: (mode: string) => {
      const g = (window as unknown as { __lbw: { game: Game } }).__lbw.game;
      g.setDayMode(mode as 'auto' | 'day' | 'night' | 'none');
    },
    /** the sun-clock the sky shows right now (0..1) */
    dayPhase: () => (window as unknown as { __lbw: { game: Game } }).__lbw.game.dayPhase,
    /** the controller button → action table, so tests can pin the mapping */
    padMap: GAMEPAD_BUTTON_MAP,
    /**
     * Scoop or pour with the bucket, deterministically (the pad's aim would
     * add too much noise for a flood test). `aim` is a RayHit — the cell the
     * kid looks at plus the empty cell in front of it.
     */
    bucketAt: (playerIdx: number, aim: Record<string, number>) => {
      const g = (window as unknown as { __lbw: { game: Game } }).__lbw.game;
      return g.bucketForTest(g.players[playerIdx], aim as never);
    },
  };
}

void boot();
