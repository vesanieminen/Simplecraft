/**
 * Gamepad API source using the standard mapping, with dead zones and
 * analog trigger thresholds. Works for Xbox / DualShock / DualSense pads.
 */

import { Action, ControllerType, InputSource, RawFrame, applyDeadzone } from './types';

/** standard button index -> action */
const BUTTON_MAP: Record<number, Action> = {
  0: 'jump',      // A / Cross
  1: 'back',      // B / Circle
  2: 'interact',  // X / Square
  3: 'palette',   // Y / Triangle
  4: 'prevBlock', // Left bumper
  5: 'nextBlock', // Right bumper
  6: 'remove',    // Left trigger
  7: 'place',     // Right trigger
  8: 'menu',      // Select/Share doubles as menu for kids? keep start only
  9: 'menu',      // Start / Options
  12: 'up',       // D-pad
  13: 'down',
  14: 'left',
  15: 'right',
};

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

    for (const [biStr, action] of Object.entries(BUTTON_MAP)) {
      const bi = Number(biStr);
      const btn = gp.buttons[bi];
      if (!btn) continue;
      const pressed = typeof btn.pressed === 'boolean'
        ? btn.pressed || btn.value >= this.triggerThreshold
        : btn.value >= this.triggerThreshold;
      if (pressed) frame.actions[action] = true;
    }
    return frame;
  }
}
