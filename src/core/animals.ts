/**
 * Friendly voxel animals: sheep, bunnies, chickens, cows.
 * They wander near their birth spot, hop when petted, never hurt anyone.
 */

import * as THREE from 'three';
import { WATER } from './blocks';
import { World, WORLD_SX, WORLD_SZ } from './world';
import { ParticleSystem } from './particles';
import { AudioKit } from './audio';

export type AnimalKind = 'sheep' | 'bunny' | 'chicken' | 'cow';

interface AnimalDefArt {
  body: number;
  head: number;
  scale: number;
}

const ART: Record<AnimalKind, AnimalDefArt> = {
  sheep: { body: 0xf7f3ee, head: 0x3f4653, scale: 1.0 },
  bunny: { body: 0xffe9e0, head: 0xffe9e0, scale: 0.62 },
  chicken: { body: 0xffffff, head: 0xffffff, scale: 0.55 },
  cow: { body: 0xf5f0e8, head: 0x454b57, scale: 1.25 },
};

export class Animal {
  kind: AnimalKind;
  pos: THREE.Vector3; // feet
  yaw = 0;
  private targetYaw = 0;
  private state: 'idle' | 'walk' = 'idle';
  private timer = 0;
  private homeX: number;
  private homeZ: number;
  private walkPhase = 0;
  private hopT = 0; // >0 while doing a happy hop
  private tumbleT = 0; // >0 while blown head over heels
  private tumbleTotal = 1;
  private tvx = 0;
  private tvz = 0;
  group: THREE.Group;
  private legs: THREE.Object3D[] = [];
  private bodyMesh: THREE.Mesh;

