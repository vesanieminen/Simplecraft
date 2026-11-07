/**
 * The fish satchel: every fish a kid reels in goes into the little pouch on
 * their back, where it waits until they decide to eat it — D-pad ▾ on a pad
 * (I on the keyboard) opens the pouch right in the world, listing the day's
 * catch with a count. (The 🐟 chip on the HUD keeps the total visible even
 * when the pouch is shut.)
 *
 * Eating is the reward loop after the stars: each kind gives its own tasty
 * boost, so picking dinner is a tiny adventure too. Like stars and the fish
 * themselves, the pouch is NOT saved with the world — it is today's catch,
 * for today's kid.
 */

import { FishKind, FISH_KINDS } from './fish';

export type SnackEffect = 'zoom' | 'boing' | 'zoom+boing';

export interface FishSnack {
  /** which boost eating this kind gives (applied by Game.eatFish) */
  effect: SnackEffect;
  /** how long the boost lasts, in seconds of game time */
  seconds: number;
  /** what the kid is told as they munch it */
  message: string;
}

/** one snack per kind (see FISH_DEFS in core/fish.ts) — bigger fish feast longer */
export const FISH_SNACKS: Record<FishKind, FishSnack> = {
  minnow: { effect: 'boing', seconds: 12, message: 'A slidy little minnow — boingy legs!' },
  sunfish: { effect: 'zoom', seconds: 12, message: 'Sunny sunfish supper — zoomy feet!' },
  puffer: { effect: 'boing', seconds: 18, message: 'A puffy puffer puff — extra-springy legs!' },
  bass: { effect: 'zoom', seconds: 18, message: 'A big fat bass — super-duper zoomy feet!' },
  golden: { effect: 'zoom+boing', seconds: 24, message: 'A GOLDEN fish — zoomy AND boingy!' },
};

/** the boost badge each snack wears in the satchel menu (matches the HUD tags) */
export const SNACK_BADGES: Record<SnackEffect, string> = {
  zoom: '🌈',
  boing: '🦘',
  'zoom+boing': '🌈🦘',
};

export class Satchel {
  /** how many of each kind this kid is carrying */
  readonly counts: Record<FishKind, number> = {
    minnow: 0, sunfish: 0, puffer: 0, bass: 0, golden: 0,
  };

  add(kind: FishKind): void {
    this.counts[kind] += 1;
  }

  /** take one fish out to eat it; false when this kind is gone */
  take(kind: FishKind): boolean {
    if (this.counts[kind] <= 0) return false;
    this.counts[kind] -= 1;
    return true;
  }

  total(): number {
    return FISH_KINDS.reduce((s, k) => s + this.counts[k], 0);
  }

  /** the kinds with at least one fish in them, in FISH_KINDS order (menu row order) */
  kinds(): FishKind[] {
    return FISH_KINDS.filter((k) => this.counts[k] > 0);
  }
}
