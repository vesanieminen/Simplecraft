/**
 * Fishing, the Elocraft way: aim at the water and press the pet button — the
 * bobber arcs out and plops down. A moment later something bites: the bobber
 * dives, there is a splash and a sound, and pressing the pet button again
 * reels in a fish (see Game.reelIn for what the catch does — it goes into
 * the angler's satchel, core/satchel.ts, where it can be eaten later).
 * Reel in early and the hook comes up empty; wait too long at a bite and
 * the fish gets away.
 */

import * as THREE from 'three';
import { AudioKit } from './audio';
import { isWaterId } from './blocks';
import { ParticleSystem } from './particles';
import { World } from './world';

export type LinePhase = 'flying' | 'waiting' | 'bite';

/** what the line needs to know about its angler each frame */
export interface Angler {
  id: number;
  pos: THREE.Vector3;
  yaw: number;
  headHeight: number;
  /** the angler's own camera — the first-person rod rides it */
  camera: THREE.Camera;
  firstPerson: boolean;
  /** the avatar's right arm; the rod is parented so it swings with the arm */
  rightArm: THREE.Object3D | null;
}

/** three.js layer for the first-person rod: only the owner's camera enables it */
export const ROD_LAYER = 7;

/** a little blocky rod: tapered sections and a red grip wrap, matching the bobber */
function buildRod(): { group: THREE.Group; tip: THREE.Object3D } {
  const group = new THREE.Group();
  const seg = (w: number, len: number, y: number, color: number): void => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, len, w),
      new THREE.MeshLambertMaterial({ color }),
    );
    m.position.y = y;
    group.add(m);
  };
  seg(0.06, 0.24, 0.12, 0x8a5a2b);
  seg(0.048, 0.4, 0.44, 0xa4713c);
  seg(0.032, 0.36, 0.82, 0xc08a50);
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.13, 0.085),
    new THREE.MeshLambertMaterial({ color: 0xd23f3f }),
  );
  grip.position.y = 0.1;
  group.add(grip);
  const tip = new THREE.Object3D();
  tip.position.y = 1.02;
  group.add(tip);
  return { group, tip };
}

const disposeGeos = (root: THREE.Object3D): void => {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.geometry.dispose();
  });
};

const TIP_TMP = new THREE.Vector3();
const ROD_CAM_POS = new THREE.Vector3(0.34, -0.42, -0.8); // low right of the screen
const ROD_CAM_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.15, 0, 0.15));

export interface ReelOutcome {
  /** true when the bobber was mid-bite: a fish is coming in */
  bite: boolean;
  x: number;
  y: number;
  z: number;
}

interface FishingLine {
  id: number;
  phase: LinePhase;
  t: number; // phase timer (game seconds)
  waitT: number; // seconds until the next bite
  pos: THREE.Vector3;
  start: THREE.Vector3;
  target: THREE.Vector3;
  surfaceY: number; // the water's top face this bobber floats on
  cell: { x: number; y: number; z: number }; // the water cell it sits in
  group: THREE.Group; // the bobber: red on white, like a proper bobber
  line: THREE.Line;
  /** the rod in the kid's hand (hidden in first person, where the camera rod takes over) */
  rod: THREE.Group | null;
  rodTip: THREE.Object3D | null;
  /** the rod held up to the angler's own camera, on its own three.js layer */
  camRod: THREE.Group | null;
  camRodTip: THREE.Object3D | null;
}

const FLIGHT_SECONDS = 0.5; // the cast's little arc
const MAX_REEL = 14; // blocks — wander further and the line comes back by itself

