/**
 * Block registry — every block type in Elocraft.
 * Colors are toy-bright, not realistic. No Minecraft assets; all original.
 */

export type BlockId = number;

export const AIR: BlockId = 0;
export const GRASS: BlockId = 1;
export const DIRT: BlockId = 2;
export const STONE: BlockId = 3;
export const SAND: BlockId = 4;
export const WOOD: BlockId = 5;
export const PLANKS: BlockId = 6;
export const BRICKS: BlockId = 7;
export const GLASS: BlockId = 8;
export const LEAVES: BlockId = 9;
export const WATER: BlockId = 10;
export const FLOWER_RED: BlockId = 11;
export const FLOWER_YELLOW: BlockId = 12;
export const TALLGRASS: BlockId = 13;
export const GLOW: BlockId = 14;
export const BOUNCY: BlockId = 15;
export const SPARKLE: BlockId = 16;
export const MUSIC: BlockId = 17;
// Cheerful solid colors (placeable only):
export const C_RED: BlockId = 18;
export const C_ORANGE: BlockId = 19;
export const C_YELLOW: BlockId = 20;
export const C_GREEN: BlockId = 21;
export const C_BLUE: BlockId = 22;
export const C_PURPLE: BlockId = 23;
export const C_PINK: BlockId = 24;
export const C_WHITE: BlockId = 25;
export const ROCK: BlockId = 26; // indestructible floor at y=0
export const DYNAMITE: BlockId = 27; // lit fuse, then it blows a hole in things
export const SCORCH: BlockId = 28; // what grass looks like after a blast
export const SAPLING: BlockId = 29; // plant one, and in a minute it is a tree
export const DOOR: BlockId = 30; // closed door, BOTTOM half: solid, painted like a door
export const DOOR_OPEN: BlockId = 31; // the same door, opened with the pet/interact button
export const SLAB: BlockId = 32; // a flat half-height plate (this used to be called "stairs")
export const DOOR_TOP: BlockId = 33; // closed door, TOP half (placed automatically above DOOR)
export const DOOR_TOP_OPEN: BlockId = 34; // top half of an opened door
export const STAIRS: BlockId = 35; // a real step: half the cell low, half of it high
export const CHEST: BlockId = 36; // a treasure chest, lid shut
export const CHEST_OPEN: BlockId = 37; // the same chest with the lid up: treasure already taken
export const WATER_FLOW: BlockId = 38; // travelling water: spreads, shallows and dries up
/**
 * The bucket (core/bucket.ts): NOT a block anyone can stand in — it is the one
 * palette item that is a *tool*. Emptied, it scoops a spring of WATER up;
 * full, pressing build pours that spring out again. It is never written into
 * the voxel grid, so nothing about the world's storage changes.
 */
export const BUCKET: BlockId = 39;

/**
 * Cells of the procedural *block* texture atlas (see render/textures.ts).
 * One 32x32 cell per block face style, laid out in a single row; the mesher
 * divides u by ATLAS_CELL_COUNT, so keep it in step with BLOCK_CELLS there.
 */
export const ATLAS_CELL_COUNT = 28;
export const ATLAS_DYNAMITE_SIDE = 0;
export const ATLAS_DYNAMITE_CAP = 1;
export const ATLAS_GRASS_TOP = 2;
export const ATLAS_GRASS_SIDE = 3;
export const ATLAS_DIRT = 4;
export const ATLAS_STONE = 5;
export const ATLAS_SAND = 6;
export const ATLAS_LOG_SIDE = 7;
export const ATLAS_LOG_END = 8;
export const ATLAS_PLANKS = 9;
export const ATLAS_BRICKS = 10;
export const ATLAS_GLASS = 11;
export const ATLAS_LEAVES = 12;
export const ATLAS_WATER = 13;
export const ATLAS_GLOW = 14;
export const ATLAS_BOUNCY = 15;
export const ATLAS_SPARKLE = 16;
export const ATLAS_MUSIC = 17;
export const ATLAS_ROCK = 18;
export const ATLAS_SCORCH = 19;
/** near-white weave: the flat candy colours multiply through it */
export const ATLAS_WEAVE = 20;
/** a painted wooden door: two panels, hinges and a round knob */
export const ATLAS_DOOR = 21;
/** the door's upper half: an inset panel with a little window */
export const ATLAS_DOOR_TOP = 22;
/** a treasure chest: the side with the brass lock, and the lid seen from above */
export const ATLAS_CHEST_SIDE = 23;
export const ATLAS_CHEST_LID = 24;
/** the chest's underside: dark boards and iron braces */
export const ATLAS_CHEST_BOTTOM = 25;
/** the INSIDE of the chest's walls, seen down into an opened chest */
export const ATLAS_CHEST_INSIDE = 26;
/** the treasure sitting at the bottom of an opened chest */
export const ATLAS_CHEST_OPEN_TOP = 27;

