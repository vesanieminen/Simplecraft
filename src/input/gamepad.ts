/**
 * Gamepad API source using the standard mapping, with dead zones and
 * analog trigger thresholds. Works for Xbox / DualShock / DualSense pads.
 */

import { Action, ControllerType, InputSource, RawFrame, applyDeadzone } from './types';

/** standard button index -> action(s).
 *  2026-11-08: the family asked for interaction on the left trigger, so the
 *  triggers became "do the thing" (L2/LT: pet, open a door or chest, cast the
 *  rod, spin a step) and "put it down" (R2/RT: build) — the way the big game
 *  does it. Breaking moved onto the west face button (X / ☐), which used to be
 *  the interact button. D-pad down doubles as the fish satchel: in menus it
 *  only navigates, in the world it opens the pouch.
 *  2026-11-10: the family came back with "actions should happen with the
 *  L2/LT button — placing a block, petting an animal, placing doors and
 *  ladders; removing with R2/RT". So LT now carries BOTH constructive
 *  actions (it emits interact AND place — see LocalPlayer.update: the nice
 *  thing runs first, and the block only goes down when the aim holds nothing
 *  to interact with) and the right trigger broke blocks (X stays as an extra
 *  remove alias for muscle memory). Keyboard keeps E · R-Click · L-Click. */
const BUTTON_MAP: Record<number, Action[]> = {
  0: ['jump'],      // A / Cross
  1: ['back'],      // B / Circle
  2: ['remove'],    // X / Square  — break a block (extra alias of RT)
  3: ['palette'],   // Y / Triangle
  4: ['prevBlock'], // Left bumper
  5: ['nextBlock'], // Right bumper
  6: ['interact', 'place'], // Left trigger — build AND pet: the aim decides,
                            // the nice thing (pet · doors · chests · rod) outranks the block
  7: ['remove'],    // Right trigger — break a block
  8: ['menu'],      // Select/Share doubles as menu for kids? keep start only
  9: ['menu'],      // Start / Options
  12: ['up'],       // D-pad
  13: ['down', 'satchel'],
  14: ['left'],
  15: ['right'],
};

/** exported for the e2e suite: the pad layout is a promise to the couch */
export const GAMEPAD_BUTTON_MAP = BUTTON_MAP;

export function detectControllerType(id: string): ControllerType {
  const s = id.toLowerCase();
  if (s.includes('xbox') || s.includes('xinput') || s.includes('xiaomi')) return 'xbox';
  if (s.includes('playstation') || s.includes('dualsense') || s.includes('dualshock') || s.includes('028e')) return 'playstation';
  return 'generic';
}

export class GamepadSource implements InputSource {
  readonly kind = 'gamepad' as const;
  readonly controllerType: ControllerType;
  deadZone = 0.2;
  triggerThreshold = 0.5;

  constructor(
    readonly id: string,
    readonly index: number,
    readonly gamepadId: string,
  ) {
    this.controllerType = detectControllerType(gamepadId);
  }

  get label(): string {
    switch (this.controllerType) {
      case 'xbox': return 'Xbox Controller';
      case 'playstation': return 'PlayStation Controller';
      default: return 'Controller';
    }
  }

  poll(): RawFrame {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[this.index];
    const frame: RawFrame = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, actions: {} };
    if (!gp) return frame;

    const axes = gp.axes;
    frame.move = applyDeadzone(axes[0] ?? 0, axes[1] ?? 0, this.deadZone);
    frame.look = applyDeadzone(axes[2] ?? 0, axes[3] ?? 0, this.deadZone);

    for (const [biStr, actions] of Object.entries(BUTTON_MAP)) {
      const bi = Number(biStr);
      const btn = gp.buttons[bi];
      if (!btn) continue;
      const pressed = typeof btn.pressed === 'boolean'
        ? btn.pressed || btn.value >= this.triggerThreshold
        : btn.value >= this.triggerThreshold;
      if (!pressed) continue;
      for (const action of actions) frame.actions[action] = true;
    }
    return frame;
  }
}