export class FishingManager {
  readonly lines = new Map<number, FishingLine>();
  /** game seconds a bobber floats before a fish bites — tests hurry this along */
  biteWait: [number, number] = [1.4, 4.2];
  /** how long a bite stays reel-able before the fish gets away */
  biteWindow = 1.6;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private particles: ParticleSystem,
    private audio: AudioKit,
    private toast: (msg: string, ms?: number) => void,
  ) {}

  active(id: number): boolean {
    return this.lines.has(id);
  }

  /** throw a line into the water block (x,y,z); the bobber lands on its top */
  cast(id: number, angler: Angler, x: number, y: number, z: number): void {
    if (this.lines.has(id)) return;
    const target = new THREE.Vector3(x + 0.5, y + 1.05, z + 0.5);
    // the rod: one in the hand for other cameras, one in front of the
    // angler's own camera when the body is hidden (first person)
    let rod: THREE.Group | null = null;
    let rodTip: THREE.Object3D | null = null;
    if (angler.rightArm) {
      const r = buildRod();
      r.group.position.set(0, -0.42, 0.06); // the hand end of the arm limb
      r.group.rotation.x = 0.72; // up and forward (the avatar's front is +Z)
      r.group.rotation.z = 0.12;
      angler.rightArm.add(r.group);
      rod = r.group;
      rodTip = r.tip;
    }
    const cr = buildRod();
    cr.group.traverse((o) => o.layers.set(ROD_LAYER));
    this.scene.add(cr.group);
    // where the bobber leaves the hand: the rod tip in world space
    const start = new THREE.Vector3();
    if (rodTip && !angler.firstPerson) {
      rodTip.getWorldPosition(start);
    } else {
      start.copy(angler.camera.localToWorld(ROD_CAM_POS.clone()));
    }
    const group = new THREE.Group();
    const white = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
    );
    const red = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xff5d5d }),
    );
    red.position.y = 0.09;
    group.add(white, red);
    group.position.copy(start);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([start.clone(), start.clone()]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf2f6fa, transparent: true, opacity: 0.85, depthWrite: false }));
    line.renderOrder = 8;
    line.frustumCulled = false;
    this.scene.add(group, line);
    this.lines.set(id, {
      id,
      phase: 'flying',
      t: 0,
      waitT: 0,
      pos: start.clone(),
      start: start.clone(),
      target,
      surfaceY: target.y - 0.05,
      cell: { x, y, z },
      group,
      line,
      rod,
      rodTip,
      camRod: cr.group,
      camRodTip: cr.tip,
    });
    this.audio.castLine();
  }

  /** where the line hangs from right now: the active rod's tip, world space */
  private tipWorld(l: FishingLine, angler: Angler): THREE.Vector3 {
    if (angler.firstPerson) {
      if (l.camRod && l.camRodTip) {
        l.camRod.position.copy(angler.camera.localToWorld(TIP_TMP.copy(ROD_CAM_POS)));
        l.camRod.quaternion.copy(angler.camera.quaternion).multiply(ROD_CAM_TILT);
        return l.camRodTip.getWorldPosition(new THREE.Vector3());
      }
    } else if (l.rod && l.rodTip) {
      // a costume swap rebuilds the avatar: follow the arm it lives on
      if (angler.rightArm && l.rod.parent !== angler.rightArm) angler.rightArm.add(l.rod);
      return l.rodTip.getWorldPosition(new THREE.Vector3());
    }
    // no avatar (shouldn't happen): the old waist-high hand
    return new THREE.Vector3(
      angler.pos.x + Math.sin(angler.yaw) * 0.5,
      angler.pos.y + angler.headHeight * 0.72,
      angler.pos.z + Math.cos(angler.yaw) * 0.5,
    );
  }

  update(dt: number, anglers: readonly Angler[]): void {
    if (this.lines.size === 0) return;
    for (const [id, l] of [...this.lines]) {
      const angler = anglers.find((a) => a.id === id);
      if (!angler) {
        this.remove(l); // their controller fell asleep mid-cast: tidy up
        continue;
      }
      const hand = this.tipWorld(l, angler);
      if (l.camRod) l.camRod.visible = angler.firstPerson;
      l.t += dt;

      if (l.phase === 'flying') {
        const k = Math.min(1, l.t / FLIGHT_SECONDS);
        l.pos.lerpVectors(l.start, l.target, k);
        l.pos.y += Math.sin(k * Math.PI) * 1.1; // the cast's arc
        if (k >= 1) {
          l.pos.copy(l.target);
          l.phase = 'waiting';
          l.t = 0;
          const [lo, hi] = this.biteWait;
          l.waitT = lo + Math.random() * (hi - lo);
          this.particles.burst(l.pos.x, l.surfaceY + 0.08, l.pos.z, 0x7fd0f0, 8, 0.5);
          this.audio.plip();
        }
      } else if (l.phase === 'waiting') {
        l.pos.y = l.surfaceY + Math.sin(l.t * 2.6) * 0.035; // gentle bobbing
        l.waitT -= dt;
        if (l.waitT <= 0) {
          l.phase = 'bite';
          l.t = 0;
          this.audio.fishBite();
          this.particles.burst(l.pos.x, l.surfaceY + 0.06, l.pos.z, 0xbfe9ff, 9, 0.5);
          this.toast('🎣 Something is biting — press the pet button!', 1500);
        }
      } else {
        // bite: the bobber dives and shivers, bubbles rising
        if (l.t > this.biteWindow) {
          this.audio.fishEscape();
          this.particles.burst(l.pos.x, l.surfaceY + 0.05, l.pos.z, 0x7fd0f0, 6, 0.4);
          this.toast('🐟 It got away… cast again!', 1900);
          this.remove(l);
          continue;
        }
        l.pos.y = l.surfaceY - 0.14 + Math.sin(l.t * 22) * 0.03;
        if (Math.random() < dt * 6) {
          this.particles.spawn(l.pos.x, l.surfaceY + 0.05, l.pos.z, 0xdff4ff, {
            vy: 0.7, gravity: 1.2, ttl: 0.7, size: 0.05,
          });
        }
      }

      // the water went away under the bobber (drained, filled in, blasted):
      // the line comes back by itself
      if (l.phase !== 'flying' && !isWaterId(this.world.get(l.cell.x, l.cell.y, l.cell.z))) {
        this.remove(l);
        continue;
      }
      // the angler wandered off: the line goes slack
      if (l.pos.distanceToSquared(hand) > MAX_REEL * MAX_REEL) {
        this.remove(l);
        continue;
      }

      l.group.position.copy(l.pos);
      const attr = l.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      attr.setXYZ(0, hand.x, hand.y, hand.z);
      attr.setXYZ(1, l.pos.x, l.pos.y + 0.05, l.pos.z);
      attr.needsUpdate = true;
    }
  }

  /** the pet button while a line is out: bring it in — fish or no fish */
  reel(id: number): ReelOutcome | null {
    const l = this.lines.get(id);
    if (!l) return null;
    const out: ReelOutcome = { bite: l.phase === 'bite', x: l.pos.x, y: l.pos.y, z: l.pos.z };
    this.remove(l);
    return out;
  }

  clearFor(id: number): void {
    const l = this.lines.get(id);
    if (l) this.remove(l);
  }

  /** every line out (world switch, reset): the bobbers go home */
  clear(): void {
    for (const [, l] of [...this.lines]) this.remove(l);
  }

  private remove(l: FishingLine): void {
    this.lines.delete(l.id);
    this.scene.remove(l.group, l.line);
    if (l.rod) {
      l.rod.removeFromParent(); // lives on the avatar's arm, not the scene
      disposeGeos(l.rod);
    }
    if (l.camRod) {
      this.scene.remove(l.camRod);
      disposeGeos(l.camRod);
    }
    l.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    l.line.geometry.dispose();
    (l.line.material as THREE.Material).dispose();
  }
}
