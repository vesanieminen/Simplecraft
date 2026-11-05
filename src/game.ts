/**
 * Game bootstrap and the main loop. Ties together: world, renderer,
 * split-screen viewports, local players + controller routing, UI
 * overlays, animals, stars, particles, audio and persistence.
 */

import * as THREE from 'three';
import { AudioKit } from './core/audio';
import { AnimalWorld, ANIMAL_KINDS } from './core/animals';
import {
  blockDef, CHEST, CHEST_OPEN, DOOR, DOOR_OPEN, DOOR_TOP, DOOR_TOP_OPEN, isChestBlock,
  isDoorBlock, isDoorTopBlock, isExplosiveBlock, isSolidBlock, isStairsBlock,
  ROCK, rotateStairFacing, SAPLING, StairFacing, STAIRS, WATER,
} from './core/blocks';
import { StarField } from './core/collectibles';
import { BlastInfo, DynamiteManager } from './core/dynamite';
import { ParticleSystem } from './core/particles';
import { RayHit } from './core/raycast';
import { blockAabb, boxesOverlap, playerAabb } from './core/physics';
import { DEFAULT_SEED, generateTerrain, plantTree, themeOf, WORLD_THEMES } from './core/terrain';
import { BOOST_SECONDS, EMPTY_CHEST_MESSAGE, rollTreasure, Treasure } from './core/treasure';
import { idx as worldIdx, SavedWorldInfo, World, WorldSaveData, WORLD_SX, WORLD_SY, WORLD_SZ } from './core/world';
import { InputManager } from './input/inputManager';
import { KeyboardSource } from './input/keyboard';
import { ControllerType, InputSource, FrameControls, emptyFrame } from './input/types';
import { VirtualPadSource } from './input/virtual';
import { LocalPlayer } from './players/localPlayer';
import { PlayerEntity } from './players/playerEntity';
import { AVATAR_COLORS, NICKNAMES } from './players/avatar';
import { ChunkMeshManager } from './render/chunkMeshes';
import { createSky, SKY_CLEAR, SKY_FAR, SkyEnv } from './render/sky';
import { SplitLayout, ViewportManager } from './render/viewportManager';
import { Hud } from './ui/hud';
import {
  GrownUpsMenu, HelpOverlay, JoinCard, MyWorldsActions, MyWorldsOverlay, Overlay, PaletteOverlay,
  PlayerMenu, ReconnectOverlay, WorldSelectOverlay,
} from './ui/overlays';
import { UiManager } from './ui/uiManager';

const MAX_PLAYERS = 4;

/** flat world index back to x/y/z — the inverse of world.idx */
function unidx(i: number): [number, number, number] {
  const x = Math.floor(i / (WORLD_SZ * WORLD_SY));
  const rest = i - x * WORLD_SZ * WORLD_SY;
  const z = Math.floor(rest / WORLD_SY);
  return [x, rest - z * WORLD_SY, z];
}

interface PendingJoin {
  source: InputSource;
  card: JoinCard;
  camera: THREE.PerspectiveCamera;
  angle: number;
}

interface ReservedSeat {
  name: string;
  colorHex: string;
  sourceId: string;
}

export class Game {
  world!: World;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  chunks!: ChunkMeshManager;
  input = new InputManager();
  audio = new AudioKit();
  particles!: ParticleSystem;
  animals!: AnimalWorld;
  starField!: StarField;
  viewportMgr = new ViewportManager();
  ui = new UiManager();

  players: LocalPlayer[] = [];
  pendingJoins = new Map<string, PendingJoin>();
  /** disconnected players kept alive, waiting for their controller back */
  reservedSeats = new Map<number, ReservedSeat>();
  layout: SplitLayout = 'auto';
  frozen = false;
  seed = DEFAULT_SEED;
  theme = 0;

