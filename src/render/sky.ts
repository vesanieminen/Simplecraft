/**
 * Sky, lights, clouds, rain/snow and the day-night cycle.
 *
 * The sun and moon circle the world once every `DAY_SECONDS`, and the lights,
 * fog and dome colours all follow the clock — morning gold at 0.25, high noon
 * at 0.5, sunset orange at 0.75, and a blue-black night that keeps real colour
 * and a light floor (a pitch-black sky frightens kids, and the e2e sky test
 * counts near-black pixels). Grown-ups can park the clock at noon or midnight
 * or hide the sun, moon and clouds entirely. Clouds darken and rain or snow
 * starts and stops when core/weather.ts says so; this file only draws it.
 */

import * as THREE from 'three';
import { WORLD_SX, WORLD_SZ } from '../core/world';
import { WeatherKind } from '../core/weather';
import { patchStarTwinkle, ShaderKit, SunState } from './shaders';

export const DAY_SECONDS = 12 * 60;
/** the sun's elevation at a day-phase (0..1); > 0 means the sun is up */
export function sunElevation(hour: number): number {
  return Math.sin(hour * Math.PI * 2);
}

export const SKY_RADIUS = 320;
/** matches the fog, so the renderer can clear to it: nothing in this game should
 *  ever be able to show the raw canvas, and a black gap frightens kids */
export const SKY_CLEAR = 0xbfe0f5;
/** Camera far plane. The dome is centred on the MIDDLE of the world, so the most
 *  a camera can be from its centre is the half-diagonal (~91) plus the build
 *  ceiling (~44) — stay well clear of dome + that, or three clips a hole in the
 *  sky and the black canvas shows through it. */
export const SKY_FAR = SKY_RADIUS + 200;

/** One soft blob sprite, reused by clouds and snowflakes. */
function blobTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; // sky colours here are plain linear values
  return t;
}

/** A soft additive halo sprite — the moon's silver aura and the sun's low
 *  horizon glare. Sprites billboard themselves for free and ride wherever
 *  their parent ball goes, so the orbit drags them around the sky. */
function glowSprite(scale: number, color: number, opacity: number): THREE.Sprite {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: blobTexture(), color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  spr.scale.setScalar(scale);
  return spr;
}

/** A slow cloud field: puffy textured quads that drift and fade with the sky. */
class Clouds {
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly groups: THREE.Group[] = [];
  private readonly speeds: number[] = [];
  private readonly spanX = WORLD_SX * 2.6;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, side: THREE.DoubleSide,
      depthWrite: false, fog: false, opacity: 0,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    let seed = 20261108;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 12; i++) {
      const puff = new THREE.Group();
      const n = 4 + Math.floor(rnd() * 5);
      for (let p = 0; p < n; p++) {
        const m = new THREE.Mesh(geo, this.mat);
        const s = 16 + rnd() * 30;
        m.scale.set(s, s * (0.35 + rnd() * 0.2), 1);
        m.position.set((p - n / 2) * 12 + rnd() * 6, (rnd() - 0.5) * 5, (rnd() - 0.5) * 14);
        puff.add(m);
      }
      puff.rotation.x = -Math.PI / 2;
      puff.position.set(
        rnd() * this.spanX - this.spanX / 4 + WORLD_SX / 2,
        96 + rnd() * 40,
        rnd() * WORLD_SZ * 1.5 - WORLD_SZ * 0.25,
      );
      puff.scale.setScalar(0.7 + rnd() * 1.4);
      scene.add(puff);
      this.groups.push(puff);
      this.speeds.push(2 + rnd() * 3.5);
    }
  }

  update(dt: number, opacity: number, darkness: number): void {
    const o = Math.max(0, Math.min(1, opacity));
    this.mat.visible = o > 0.01;
    if (!this.mat.visible) return;
    this.mat.opacity = o * 0.85;
    this.mat.color.setRGB(1 - darkness * 0.45, 1 - darkness * 0.42, 1 - darkness * 0.3);
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i];
      g.position.x += this.speeds[i] * dt;
      if (g.position.x > WORLD_SX + this.spanX * 0.6) g.position.x -= this.spanX * 1.2;
    }
  }
}

