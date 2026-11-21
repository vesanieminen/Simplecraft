/**
 * The railway. A rail is an ordinary voxel, and *nothing* about how it joins up
 * is stored: like the big game, a rail connects to whatever rail is next door,
 * including one step up, so a line of them becomes a track with corners and
 * slopes all by itself. The mesher and the cart sim both read the same four
 * rules from here, which is the only way a drawn track and a ridden track can
 * stay the same track.
 *
 * Direction numbering is the game's usual one — the same as stairs and ladders:
 * 0 = +x, 1 = -x, 2 = +z, 3 = -z.
 */

import {
  AIR, BlockId, isCrossBlock, isRailBlock, isSolidBlock, isWaterId, POWERED_RAIL, RAIL_HEIGHT, solidHeightOf,
} from './blocks';
import { World, WORLD_SY } from './world';

export const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** which direction cancels which (0 ↔ 1, 2 ↔ 3) */
export const BACK: ReadonlyArray<number> = [1, 0, 3, 2];

/** how a rail cell continues in one direction */
export const LINK_NONE = 0;
/** the next rail is in the same cell row: flat track */
export const LINK_FLAT = 1;
/** the next rail is one block UP: this cell is the slope, and it climbs */
export const LINK_UP = 2;
/** the next rail is one block DOWN: the slope lives in the cell below */
export const LINK_DOWN = 3;

export interface RailCell {
  x: number;
  y: number;
  z: number;
  id: BlockId;
  /** the red one: it throws any cart rolling over it up to speed */
  powered: boolean;
  /** per direction, one of the LINK_* values */
  links: number[];
}

/** can a cart's body pass through this cell? (rails, plants and air are fine) */
function openAt(world: World, x: number, y: number, z: number): boolean {
  if (y < 0 || y >= WORLD_SY) return false;
  const id = world.get(x, y, z);
  return !isSolidBlock(id) && !isWaterId(id);
}

/**
 * What the rail in this cell (if any) connects to. Three rules, in order:
 *
 *  1. a rail in the next cell over is flat track;
 *  2. a rail one block up, with room over our own head, is a slope climbing
 *     out of THIS cell (the big game's ascending rail);
 *  3. a rail one block down, with room over ITS head, is the same slope seen
 *     from the top — so the two cells agree without either one storing it.
 */
export function railCellAt(world: World, x: number, y: number, z: number): RailCell | null {
  const id = world.get(x, y, z);
  if (!isRailBlock(id)) return null;
  const links = [LINK_NONE, LINK_NONE, LINK_NONE, LINK_NONE];
  for (let d = 0; d < 4; d++) {
    const [dx, dz] = DIRS[d];
    if (isRailBlock(world.get(x + dx, y, z + dz))) {
      links[d] = LINK_FLAT;
    } else if (isRailBlock(world.get(x + dx, y + 1, z + dz)) && openAt(world, x, y + 1, z)) {
      links[d] = LINK_UP;
    } else if (isRailBlock(world.get(x + dx, y - 1, z + dz)) && openAt(world, x + dx, y, z + dz)) {
      links[d] = LINK_DOWN;
    }
  }
  return { x, y, z, id, powered: id === POWERED_RAIL, links };
}

/** is there any rail at all in this cell? */
export function isRailAt(world: World, x: number, y: number, z: number): boolean {
  return isRailBlock(world.get(x, y, z));
}

/**
 * Where a cart's wheels ride in a rail cell: the top of the rail plate. Every
 * level the cart sim uses is measured like this, so the cart sits ON the track
 * rather than sunk into it.
 */
export function railLevel(world: World, x: number, y: number, z: number): number {
  return isRailAt(world, x, y, z) ? y + RAIL_HEIGHT : y + solidHeightOf(world.get(x, y, z));
}

/**
 * Track may only be laid on something solid: a rail is a plate on the ground,
 * not a floating tile. The cell it goes in must be empty (a flower is fine —
 * the track flattens it), and the cell underneath must have a top to nail to.
 */
export function canPlaceRail(world: World, x: number, y: number, z: number): boolean {
  if (!world.inBounds(x, y, z) || y <= 0) return false;
  const here = world.get(x, y, z);
  if (here !== AIR && !isCrossBlock(here)) return false;
  return solidHeightOf(world.get(x, y - 1, z)) > 0;
}

/**
 * Which way a cart leaves a junction. It goes straight on if it can — that is
 * what makes a crossing a crossing rather than a trap — and otherwise it turns.
 * A rider's look direction picks the turn (the big game does exactly this, and
 * it is how you steer without any steering wheel). With nobody aboard, the
 * turn is a coin toss between the two ways round.
 *
 * Returns the direction to head, or -1 at a dead end (roll off the end and
 * see what happens).
 */
export function chooseExit(
  cell: RailCell, cameDir: number, riderYaw: number | null, rnd: () => number,
): number {
  if (cell.links[cameDir] !== LINK_NONE) return cameDir; // straight on, past every corner
  const ways: number[] = [];
  for (let d = 0; d < 4; d++) {
    if (d === BACK[cameDir]) continue; // never back up into the cell we came from
    if (cell.links[d] !== LINK_NONE) ways.push(d);
  }
  if (ways.length === 0) return -1;
  if (ways.length === 1) return ways[0];
  if (riderYaw === null) return ways[Math.floor(rnd() * ways.length)];
  // the rider is looking somewhere: take the way that matches it best
  const lx = Math.sin(riderYaw), lz = Math.cos(riderYaw);
  let best = ways[0], bestScore = -Infinity;
  for (const d of ways) {
    const [dx, dz] = DIRS[d];
    const score = lx * dx + lz * dz;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Is this cell a slope for a cart travelling in `dir`? Slopes live in the LOWER
 * cell, so a cart crossing one climbs (or falls) the whole way through it, and
 * the height at the middle of the cell is half a block off the floor.
 */
export function isSlopeCell(cell: RailCell, dir: number): boolean {
  return cell.links[dir] === LINK_UP || cell.links[BACK[dir]] === LINK_UP;
}

/**
 * The height a cart's wheels are at on leaving this cell in `dir`. A flat join
 * carries the floor straight on; an ascending one climbs to the top of the cell
 * (that is where the next cell's floor begins); a descending one drops to the
 * bottom of the cell — the slope itself lives in the cell below, and the cart
 * rides down through it.
 */
export function exitLevelOf(cell: RailCell, dir: number): number {
  const link = cell.links[dir];
  if (link === LINK_UP) return cell.y + 1;
  if (link === LINK_DOWN) return cell.y;
  return cell.y + RAIL_HEIGHT;
}
