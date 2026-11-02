/**
 * Controller-navigable overlays: join cards, block palette, player menu,
 * grown-up settings, help screen. Every one is driven by that player's
 * own input source — no mouse required anywhere.
 */

import { BlockId, blockDef, FAVORITES, PALETTE } from '../core/blocks';
import { AudioKit } from '../core/audio';
import { ControllerType, FrameControls } from '../input/types';
import { AVATAR_COLORS, NICKNAMES } from '../players/avatar';
import { LocalPlayer } from '../players/localPlayer';
import { NavHelper } from './nav';

export abstract class Overlay {
  el: HTMLDivElement;
  protected nav = new NavHelper();
  closed = false;

  constructor(
    protected audio: AudioKit,
    protected type: ControllerType,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'overlay-card';
  }

  abstract tick(frame: FrameControls, dt: number): void;

  close(): void {
    this.closed = true;
    this.el.remove();
  }

  protected card(title?: string): HTMLElement {
    const c = document.createElement('div');
    c.className = 'card';
    if (title) {
      const h = document.createElement('h2');
      h.textContent = title;
      c.appendChild(h);
    }
    this.el.appendChild(c);
    return c;
  }

  protected keys(c: HTMLElement, pairs: [string, string][]): void {
    const d = document.createElement('div');
    d.className = 'sub';
    for (const [k, what] of pairs) {
      const s = document.createElement('span');
      s.innerHTML = `<span class="key-hint">${k}</span> ${what}&nbsp;`;
      d.appendChild(s);
    }
    c.appendChild(d);
  }
}

function btnLabels(type: ControllerType): { a: string; b: string; lr: string; ud: string } {
  switch (type) {
    case 'playstation': return { a: '✕', b: '◯', lr: 'L1 R1', ud: 'D-Pad' };
    case 'keyboard': return { a: 'Enter', b: 'Esc', lr: 'Q R', ud: 'Arrows' };
    default: return { a: 'A', b: 'B', lr: 'L1 R1', ud: 'D-Pad' };
  }
}

// ---------------------------------------------------------------- join card

export class JoinCard extends Overlay {
  private colorIdx = 0;
  private nameIdx = 0;
  private headEl!: HTMLElement;
  private torsoEl!: HTMLElement;
  private nameEl!: HTMLElement;
  private swatchEls: HTMLElement[] = [];

  constructor(
    audio: AudioKit,
    type: ControllerType,
    playerNumber: number,
    private onConfirm: (colorIdx: number, nameIdx: number) => void,
  ) {
    super(audio, type);
    const c = this.card(`Player ${playerNumber} — pick a friend!`);

    const preview = document.createElement('div');
    preview.className = 'avatar-preview';
    this.headEl = document.createElement('div');
    this.headEl.className = 'head';
    this.torsoEl = document.createElement('div');
    this.torsoEl.className = 'torso';
    preview.append(this.headEl, this.torsoEl);
    c.appendChild(preview);

    this.nameEl = document.createElement('div');
    this.nameEl.className = 'name-big';
    c.appendChild(this.nameEl);

    const row = document.createElement('div');
    row.className = 'swatch-row';
    for (const col of AVATAR_COLORS) {
      const s = document.createElement('div');
      s.className = 'swatch';
      s.style.background = col.hex;
      row.appendChild(s);
      this.swatchEls.push(s);
    }
    c.appendChild(row);

    const k = btnLabels(type);
    this.keys(c, [[k.ud, 'change'], [k.a, 'join!'], [k.b, 'cancel']]);
    this.refresh();
  }

  private refresh(): void {
    const col = AVATAR_COLORS[this.colorIdx];
    this.headEl.style.background = col.hex;
    this.torsoEl.style.background = col.hex;
    this.nameEl.textContent = NICKNAMES[this.nameIdx];
    this.swatchEls.forEach((s, i) => s.classList.toggle('sel', i === this.colorIdx));
  }

