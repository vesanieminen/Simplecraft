/**
 * Falling sand reads as a fall, not a teleport. SandGravity moves each block
 * one cell per step (~8 cells/s), and the chunk remesh makes the block POP
 * one cell down every step. This view keeps one lightweight textured cube
 * per in-flight block, gliding it from the cell it just left to the cell it
 * now occupies, so the pile visibly slides down instead of transforming.
 *
 * The voxel stays the single source of truth — physics, saving and blasts
 * all see it immediately; these cubes are render-only. Each move hands the
 * cube to the next cell (its current eased height becomes the new start),
 * so a long fall is one continuous glide. The cubes are a hair smaller than
 * a full cell so a slide that ends inside a cell never z-fights the voxel's
 * own faces.
 */
import * as THREE from 'three';
import { ATLAS_CELL_COUNT, ATLAS_SAND } from '../core/blocks';
import { idx as worldIdx } from '../core/world';
import { STEP_SECONDS } from '../core/sand';

/** matches the mesher's FACE_SHADE for +x −x +y −y +z −z (BoxGeometry order) */
const FACE_SHADE = [0.78, 0.78, 1.0, 0.55, 0.86, 0.86];

interface GlideState {
  mesh: THREE.Mesh;
  x: number;
  z: number;
  /** cell-centre Y the cube is gliding from / to */
  y0: number;
  y1: number;
  /** game seconds elapsed on the current glide */
  t: number;
}

export class SandFalls {
  private readonly group = new THREE.Group();
  private readonly geo: THREE.BoxGeometry;
  private readonly material: THREE.Material;
  private readonly glides = new Map<number, GlideState>();
  /** cells whose sand is mid-glide: the mesher must not also draw them */
  readonly hidden = new Set<number>();

  /**
   * @param material the chunk manager's textured material, so falling sand
   * matches the sand painted into terrain exactly (same atlas, same lighting).
   * @param invalidate re-dirty a column so a glide's end hands the block back
   * to the chunk mesh (world.touchAt).
   */
  constructor(
    scene: THREE.Scene,
    material: THREE.Material,
    private invalidate: (x: number, z: number) => void,
  ) {
    this.material = material;
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.paintAtlas(this.geo);
    scene.add(this.group);
  }

  /** one shared geometry, UVs mapped onto the sand atlas cell */
  private paintAtlas(geo: THREE.BoxGeometry): void {
    const pad = 0.5 / 32; // same half-pixel inset the mesher uses
    const u0 = (ATLAS_SAND + pad) / ATLAS_CELL_COUNT;
    const u1 = (ATLAS_SAND + 1 - pad) / ATLAS_CELL_COUNT;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), pad + uv.getY(i) * (1 - 2 * pad));
    }
    uv.needsUpdate = true;

    // BoxGeometry face order is +x −x +y −y +z −z, four vertices each — the
    // same order as the mesher's FACES, so FACE_SHADE transfers directly
    const colors = new Float32Array(uv.count * 3);
    for (let f = 0; f < 6; f++) {
      const s = FACE_SHADE[f];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        colors[i * 3] = s; colors[i * 3 + 1] = s; colors[i * 3 + 2] = s;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  /** a sand block just moved from yFrom to yTo: start (or continue) its glide */
  glide(x: number, yFrom: number, yTo: number, z: number): void {
    const fromKey = worldIdx(x, yFrom, z);
    const toKey = worldIdx(x, yTo, z);
    // if this block is already gliding (from a previous step), carry its cube
    // over and resume from wherever it visually is right now
    const carried = this.glides.get(fromKey);
    if (carried) this.glides.delete(fromKey);
    // the voxel sitting at toKey must not be meshed while its cube is in flight
    this.hidden.delete(fromKey);
    this.hidden.add(toKey);
    const state: GlideState = carried ?? {
      mesh: new THREE.Mesh(this.geo, this.material),
      x, z,
      y0: yFrom + 0.5,
      y1: yFrom + 0.5,
      t: 0,
    };
    if (!carried) this.group.add(state.mesh);
    state.x = x;
    state.z = z;
    state.y0 = state.mesh.position.y; // resume mid-glide
    state.y1 = yTo + 0.5;
    state.t = 0;
    state.mesh.position.set(x + 0.5, state.y0, z + 0.5);
    this.glides.set(toKey, state);
  }

  /** advance on game time, in lockstep with the sand sim */
  update(dt: number): void {
    for (const [key, g] of Array.from(this.glides)) {
      g.t += dt;
      const f = Math.min(g.t / STEP_SECONDS, 1);
      g.mesh.position.y = g.y0 + (g.y1 - g.y0) * f;
      if (f >= 1) {
        // the cube reached the cell; hand the block back to the chunk mesh
        g.mesh.removeFromParent();
        this.glides.delete(key);
        this.hidden.delete(key);
        this.invalidate(g.x, g.z);
      }
    }
  }

  /** active glide count — e2e watches this rise and fall */
  get count(): number {
    return this.glides.size;
  }

  /** world change (new world, reset): forget every in-flight cube */
  clear(): void {
    for (const g of this.glides.values()) g.mesh.removeFromParent();
    this.glides.clear();
    this.hidden.clear();
  }
}