  constructor(kind: AnimalKind, x: number, y: number, z: number) {
    this.kind = kind;
    this.pos = new THREE.Vector3(x, y, z);
    this.homeX = x;
    this.homeZ = z;
    const art = ART[kind];
    const s = art.scale;
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: art.body });
    const headMat = new THREE.MeshLambertMaterial({ color: art.head });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.75 * s, 0.55 * s, 0.95 * s), bodyMat);
    body.position.y = 0.62 * s;
    g.add(body);
    this.bodyMesh = body;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42 * s, 0.42 * s, 0.4 * s), headMat);
    head.position.set(0, 0.85 * s, 0.5 * s);
    g.add(head);

    // face: two dots
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x20262f });
    for (const ex of [-0.1, 0.1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06 * s, 0.06 * s, 0.02), eyeMat);
      eye.position.set(ex * s, 0.9 * s, 0.705 * s);
      g.add(eye);
    }

    if (kind === 'bunny') {
      for (const ex of [-0.12, 0.12]) {
        const ear = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.42 * s, 0.08 * s), bodyMat);
        ear.position.set(ex * s, 1.22 * s, 0.45 * s);
        g.add(ear);
      }
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.16 * s, 0.12 * s), headMat);
      tail.position.set(0, 0.6 * s, -0.52 * s);
      g.add(tail);
    }
    if (kind === 'chicken') {
      const beak = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 0.1 * s, 0.12 * s), new THREE.MeshLambertMaterial({ color: 0xffa63e }));
      beak.position.set(0, 0.82 * s, 0.72 * s);
      g.add(beak);
      const comb = new THREE.Mesh(new THREE.BoxGeometry(0.08 * s, 0.12 * s, 0.1 * s), new THREE.MeshLambertMaterial({ color: 0xff5d5d }));
      comb.position.set(0, 1.1 * s, 0.5 * s);
      g.add(comb);
    }
    if (kind === 'sheep') {
      const wool = new THREE.Mesh(new THREE.BoxGeometry(0.6 * s, 0.35 * s, 0.7 * s), new THREE.MeshLambertMaterial({ color: 0xffffff }));
      wool.position.y = 0.9 * s;
      g.add(wool);
    }
    if (kind === 'cow') {
      const spot = new THREE.Mesh(new THREE.BoxGeometry(0.4 * s, 0.2 * s, 0.5 * s), new THREE.MeshLambertMaterial({ color: 0x3c424d }));
      spot.position.set(0.18 * s, 0.78 * s, -0.1 * s);
      g.add(spot);
      for (const ex of [-0.16, 0.16]) {
        const horn = new THREE.Mesh(new THREE.BoxGeometry(0.07 * s, 0.12 * s, 0.07 * s), new THREE.MeshLambertMaterial({ color: 0xe8d9b0 }));
        horn.position.set(ex * s, 1.1 * s, 0.5 * s);
        g.add(horn);
      }
    }

    // legs
    const legMat = new THREE.MeshLambertMaterial({ color: kind === 'sheep' || kind === 'cow' ? 0x565d68 : art.body });
    for (const [lx, lz] of [[-0.22, 0.3], [0.22, 0.3], [-0.22, -0.3], [0.22, -0.3]]) {
      const pivot = new THREE.Object3D();
      pivot.position.set(lx * s, 0.42 * s, lz * s);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.42 * s, 0.16 * s), legMat);
      leg.position.y = -0.21 * s;
      pivot.add(leg);
      g.add(pivot);
      this.legs.push(pivot);
    }

    // blob shadow
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.5 * s, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    g.add(shadow);

    this.group = g;
    this.group.position.copy(this.pos);
    this.timer = Math.random() * 3;
  }

  /** happy hop when petted */
  pet(): void {
    this.hopT = 0.6;
  }

  /**
   * Sent head over heels by a blast: cartoonish tumbling, never any harm —
   * they land, shake it off and go back to wandering.
   */
  blast(dx: number, dz: number, power: number): void {
    this.tumbleT = 0.7 + power * 0.3;
    this.tumbleTotal = this.tumbleT;
    this.tvx = dx * (3.5 + power * 4);
    this.tvz = dz * (3.5 + power * 4);
    this.state = 'idle';
    this.timer = 1.5 + Math.random() * 2;
  }

  get isTumbling(): boolean {
    return this.tumbleT > 0;
  }

  get isHopping(): boolean {
    return this.hopT > 0;
  }

  update(dt: number, world: World): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.state === 'idle') {
        this.state = 'walk';
        this.timer = 2 + Math.random() * 3;
        const ang = Math.random() * Math.PI * 2;
        const dist = 1.5 + Math.random() * 4;
        const tx = this.homeX + Math.cos(ang) * dist;
        const tz = this.homeZ + Math.sin(ang) * dist;
        if (this.walkable(world, tx, tz)) {
          this.targetYaw = Math.atan2(tx - this.pos.x, tz - this.pos.z);
        } else {
          this.targetYaw = Math.atan2(this.homeX - this.pos.x, this.homeZ - this.pos.z);
        }
      } else {
        this.state = 'idle';
        this.timer = 1.5 + Math.random() * 3.5;
      }
    }

    if (this.state === 'walk' && this.tumbleT <= 0) {
      // turn toward target
      let d = this.targetYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += Math.max(-2 * dt, Math.min(2 * dt, d));
      const speed = 1.1 * ART[this.kind].scale * 1.4;
      const nx = this.pos.x + Math.sin(this.yaw) * speed * dt;
      const nz = this.pos.z + Math.cos(this.yaw) * speed * dt;
      if (this.walkable(world, nx, nz)) {
        this.pos.x = nx;
        this.pos.z = nz;
        this.walkPhase += dt * 8;
      } else {
        this.targetYaw = Math.atan2(this.homeX - this.pos.x, this.homeZ - this.pos.z);
      }
    }

    // stick to surface
    const sy = world.surfaceY(Math.floor(this.pos.x), Math.floor(this.pos.z)) + 1;
    this.pos.y += (sy - this.pos.y) * Math.min(1, dt * 10);

    // happy hop animation
    let hopY = 0;
    if (this.hopT > 0) {
      this.hopT -= dt;
      hopY = Math.sin(Math.min(1, 1 - this.hopT / 0.6) * Math.PI) * 0.9;
      this.yaw += dt * 6;
    }

    // being blown along: a big silly arc, spinning, then they land and stand up
    let tumbleY = 0;
    let roll = 0;
    if (this.tumbleT > 0) {
      this.tumbleT -= dt;
      const k = Math.max(0, this.tumbleT / this.tumbleTotal);
      const nx = this.pos.x + this.tvx * dt;
      const nz = this.pos.z + this.tvz * dt;
      if (nx > 2 && nz > 2 && nx < WORLD_SX - 2 && nz < WORLD_SZ - 2) {
        this.pos.x = nx;
        this.pos.z = nz;
      }
      const drag = 1 - Math.min(1, dt * 2.4);
      this.tvx *= drag;
      this.tvz *= drag;
      this.yaw += dt * 13;
      tumbleY = Math.sin(Math.min(1, 1 - this.tumbleT / this.tumbleTotal) * Math.PI) * (1.1 + k * 1.6);
      roll = Math.sin(this.yaw * 2.2) * 0.55 * k;
    }

    this.group.position.set(this.pos.x, this.pos.y + hopY + tumbleY, this.pos.z);
    this.group.rotation.y = this.yaw;
    this.group.rotation.z = roll;
    const swing = this.state === 'walk' ? Math.sin(this.walkPhase) * 0.6 : 0;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.legs[2].rotation.x = -swing;
    this.legs[3].rotation.x = swing;
    this.bodyMesh.position.y = ART[this.kind].scale * (0.62 + Math.sin(this.walkPhase * 2) * 0.02);
  }

  private walkable(world: World, x: number, z: number): boolean {
    if (x < 2 || z < 2 || x > WORLD_SX - 2 || z > WORLD_SZ - 2) return false;
    const bx = Math.floor(x), bz = Math.floor(z);
    const top = world.surfaceY(bx, bz);
    if (top < 0) return false;
    if (world.get(bx, top + 1, bz) === WATER || world.get(bx, top + 1, bz) !== 0) return false;
    const cur = world.surfaceY(Math.floor(this.pos.x), Math.floor(this.pos.z));
    return Math.abs(top - cur) <= 1;
  }
}