/**
 * How a treasure chest is built. It is not a cube, and only its TOP ever
 * opens: shut, it is a 0.85 box with the lid painted on top. Opened, the box
 * is the SAME box — a chest's sides do not change when you lift the lid — but
 * its top face is gone, and in its place the mesher draws an opening you can
 * look down into: the inside of the walls, the treasure at the bottom of them,
 * and a wooden rim where the lid lay. The lid itself is pure render — see
 * mesher.ts addLidPlate — because a lid is the only thing about a chest that
 * ever leaves its own cell.
 */
export const CHEST_HEIGHT = 0.85;
/** how far below the rim the treasure lies (the chest's inside depth) */
export const CHEST_DEPTH = 0.3;
/** how thick the chest's walls look from above, in cells */
export const CHEST_INSET = 0.16;

/**
 * The boxes of an OPEN treasure chest in the cell at (x, y, z). The body is
 * the shut chest's box (same footprint, same height — what a kid stands on
 * does not change when a lid comes off); `inner` is the hollow inside it,
 * whose floor is where the treasure lies. The mesher draws both.
 */
export function chestOpenBoxes(x: number, y: number, z: number): {
  body: VoxelBox; inner: VoxelBox;
} {
  const rim = y + CHEST_HEIGHT;
  const floorY = rim - CHEST_DEPTH;
  return {
    body: [x, y, z, x + 1, rim, z + 1],
    inner: [x + CHEST_INSET, floorY, z + CHEST_INSET, x + 1 - CHEST_INSET, rim, z + 1 - CHEST_INSET],
  };
}

/**
 * Cells of the *plant* atlas (cross blocks). Keep in step with PLANT_CELLS
 * in render/textures.ts — same rule as the block atlas above.
 */
export const PLANT_ATLAS_CELLS = 4;
export const PLANT_CELL_RED = 0;
export const PLANT_CELL_YELLOW = 1;
export const PLANT_CELL_TUFT = 2;
export const PLANT_CELL_SAPLING = 3;

export interface BlockDef {
  id: BlockId;
  name: string;
  icon: string; // emoji for HUD / palette
  /** base tint (0..1) */
  color: [number, number, number];
  /** optional face-specific tints */
  topColor?: [number, number, number];
  sideColor?: [number, number, number];
  /** solid = collidable for players and animals */
  solid: boolean;
  /** opaque = hides neighboring faces when meshing */
  opaque: boolean;
  /** rendered as a translucent cube (water, glass) */
  translucent?: boolean;
  /** rendered as crossed quads (flowers, plants) — not collidable */
  cross?: boolean;
  /** which 32x32 cell of the plant texture atlas to use (cross blocks) */
  atlasCell?: number;
  /** paint the four sides from this cell of the *block* texture atlas */
  sideAtlasCell?: number;
  /** paint the top face from this cell of the block texture atlas */
  capAtlasCell?: number;
  /** paint the bottom face from this cell (defaults to the top cell) */
  bottomAtlasCell?: number;
  /** the atlas art is near-white: multiply it by this block's colour instead */
  tintTexture?: boolean;
  /** full-brightness emissive look */
  emissive?: boolean;
  /** launches players who land on it */
  bounce?: number;
  /** emits gentle sparkles */
  sparkle?: boolean;
  /** plays a note when stepped on */
  note?: number;
  /** cannot be removed by players */
  unbreakable?: boolean;
  /** collidable height of this block in its cell, 0..1 (a slab is a half plate,
   *  a chest a squat box); the mesher draws exactly the same box. Default 1 */
  solidHeight?: number;
  /** blows the surroundings away; sizzles and shakes before it goes */
  explosive?: boolean;
  /** seconds of fuse once it is lit (explosive blocks only) */
  fuse?: number;
}

