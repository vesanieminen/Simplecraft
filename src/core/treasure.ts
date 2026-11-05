/**
 * What a treasure chest can hold.
 *
 * The game has no inventory, so every treasure is something that happens right
 * there in the world: stars to collect, boots that make you fast, a surprise
 * animal friend. Rarity is written into the table so opening a chest stays a
 * surprise even for a kid who finds their tenth one.
 */

export type TreasureId = 'stars' | 'starburst' | 'zoom' | 'boing' | 'animal' | 'gem';

export interface Treasure {
  id: TreasureId;
  icon: string;
  /** what the child is told when the lid comes up */
  message: string;
  /** odds are weight / total weight */
  weight: number;
  /** stars for the 'stars' and 'gem' treasures */
  amount?: number;
}

export const TREASURES: Treasure[] = [
  { id: 'stars', icon: '⭐', message: 'A pile of stars!', weight: 30, amount: 4 },
  { id: 'starburst', icon: '🌟', message: 'Stars jumped out — catch them!', weight: 22 },
  { id: 'zoom', icon: '🌈', message: 'Zoomy boots: run super fast!', weight: 16 },
  { id: 'boing', icon: '🦘', message: 'Boing boots: mega jumps!', weight: 16 },
  { id: 'animal', icon: '🐣', message: 'A surprise animal friend!', weight: 12 },
  { id: 'gem', icon: '💎', message: 'A GIANT diamond!', weight: 4, amount: 25 },
];

/** one treasure, picked by weight. `rnd` is injectable so tests can be dull and deterministic */
export function rollTreasure(rnd: () => number = Math.random): Treasure {
  const total = TREASURES.reduce((sum, t) => sum + t.weight, 0);
  let r = Math.max(0, Math.min(0.999999, rnd())) * total;
  for (const t of TREASURES) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return TREASURES[TREASURES.length - 1];
}

/** how long a treasure boost lasts, in seconds of game time */
export const BOOST_SECONDS = 30;

/** the treasure a chest that has already been opened hands out: none */
export const EMPTY_CHEST_MESSAGE = 'That chest is empty — the treasure is already yours!';