  tick(frame: FrameControls, dt: number): void {
    const nav = this.nav.tick(frame, dt);
    let changed = false;
    if (nav.left) { this.colorIdx = (this.colorIdx + AVATAR_COLORS.length - 1) % AVATAR_COLORS.length; changed = true; }
    if (nav.right) { this.colorIdx = (this.colorIdx + 1) % AVATAR_COLORS.length; changed = true; }
    if (nav.up) { this.nameIdx = (this.nameIdx + NICKNAMES.length - 1) % NICKNAMES.length; changed = true; }
    if (nav.down) { this.nameIdx = (this.nameIdx + 1) % NICKNAMES.length; changed = true; }
    if (changed) { this.audio.uiMove(); this.refresh(); }
    if (nav.confirm) {
      this.audio.uiSelect();
      this.onConfirm(this.colorIdx, this.nameIdx);
      this.close();
    }
    if (nav.back) {
      this.audio.uiBack();
      this.close();
    }
  }
}

// ------------------------------------------------------------- block palette

export class PaletteOverlay extends Overlay {
  private sel = 0;
  private cells: HTMLElement[] = [];

  constructor(
    audio: AudioKit,
    type: ControllerType,
    player: LocalPlayer,
    private onPick: (b: BlockId) => void,
  ) {
    super(audio, type);
    const c = this.card('Pick a block!');
    const grid = document.createElement('div');
    grid.className = 'palette-grid';
    const startIdx = PALETTE.indexOf(player.selected);
    this.sel = startIdx >= 0 ? startIdx : 0;
    PALETTE.forEach((id) => {
      const def = blockDef(id);
      const cell = document.createElement('div');
      cell.className = 'palette-cell';
      cell.style.background = `rgb(${def.color.map((x) => Math.round(x * 255)).join(',')})`;
      cell.innerHTML = `<div>${def.icon}</div><div class="pn">${def.name}</div>`;
      cell.addEventListener('click', () => {
        this.onPick(id);
        this.audio.uiSelect();
        this.close();
      });
      grid.appendChild(cell);
      this.cells.push(cell);
    });
    c.appendChild(grid);
    const k = btnLabels(type);
    this.keys(c, [[k.ud, 'choose'], [k.a, 'pick'], [k.b, 'close']]);
    this.refresh();
  }

  private refresh(): void {
    this.cells.forEach((el, i) => el.classList.toggle('sel', i === this.sel));
  }

  private move(d: number): void {
    let n = this.sel + d;
    if (n < 0) n = PALETTE.length - 1;
    if (n >= PALETTE.length) n = 0;
    this.sel = n;
    this.audio.uiMove();
    this.refresh();
  }

  tick(frame: FrameControls, dt: number): void {
    const nav = this.nav.tick(frame, dt);
    if (nav.right || nav.down) this.move(1);
    if (nav.left || nav.up) this.move(-1);
    if (frame.pressed.has('nextBlock')) this.move(1);
    if (frame.pressed.has('prevBlock')) this.move(-1);
    if (nav.confirm) {
      this.onPick(PALETTE[this.sel]);
      this.audio.uiSelect();
      this.close();
    }
    if (nav.back) {
      this.audio.uiBack();
      this.close();
    }
  }
}

// ------------------------------------------------------------- player menu

export interface MenuActions {
  toggleFly(): void;
  toggleCamera(): void;
  goHome(): void;
  toggleSound(): void;
  openHelp(): void;
  openGrownUps(): void;
  leave(): void;
}

export class PlayerMenu extends Overlay {
  private items: { icon: string; label: string; val?: () => string; fn: () => void }[];
  private sel = 0;
  private rows: HTMLElement[] = [];