const rgb = (r: number, g: number, b: number): [number, number, number] => [r / 255, g / 255, b / 255];

const DEFS: BlockDef[] = [
  { id: AIR, name: 'Air', icon: '', color: [0, 0, 0], solid: false, opaque: false },
  {
    id: GRASS, name: 'Grass', icon: '🌱', color: rgb(110, 187, 78),
    topColor: rgb(104, 190, 66), sideColor: rgb(150, 145, 92),
    sideAtlasCell: ATLAS_GRASS_SIDE, capAtlasCell: ATLAS_GRASS_TOP, bottomAtlasCell: ATLAS_DIRT,
    solid: true, opaque: true,
  },
  {
    id: DIRT, name: 'Dirt', icon: '🟫', color: rgb(155, 107, 67),
    sideAtlasCell: ATLAS_DIRT, solid: true, opaque: true,
  },
  {
    id: STONE, name: 'Stone', icon: '🪨', color: rgb(154, 160, 168),
    sideAtlasCell: ATLAS_STONE, solid: true, opaque: true,
  },
  {
    id: SAND, name: 'Sand', icon: '🏖️', color: rgb(242, 223, 165),
    sideAtlasCell: ATLAS_SAND, solid: true, opaque: true,
  },
  {
    id: WOOD, name: 'Wood', icon: '🪵', color: rgb(122, 90, 55),
    topColor: rgb(171, 138, 92),
    sideAtlasCell: ATLAS_LOG_SIDE, capAtlasCell: ATLAS_LOG_END,
    solid: true, opaque: true,
  },
  {
    id: PLANKS, name: 'Planks', icon: '🟨', color: rgb(200, 154, 95),
    sideAtlasCell: ATLAS_PLANKS, solid: true, opaque: true,
  },
  {
    id: BRICKS, name: 'Bricks', icon: '🧱', color: rgb(217, 105, 79),
    sideAtlasCell: ATLAS_BRICKS, solid: true, opaque: true,
  },
  {
    id: GLASS, name: 'Glass', icon: '🪟', color: rgb(198, 232, 255),
    sideAtlasCell: ATLAS_GLASS, solid: true, opaque: false, translucent: true,
  },
  {
    id: LEAVES, name: 'Leaves', icon: '🍃', color: rgb(88, 176, 80),
    sideAtlasCell: ATLAS_LEAVES, solid: true, opaque: true,
  },
  {
    // Water is drawn from its own animated sheet (render/textures.ts
    // waterTexture), not from the block atlas: a flowing surface wants to move.
    // Its cell height comes from how deep it is (core/water.ts waterSurfaceHeight).
    id: WATER, name: 'Water', icon: '💧', color: rgb(79, 179, 232),
    solid: false, opaque: false, translucent: true,
  },
  {
    id: WATER_FLOW, name: 'Flowing Water', icon: '💧', color: rgb(96, 190, 238),
    solid: false, opaque: false, translucent: true,
  },
  { id: FLOWER_RED, name: 'Flower', icon: '🌷', color: rgb(255, 122, 108), solid: false, opaque: false, cross: true, atlasCell: 0 },
  { id: FLOWER_YELLOW, name: 'Sunflower', icon: '🌼', color: rgb(255, 214, 94), solid: false, opaque: false, cross: true, atlasCell: 1 },
  { id: TALLGRASS, name: 'Grass Tuft', icon: '🌿', color: rgb(110, 190, 90), solid: false, opaque: false, cross: true, atlasCell: 2 },
  { id: GLOW, name: 'Glow Block', icon: '💡', color: rgb(255, 226, 138), solid: true, opaque: true, emissive: true, sideAtlasCell: ATLAS_GLOW },
  { id: BOUNCY, name: 'Bouncy Block', icon: '🍬', color: rgb(255, 123, 213), solid: true, opaque: true, bounce: 11.5, sideAtlasCell: ATLAS_BOUNCY },
  { id: SPARKLE, name: 'Sparkle Block', icon: '✨', color: rgb(185, 231, 255), solid: true, opaque: true, sparkle: true, sideAtlasCell: ATLAS_SPARKLE },
  { id: MUSIC, name: 'Music Block', icon: '🎵', color: rgb(179, 157, 219), solid: true, opaque: true, note: 0, sideAtlasCell: ATLAS_MUSIC },
  // The candy colours keep their own tint and multiply a near-white weave, so
  // they read as painted building bricks rather than solid plastic.
  { id: C_RED, name: 'Red', icon: '🟥', color: rgb(255, 93, 93), solid: true, opaque: true, sideAtlasCell: ATLAS_WEAVE, tintTexture: true },
  { id: C_ORANGE, name: 'Orange', icon: '🟧', color: rgb(255, 159, 69), solid: true, opaque: true, sideAtlasCell: ATLAS_WEAVE, tintTexture: true },
  { id: C_YELLOW, name: 'Yellow', icon: '🟨', color: rgb(255, 215, 94), solid: true, opaque: true, sideAtlasCell: ATLAS_WEAVE, tintTexture: true },
  { id: C_GREEN, name: 'Green', icon: '🟩', color: rgb(93, 208, 107), solid: true, opaque: true, sideAtlasCell: ATLAS_WEAVE, tintTexture: true },
  { id: C_BLUE, name: 'Blue', icon: '🟦', color: rgb(93, 155, 255), solid: true, opaque: true, sideAtlasCell: ATLAS_WEAVE, tintTexture: true },
  { id: C_PURPLE, name: 'Purple', icon: '🟪', color: rgb(176, 107, 255), solid: true, opaque: true, sideAtlasCell: ATLAS_WEAVE, tintTexture: true },
  { id: C_PINK, name: 'Pink', icon: '🟪', color: rgb(255, 138, 212), solid: true, opaque: true, sideAtlasCell: ATLAS_WEAVE, tintTexture: true },
  { id: C_WHITE, name: 'White', icon: '⬜', color: rgb(245, 245, 245), solid: true, opaque: true, sideAtlasCell: ATLAS_WEAVE, tintTexture: true },
  { id: ROCK, name: 'Rock', icon: '⛰️', color: rgb(90, 96, 108), solid: true, opaque: true, unbreakable: true, sideAtlasCell: ATLAS_ROCK },
  {
    id: DYNAMITE, name: 'Dynamite', icon: '🧨', color: rgb(236, 110, 84),
    sideAtlasCell: ATLAS_DYNAMITE_SIDE, capAtlasCell: ATLAS_DYNAMITE_CAP,
    solid: true, opaque: true, explosive: true, fuse: 2.6,
  },
  {
    id: SCORCH, name: 'Scorched Ground', icon: '🕳️', color: rgb(97, 76, 57),
    topColor: rgb(84, 66, 49), sideColor: rgb(104, 82, 61),
    sideAtlasCell: ATLAS_SCORCH, solid: true, opaque: true,
  },
  {
    id: SAPLING, name: 'Sapling', icon: '🌳', color: rgb(110, 190, 100),
    solid: false, opaque: false, cross: true, atlasCell: PLANT_CELL_SAPLING,
  },
  {
    // A door is TWO blocks high (this cell plus DOOR_TOP above it) and its
    // panel is only half a block thick: the mesher paints a 0.5-thick panel
    // centred in the cell, and a closed door collides as that same panel
    // (see physics.solidBoxesOf). Placing one fills both cells at once, and the
    // pet/interact button swings the pair (see tryPlace / toggleDoor in game.ts).
    id: DOOR, name: 'Door', icon: '🚪', color: rgb(178, 122, 70),
    sideAtlasCell: ATLAS_DOOR, solid: true, opaque: false,
  },
  {
    id: DOOR_TOP, name: 'Door (upper half)', icon: '🚪', color: rgb(178, 122, 70),
    sideAtlasCell: ATLAS_DOOR_TOP, solid: true, opaque: false,
  },
  {
    // the same doors swung open with the pet/interact button: walk straight
    // through them; the panel stays visible standing along the doorway
    id: DOOR_OPEN, name: 'Door (open)', icon: '🚪', color: rgb(178, 122, 70),
    sideAtlasCell: ATLAS_DOOR, solid: false, opaque: false,
  },
  {
    id: DOOR_TOP_OPEN, name: 'Door (upper half open)', icon: '🚪', color: rgb(178, 122, 70),
    sideAtlasCell: ATLAS_DOOR_TOP, solid: false, opaque: false,
  },
  {
    // a flat wooden plate half a block tall: kids walk straight up onto it from
    // any side, and two stacked make a full block. (Until the stairs below were
    // really built, this is what the palette called "Stairs".)
    id: SLAB, name: 'Slab', icon: '⬛', color: rgb(200, 154, 95),
    sideAtlasCell: ATLAS_PLANKS, solid: true, opaque: false, solidHeight: 0.5,
  },
  {
    // A real step: the half of the cell it points into is full height, the other
    // half is a half-high tread, so walking one lifts you a step at a time and a
    // row of them climbs a whole block. `world.stairFacing` says which way each
    // one points (see stairBoxes below); the pet button spins one around.
    id: STAIRS, name: 'Stairs', icon: '🪜', color: rgb(200, 154, 95),
    sideAtlasCell: ATLAS_PLANKS, solid: true, opaque: false,
  },
  {
    // A squat treasure chest (0.85 of a cell tall, painted with a brass lock).
    // A dozen or so are hidden in every world; the pet button lifts the lid and
    // out comes a random treasure (see core/treasure.ts). Opened ones stay open.
    // Only the TOP of a chest opens, so the shut chest is the one that owns the
    // artwork: the opened one keeps these very side and bottom cells.
    id: CHEST, name: 'Treasure Chest', icon: '📦', color: rgb(178, 122, 70),
    sideAtlasCell: ATLAS_CHEST_SIDE, capAtlasCell: ATLAS_CHEST_LID,
    bottomAtlasCell: ATLAS_CHEST_BOTTOM,
    solid: true, opaque: true, solidHeight: CHEST_HEIGHT,
  },
  {
    // lid up, treasure gone: it keeps looking opened forever, so nobody
    // shakes the same chest twice. It is the same box from outside (the same
    // side art, the same height, so what you stand on does not change) — the
    // difference is on top: an opening you can see down into, and the lid
    // standing up at the back (see mesher.ts addOpenChestShape).
    id: CHEST_OPEN, name: 'Chest (open)', icon: '📦', color: rgb(151, 104, 60),
    sideAtlasCell: ATLAS_CHEST_SIDE, capAtlasCell: ATLAS_CHEST_OPEN_TOP,
    bottomAtlasCell: ATLAS_CHEST_BOTTOM,
    solid: true, opaque: true, solidHeight: CHEST_HEIGHT,
  },
  {
    // The one palette item that is a tool instead of a brick: scoop a spring
    // with it, pour the spring out somewhere else (core/bucket.ts). The
    // player carries it, so it never lands in the voxel grid.
    id: BUCKET, name: 'Bucket', icon: '🪣', color: rgb(186, 205, 224),
    solid: false, opaque: false,
  },
];