/** Rain or snow: one drifting Points cloud that rides the camera, so a kid
 *  always stands inside the weather. Points keeps it one draw call. */
class Precipitation {
  private readonly pos: Float32Array;
  private readonly points: THREE.Points;
  private readonly mat: THREE.PointsMaterial;
  private readonly span = 46;
  private kind: WeatherKind | null = null;
  private opacity = 0;

  constructor(scene: THREE.Scene) {
    const n = 1400;
    this.pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.respawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      map: blobTexture(), color: 0x9fc0e8, size: 0.12, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true, fog: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  private respawn(i: number, initial = false): void {
    const o = i * 3;
    this.pos[o] = (Math.random() - 0.5) * this.span;
    this.pos[o + 1] = initial ? Math.random() * 32 : 22 + Math.random() * 10;
    this.pos[o + 2] = (Math.random() - 0.5) * this.span;
  }

  set(kind: WeatherKind | null, intensity: number): void {
    if (kind !== this.kind) {
      this.kind = kind;
      for (let i = 0; i < this.pos.length / 3; i++) this.respawn(i, true);
      if (kind === 'snow') {
        this.mat.color.set(0xffffff);
        this.mat.size = 0.3;
      } else {
        this.mat.color.set(0x9fc0e8);
        this.mat.size = 0.12;
      }
    }
    this.opacity = kind ? 0.4 + intensity * 0.5 : 0;
    this.points.visible = this.opacity > 0.01;
  }

  update(dt: number, cam: THREE.Camera): void {
    this.mat.opacity = this.opacity;
    if (!this.points.visible) return;
    const snow = this.kind === 'snow';
    const fall = snow ? 2.2 : 24;
    const sway = snow ? 1.5 : 0;
    const t = performance.now() * 0.001;
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.pos.length / 3; i++) {
      const o = i * 3;
      this.pos[o + 1] -= (fall + (i % 7) * (snow ? 0.12 : 1.6)) * dt;
      this.pos[o] += Math.sin(t * 1.3 + i * 0.7) * sway * dt;
      this.pos[o + 2] += Math.cos(t * 1.1 + i * 0.3) * sway * dt;
      if (this.pos[o + 1] < -8) this.respawn(i);
    }
    attr.needsUpdate = true;
    this.points.position.set(cam.position.x, cam.position.y + 12, cam.position.z);
  }
}

interface SkyStop {
  top: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  sun: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemi: number;
  dir: number;
  amb: number;
}

const mk = (
  top: number, horizon: number, fog: number, sunC: number,
  hemiSky: number, hemiGround: number, hemi: number, dirI: number, ambI: number,
): SkyStop => ({
  top: new THREE.Color(top), horizon: new THREE.Color(horizon), fog: new THREE.Color(fog),
  sun: new THREE.Color(sunC),
  hemiSky: new THREE.Color(hemiSky), hemiGround: new THREE.Color(hemiGround),
  hemi, dir: dirI, amb: ambI,
});

// The day's palette, keyed by day-phase. Night keeps real colour and a light
// floor everywhere: even the darkest stop stays clear of the black-pixel census.
const STOPS: { hour: number; s: SkyStop }[] = [
  { hour: 0.00, s: mk(0x203a66, 0xb06a4a, 0x8f7a8c, 0xffd9a0, 0x7688b8, 0x5a5244, 0.55, 0.32, 0.30) },
  { hour: 0.25, s: mk(0x4f86d8, 0xf2c47a, 0xc6dcec, 0xffe3b0, 0xa8c6e8, 0x86795c, 0.88, 1.05, 0.30) },
  { hour: 0.35, s: mk(0x4585d8, 0xd8ecfb, 0xbfe0f5, 0xfff6e0, 0xcfe8ff, 0x9a8b6a, 1.05, 1.60, 0.25) },
  { hour: 0.50, s: mk(0x4585d8, 0xd8ecfb, 0xbfe0f5, 0xfff6e0, 0xcfe8ff, 0x9a8b6a, 1.05, 1.60, 0.25) },
  { hour: 0.68, s: mk(0x4f7fd0, 0xe8c896, 0xcbd9ea, 0xffe0b4, 0xc4d6ee, 0x90805f, 0.92, 1.20, 0.28) },
  { hour: 0.76, s: mk(0x3e5f9e, 0xf09a58, 0xb0a8c0, 0xffa860, 0x8a86b6, 0x66564a, 0.58, 0.25, 0.34) },
  { hour: 0.83, s: mk(0x27406e, 0xb46a62, 0x77819f, 0xffc8a0, 0x6d78a8, 0x544f4c, 0.42, 0.08, 0.38) },
  { hour: 1.00, s: mk(0x203a66, 0xb06a4a, 0x8f7a8c, 0xffd9a0, 0x7688b8, 0x5a5244, 0.55, 0.32, 0.30) },
];

