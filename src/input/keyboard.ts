/**
 * Keyboard & mouse source (optional alternate for player 1).
 * WASD move, arrow keys look, Space jump, LMB place, RMB remove,
 * Q/R cycle blocks, F palette, E interact, Esc menu/back, Enter confirm.
 */

import { Action, InputSource, RawFrame } from './types';

const KEY_ACTIONS: Record<string, Action> = {
  Space: 'jump',
  Enter: 'jump',
  Escape: 'menu',
  KeyF: 'palette',
  KeyE: 'interact',
  KeyQ: 'prevBlock',
  KeyR: 'nextBlock',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export class KeyboardSource implements InputSource {
  readonly id = 'keyboard';
  readonly kind = 'keyboard' as const;
  readonly label = 'Keyboard & Mouse';
  readonly controllerType = 'keyboard' as const;

  private keys = new Set<string>();
  private mousePlace = false;
  private mouseRemove = false;
  private wheelPress = 0; // frames of synthetic next/prev press
  private wheelDir = 0;
  private lookKeysHeld = false;

  constructor(target: EventTarget = window) {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (KEY_ACTIONS[e.code] || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    window.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 0) this.mousePlace = true;
      if (e.button === 2) this.mouseRemove = true;
    });
    window.addEventListener('mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.mousePlace = false;
      if (e.button === 2) this.mouseRemove = false;
    });
    window.addEventListener('contextmenu', (e: Event) => e.preventDefault());
    window.addEventListener('wheel', (e: WheelEvent) => {
      this.wheelPress = 2;
      this.wheelDir = e.deltaY > 0 ? 1 : -1;
    });
    void target;
  }

  /** consumed by LocalPlayer: mouse position for aiming with keyboard/mouse */
  get lookKeysActive(): boolean {
    return this.lookKeysHeld;
  }

  poll(): RawFrame {
    const frame: RawFrame = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, actions: {} };
    const k = this.keys;
    let mx = 0, my = 0;
    if (k.has('KeyW')) my -= 1;
    if (k.has('KeyS')) my += 1;
    if (k.has('KeyA')) mx -= 1;
    if (k.has('KeyD')) mx += 1;
    const ml = Math.hypot(mx, my) || 1;
    frame.move = { x: mx / ml, y: my / ml };

    let lx = 0, ly = 0;
    if (k.has('ArrowLeft')) lx -= 1;
    if (k.has('ArrowRight')) lx += 1;
    if (k.has('ArrowUp')) ly -= 1;
    if (k.has('ArrowDown')) ly += 1;
    this.lookKeysHeld = lx !== 0 || ly !== 0;
    frame.look = { x: lx, y: ly };

    for (const [code, action] of Object.entries(KEY_ACTIONS)) {
      if (k.has(code)) frame.actions[action] = true;
    }
    // arrow keys double as dpad for menus
    if (lx < 0) frame.actions.left = true;
    if (lx > 0) frame.actions.right = true;
    if (ly < 0) frame.actions.up = true;
    if (ly > 0) frame.actions.down = true;
    if (this.mousePlace) frame.actions.place = true;
    if (this.mouseRemove) frame.actions.remove = true;

    if (this.wheelPress > 0) {
      this.wheelPress--;
      if (this.wheelDir > 0) frame.actions.nextBlock = true;
      else frame.actions.prevBlock = true;
    }
    return frame;
  }
}
