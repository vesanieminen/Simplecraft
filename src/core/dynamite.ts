/**
 * Dynamite. A placed stick starts burning its fuse straight away: it spits
 * sparks, wobbles, hisses and the ticks speed up — so children can *hear* and
 * *see* how long they have — and then it blows a nice round hole in the world,
 * sends the animals tumbling (unharmed) and sets off its neighbours.
 *
 * The stick itself is an ordinary voxel painted from the block texture atlas,
 * so it lives in saves, blocks things and gets carved by other blasts. This
 * manager owns the animated fuse sitting on top of it and the blast effects.
 */

import * as THREE from 'three';
import { AIR, blockDef, DIRT, DYNAMITE, GRASS, SAND, SCORCH, WATER } from './blocks';
import { idx as worldIdx, World, WORLD_SY, WORLD_SZ } from './world';
import { ParticleSystem } from './particles';
import { AudioKit } from './audio';

export interface BlastInfo {
  x: number; y: number; z: number;
  radius: number;
  /** flat world indices the blast removed (so listeners can tidy up) */
  removed: number[];
}

interface Lit {
  x: number; y: number; z: number;
  fuse: number;
  total: number;
  group: THREE.Group;
  /** the fuse: index 0 sits on the block, the last one is the tip */
  puffs: THREE.Mesh[];
  tip: THREE.Mesh;
  glow: THREE.Mesh;
  warn: THREE.Sprite;
  sparkTimer: number;
  tickTimer: number;
  rushDone: boolean;
  age: number;
}

interface Flash {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  ttl: number;
  size: number;
}

const FUSE_PUFFS = 4;
export const BLAST_RADIUS = 3.4;
const CHAIN_RANGE = BLAST_RADIUS * 2.4;

const fuseGeo = new THREE.BoxGeometry(0.075, 0.13, 0.075);
const tipGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const glowGeo = new THREE.SphereGeometry(0.24, 10, 8);
const flashGeo = new THREE.SphereGeometry(1, 14, 10);

let warnTexture: THREE.CanvasTexture | null = null;

/**
 * The "run!" marker over a burning stick, drawn with rects instead of a font
 * so it looks the same on every machine (headless browsers have no emoji).
 */
function warningTexture(): THREE.CanvasTexture {
  if (warnTexture) return warnTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 32, 32);
  g.fillStyle = '#ffd23e';
  g.fillRect(4, 2, 24, 26);
  g.fillStyle = '#8a5a12';
  g.fillRect(4, 26, 24, 2);
  g.fillRect(26, 2, 2, 26);
  g.fillStyle = '#3a2a12';
  g.fillRect(14, 7, 5, 12); // exclamation stem
  g.fillRect(14, 21, 5, 5); // and dot
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  warnTexture = tex;
  return tex;
}

