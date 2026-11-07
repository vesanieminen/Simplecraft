/**
 * The fish that live in every lake, pond and sea: minnows, sunfish, puffers,
 * bass and the rare golden fish. The little ones travel in schools — a shared
 * anchor wanders through the water and the school swims with it — while the
 * bigger ones prowl alone. Fish stay inside water, dart away from kids who
 * swim too close, and can be caught with a fishing line (see core/fishing.ts).
 * The population is seeded from the world seed and rebuilt with the world,
 * exactly like the animals — no fish are saved with the world.
 */

import * as THREE from 'three';
import { isWaterId } from './blocks';
import { ParticleSystem } from './particles';
import { World, WORLD_SX, WORLD_SY, WORLD_SZ } from './world';

export type FishKind = 'minnow' | 'sunfish' | 'puffer' | 'bass' | 'golden';

export interface FishDef {
  name: string;
  icon: string;
  body: number;
  fin: number;
  belly: number;
  /** body box (w h l) in blocks, multiplied by scale */
  bw: number;
  bh: number;
  bl: number;
  scale: number;
  /** cruising speed in blocks of game time */
  speed: number;
  /** does this kind travel in a school? */
  schooling: boolean;
  schoolSize: [number, number];
  /** stars handed out when fishing reels one in */
  stars: number;
  /** fishing odds: weight / total weight (see pickFishKind) */
  weight: number;
}

export const FISH_DEFS: Record<FishKind, FishDef> = {
  minnow: {
    name: 'Minnow', icon: '🐟', body: 0x8fd7f2, fin: 0x5fb4e8, belly: 0xf4fbff,
    bw: 0.34, bh: 0.3, bl: 0.8, scale: 0.55, speed: 1.9,
    schooling: true, schoolSize: [5, 8], stars: 1, weight: 30,
  },
  sunfish: {
    name: 'Sunfish', icon: '🐠', body: 0xffb84d, fin: 0xff8c3a, belly: 0xfff1c9,
    bw: 0.3, bh: 0.72, bl: 0.72, scale: 0.6, speed: 1.25,
    schooling: true, schoolSize: [3, 5], stars: 2, weight: 24,
  },
  puffer: {
    name: 'Puffer', icon: '🐡', body: 0xffe14d, fin: 0xffb84d, belly: 0xfff6d8,
    bw: 0.7, bh: 0.62, bl: 0.7, scale: 0.55, speed: 0.65,
    schooling: false, schoolSize: [1, 1], stars: 3, weight: 14,
  },
  bass: {
    name: 'Bass', icon: '🎣', body: 0x7cc06a, fin: 0x5d9e50, belly: 0xeef6da,
    bw: 0.42, bh: 0.5, bl: 0.95, scale: 0.7, speed: 1.1,
    schooling: false, schoolSize: [1, 1], stars: 4, weight: 18,
  },
  golden: {
    name: 'Golden Fish', icon: '👑', body: 0xffd24a, fin: 0xffb300, belly: 0xfff0b8,
    bw: 0.36, bh: 0.4, bl: 0.8, scale: 0.6, speed: 2.3,
    schooling: false, schoolSize: [1, 1], stars: 12, weight: 6,
  },
};

export const FISH_KINDS: FishKind[] = ['minnow', 'sunfish', 'puffer', 'bass', 'golden'];

/**
 * One fish for the fishing table. `nearby` (the kinds actually living in this
 * water, see FishWorld.nearbyKinds) swim into the pot three times heavier, so
 * what you catch mostly lives where you are fishing.
 */
export function pickFishKind(nearby: Iterable<FishKind> = [], rnd: () => number = Math.random): FishKind {
  const seen = new Set(nearby);
  const weights = FISH_KINDS.map((k) => FISH_DEFS[k].weight * (seen.has(k) ? 3 : 1));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.max(0, Math.min(0.999999, rnd())) * total;
  for (let i = 0; i < FISH_KINDS.length; i++) {
    r -= weights[i];
    if (r <= 0) return FISH_KINDS[i];
  }
  return FISH_KINDS[FISH_KINDS.length - 1];
}

/**
 * The water in one column as [bottom, top): `bottom` is the floor block's top
 * face, `top` the top face of the highest water cell. Null when this column
 * has no water standing on solid ground.
 */
