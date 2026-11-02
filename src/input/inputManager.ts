/**
 * Tracks every input source (gamepads hot-plugged in or out, keyboard,
 * virtual pads) and does per-source edge detection so the rest of the
 * game only ever sees held / pressed / released.
 */

import { Action, FrameControls, InputSource, emptyFrame } from './types';
import { GamepadSource } from './gamepad';
import { VirtualPadSource } from './virtual';

export class InputManager {
  readonly sources = new Map<string, InputSource>();
  private frames = new Map<string, FrameControls>();
  private prevHeld = new Map<string, Set<Action>>();
  private padCounter = 0;
  /** sources that appeared since last check, for the join flow */
  onSourceAdded?: (s: InputSource) => void;
  onSourceRemoved?: (s: InputSource) => void;

  constructor() {
    window.addEventListener('gamepadconnected', (e) => {
      const gp = e.gamepad;
      const id = `gp-${gp.index}`;
      if (this.sources.has(id)) return;
      const src = new GamepadSource(id, gp.index, gp.id);
      this.addSource(src);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      const id = `gp-${e.gamepad.index}`;
      const src = this.sources.get(id);
      if (src) this.removeSource(src);
    });
  }

  /** create a virtual pad (tests, demos) — behaves exactly like a real one */
  createVirtualPad(type: 'xbox' | 'playstation' | 'generic' = 'generic'): VirtualPadSource {
    const src = new VirtualPadSource(`vpad-${++this.padCounter}`, type);
    this.addSource(src);
    return src;
  }

  addSource(src: InputSource): void {
    this.sources.set(src.id, src);
    this.prevHeld.set(src.id, new Set());
    this.frames.set(src.id, emptyFrame());
    this.onSourceAdded?.(src);
  }

  removeSource(src: InputSource): void {
    this.sources.delete(src.id);
    this.frames.delete(src.id);
    this.prevHeld.delete(src.id);
    src.dispose?.();
    this.onSourceRemoved?.(src);
  }

  update(): void {
    for (const [id, src] of this.sources) {
      const raw = src.poll();
      const held = new Set<Action>();
      for (const [action, down] of Object.entries(raw.actions)) {
        if (down) held.add(action as Action);
      }
      const prev = this.prevHeld.get(id) ?? new Set<Action>();
      const pressed = new Set<Action>();
      const released = new Set<Action>();
      for (const a of held) if (!prev.has(a)) pressed.add(a);
      for (const a of prev) if (!held.has(a)) released.add(a);
      this.frames.set(id, {
        move: raw.move,
        look: raw.look,
        held,
        pressed,
        released,
        anyPressed: pressed.size > 0,
      });
      this.prevHeld.set(id, held);
    }
  }

  frame(sourceId: string): FrameControls {
    return this.frames.get(sourceId) ?? emptyFrame();
  }
}