export type DayMode = 'auto' | 'day' | 'night' | 'none';

/** half-width of the shadow map's follow box, in blocks (AGENTS: keep it a
 *  few dozen — the pass is CPU-cheap to render but every caster vertex in
 *  the box costs a vertex on weak GPUs; CI's software GL measurably walks
 *  faster at 24 than at 30) */
const SHADOW_SPAN = 24;
/** how far the shadow light stands back from its target */
const SHADOW_DIST = 110;
export const SHADOW_MAP_SIZE = 1024;
/** ground-grid step the shadow target snaps to, so shadows don't crawl */
export const SHADOW_TEXEL = (SHADOW_SPAN * 2) / SHADOW_MAP_SIZE;

export interface SkyEnv {
  /** Advance the sky by `dt` seconds of game time; snow rides `camera`. */
  update(dt: number, camera: THREE.Camera): void;
  /** the day-phase clock the sky currently shows (0..1) */
  dayPhase(): number;
  /** auto clock / parked day / parked night / no sun, moon or clouds */
  setDayMode(mode: DayMode): void;
  /** start, change or stop falling weather (core/weather.ts decides when) */
  setWeather(kind: WeatherKind | null, intensity: number): void;
  /** the dome mesh — centred on the world middle, kept past every far plane */
  getDome(): THREE.Mesh;
  /** the shadow-casting sun/moon light (tests & debug: map, bias, frustum) */
  getSunLight(): THREE.DirectionalLight;
  /** where the sun (or moon) is: direction, height, low-sun warmth, colour */
  sunInfo(): SunState;
  /** move the shadow map's follow box to this spot (player/camera position) */
  focusShadow(x: number, y: number, z: number): void;
  /** where the follow box actually is now (read it after `focusShadow`) */
  shadowFocusPos(): THREE.Vector3;
  /** the lit ball's exact direction in the sky (no elevation clamp) — what
   *  the eye sees; `sunInfo().dir` is this, lifted off the horizon */
  sunBallDir(): THREE.Vector3;
}

