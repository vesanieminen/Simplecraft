/**
 * Keyboard & mouse source (optional alternate for player 1).
 * WASD move, arrow keys look, Space jump, RMB place, LMB remove,
 * Q/R cycle blocks, F palette, E interact, Esc menu/back, Enter confirm.
 */

import { Action, ActionGate, InputSource, RawFrame } from './types';

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
  private gate = new ActionGate();
  private mousePlace = false;
  private mouseRemove = false;

  constructor() {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const action = KEY_ACTIONS[e.code];
      if (action) this.gate.flagFresh(action);
      if (action || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    window.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 0) {
        this.mouseRemove = true;
        this.gate.flagFresh('remove');
      }
      if (e.button === 2) {
        this.mousePlace = true;
        this.gate.flagFresh('place');
      }
    });
    window.addEventListener('mouseup', (e: MouseEvent) => {
      // must mirror the mousedown mapping exactly — button 0 breaks, button 2
      // builds — or a released button stays "held" forever and the game keeps
      // placing (or breaking) blocks on its own
      if (e.button === 0) this.mouseRemove = false;
      if (e.button === 2) this.mousePlace = false;
    });
    window.addEventListener('contextmenu', (e: Event) => e.preventDefault());
    window.addEventListener('wheel', (e: WheelEvent) => {
      if (e.deltaY > 0) this.gate.flagFresh('nextBlock');
      else this.gate.flagFresh('prevBlock');
    });
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
    frame.look = { x: lx, y: ly };

    // held keys (arrows double as dpad for menus); fresh presses gated by ActionGate
    const candidate = new Set<Action>();
    for (const [code, action] of Object.entries(KEY_ACTIONS)) {
      if (k.has(code)) candidate.add(action);
    }
    if (this.mousePlace) candidate.add('place');
    if (this.mouseRemove) candidate.add('remove');

    for (const action of this.gate.filter(candidate)) frame.actions[action] = true;
    return frame;
  }
}
