/**
 * Sky, lights, clouds, weather and the day-night cycle.
 *
 * The sun and moon circle the world once every `DAY_SECONDS`, and the lights,
 * fog and dome colours all follow the clock — morning gold at 0.25, high noon
 * at 0.5, sunset orange at 0.75, and a blue-black night that never goes truly
 * black (a pitch-black sky frightens kids, so the lights have a floor). Grown-ups
 * can park the clock at noon or midnight, or hide the sun and moon entirely
 * with the Flashlight option. Clouds darken and rain or snow starts and stops
 * on its own (or whenever a grown-up says so — core/weather.ts).
 */

import * as THREE from 'three';
import { WORLD_SX, WORLD_SZ } from '../core/world';
import { WeatherKind } from '../core/weather';

export const DAY_SECONDS = 12 * 60;
/** the sun's elevation at an hour of the day cycle (0..1); > 0 means it is up */
export function sunElevation(hour: number): number {
  return Math.sin(hour * Math.PI * 2);
}

/** A slow cloud field: puffy boxes that drift, darken with the weather, and
 *  (in Flashlight mode) fade away to a clean clear sky. */
class Clouds {
  private readonly field = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly tex: THREE.CanvasTexture;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly groups: THREE.Group[] = [];
  private readonly opacities: number[] = [];
  private readonly speeds: number[] = [];
  private readonly span = new THREE.Vector3(WORLD_SX * 2.6, 0, WORLD_SZ * 2.6);

  constructor(scene: THREE.Scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 128;
    this.canvas.height = 128;
    const ctx = this.canvas.getContext('2d')!;
    const paint = (color: string, alpha: number) => {
      ctx.clearRect(0, 0, 128, 128);
      ctx.fillStyle = color;
      for (const p of [
        [0.40, 0.52, 0.22], [0.56, 0.44, 0.24], [0.30, 0.60, 0.16],
        [0.66, 0.58, 0.18], [0.48, 0.62, 0.15],
      ]) {
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(p[0] * 128, p[1] * 128, p[2] * 128, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    paint('#ffffff', 0.82);
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, side: THREE.DoubleSide,
      depthWrite: false, fog: false, opacity: 0.8,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    let seed = 20261108;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 12; i++) {
      const puffs = new THREE.Group();
      const n = 4 + Math.floor(rnd() * 5);
      for (let p = 0; p < n; p++) {
        const m = new THREE.Mesh(geo, this.mat);
        const s = 14 + rnd() * 26;
        m.scale.set(s, s * (0.28 + rnd() * 0.18), 1);
        m.position.set((p - n / 2) * 11 + rnd() * 6, (rnd() - 0.5) * 4, (rnd() - 0.5) * 12);
        puffs.add(m);
      }
      puffs.rotation.x = -Math.PI / 2;
      puffs.position.set(
        (rnd() - 0.5) * this.span.x + WORLD_SX / 2,
        96 + rnd() * 36,
        (rnd() - 0.5) * this.span.z + WORLD_SZ / 2,
      );
      const sc = 0.7 + rnd() * 1.4;
      puffs.scale.setScalar(sc);
      this.field.add(puffs);
      this.groups.push(puffs);
      this.opacities.push(0.55 + rnd() * 0.4);
      this.speeds.push(2.2 + rnd() * 3.4);
    }
    scene.add(this.field);
  }

  /** paint the storm-grey variant once when the first cloud rolls in */
  setOvercast(on: boolean): void {
    const ctx = this.canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 62);
    if (on) {
      g.addColorStop(0, 'rgba(156,168,186,0.95)');
      g.addColorStop(1, 'rgba(156,168,186,0)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    }
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    this.tex.needsUpdate = true;
  }

  update(dt: number, darkness: number, wet: number, hidden: boolean): void {
    const fade = hidden ? 0 : 0.55 + darkness * 0.35 + wet * 0.4;
    this.field.visible = fade > 0.01;
    if (!this.field.visible) return;
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i];
      g.position.x += this.speeds[i] * dt;
      if (g.position.x > WORLD_SX / 2 + this.span.x / 2) g.position.x -= this.span.x;
      g.position.y = 96 + (i * 13) % 36 + Math.sin(this.field.position.x * 0.01 + i) * 2;
      void g;
    }
    this.mat.opacity = Math.min(0.96, fade * 0.9);
  }

  follow(worldX: number, worldZ: number): void {
    this.field.position.x = ((worldX * 0.6) % this.span.x + this.span.x) % this.span.x - this.span.x / 2 + WORLD_SX / 2;
    this.field.position.z = ((worldZ * 0.6) % this.span.z + this.span.z) % this.span.z - this.span.z / 2 + WORLD_SZ / 2;
  }
}

/** Rain or snow: one drifting Points cloud centred on the camera. */
class Precipitation {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly span = 52;
  private kind: WeatherKind | null = null;
  private intensity = 0;