  constructor(
    audio: AudioKit,
    type: ControllerType,
    private player: LocalPlayer,
    actions: MenuActions,
    private soundOn: () => boolean,
  ) {
    super(audio, type);
    const c = this.card(`${player.entity.name}'s Menu`);
    this.items = [
      { icon: '▶️', label: 'Keep Playing', fn: () => this.close() },
      { icon: '🕊️', label: 'Fly', val: () => (player.entity.flying ? 'ON' : 'OFF'), fn: () => { actions.toggleFly(); } },
      { icon: '👀', label: 'Camera', val: () => (player.firstPerson ? 'Eyes' : 'Behind'), fn: () => actions.toggleCamera() },
      {
        icon: '🌀',
        label: 'Look Speed',
        val: () => (player.sensitivity < 0.8 ? 'Slow' : player.sensitivity > 1.2 ? 'Fast' : 'Normal'),
        fn: () => {
          player.sensitivity = player.sensitivity < 0.8 ? 1 : player.sensitivity > 1.2 ? 1.7 : 0.65;
        },
      },
      { icon: '🏠', label: 'Go Home', fn: () => { actions.goHome(); this.close(); } },
      { icon: '🎨', label: 'Blocks', fn: () => { this.close(); window.dispatchEvent(new CustomEvent('lbw-open-palette', { detail: this.player.entity.id })); } },
      { icon: '🎮', label: 'Help', fn: () => { this.close(); actions.openHelp(); } },
      { icon: '🔊', label: 'Sound', val: () => (this.soundOn() ? 'ON' : 'OFF'), fn: () => actions.toggleSound() },
      { icon: '🧑', label: 'Grown-Ups', fn: () => { this.close(); actions.openGrownUps(); } },
      { icon: '🚪', label: 'Leave', fn: () => { actions.leave(); this.close(); } },
    ];
    const list = document.createElement('div');
    list.className = 'menu-list';
    for (const it of this.items) {
      const row = document.createElement('div');
      row.className = 'menu-item';
      row.innerHTML = `<span class="mi-icon">${it.icon}</span><span>${it.label}</span><span class="mi-val">${it.val?.() ?? ''}</span>`;
      row.addEventListener('click', () => { it.fn(); this.refresh(); });
      list.appendChild(row);
      this.rows.push(row);
    }
    c.appendChild(list);
    const k = btnLabels(type);
    this.keys(c, [[k.ud, 'move'], [k.a, 'choose'], [k.b, 'close']]);
    this.refresh();
  }

  private refresh(): void {
    this.rows.forEach((r, i) => {
      r.classList.toggle('sel', i === this.sel);
      const v = r.querySelector('.mi-val');
      if (v) v.textContent = this.items[i].val?.() ?? '';
    });
  }

  tick(frame: FrameControls, dt: number): void {
    const nav = this.nav.tick(frame, dt);
    if (nav.down) { this.sel = (this.sel + 1) % this.items.length; this.audio.uiMove(); this.refresh(); }
    if (nav.up) { this.sel = (this.sel + this.items.length - 1) % this.items.length; this.audio.uiMove(); this.refresh(); }
    if (nav.confirm) { this.audio.uiSelect(); this.items[this.sel].fn(); this.refresh(); }
    if (nav.back) { this.audio.uiBack(); this.close(); }
  }
}

// ------------------------------------------------------- grown-up settings

export interface GrownUpActions {
  toggleFreeze(): void;
  cycleLayout(): string;
  resetWorld(): void;
  frozen: () => boolean;
  layout: () => string;
}

export class GrownUpsMenu extends Overlay {
  private items: { icon: string; label: string; val?: () => string; fn: () => void }[];
  private sel = 0;
  private rows: HTMLElement[] = [];
  private resetArmed = false;