  private spawnPoint = new THREE.Vector3(WORLD_SX / 2, 12, WORLD_SZ / 2);
  /** the welcome-screen world menu (new-world picker or the saved-worlds list) */
  private welcomePicker: { sid: string; overlay: Overlay } | null = null;
  private idleAngle = 0;
  /** slow orbit camera used while nobody has joined (welcome + world picker backdrop) */
  private idleCamera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, SKY_FAR);
  private overlays = new Map<number, Overlay>(); // playerId -> overlay
  private sourceToPlayer = new Map<string, LocalPlayer>();
  /** wall-clock instant from which a just-left controller may join again */
  private rejoinMute = new Map<string, number>();
  private lastRevision = 0;
  private saveTimer: number | undefined;
  private skyEnv!: SkyEnv;
  private time = 0;
  private sparkleBlocks = new Set<number>();
  dynamite!: DynamiteManager;
  /**
   * Player-planted saplings: flat world index -> game time when planted.
   * After `saplingGrowSeconds` of game time (public so tests can hurry it)
   * they grow into real trees. Saplings restored from a save grow about ten
   * seconds after joining, so a planted forest keeps living between sessions.
   */
  saplings = new Map<number, number>();
  saplingGrowSeconds = 30;
  private lastLandSound = new Map<number, number>();
  private lastStroke = new Map<number, number>();
  private stepEvents = {
    landed: false, bounced: null as number | null,
    steppedOnMusic: null as null | { note: number; x: number; y: number; z: number },
    steppedOnSparkle: false, splashed: false, stroked: false,
  };
  private rafId = 0;

  async init(): Promise<void> {
    this.loadSettings(); // layout + sound survive reloads

    // ---- world (seed + theme, overridable via ?seed=..&world=0..N) ----
    const params = new URLSearchParams(location.search);
    this.seed = Number(params.get('seed')) || DEFAULT_SEED;
    const themeParam = Number(params.get('world'));
    this.theme = Number.isInteger(themeParam) && themeParam >= 0 && themeParam < WORLD_THEMES.length ? themeParam : 0;
    this.world = new World(this.seed, this.theme);
    const save = await this.loadSave();
    const gen = generateTerrain(this.world);
    if (save && save.seed === this.seed && (save.theme ?? 0) === this.theme) this.world.applySave(save);
    this.spawnPoint.set(gen.spawnX, gen.spawnY, gen.spawnZ);

    // ---- renderer & scene ----
    const canvas = document.getElementById('gl') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    // whatever the sky does not cover should look like hazy sky, never the black
    // void behind the canvas (each split-screen pane is cleared to this)
    this.renderer.setClearColor(SKY_CLEAR, 1);
    this.scene = new THREE.Scene();
    this.chunks = new ChunkMeshManager(this.scene, this.world);
    this.chunks.rebuildAll();
    this.skyEnv = createSky(this.scene);
    this.particles = new ParticleSystem(this.scene);

    // sparkle blocks placed by players emit drifting sparkles
    for (const [i, b] of this.world.mods) if (blockDef(b).sparkle) this.sparkleBlocks.add(i);

    // saplings that came back from a save keep growing from the moment you join
    for (const [i, b] of this.world.mods) {
      if (b === SAPLING) this.saplings.set(i, -this.saplingGrowSeconds + 10);
    }

    this.animals = new AnimalWorld(this.scene, this.world, this.particles, this.audio, gen.spawnX, gen.spawnZ);
    this.starField = new StarField(this.scene, this.world, gen.spawnX, gen.spawnZ);

    // dynamite: sticks that came with the save get their fuses back
    this.dynamite = new DynamiteManager(
      this.scene, this.world, this.particles, this.audio, (b) => this.onBlast(b),
    );
    this.dynamite.restoreFromWorld();

    // ---- input ----
    this.input.addSource(new KeyboardSource());
    this.input.onSourceAdded = (s) => this.onSourceAdded(s);
    this.input.onSourceRemoved = (s) => this.onSourceRemoved(s);

    // ---- UI ----
    this.ui.mount();
    this.ui.showWelcome(true);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('lbw-open-palette', (e) => {
      const pid = (e as CustomEvent<number>).detail;
      const p = this.players.find((pp) => pp.entity.id === pid);
      if (p) this.openPalette(p);
    });
    this.resize();

    this.lastRevision = this.world.revision;
    this.loop(performance.now());
  }

  // ------------------------------------------------------------ join flow

  private onSourceAdded(s: InputSource): void {
    // a returning controller resumes its reserved player
    for (const [pid, seat] of this.reservedSeats) {
      if (seat.sourceId === s.id) {
        this.reservedSeats.delete(pid);
        const p = this.players.find((pp) => pp.entity.id === pid);
        if (p) {
          this.sourceToPlayer.set(s.id, p);
          p.sourceId = s.id;
          const idx = this.players.indexOf(p);
          this.ui.clearOverlays(idx);
          this.ui.toast(`Welcome back, ${seat.name}! 🎮`);
          this.audio.join();
          return;
        }
      }
    }
  }

  private onSourceRemoved(s: InputSource): void {
    // a pending join card dies with its controller
    const pj = this.pendingJoins.get(s.id);
    if (pj) {
      pj.card.close();
      this.pendingJoins.delete(s.id);
      this.resize();
    }
    const p = this.sourceToPlayer.get(s.id);
    if (!p) return;
    this.sourceToPlayer.delete(s.id);
    const idx = this.players.indexOf(p);
    this.reservedSeats.set(p.entity.id, {
      name: p.entity.name, colorHex: p.entity.colorHex, sourceId: s.id,
    });
    if (idx >= 0) {
      this.ui.clearOverlays(idx);
      this.ui.addOverlay(idx, new ReconnectOverlay(s.controllerType));
    }
    this.ui.toast(`${p.entity.name}'s controller fell asleep 😴`);
  }

  private handleUnassignedInput(s: InputSource, frame: FrameControls): void {
    if (!frame.anyPressed) return;
    this.audio.resume();

    // At the welcome screen, pressing the palette/world button opens the
    // world chooser instead of a join card — so families can pick a world
    // (or roll a seed) before anyone joins.
    if (this.players.length === 0 && this.pendingJoins.size === 0
      && frame.pressed.has('palette')) {
      this.openWelcomeWorldPicker(s);
      return;
    }

    // fill a disconnected seat first
    for (const [pid, seat] of this.reservedSeats) {
      const p = this.players.find((pp) => pp.entity.id === pid);
      if (p) {
        this.reservedSeats.delete(pid);
        this.sourceToPlayer.set(s.id, p);
        p.sourceId = s.id;
        const idx = this.players.indexOf(p);
        this.ui.clearOverlays(idx);
        this.ui.toast(`${seat.name} is back!`);
        this.audio.join();
        return;
      }
    }
    if (this.players.length + this.pendingJoins.size >= MAX_PLAYERS) return;
    if (this.pendingJoins.has(s.id)) return;
    const card = new JoinCard(this.audio, s.controllerType, this.players.length + this.pendingJoins.size + 1,
      (colorIdx, nameIdx) => this.confirmJoin(s, colorIdx, nameIdx));
    const cam = new THREE.PerspectiveCamera(70, 1, 0.1, SKY_FAR);
    const pane = this.players.length + this.pendingJoins.size;
    this.pendingJoins.set(s.id, { source: s, card, camera: cam, angle: Math.random() * 6 });
    this.ui.ensurePanes(pane + 1);
    this.ui.addOverlay(pane, card);
    this.resize();
    this.ui.toast('Say hello to a new friend!');
  }

  private confirmJoin(s: InputSource, colorIdx: number, nameIdx: number): void {
    this.pendingJoins.delete(s.id);
    const idx = this.players.length;
    const color = AVATAR_COLORS[colorIdx % AVATAR_COLORS.length];
    const name = NICKNAMES[nameIdx % NICKNAMES.length];
    const spawn = this.spawnPoint.clone();
    spawn.x += Math.cos(idx * Math.PI / 2) * 2.2;
    spawn.z += Math.sin(idx * Math.PI / 2) * 2.2;
    const entity = new PlayerEntity(
      this.nextEntityId(), name, color.hex, spawn,
    );
    entity.yaw = Math.atan2(this.spawnPoint.x - spawn.x, this.spawnPoint.z - spawn.z);
    this.scene.add(entity.avatar.group);
    const lp = new LocalPlayer(entity, this.scene, this.world);
    lp.sourceId = s.id;
    this.players.push(lp);
    this.sourceToPlayer.set(s.id, lp);
    this.audio.join();
    if (this.players.length >= 2) this.ui.toast(`${name} joined — split screen! 🎉`);
    else this.ui.toast(`Hi ${name}! Have fun!`);
    this.ui.showWelcome(this.players.length === 0);
    this.resize();
  }

  private nextEntityId(): number {
    let max = 0;
    for (const p of this.players) max = Math.max(max, p.entity.id);
    return max + 1;
  }

  sourceIdOf(p: LocalPlayer): string {
    return p.sourceId;
  }

  // ------------------------------------------------------------ routing

  private routeInput(dt: number): void {
    // world picker opened at the welcome screen (nobody joined yet)
    if (this.welcomePicker) {
      const frame = this.input.frame(this.welcomePicker.sid);
      this.welcomePicker.overlay.tick(frame, dt);
      if (this.welcomePicker.overlay.closed) {
        this.welcomePicker = null;
        this.ui.showWelcome(this.players.length === 0);
        this.resize();
      }
    }

    for (const [sid, pj] of this.pendingJoins) {
      const frame = this.input.frame(sid);
      pj.card.tick(frame, dt);
      if (pj.card.closed) {
        this.pendingJoins.delete(sid);
        this.resize();
      }
    }

    // snapshot: "Leave" inside a menu can remove a player mid-frame
    for (const p of [...this.players]) {
      if (!this.players.includes(p)) continue; // they left while someone else was handled
      this.updatePlayer(p, dt);
    }

    // unassigned sources (join detection)
    for (const s of this.input.sources.values()) {
      if (this.sourceToPlayer.has(s.id) || this.pendingJoins.has(s.id)) continue;
      if (this.welcomePicker?.sid === s.id) continue; // the picker owns this pad
      if ((this.rejoinMute.get(s.id) ?? 0) > performance.now()) continue; // just left
      const reserved = [...this.reservedSeats.values()].some((r) => r.sourceId === s.id);
      if (reserved) continue; // handled on reconnect event
      this.handleUnassignedInput(s, this.input.frame(s.id));
    }
  }

  /** one player's frame: menu/palette routing, movement, pickups */
  private updatePlayer(p: LocalPlayer, dt: number): void {
    const sid = this.sourceIdOf(p);
    const frame = sid ? this.input.frame(sid) : emptyFrame();
    const overlay = this.overlays.get(p.entity.id);
    if (overlay) {
      overlay.tick(frame, dt);
      // only drop the slot if it still holds this (now closed) overlay:
      // a menu can open a new overlay in the same tick (Help, Grown-Ups, Blocks)
      if (overlay.closed && this.overlays.get(p.entity.id) === overlay) this.overlays.delete(p.entity.id);
      if (!this.players.includes(p)) return; // the menu's Leave row removed them
      p.update(dt, emptyFrame(), this.hooks(), true);
    } else {
      if (frame.pressed.has('menu')) {
        this.openMenu(p);
        p.update(dt, emptyFrame(), this.hooks(), true);
      } else if (frame.pressed.has('palette')) {
        this.openPalette(p);
        p.update(dt, emptyFrame(), this.hooks(), true);
      } else if (this.frozen) {
        // frozen world: everything stops dead — no walking, jumping or building.
        // the controller can still open the menu to unfreeze.
      } else {
        if (frame.pressed.has('jump')) this.audio.jump();
        p.update(dt, frame, this.hooks(), false);
      }
    }
    this.handleStepEvents(p);

    // star pickups
    const st = this.starField.checkCollect(p.entity.pos.x, p.entity.pos.y, p.entity.pos.z, 1.1);
    if (st) {
      this.starField.take(st);
      p.entity.starsCount++;
      this.audio.collect();
      this.particles.burst(st.pos.x, st.pos.y, st.pos.z, 0xffe14d, 14, 1.2);
    }
  }

  private handleStepEvents(p: LocalPlayer): void {
    const ev = this.stepEvents;
    const e = p.entity;
    if (ev.landed && this.time - (this.lastLandSound.get(e.id) ?? -9) > 0.25) {
      this.lastLandSound.set(e.id, this.time);
      this.audio.land();
    }
    if (ev.bounced) this.audio.bounce();
    if (ev.steppedOnMusic) {
      const m = ev.steppedOnMusic;
      const noteIdx = Math.floor(Math.abs(Math.sin((m.x * 7 + m.z * 13 + m.y) * 12.9898)) * 10000) % 8;
      this.audio.note(noteIdx, `${m.x},${m.y},${m.z}`);
      this.particles.spawn(m.x + 0.5, m.y + 1.05, m.z + 0.5, 0xb39ddb, { vy: 2, ttl: 0.7, gravity: -2 });
    }
    if (ev.splashed) {
      this.particles.burst(e.pos.x, e.pos.y + 0.3, e.pos.z, 0x7fd0f0, 8, 0.6);
      this.audio.land();
    }
    if (ev.stroked && this.time - (this.lastStroke.get(e.id) ?? -9) > 0.5) {
      this.lastStroke.set(e.id, this.time);
      this.audio.swimStroke();
    }
    ev.landed = false;
    ev.bounced = null;
    ev.steppedOnMusic = null;
    ev.steppedOnSparkle = false;
    ev.splashed = false;
    ev.stroked = false;
  }

  private openMenu(p: LocalPlayer): void {
    const idx = this.players.indexOf(p);
    this.ui.clearOverlays(idx);
    const menu = new PlayerMenu(
      this.audio, this.typeOf(p), p,
      {
        toggleFly: () => { p.entity.flying = !p.entity.flying; p.entity.vel.y = 0; },
        toggleCamera: () => { p.firstPerson = !p.firstPerson; },
        goHome: () => { p.respawnAt(this.spawnPoint.clone()); },
        toggleSound: () => { this.audio.setMuted(!this.audio.muted); this.saveSettings(); },
        openHelp: () => {
          this.ui.clearOverlays(idx);
          const h = new HelpOverlay(this.audio, this.typeOf(p));
          this.overlays.set(p.entity.id, h);
          this.ui.addOverlay(idx, h);
        },
        openGrownUps: () => {
          this.ui.clearOverlays(idx);
          const g = new GrownUpsMenu(this.audio, this.typeOf(p), {
            toggleFreeze: () => { this.frozen = !this.frozen; this.ui.showFreeze(this.frozen); },
            cycleLayout: () => {
              const order: SplitLayout[] = ['auto', 'horizontal', 'vertical', 'grid2x2'];
              this.layout = order[(order.indexOf(this.layout) + 1) % order.length];
              this.resize();
              this.saveSettings();
              return this.layout === 'auto' ? 'Smart'
                : this.layout === 'horizontal' ? 'Left/Right'
                : this.layout === 'vertical' ? 'Up/Down' : '2×2 Grid';
            },
            resetWorld: () => void this.resetWorld(),
            openWorlds: () => { this.openWorldPickerFor(p); },
            openMyWorlds: () => { this.openMyWorldsFor(p); },
            sendWaitingHome: () => this.sendWaitingHome(),
            waiting: () => this.waitingLabel(),
            frozen: () => this.frozen,
            layout: () => (this.layout === 'auto' ? 'Smart'
              : this.layout === 'horizontal' ? 'Left/Right'
              : this.layout === 'vertical' ? 'Up/Down' : '2×2 Grid'),
          },
          );
          this.overlays.set(p.entity.id, g);
          this.ui.addOverlay(idx, g);
        },
        leave: () => this.removePlayer(p),
      },
      () => !this.audio.muted,
    );
    this.overlays.set(p.entity.id, menu);
    this.ui.addOverlay(idx, menu);
  }

  private openWelcomeWorldPicker(s: InputSource): void {
    this.audio.uiSelect();
    this.ui.ensurePanes(1);
    this.ui.clearOverlays(0);
    const o = new WorldSelectOverlay(
      this.audio, s.controllerType, this.seed, this.theme,
      (seed, theme) => {
        this.applyNewWorld(seed, theme);
        this.ui.toast(`${themeOf(theme).icon} ${themeOf(theme).name} world — seed ${seed}!`);
      },
      () => this.openWelcomeSavedWorlds(),
    );
    this.welcomePicker = { sid: s.id, overlay: o };
    this.ui.showWelcome(false);
    this.ui.addOverlay(0, o);
    this.resize();
  }

  /** welcome screen: swap the new-world picker for the list of saved worlds */
  private openWelcomeSavedWorlds(): void {
    if (!this.welcomePicker) return;
    const sid = this.welcomePicker.sid;
    this.welcomePicker.overlay.close();
    this.ui.clearOverlays(0);
    const o = new MyWorldsOverlay(
      this.audio, this.controllerTypeOf(sid), this.seed, this.theme,
      this.myWorldsActions(() => {
        // "New world…" from the list: swap the fresh-world picker back in
        const s = this.input.sources.get(sid);
        if (s) this.openWelcomeWorldPicker(s);
      }),
    );
    this.welcomePicker = { sid, overlay: o };
    this.ui.addOverlay(0, o);
  }

  private openWorldPickerFor(p: LocalPlayer): void {
    // opened from the grown-up menu: rides the player's overlay slot
    const idx = this.players.indexOf(p);
    this.overlays.get(p.entity.id)?.close();
    this.ui.clearOverlays(idx);
    const o = new WorldSelectOverlay(
      this.audio, this.typeOf(p), this.seed, this.theme,
      (seed, theme) => {
        this.applyNewWorld(seed, theme);
        this.ui.toast(`${themeOf(theme).icon} ${themeOf(theme).name} world — seed ${seed}!`);
      },
      () => this.openMyWorldsFor(p),
    );
    this.overlays.set(p.entity.id, o);
    this.ui.addOverlay(idx, o);
  }

  /** the My Worlds list, riding this player's overlay slot */
  private openMyWorldsFor(p: LocalPlayer): void {
    const idx = this.players.indexOf(p);
    this.overlays.get(p.entity.id)?.close();
    this.ui.clearOverlays(idx);
    const o = new MyWorldsOverlay(
      this.audio, this.typeOf(p), this.seed, this.theme,
      this.myWorldsActions(() => this.openWorldPickerFor(p)),
    );
    this.overlays.set(p.entity.id, o);
    this.ui.addOverlay(idx, o);
  }

  private openPalette(p: LocalPlayer): void {
    const idx = this.players.indexOf(p);
    this.ui.clearOverlays(idx);
    const pal = new PaletteOverlay(this.audio, this.typeOf(p), p, (b) => p.setSelected(b));
    this.overlays.set(p.entity.id, pal);
    this.ui.addOverlay(idx, pal);
  }

  private controllerTypeOf(sid: string): ControllerType {
    return this.input.sources.get(sid)?.controllerType ?? 'generic';
  }

  private typeOf(p: LocalPlayer): 'xbox' | 'playstation' | 'generic' | 'keyboard' {
    return this.controllerTypeOf(this.sourceIdOf(p));
  }

  /** the button wiring for the My Worlds list; openNewWorld adds its "🌍 New world…" row */
  private myWorldsActions(openNewWorld?: () => void): MyWorldsActions {
    return {
      list: () => this.fetchWorldList(),
      play: (seed, theme) => void this.loadSavedWorld(seed, theme),
      remove: (seed, theme) => this.deleteWorld(seed, theme).then(() => {
        this.ui.toast('That world is gone — a fresh field for new ideas 🗑');
      }),
      saveNow: async () => {
        await this.saveNow();
        this.ui.toast('World saved! 💾');
      },
      openNewWorld,
    };
  }

  private removePlayer(p: LocalPlayer): void {
    const idx = this.players.indexOf(p);
    if (idx < 0) return; // already left
    const sid = this.sourceIdOf(p);

    this.ui.clearOverlays(idx);
    this.ui.detachHud(idx);
    this.sourceToPlayer.delete(sid);
    this.reservedSeats.delete(p.entity.id);
    this.overlays.delete(p.entity.id);
    this.lastLandSound.delete(p.entity.id);
    // that controller may still be holding (or has queued) the button press that
    // confirmed leaving: ignore it briefly, otherwise their half of the screen
    // instantly turns back into a join card instead of closing
    this.rejoinMute.set(sid, performance.now() + 900);

    p.dispose(this.scene);
    p.entity.dispose();
    this.players.splice(idx, 1);
    this.resize(); // recomputes the split AND throws away the freed pane
    this.ui.showWelcome(this.players.length === 0 && this.pendingJoins.size === 0);
    this.audio.uiBack();
    this.ui.toast(this.players.length === 0
      ? `${p.entity.name} left — press any button on a controller to join! 👋`
      : `${p.entity.name} left — their half of the screen is free 🚪`);
  }

  /** grown-up helper: everyone whose controller fell asleep goes home */
  private sendWaitingHome(): void {
    const waiting = [...this.reservedSeats.keys()].map((pid) =>
      this.players.find((p) => p.entity.id === pid));
    let sent = 0;
    for (const [pid] of [...this.reservedSeats]) {
      this.reservedSeats.delete(pid);
      const p = waiting.find((w) => w?.entity.id === pid);
      if (p) {
        this.removePlayer(p);
        sent++;
      }
    }
    this.resize();
    this.ui.showWelcome(this.players.length === 0 && this.pendingJoins.size === 0);
    this.ui.toast(sent === 1 ? '1 waiting player went home 👋'
      : sent > 1 ? `${sent} waiting players went home 👋` : 'Nobody is waiting 💤');
  }

  private waitingLabel(): string {
    const n = this.reservedSeats.size;
    return n === 1 ? '1 asleep' : n > 1 ? `${n} asleep` : 'none';
  }

  // ------------------------------------------------------------ building

  /**
   * Which way a door's panel stands: 0 = thin along x, 1 = thin along z.
   * Taken from the face the placement/aim hit (the panel lies in the wall's
   * plane); when a door is patted out of flat ground, from where the player
   * is looking.
   */
  private doorFacingFromAim(lp: LocalPlayer, hit: RayHit): number {
    const nx = hit.px - hit.x;
    const nz = hit.pz - hit.z;
    if (Math.abs(nx) > 0) return 0;
    if (Math.abs(nz) > 0) return 1;
    return Math.abs(Math.sin(lp.entity.yaw)) > Math.abs(Math.cos(lp.entity.yaw)) ? 0 : 1;
  }

  /** the pet/interact button on a door: the whole door swings open, or closes */
  private toggleDoor(lp: LocalPlayer, hit: RayHit): void {
    // a door is two cells tall; aim at either half and the pair swings together
    const yBottom = isDoorTopBlock(hit.block) ? hit.y - 1 : hit.y;
    const bottom = this.world.get(hit.x, yBottom, hit.z);
    const top = this.world.get(hit.x, yBottom + 1, hit.z);
    const parts: [number, number][] = []; // [y, block id]
    if (isDoorBlock(bottom) && !isDoorTopBlock(bottom)) {
      parts.push([yBottom, bottom]);
      if (isDoorTopBlock(top)) parts.push([yBottom + 1, top]);
    } else {
      // a half standing on its own: a door left over from an old one-block save
      parts.push([hit.y, hit.block]);
    }
    const opening = parts.some(([, b]) => b === DOOR || b === DOOR_TOP);
    for (const [y, b] of parts) {
      const to = b === DOOR ? DOOR_OPEN : b === DOOR_TOP ? DOOR_TOP_OPEN
        : b === DOOR_OPEN ? DOOR : b === DOOR_TOP_OPEN ? DOOR_TOP : b;
      this.world.set(hit.x, y, hit.z, to);
      const i = worldIdx(hit.x, y, hit.z);
      if (!this.world.doorFacing.has(i)) this.world.doorFacing.set(i, this.doorFacingFromAim(lp, hit));
    }
    if (opening) this.audio.doorOpen();
    else this.audio.doorClose();
    this.particles.burst(hit.x + 0.5, yBottom + 1, hit.z + 0.5, 0xd9a766, 6, 0.6);
    this.world.revision++; // the swing itself is a change: let autosave catch it
  }

  /**
   * Which way a new stair points: the TALL half is the far side of the cell, so
   * the step climbs away from whoever is building it and the riser leans against
   * the wall they were aiming at. When the cell is right under their feet, the
   * way they are looking decides instead.
   */
  private stairFacingFromAim(lp: LocalPlayer, hit: RayHit): StairFacing {
    const dx = hit.px + 0.5 - lp.entity.pos.x;
    const dz = hit.pz + 0.5 - lp.entity.pos.z;
    if (Math.hypot(dx, dz) < 0.4) {
      const yaw = lp.entity.yaw; // forward is (sin yaw, cos yaw), as in playerEntity
      return Math.abs(Math.sin(yaw)) >= Math.abs(Math.cos(yaw))
        ? (Math.sin(yaw) > 0 ? 0 : 1)
        : (Math.cos(yaw) > 0 ? 2 : 3);
    }
    return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 0 : 1) : (dz > 0 ? 2 : 3);
  }

  /** the pet button aimed at a step: spin it a quarter turn on the spot */
  private rotateStairs(hit: RayHit): void {
    const was = this.world.getStairFacing(hit.x, hit.y, hit.z);
    this.world.setStairFacing(hit.x, hit.y, hit.z, rotateStairFacing(was as StairFacing));
    this.audio.place();
    this.particles.burst(hit.x + 0.5, hit.y + 0.6, hit.z + 0.5, 0xf2c98c, 5, 0.5);
  }

  /**
   * The pet button on a treasure chest: the lid comes up and a random treasure
   * tumbles out (see core/treasure.ts). The chest keeps its open look, so
   * nobody shakes the same chest for a second pile of gold.
   */
  private openChest(lp: LocalPlayer, hit: RayHit): void {
    const { x, y, z } = hit;
    if (this.world.get(x, y, z) !== CHEST) {
      // lid already up: the treasure is this chest's only treasure
      this.audio.uiBack();
      this.particles.burst(x + 0.5, y + 0.9, z + 0.5, 0xcbb8a5, 5, 0.5);
      this.ui.toast(EMPTY_CHEST_MESSAGE, 2600);
      return;
    }
    this.world.set(x, y, z, CHEST_OPEN);
    const treasure = rollTreasure();
    this.grantTreasure(lp, treasure, x, y, z);
    this.audio.collect();
    this.audio.sparkle();
    this.particles.burst(x + 0.5, y + 1.05, z + 0.5, 0xffd24a, 24, 1.5);
    this.ui.toast(`${treasure.icon} ${treasure.message}`, 3200);
  }

  /** what each treasure does to the world — there is no inventory, so the prize happens here */
  private grantTreasure(lp: LocalPlayer, t: Treasure, x: number, y: number, z: number): void {
    switch (t.id) {
      case 'stars':
      case 'gem':
        lp.entity.starsCount += t.amount ?? 1;
        break;
      case 'starburst':
        for (let k = 0; k < 3; k++) {
          const a = k * (Math.PI * 2 / 3);
          this.starField.spawnAt(
            x + 0.5 + Math.cos(a) * 0.7, y + 1.9 + k * 0.45, z + 0.5 + Math.sin(a) * 0.7,
          );
        }
        break;
      case 'zoom':
        lp.entity.zoomTime = BOOST_SECONDS;
        break;
      case 'boing':
        lp.entity.boingTime = BOOST_SECONDS;
        break;
      case 'animal': {
        const kind = ANIMAL_KINDS[Math.floor(Math.random() * ANIMAL_KINDS.length)];
        const friend = this.animals.spawn(kind, x + 0.5, y + 1, z + 0.5);
        friend.pet();
        this.audio.animal(kind);
        break;
      }
    }
  }

  /** plant one, look away, look back: a tree */
  private growSaplings(): void {
    for (const [i, planted] of [...this.saplings]) {
      const [x, y, z] = unidx(i);
      if (this.world.get(x, y, z) !== SAPLING) {
        this.saplings.delete(i); // broken, blasted or built over — forget it
        continue;
      }
      if (this.time - planted < this.saplingGrowSeconds) continue;
      // needs a clear trunk path up, so it never punches through a roof
      let room = true;
      for (let k = 1; k <= 7 && y + k < WORLD_SY; k++) {
        if (this.world.get(x, y + k, z) !== 0) { room = false; break; }
      }
      if (!room) {
        this.saplings.set(i, this.time); // wait for the roof to go, then try again
        continue;
      }
      this.saplings.delete(i);
      plantTree(this.world, x, y, z, (this.seed ^ i) & 0x7fffffff, true);
      this.audio.sparkle();
      this.particles.burst(x + 0.5, y + 2, z + 0.5, 0x8ade68, 16, 1.2);
      this.ui.toast('A sapling grew into a tree! 🌳');
    }
  }

  private hooks() {
    return {
      events: this.stepEvents,
      tryPlace: (lp: LocalPlayer, hit: RayHit): boolean => {
        const { px, py, pz } = hit;
        if (!this.world.inBounds(px, py, pz)) return false;
        if (py <= 0) return false;
        const id = lp.selected;
        // A door is TWO blocks high and you always build it from its bottom
        // half: the upper half comes with it, so the cell above has to be free.
        if (isDoorTopBlock(id)) return false;
        const door = id === DOOR;
        if (door) {
          const above = this.world.get(px, py + 1, pz);
          if (!this.world.inBounds(px, py + 1, pz) || isSolidBlock(above) || above === WATER) {
            this.particles.burst(px + 0.5, py + 0.5, pz + 0.5, 0xff5d5d, 4, 0.4);
            return false;
          }
        }
        const cells: [number, number, number][] =
          door ? [[px, py, pz], [px, py + 1, pz]] : [[px, py, pz]];
        const footprints = cells.map(([cx, cy, cz]) => blockAabb(cx, cy, cz));
        // never trap a player
        for (const other of this.players) {
          if (!isSolidBlock(id)) continue;
          const pb = playerAabb(other.entity.pos.x, other.entity.pos.y, other.entity.pos.z);
          if (footprints.some((b) => boxesOverlap(pb, b))) {
            this.particles.burst(px + 0.5, py + 0.5, pz + 0.5, 0xff5d5d, 4, 0.4);
            return false;
          }
        }
        if (isSolidBlock(id)) {
          for (const a of this.animals.animals) {
            const ab = blockAabb(a.pos.x - 0.3, a.pos.y, a.pos.z - 0.3);
            ab.w = ab.d = 0.6; ab.h = 0.8;
            if (footprints.some((b) => boxesOverlap(ab, b))) return false;
          }
        }
        const toSet: [number, number, number, number][] =
          door ? [[px, py, pz, DOOR], [px, py + 1, pz, DOOR_TOP]] : [[px, py, pz, id]];
        const facing = door ? this.doorFacingFromAim(lp, hit) : 0;
        const stairs = id === STAIRS;
        const stairFacing = stairs ? this.stairFacingFromAim(lp, hit) : 0;
        for (const [cx, cy, cz, cid] of toSet) {
          this.world.set(cx, cy, cz, cid);
          const i = worldIdx(cx, cy, cz);
          if (door) this.world.doorFacing.set(i, facing);
          // a stair remembers which way it points; anything built over one forgets it
          if (stairs) this.world.stairFacing.set(i, stairFacing);
          else this.world.stairFacing.delete(i);
          if (blockDef(cid).sparkle) this.sparkleBlocks.add(i);
        }
        this.audio.place();
        const def = blockDef(id);
        this.particles.burst(px + 0.5, py + 0.5, pz + 0.5, new THREE.Color(def.color[0], def.color[1], def.color[2]), 7, 0.7);
        if (id === SAPLING) this.saplings.set(worldIdx(px, py, pz), this.time);
        if (def.explosive) {
          // dynamite lights the moment it is set down: grab a stick, run, boom
          this.dynamite.light(px, py, pz);
          this.ui.toast('Dynamite is lit — run clear! 🧨', 1700);
        }
        return true;
      },
      tryRemove: (lp: LocalPlayer, hit: RayHit): void => {
        const def = blockDef(hit.block);
        if (isExplosiveBlock(hit.block)) {
          // hitting dynamite never takes it off: you light the stub and it pops
          this.dynamite.light(hit.x, hit.y, hit.z, 0.35);
          this.audio.dynamiteStrike();
          this.particles.burst(hit.x + 0.5, hit.y + 1.1, hit.z + 0.5, 0xffd24a, 7, 0.9);
          return;
        }
        // bedrock, water and anything below y=0 are off limits for the break button
        if (def.unbreakable || hit.block === ROCK || hit.block === WATER || hit.y <= 0) {
          this.particles.burst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 0xff5d5d, 4, 0.4);
          return;
        }
        // a door is one thing in two cells: breaking either half takes the whole
        // door (a lone half from an old one-block save breaks on its own)
        const cells: [number, number][] = [];
        if (isDoorBlock(hit.block)) {
          const yBottom = isDoorTopBlock(hit.block) ? hit.y - 1 : hit.y;
          const bottom = this.world.get(hit.x, yBottom, hit.z);
          const top = this.world.get(hit.x, yBottom + 1, hit.z);
          if (isDoorBlock(bottom) && !isDoorTopBlock(bottom)) cells.push([yBottom, bottom]);
          if (isDoorTopBlock(top)) cells.push([yBottom + 1, top]);
          if (cells.length === 0) cells.push([hit.y, hit.block]);
        } else {
          cells.push([hit.y, hit.block]);
        }
        for (const [y, b] of cells) {
          this.world.set(hit.x, y, hit.z, 0);
          const i = worldIdx(hit.x, y, hit.z);
          this.world.doorFacing.delete(i);
          this.world.stairFacing.delete(i);
          this.sparkleBlocks.delete(i);
          this.saplings.delete(i);
          const c = blockDef(b).color;
          this.particles.burst(hit.x + 0.5, y + 0.5, hit.z + 0.5, new THREE.Color(c[0], c[1], c[2]), 9, 0.9);
        }
        this.audio.remove();
        void lp;
      },
      interact: (lp: LocalPlayer): void => {
        // doors and chests come first: the pet button is the family's "do
        // something nice" button, and a door or a treasure chest straight ahead
        // is more pressing than an animal. Aimed at a step, it spins it around.
        const aim = lp.removeTarget;
        if (aim && isDoorBlock(aim.block) && aim.dist <= 4.5) {
          this.toggleDoor(lp, aim);
          return;
        }
        if (aim && isChestBlock(aim.block) && aim.dist <= 4.5) {
          this.openChest(lp, aim);
          return;
        }
        if (aim && isStairsBlock(aim.block) && aim.dist <= 4.5) {
          this.rotateStairs(aim);
          return;
        }
        this.animals.petNearest(lp.entity.pos.x, lp.entity.pos.y + 0.8, lp.entity.pos.z, 2.4);
      },
    };
  }

  // ------------------------------------------------------------- explosions

  /**
   * A stick went off: knock the players about (nobody gets hurt — it is a
   * cartoon launch), send the animals tumbling, punch the screen and tidy up
   * bookkeeping for blocks that no longer exist.
   */
  private onBlast(b: BlastInfo): void {
    for (const i of b.removed) {
      this.sparkleBlocks.delete(i);
      this.saplings.delete(i);
      this.world.doorFacing.delete(i);
      this.world.stairFacing.delete(i);
      // a blast that ate the bottom half of a door would leave the upper half
      // hanging in the air, so bring it down too
      const [x, y, z] = unidx(i);
      if (y + 1 < WORLD_SY && isDoorTopBlock(this.world.get(x, y + 1, z))) {
        this.world.set(x, y + 1, z, 0);
        this.world.doorFacing.delete(worldIdx(x, y + 1, z));
      }
    }

    const cx = b.x + 0.5, cy = b.y + 0.5, cz = b.z + 0.5;
    const range = b.radius * 2.4;
    const launched = this.animals.blastAway(cx, cy, cz, b.radius);

    for (const p of this.players) {
      const e = p.entity;
      const dx = e.pos.x - cx, dy = e.pos.y + 0.9 - cy, dz = e.pos.z - cz;
      const d = Math.hypot(dx, dy, dz);
      if (d < range) {
        const power = 1 - d / range;
        const len = Math.max(0.5, d);
        e.vel.x += (dx / len) * 9 * power;
        e.vel.z += (dz / len) * 9 * power;
        e.vel.y = Math.max(e.vel.y, 4.5 + 7.5 * power);
        e.grounded = false;
        p.shake(0.5 + power * 0.7, 1);
        this.particles.burst(e.pos.x, e.pos.y + 1.1, e.pos.z, 0xffd24a, 6, 0.9);
      } else {
        p.shake(0.28, Math.max(0.1, 0.6 - (d - range) * 0.02)); // distant thump
      }
    }

    this.ui.flash(0.3 + (b.radius - 3) * 0.12);
    if (launched === 1) this.ui.toast('One animal went flying! It is fine 🐑', 2200);
    else if (launched > 1) this.ui.toast(`${launched} animals went flying! All fine 🐑`, 2200);
  }

  // ------------------------------------------------------------ persistence

  // -------------------------------------------------------- global settings
  // The few grown-up settings that belong to the whole browser (split-screen
  // layout, sound on/off) keep their own little localStorage key, so a
  // family's tablet stays the way they left it.
  //
  // Every browser storage key keeps the `lbw-` prefix from the game's first
  // name (Little Block World). The game is Elocraft now, but renaming the keys
  // would orphan every world and setting the family already has, so the old
  // prefix stays where nobody sees it.

  private settingsKey = 'lbw-settings';

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(this.settingsKey);
      if (!raw) return;
      const s = JSON.parse(raw) as { layout?: string; muted?: boolean };
      if (s.layout === 'auto' || s.layout === 'horizontal' || s.layout === 'vertical' || s.layout === 'grid2x2') {
        this.layout = s.layout;
      }
      if (typeof s.muted === 'boolean') this.audio.muted = s.muted;
    } catch { /* corrupted settings: defaults win */ }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(this.settingsKey, JSON.stringify({ layout: this.layout, muted: this.audio.muted }));
    } catch { /* storage unavailable */ }
  }

  // ---------------------------------------------------------- GH Pages build
  // When the game is hosted statically (no local server), the API does not
  // exist: we detect that once and keep all saves in the browser (localStorage)
  // so the game stays fully playable.

  private serverBacked = true;

  private api(path: string): string {
    // relative: works at '/' in dev and under '/Simplecraft/' on GH Pages
    return `api/${path}`;
  }

  /** one save per (seed, theme) world, in browser storage */
  private storageKey(seed = this.seed, theme = this.theme): string {
    return `lbw-world-${seed}-${theme}`;
  }

  /**
   * A small browser-side index of every world this machine has saved.
   * It powers the My Worlds list when there is no server (GH Pages) and
   * remembers worlds saved while the server was briefly away.
   */
  private worldIndexKey = 'lbw-world-index';

  private readWorldIndex(): Map<string, SavedWorldInfo> {
    try {
      const raw = localStorage.getItem(this.worldIndexKey);
      if (!raw) return new Map();
      const obj = JSON.parse(raw) as Record<string, SavedWorldInfo>;
      return new Map(Object.entries(obj));
    } catch {
      return new Map(); // corrupted index: start fresh
    }
  }

  private writeWorldIndex(idx: Map<string, SavedWorldInfo>): void {
    try {
      localStorage.setItem(this.worldIndexKey, JSON.stringify(Object.fromEntries(idx)));
    } catch { /* storage unavailable */ }
  }

  private updateWorldIndex(save: WorldSaveData): void {
    const idx = this.readWorldIndex();
    idx.set(`${save.seed}-${save.theme ?? 0}`, {
      seed: save.seed,
      theme: save.theme ?? 0,
      savedAt: save.savedAt ?? Date.now(),
      mods: Object.keys(save.mods).length,
    });
    // keep it a family-sized list: a dozen most-recent worlds
    const stale = [...idx.entries()]
      .sort((a, b) => (b[1].savedAt ?? 0) - (a[1].savedAt ?? 0))
      .slice(12);
    for (const [k] of stale) idx.delete(k);
    this.writeWorldIndex(idx);
  }

  private dropFromWorldIndex(seed: number, theme: number): void {
    const idx = this.readWorldIndex();
    idx.delete(`${seed}-${theme}`);
    this.writeWorldIndex(idx);
  }

  private async loadSave(): Promise<WorldSaveData | null> {
    try {
      const r = await fetch(this.api(`world?seed=${this.seed}&theme=${this.theme}`));
      const data = r.ok ? (await r.json()) as WorldSaveData | null : null;
      if (data && data.mods) return data;
      if (!r.ok) throw new Error(String(r.status));
      return null;
    } catch {
      this.serverBacked = false; // static hosting or server down: browser-only mode
      const cached = localStorage.getItem(this.storageKey());
      if (cached) {
        try { return JSON.parse(cached) as WorldSaveData; } catch { /* corrupted cache */ }
      }
      return null;
    }
  }

  /** every saved world, most recently played first: server list + offline finds */
  async fetchWorldList(): Promise<SavedWorldInfo[]> {
    if (this.serverBacked) {
      try {
        const r = await fetch(this.api('world/list'));
        if (r.ok) {
          const list = (await r.json()) as SavedWorldInfo[];
          if (Array.isArray(list)) {
            const seen = new Set(list.map((w) => `${w.seed}-${w.theme ?? 0}`));
            for (const [key, w] of this.readWorldIndex()) {
              if (!seen.has(key)) list.push(w); // saved while offline: still real
            }
            return list.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
          }
        } else {
          this.serverBacked = false;
        }
      } catch {
        this.serverBacked = false; // server went away: the browser keeps its own list
      }
    }
    return [...this.readWorldIndex().values()]
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 1500);
  }

  async saveNow(): Promise<void> {
    const save = this.world.toSave();
    save.savedAt = Date.now();
    this.updateWorldIndex(save);
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(save));
    } catch { /* storage full/unavailable */ }
    if (!this.serverBacked) return; // GH Pages / browser-only mode
    try {
      const r = await fetch(this.api('world'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(save),
      });
      if (!r.ok) this.serverBacked = false;
    } catch {
      // server went away: keep the localStorage copy, stop hitting the API
      this.serverBacked = false;
    }
  }

  /**
   * Play an old saved world again: fetch its save (server first, browser
   * cache as fallback) and move the whole game into it. Every player
   * respawns at the world's spawn, so nobody ends up inside a wall.
   */
  async loadSavedWorld(seed: number, theme: number): Promise<void> {
    await this.saveNow(); // belt and braces: keep the world we are leaving safe
    let save: WorldSaveData | null = null;
    if (this.serverBacked) {
      try {
        const r = await fetch(this.api(`world?seed=${seed}&theme=${theme}`));
        if (r.ok) save = (await r.json()) as WorldSaveData | null;
        else this.serverBacked = false;
      } catch {
        this.serverBacked = false;
      }
    }
    if (!save) {
      const cached = localStorage.getItem(this.storageKey(seed, theme));
      if (cached) {
        try { save = JSON.parse(cached) as WorldSaveData; } catch { /* corrupted cache */ }
      }
    }
    this.applyNewWorld(seed, theme, save);
    this.ui.toast(`${themeOf(theme).icon} Back in ${themeOf(theme).name} world — seed ${seed}!`);
  }

  /** wipe one saved world: server file, browser cache and the index entry */
  async deleteWorld(seed: number, theme: number): Promise<void> {
    if (this.serverBacked) {
      try {
        const r = await fetch(this.api(`world/reset?seed=${seed}&theme=${theme}`), { method: 'POST' });
        if (!r.ok) this.serverBacked = false;
      } catch {
        this.serverBacked = false;
      }
    }
    localStorage.removeItem(this.storageKey(seed, theme));
    this.dropFromWorldIndex(seed, theme);
  }

  /** fresh terrain for a (new) seed+theme, reusing the same World object so
   *  players/chunks keep valid references. A save can ride along: it lands
   *  on top of the generated terrain, exactly like at boot. */
  applyNewWorld(seed: number, theme: number, restore?: WorldSaveData | null): void {
    this.seed = seed;
    this.theme = theme;
    this.world.resetFor(seed, theme);
    const gen = generateTerrain(this.world, themeOf(theme));
    if (restore) this.world.applySave(restore);
    this.spawnPoint.set(gen.spawnX, gen.spawnY, gen.spawnZ);
    this.chunks.rebuildAll();
    // rebuild stars & animals against the new world
    this.starField.stars.forEach((s) => { s.mesh.removeFromParent(); s.glow.removeFromParent(); });
    this.starField = new StarField(this.scene, this.world, gen.spawnX, gen.spawnZ);
    this.animals.animals.forEach((a) => a.group.removeFromParent());
    this.animals = new AnimalWorld(this.scene, this.world, this.particles, this.audio, gen.spawnX, gen.spawnZ);
    this.sparkleBlocks.clear();
    this.saplings.clear();
    this.dynamite.clear(); // no half-burnt sticks from the old world, please
    // living things and lit fuses that came with a save wake up, same as at boot
    for (const [i, b] of this.world.mods) {
      if (blockDef(b).sparkle) this.sparkleBlocks.add(i);
      if (b === SAPLING) this.saplings.set(i, -this.saplingGrowSeconds + 10);
    }
    this.dynamite.restoreFromWorld();
    for (const p of this.players) p.respawnAt(this.spawnPoint.clone());
    this.lastRevision = this.world.revision;
    void this.saveNow(); // remember the (possibly just restored) world
  }

  async resetWorld(): Promise<void> {
    try {
      await fetch(this.api(`world/reset?seed=${this.seed}&theme=${this.theme}`), { method: 'POST' });
    } catch { /* ignore */ }
    localStorage.removeItem(this.storageKey());
    this.dropFromWorldIndex(this.seed, this.theme);
    this.applyNewWorld(this.seed, this.theme);
    this.ui.toast('Fresh new world! 🌍');
  }

  // ------------------------------------------------------------ loop

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    const n = this.players.length + this.pendingJoins.size;
    this.viewportMgr.resize(w, h, Math.max(1, n), this.layout);
    // panes follow the viewport count exactly, so a freed half really disappears
    this.ui.ensurePanes(Math.max(1, n));
    this.ui.trimPanes(Math.max(1, n));
    for (let i = 0; i < this.ui.paneCount; i++) {
      const r = this.viewportMgr.rects[Math.min(i, this.viewportMgr.rects.length - 1)];
      this.ui.setPaneRect(i, r);
    }
    this.rebuildHuds();
  }

  private rebuildHuds(): void {
    for (let i = 0; i < Math.max(this.players.length, this.ui.paneCount); i++) {
      this.ui.detachHud(i);
    }
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      this.ui.attachHud(i, new Hud(p, this.typeOf(p)));
    }
  }

  /**
   * Per-view avatar visibility via three.js layers: every player's body lives
   * on its own layer, which every camera enables EXCEPT the body owner's, and
   * the owner's camera enables it only while their body should be visible to
   * them (third person, camera not hugging them). Before this, first person
   * hid the avatar scene-wide — the other kids' screens lost that player
   * entirely, ring and shadow included. Ring + shadow stay on layer 0, so
   * everyone always finds themselves on the map.
   */
  private applyAvatarLayers(cameras: THREE.Camera[]): void {
    const players = this.players;
    for (let i = 0; i < players.length; i++) {
      players[i].entity.avatar.body.traverse((o) => o.layers.set(1 + i));
    }
    for (const cam of cameras) {
      cam.layers.set(0);
      for (let i = 0; i < players.length; i++) cam.layers.enable(1 + i);
    }
    for (let i = 0; i < players.length; i++) {
      if (!players[i].showOwnBody) players[i].camera.layers.disable(1 + i);
    }
  }

  private loop = (now: number): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - (this.lastNow ?? now)) / 1000);
    this.lastNow = now;
    this.time += dt;

    this.input.update();
    this.routeInput(dt);

    if (!this.frozen) {
      this.animals.update(dt);
      this.starField.update(this.time);
      this.dynamite.update(dt);
      this.growSaplings();

      // ambient sparkles from placed sparkle blocks
      if (Math.random() < dt * 3) {
        const arr = [...this.sparkleBlocks];
        if (arr.length) {
          const i = arr[Math.floor(Math.random() * arr.length)];
          const y = i % WORLD_SY;
          const xz = Math.floor(i / WORLD_SY);
          const x = Math.floor(xz / WORLD_SZ), z = xz % WORLD_SZ;
          this.particles.spawn(x + 0.2 + Math.random() * 0.6, y + 1.0, z + 0.2 + Math.random() * 0.6, 0xcfefff, {
            vy: 1.2, ttl: 1.1, gravity: -1.5, size: 0.09,
          });
        }
      }
      this.particles.update(dt);
      this.skyEnv.update(dt);
    }

    this.chunks.update(4);

    if (!this.frozen && this.players.length > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) {
        this.hintTimer = 100 + Math.random() * 80;
        const hint = Game.HINTS[Math.floor(Math.random() * Game.HINTS.length)];
        this.ui.toast(hint, 4200);
      }
    }

    // cameras for render
    const cameras: THREE.Camera[] = [];
    for (const p of this.players) cameras.push(p.camera);
    for (const pj of this.pendingJoins.values()) {
      pj.angle += dt * 0.15;
      const r = 16;
      pj.camera.position.set(
        this.spawnPoint.x + Math.cos(pj.angle) * r,
        this.spawnPoint.y + 7,
        this.spawnPoint.z + Math.sin(pj.angle) * r,
      );
      pj.camera.lookAt(this.spawnPoint);
      cameras.push(pj.camera);
    }
    if (cameras.length === 0) {
      // nobody joined yet: drift over the world so the welcome screen and the
      // world picker have a live view of the world behind them
      this.idleAngle += dt * 0.05;
      const r = 42;
      this.idleCamera.position.set(
        this.spawnPoint.x + Math.cos(this.idleAngle) * r,
        this.spawnPoint.y + 24,
        this.spawnPoint.z + Math.sin(this.idleAngle) * r,
      );
      this.idleCamera.lookAt(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z);
      cameras.push(this.idleCamera);
    }
    this.applyAvatarLayers(cameras);
    this.viewportMgr.render(this.renderer, this.scene, cameras);

    // HUD updates
    for (let i = 0; i < this.players.length; i++) {
      const hud = this.ui.getHud(i);
      if (hud) hud.update(this.players[i]);
    }

    if (this.world.revision !== this.lastRevision) {
      this.lastRevision = this.world.revision;
      this.scheduleSave();
    }
  };

  private lastNow = 0;

  private hintTimer = 25;
  private static readonly HINTS = [
    '🏠 Build a house!',
    '🌉 Build a bridge!',
    '🌷 Plant a garden!',
    '🗼 Build a tall tower!',
    '🐑 Make a home for an animal!',
    '⭐ Find a glowing star!',
    '🗝️ Find a treasure chest!',
    '🪜 Build a staircase!',
    '🍬 Land on a bouncy block!',
    '🎵 Step on a music block!',
  ];

  dispose(): void {
    cancelAnimationFrame(this.rafId);
  }

  // --------------------------------------------------- test helpers

  addVirtualPad(type: 'xbox' | 'playstation' | 'generic' = 'generic'): VirtualPadSource {
    return this.input.createVirtualPad(type);
  }
}