export class DynamiteManager {
  private lit = new Map<number, Lit>();
  private flashes: Flash[] = [];
  /** how many blasts have gone off (handy for tests and for bragging) */
  blastCount = 0;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private particles: ParticleSystem,
    private audio: AudioKit,
    private onBlast: (b: BlastInfo) => void,
  ) {
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false,
      });
      const mesh = new THREE.Mesh(flashGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.flashes.push({ mesh, mat, age: 0, ttl: 1, size: 1 });
    }
  }

  get active(): number {
    return this.lit.size;
  }

  isLit(x: number, y: number, z: number): boolean {
    return this.lit.has(worldIdx(x, y, z));
  }

  /**
   * The block in this cell is already DYNAMITE: start (or shorten) its fuse.
   * Hitting a burning stick with the break button re-lights the stub, so it
   * pops almost at once instead of coming off like a normal block.
   */
  light(x: number, y: number, z: number, fuse?: number): void {
    const key = worldIdx(x, y, z);
    const existing = this.lit.get(key);
    if (existing) {
      existing.fuse = fuse ?? 0.4;
      existing.total = Math.max(existing.fuse, 0.4);
      existing.rushDone = false;
      existing.tickTimer = 0;
      existing.sparkTimer = 0;
      return;
    }
    if (this.world.get(x, y, z) !== DYNAMITE) return;

    const total = fuse ?? blockDef(DYNAMITE).fuse ?? 2.6;
    const group = new THREE.Group();
    group.userData.fuse = true; // so tests (and any later tidy-up) can spot a fuse rig
    group.position.set(x + 0.5, y + 1, z + 0.5);

    const puffs: THREE.Mesh[] = [];
    for (let i = 0; i < FUSE_PUFFS; i++) {
      const m = new THREE.Mesh(fuseGeo, new THREE.MeshLambertMaterial({ color: 0x6d5a44 }));
      m.position.y = 0.06 + i * 0.095;
      m.rotation.y = i * 0.9; // a slight squiggle up the fuse
      group.add(m);
      puffs.push(m);
    }
    const tip = new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({
      color: 0xffd24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    group.add(tip);
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
      color: 0xffa53a, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glow.position.y = 0.16;
    group.add(glow);
    const warn = new THREE.Sprite(new THREE.SpriteMaterial({
      map: warningTexture(), transparent: true, depthWrite: false, fog: false,
    }));
    warn.position.y = 1.35;
    warn.scale.setScalar(0.56);
    group.add(warn);

    this.scene.add(group);
    this.lit.set(key, {
      x, y, z, fuse: total, total, group, puffs, tip, glow, warn,
      sparkTimer: 0, tickTimer: 0.12, rushDone: false, age: 0,
    });
    this.audio.dynamiteLight();
  }

  /** new world / reset: forget every burning stick (and its fuse meshes) */
  clear(): void {
    for (const [key] of [...this.lit]) this.extinguish(key);
  }

  /** sticks that came back from a save are still sticks: give them fuses */
  restoreFromWorld(): void {
    this.clear();
    for (const [i, id] of this.world.mods) {
      if (id !== DYNAMITE) continue;
      const x = Math.floor(i / (WORLD_SZ * WORLD_SY));
      const rest = i - x * WORLD_SZ * WORLD_SY;
      const z = Math.floor(rest / WORLD_SY);
      const y = rest - z * WORLD_SY;
      if (this.world.get(x, y, z) === DYNAMITE) this.light(x, y, z);
    }
  }

  update(dt: number): void {
    for (const f of this.flashes) {
      if (f.mat.opacity <= 0) continue;
      f.age += dt;
      const k = f.age / f.ttl;
      if (k >= 1) {
        f.mat.opacity = 0;
        f.mesh.visible = false;
        continue;
      }
      f.mat.opacity = (1 - k) * (1 - k) * 0.95;
      f.mesh.scale.setScalar(f.size * (0.3 + k * 1.15));
      f.mat.color.setRGB(1, 0.62 + (1 - k) * 0.35, 0.3 + (1 - k) * 0.55);
    }

    if (this.lit.size === 0) return;

    let soundBudget = 2; // a room full of sticks should not machine-gun
    for (const [key, l] of [...this.lit]) {
      // a neighbour's blast may have carved this stick away this same frame
      if (this.world.get(l.x, l.y, l.z) !== DYNAMITE) {
        this.extinguish(key);
        continue;
      }
      l.age += dt;
      l.fuse -= dt;
      const burned = Math.max(0, Math.min(1, 1 - l.fuse / l.total)); // 0 whole -> 1 gone
      const panic = Math.max(0, Math.min(1, 1 - l.fuse / 0.9));

      // the fuse burns down from the tip
      const remaining = l.puffs.length - Math.floor(burned * l.puffs.length);
      for (let i = 0; i < l.puffs.length; i++) l.puffs[i].visible = i < remaining;
      const tipY = remaining > 0 ? 0.06 + (remaining - 1) * 0.095 : 0.02;
      l.tip.position.set(0, tipY, 0);
      l.tip.scale.setScalar((0.8 + Math.sin(l.age * 41) * 0.2 + Math.random() * 0.15) * (1 + panic * 0.5));
      l.glow.scale.setScalar((0.5 + panic * 0.8) * (0.9 + Math.sin(l.age * 13) * 0.12));
      (l.glow.material as THREE.MeshBasicMaterial).opacity = 0.12 + panic * 0.26;
      l.warn.position.y = 1.35 + Math.sin(l.age * 6) * 0.1;
      l.warn.material.opacity = 0.7 + Math.sin(l.age * 11) * 0.3;

      // and it rattles, harder as the fuse runs out
      const shake = 0.02 + panic * 0.06;
      l.group.position.set(
        l.x + 0.5 + (Math.random() - 0.5) * shake,
        l.y + 1 + Math.sin(l.age * 17) * 0.015 * (1 + panic * 3),
        l.z + 0.5 + (Math.random() - 0.5) * shake,
      );
      l.group.rotation.z = (Math.random() - 0.5) * (0.04 + panic * 0.12);

      // sparks and a little smoke off the burning tip
      l.sparkTimer -= dt;
      while (l.sparkTimer <= 0) {
        l.sparkTimer += 1 / (24 + panic * 40);
        const px = l.x + 0.5, py = l.y + 1 + tipY, pz = l.z + 0.5;
        this.particles.spawn(px, py, pz, Math.random() < 0.35 ? 0xfff2a8 : 0xffa53a, {
          vx: (Math.random() - 0.5) * 2.4, vy: 1.4 + Math.random() * 1.8, vz: (Math.random() - 0.5) * 2.4,
          ttl: 0.25 + Math.random() * 0.3, size: 0.06 + Math.random() * 0.05, gravity: -9, spin: 12,
        });
        if (Math.random() < 0.35) {
          this.particles.spawn(px, py + 0.1, pz, 0x9a958d, {
            vx: (Math.random() - 0.5) * 0.6, vy: 1.1 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.6,
            ttl: 0.8 + Math.random() * 0.5, size: 0.14 + Math.random() * 0.12, gravity: 1.2, spin: 2,
          });
        }
      }

      // the hiss: ticks that speed up and get louder
      l.tickTimer -= dt;
      if (l.tickTimer <= 0) {
        l.tickTimer = 0.34 - burned * 0.26;
        if (soundBudget > 0) {
          soundBudget--;
          this.audio.fuseTick(0.7 + panic * 0.9);
        }
      }
      if (!l.rushDone && l.fuse <= 0.55) {
        l.rushDone = true;
        if (soundBudget > 0) {
          soundBudget--;
          this.audio.fuseRush();
        }
      }

      if (l.fuse <= 0) this.explode(l.x, l.y, l.z);
    }
  }

  /** blow a round hole in the world centred on this block */
  explode(x: number, y: number, z: number): void {
    this.extinguish(worldIdx(x, y, z));
    this.blastCount++;

    const r = BLAST_RADIUS + (Math.random() - 0.5) * 0.7;
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    const removed: number[] = [];
    const debris: { x: number; y: number; z: number; color: number }[] = [];
    const rInt = Math.ceil(r);

    for (let bx = x - rInt; bx <= x + rInt; bx++) {
      for (let bz = z - rInt; bz <= z + rInt; bz++) {
        for (let by = Math.max(1, y - rInt); by <= Math.min(WORLD_SY - 1, y + rInt); by++) {
          const id = this.world.get(bx, by, bz);
          if (id === AIR) continue;
          const def = blockDef(id);
          if (def.unbreakable || id === WATER) continue; // bedrock and water win
          const d = Math.hypot(bx + 0.5 - cx, by + 0.5 - cy, bz + 0.5 - cz);
          if (d + (Math.random() - 0.5) * 0.6 > r) continue;
          this.world.set(bx, by, bz, AIR);
          removed.push(worldIdx(bx, by, bz));
          if (id !== DYNAMITE && id !== SCORCH && debris.length < 170) {
            debris.push({
              x: bx, y: by, z: bz,
              color: (Math.round(def.color[0] * 255) << 16)
                | (Math.round(def.color[1] * 255) << 8) | Math.round(def.color[2] * 255),
            });
          }
        }
      }
    }

    // scorch the rim so the blast leaves a mark on the map (a rim, not a field)
    for (let bx = x - rInt - 1; bx <= x + rInt + 1; bx++) {
      for (let bz = z - rInt - 1; bz <= z + rInt + 1; bz++) {
        const flat = Math.hypot(bx + 0.5 - cx, bz + 0.5 - cz);
        if (flat > r + 0.5 || flat < r - 1.6) continue;
        const sy = this.world.surfaceY(bx, bz);
        if (sy <= 0) continue;
        const top = this.world.get(bx, sy, bz);
        if (top === GRASS || top === DIRT || top === SAND) this.world.set(bx, sy, bz, SCORCH);
      }
    }

    // fireball flash of particles, chunky debris in the colours of what went,
    // and a lazy ring of smoke
    this.particles.spawn(cx, cy + 0.4, cz, 0xfff6c8, {
      vx: 0, vy: 2.4, vz: 0, ttl: 0.26, size: r * 0.9, gravity: 0, spin: 3,
    });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random();
      this.particles.spawn(cx, cy + 0.3, cz, i % 3 === 0 ? 0xff7a2f : 0xffc94a, {
        vx: Math.cos(a) * (3 + e * 7), vy: 2.5 + e * 7, vz: Math.sin(a) * (3 + e * 7),
        ttl: 0.35 + Math.random() * 0.4, size: 0.2 + Math.random() * 0.3, gravity: -6, spin: 9,
      });
    }
    for (const d of debris) {
      const dx = d.x + 0.5 - cx, dy = d.y + 0.5 - cy, dz = d.z + 0.5 - cz;
      const len = Math.max(0.001, Math.hypot(dx, dy, dz));
      this.particles.spawn(d.x + 0.5, d.y + 0.5, d.z + 0.5, d.color, {
        vx: (dx / len) * (4 + Math.random() * 5),
        vy: (dy / len) * 4 + 3.5 + Math.random() * 5,
        vz: (dz / len) * (4 + Math.random() * 5),
        ttl: 0.9 + Math.random() * 0.7, size: 0.16 + Math.random() * 0.16, gravity: -13, spin: 10,
      });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.spawn(
        cx + Math.cos(a) * r * 0.6, cy + 1.4 + Math.random() * 2, cz + Math.sin(a) * r * 0.6,
        i % 2 ? 0x8d8779 : 0xb9b3a6, {
          vx: Math.cos(a) * 1.4, vy: 1.6 + Math.random() * 1.4, vz: Math.sin(a) * 1.4,
          ttl: 1.4 + Math.random() * 0.8, size: 0.4 + Math.random() * 0.5, gravity: 1.4, spin: 1.5,
        });
    }

    // the light: one expanding additive sphere from the pool
    const f = this.flashes.find((fl) => fl.mat.opacity <= 0) ?? this.flashes[0];
    f.age = 0;
    f.ttl = 0.3;
    f.size = r * 0.95;
    f.mesh.position.set(cx, cy, cz);
    f.mesh.visible = true;
    f.mat.opacity = 0.95;

    this.audio.boom(1);

    // neighbours catch light too — chain reactions are the best part
    for (const l of [...this.lit.values()]) {
      if (Math.hypot(l.x - x, l.y - y, l.z - z) <= CHAIN_RANGE) {
        this.light(l.x, l.y, l.z, 0.12 + Math.random() * 0.3);
      }
    }

    this.onBlast({ x, y, z, radius: r, removed });
  }

  private extinguish(key: number): void {
    const l = this.lit.get(key);
    if (!l) return;
    this.lit.delete(key);
    this.scene.remove(l.group);
    for (const m of [l.tip, l.glow, ...l.puffs]) (m.material as THREE.Material).dispose();
    l.warn.material.dispose();
  }
}
