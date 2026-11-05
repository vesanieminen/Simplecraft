/**
 * Controller-navigable overlays: join cards, block palette, player menu,
 * grown-up settings, help screen. Every one is driven by that player's
 * own input source — no mouse required anywhere.
 */

import { BlockId, blockDef, FAVORITES, PALETTE } from '../core/blocks';
import { AudioKit } from '../core/audio';
import { computeHeights, themeOf, WORLD_THEMES } from '../core/terrain';
import { SavedWorldInfo, WATER_LEVEL, WORLD_SX, WORLD_SZ } from '../core/world';
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
    this.cells[this.sel]?.scrollIntoView({ block: 'nearest' });
  }

  /** how many cells fit in a row — measured from the live grid, so the CSS
   *  column count and the nav can never drift apart */
  private cols(): number {
    if (this.cells.length === 0) return 1;
    const top0 = this.cells[0].offsetTop;
    let n = 1;
    while (n < this.cells.length && this.cells[n].offsetTop === top0) n++;
    return n;
  }

  private select(n: number): void {
    if (n < 0) n = PALETTE.length - 1;
    if (n >= PALETTE.length) n = 0;
    this.sel = n;
    this.audio.uiMove();
    this.refresh();
  }

  private move(d: number): void {
    this.select(this.sel + d);
  }

  /** up/down walk whole rows, staying in the same column where possible */
  private moveVert(d: number): void {
    const cols = this.cols();
    const col = this.sel % cols;
    const rows = Math.ceil(PALETTE.length / cols);
    let row = Math.floor(this.sel / cols) + d;
    if (row < 0) row = rows - 1;
    if (row >= rows) row = 0;
    let n = row * cols + col;
    if (n >= PALETTE.length) n = PALETTE.length - 1; // a short last row: snap to its end
    this.sel = n;
    this.audio.uiMove();
    this.refresh();
  }

  tick(frame: FrameControls, dt: number): void {
    const nav = this.nav.tick(frame, dt);
    if (nav.right) this.move(1);
    if (nav.left) this.move(-1);
    if (nav.down) this.moveVert(1);
    if (nav.up) this.moveVert(-1);
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
  private leaveArmed = false;

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
      {
        icon: '🚪',
        label: 'Leave',
        val: () => (this.leaveArmed ? 'SURE?' : ''),
        fn: () => {
          // kids press everything, so leaving needs a second press
          if (this.leaveArmed) { actions.leave(); this.close(); }
          else { this.leaveArmed = true; this.audio.uiSelect(); }
        },
      },
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
    this.rows[this.sel]?.scrollIntoView({ block: 'nearest' });
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
  openWorlds(): void;
  /** the saved-worlds list: play old worlds, delete them, save right now */
  openMyWorlds(): void;
  /** sends every controller-asleep player home and closes their part of the screen */
  sendWaitingHome(): void;
  /** what the waiting-players row shows */
  waiting: () => string;
  frozen: () => boolean;
  layout: () => string;
}

export class GrownUpsMenu extends Overlay {
  private items: { icon: string; label: string; val?: () => string; fn: () => void }[];
  private sel = 0;
  private rows: HTMLElement[] = [];
  private resetArmed = false;
  private waitingArmed = false;

