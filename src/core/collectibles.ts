/**
 * Glowing collectible stars scattered through the world.
 * Collection state is persisted in world.collectedStars.
 */

import * as THREE from 'three';
import { WATER } from './blocks';
import { WORLD_SX, WORLD_SY, WORLD_SZ, World } from './world';

export interface Star {
  index: number;
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
}

export class StarField {
  stars: Star[] = [];
  /** stars that are not part of the generated world (chest treasure) get their own indices */
  private nextTreasureIndex = 10_000;

  private readonly geo = new THREE.OctahedronGeometry(0.3, 0);
  private readonly mat = new THREE.MeshBasicMaterial({ color: 0xffe14d });
  private readonly glowGeo = new THREE.OctahedronGeometry(0.46, 0);
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: 0xfff3a8, transparent: true, opacity: 0.35 });

  constructor(
    private scene: THREE.Scene,
    private world: World,
    spawnX: number,
    spawnZ: number,
  ) {
    let seed = (world.seed ^ 0x57a5) & 0x7fffffff;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    let placed = 0;
    let tries = 0;
    while (placed < 52 && tries < 1800) {
      tries++;
      const x = 3 + rnd() * (WORLD_SX - 6);
      const z = 3 + rnd() * (WORLD_SZ - 6);
      if (Math.hypot(x - spawnX, z - spawnZ) < 5) continue;
      const bx = Math.floor(x), bz = Math.floor(z);
      const top = world.surfaceY(bx, bz);
      if (top < 0 || world.get(bx, top, bz) === WATER) continue;
      const heightBoost = rnd() < 0.3 ? 2 + Math.floor(rnd() * 3) : 1;
      const y = top + 0.5 + heightBoost;
      if (y >= WORLD_SY - 2) continue;
      const index = placed;
      if (world.collectedStars.has(index)) {
        placed++;
        continue;
      }
      const mesh = new THREE.Mesh(this.geo, this.mat);
      const glow = new THREE.Mesh(this.glowGeo, this.glowMat);
      const pos = new THREE.Vector3(x, y, z);
      mesh.position.copy(pos);
      glow.position.copy(pos);
      scene.add(mesh, glow);
      this.stars.push({ index, pos, mesh, glow });
      placed++;
    }
  }

  /**
   * A treasure star that popped out of a chest: it hangs over the spot and is
   * collected exactly like the stars the world came with.
   */
  spawnAt(x: number, y: number, z: number): Star {
    const index = this.nextTreasureIndex++;
    const mesh = new THREE.Mesh(this.geo, this.mat);
    const glow = new THREE.Mesh(this.glowGeo, this.glowMat);
    const pos = new THREE.Vector3(x, y, z);
    mesh.position.copy(pos);
    glow.position.copy(pos);
    this.scene.add(mesh, glow);
    const star: Star = { index, pos, mesh, glow };
    this.stars.push(star);
    return star;
  }

  update(time: number): void {
    for (const s of this.stars) {
      const bob = Math.sin(time * 2 + s.index * 1.7) * 0.15;
      s.mesh.position.y = s.pos.y + bob;
      s.glow.position.y = s.pos.y + bob;
      s.mesh.rotation.y = time * 1.6 + s.index;
      const pulse = 1 + Math.sin(time * 3 + s.index) * 0.12;
      s.glow.scale.setScalar(pulse);
    }
  }

  /** returns collected star, or null */
  checkCollect(px: number, py: number, pz: number, r = 1.0): Star | null {
    for (const s of this.stars) {
      if (s.mesh.visible && s.pos.distanceToSquared(new THREE.Vector3(px, py + 0.9, pz)) < (r + 0.3) ** 2) {
        return s;
      }
    }
    return null;
  }

  take(star: Star): void {
    star.mesh.visible = false;
    star.glow.visible = false;
    this.world.collectedStars.add(star.index);
    this.world.revision++;
  }
}
