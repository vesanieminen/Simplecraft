/**
 * Per-player HUD, rendered in a DOM layer positioned exactly over the
 * player's split-screen pane. Scales with pane size.
 */

import { blockDef } from '../core/blocks';
import { ControllerType } from '../input/types';
import { LocalPlayer } from '../players/localPlayer';

const BTN_LABELS: Record<ControllerType, Record<string, string>> = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', start: 'Menu' },
  playstation: { a: '✕', b: '◯', x: '☐', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', start: 'Options' },
  generic: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', start: 'Menu' },
  keyboard: { a: 'Space', b: 'Esc', x: 'E', y: 'F', lb: 'Q', rb: 'R', lt: 'R-Click', rt: 'L-Click', start: 'Esc' },
};

export class Hud {
  root: HTMLElement;
  private nameTag: HTMLElement;
  private stars: HTMLElement;
  private flyTag: HTMLElement;
  private crosshair: HTMLElement;
  private swatch: HTMLElement;
  private blockName: HTMLElement;
  private hints: HTMLElement;
  private lastBlock = -1;
  private lastStars = -1;

  constructor(player: LocalPlayer, type: ControllerType) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    const b = BTN_LABELS[type];

    this.nameTag = document.createElement('div');
    this.nameTag.className = 'name-tag';
    this.nameTag.innerHTML = `<span class="name-dot" style="background:${player.entity.colorHex}"></span>${player.entity.name}`;

    this.stars = document.createElement('div');
    this.stars.className = 'stars';
    this.stars.textContent = '⭐ 0';

    this.flyTag = document.createElement('div');
    this.flyTag.className = 'fly-tag';
    this.flyTag.textContent = '🕊️ Flying!';

    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair';

    this.blockName = document.createElement('div');
    this.blockName.className = 'block-name';
    this.swatch = document.createElement('div');
    this.swatch.className = 'block-swatch';
    const pod = document.createElement('div');
    pod.className = 'block-pod';
    const prev = document.createElement('div');
    prev.textContent = `◀ ${b.lb}`;
    prev.style.fontSize = '12px';
    const next = document.createElement('div');
    next.textContent = `${b.rb} ▶`;
    next.style.fontSize = '12px';
    pod.append(prev, this.swatch, this.blockName, next);

    this.hints = document.createElement('div');
    this.hints.className = 'hints';
    this.hints.textContent =
      `${b.rt} build · ${b.lt} break · ${b.a} jump · ${b.x} pet · ${b.y} blocks · ${b.start} menu`;

    this.root.append(this.nameTag, this.stars, this.flyTag, this.crosshair, pod, this.hints);
  }

  update(player: LocalPlayer): void {
    if (player.selected !== this.lastBlock) {
      this.lastBlock = player.selected;
      const def = blockDef(player.selected);
      this.swatch.style.background = `rgb(${def.color.map((c) => Math.round(c * 255)).join(',')})`;
      this.swatch.textContent = def.icon;
      this.blockName.textContent = def.name;
    }
    const s = player.entity.starsCount ?? 0;
    if (s !== this.lastStars) {
      this.lastStars = s;
      this.stars.textContent = `⭐ ${s}`;
    }
    this.flyTag.classList.toggle('on', player.entity.flying);
    this.crosshair.classList.toggle('hit', !!player.target);
  }
}