  constructor(audio: AudioKit, type: ControllerType, actions: GrownUpActions) {
    super(audio, type);
    const c = this.card('Grown-Up Settings');
    this.items = [
      { icon: '⏸️', label: 'Freeze Game', val: () => (actions.frozen() ? 'ON' : 'OFF'), fn: () => actions.toggleFreeze() },
      { icon: '🔀', label: 'Split Screen', val: () => actions.layout(), fn: () => actions.cycleLayout() },
      { icon: '🌍', label: 'Choose World', fn: () => actions.openWorlds() },
      { icon: '💾', label: 'My Worlds', fn: () => actions.openMyWorlds() },
      {
        icon: '🗑️',
        label: 'Reset World',
        val: () => (this.resetArmed ? 'SURE?' : ''),
        fn: () => {
          if (this.resetArmed) { actions.resetWorld(); this.resetArmed = false; }
          else { this.resetArmed = true; }
        },
      },
      {
        icon: '💤',
        label: 'Waiting Players',
        val: () => actions.waiting(),
        fn: () => {
          // another double press: this one sends other people's players home
          if (this.waitingArmed) { actions.sendWaitingHome(); this.waitingArmed = false; }
          else this.waitingArmed = true;
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
    this.rows[this.sel]?.scrollIntoView({ block: 'nearest' });
  }

  tick(frame: FrameControls, dt: number): void {
    const nav = this.nav.tick(frame, dt);
    if (nav.down) { this.sel = (this.sel + 1) % this.items.length; this.audio.uiMove(); this.refresh(); }
    if (nav.up) { this.sel = (this.sel + this.items.length - 1) % this.items.length; this.audio.uiMove(); this.refresh(); }
    if (nav.confirm) { this.audio.uiSelect(); this.items[this.sel].fn(); this.refresh(); }
    if (nav.back) { this.audio.uiBack(); this.close(); }
  }
}

// ------------------------------------------------------- world selection

/**
 * Draws a top-down map preview of a seed+theme onto a canvas using the
 * same heightmap math as the real generator — instant, no 3D render needed.
 */
function drawWorldPreview(canvas: HTMLCanvasElement, seed: number, themeIdx: number): void {
  const th = themeOf(themeIdx);
  const heights = computeHeights(seed, th);
  const water = WATER_LEVEL + th.waterDelta;
  const img = canvas.getContext('2d')!.createImageData(WORLD_SX, WORLD_SZ);
  const px = img.data;
  for (let x = 0; x < WORLD_SX; x++) {
    for (let z = 0; z < WORLD_SZ; z++) {
      const h = heights[x * WORLD_SZ + z];
      let r: number, g: number, b: number;
      if (h < water) {
        const deep = Math.min(1, (water - h) / 6);
        r = 70 - deep * 30; g = 140 - deep * 50; b = 210 - deep * 40;
      } else if (h <= water + 1) {
        r = 235; g = 214; b = 150; // beach
      } else if (h >= th.snowAbove) {
        r = 245; g = 246; b = 250; // snow cap
      } else if (h > th.rockAbove) {
        const t = (h - th.rockAbove) * 3;
        r = 150 - t; g = 155 - t; b = 162 - t; // bare rock
      } else {
        const t = (h - water) * 3;
        r = 96 - t * 0.6; g = 180 - t * 1.2; b = 80 - t * 0.8; // meadow greens
      }
      const i = (z * WORLD_SX + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  canvas.getContext('2d')!.putImageData(img, 0, 0);
}

export class WorldSelectOverlay extends Overlay {
  private seed: number;
  private theme: number;
  private sel = 0;
  private rows: HTMLElement[] = [];
  private canvas: HTMLCanvasElement;

  constructor(
    audio: AudioKit,
    type: ControllerType,
    curSeed: number,
    curTheme: number,
    private onStart: (seed: number, theme: number) => void,
    /** swap this picker for the saved-worlds list (game owns the swap) */
    private onSavedWorlds?: () => void,
  ) {
    super(audio, type);
    this.seed = curSeed;
    this.theme = curTheme % WORLD_THEMES.length;
    const c = this.card('Choose a World');

    this.canvas = document.createElement('canvas');
    this.canvas.width = WORLD_SX;
    this.canvas.height = WORLD_SZ;
    this.canvas.className = 'world-preview';
    c.appendChild(this.canvas);

    const mk = (label: () => string): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'menu-item';
      row.innerHTML = `<span class="mi-arrow">◀</span><span class="mi-body">${label()}</span><span class="mi-arrow">▶</span>`;
      this.rows.push(row);
      return row;
    };
    const list = document.createElement('div');
    list.className = 'menu-list';
    list.appendChild(mk(() => `🌍 ${WORLD_THEMES[this.theme].icon} ${WORLD_THEMES[this.theme].name}`));
    list.appendChild(mk(() => `🎲 Seed: ${this.seed}`));
    list.appendChild(mk(() => `✨ Surprise me!`));
    if (this.onSavedWorlds) list.appendChild(mk(() => `📚 My saved worlds`));
    list.appendChild(mk(() => `▶ Start this world!`));
    c.appendChild(list);

    const k = btnLabels(type);
    this.keys(c, [[k.ud, 'move'], [type === 'keyboard' ? 'Arrows' : k.lr, 'change'], [k.a, 'start'], [k.b, 'keep']]);
    this.refresh();
  }

  private label(i: number): string {
    const savedRow = this.onSavedWorlds ? 3 : -1;
    if (i === 0) return `🌍 ${WORLD_THEMES[this.theme].icon} ${WORLD_THEMES[this.theme].name}`;
    if (i === 1) return `🎲 Seed: ${this.seed}`;
    if (i === 2) return '✨ Surprise me!';
    if (i === savedRow) return '📚 My saved worlds';
    return '▶ Start this world!';
  }

  private refresh(): void {
    this.rows.forEach((r, i) => {
      r.classList.toggle('sel', i === this.sel);
      const body = r.querySelector('.mi-body');
      if (body) body.textContent = this.label(i);
    });
    drawWorldPreview(this.canvas, this.seed, this.theme);
  }

  tick(frame: FrameControls, dt: number): void {
    const nav = this.nav.tick(frame, dt);
    let changed = false;
    if (nav.down) { this.sel = (this.sel + 1) % this.rows.length; this.audio.uiMove(); }
    if (nav.up) { this.sel = (this.sel + this.rows.length - 1) % this.rows.length; this.audio.uiMove(); }
    if (nav.left || nav.right) {
      const fwd = nav.right;
      if (this.sel === 0) {
        this.theme = (this.theme + (fwd ? 1 : WORLD_THEMES.length - 1)) % WORLD_THEMES.length;
        changed = true;
      } else if (this.sel === 1) {
        this.seed += fwd ? 1 : -1;
        changed = true;
      }
      this.audio.uiMove();
    }
    if (nav.confirm) {
      if (this.sel === 2) {
        this.seed = Math.floor(Math.random() * 90_000_000) + 1000;
        this.audio.uiSelect();
        changed = true;
      } else if (this.onSavedWorlds && this.sel === 3) {
        // the game swaps in the saved-worlds list; this card stays open
        // until the swap, so no close() here
        this.audio.uiSelect();
        this.onSavedWorlds();
        return;
      } else {
        this.audio.uiSelect();
        this.onStart(this.seed, this.theme);
        this.close();
        return;
      }
    }
    if (nav.back) { this.audio.uiBack(); this.close(); return; }
    if (changed || nav.up || nav.down) this.refresh();
  }
}

// ------------------------------------------------------------- my worlds

export interface MyWorldsActions {
  /** every world the game has saved, newest first */
  list(): Promise<SavedWorldInfo[]>;
  /** move the whole family into a saved world (everyone respawns at spawn) */
  play(seed: number, theme: number): void;
  /** wipe one saved world for good */
  remove(seed: number, theme: number): Promise<void> | void;
  /** push the current world to storage right now (autosave keeps it fresh anyway) */
  saveNow(): Promise<void> | void;
  /** "New world…" opens the fresh-world picker; the row hides when omitted */
  openNewWorld?(): void;
}

/** "just now · 5 min ago · 3 h ago · 2 d ago · 12.3.2026" for the list rows */
function agoLabel(ts?: number): string {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * The saved-worlds list: every (world, seed) the family has ever played,
 * newest first, each with a live map preview. Highlight a row and press A to
 * play that world again; Y/△ (F on the keyboard) deletes it — the row asks
 * twice, like everything destructive. Save Now is here for grown-ups who
 * want the belt AND braces.
 */
export class MyWorldsOverlay extends Overlay {
  private canvas: HTMLCanvasElement;
  private listEl: HTMLDivElement;
  private worlds: SavedWorldInfo[] = [];
  private rows: { el: HTMLElement; labelEl: HTMLElement; valEl: HTMLElement; label: () => string; info?: SavedWorldInfo; act?: () => void; val?: () => string }[] = [];
  private loading = true;
  private sel = 0;
  /** guards against two in-flight reload()s racing: only the newest may render */
  private reloadSeq = 0;
  /** world row index showing 'SURE?' (Y/△ arms it, a second Y deletes); null = disarmed */
  private armed: number | null = null;

  constructor(
    audio: AudioKit,
    type: ControllerType,
    private curSeed: number,
    private curTheme: number,
    private actions: MyWorldsActions,
  ) {
    super(audio, type);
    const c = this.card('My Worlds 💾');
    this.canvas = document.createElement('canvas');
    this.canvas.width = WORLD_SX;
    this.canvas.height = WORLD_SZ;
    this.canvas.className = 'world-preview';
    c.appendChild(this.canvas);
    this.listEl = document.createElement('div');
    this.listEl.className = 'menu-list';
    c.appendChild(this.listEl);
    const k = btnLabels(type);
    this.keys(c, [[k.ud, 'move'], [k.a, 'choose'], [type === 'keyboard' ? 'F' : 'Y', 'delete'], [k.b, 'back']]);
    this.rebuild();
    void this.reload();
  }

  private async reload(): Promise<void> {
    // a delete or save kicks off a reload; if two overlap, only the newest
    // result may touch the rows — a slow-but-stale list must not resurrect
    // a world that the newer one already dropped
    const seq = ++this.reloadSeq;
    const worlds = await this.actions.list().catch(() => [] as SavedWorldInfo[]);
    if (this.closed || seq !== this.reloadSeq) return;
    this.loading = false;
    this.worlds = worlds;
    this.armed = null;
    this.rebuild();
    if (this.sel >= this.rows.length) this.sel = 0;
    this.refresh();
  }

  private rebuild(): void {
    this.listEl.textContent = '';
    this.rows = [];
    if (this.loading) {
      const s = document.createElement('div');
      s.className = 'sub';
      s.textContent = 'Loading your worlds…';
      this.listEl.appendChild(s);
      return;
    }
    const mk = (info: SavedWorldInfo | undefined, label: () => string, act: () => void, val?: () => string): void => {
      const row = document.createElement('div');
      row.className = 'menu-item';
      const labelEl = document.createElement('span');
      labelEl.textContent = label();
      const valEl = document.createElement('span');
      valEl.className = 'mi-val';
      valEl.textContent = val?.() ?? '';
      row.append(labelEl, valEl);
      row.addEventListener('click', act);
      this.listEl.appendChild(row);
      this.rows.push({ el: row, labelEl, valEl, label, info, act, val });
    };
    this.worlds.forEach((w, i) => {
      mk(w,
        () => {
          const th = themeOf(w.theme);
          const built = w.mods !== undefined ? ` · ${w.mods} built` : '';
          return `${th.icon} ${th.name} · seed ${w.seed}${built}`;
        },
        () => this.playWorld(w),
        // Y/△ arms the highlighted row: it swaps "5 min ago" for SURE? until
        // the cursor moves or the world is deleted
        () => (this.armed === i ? 'SURE?' : agoLabel(w.savedAt)),
      );
    });
    if (this.worlds.length === 0) {
      const s = document.createElement('div');
      s.className = 'sub';
      s.textContent = 'Nothing saved yet — go build something! 🏗️';
      this.listEl.appendChild(s);
    }
    mk(undefined, () => '💾 Save this world now', () => {
      this.audio.uiSelect();
      void Promise.resolve(this.actions.saveNow()).then(() => { if (!this.closed) void this.reload(); });
    });
    if (this.actions.openNewWorld) {
      mk(undefined, () => '🌍 New world…', () => {
        this.audio.uiSelect();
        this.close();
        this.actions.openNewWorld?.();
      });
    }
    mk(undefined, () => '◀ Back', () => { this.audio.uiBack(); this.close(); });
  }

  /**
   * Y/△ (F): first press arms the highlighted world row ('SURE?'), the next
   * one deletes it — two presses for anything that eats a world, same as
   * Reset World. Moving the cursor disarms.
   */
  private tryDelete(): void {
    const row = this.rows[this.sel];
    if (!row?.info) return;
    if (this.armed !== this.sel) {
      this.armed = this.sel;
      this.audio.uiSelect();
      this.refresh();
      return;
    }
    this.armed = null;
    const w = row.info;
    void Promise.resolve(this.actions.remove(w.seed, w.theme)).then(() => {
      if (!this.closed) void this.reload();
    });
  }

  private playWorld(w: SavedWorldInfo): void {
    this.audio.uiSelect();
    this.actions.play(w.seed, w.theme);
    this.close();
  }

  private refresh(): void {
    this.rows.forEach((r, i) => {
      r.el.classList.toggle('sel', i === this.sel);
      r.labelEl.textContent = r.label();
      r.valEl.textContent = r.val?.() ?? '';
    });
    // the map picture follows the cursor: a world row previews that world
    const w = this.rows[this.sel]?.info;
    drawWorldPreview(this.canvas, w ? w.seed : this.curSeed, w ? w.theme : this.curTheme);
  }

  tick(frame: FrameControls, dt: number): void {
    const nav = this.nav.tick(frame, dt);
    if (this.rows.length === 0) return;
    if (nav.down) { this.sel = (this.sel + 1) % this.rows.length; this.audio.uiMove(); }
    if (nav.up) { this.sel = (this.sel + this.rows.length - 1) % this.rows.length; this.audio.uiMove(); }
    if (nav.up || nav.down) this.armed = null;
    if (frame.pressed.has('palette')) this.tryDelete();
    if (nav.confirm) {
      const row = this.rows[this.sel];
      if (row.info) this.playWorld(row.info);
      else row.act?.();
    }
    if (nav.back) { this.audio.uiBack(); this.close(); }
    if (nav.up || nav.down || nav.confirm || nav.back) this.refresh();
  }
}

// ------------------------------------------------------------------- help

const PAD_ROWS: [string, string][] = [
  ['LEFT STICK', 'Walk around'],
  ['RIGHT STICK', 'Look / aim'],
  ['A', 'Jump'],
  ['LT', 'Place block'],
  ['RT', 'Break block'],
  ['LB / RB', 'Prev / next block'],
  ['X', 'Pet · open doors & chests · turn stairs'],
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