export function waterRunAt(world: World, x: number, z: number): { bottom: number; top: number } | null {
  const bx = Math.floor(x), bz = Math.floor(z);
  if (bx < 0 || bz < 0 || bx >= WORLD_SX || bz >= WORLD_SZ) return null;
  const ground = world.surfaceY(bx, bz);
  if (ground < 0 || !isWaterId(world.get(bx, ground + 1, bz))) return null;
  let y = ground + 1;
  while (y < WORLD_SY - 1 && isWaterId(world.get(bx, y + 1, bz))) y++;
  return { bottom: ground + 1, top: y + 1 };
}

/** the water around a fish, or null when its own cell has gone dry */
function waterRunAround(world: World, x: number, y: number, z: number): { bottom: number; top: number } | null {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  if (!isWaterId(world.get(bx, by, bz))) return null;
  let low = by;
  while (low > 1 && isWaterId(world.get(bx, low - 1, bz))) low--;
  let high = by;
  while (high < WORLD_SY - 1 && isWaterId(world.get(bx, high + 1, bz))) high++;
  return { bottom: low, top: high + 1 };
}

/** a school of schooling fish sharing one wandering anchor */
export class School {
  fish: Fish[] = [];
  anchor: THREE.Vector3;
  private target: THREE.Vector3;
  private timer = 0;
  private fleeT = 0;
  private threat: THREE.Vector3 | null = null;

  constructor(
    public kind: FishKind,
    x: number,
    y: number,
    z: number,
    private rnd: () => number,
  ) {
    this.anchor = new THREE.Vector3(x, y, z);
    this.target = this.anchor.clone();
    this.timer = 1 + rnd() * 3;
  }

  /** a kid swam into the school's living room — everyone leaves */
  flee(threat: THREE.Vector3): void {
    this.threat = threat.clone();
    this.fleeT = Math.max(this.fleeT, 1.8);
  }

  update(dt: number, world: World): void {
    this.fleeT = Math.max(0, this.fleeT - dt);
    if (this.fleeT > 0 && this.threat) {
      const away = this.anchor.clone().sub(this.threat);
      away.y = 0;
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      away.normalize();
      const next = this.anchor.clone().addScaledVector(away, dt * 3.4);
      next.y += dt * 0.4; // panic toward mid-water, away from feet
      if (this.pondHolds(world, next)) {
        this.anchor.copy(next);
        this.target.copy(this.anchor);
      }
      this.timer = 0.4; // find a proper new stroll as soon as the panic ends
      return;
    }
    this.timer -= dt;
    if (this.timer <= 0) {
      this.pickTarget(world);
      this.timer = 4 + this.rnd() * 5;
    }
    const d = this.target.clone().sub(this.anchor);
    const dist = d.length();
    if (dist > 0.05) {
      const step = Math.min(dist, 0.9 * dt); // schools travel at a gentle drift
      const next = this.anchor.clone().addScaledVector(d, step / dist);
      if (this.pondHolds(world, next)) this.anchor.copy(next);
      else this.timer = 0; // bumping the shore: pick another way
    }
  }

  /** is this a spot the school can live in (deep enough for fish)? */
  private pondHolds(world: World, p: THREE.Vector3): boolean {
    const run = waterRunAt(world, p.x, p.z);
    return !!run && run.top - run.bottom >= 2 && p.y >= run.bottom + 0.4 && p.y <= run.top - 0.5;
  }

  private pickTarget(world: World): void {
    for (let i = 0; i < 14; i++) {
      const ang = this.rnd() * Math.PI * 2;
      const r = 2 + this.rnd() * 7;
      const run = waterRunAt(world, this.anchor.x + Math.cos(ang) * r, this.anchor.z + Math.sin(ang) * r);
      if (!run || run.top - run.bottom < 2) continue;
      const y = run.bottom + 0.5 + this.rnd() * Math.max(0.1, run.top - run.bottom - 1.1);
      this.target.set(this.anchor.x + Math.cos(ang) * r, y, this.anchor.z + Math.sin(ang) * r);
      return;
    }
  }
}

