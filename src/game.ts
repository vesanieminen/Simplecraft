/**
 * Game bootstrap and the main loop. Ties together: world, renderer,
 * split-screen viewports, local players + controller routing, UI
 * overlays, animals, stars, particles, audio and persistence.
 */

import * as THREE from 'three';
import { AudioKit } from './core/audio';
import { AnimalWorld } from './core/animals';
import { blockDef, isSolidBlock, ROCK } from './core/blocks';
import { StarField } from './core/collectibles';
import { ParticleSystem } from './core/particles';
import { RayHit } from './core/raycast';
import { blockAabb, boxesOverlap, playerAabb } from './core/physics';
import { DEFAULT_SEED, generateTerrain } from './core/terrain';
import { idx as worldIdx, World, WorldSaveData, WORLD_SY, WORLD_SZ } from './core/world';
import { InputManager } from './input/inputManager';
import { KeyboardSource } from './input/keyboard';
import { InputSource, FrameControls, emptyFrame } from './input/types';
import { VirtualPadSource } from './input/virtual';
import { LocalPlayer } from './players/localPlayer';
import { PlayerEntity } from './players/playerEntity';
import { AVATAR_COLORS, NICKNAMES } from './players/avatar';
import { ChunkMeshManager } from './render/chunkMeshes';
import { createSky, SkyEnv } from './render/sky';
import { SplitLayout, ViewportManager } from './render/viewportManager';
import { Hud } from './ui/hud';
import {
  GrownUpsMenu, HelpOverlay, JoinCard, Overlay, PaletteOverlay, PlayerMenu, ReconnectOverlay,
} from './ui/overlays';
import { UiManager } from './ui/uiManager';