export const BLOCK_MAP = new Map<BlockId, BlockDef>(DEFS.map((d) => [d.id, d]));

export function blockDef(id: BlockId): BlockDef {
  const d = BLOCK_MAP.get(id);
  if (!d) throw new Error(`Unknown block id ${id}`);
  return d;
}

export function isAir(id: BlockId): boolean {
  return id === AIR;
}
export function isSolidBlock(id: BlockId): boolean {
  return id !== AIR && blockDef(id).solid;
}
export function isOpaqueBlock(id: BlockId): boolean {
  return id !== AIR && blockDef(id).opaque;
}
/**
 * Does this block cover the whole face it shares with a neighbouring cell?
 * Only such a neighbour may make a block skip its own face: a slab, a stair, a
 * door panel or a squat treasure chest stops short of the cell border, so
 * skipping the shared face would leave a hole you can see straight through the
 * world. (Face culling only — ambient occlusion still treats a chest as solid.)
 */
export function isFullCellBlock(id: BlockId): boolean {
  return isOpaqueBlock(id) && solidHeightOf(id) >= 1;
}
/** WATER (a source, eternal) or WATER_FLOW (travelling): both are wet */
export function isWaterId(id: BlockId): boolean {
  return id === WATER || id === WATER_FLOW;
}

export function isCrossBlock(id: BlockId): boolean {
  return id !== AIR && !!blockDef(id).cross;
}
export function isTranslucentBlock(id: BlockId): boolean {
  return id !== AIR && !!blockDef(id).translucent;
}
export function isExplosiveBlock(id: BlockId): boolean {
  return id !== AIR && !!blockDef(id).explosive;
}
/** blocks whose faces get painted from the block texture atlas */
export function isTexturedBlock(id: BlockId): boolean {
  return id !== AIR && blockDef(id).sideAtlasCell !== undefined;
}