  constructor(scene: THREE.Scene) {
    const n = 1600;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.respawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 16;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(8, 8, 1, 8, 8, 7);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 16, 16);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace;
      return t;
    })();
    const mat = new THREE.PointsMaterial({
      map: tex, color: 0xbcd6ef, size: 0.14, transparent: true, opacity: 0.85,
      depthWrite: false, sizeAttenuation: true, fog: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  private respawn(i: number, initial = false): void {
    const o = i * 3;
    this.pos[o] = (Math.random() - 0.5) * this.span;
    this.pos[o + 1] = initial ? Math.random() * 34 : 28 + Math.random() * 8;
    this.pos[o + 2] = (Math.random() - 0.5) * this.span;
  }

  set(kind: WeatherKind | null, intensity: number): void {
    if (kind === this.kind && intensity === this.intensity) return;
    const kindChanged = kind !== this.kind;
    this.kind = kind;
    this.intensity = intensity;
    const mat = this.points.material as THREE.PointsMaterial;
    this.points.visible = kind !== null && intensity > 0.02;
    if (!kind) return;
    if (kindChanged) {
      for (let i = 0; i < this.pos.length / 3; i++) this.respawn(i, true);
      (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    if (kind === 'snow') {
      mat.color.set(0xffffff);
      mat.size = 0.22;
      mat.opacity = 0.9;
    } else {
      mat.color.set(0xa9c8e8);
      mat.size = 0.12;
      mat.opacity = 0.8;
    }
  }

  update(dt: number, cam: THREE.Camera): void {
    if (!this.points.visible || !this.kind) return;
    const snow = this.kind === 'snow';
    const fall = snow ? 2.4 : 26;
    const sway = snow ? 1.6 : 0;
    const t = performance.now() * 0.001;
    for (let i = 0; i < this.pos.length / 3; i++) {
      const o = i * 3;
      this.pos[o + 1] -= (fall + (i % 7) * (snow ? 0.15 : 1.4)) * dt;
      this.pos[o] += Math.sin(t * 1.4 + i * 0.7) * sway * dt;
      this.pos[o + 2] += Math.cos(t * 1.1 + i * 0.3) * sway * dt;
      if (this.pos[o + 1] < -10) this.respawn(i);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.points.position.set(cam.position.x, cam.position.y + 14, cam.position.z);
  }
}

export interface SkyEnv {
  /**
   * Advance the sky by `dt` seconds of game time. `hour` is the day-phase
   * (0..1) that drives everything visible here.
   */
  update(dt: number, hour: number): void;
  /** park the sun and moon (Flashlight mode) instead of orbiting them */
  hideDaymarks(hidden: boolean): void;
  /** the dome (for tests and fog colour reads) */
  get dome(): THREE.Mesh;
}

export const SKY_RADIUS = 320;
export const SKY_CLEAR = 0xbfe0f5;
export const SKY_FAR = SKY_RADIUS + 200;

interface SkyStop {
  hour: number;
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

export function createSky(scene: THREE.Scene): SkyEnv {
  const sky = new THREE.Group();
  scene.add(sky);

  // gradient dome — vertex colours rewritten every few frames
  const domeGeo = new THREE.SphereGeometry(SKY_RADIUS, 24, 16);
  const colors = new Float32Array(domeGeo.attributes.position.count * 3);
  domeGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  sky.add(dome);

  // sun and moon ride a pivot so the whole system can orbit the world centre
  const orbit = new THREE.Group();
  sky.add(orbit);
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(11, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xfff2a8, fog: false }),
  );
  sun.position.set(0, 200, 0);
  orbit.add(sun);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(26, 20, 14),
    new THREE.MeshBasicMaterial({
      color: 0xffe9a0, fog: false, transparent: true, opacity: 0.35,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  glow.position.copy(sun.position);
  orbit.add(glow);
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(8, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xdde6f5, fog: false }),
  );
  moon.position.set(0, -210, 40);
  const moonGlow = new THREE.Mesh(
    new THREE.SphereGeometry(16, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xc7d8f2, fog: false, transparent: true, opacity: 0.2,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  moonGlow.position.copy(moon.position);
  orbit.add(moon, moonGlow);

  // stars: a quiet dome of points that fade in at dusk
  const starCount = 900;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection();
    if (v.y < 0.02) v.y = 0.02 + Math.random() * 0.4;
    v.normalize().multiplyScalar(SKY_RADIUS * 0.8);
    starPos.set([v.x, v.y, v.z], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 1.7, sizeAttenuation: false,
    transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -2;
  stars.frustumCulled = false;
  sky.add(stars);

  scene.fog = new THREE.Fog(SKY_CLEAR, 60, 240);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x9a8b6a, 1.05);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xfff6e0, 1.6);
  scene.add(dir);
  const amb = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(amb);

  // the palette. Night never goes black (a dark sky frightens kids).
  const stops: SkyStop[] = [
    { // midnight
      hour: 0.0,
      top: new THREE.Color(0x0a1330), horizon: new THREE.Color(0x22345c), fog: new THREE.Color(0x18274a),
      sun: new THREE.Color(0xbcd0ff), hemiSky: new THREE.Color(0x1d2c55), hemiGround: new THREE.Color(0x101a2c),
      hemi: 0.32, dir: 0.05, amb: 0.28,
    },
    { // dawn (the sun is just above the horizon)
      hour: 0.22,
      top: new THREE.Color(0x2c4a7c), horizon: new THREE.Color(0xf2b06a), fog: new THREE.Color(0x9fb6d6),
      sun: new THREE.Color(0xffd28a), hemiSky: new THREE.Color(0x7d96c4), hemiGround: new THREE.Color(0x6a5a44),
      hemi: 0.7, dir: 0.5, amb: 0.3,
    },
    { // morning
      hour: 0.34,
      top: new THREE.Color(0x4f86d8), horizon: new THREE.Color(0xcfe6f6), fog: new THREE.Color(0xbfe0f5),
      sun: new THREE.Color(0xfff0c2), hemiSky: new THREE.Color(0xcfe8ff), hemiGround: new THREE.Color(0x9a8b6a),
      hemi: 1.0, dir: 1.5, amb: 0.3,
    },
    { // noon — exactly what a kid booted the app to before the sun ever moved
      hour: 0.5,
      top: new THREE.Color(0x4585d8), horizon: new THREE.Color(0xd8ecfb), fog: new THREE.Color(0xbfe0f5),
      sun: new THREE.Color(0xfff6e0), hemiSky: new THREE.Color(0xcfe8ff), hemiGround: new THREE.Color(0x9a8b6a),
      hemi: 1.05, dir: 1.6, amb: 0.25,
    },
    { // afternoon
      hour: 0.68,
      top: new THREE.Color(0x4f7fd0), horizon: new THREE.Color(0xd8e2f0), fog: new THREE.Color(0xbdd6ea),
      sun: new THREE.Color(0xffe6bd), hemiSky: new THREE.Color(0xc4d8f2), hemiGround: new THREE.Color(0x8f8060),
      hemi: 0.95, dir: 1.45, amb: 0.27,
    },
    { // sunset
      hour: 0.78,
      top: new THREE.Color(0x2e4f88), horizon: new THREE.Color(0xf08a4b), fog: new THREE.Color(0x9aa9c9),
      sun: new THREE.Color(0xff9c52), hemiSky: new THREE.Color(0x6f7fb0), hemiGround: new THREE.Color(0x4d4234),
      hemi: 0.55, dir: 0.35, amb: 0.32,
    },
    { // dusk
      hour: 0.86,
      top: new THREE.Color(0x18264e), horizon: new THREE.Color(0x513a6a), fog: new THREE.Color(0x3a4a70),
      sun: new THREE.Color(0x9d7bd0), hemiSky: new THREE.Color(0x2f3f6b), hemiGround: new THREE.Color(0x1a2138),
      hemi: 0.4, dir: 0.12, amb: 0.3,
    },
    { // midnight again
      hour: 1.0,
      top: new THREE.Color(0x0a1330), horizon: new THREE.Color(0x22345c), fog: new THREE.Color(0x18274a),
      sun: new THREE.Color(0xbcd0ff), hemiSky: new THREE.Color(0x1d2c55), hemiGround: new THREE.Color(0x101a2c),
      hemi: 0.32, dir: 0.05, amb: 0.28,
    },
  ];

  const mix = (out: THREE.Color, a: THREE.Color, b: THREE.Color, k: number): void => {
    out.copy(a).lerp(b, k);
  };
  const sample = (hour: number, out: SkyStop): void => {
    let i = 0;
    while (i < stops.length - 2 && hour >= stops[i + 1].hour) i++;
    const a = stops[i];
    const b = stops[i + 1];
    const k = (hour - a.hour) / Math.max(1e-6, b.hour - a.hour);
    mix(out.top, a.top, b.top, k);
    mix(out.horizon, a.horizon, b.horizon, k);
    mix(out.fog, a.fog, b.fog, k);
    mix(out.sun, a.sun, b.sun, k);
    mix(out.hemiSky, a.hemiSky, b.hemiSky, k);
    mix(out.hemiGround, a.hemiGround, b.hemiGround, k);
    out.hemi = a.hemi + (b.hemi - a.hemi) * k;
    out.dir = a.dir + (b.dir - a.dir) * k;
    out.amb = a.amb + (b.amb - a.amb) * k;
  };
  const cur: SkyStop = {
    hour: 0.5, top: new THREE.Color(), horizon: new THREE.Color(), fog: new THREE.Color(),
    sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
    hemi: 1, dir: 1, amb: 0.25,
  };

  const pos = domeGeo.attributes.position as THREE.BufferAttribute;
  const paintDome = (stop: SkyStop, rain: number): void => {
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / SKY_RADIUS;
      const t = Math.max(0, Math.min(1, (y + 0.12) / 0.55));
      const c = new THREE.Color().copy(stop.horizon).lerp(stop.top, t * t * 0.75 + t * 0.25);
      c.lerp(stop.fog, rain * 0.55);
      c.toArray(colors, i * 3);
    }
    (domeGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  };

  const clouds = new Clouds(scene);
  const precip = new Precipitation(scene);
  let overcast = false;
  let rainT = 0;
  let lastRain = 0;
  let lastHour = -1;

  return {
    update(dt: number, hour: number): void {
      sample(hour, cur);
      const elev = sunElevation(hour);
      orbit.rotation.z = (hour + 0.75) * Math.PI * 2; // noon = sun overhead
      sun.position.y = 200 * Math.sin(elev * Math.PI * 0.5);
      sun.position.x = 200 * Math.cos(elev * Math.PI * 0.5) * 0.6;
      glow.position.copy(sun.position);
      glow.visible = sun.visible = elev > -0.05;

      const darkness = Math.max(0, Math.min(1, -elev * 1.4 + 0.22));
      starMat.opacity = Math.min(0.9, Math.max(0, darkness * 1.1 - 0.15));

      const rain = rainT;
      hemi.color.copy(cur.hemiSky).lerp(new THREE.Color(0x6c7891), rain * 0.65);
      hemi.groundColor.copy(cur.hemiGround);
      hemi.intensity = cur.hemi * (1 - rain * 0.25);
      dir.color.copy(cur.sun);
      dir.intensity = cur.dir * (1 - rain * 0.55);
      dir.position.set(sun.position.x * 0.5 + 40, Math.max(30, sun.position.y * 0.5 + 30), sun.position.z * 0.5 - 40);
      amb.color.copy(cur.hemiSky);
      amb.intensity = cur.amb + darkness * 0.06;

      if (Math.abs(hour - lastHour) > 0.004) {
        lastHour = hour;
        paintDome(cur, rain);
      }
      scene.fog!.color.copy(cur.fog).lerp(cur.horizon, rain * 0.25);
      (scene.fog as THREE.Fog).near = 60 - rain * 8;
      (scene.fog as THREE.Fog).far = 240 - rain * 90;

      // clouds fade in with weather; rain darkens them
      clouds.update(dt, darkness, rain, false);
      if ((rain > 0.05) !== overcast) {
        overcast = rain > 0.05;
        clouds.setOvercast(overcast);
      }

      // rain: a soft hiss the whole time it falls
      if (rainT > 0.02) {
        rainT = Math.max(0, rainT - dt * 0.35);
        if (this._audio && performance.now() - lastRain > 900) {
          lastRain = performance.now();
          this._audio.rainLoop(rainT);
        }
      }
    },
    hideDaymarks(): void {
      orbit.visible = false;
    },
    get dome(): THREE.Mesh {
      return dome;
    },
  } as SkyEnv & { _audio?: { rainLoop(i: number): void } };
}
