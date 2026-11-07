/**
 * Per-player HUD, rendered in a DOM layer positioned exactly over the
 * player's split-screen pane. Scales with pane size.
 */

import { blockDef } from '../core/blocks';
import { ControllerType } from '../input/types';
import { LocalPlayer } from '../players/localPlayer';

const BTN_LABELS: Record<ControllerType, Record<string, string>> = {
  xbox: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'LB', rb: 'RB', lt: 'LT', rt: 'RT', start: 'Start', satchel: 'D-pad ▾' },
  playstation: { a: '✕', b: '◯', x: '☐', y: '△', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', start: 'Options', satchel: 'D-Pad ▾' },
  generic: { a: 'A', b: 'B', x: 'X', y: 'Y', lb: 'L1', rb: 'R1', lt: 'L2', rt: 'R2', start: 'Menu', satchel: 'D-Pad ▾' },
  keyboard: { a: 'Space', b: 'Ctrl', x: 'E', y: 'F', lb: 'Q', rb: 'R', lt: 'R-Click', rt: 'L-Click', start: 'Esc', satchel: 'I' },
};

export class Hud {
  root: HTMLElement;
  private nameTag: HTMLElement;
  private stars: HTMLElement;
  private pouch: HTMLElement;
  private flyTag: HTMLElement;
  private boostTag: HTMLElement;
  private crosshair: HTMLElement;
  private swatch: HTMLElement;
  private blockName: HTMLElement;
  private hints: HTMLElement;
  private lastBlock = -1;
  private lastStars = -1;
  private lastPouch = -1;
  private lastBoost = '';

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

    // the fish satchel chip (core/satchel.ts): how many caught fish are
    // waiting under the name tag for dinner — hidden while the pouch is empty
    this.pouch = document.createElement('div');
    this.pouch.className = 'pouch';

    this.flyTag = document.createElement('div');
    this.flyTag.className = 'fly-tag';
    this.flyTag.textContent = '🕊️ Flying!';

    this.boostTag = document.createElement('div');
    this.boostTag.className = 'boost-tag';

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
    // LT-position button builds, RT-position breaks (2026-11 control swap —
    // on keyboard that means R-Click builds, L-Click breaks)
    this.hints.textContent =
      `${b.lt} build · ${b.rt} break · ${b.a} jump · ${b.b} sneak · ${b.x} pet · fish · open · ${b.y} blocks · ${b.satchel} eat · ${b.start} menu`;

    this.root.append(this.nameTag, this.stars, this.pouch, this.flyTag, this.boostTag, this.crosshair, pod, this.hints);
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
    const f = player.satchel.total();
    if (f !== this.lastPouch) {
      this.lastPouch = f;
      this.pouch.textContent = `🐟 ${f}`;
      this.pouch.classList.toggle('on', f > 0);
    }
    this.flyTag.classList.toggle('on', player.entity.flying);
    const boost = player.entity.zoomTime > 0 ? '🌈 Zoomy!'
      : player.entity.boingTime > 0 ? '🦘 Boingy!' : '';
    if (boost !== this.lastBoost) {
      this.lastBoost = boost;
      this.boostTag.textContent = boost;
      this.boostTag.classList.toggle('on', boost !== '');
    }
    this.crosshair.classList.toggle('hit', !!player.target);
  }
}
