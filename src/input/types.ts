/**
 * Input abstraction. Everything in the game consumes FrameControls,
 * never raw devices — so gamepads, keyboard and virtual test pads are
 * fully interchangeable.
 */

export type Action =
  | 'jump' | 'back' | 'interact' | 'palette' | 'menu'
  | 'place' | 'remove' | 'prevBlock' | 'nextBlock'
  | 'up' | 'down' | 'left' | 'right';

export const ALL_ACTIONS: Action[] = [
  'jump', 'back', 'interact', 'palette', 'menu', 'place', 'remove', 'prevBlock', 'nextBlock',
  'up', 'down', 'left', 'right',
];

export type ControllerType = 'xbox' | 'playstation' | 'generic' | 'keyboard';

export interface Vec2 {
  x: number;
  y: number;
}

/** Raw device state for one frame (all axes deadzone-applied by the source). */
export interface RawFrame {
  move: Vec2;
  look: Vec2;
  actions: Partial<Record<Action, boolean>>;
}

export interface InputSource {
  readonly id: string;
  readonly kind: 'gamepad' | 'keyboard' | 'virtual';
  readonly label: string;
  readonly controllerType: ControllerType;
  poll(): RawFrame;
  dispose?(): void;
}

export interface FrameControls {
  move: Vec2;
  look: Vec2;
  held: ReadonlySet<Action>;
  pressed: ReadonlySet<Action>;
  released: ReadonlySet<Action>;
  /** true if any button was pressed this frame (for "press any button") */
  anyPressed: boolean;
}

export function emptyFrame(): FrameControls {
  return { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, held: new Set(), pressed: new Set(), released: new Set(), anyPressed: false };
}

export function deadzone(v: number, dz: number): number {
  if (Math.abs(v) < dz) return 0;
  const s = Math.sign(v);
  const x = (Math.abs(v) - dz) / (1 - dz);
  return s * Math.min(1, x * x * (3 - 2 * x) * 1.0 + x * 0.0);
}

/** smooth radial response: zero inside dz, eased outside */
export function applyDeadzone(x: number, y: number, dz: number): Vec2 {
  const len = Math.hypot(x, y);
  if (len < dz) return { x: 0, y: 0 };
  const t = (len - dz) / (1 - dz);
  const eased = t * t * (3 - 2 * t);
  const k = eased / len;
  return { x: x * k, y: y * k };
}

/**
 * Press gate: guarantees a release frame between consecutive presses of
 * the same action, even when a harness dispatches keydown/keyup faster
 * than the frame rate. Continuous physical holds pass through untouched.
 */
export class ActionGate {
  private gap = new Map<Action, number>();
  private fresh: Action[] = [];

  /** mark a brand-new physical press */
  flagFresh(...actions: Action[]): void {
    this.fresh.push(...actions);
  }

  /** filter the candidate emissions for this poll (held set) */
  filter(candidate: Set<Action>): Set<Action> {
    const deferred: Action[] = [];
    for (const a of this.fresh) {
      if ((this.gap.get(a) ?? 0) > 0) {
        deferred.push(a);
        candidate.delete(a); // force the release frame
      } else {
        candidate.add(a);
      }
    }
    this.fresh = deferred;
    for (const a of candidate) this.gap.set(a, 1);
    for (const [a, g] of [...this.gap]) {
      if (!candidate.has(a)) {
        if (g - 1 <= 0) this.gap.delete(a);
        else this.gap.set(a, g - 1);
      }
    }
    return candidate;
  }
}