export class Fish {
  pos: THREE.Vector3;
  group: THREE.Group;
  alive = true;
  kind: FishKind;
  school: School | null = null;
  private vel = new THREE.Vector3(0, 0, 1);
  private yaw = 0;
  private phase = Math.random() * 6;
  private tail: THREE.Object3D;
  private homeX: number;
  private homeZ: number;
  /** where this fish swims within its school (slowly circling) */
  private offAngle = Math.random() * Math.PI * 2;
  private offRadius = 0.7 + Math.random() * 1.4;
  private offY = (Math.random() - 0.5) * 0.8;
  /** solo wander target */
  private wander = new THREE.Vector3();
  private wanderT = 0;
  private yMin = 0;
  private yMax = 0;
  private boundsT = 0;
  private fleeT = 0;
  private threat: THREE.Vector3 | null = null;
  private sparkleT = 1 + Math.random() * 4;

  constructor(kind: FishKind, x: number, y: number, z: number, private particles: ParticleSystem | null = null) {
    this.kind = kind;
    this.pos = new THREE.Vector3(x, y, z);
    this.homeX = x;
    this.homeZ = z;
    this.wander.set(x, y, z);
    const d = FISH_DEFS[kind];
    const s = d.scale;
    const g = new THREE.Group();
    // 'YXZ' (like the avatars): three's default 'XYZ' pitches about the WORLD
    // x-axis, which would leave a swimming fish pointing one fixed way.
    g.rotation.order = 'YXZ';
    const bodyMat = new THREE.MeshLambertMaterial({ color: d.body });
    const finMat = new THREE.MeshLambertMaterial({ color: d.fin });

    const body = new THREE.Mesh(new THREE.BoxGeometry(d.bw * s, d.bh * s, d.bl * s), bodyMat);
    g.add(body);
    const belly = new THREE.Mesh(
      new THREE.BoxGeometry(d.bw * s * 0.72, d.bh * s * 0.5, d.bl * s * 0.8),
      new THREE.MeshLambertMaterial({ color: d.belly }),
    );
    belly.position.y = -d.bh * s * 0.3;
    g.add(belly);

    // tail on a pivot so it can wag
    const tailPivot = new THREE.Object3D();
    tailPivot.position.z = -d.bl * s * 0.5;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.07 * s, d.bh * s * 0.9, d.bl * s * 0.4), finMat);
    tail.position.z = -d.bl * s * 0.2;
    tailPivot.add(tail);
    g.add(tailPivot);
    this.tail = tailPivot;

    // dorsal fin, side fins and a pair of bright eyes (front is +z, as always)
    const dorsal = new THREE.Mesh(new THREE.BoxGeometry(0.08 * s, 0.24 * s, d.bl * s * 0.4), finMat);
    dorsal.position.y = d.bh * s * 0.55;
    g.add(dorsal);
    for (const sx of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12 * s, 0.12 * s, 0.24 * s), finMat);
      fin.position.set(sx * d.bw * s * 0.55, -d.bh * s * 0.08, d.bl * s * 0.12);
      fin.rotation.z = sx * 0.7;
      g.add(fin);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08 * s, 0.08 * s), new THREE.MeshBasicMaterial({ color: 0x20262f }));
      eye.position.set(sx * d.bw * s * 0.52, d.bh * s * 0.16, d.bl * s * 0.36);
      g.add(eye);
    }
    if (kind === 'puffer') {
      // puffy little spikes
      for (const [px, py, pz] of [[0, 0.42, 0.1], [0.3, 0.1, 0.12], [-0.3, 0.1, 0.12], [0, -0.3, -0.15]] as const) {
        const spike = new THREE.Mesh(new THREE.BoxGeometry(0.08 * s, 0.14 * s, 0.08 * s), finMat);
        spike.position.set(px * s, py * s, pz * s);
        g.add(spike);
      }
    }
    if (kind === 'golden') {
      // a shiny highlight along the back so a golden fish stands out
      const shine = new THREE.Mesh(
        new THREE.BoxGeometry(d.bw * s * 0.4, 0.06 * s, d.bl * s * 0.7),
        new THREE.MeshBasicMaterial({ color: 0xfff9d6 }),
      );
      shine.position.set(0, d.bh * s * 0.52, -d.bl * s * 0.05);
      g.add(shine);
    }

    this.group = g;
    this.group.position.copy(this.pos);
  }

  update(dt: number, world: World, anglers: readonly { pos: THREE.Vector3 }[]): void {
    this.boundsT -= dt;
    if (this.boundsT <= 0) {
      this.refreshBounds(world);
      this.boundsT = 1.2;
    }
    if (!this.alive) return;

    // panic: the water went away (a flood drained, a blast, someone filled it in)
    if (!isWaterId(world.get(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)))) {
      if (!this.rescue(world)) {
        this.alive = false;
        return;
      }
    }

    // dart away from a kid swimming too close — and so does the whole school
    this.fleeT = Math.max(0, this.fleeT - dt);
    for (const p of anglers) {
      if (this.pos.distanceToSquared(p.pos) < 3.2 * 3.2) {
        this.fleeT = 1.6;
        this.threat = p.pos;
        if (this.school) this.school.flee(p.pos);
        break;
      }
    }

    // where do we want to swim?
    const desired = new THREE.Vector3();
    let speed = FISH_DEFS[this.kind].speed;
    if (this.fleeT > 0 && this.threat) {
      desired.copy(this.pos).sub(this.threat);
      desired.y = 0.25;
      speed *= 2.3;
    } else if (this.school) {
      this.offAngle += dt * 0.4; // keep circling the school anchor a little
      desired.set(
        this.school.anchor.x + Math.cos(this.offAngle) * this.offRadius - this.pos.x,
        this.school.anchor.y + this.offY - this.pos.y,
        this.school.anchor.z + Math.sin(this.offAngle) * this.offRadius - this.pos.z,
      );
      // a straggler hurries to catch up with the flock
      if (this.pos.distanceTo(this.school.anchor) > 4) speed *= 2;
      // stay off schoolmates
      for (const other of this.school.fish) {
        if (other === this) continue;
        const d = this.pos.clone().sub(other.pos);
        if (d.lengthSq() < 0.55 * 0.55) desired.add(d.multiplyScalar(2));
      }
    } else {
      this.wanderT -= dt;
      if (this.wanderT <= 0 || this.pos.distanceToSquared(this.wander) < 0.6) this.pickWander(world);
      desired.copy(this.wander).sub(this.pos);
    }
    if (desired.lengthSq() < 0.0001) desired.set(Math.cos(this.phase), 0, Math.sin(this.phase));
    desired.normalize().multiplyScalar(speed);
    this.vel.lerp(desired, 1 - Math.exp(-2.6 * dt));
    if (this.vel.length() > speed) this.vel.setLength(speed);

    // move, but only into water
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    if (this.swimable(world, nx, this.pos.y, nz)) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else if (this.swimable(world, nx, this.pos.y, this.pos.z)) {
      this.pos.x = nx; // slide along the shore
    } else if (this.swimable(world, this.pos.x, this.pos.y, nz)) {
      this.pos.z = nz;
    } else {
      this.vel.multiplyScalar(0.2); // head-on into the bank: turn around soon
      if (!this.school) this.pickWander(world);
    }
    const ny = Math.max(this.yMin, Math.min(this.yMax, this.pos.y + this.vel.y * dt * 0.7));
    if (this.swimable(world, this.pos.x, ny, this.pos.z)) this.pos.y = ny;

    // a golden fish glitters
    if (this.kind === 'golden' && this.particles) {
      this.sparkleT -= dt;
      if (this.sparkleT <= 0) {
        this.sparkleT = 2 + Math.random() * 3;
        this.particles.spawn(this.pos.x, this.pos.y + 0.15, this.pos.z, 0xffe9a8, {
          vy: 0.6, ttl: 0.9, gravity: -0.5, size: 0.07,
        });
      }
    }

    this.render(dt);
  }

  /**
   * Can this fish occupy (x,y,z)? Water there, and y within the swim band of
   * THAT column — so fish wade shallows and dive holes, following the bottom
   * like a real fish instead of freezing at the shoreline step.
   */
  private swimable(world: World, x: number, y: number, z: number): boolean {
    if (!isWaterId(world.get(Math.floor(x), Math.floor(y), Math.floor(z)))) return false;
    const run = waterRunAt(world, x, z) ?? waterRunAround(world, x, y, z);
    if (!run || run.top - run.bottom < 0.7) return false;
    return y >= run.bottom + 0.22 && y <= run.top - 0.22;
  }

  /** swim inside the deepest water run the fish can reach; false = none found */
  private refreshBounds(world: World): void {
    const run = waterRunAt(world, this.pos.x, this.pos.z) ?? waterRunAround(world, this.pos.x, this.pos.y, this.pos.z);
    if (run && run.top - run.bottom >= 0.7) {
      this.yMin = run.bottom + 0.22;
      this.yMax = run.top - 0.22;
    } else {
      this.yMin = -1;
      this.yMax = -1; // marker: nothing to swim in
    }
  }

  /** dart to a nearby pond, or give up (the FishWorld will replace this one) */
  private rescue(world: World): boolean {
    for (let r = 2; r <= 7; r++) {
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2 + r;
        const run = waterRunAt(world, this.pos.x + Math.cos(ang) * r, this.pos.z + Math.sin(ang) * r);
        if (!run || run.top - run.bottom < 1.6) continue;
        this.pos.set(
          Math.floor(this.pos.x + Math.cos(ang) * r) + 0.5,
          (run.bottom + run.top) / 2,
          Math.floor(this.pos.z + Math.sin(ang) * r) + 0.5,
        );
        this.homeX = this.pos.x;
        this.homeZ = this.pos.z;
        this.vel.set(0, 0, 0);
        this.refreshBounds(world);
        return true;
      }
    }
    return false;
  }

  private pickWander(world: World): void {
    this.wanderT = 3 + Math.random() * 5;
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 2.5 + Math.random() * 6;
      const run = waterRunAt(world, this.homeX + Math.cos(ang) * r, this.homeZ + Math.sin(ang) * r);
      if (!run || run.top - run.bottom < 1.6) continue;
      this.wander.set(
        this.homeX + Math.cos(ang) * r,
        run.bottom + 0.4 + Math.random() * Math.max(0.1, run.top - run.bottom - 0.9),
        this.homeZ + Math.sin(ang) * r,
      );
      return;
    }
  }

  private render(dt: number): void {
    this.group.position.copy(this.pos);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.05) {
      let d = Math.atan2(this.vel.x, this.vel.z) - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += Math.max(-3.4 * dt, Math.min(3.4 * dt, d));
    }
    const speed = this.vel.length();
    this.group.rotation.y = this.yaw;
    this.group.rotation.x = -Math.asin(Math.max(-0.6, Math.min(0.6, this.vel.y / Math.max(0.5, speed))));
    this.phase += dt * (4 + speed * 4 + (this.fleeT > 0 ? 7 : 0));
    this.tail.rotation.y = Math.sin(this.phase) * (0.3 + Math.min(0.35, speed * 0.16));
  }
}

