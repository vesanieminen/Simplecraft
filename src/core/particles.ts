/**
 * Pooled particle system (one InstancedMesh) for place/remove pops,
 * sparkles, hearts and collectible bursts.
 */

import * as THREE from 'three';

interface Particle {
  alive: boolean;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  age: number; ttl: number;
  size: number;
  color: THREE.Color;
  gravity: number;
  spin: number;
  rot: number;
}

const MAX = 420;

export class ParticleSystem {
  private mesh: THREE.InstancedMesh;
  private parts: Particle[] = [];
  private dummy = new THREE.Object3D();
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.parts.push({
        alive: false, px: 0, py: -100, pz: 0, vx: 0, vy: 0, vz: 0,
        age: 0, ttl: 1, size: 0.1, color: new THREE.Color(1, 1, 1), gravity: -14, spin: 0, rot: 0,
      });
      this.mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
  }

  spawn(
    x: number, y: number, z: number,
    color: THREE.ColorRepresentation,
    opts: Partial<Pick<Particle, 'vx' | 'vy' | 'vz' | 'ttl' | 'size' | 'gravity' | 'spin'>> = {},
  ): void {
    const p = this.parts[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    p.alive = true;
    p.px = x; p.py = y; p.pz = z;
    p.vx = opts.vx ?? (Math.random() - 0.5) * 4;
    p.vy = opts.vy ?? Math.random() * 5 + 1.5;
    p.vz = opts.vz ?? (Math.random() - 0.5) * 4;
    p.age = 0;
    p.ttl = opts.ttl ?? 0.6 + Math.random() * 0.4;
    p.size = opts.size ?? 0.12 + Math.random() * 0.08;
    p.gravity = opts.gravity ?? -14;
    p.spin = opts.spin ?? (Math.random() - 0.5) * 8;
    p.rot = Math.random() * Math.PI;
    p.color.set(color);
  }

  burst(x: number, y: number, z: number, color: THREE.ColorRepresentation, count = 10, power = 1): void {
    for (let i = 0; i < count; i++) {
      this.spawn(x, y, z, color, {
        vx: (Math.random() - 0.5) * 5 * power,
        vy: Math.random() * 5 * power + 1,
        vz: (Math.random() - 0.5) * 5 * power,
      });
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX; i++) {
      const p = this.parts[i];
      if (!p.alive) {
        this.dummy.position.set(0, -1000, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      p.age += dt;
      if (p.age >= p.ttl) {
        p.alive = false;
        this.dummy.scale.setScalar(0);
        this.dummy.position.set(0, -1000, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      p.vy += p.gravity * dt;
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      p.rot += p.spin * dt;
      const life = 1 - p.age / p.ttl;
      this.dummy.position.set(p.px, p.py, p.pz);
      this.dummy.rotation.set(p.rot, p.rot * 0.7, 0);
      this.dummy.scale.setScalar(p.size * Math.min(1, life * 2.2));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, p.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