/**
 * What material a block is made of, for sound: placing, breaking, landing
 * and footsteps all borrow their character from it.
 */
export type SoundFamily = 'wood' | 'stone' | 'soft' | 'glass' | 'plant';

const SOUND_FAMILIES = new Map<BlockId, SoundFamily>([
  [WOOD, 'wood'], [PLANKS, 'wood'], [SLAB, 'wood'], [STAIRS, 'wood'], [CHEST, 'wood'], [CHEST_OPEN, 'wood'],
  [MUSIC, 'wood'], [DYNAMITE, 'wood'],
  [STONE, 'stone'], [BRICKS, 'stone'], [ROCK, 'stone'],
  [GRASS, 'soft'], [DIRT, 'soft'], [SAND, 'soft'], [SCORCH, 'soft'], [C_WHITE, 'soft'], [BOUNCY, 'soft'],
  [GLASS, 'glass'], [GLOW, 'glass'], [SPARKLE, 'glass'],
  [LEAVES, 'plant'], [FLOWER_RED, 'plant'], [FLOWER_YELLOW, 'plant'], [TALLGRASS, 'plant'], [SAPLING, 'plant'],
]);

export function soundFamilyOf(id: BlockId): SoundFamily {
  return SOUND_FAMILIES.get(id) ?? 'wood';
}

