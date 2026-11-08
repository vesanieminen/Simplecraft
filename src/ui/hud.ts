/**
 * Per-player HUD, rendered in a DOM layer positioned exactly over the
 * player's split-screen pane. Scales with pane size.
 */

import { blockDef, isBucket } from '../core/blocks';
import { ControllerType } from '../input/types';
import { LocalPlayer } from '../players/localPlayer';

const BTN_LABELS: Record<ControllerType, Record<string, string>> = {
  // Nov 2026: the left trigger is the "do the thing" trigger (pet, doors,
  // chests, fishing), the right trigger puts blocks down, and breaking moved
  // onto the west face button. On the keyboard that is E / R-Click / L-Click.
  xbox: { a: 'A', b: 'B', y: 'Y', lb: 'LB', rb: 'RB', start: 'Start', satchel: 'D-pad ▾', interact: 'LT', build: 'RT', mine: 'X' },
  playstation: { a: '✕', b: '◯', y: '△', lb: 'L1', rb: 'R1', start: 'Options', satchel: 'D-Pad ▾', interact: 'L2', build: 'R2', mine: '☐' },
  generic: { a: 'A', b: 'B', y: 'Y', lb: 'L1', rb: 'R1', start: 'Menu', satchel: 'D-Pad ▾', interact: 'L2', build: 'R2', mine: 'X' },
  keyboard: { a: 'Space', b: 'Ctrl', y: 'F', lb: 'Q', rb: 'R', start: 'Esc', satchel: 'I', interact: 'E', build: 'R-Click', mine: 'L-Click' },
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
  private lastCarrying = '';
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
    // The left trigger pets and opens, the right trigger builds, the west
    // button breaks (Nov 2026 remap — on keyboard: E · R-Click · L-Click)
    this.hints.textContent =
      `${b.interact} pet · fish · open · ${b.build} build · ${b.mine} break · ${b.a} jump · ${b.b} sneak · ${b.y} blocks · ${b.satchel} eat · ${b.start} menu`;

    this.root.append(this.nameTag, this.stars, this.pouch, this.flyTag, this.boostTag, this.crosshair, pod, this.hints);
  }

  update(player: LocalPlayer): void {
    // the bucket's name tells the whole story: empty, or carrying a spring
    const carrying = isBucket(player.selected) ? (player.bucketFull ? 'Bucket — full 💧' : 'Bucket — empty') : '';
    if (player.selected !== this.lastBlock || carrying !== this.lastCarrying) {
      this.lastBlock = player.selected;
      this.lastCarrying = carrying;
      const def = blockDef(player.selected);
      this.swatch.style.background = `rgb(${def.color.map((c) => Math.round(c * 255)).join(',')})`;
      this.swatch.textContent = def.icon;
      this.blockName.textContent = carrying || def.name;
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