  constructor(audio: AudioKit, type: ControllerType, actions: GrownUpActions) {
    super(audio, type);
    const c = this.card('Grown-Up Settings');
    this.items = [
      { icon: '⏸️', label: 'Freeze Game', val: () => (actions.frozen() ? 'ON' : 'OFF'), fn: () => actions.toggleFreeze() },
      { icon: '🔀', label: 'Split Screen', val: () => actions.layout(), fn: () => actions.cycleLayout() },
      {
        icon: '🗑️',
        label: 'Reset World',
        val: () => (this.resetArmed ? 'SURE?' : ''),
        fn: () => {
          if (this.resetArmed) { actions.resetWorld(); this.resetArmed = false; }
          else { this.resetArmed = true; }
        },
      },
      { icon: '◀️', label: 'Back', fn: () => this.close() },
    ];
    const list = document.createElement('div');
    list.className = 'menu-list';
    for (const it of this.items) {
      const row = document.createElement('div');
      row.className = 'menu-item';
      row.innerHTML = `<span class="mi-icon">${it.icon}</span><span>${it.label}</span><span class="mi-val">${it.val?.() ?? ''}</span>`;
      row.addEventListener('click', () => { it.fn(); this.refresh(); });
      list.appendChild(row);
      this.rows.push(row);
    }
    c.appendChild(list);
    const k = btnLabels(type);
    this.keys(c, [[k.ud, 'move'], [k.a, 'choose'], [k.b, 'back']]);
    this.refresh();
  }

  private refresh(): void {
    this.rows.forEach((r, i) => {
      r.classList.toggle('sel', i === this.sel);
      const v = r.querySelector('.mi-val');
      if (v) v.textContent = this.items[i].val?.() ?? '';
    });
  }

  tick(frame: FrameControls, dt: number): void {
    const nav = this.nav.tick(frame, dt);
    if (nav.down) { this.sel = (this.sel + 1) % this.items.length; this.audio.uiMove(); this.refresh(); }
    if (nav.up) { this.sel = (this.sel + this.items.length - 1) % this.items.length; this.audio.uiMove(); this.refresh(); }
    if (nav.confirm) { this.audio.uiSelect(); this.items[this.sel].fn(); this.refresh(); }
    if (nav.back) { this.audio.uiBack(); this.close(); }
  }
}

// ------------------------------------------------------------------- help

const PAD_ROWS: [string, string][] = [
  ['LEFT STICK', 'Walk around'],
  ['RIGHT STICK', 'Look / aim'],
  ['A', 'Jump'],
  ['RT', 'Place block'],
  ['LT', 'Break block'],
  ['LB / RB', 'Prev / next block'],
  ['X', 'Pet animals'],
  ['Y', 'Block palette'],
  ['START', 'Menu'],
  ['B', 'Back'],
  ['D-PAD', 'Menus'],
];

export class HelpOverlay extends Overlay {
  constructor(audio: AudioKit, type: ControllerType) {
    super(audio, type);
    const c = this.card('How to Play');
    const grid = document.createElement('div');
    grid.className = 'pad-help';
    const rename = (s: string): string => {
      if (type !== 'playstation') return s;
      return s
        .replace('A', '✕').replace('RT', 'R2').replace('LT', 'L2')
        .replace('LB / RB', 'L1 / R1').replace('X', '☐').replace('Y', '△')
        .replace('START', 'OPTIONS').replace('B', '◯');
    };
    for (const [k, what] of PAD_ROWS) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = `<span class="btnkey">${rename(k)}</span><span>${what}</span>`;
      grid.appendChild(row);
    }
    c.appendChild(grid);
    this.keys(c, [['B', 'close']]);
  }

  tick(frame: FrameControls): void {
    if (frame.pressed.has('back') || frame.pressed.has('jump') || frame.pressed.has('menu')) {
      this.audio.uiBack();
      this.close();
    }
  }
}

// -------------------------------------------------- controller-away notice

export class ReconnectOverlay extends Overlay {
  constructor(type: ControllerType) {
    super(new AudioKit(), type);
    const c = this.card('Controller asleep 🎮');
    const s = document.createElement('div');
    s.className = 'sub';
    s.textContent = 'Press any button to wake it up!';
    c.appendChild(s);
  }

  tick(): void {
    // closed by the game when input returns
  }

  close(): void {
    super.close();
  }
}

// favorites shortcut (kept exported for tests)
export const QUICK_BLOCKS = FAVORITES;
