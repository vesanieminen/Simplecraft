/**
 * Keeps chunk meshes in the Three.js scene in sync with world edits.
 * One mesh set per chunk — the whole world is ~16 draw calls per layer.
 */

import * as THREE from 'three';
import { buildChunkGeometry } from '../core/mesher';
import { CHUNKS_X, World } from '../core/world';
import { blockAtlasTexture, plantAtlasTexture, waterTexture } from './textures';
import { patchTerrainFinish, patchWaterSurface, ShaderKit, SunState } from './shaders';

interface ChunkMeshes {
  opaque?: THREE.Mesh;
  transp?: THREE.Mesh;
  cross?: THREE.Mesh;
  tex?: THREE.Mesh;
  texT?: THREE.Mesh;
  wet?: THREE.Mesh;
}

export class ChunkMeshManager {
  /** every chunk's live meshes (tests use this to spot a channel that drew) */
  meshes: ChunkMeshes[] = [];
  private pending = new Set<number>();
  /** the animated uniforms behind the patched water + terrain shaders */
  readonly shaders = new ShaderKit();
  readonly materials = {
    opaque: new THREE.MeshLambertMaterial({ vertexColors: true }),
    translucent: new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false,
    }),
    cross: new THREE.MeshBasicMaterial({
      vertexColors: true,
      map: plantAtlasTexture(),
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    }),
    /** cubes that want artwork instead of a flat tint (dynamite, grass, stone…) */
    textured: new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: blockAtlasTexture(),
    }),
    /** the same artwork, see through: glass */
    texturedTranslucent: new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: blockAtlasTexture(),
      transparent: true, opacity: 0.72, depthWrite: false,
    }),
    /**
     * Water: its own tiling sheet, drifting all the time (see tickWater) so a
     * lake shimmers and a flood reads as moving water.
     *
     * `depthWrite` is ON, deliberately. With it off (the reflexive setting for
     * a transparent material) every surface of every cell in a body of water
     * blended into every other one — the top of each cell, the top of the cell
     * under it, all four sides — and a sheet a few cells deep drew as a stack of
     * floating glass plates instead of one body. Writing depth leaves the top
     * surface the only thing you see, which is how blocky water is supposed to
     * read.
     */
    water: new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: waterTexture(),
      transparent: true, opacity: 0.78, depthWrite: true,
    }),
  };

  constructor(
    private scene: THREE.Scene,
    private world: World,
  ) {
    // procedural polish, injected once into the shared programs: the water
    // sheet gets waves + sun glint, the two terrain channels a low-sun rim
    // and a saturation lift. Uniforms animate; programs never rebuild.
    patchWaterSurface(this.materials.water, this.shaders);
    patchTerrainFinish(this.materials.opaque, this.shaders);
    patchTerrainFinish(this.materials.textured, this.shaders);
  }

  /** flat indices of sand cells the mesher must leave out (SandFalls draws them) */
  skipSand?: Set<number>;

  /** rebuild up to `budget` dirty chunks; call every frame */
  update(budget = 4): boolean {
    for (const k of this.world.dirtyChunks) this.pending.add(k);
    this.world.dirtyChunks.clear();
    if (this.pending.size === 0) return false;
    let done = 0;
    for (const key of this.pending) {
      this.rebuild(key);
      this.pending.delete(key);
      if (++done >= budget) break;
    }
    return true;
  }

  rebuildAll(): void {
    this.world.markAllDirty();
    for (const k of this.pending) this.rebuild(k);
    this.pending.clear();
    while (this.world.dirtyChunks.size) {
      const k = this.world.dirtyChunks.values().next().value as number;
      this.world.dirtyChunks.delete(k);
      this.rebuild(k);
    }
  }

  private rebuild(key: number): void {
    const cx = Math.floor(key / CHUNKS_X);
    const cz = key % CHUNKS_X;
    const geo = buildChunkGeometry(this.world, cx, cz, this.skipSand);
    const slot = (this.meshes[key] ??= {});

    this.swap(slot, 'opaque', geo.opaque, this.materials.opaque);
    this.swap(slot, 'transp', geo.translucent, this.materials.translucent);
    this.swap(slot, 'cross', geo.cross, this.materials.cross);
    this.swap(slot, 'tex', geo.textured, this.materials.textured);
    this.swap(slot, 'texT', geo.texturedTranslucent, this.materials.texturedTranslucent);
    this.swap(slot, 'wet', geo.water, this.materials.water);
  }

  /**
   * Drift the water sheet (call every frame): the sea crawls sideways and
   * bobs, so no two looks at the same pond are ever the same picture. The
   * offset is wrapped back into a whole tile so it never drifts to a huge
   * number after a long afternoon of building.
   */
  tickWater(dt: number): void {
    const map = this.materials.water.map;
    if (!map) return;
    map.offset.x = (map.offset.x + dt * 0.021) % 1;
    map.offset.y = (map.offset.y + dt * 0.013) % 1;
  }

  /** move the sun/haze/time uniforms the patched shaders read (every frame) */
  tickShaders(dt: number, sun: SunState, haze: THREE.Color): void {
    this.shaders.tick(dt, sun, haze);
  }

  private swap(
    slot: ChunkMeshes,
    which: 'opaque' | 'transp' | 'cross' | 'tex' | 'texT' | 'wet',
    geo: THREE.BufferGeometry | null,
    mat: THREE.Material,
  ): void {
    const old = slot[which];
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      slot[which] = undefined;
    }
    if (geo) {
      const mesh = new THREE.Mesh(geo, mat);
      // geometry vertices are in world space; keep mesh at origin
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      // terrain casts and catches shadows (cliffs shade the meadow); sheets
      // that are see-through only receive — a thin plate casting a full slab
      // of shade is exactly the fake kids notice
      mesh.castShadow = which === 'opaque' || which === 'tex';
      mesh.receiveShadow = which !== 'cross';
      this.scene.add(mesh);
      slot[which] = mesh;
    }
  }

  dispose(): void {
    for (const slot of this.meshes) {
      for (const m of [slot.opaque, slot.transp, slot.cross]) {
        if (m) {
          this.scene.remove(m);
          m.geometry.dispose();
        }
      }
    }
    this.meshes = [];
  }
}
