/**
 * Virtual input source for automated tests and headless demos.
 * It drives the game through exactly the same abstraction as real
 * hardware — but note this does NOT replace physical-controller QA.
 */

import { Action, ALL_ACTIONS, ControllerType, InputSource, RawFrame, Vec2 } from './types';

let counter = 0;

export class VirtualPadSource implements InputSource {
  readonly kind = 'virtual' as const;
  readonly controllerType: ControllerType;
  readonly label: string;

  private move: Vec2 = { x: 0, y: 0 };
  private look: Vec2 = { x: 0, y: 0 };
  private held = new Set<Action>();
  private queued = new Set<Action>(); // one-frame taps

  constructor(
    readonly id: string,
    type: ControllerType = 'generic',
  ) {
    this.controllerType = type;
    this.label = `Virtual Controller ${++counter}`;
  }

  setMove(x: number, y: number): void {
    this.move = { x, y };
  }

  setLook(x: number, y: number): void {
    this.look = { x, y };
  }

  /** hold or release a button */
  set(action: Action, down: boolean): void {
    if (down) this.held.add(action);
    else this.held.delete(action);
  }

  /** press for exactly one frame */
  tap(...actions: Action[]): void {
    for (const a of actions) {
      this.held.add(a);
      this.queued.add(a);
    }
  }

  press(action: Action): void {
    this.held.add(action);
  }

  release(action: Action): void {
    this.held.delete(action);
  }

  releaseAll(): void {
    this.held.clear();
  }

  poll(): RawFrame {
    const actions: Partial<Record<Action, boolean>> = {};
    const all = new Set(this.held);
    for (const a of this.queued) all.add(a);
    for (const a of all) actions[a] = true;
    this.queued.clear();
    return { move: { ...this.move }, look: { ...this.look }, actions };
  }

  static allActions(): Action[] {
    return ALL_ACTIONS;
  }
}