const MAX_PLAYERS = 4;

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

  private spawnPoint = new THREE.Vector3(32, 12, 32);
  private overlays = new Map<number, Overlay>(); // playerId -> overlay
  private sourceToPlayer = new Map<string, LocalPlayer>();
  private lastRevision = 0;
  private saveTimer: number | undefined;
  private skyEnv!: SkyEnv;
  private time = 0;
  private sparkleBlocks = new Set<number>();
  private lastLandSound = new Map<number, number>();
  private stepEvents = {
    landed: false, bounced: null as number | null,
    steppedOnMusic: null as null | { note: number; x: number; y: number; z: number },
    steppedOnSparkle: false, splashed: false,
  };
  private rafId = 0;

  async init(): Promise<void> {
    // ---- world ----
    const params = new URLSearchParams(location.search);
    const seed = Number(params.get('seed')) || DEFAULT_SEED;
    this.world = new World(seed);
    const save = await this.loadSave();
    const gen = generateTerrain(this.world);
    if (save && save.seed === seed) this.world.applySave(save);
    this.spawnPoint.set(gen.spawnX, gen.spawnY, gen.spawnZ);

    // ---- renderer & scene ----
    const canvas = document.getElementById('gl') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.scene = new THREE.Scene();
    this.chunks = new ChunkMeshManager(this.scene, this.world);
    this.chunks.rebuildAll();
    this.skyEnv = createSky(this.scene);
    this.particles = new ParticleSystem(this.scene);

    // sparkle blocks placed by players emit drifting sparkles
    for (const [i, b] of this.world.mods) if (blockDef(b).sparkle) this.sparkleBlocks.add(i);

    this.animals = new AnimalWorld(this.scene, this.world, this.particles, this.audio, gen.spawnX, gen.spawnZ);
    this.starField = new StarField(this.scene, this.world, gen.spawnX, gen.spawnZ);

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
    const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 400);
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
    for (const [sid, pj] of this.pendingJoins) {
      const frame = this.input.frame(sid);
      pj.card.tick(frame, dt);
      if (pj.card.closed) this.pendingJoins.delete(sid);
    }

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const sid = this.sourceIdOf(p);
      const frame = sid ? this.input.frame(sid) : emptyFrame();
      const overlay = this.overlays.get(p.entity.id);
      if (overlay) {
        overlay.tick(frame, dt);
        if (overlay.closed) this.overlays.delete(p.entity.id);
        p.update(dt, emptyFrame(), this.hooks(), true);
      } else {
        if (frame.pressed.has('menu')) {
          this.openMenu(p);
          p.update(dt, emptyFrame(), this.hooks(), true);
        } else if (frame.pressed.has('palette')) {
          this.openPalette(p);
          p.update(dt, emptyFrame(), this.hooks(), true);
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

    // unassigned sources (join detection)
    for (const s of this.input.sources.values()) {
      if (this.sourceToPlayer.has(s.id) || this.pendingJoins.has(s.id)) continue;
      const reserved = [...this.reservedSeats.values()].some((r) => r.sourceId === s.id);
      if (reserved) continue; // handled on reconnect event
      this.handleUnassignedInput(s, this.input.frame(s.id));
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
    ev.landed = false;
    ev.bounced = null;
    ev.steppedOnMusic = null;
    ev.steppedOnSparkle = false;
    ev.splashed = false;
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
        toggleSound: () => { this.audio.setMuted(!this.audio.muted); },
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
              const order: SplitLayout[] = ['auto', 'horizontal', 'vertical'];
              this.layout = order[(order.indexOf(this.layout) + 1) % order.length];
              this.resize();
              return this.layout === 'auto' ? 'Smart' : this.layout === 'horizontal' ? 'Left/Right' : 'Up/Down';
            },
            resetWorld: () => void this.resetWorld(),
            frozen: () => this.frozen,
            layout: () => (this.layout === 'auto' ? 'Smart' : this.layout === 'horizontal' ? 'Left/Right' : 'Up/Down'),
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

  private openPalette(p: LocalPlayer): void {
    const idx = this.players.indexOf(p);
    this.ui.clearOverlays(idx);
    const pal = new PaletteOverlay(this.audio, this.typeOf(p), p, (b) => p.setSelected(b));
    this.overlays.set(p.entity.id, pal);
    this.ui.addOverlay(idx, pal);
  }

  private typeOf(p: LocalPlayer): 'xbox' | 'playstation' | 'generic' | 'keyboard' {
    const s = this.input.sources.get(this.sourceIdOf(p));
    return s?.controllerType ?? 'generic';
  }

  private removePlayer(p: LocalPlayer): void {
    const idx = this.players.indexOf(p);
    if (idx >= 0) {
      this.ui.clearOverlays(idx);
      this.ui.detachHud(idx);
      const sid = this.sourceIdOf(p);
      this.sourceToPlayer.delete(sid);
      this.overlays.delete(p.entity.id);
      p.dispose(this.scene);
      p.entity.dispose();
      this.players.splice(idx, 1);
      this.rebuildHuds();
      this.resize();
      this.ui.toast(`${p.entity.name} left`);
    }
  }

  // ------------------------------------------------------------ building

  private hooks() {
    return {
      events: this.stepEvents,
      tryPlace: (lp: LocalPlayer, hit: RayHit): boolean => {
        const { px, py, pz } = hit;
        if (!this.world.inBounds(px, py, pz)) return false;
        if (py <= 0) return false;
        const id = lp.selected;
        const b = blockAabb(px, py, pz);
        // never trap a player
        for (const other of this.players) {
          if (isSolidBlock(id) && boxesOverlap(playerAabb(other.entity.pos.x, other.entity.pos.y, other.entity.pos.z), b)) {
            this.particles.burst(px + 0.5, py + 0.5, pz + 0.5, 0xff5d5d, 4, 0.4);
            return false;
          }
        }
        if (isSolidBlock(id)) {
          for (const a of this.animals.animals) {
            const ab = blockAabb(a.pos.x - 0.3, a.pos.y, a.pos.z - 0.3);
            ab.w = ab.d = 0.6; ab.h = 0.8;
            if (boxesOverlap(ab, b)) return false;
          }
        }
        this.world.set(px, py, pz, id);
        this.audio.place();
        const def = blockDef(id);
        this.particles.burst(px + 0.5, py + 0.5, pz + 0.5, new THREE.Color(def.color[0], def.color[1], def.color[2]), 7, 0.7);
        if (def.sparkle) this.sparkleBlocks.add(worldIdx(px, py, pz));
        return true;
      },
      tryRemove: (lp: LocalPlayer, hit: RayHit): void => {
        const def = blockDef(hit.block);
        if (def.unbreakable || hit.block === ROCK || hit.y <= 0) {
          this.particles.burst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 0xff5d5d, 4, 0.4);
          return;
        }
        this.world.set(hit.x, hit.y, hit.z, 0);
        this.audio.remove();
        this.particles.burst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, new THREE.Color(def.color[0], def.color[1], def.color[2]), 9, 0.9);
        this.sparkleBlocks.delete((hit.x * 64 + hit.z) * WORLD_SY + hit.y);
        void lp;
      },
      interact: (lp: LocalPlayer): void => {
        this.animals.petNearest(lp.entity.pos.x, lp.entity.pos.y + 0.8, lp.entity.pos.z, 2.4);
      },
    };
  }

  // ------------------------------------------------------------ persistence

  private async loadSave(): Promise<WorldSaveData | null> {
    try {
      const r = await fetch('/api/world');
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as WorldSaveData | null;
      if (data && data.mods) return data;
      return null;
    } catch {
      const cached = localStorage.getItem('lbw-world');
      if (cached) {
        try { return JSON.parse(cached) as WorldSaveData; } catch { /* corrupted cache */ }
      }
      return null;
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 1500);
  }

  async saveNow(): Promise<void> {
    const save = this.world.toSave();
    try {
      localStorage.setItem('lbw-world', JSON.stringify(save));
      await fetch('/api/world', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(save),
      });
    } catch {
      // offline: keep the localStorage copy
    }
  }

  async resetWorld(): Promise<void> {
    try {
      await fetch('/api/world/reset', { method: 'POST' });
    } catch { /* ignore */ }
    localStorage.removeItem('lbw-world');
    const seed = this.world.seed;
    this.chunks.dispose();
    this.world = new World(seed);
    generateTerrain(this.world);
    this.chunks = new ChunkMeshManager(this.scene, this.world);
    this.chunks.rebuildAll();
    // rebuild stars & animals against the new world
    this.starField.stars.forEach((s) => { s.mesh.removeFromParent(); s.glow.removeFromParent(); });
    this.starField = new StarField(this.scene, this.world, this.spawnPoint.x, this.spawnPoint.z);
    this.animals.animals.forEach((a) => a.group.removeFromParent());
    this.animals = new AnimalWorld(this.scene, this.world, this.particles, this.audio, this.spawnPoint.x, this.spawnPoint.z);
    this.sparkleBlocks.clear();
    for (const p of this.players) p.respawnAt(this.spawnPoint.clone());
    this.ui.toast('Fresh new world! 🌍');
  }

  // ------------------------------------------------------------ loop

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    const n = this.players.length + this.pendingJoins.size;
    this.viewportMgr.resize(w, h, Math.max(1, n), this.layout);
    this.ui.ensurePanes(Math.max(this.players.length, n));
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

  dispose(): void {
    cancelAnimationFrame(this.rafId);
  }

  // --------------------------------------------------- test helpers

  addVirtualPad(type: 'xbox' | 'playstation' | 'generic' = 'generic'): VirtualPadSource {
    return this.input.createVirtualPad(type);
  }
}
