/**
 * Game bootstrap and the main loop. Ties together: world, renderer,
 * split-screen viewports, local players + controller routing, UI
 * overlays, animals, stars, particles, audio and persistence.
 */

import * as THREE from 'three';
import { AudioKit } from './core/audio';
import { AnimalWorld, ANIMAL_KINDS } from './core/animals';
import {
  blockDef, CHEST, CHEST_OPEN, DOOR, DOOR_OPEN, DOOR_TOP, DOOR_TOP_OPEN, isBucket, isChestBlock,
  isDoorBlock, isDoorTopBlock, isExplosiveBlock, isLadderBlock, isSolidBlock, isStairsBlock, isWaterId, paletteFor,
  LadderFacing, LADDER, ROCK, rotateStairFacing, SAPLING, soundFamilyOf, StairFacing, STAIRS, TORCH, WATER,
} from './core/blocks';
import { pourableAt, useBucket } from './core/bucket';
import { WeatherClock, WeatherKind, WeatherMode } from './core/weather';
import { DayMode } from './render/sky';
import { StarField } from './core/collectibles';
import { BlastInfo, DynamiteManager } from './core/dynamite';
import { FISH_DEFS, FishKind, FishWorld, pickFishKind } from './core/fish';
import { Angler, FishingManager, ROD_LAYER } from './core/fishing';
import { ParticleSystem } from './core/particles';
import { SandGravity } from './core/sand';
import { FISH_SNACKS } from './core/satchel';
import { WaterFlow } from './core/water';
import { RayHit } from './core/raycast';
import { Aabb, aabbOverlapsSolid, blockAabb, boxesOverlap, doorPanelAabb, playerAabb } from './core/physics';
import { DEFAULT_SEED, generateTerrain, plantTree, themeOf, WORLD_THEMES } from './core/terrain';
import { BOOST_SECONDS, EMPTY_CHEST_MESSAGE, rollTreasure, Treasure } from './core/treasure';
import { idx as worldIdx, SavedWorldInfo, World, WorldSaveData, WORLD_SX, WORLD_SY, WORLD_SZ } from './core/world';
import { InputManager } from './input/inputManager';
import { KeyboardSource } from './input/keyboard';
import { ControllerType, InputSource, FrameControls, emptyFrame } from './input/types';
import { VirtualPadSource } from './input/virtual';
import { LocalPlayer } from './players/localPlayer';
import { PlayerEntity } from './players/playerEntity';
import { AVATAR_COLORS, AVATAR_MODELS, modelDef, NICKNAMES } from './players/avatar';
import { ChunkMeshManager } from './render/chunkMeshes';
import { LightKeeper } from './render/lights';
import { SandFalls } from './render/sandFalls';
import { MAX_WORLD_LIGHTS, SunState } from './render/shaders';
import { createSky, SHADOW_TEXEL, SKY_CLEAR, SKY_FAR, SkyEnv } from './render/sky';
import { SplitLayout, ViewportManager } from './render/viewportManager';
import { Hud } from './ui/hud';
import {
  GrownUpsMenu, HelpOverlay, JoinCard, MyWorldsActions, MyWorldsOverlay, Overlay, PaletteOverlay,
  PlayerMenu, ReconnectOverlay, SatchelOverlay, WorldSelectOverlay,
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
  /** torches, glow blocks, opened treasure and stars publish their light here */
  lights!: LightKeeper;
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
  /**
   * Sky settings (Grown-Up menu): the weather mode a grown-up chose, the
   * day-night mode, and whether kids may place treasure chests. All three
   * live in the saved settings, so the tablet keeps the family's choices.
   */
  weatherMode: WeatherMode = 'auto';
  dayMode: DayMode = 'auto';
  chestsAllowed = true;
  /**
   * The Grown-Ups "Shadows" switch (default ON, persisted). Off = no shadow
   * pass at all and unshadowed materials — the older tablets' escape hatch.
   */
  shadowsEnabled = true;
  /**
   * The Grown-Ups "Lights" switch (default ON, persisted). Off = torches
   * still stand and burn, but no light pools: the night goes back to being
   * lit only by the moon. Cheap escape hatch for the oldest tablets.
   */
  lightsEnabled = true;
  /** Shadow filter quality, auto-set once at boot from the GPU: a real one
   *  gets soft PCF on a 2048² map, software GL crisp single-tap on 1024². */
  shadowQuality: 'soft' | 'fast' = 'soft';
  /** what falls from the sky and how hard — pure, testable (core/weather.ts) */
  readonly weather = new WeatherClock();
  /** which weather the rain hiss carries right now (null = quiet) */
  private rainSound: WeatherKind | null = null;
  /** game time of the last thunder crack, so rumble is rare but not scripted */
  private lastThunder = 0;
  /** game time of the last bucket hint, so fiddling with a bucket never spams */
  private lastBucketHint = -10;
  /** the camera the last frame rendered through — the sky sits on it */
  private renderCam: THREE.Camera | null = null;
  /** the sky's shadow-casting light — the game steers its map redraw (one
   *  per frame, from the donor pane: see pickShadowDonor) */
  private sunLight!: THREE.DirectionalLight;
  /** True when this frame's pane renders should redraw the shadow map. */
  private shadowWantRedraw = false;
  /** voxel-change counter; a new value means the baked map is stale */
  private shadowWorldEpoch = 0;
  private lastShadowWorldEpoch = -1;
  /** mesh-structure changes (chunk remeshes, avatars, animals): same deal */
  private shadowMeshEpoch = 0;
  private lastShadowMeshEpoch = -1;
  /** redraw at least this often (WALL seconds), so the sun drift catches up */
  private static readonly SHADOW_HEARTBEAT = 1.0;
  /** keep baking this long (wall seconds) after the world edits, so chunks
   *  that remesh under the per-frame budget cast shadows as soon as they land */
  private static readonly SHADOW_EDIT_WINDOW = 1.0;
  private shadowHeartbeat = 0;
  private shadowEditUntil = -1;
  private realDt = 0.016;
  private wallNow = 0;
  private lastShadowFocus = new THREE.Vector3(0, 1e3, 0);
  private time = 0;
  private sparkleBlocks = new Set<number>();
  dynamite!: DynamiteManager;
  /** sand obeys gravity: unsupported sand tumbles straight down */
  sand!: SandGravity;
  /** render-only cubes that glide the tumbling sand smoothly down */
  sandFalls!: SandFalls;
  /** water flows: sources push, travelling water spreads, shallows and dries */
  water!: WaterFlow;
  /** the fish that live in the lakes and seas — some travel in flocks (core/fish.ts) */
  fish!: FishWorld;
  /** fishing lines out in the world (core/fishing.ts) */
  fishing!: FishingManager;
  /**
   * Player-planted saplings: flat world index -> game time when planted.
   * After `saplingGrowSeconds` of game time (public so tests can hurry it)
   * they grow into real trees. Saplings restored from a save grow about ten
   * seconds after joining, so a planted forest keeps living between sessions.
   */
  saplings = new Map<number, number>();
  saplingGrowSeconds = 30;
  private lastLandSound = new Map<number, number>();
  private lastFootAt = new Map<number, number>();
  private footAlt = false;
  private lastStroke = new Map<number, number>();
  /** game time of the last "standing in the doorway" toast, so door-spam does not strobe it */
  private lastDoorWarnAt = -10;
  private stepEvents = {
    landed: false, landedOn: 0, bounced: null as number | null,
    steppedOnMusic: null as null | { note: number; x: number; y: number; z: number },
    steppedOnSparkle: false, splashed: false, stroked: false, footfall: false, footfallOn: 0,
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
    // ACES filmic: the whole look leans on it — torch pools roll off warm
    // instead of clipping to white, the sun sets through film colours, and
    // the night keeps its depth. Exposure is the master brightness.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.scene = new THREE.Scene();
    this.chunks = new ChunkMeshManager(this.scene, this.world);
    this.chunks.rebuildAll();
    this.skyEnv = createSky(this.scene, this.chunks.shaders);
    // the saved sky settings (if any) decide what the first frame looks like
    this.skyEnv.setDayMode(this.dayMode);
    if (this.weather.kind) this.skyEnv.setWeather(this.weather.kind, this.weather.intensity);

    // shadows: one sun map (the sky's DirectionalLight owns it). The game
    // redraws it event-driven — only from the donor pane, and only when
    // something that casts a shadow actually moved (see updateShadowFocus).
    // Quality is auto-set from the GPU (see setShadowQuality): a real GPU
    // gets the soft 2048² map, software GL (CI, old tablets) gets crisp
    // single-tap shadows — nine filtered taps per pixel would melt it.
    // updateShadowFocus below just steers the follow box to the players.
    this.sunLight = this.skyEnv.getSunLight();
    this.shadowQuality = Game.detectShadowQuality(this.renderer);
    this.setShadowQuality(this.shadowQuality);
    // Same detector decides the light decode's PROGRAM size: a software
    // rasteriser runs the whole unrolled light chain even when the count is
    // zero, so on CPU renderers the programs only ever decode three lights.
    // Set before the first frame compiles anything — programs stay stable.
    this.chunks.shaders.lightCompileMax =
      this.shadowQuality === 'soft' ? MAX_WORLD_LIGHTS : 3;
    this.applyShadowSettings();
    this.particles = new ParticleSystem(this.scene);

    // sparkle blocks placed by players emit drifting sparkles
    for (const [i, b] of this.world.mods) if (blockDef(b).sparkle) this.sparkleBlocks.add(i);

    // saplings that came back from a save keep growing from the moment you join
    for (const [i, b] of this.world.mods) {
      if (b === SAPLING) this.saplings.set(i, -this.saplingGrowSeconds + 10);
    }

    this.animals = new AnimalWorld(this.scene, this.world, this.particles, this.audio, gen.spawnX, gen.spawnZ);
    this.starField = new StarField(this.scene, this.world, gen.spawnX, gen.spawnZ);
    this.fish = new FishWorld(this.scene, this.world, this.particles);
    this.fishing = new FishingManager(
      this.scene, this.world, this.particles, this.audio, (m, ms) => this.ui.toast(m, ms),
    );
    // the night needs friends: torches, glow blocks and opened treasure feed
    // the shader kit's light uniforms through this keeper (render/lights.ts)
    this.lights = new LightKeeper(this.scene, this.world, this.chunks.shaders);
    this.lights.restoreFromWorld(); // a restored save's torches are already lit

    // dynamite: sticks that came with the save get their fuses back
    this.dynamite = new DynamiteManager(
      this.scene, this.world, this.particles, this.audio, (b) => this.onBlast(b),
    );
    this.dynamite.restoreFromWorld();

    // gravity sand: it hears about every changed cell through the world hook,
    // so digging out under a sand cliff starts the whole column falling
    this.sand = new SandGravity(this.world, {
      blockedAt: (x, y, z) =>
        this.players.some((p) => boxesOverlap(p.entity.aabb, blockAabb(x, y, z))),
      landed: (x, y, z) => {
        this.audio.sandThud();
        this.particles.burst(x + 0.5, y + 1.15, z + 0.5, 0xe6cf96, 5, 0.5);
      },
      crushed: (x, y, z) => {
        this.saplings.delete(worldIdx(x, y, z));
        this.particles.burst(x + 0.5, y + 0.5, z + 0.5, 0x9fd06a, 5, 0.6);
      },
      moved: (x, yFrom, yTo, z) => this.sandFalls.glide(x, yFrom, yTo, z),
    });
    // the voxel moves instantly (physics/saves stay true); SandFalls draws the
    // same block gliding between the cells so the fall reads as a fall. The
    // mesher skips a cell while its cube is in flight (chunks.skipSand), and
    // SandFalls touches the chunk back when the cube reaches the ground.
    this.sandFalls = new SandFalls(
      this.scene, this.chunks.materials.textured, (x, z) => this.world.touchAt(x, z),
    );
    this.chunks.skipSand = this.sandFalls.hidden;
    // water finds its level: the same change hook drives flow spreading and
    // draining, so digging a trench into the sea floods it cell by cell
    this.water = new WaterFlow(this.world);
    this.world.onCellChanged = (x, y, z) => {
      this.sand.notify(x, y, z);
      this.water.notify(x, y, z);
      this.lights.onCell(x, y, z, this.world.get(x, y, z)); // torches light up the moment they land
      this.shadowWorldEpoch++; // the baked shadow map just went stale
    };

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
      (colorIdx, nameIdx, modelIdx) => this.confirmJoin(s, colorIdx, nameIdx, modelIdx));
    const cam = new THREE.PerspectiveCamera(70, 1, 0.1, SKY_FAR);
    const pane = this.players.length + this.pendingJoins.size;
    this.pendingJoins.set(s.id, { source: s, card, camera: cam, angle: Math.random() * 6 });
    this.ui.ensurePanes(pane + 1);
    this.ui.addOverlay(pane, card);
    this.resize();
    this.ui.toast('Say hello to a new friend!');
  }

  private confirmJoin(s: InputSource, colorIdx: number, nameIdx: number, modelIdx: number): void {
    this.pendingJoins.delete(s.id);
    const idx = this.players.length;
    const color = AVATAR_COLORS[colorIdx % AVATAR_COLORS.length];
    const name = NICKNAMES[nameIdx % NICKNAMES.length];
    const model = AVATAR_MODELS[((modelIdx % AVATAR_MODELS.length) + AVATAR_MODELS.length) % AVATAR_MODELS.length];
    const spawn = this.spawnPoint.clone();
    spawn.x += Math.cos(idx * Math.PI / 2) * 2.2;
    spawn.z += Math.sin(idx * Math.PI / 2) * 2.2;
    const entity = new PlayerEntity(
      this.nextEntityId(), name, color.hex, spawn, model.id,
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
      } else if (frame.pressed.has('satchel')) {
        // the fish satchel, right in the world: D-pad ▾ / I opens the pouch
        this.openSatchel(p);
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
      this.audio.land(soundFamilyOf(ev.landedOn));
    }
    if (ev.footfall && this.time - (this.lastFootAt.get(e.id) ?? -9) > 0.18) {
      this.lastFootAt.set(e.id, this.time);
      this.footAlt = !this.footAlt;
      this.audio.footstep(soundFamilyOf(ev.footfallOn), this.footAlt);
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
      this.audio.splash();
    }
    if (ev.stroked && this.time - (this.lastStroke.get(e.id) ?? -9) > 0.5) {
      this.lastStroke.set(e.id, this.time);
      this.audio.swimStroke();
    }
    ev.landed = false;
    ev.landedOn = 0;
    ev.bounced = null;
    ev.steppedOnMusic = null;
    ev.steppedOnSparkle = false;
    ev.splashed = false;
    ev.stroked = false;
    ev.footfall = false;
    ev.footfallOn = 0;
  }

  private openMenu(p: LocalPlayer): void {
    const idx = this.players.indexOf(p);
    this.ui.clearOverlays(idx);
    const menu = new PlayerMenu(
      this.audio, this.typeOf(p), p,
      {
        toggleFly: () => { p.entity.flying = !p.entity.flying; p.entity.vel.y = 0; },
        toggleCamera: () => { p.firstPerson = !p.firstPerson; },
        cycleCostume: () => {
          const m = p.entity.cycleModel();
          this.shadowMeshEpoch++; // the baked map holds the old costume's shape
          const def = modelDef(m);
          this.ui.toast(`${p.entity.name} is now a ${def.name}! ${def.icon}`);
        },
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
            // ---- the sky and the treasure (all persisted in settings) ----
            weather: () => this.weatherLabel(),
            cycleWeather: () => {
              const order: WeatherMode[] = ['auto', 'off', 'rain', 'snow'];
              this.weatherMode = order[(order.indexOf(this.weatherMode) + 1) % order.length];
              this.weather.setMode(this.weatherMode);
              this.saveSettings();
              return this.weatherLabel();
            },
            dayMode: () => this.dayLabel(),
            cycleDay: () => {
              const order: DayMode[] = ['auto', 'day', 'night', 'none'];
              this.setDayMode(order[(order.indexOf(this.dayMode) + 1) % order.length]);
              this.saveSettings();
              return this.dayLabel();
            },
            chests: () => (this.chestsAllowed ? 'On' : 'Off'),
            toggleChests: () => {
              this.chestsAllowed = !this.chestsAllowed;
              this.saveSettings();
              // a kid with a chest in hand right now: send it home
              for (const p of this.players) {
                if (!this.chestsAllowed && (p.selected === CHEST || p.selected === CHEST_OPEN)) p.setSelected(ROCK);
              }
              this.ui.toast(this.chestsAllowed
                ? 'Treasure chests unlocked — a few may hide in the next world'
                : 'Treasure chests hidden', 2600);
            },
            shadows: () => (this.shadowsEnabled ? 'On' : 'Off'),
            toggleShadows: () => {
              this.shadowsEnabled = !this.shadowsEnabled;
              this.applyShadowSettings();
              this.saveSettings();
              this.ui.toast(this.shadowsEnabled
                ? 'Sun shadows on — long golden afternoons 🌤️'
                : 'Sun shadows off — a bit faster on older tablets', 2600);
            },
            lights: () => (this.lightsEnabled ? 'On' : 'Off'),
            toggleLights: () => {
              this.lightsEnabled = !this.lightsEnabled;
              this.saveSettings();
              this.ui.toast(this.lightsEnabled
                ? 'Torchlight on — the dark is friendlier now 🔥'
                : 'Torchlight off — only the moon lights the night', 2600);
            },
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
    const pal = new PaletteOverlay(this.audio, this.typeOf(p), p, paletteFor(this.chestsAllowed), (b) => p.setSelected(b));
    this.overlays.set(p.entity.id, pal);
    this.ui.addOverlay(idx, pal);
  }

  /**
   * The fish satchel inventory, opened right in the world (D-pad ▾ on a
   * pad, I on the keyboard): this kid's day's catch and the Eat button.
   */
  private openSatchel(p: LocalPlayer): void {
    const idx = this.players.indexOf(p);
    this.ui.clearOverlays(idx);
    const s = new SatchelOverlay(this.audio, this.typeOf(p), p, (k) => this.eatFish(p, k));
    this.overlays.set(p.entity.id, s);
    this.ui.addOverlay(idx, s);
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
    this.fishing.clearFor(p.entity.id); // no orphaned bobbers when a kid leaves
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

  /**
   * The pet/interact button on a door: the whole door swings open, or closes.
   * Closing first makes sure nobody is standing in the doorway — the panel
   * must never end up inside a player's hitbox: a kid buried in the panel
   * used to be shoved along its long axis and could shoot straight through
   * the invisible wall at the map edge (the "the door pushed me out of the
   * world" bug).
   */
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
    if (!opening && !this.makeRoomForDoor(lp, hit, parts)) {
      this.particles.burst(hit.x + 0.5, yBottom + 0.5, hit.z + 0.5, 0xff5d5d, 5, 0.5);
      if (this.time - this.lastDoorWarnAt > 2) {
        this.lastDoorWarnAt = this.time;
        this.ui.toast('Somebody is standing in the doorway!', 1800);
      }
      return;
    }
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
   * Before the panel swings shut, nudge everyone standing in the doorway to
   * the near side of it. The panel is half a block deep and thin along
   * exactly one axis — the walk-through direction — so the shove slides the
   * kid out through the doorway, never through a wall or the map edge.
   * Returns false when someone cannot be moved (a critter loitering in the
   * doorway, or solid walls on both sides): then the close is refused.
   */
  private makeRoomForDoor(lp: LocalPlayer, hit: RayHit, parts: [number, number][]): boolean {
    const panels: Aabb[] = parts.map(([y]) => doorPanelAabb(
      hit.x, y, hit.z,
      this.world.doorFacing.get(worldIdx(hit.x, y, hit.z)) ?? this.doorFacingFromAim(lp, hit),
    ));
    // animals wander cell to cell and cannot be nudged reliably — the door
    // just waits for the chicken to move on
    for (const a of this.animals.animals) {
      const ab: Aabb = { x: a.pos.x - 0.3, y: a.pos.y, z: a.pos.z - 0.3, w: 0.6, h: 0.8, d: 0.6 };
      if (panels.some((q) => boxesOverlap(ab, q))) return false;
    }
    for (const p of this.players) {
      const e = p.entity;
      const panel = panels.find((q) => boxesOverlap(e.aabb, q));
      if (!panel) continue;
      const thinX = panel.w < panel.d; // the panel's thin axis = the walk-through axis
      const lo = thinX ? panel.x : panel.z;
      const hi = thinX ? panel.x + panel.w : panel.z + panel.d;
      const cur = thinX ? e.pos.x : e.pos.z;
      const half = 0.31 + 0.02; // PLAYER_W/2 plus a hair of clearance
      const near = cur - lo < hi - cur ? lo - half : hi + half;
      const far = cur - lo < hi - cur ? hi + half : lo - half;
      for (const side of [near, far]) {
        if (side < 0.5 || side > (thinX ? WORLD_SX : WORLD_SZ) - 0.5) continue; // never over the edge
        const px = thinX ? side : e.pos.x;
        const pz = thinX ? e.pos.z : side;
        if (aabbOverlapsSolid(this.world, playerAabb(px, e.pos.y, pz))) continue;
        if (thinX) { e.pos.x = side; e.vel.x = 0; } else { e.pos.z = side; e.vel.z = 0; }
        break;
      }
      if (boxesOverlap(e.aabb, panel)) return false; // nowhere to put them: do not close on top
    }
    return true;
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

  /**
   * Which way a new ladder's climbing side faces: away from the wall the kid
   * aimed at (the empty cell is between them and the wall, so the wall→cell
   * direction is the climb side). Aimed straight at a floor/ceiling, it faces
   * the way they are looking.
   */
  private ladderFacingFromAim(lp: LocalPlayer, hit: RayHit): LadderFacing {
    const dx = hit.px - hit.x, dz = hit.pz - hit.z;
    if (dx !== 0 || dz !== 0) {
      return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 0 : 1) : (dz > 0 ? 2 : 3);
    }
    const yaw = lp.entity.yaw; // forward is (sin yaw, cos yaw), as in playerEntity
    return Math.abs(Math.sin(yaw)) >= Math.abs(Math.cos(yaw))
      ? (Math.sin(yaw) > 0 ? 0 : 1)
      : (Math.cos(yaw) > 0 ? 2 : 3);
  }

  /** the pet button aimed at a ladder: spin it a quarter turn on the spot */
  private rotateLadder(hit: RayHit): void {
    const was = this.world.getLadderFacing(hit.x, hit.y, hit.z);
    this.world.setLadderFacing(hit.x, hit.y, hit.z, rotateStairFacing(was));
    this.audio.place();
    this.particles.burst(hit.x + 0.5, hit.y + 0.6, hit.z + 0.5, 0xf2c98c, 5, 0.5);
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
    this.audio.chestOpen();
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

  /**
   * The pet button while this player's line is in the water: bring it in.
   * A diving bobber means a fish — the kind is drawn from the fishing table,
   * weighted towards the kinds actually swimming under the bobber. The catch
   * goes into the kid's satchel (core/satchel.ts): the HUD 🐟 chip counts it,
   * and D-pad ▾ / I opens the pouch right in the world to eat it.
   */
  private reelIn(lp: LocalPlayer): void {
    const out = this.fishing.reel(lp.entity.id);
    if (!out) return;
    if (!out.bite) {
      this.audio.fishReel();
      this.ui.toast('🎣 You reeled in an empty hook — try again!', 1900);
      return;
    }
    const kind = pickFishKind(this.fish.nearbyKinds(out.x, out.y, out.z));
    const def = FISH_DEFS[kind];
    lp.entity.starsCount += def.stars;
    lp.satchel.add(kind);
    // the swimmer of this kind under the bobber is the one that got caught
    this.fish.takeNearest(out.x, out.y, out.z, kind, 5);
    this.audio.fishCaught(kind);
    this.particles.burst(out.x, out.y + 0.2, out.z, 0xffd24a, 14, 1.0);
    this.ui.toast(`${def.icon} You caught a ${def.name}! +${def.stars} ⭐ — into the satchel!`, 2800);
  }

  /**
   * Satchel inventory → eat: one fish disappears with a munch, and its
   * tastiness kicks in right away — see FISH_SNACKS for each kind's boost.
   */
  private eatFish(lp: LocalPlayer, kind: FishKind): void {
    if (!lp.satchel.take(kind)) {
      this.audio.uiBack(); // someone ate it already: nothing to munch
      return;
    }
    const snack = FISH_SNACKS[kind];
    if (snack.effect === 'zoom' || snack.effect === 'zoom+boing') lp.entity.zoomTime = snack.seconds;
    if (snack.effect === 'boing' || snack.effect === 'zoom+boing') lp.entity.boingTime = snack.seconds;
    this.audio.munch();
    const e = lp.entity;
    this.particles.burst(e.pos.x, e.pos.y + 1.35, e.pos.z, 0xffe14d, 12, 0.9);
    this.ui.toast(`${FISH_DEFS[kind].icon} ${snack.message}`, 2800);
  }

  /**
   * One bucket press, both directions: an empty pail scoops the spring the
   * kid aims at (and the flood that spring fed runs home, shallowest first),
   * a full one pours a new spring into the gap in front of whatever they aim
   * at. The full/empty flag lives on the player — session-only, like the
   * fish satchel: buckets do not survive a reload.
   */
  private bucketAction(lp: LocalPlayer, hit: RayHit): boolean {
    const res = useBucket(this.world, lp.bucketFull, hit);
    if (!res.ok) {
      if (res.reason === 'flow' && this.time - this.lastBucketHint > 3) {
        this.lastBucketHint = this.time;
        this.ui.toast('Running water is too quick to catch — scoop a still spring 💧', 2400);
      }
      return false;
    }
    lp.bucketFull = res.kind === 'filled';
    if (res.kind === 'filled') {
      this.audio.plip();
      this.particles.burst(res.x + 0.5, res.y + 0.7, res.z + 0.5, 0x4aa3e8, 7, 0.8);
      this.ui.toast(`${lp.entity.name} scooped a bucket of water 💧`, 1500);
    } else {
      this.audio.splash();
      this.particles.burst(res.x + 0.5, res.y + 1.1, res.z + 0.5, 0x4aa3e8, 8, 0.8);
      this.ui.toast(`${lp.entity.name} poured the bucket — a new spring!`, 1800);
    }
    return true;
  }

  private hooks() {
    return {
      events: this.stepEvents,
      tryPlace: (lp: LocalPlayer, hit: RayHit): boolean => {
        const { px, py, pz } = hit;
        if (!this.world.inBounds(px, py, pz)) return false;
        if (py <= 0) return false;
        const id = lp.selected;
        // Treasure chests answer to a grown-up: hidden is hidden — even from
        // a hotbar that still holds one from before the switch flipped.
        if (!this.chestsAllowed && (id === CHEST || id === CHEST_OPEN)) {
          this.ui.toast('A grown-up hid the treasure chests (Player menu → Grown-Ups)', 2200);
          return false;
        }
        // 🪣 The bucket is a tool, not a brick: an empty one scoops the spring
        // you are looking at, a full one pours a new spring into the gap.
        if (isBucket(id)) return this.bucketAction(lp, hit);
        // A door is TWO blocks high and you always build it from its bottom
        // half: the upper half comes with it, so the cell above has to be free.
        if (isDoorTopBlock(id)) return false;
        const door = id === DOOR;
        if (door) {
          const above = this.world.get(px, py + 1, pz);
          if (!this.world.inBounds(px, py + 1, pz) || isSolidBlock(above) || isWaterId(above)) {
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
        // A ladder is nailed to a wall, not hung in the air: the wall it leans
        // on (opposite the climbing side) has to be a solid block, or another
        // ladder — the one below it is how you build a ladder up a cliff face.
        const ladder = id === LADDER;
        const ladderFacing = ladder ? this.ladderFacingFromAim(lp, hit) : 0;
        if (ladder) {
          const wall: [number, number] = ladderFacing === 0 ? [-1, 0] : ladderFacing === 1 ? [1, 0]
            : ladderFacing === 2 ? [0, -1] : [0, 1];
          const behind = this.world.get(px + wall[0], py, pz + wall[1]);
          const below = this.world.get(px, py - 1, pz);
          if (!isSolidBlock(behind) && !isLadderBlock(behind) && !isLadderBlock(below)) {
            this.particles.burst(px + 0.5, py + 0.5, pz + 0.5, 0xff5d5d, 4, 0.4);
            return false;
          }
        }
        // A torch belongs on a post or a wall — like a ladder, it refuses to
        // hang in thin air. Solid ground below, or a solid block beside it.
        if (id === TORCH) {
          const footing = this.world.get(px, py - 1, pz);
          const sides: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          const onWall = sides.some(([sx, sz]) => isSolidBlock(this.world.get(px + sx, py, pz + sz)));
          if (!isSolidBlock(footing) && !onWall) {
            this.particles.burst(px + 0.5, py + 0.5, pz + 0.5, 0xff5d5d, 4, 0.4);
            return false;
          }
        }
        for (const [cx, cy, cz, cid] of toSet) {
          this.world.set(cx, cy, cz, cid);
          const i = worldIdx(cx, cy, cz);
          if (door) this.world.doorFacing.set(i, facing);
          // a stair remembers which way it points; anything built over one forgets it
          if (stairs) this.world.stairFacing.set(i, stairFacing);
          else this.world.stairFacing.delete(i);
          if (ladder) this.world.ladderFacing.set(i, ladderFacing);
          else this.world.ladderFacing.delete(i);
          if (blockDef(cid).sparkle) this.sparkleBlocks.add(i);
        }
        this.audio.place(soundFamilyOf(id));
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
        // 🪣 Digging with a bucket scoops: a spring hops into the pail instead
        // of flashing "no" like bedrock does. (Flowing water still breaks
        // normally — that is how you carve a flood back into its banks.)
        if (isBucket(lp.selected) && !lp.bucketFull && hit.block === WATER) {
          if (this.bucketAction(lp, hit)) return;
        }
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
          this.world.ladderFacing.delete(i);
          this.sparkleBlocks.delete(i);
          this.saplings.delete(i);
          const c = blockDef(b).color;
          this.particles.burst(hit.x + 0.5, y + 0.5, hit.z + 0.5, new THREE.Color(c[0], c[1], c[2]), 9, 0.9);
        }
        this.audio.remove(soundFamilyOf(hit.block));
        void lp;
      },
      interact: (lp: LocalPlayer): boolean => {
        // A line already in the water outranks everything: the pet button
        // reels it in — that is what bites mean.
        if (this.fishing.active(lp.entity.id)) {
          this.reelIn(lp);
          return true;
        }
        // 🪣 A bucket in hand outranks the fishing cast: the LT button fills
        // the pail from a spring, or pours it out into the gap you look at.
        // (Anything the bucket cannot do falls through: petting still works.)
        if (isBucket(lp.selected) && lp.target) {
          const hit = lp.target;
          const wantsWater = !lp.bucketFull && hit.block === WATER;
          const wantsPour = lp.bucketFull && pourableAt(this.world, hit.px, hit.py, hit.pz);
          if (wantsWater || wantsPour) {
            if (this.bucketAction(lp, hit)) return true;
          }
        }
        // doors and chests come first: the pet button is the family's "do
        // something nice" button, and a door or a treasure chest straight ahead
        // is more pressing than an animal. Aimed at a step, it spins it around.
        const aim = lp.removeTarget;
        if (aim && isDoorBlock(aim.block) && aim.dist <= 4.5) {
          this.toggleDoor(lp, aim);
          return true;
        }
        if (aim && isChestBlock(aim.block) && aim.dist <= 4.5) {
          this.openChest(lp, aim);
          return true;
        }
        if (aim && isStairsBlock(aim.block) && aim.dist <= 4.5) {
          this.rotateStairs(aim);
          return true;
        }
        if (aim && isLadderBlock(aim.block) && aim.dist <= 4.5) {
          this.rotateLadder(aim);
          return true;
        }
        // Aimed at the water: the pet button casts a fishing line (the
        // generous crosshair already found that water within reach).
        const water = lp.target;
        if (water && isWaterId(water.block)) {
          this.fishing.cast(lp.entity.id, this.angler(lp), water.x, water.y, water.z);
          return true;
        }
        // Only a real pet counts: if nothing nearby wanted a scratch, LT is
        // just the build trigger and the block goes down (see LocalPlayer).
        return this.animals.petNearest(lp.entity.pos.x, lp.entity.pos.y + 0.8, lp.entity.pos.z, 2.4) !== null;
      },
    };
  }

  // -------------------------------------------------------------------- sky
  // The two sky switches in Grown-Up Settings, plus the helpers tests (and the
  // debug console) use to make the weather happen on purpose.

  /** what the weather row in the menu shows */
  private weatherLabel(): string {
    return this.weatherMode === 'auto' ? 'Sometimes' : this.weatherMode === 'off' ? 'Never'
      : this.weatherMode === 'rain' ? 'Always rain' : 'Always snow';
  }

  /** what the day & night row in the menu shows */
  private dayLabel(): string {
    return this.dayMode === 'auto' ? 'Day and night' : this.dayMode === 'day' ? 'Always day'
      : this.dayMode === 'night' ? 'Always night' : 'No sun or moon';
  }

  /** Park the sun and moon, or let the clock run again. */
  setDayMode(mode: DayMode): void {
    this.dayMode = mode;
    this.skyEnv.setDayMode(mode);
  }

  /** where the sun (or moon) is right now — direction, height, warmth, colour */
  sunInfo(): SunState {
    return this.skyEnv.sunInfo();
  }

  /** Apply the Grown-Ups "Shadows" switch; material programs recompile once. */
  /**
   * Which shadow filter this GPU can afford: soft PCF costs nine depth taps
   * per shaded pixel — hundreds of ms on a software rasteriser (measured on
   * CI's own runner), nothing on any real GPU. Only 'soft' on an unambiguous
   * hardware renderer string; anything unknown or software-ish gets 'fast'.
   */
  static resolveShadowQuality(rendererName: string): 'soft' | 'fast' {
    if (/swiftshader|llvmpipe|softpipe|basic render|software/i.test(rendererName)) return 'fast';
    return /apple|metal|nvidia|geforce|quadro|rtx|gtx|radeon|ryzen|intel|uhd|arc |adreno|mali|powervr/i
      .test(rendererName) ? 'soft' : 'fast';
  }

  /** the same call, reachable from tests/debug without a renderer */
  shadowQualityFor(rendererName: string): 'soft' | 'fast' {
    return Game.resolveShadowQuality(rendererName);
  }

  /** Read the GPU's own name and pick 'soft' or 'fast' to match. */
  private static detectShadowQuality(renderer: THREE.WebGLRenderer): 'soft' | 'fast' {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
      : String(gl.getParameter(gl.RENDERER) ?? '');
    return Game.resolveShadowQuality(name);
  }

  /**
   * Switch shadow filter quality: 'soft' = PCF-soft on a 2048² map (real
   * GPUs — smooth edges, the filter is free on hardware), 'fast' = crisp
   * single-tap on 1024² (software GL — nine taps per pixel is hundreds of
   * ms there; blocky edges suit the art anyway). Every material is poked
   * once: the filter is baked into the program cache key.
   */
  setShadowQuality(q: 'soft' | 'fast'): void {
    this.shadowQuality = q;
    this.renderer.shadowMap.type = q === 'soft' ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
    const size = q === 'soft' ? 2048 : 1024;
    const sh = this.sunLight?.shadow;
    if (sh && sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      if (sh.map) {
        sh.map.dispose();
        sh.map = null;
      }
    }
    if (sh) sh.needsUpdate = true;
    this.recompileShadowPrograms();
  }

  /** three bakes shadow state into every program's cache key: poke them all */
  private recompileShadowPrograms(): void {
    const seen = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const one of Array.isArray(m) ? m : [m]) {
        if (!seen.has(one)) {
          seen.add(one);
          one.needsUpdate = true;
        }
      }
    });
  }

  private applyShadowSettings(): void {
    if (this.renderer.shadowMap.enabled === this.shadowsEnabled) return;
    this.renderer.shadowMap.enabled = this.shadowsEnabled;
    if (this.shadowsEnabled && this.sunLight) {
      // flipping the switch back on: bake a fresh map right away
      this.sunLight.shadow.needsUpdate = true;
      this.shadowHeartbeat = Game.SHADOW_HEARTBEAT;
    }
    this.recompileShadowPrograms();
  }

  /**
   * Point the shadow follow box at this frame's players (or the idle camera
   * while nobody has joined). The sky lerps it and snaps it to the map's
   * texel grid, so walking never makes the shadows swim. The box is always
   * followed — even while shadows are off — so flipping the switch back on
   * never reveals a stale box far behind the kids.
   */
  private updateShadowFocus(realDt: number): void {
    if (this.players.length > 0) {
      let x = 0, y = 0, z = 0;
      for (const p of this.players) {
        x += p.entity.pos.x; y += p.entity.pos.y; z += p.entity.pos.z;
      }
      const n = this.players.length;
      this.skyEnv.focusShadow(x / n, y / n, z / n);
    } else {
      const c = this.renderCam ?? this.idleCamera;
      this.skyEnv.focusShadow(c.position.x, Math.max(4, c.position.y - 8), c.position.z);
    }

    // When is a map redraw actually worth its cost (tens of ms on CI's
    // software GL)? Only when something that casts a shadow moved: a kid is
    // moving (their own shadow must ride along, and the follow box crawls
    // with them), voxels changed under the box (and for a beat after, since
    // remeshing is budgeted over frames), the follow box slid a full texel,
    // or the sun-drift heartbeat came due. All timers tick on WALL seconds —
    // game time crawls when frames are slow, and a slow world is exactly
    // when a stale shadow map stings most. Idle menus then bake ~1×/s only.
    let moving = false;
    for (const p of this.players) {
      const v = p.entity.vel;
      if (v.x * v.x + v.y * v.y + v.z * v.z > 0.16) {
        moving = true;
        break;
      }
    }
    const focusMoved = this.players.length > 0
      && this.skyEnv.shadowFocusPos().distanceToSquared(this.lastShadowFocus)
        > SHADOW_TEXEL * SHADOW_TEXEL;
    const worldChanged =
      this.shadowWorldEpoch !== this.lastShadowWorldEpoch ||
      this.shadowMeshEpoch !== this.lastShadowMeshEpoch;
    if (worldChanged) this.shadowEditUntil = this.wallNow + Game.SHADOW_EDIT_WINDOW;
    this.shadowHeartbeat += realDt;
    const due = this.shadowHeartbeat >= Game.SHADOW_HEARTBEAT;
    const want = this.shadowsEnabled
      && (moving || focusMoved || worldChanged || due || this.wallNow < this.shadowEditUntil);
    if (want) {
      this.shadowHeartbeat = 0;
      this.lastShadowFocus.copy(this.skyEnv.shadowFocusPos());
      this.lastShadowWorldEpoch = this.shadowWorldEpoch;
    }
    this.shadowWantRedraw = want;
  }

  /**
   * Which pane's render call redraws the sun's shadow map this frame: the
   * first camera whose layer view takes in every avatar (third-person panes
   * and the welcome/join cameras always do). Before the map exists at all it
   * is pane 0 by necessity — someone has to bake it first.
   */
  private pickShadowDonor(cameras: THREE.Camera[]): number {
    if (!this.sunLight.shadow.map) return 0; // nothing baked yet: pane 0 bakes
    for (let i = 0; i < cameras.length; i++) {
      const lp = this.players.find((p) => p.camera === cameras[i]);
      if (!lp || lp.showOwnBody) return i;
    }
    return 0;
  }

  /**
   * Start (or stop) falling weather right away — the grown-up menu cycles the
   * mode through the clock, and this is the immediate door the tests use.
   * Returns the intensity chosen, 0..1.
   */
  weatherNow(kind: WeatherKind | null): number {
    return this.weather.force(kind, kind === null ? 0 : 45);
  }

  /** the day-phase clock the sky is showing, 0..1 (tests and debug) */
  get dayPhase(): number {
    return this.skyEnv.dayPhase();
  }

  /**
   * Drive the bucket from the console (tests): pad aim adds too much noise for
   * a deterministic flood, so this hands the bucket action the exact aim cell.
   */
  bucketForTest(p: LocalPlayer, hit: RayHit): boolean {
    return this.bucketAction(p, hit);
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
      this.world.ladderFacing.delete(i);
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
      const s = JSON.parse(raw) as {
        layout?: string; muted?: boolean; chests?: boolean; weather?: string; day?: string;
        shadows?: boolean; lights?: boolean;
      };
      if (s.layout === 'auto' || s.layout === 'horizontal' || s.layout === 'vertical' || s.layout === 'grid2x2') {
        this.layout = s.layout;
      }
      if (typeof s.muted === 'boolean') this.audio.muted = s.muted;
      if (typeof s.chests === 'boolean') this.chestsAllowed = s.chests;
      if (s.weather === 'auto' || s.weather === 'off' || s.weather === 'rain' || s.weather === 'snow') {
        this.weatherMode = s.weather;
        this.weather.setMode(s.weather);
      }
      if (s.day === 'auto' || s.day === 'day' || s.day === 'night' || s.day === 'none') this.dayMode = s.day;
      if (typeof s.shadows === 'boolean') this.shadowsEnabled = s.shadows;
      if (typeof s.lights === 'boolean') this.lightsEnabled = s.lights;
    } catch { /* corrupted settings: defaults win */ }
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(this.settingsKey, JSON.stringify({
        layout: this.layout, muted: this.audio.muted,
        chests: this.chestsAllowed, weather: this.weatherMode, day: this.dayMode,
        shadows: this.shadowsEnabled, lights: this.lightsEnabled,
      }));
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
    // the fish move into the new water, and nobody keeps a line in the old sea
    this.fish.dispose();
    this.fish = new FishWorld(this.scene, this.world, this.particles);
    this.fishing.clear();
    this.sparkleBlocks.clear();
    this.saplings.clear();
    this.dynamite.clear(); // no half-burnt sticks from the old world, please
    this.sand.reset();
    this.sandFalls.clear();
    this.water.reset(); // forget old floods; a fresh world's sea starts still
    // living things and lit fuses that came with a save wake up, same as at boot
    for (const [i, b] of this.world.mods) {
      if (blockDef(b).sparkle) this.sparkleBlocks.add(i);
      if (b === SAPLING) this.saplings.set(i, -this.saplingGrowSeconds + 10);
    }
    this.dynamite.restoreFromWorld();
    this.lights.restoreFromWorld(); // the new world's torches, lamps and opened treasure
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
  /** what FishingManager needs to know about one local player this frame */
  private angler(p: LocalPlayer): Angler {
    const e = p.entity;
    return {
      id: e.id,
      pos: e.pos,
      yaw: e.yaw,
      headHeight: e.headHeight,
      camera: p.camera,
      firstPerson: p.firstPerson,
      rightArm: e.avatar.rightArm,
    };
  }

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
      // first-person fishing: only the owner's own camera draws the held rod
      if (players[i].firstPerson && this.fishing.active(players[i].entity.id)) {
        players[i].camera.layers.enable(ROD_LAYER);
      }
    }
  }

  private loop = (now: number): void => {
    this.rafId = requestAnimationFrame(this.loop);
    this.realDt = (now - (this.lastNow ?? now)) / 1000;
    this.wallNow = now / 1000;
    const dt = Math.min(0.05, this.realDt);
    this.lastNow = now;
    this.time += dt;

    this.input.update();
    this.routeInput(dt);

    if (!this.frozen) {
      this.animals.update(dt);
      this.fish.update(dt, this.players.map((p) => p.entity));
      if (this.fishing.lines.size > 0) this.fishing.update(dt, this.players.map((p) => this.angler(p)));
      this.starField.update(this.time);
      this.dynamite.update(dt);
      this.sand.update(dt);
      this.sandFalls.update(dt);
      this.water.update(dt);
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

      // The sky: the sun and moon circle on their clock (which a grown-up can
      // park), and the weather clock decides when rain or snow falls. The rain
      // hiss follows the sky, and a proper downpour occasionally cracks.
      this.weather.update(dt);
      const wKind = this.weather.kind;
      this.skyEnv.setWeather(wKind, this.weather.intensity);
      if (wKind === 'rain' && this.weather.intensity > 0.05) {
        if (this.time - this.lastThunder > 9 && this.weather.intensity > 0.7 && Math.random() < dt * 0.05) {
          this.lastThunder = this.time;
          this.audio.thunder();
        }
        this.audio.rainLoop(this.weather.intensity); // re-triggers itself ~1×/s while it rains
        this.rainSound = 'rain';
      } else if (wKind === 'snow') {
        this.audio.rainLoopStop(); // snow falls silent
        this.rainSound = null;
      } else if (this.rainSound !== null) {
        this.audio.rainLoopStop();
        this.rainSound = null;
      }
      this.skyEnv.update(dt, this.renderCam ?? this.idleCamera);
    }

    // water drift: the tiling wave sheet slides a touch every frame so a pond
    // never freezes into a still painting
    this.chunks.tickWater(dt);
    // ...and the shader kit's shared uniforms (time, sun, haze colour) move
    // with it — one uniform set, no program rebuilds, ever
    if (this.scene.fog) this.chunks.tickShaders(dt, this.skyEnv.sunInfo(), this.scene.fog.color);
    // the world's lamps: gather the nearest emitters around the camera being
    // rendered and publish them into the kit's uniforms (numbers only — the
    // materials never recompile, and the flicker folds in on the CPU).
    // Software GL gets a tighter budget: there, every published light is
    // real fragment work for every pixel on the screen.
    this.lights.sync(
      this.renderCam ?? this.idleCamera, this.starField.stars, this.lightsEnabled,
      this.shadowQuality === 'soft' ? MAX_WORLD_LIGHTS : 3,
    );
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
    this.renderCam = this.players[0]?.camera ?? this.idleCamera;
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
    // steer the sun's shadow follow box before any pane renders
    this.updateShadowFocus(this.realDt);
    // ONE shadow map redraw per frame at most, and only when something that
    // casts shadows actually moved (see updateShadowFocus): just the donor
    // pane's render call marks the map dirty, every other pane samples the
    // map it just baked (at most one frame stale). A first-person kid's own
    // body is the one thing a donor-less frame can skip — nobody sees
    // through that camera anyway.
    const donor = this.shadowsEnabled ? this.pickShadowDonor(cameras) : -1;
    this.viewportMgr.render(this.renderer, this.scene, cameras, (i) => {
      if (i === donor && this.shadowWantRedraw) this.sunLight.shadow.needsUpdate = true;
    });

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
    '🧗 Lean a ladder on a wall and hold jump to climb it!',
    '🎣 Aim at the water and press the pet button to fish!',
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