export class FishWorld {
  fishes: Fish[] = [];
  schools: School[] = [];
  private rnd: () => number;
  private refillT = 9;
  /** the population the world launched with — the slow refill keeps up to it */
  private startCount = 0;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private particles: ParticleSystem,
  ) {
    let seed = (world.seed ^ 0x1f05d) >>> 0;
    this.rnd = () => {
      // mulberry32: well-mixed pairs, so the x/z placement draws below
      // actually wander the whole map
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // every kind gets a guaranteed home in every world — the same promise the
    // barnyard makes — and the little ones come in actual schools
    const plan: [FishKind, number][] = [
      ['minnow', 2], ['sunfish', 1], ['bass', 1], ['minnow', 1],
      ['puffer', 1], ['golden', 1], ['sunfish', 1], ['bass', 1],
      ['minnow', 1], ['puffer', 1],
    ];
    for (const [kind, n] of plan) {
      for (let i = 0; i < n; i++) this.place(kind);
    }
    this.startCount = this.fishes.length;
  }

  update(dt: number, anglers: readonly { pos: THREE.Vector3 }[]): void {
    for (const s of this.schools) s.update(dt, this.world);
    for (const f of this.fishes) f.update(dt, this.world, anglers);
    if (this.fishes.some((f) => !f.alive)) {
      for (const f of this.fishes.filter((x) => !x.alive)) {
        f.group.removeFromParent();
        if (f.school) {
          const i = f.school.fish.indexOf(f);
          if (i >= 0) f.school.fish.splice(i, 1);
          if (f.school.fish.length === 0) {
            const si = this.schools.indexOf(f.school);
            if (si >= 0) this.schools.splice(si, 1);
          }
        }
      }
      this.fishes = this.fishes.filter((f) => f.alive) as Fish[];
    }
    // new fish drift in now and then, so fishing and floods never empty a lake
    this.refillT -= dt;
    if (this.refillT <= 0) {
      this.refillT = 10;
      if (this.fishes.length < this.startCount) this.refill();
    }
  }

  /**
   * A fish of `kind` within `r` of (x,y,z), taken out of the world — fishing
   * caught the very fish whose school lives under the bobber. Returns null
   * when this water was only pretending (the catch came from the table).
   */
  takeNearest(x: number, y: number, z: number, kind: FishKind, r = 5): Fish | null {
    let best: Fish | null = null;
    let bestD = r;
    for (const f of this.fishes) {
      if (!f.alive || f.kind !== kind) continue;
      const d = f.pos.distanceTo(new THREE.Vector3(x, y, z));
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) return null;
    best.alive = false; // update() tidies it out of every list
    return best;
  }

  /** kinds actually living near here — the fishing table favours these */
  nearbyKinds(x: number, y: number, z: number, r = 9): FishKind[] {
    const kinds = new Set<FishKind>();
    for (const f of this.fishes) {
      if (f.alive && f.pos.distanceToSquared(new THREE.Vector3(x, y, z)) < r * r) kinds.add(f.kind);
    }
    return [...kinds];
  }

  dispose(): void {
    for (const f of this.fishes) f.group.removeFromParent();
    this.fishes.length = 0;
    this.schools.length = 0;
  }

  private place(kind: FishKind): boolean {
    const d = FISH_DEFS[kind];
    for (let tries = 0; tries < 400; tries++) {
      const x = 5 + this.rnd() * (WORLD_SX - 10);
      const z = 5 + this.rnd() * (WORLD_SZ - 10);
      const run = waterRunAt(this.world, x, z);
      // the first pass wants a proper swim (depth 2.4/1.8); if the search
      // grows desperate any deeper-than-a-knee puddle of water will do,
      // because every kind getting a home beats none
      const want = tries < 200 ? (d.schooling ? 2.4 : 1.8) : 1.2;
      if (!run || run.top - run.bottom < want) continue;
      const y = (run.bottom + run.top) / 2;
      let school: School | null = null;
      if (d.schooling) {
        school = new School(kind, Math.floor(x) + 0.5, y, Math.floor(z) + 0.5, this.rnd);
        this.schools.push(school);
      }
      const [lo, hi] = d.schooling ? d.schoolSize : [1, 1];
      const n = lo + Math.floor(this.rnd() * (hi - lo + 1));
      for (let i = 0; i < n; i++) {
        const fx = x + (this.rnd() - 0.5) * 1.5;
        const fz = z + (this.rnd() - 0.5) * 1.5;
        const f = new Fish(kind, fx, y, fz, this.particles);
        if (school) {
          school.fish.push(f);
          f.school = school;
        }
        this.fishes.push(f);
        this.scene.add(f.group);
      }
      return true;
    }
    return false;
  }

  /** a new fish drifts in: schooling kinds join a school of their kind */
  private refill(): void {
    const kind = FISH_KINDS[Math.floor(this.rnd() * FISH_KINDS.length)];
    const d = FISH_DEFS[kind];
    if (d.schooling) {
      const schools = this.schools.filter((s) => s.kind === kind && s.fish.length < FISH_DEFS[kind].schoolSize[1]);
      if (schools.length) {
        const s = schools[Math.floor(this.rnd() * schools.length)];
        const f = new Fish(kind, s.anchor.x, s.anchor.y, s.anchor.z, this.particles);
        f.school = s;
        s.fish.push(f);
        this.fishes.push(f);
        this.scene.add(f.group);
        return;
      }
    }
    this.place(kind);
  }
}
