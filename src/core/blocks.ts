/**
 * Block registry — every block type in Little Block World.
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

/** cells of the procedural *block* texture atlas (see render/textures.ts) */
export const ATLAS_DYNAMITE_SIDE = 0;
export const ATLAS_DYNAMITE_CAP = 1;

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
  /** paint the top and bottom from this cell of the block texture atlas */
  capAtlasCell?: number;
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
    solid: true, opaque: true,
  },
  { id: DIRT, name: 'Dirt', icon: '🟫', color: rgb(155, 107, 67), solid: true, opaque: true },
  { id: STONE, name: 'Stone', icon: '🪨', color: rgb(154, 160, 168), solid: true, opaque: true },
  { id: SAND, name: 'Sand', icon: '🏖️', color: rgb(242, 223, 165), solid: true, opaque: true },
  {
    id: WOOD, name: 'Wood', icon: '🪵', color: rgb(122, 90, 55),
    topColor: rgb(171, 138, 92), solid: true, opaque: true,
  },
  { id: PLANKS, name: 'Planks', icon: '🟨', color: rgb(200, 154, 95), solid: true, opaque: true },
  { id: BRICKS, name: 'Bricks', icon: '🧱', color: rgb(217, 105, 79), solid: true, opaque: true },
  {
    id: GLASS, name: 'Glass', icon: '🪟', color: rgb(198, 232, 255),
    solid: true, opaque: false, translucent: true,
  },
  { id: LEAVES, name: 'Leaves', icon: '🍃', color: rgb(88, 176, 80), solid: true, opaque: true },
  {
    id: WATER, name: 'Water', icon: '💧', color: rgb(79, 179, 232),
    solid: false, opaque: false, translucent: true,
  },
  { id: FLOWER_RED, name: 'Flower', icon: '🌷', color: rgb(255, 122, 108), solid: false, opaque: false, cross: true, atlasCell: 0 },
  { id: FLOWER_YELLOW, name: 'Sunflower', icon: '🌼', color: rgb(255, 214, 94), solid: false, opaque: false, cross: true, atlasCell: 1 },
  { id: TALLGRASS, name: 'Grass Tuft', icon: '🌿', color: rgb(110, 190, 90), solid: false, opaque: false, cross: true, atlasCell: 2 },
  { id: GLOW, name: 'Glow Block', icon: '💡', color: rgb(255, 226, 138), solid: true, opaque: true, emissive: true },
  { id: BOUNCY, name: 'Bouncy Block', icon: '🍬', color: rgb(255, 123, 213), solid: true, opaque: true, bounce: 11.5 },
  { id: SPARKLE, name: 'Sparkle Block', icon: '✨', color: rgb(185, 231, 255), solid: true, opaque: true, sparkle: true },
  { id: MUSIC, name: 'Music Block', icon: '🎵', color: rgb(179, 157, 219), solid: true, opaque: true, note: 0 },
  { id: C_RED, name: 'Red', icon: '🟥', color: rgb(255, 93, 93), solid: true, opaque: true },
  { id: C_ORANGE, name: 'Orange', icon: '🟧', color: rgb(255, 159, 69), solid: true, opaque: true },
  { id: C_YELLOW, name: 'Yellow', icon: '🟨', color: rgb(255, 215, 94), solid: true, opaque: true },
  { id: C_GREEN, name: 'Green', icon: '🟩', color: rgb(93, 208, 107), solid: true, opaque: true },
  { id: C_BLUE, name: 'Blue', icon: '🟦', color: rgb(93, 155, 255), solid: true, opaque: true },
  { id: C_PURPLE, name: 'Purple', icon: '🟪', color: rgb(176, 107, 255), solid: true, opaque: true },
  { id: C_PINK, name: 'Pink', icon: '🟪', color: rgb(255, 138, 212), solid: true, opaque: true },
  { id: C_WHITE, name: 'White', icon: '⬜', color: rgb(245, 245, 245), solid: true, opaque: true },
  { id: ROCK, name: 'Rock', icon: '⛰️', color: rgb(90, 96, 108), solid: true, opaque: true, unbreakable: true },
  {
    id: DYNAMITE, name: 'Dynamite', icon: '🧨', color: rgb(236, 110, 84),
    sideAtlasCell: ATLAS_DYNAMITE_SIDE, capAtlasCell: ATLAS_DYNAMITE_CAP,
    solid: true, opaque: true, explosive: true, fuse: 2.6,
  },
  {
    id: SCORCH, name: 'Scorched Ground', icon: '🕳️', color: rgb(97, 76, 57),
    topColor: rgb(84, 66, 49), sideColor: rgb(104, 82, 61),
    solid: true, opaque: true,
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

/** Blocks offered in the child-friendly creative palette (in order). */
export const PALETTE: BlockId[] = [
  GRASS, DIRT, STONE, SAND, WOOD, PLANKS, BRICKS, GLASS, LEAVES,
  FLOWER_RED, FLOWER_YELLOW, TALLGRASS,
  GLOW, BOUNCY, SPARKLE, MUSIC, DYNAMITE,
  C_RED, C_ORANGE, C_YELLOW, C_GREEN, C_BLUE, C_PURPLE, C_PINK, C_WHITE,
];

/** Quick-cycling favorites for shoulder buttons. */
export const FAVORITES: BlockId[] = [
  GRASS, PLANKS, BRICKS, GLASS, GLOW, BOUNCY, SPARKLE, MUSIC, DYNAMITE,
  C_RED, C_BLUE, C_PINK, C_YELLOW,
];
