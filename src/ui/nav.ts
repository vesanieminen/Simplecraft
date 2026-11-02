/**
 * Menu navigation helper: converts dpad/stick input into discrete moves
 * with press-to-move + hold-to-repeat, so menus never machine-gun through
 * options (a hard requirement from the spec).
 */

import { FrameControls } from '../input/types';

export interface NavPresses {
  up: boolean; down: boolean; left: boolean; right: boolean;
  confirm: boolean; back: boolean;
}

const REPEAT_DELAY = 0.4;
const REPEAT_PERIOD = 0.14;

const DIRS = ['up', 'down', 'left', 'right'] as const;
type Dir = (typeof DIRS)[number];

export class NavHelper {
  private hold = new Map<Dir, { t: number; frac: number }>();

  tick(frame: FrameControls, dt: number): NavPresses {
    const out: NavPresses = {
      up: false, down: false, left: false, right: false,
      confirm: frame.pressed.has('jump') || frame.pressed.has('interact'),
      back: frame.pressed.has('back') || frame.pressed.has('menu'),
    };

    const axis: Record<Dir, number> = {
      up: frame.held.has('up') ? 1 : frame.move.y < -0.55 ? 1 : 0,
      down: frame.held.has('down') ? 1 : frame.move.y > 0.55 ? 1 : 0,
      left: frame.held.has('left') ? 1 : frame.move.x < -0.55 ? 1 : 0,
      right: frame.held.has('right') ? 1 : frame.move.x > 0.55 ? 1 : 0,
    };

    for (const d of DIRS) {
      if (axis[d]) {
        if (frame.pressed.has(d)) {
          out[d] = true;
          this.hold.set(d, { t: 0, frac: 0 });
        } else {
          const h = this.hold.get(d);
          if (h) {
            h.t += dt;
            if (h.t > REPEAT_DELAY) {
              h.frac += dt / REPEAT_PERIOD;
              if (h.frac >= 1) {
                h.frac -= 1;
                out[d] = true;
              }
            }
          } else {
            // stick moved in without a dpad press edge
            this.hold.set(d, { t: 0, frac: 0 });
            out[d] = true;
          }
        }
      } else {
        this.hold.delete(d);
      }
    }
    return out;
  }

  reset(): void {
    this.hold.clear();
  }
}