/** is a block id one of the four door states? (interact button flips them) */
export function isDoorBlock(id: BlockId): boolean {
  return id === DOOR || id === DOOR_OPEN || id === DOOR_TOP || id === DOOR_TOP_OPEN;
}
/** a door half that stands closed (solid, and collides as its thin panel) */
export function isDoorClosedBlock(id: BlockId): boolean {
  return id === DOOR || id === DOOR_TOP;
}
/** the UPPER half of a door — placed/toggled only together with the bottom */
export function isDoorTopBlock(id: BlockId): boolean {
  return id === DOOR_TOP || id === DOOR_TOP_OPEN;
}
/** a stair cell: its shape (and which way it points) lives in world.stairFacing */
export function isStairsBlock(id: BlockId): boolean {
  return id === STAIRS;
}
/** either state of a treasure chest — the pet button lifts the lid */
export function isChestBlock(id: BlockId): boolean {
  return id === CHEST || id === CHEST_OPEN;
}
/** the bucket tool — scoops a spring up, pours it out again (core/bucket.ts) */
export function isBucket(id: BlockId): boolean {
  return id === BUCKET;
}
/** collidable height of a block id in its cell (0 for non-solids, 0.5 for a slab) */
export function solidHeightOf(id: BlockId): number {
  if (id === AIR) return 0;
  const def = blockDef(id);
  return def.solid ? (def.solidHeight ?? 1) : 0;
}