export class AnimalWorld {
  animals: Animal[] = [];

  constructor(
    scene: THREE.Scene,
    private world: World,
    private particles: ParticleSystem,
    private audio: AudioKit,
    spawnX: number,
    spawnZ: number,
  ) {
    const kinds: AnimalKind[] = ['sheep', 'bunny', 'chicken', 'cow'];
    let seed = (world.seed ^ 0x5eed) & 0x7fffffff;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let placed = 0;
    let tries = 0;
    while (placed < 28 && tries < 1400) {
      tries++;
      const x = 4 + rnd() * (WORLD_SX - 8);
      const z = 4 + rnd() * (WORLD_SZ - 8);
      if (Math.hypot(x - spawnX, z - spawnZ) < 6) continue; // not on top of spawn
      const bx = Math.floor(x), bz = Math.floor(z);
      const top = world.surfaceY(bx, bz);
      if (top < 0 || world.get(bx, top + 1, bz) !== 0) continue;
      const surfaceBlock = world.get(bx, top, bz);
      if (surfaceBlock === WATER) continue;
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const a = new Animal(kind, x, top + 1, z);
      this.animals.push(a);
      scene.add(a.group);
      placed++;
    }
  }

  update(dt: number): void {
    for (const a of this.animals) a.update(dt, this.world);
  }

  /** pet the animal closest to the given position within radius */
  petNearest(x: number, y: number, z: number, radius = 2.4): Animal | null {
    let best: Animal | null = null;
    let bestD = radius;
    for (const a of this.animals) {
      const d = Math.hypot(a.pos.x - x, a.pos.y - y, a.pos.z - z);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    if (best) {
      best.pet();
      this.audio.animal(best.kind);
      this.particles.burst(best.pos.x, best.pos.y + 1.2, best.pos.z, 0xff8ab4, 6, 0.6);
    }
    return best;
  }

  /**
   * A blast went off nearby: everyone in range goes flying, legs and all. They
   * are completely fine — it is a cartoon tumble, and the bleating is the fun
   * part. Returns how many animals were launched.
   */
  blastAway(x: number, y: number, z: number, radius: number): number {
    const range = radius * 2.2;
    let hit = 0;
    for (const a of this.animals) {
      const dx = a.pos.x - x, dy = a.pos.y - y, dz = a.pos.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range) continue;
      const len = Math.max(0.001, Math.hypot(dx, dz));
      a.blast(dx / len, dz / len, 1 - d / range);
      if (hit < 3) this.audio.animal(a.kind); // a few surprised noises, not a chorus
      hit++;
    }
    return hit;
  }
}