export function createSky(scene: THREE.Scene, kit: ShaderKit): SkyEnv {
  // The sky hangs around the middle of the world, not the coordinate origin: on a
  // 128-block map the origin is a CORNER, and a dome centred there reaches 450
  // blocks from a camera near spawn — past the far plane, which used to punch a
  // black hole in the sky once the welcome camera had drifted around a little.
  const sky = new THREE.Group();
  sky.position.set(WORLD_SX / 2, 0, WORLD_SZ / 2);
  scene.add(sky);

  // gradient dome — the vertex colours are repainted whenever the clock moves
  const domeGeo = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
  const pos = domeGeo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  domeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const dome = new THREE.Mesh(
    domeGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }),
  );
  sky.add(dome);

  // the sun and moon ride one pivot so they stay opposite each other all day
  const orbit = new THREE.Group();
  sky.add(orbit);
  const mkBall = (r: number, color: number, glowColor: number, glowOpacity: number): THREE.Mesh => {
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(r, 16, 12),
      new THREE.MeshBasicMaterial({ color, fog: false }),
    );
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(r * 1.8, 16, 12),
      new THREE.MeshBasicMaterial({
        color: glowColor, fog: false, transparent: true, opacity: glowOpacity,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }),
    );
    ball.add(glow);
    return ball;
  };
  const sun = mkBall(10, 0xfff2a8, 0xffe9a0, 0.3);
  sun.position.set(0, 230, 120);
  const moon = mkBall(7, 0xe6ecf8, 0xc7d8f2, 0.2);
  moon.position.set(0, -230, -120);
  orbit.add(sun, moon);
  // the horizon glare: a wide warm wash around the low sun, and a silver
  // aura around the moon. Both scale and breathe with the clock (update()),
  // both are one sprite each — the cheapest "dramatic sky" money can buy.
  const glare = glowSprite(40, 0xffc46a, 0);
  sun.add(glare);
  const moonHalo = glowSprite(44, 0xbcd2f0, 0.14);
  moon.add(moonHalo);

  // stars: a dome of points that fade in after dusk — and each one breathes
  // on its own seed, patched through the kit so the sky is never a still photo
  const starN = 900;
  const starPos = new Float32Array(starN * 3);
  const starSeed = new Float32Array(starN);
  for (let i = 0; i < starN; i++) {
    const v = new THREE.Vector3().randomDirection();
    if (v.y < 0.05) v.y = 0.05 + Math.random() * 0.9;
    v.normalize().multiplyScalar(SKY_RADIUS * 0.9);
    starPos.set([v.x, v.y, v.z], i * 3);
    starSeed[i] = Math.random();
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('aStarSeed', new THREE.BufferAttribute(starSeed, 1));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 1.6, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  patchStarTwinkle(starMat, kit);
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -2;
  sky.add(stars);

  // Exponential haze instead of a hard near/far band: terrain melts into the
  // sky's own haze colour the way real distances do — near stays crisp, the
  // far meadow and the horizon fuse. core/water.ts and the dome stay unfogged.
  scene.fog = new THREE.FogExp2(SKY_CLEAR, 0.0075);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x9a8b6a, 1.05);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff6e0, 1.6);
  dir.position.set(60, 90, -30);
  scene.add(dir);
  const amb = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(amb);

  // ---- shadows: the sun is the only caster, one map, tight frustum --------
  // The light hovers over the players (Game.updateShadowFocus → here) and its
  // elevation follows the clock. The game redraws the map exactly once a
  // frame — from the DONOR pane, the first pane whose camera sees every
  // avatar — and all other panes sample that map (at most one frame stale).
  // Night keeps a soft moon shadow (0.32 light) — soft, never the void.
  dir.castShadow = true;
  dir.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  // ONE map redraw per frame: the game marks `shadow.needsUpdate` only for
  // the donor pane (the first pane that can see every avatar), the other
  // panes sample that same map. See Game.render → viewportMgr.render.
  dir.shadow.autoUpdate = false;
  dir.shadow.camera.left = -SHADOW_SPAN;
  dir.shadow.camera.right = SHADOW_SPAN;
  dir.shadow.camera.top = SHADOW_SPAN;
  dir.shadow.camera.bottom = -SHADOW_SPAN;
  dir.shadow.camera.near = 2;
  dir.shadow.camera.far = SHADOW_DIST + SHADOW_SPAN * 2;
  dir.shadow.bias = -0.0005;
  dir.shadow.normalBias = 0.03; // lifts the acne off flat voxel tops at low sun
  scene.add(dir.target);

  const cur: SkyStop = {
    top: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(),
    sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
    hemi: 1, dir: 1, amb: 0.25,
  };
  const mixStop = (hour: number): void => {
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (hour <= STOPS[i + 1].hour) {
        const a = STOPS[i].s;
        const b = STOPS[i + 1].s;
        const t = (hour - STOPS[i].hour) / Math.max(1e-9, STOPS[i + 1].hour - STOPS[i].hour);
        cur.top.copy(a.top).lerp(b.top, t);
        cur.horizon.copy(a.horizon).lerp(b.horizon, t);
        cur.fog.copy(a.fog).lerp(b.fog, t);
        cur.sun.copy(a.sun).lerp(b.sun, t);
        cur.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, t);
        cur.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, t);
        cur.hemi = a.hemi + (b.hemi - a.hemi) * t;
        cur.dir = a.dir + (b.dir - a.dir) * t;
        cur.amb = a.amb + (b.amb - a.amb) * t;
        return;
      }
    }
  };

  const paintDome = (wet: number): void => {
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / SKY_RADIUS; // -1..1
      const t = Math.max(0, Math.min(1, (y + 0.12) / 0.55));
      tmp.copy(cur.horizon).lerp(cur.top, t * 0.9 + Math.max(0, y - 0.4) * 0.1);
      if (wet > 0) tmp.lerp(cur.fog, Math.min(1, wet * 0.55 * (1 - t * 0.5)));
      tmp.toArray(colors, i * 3);
    }
    (domeGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  };

  const clouds = new Clouds(scene);
  const precip = new Precipitation(scene);

  let dayMode: DayMode = 'auto';
  let phase = 0.35; // bright mid-morning at boot: the welcome view stays cheerful
  let wet = 0; // eased 0..1 weather heaviness (drives cloud & light maths)
  let weatherKind: WeatherKind | null = null;
  let painted = -1;

  // The physical sun/moon direction the shadows and shaders follow — always
  // the direction of the visible ball, never an invented clock azimuth.
  const UP_Z = new THREE.Vector3(0, 0, 1);
  const sunWorldDir = new THREE.Vector3(0.4, 0.9, 0.5);
  let curHour = 0.35;
  const sunState: SunState = { dir: sunWorldDir, up: 1, low: 0, tint: new THREE.Color(0xfff6e0) };
  const shadowWant = new THREE.Vector3(WORLD_SX / 2, 12, WORLD_SZ / 2);
  const shadowFocus = shadowWant.clone();
  const shadowTmp = new THREE.Vector3();

  // The very first frame must already show the dome painted for the boot
  // phase — otherwise a kid boots into an unpainted sphere for one tick.
  mixStop(phase);
  paintDome(0);
  painted = phase;

  return {
    update(dt: number, camera: THREE.Camera): void {
      // storms roll in and out over seconds instead of snapping
      const wetTarget = weatherKind ? 0.55 : 0;
      wet += (wetTarget - wet) * Math.min(1, dt * 0.4);

      if (dayMode === 'auto') phase = (phase + dt / DAY_SECONDS) % 1;
      const hour = dayMode === 'day' ? 0.5 : dayMode === 'night' ? 0.0 : phase;
      curHour = hour;
      const elev = sunElevation(hour);
      mixStop(hour);

      // sun & moon: the pivot spins once per day, noon up top, midnight below
      // (sun.position is (0,230,120) — straight up at rotation 0 — so the
      // zero of the spin is noon itself, phase 0.25)
      orbit.rotation.z = (((hour - 0.25) % 1) + 1) % 1 * Math.PI * 2;
      const marks = dayMode !== 'none';
      orbit.visible = marks;
      stars.visible = marks;
      const darkness = Math.max(0, Math.min(1, -elev)); // 1 at true midnight
      starMat.opacity = marks ? darkness * 0.85 : 0;

      // lights follow the clock; nothing drops below the night floor
      hemi.color.copy(cur.hemiSky);
      hemi.groundColor.copy(cur.hemiGround);
      hemi.intensity = cur.hemi * (1 - wet * 0.35);
      dir.color.copy(cur.sun);
      dir.intensity = cur.dir * (1 - wet * 0.55);
      if (wet > 0.01) {
        hemi.color.lerp(new THREE.Color(0x8fa3bd), wet * 0.4);
        dir.color.lerp(new THREE.Color(0xcfd8e6), wet * 0.5);
      }
      amb.intensity = cur.amb + wet * 0.08;

      // the dome repaints only when the clock actually moved (~2 s of game time)
      if (Math.abs(hour - painted) > 0.01) {
        painted = hour;
        paintDome(wet);
      }
      // haze: the fog colour rides the palette; wet weather thickens the soup
      scene.fog!.color.copy(cur.fog);
      (scene.fog as THREE.FogExp2).density = 0.0075 + wet * 0.0045;

      // The shadow + shader sun is the BALL YOU SEE: take whichever of the
      // two is above the horizon, rotate it exactly as the orbit does, and
      // shadows provably fall away from the light in the sky (user: shadows
      // must follow the sun). Only one touch of prudence: the elevation is
      // never allowed to go quite horizontal — a horizontal sun throws
      // infinite shadows the follow box could never hold.
      const sunIsDown = elev < 0;
      sunWorldDir.copy(sunIsDown ? moon.position : sun.position)
        .applyAxisAngle(UP_Z, orbit.rotation.z)
        .normalize();
      // The glare must follow the ball's TRUE height, not the shadow sun's:
      // the floor below keeps frustums sane, but it would also peg the low
      // factor at 1 at high noon — a full-screen additive wash all day (and
      // a half-speed software rasteriser to go with it).
      const ballY = sunWorldDir.y;
      if (sunWorldDir.y < 0.198) { // ≥ ~11°, keeps frustums sane
        sunWorldDir.y = 0.198;
        sunWorldDir.normalize();
      }
      sunState.up = THREE.MathUtils.clamp(sunWorldDir.y, 0, 1)
        * (1 - wet * 0.6) * (sunIsDown ? 0.3 : 1);
      sunState.low = THREE.MathUtils.clamp((0.5 - sunWorldDir.y) / 0.3, 0, 1)
        * (1 - wet * 0.5) * (sunIsDown ? 0.2 : 1);
      sunState.tint.copy(dir.color);

      // Horizon glare: a warm wash that swells around the sun as it dips
      // toward the horizon — the bare ball used to read as a sticker. It
      // breathes slightly and hides when the sky itself is hidden (marks).
      // Both auras go INVISIBLE, not just transparent, when faded: a big
      // additive quad is the most expensive pixel this sky paints, and a
      // software rasteriser happily blends it at zero, forever.
      const glareLow = sunIsDown ? 0
        : THREE.MathUtils.clamp((0.5 - Math.max(ballY, 0)) / 0.3, 0, 1) * (1 - wet * 0.55);
      const glareOpacity = marks ? glareLow * glareLow * 0.5 : 0;
      glare.visible = glareOpacity > 0.004;
      if (glare.visible) {
        glare.scale.setScalar(34 + 96 * glareLow + Math.sin(kit.time * 0.7) * 3);
        (glare.material as THREE.SpriteMaterial).opacity = glareOpacity;
      }
      // The moon keeps a silver aura that deepens with the night.
      const haloOpacity = marks ? 0.10 + darkness * 0.16 : 0;
      moonHalo.visible = haloOpacity > 0.004;
      (moonHalo.material as THREE.SpriteMaterial).opacity = haloOpacity;

      // The shadow light hovers over the followed spot (Game points it at the
      // players). It lags the walk with a lerp, and snaps to the map's texel
      // grid, so standing still never makes the shadows swim.
      shadowFocus.lerp(shadowWant, Math.min(1, dt * 3));
      shadowTmp.copy(shadowFocus);
      shadowTmp.x = Math.round(shadowTmp.x / SHADOW_TEXEL) * SHADOW_TEXEL;
      shadowTmp.z = Math.round(shadowTmp.z / SHADOW_TEXEL) * SHADOW_TEXEL;
      dir.target.position.copy(shadowTmp);
      dir.position.copy(shadowTmp).addScaledVector(sunWorldDir, SHADOW_DIST);

      // clouds: gentle by default, thicker when weather brews; gone with no sky
      const cloudOpacity = marks ? 0.3 + wet * 0.5 + darkness * 0.1 : 0;
      clouds.update(dt, cloudOpacity, darkness);

      // rain/snow ride the camera the world is being rendered from
      precip.update(dt, camera);
    },
    dayPhase(): number {
      return dayMode === 'day' ? 0.5 : dayMode === 'night' ? 0.0 : phase;
    },
    setDayMode(mode: DayMode): void {
      dayMode = mode;
    },
    setWeather(kind: WeatherKind | null, intensity: number): void {
      weatherKind = kind;
      precip.set(kind, intensity);
    },
    getDome(): THREE.Mesh {
      return dome;
    },
    getSunLight(): THREE.DirectionalLight {
      return dir;
    },
    sunInfo(): SunState {
      return sunState;
    },
    focusShadow(x: number, y: number, z: number): void {
      shadowWant.set(x, y, z);
    },
    shadowFocusPos(): THREE.Vector3 {
      return shadowFocus;
    },
    sunBallDir(): THREE.Vector3 {
      // exactly the lit ball's direction — what the eye sees in the sky
      return shadowTmp
        .copy(sunElevation(curHour) < 0 ? moon.position : sun.position)
        .applyAxisAngle(UP_Z, orbit.rotation.z)
        .normalize();
    },
  };
}