/**
 * Which half of a stair cell holds the TALL part: 0 = +x, 1 = -x, 2 = +z,
 * 3 = -z. The low half — the tread you step onto — is always the opposite one,
 * so walking toward the tall side climbs a step.
 */
export type StairFacing = 0 | 1 | 2 | 3;

/** a box in world space: min corner then max corner */
export type VoxelBox = [number, number, number, number, number, number];

/** the two boxes a stair cell is made of: the tall half and the half-high tread */
export function stairBoxes(x: number, y: number, z: number, facing: StairFacing): { tall: VoxelBox; low: VoxelBox } {
  const f = (facing >= 0 && facing <= 3 ? facing : 0) as StairFacing;
  if (f === 0) return { tall: [x + 0.5, y, z, x + 1, y + 1, z + 1], low: [x, y, z, x + 0.5, y + 0.5, z + 1] };
  if (f === 1) return { tall: [x, y, z, x + 0.5, y + 1, z + 1], low: [x + 0.5, y, z, x + 1, y + 0.5, z + 1] };
  if (f === 2) return { tall: [x, y, z + 0.5, x + 1, y + 1, z + 1], low: [x, y, z, x + 1, y + 0.5, z + 0.5] };
  return { tall: [x, y, z, x + 1, y + 1, z + 0.5], low: [x, y, z + 0.5, x + 1, y + 0.5, z + 1] };
}

/** a quarter turn, the same way a kid spins a step with the pet button */
export function rotateStairFacing(facing: number): StairFacing {
  const turn = [2, 3, 1, 0]; // +x -> +z -> -x -> -z -> +x
  return turn[facing >= 0 && facing <= 3 ? facing : 0] as StairFacing;
}

/**
 * Blocks offered in the child-friendly creative palette (in order). The bucket
 * stands where the water source used to: water is *poured* from a bucket now,
 * never set down straight from a menu, so kids have to walk a puddle home.
 * Treasure chests are here only when grown-ups allow building them — see
 * `paletteFor`, which is the palette the game actually shows.
 */
export const PALETTE: BlockId[] = [
  GRASS, DIRT, STONE, SAND, WOOD, PLANKS, STAIRS, SLAB, DOOR, BRICKS, GLASS, LEAVES,
  BUCKET,
  SAPLING, FLOWER_RED, FLOWER_YELLOW, TALLGRASS,
  GLOW, BOUNCY, SPARKLE, MUSIC, DYNAMITE,
  C_RED, C_ORANGE, C_YELLOW, C_GREEN, C_BLUE, C_PURPLE, C_PINK, C_WHITE,
];

/**
 * The live palette: the base list, plus a treasure chest among the things you
 * build when grown-ups have left "Treasure Chests" on (Grown-Up Settings).
 * Chests are still only *found* in a world where they are off — the toggle
 * decides whether a kid may place one, nothing about the loot inside.
 */
export function paletteFor(allowChests: boolean): BlockId[] {
  if (!allowChests) return PALETTE;
  const withChests = [...PALETTE];
  withChests.splice(withChests.indexOf(DOOR) + 1, 0, CHEST);
  return withChests;
}

/** Quick-cycling favorites for shoulder buttons. */
export const FAVORITES: BlockId[] = [
  GRASS, PLANKS, STAIRS, SLAB, BRICKS, GLASS, DOOR, GLOW, BOUNCY, SPARKLE, MUSIC, DYNAMITE,
  C_RED, C_BLUE, C_PINK, C_YELLOW,
];
