/**
 * The world's point lights.
 *
 * The sun and moon are real three.js lights (sky.ts). Everything *in* the
 * world — torches, glow blocks, the treasure in an opened chest, the star
 * pickups — is lit through the ShaderKit's uniform arrays instead: the keeper
 * gathers the nearest handful of emitters per frame, scores them by weight
 * and distance, and publishes their positions/colours/radii into
 * `chunks.shaders.setLights`. The materials never recompile — only numbers
 * move — and the flicker is woven from the kit's clock in `setLights`
 * itself: one sine pair per light per frame, so the fragment decode stays
 * pure multiply-add. That's the whole M1 budget: at most `lightCompileMax`
 * decodes once per fragment (eight on a real GPU, three on a software
 * rasteriser), and a couple of dozen sprites.
 *
 * The visible side of a torch rides here too: each nearby torch gets a
 * small additive flame sprite that wobbles on the same clock the pools of
 * light flicker on — flame and firelight are provably the same fire.
 */

import * as THREE from 'three';
import { BlockId, CHEST_HEIGHT, CHEST_OPEN, emitsLight, GLOW, TORCH, TORCH_POST_H } from '../core/blocks';
import { Star } from '../core/collectibles';
import { idx as worldIdx, WORLD_SY, WORLD_SZ, World } from '../core/world';
import { MAX_WORLD_LIGHTS, patchDynamicLights, ShaderKit, WorldLight } from './shaders';
import { flameTexture } from './textures';

/** flat world index back to x/y/z — the inverse of world.idx */
function unidx(i: number): [number, number, number] {
  const x = Math.floor(i / (WORLD_SZ * WORLD_SY));
  const rest = i - x * WORLD_SZ * WORLD_SY;
  const z = Math.floor(rest / WORLD_SY);
  return [x, rest - z * WORLD_SY, z];
}

/** a stable 0..1 flicker phase from a cell index — the shader takes it from here */
function hash01(i: number): number {
  let h = (i * 2654435761) | 0;
  h = (h ^ (h >>> 15)) | 0;
  h = Math.imul(h, 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

interface KindDef {
  /** base light colour × intensity, plain linear values */
  color: [number, number, number];
  /** reach in blocks (the shader's falloff is exactly zero past this) */
  radius: number;
  /** light origin above the cell floor */
  lift: number;
  /** tie-break weight: fewer slots go to things that are everywhere */
  weight: number;
  name: string;
}

const KINDS: Record<number, KindDef> = {
  // a torch: warm, generous, the whole reason this file exists
  [TORCH]: { color: [0.88, 0.48, 0.18], radius: 7.2, lift: TORCH_POST_H + 0.15, weight: 1.0, name: 'torch' },
  // the glow block: a steady lamp, a shade cooler than the torch's fire
  [GLOW]: { color: [0.62, 0.52, 0.32], radius: 6.4, lift: 0.5, weight: 0.8, name: 'glow' },
  // an opened chest: a modest golden pulse where the treasure lies
  [CHEST_OPEN]: { color: [0.56, 0.38, 0.15], radius: 4.2, lift: CHEST_HEIGHT - 0.25, weight: 0.7, name: 'chest' },
};

/** stars are lights too, just polite ones — low reach, low weight */
const STAR_KIND: KindDef = { color: [0.62, 0.50, 0.22], radius: 3.4, lift: 0, weight: 0.35, name: 'star' };

/** candidates farther than this from the camera don't even get scored */
const CULL_R2 = 52 * 52;
/** how close a torch must be to wear a flame sprite (its own budget) */
const FLAME_R2 = 30 * 30;
const FLAME_MAX = 16;

/** one candidate light, with the score that decided whether it made the cut */
interface Candidate extends WorldLight {
  score: number;
  kind: string;
}

export class LightKeeper {
  /** every voxel cell that emits light (torches, glow blocks, opened chests) */
  private readonly cells = new Set<number>();
  /** flat index → the torch's flame sprite, while it's in range */
  private readonly flames = new Map<number, THREE.Sprite>();
  /** this frame's published lights (the e2e lens reads it between frames) */
  private last: Candidate[] = [];
  private readonly flameMat: THREE.SpriteMaterial;
  private sweep = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: World,
    private readonly kit: ShaderKit,
  ) {
    this.flameMat = new THREE.SpriteMaterial({
      map: flameTexture(),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      // the flame is authored light, not painted wood: tints stay linear
      // here (NoColorSpace on the texture) and ACES rolls its tip off sweetly
      color: new THREE.Color(1.0, 0.62, 0.26),
      fog: false,
    });
  }

  /** the saved world's torches, lamps and opened chests come back lit */
  restoreFromWorld(): void {
    this.cells.clear();
    this.clearFlames();
    for (const [i, b] of this.world.mods) if (emitsLight(b)) this.cells.add(i);
  }

  /** World.onCellChanged: an emitter born, or put out */
  onCell(x: number, y: number, z: number, id: BlockId): void {
    const i = worldIdx(x, y, z);
    if (emitsLight(id)) this.cells.add(i);
    else {
      this.cells.delete(i);
      this.removeFlame(i);
    }
  }

  /**
   * One pass per frame from the game loop (see game.ts): gather, score,
   * publish the uniform array, keep the flame sprites company with it.
   */
  /**
   * `budget` caps how many lights the GPU is asked to shade — see Game's
   * shadow-quality auto-detector: a software rasteriser runs the per-light
   * fragment work for real, so there we keep the big emitters (torches,
   * lamps, opened treasure) and send the faint star glows home.
   */
  sync(cam: THREE.Camera, stars: readonly Star[], enabled: boolean, budget: number): void {
    const camP = cam.position;
    const t = this.kit.time;

    // ---- gather + score -----------------------------------------------------
    const pool: Candidate[] = [];
    if (enabled) {
      // voxel emitters: the cells hook has been keeping since boot
      for (const i of this.cells) {
        const [x, y, z] = unidx(i);
        const kind = KINDS[this.world.get(x, y, z)];
        if (!kind) continue; // a blast took it since the hook — forget it
        const lx = x + 0.5, ly = y + kind.lift, lz = z + 0.5;
        const d2 = (lx - camP.x) ** 2 + (ly - camP.y) ** 2 + (lz - camP.z) ** 2;
        if (d2 > CULL_R2) continue;
        pool.push(this.candidate(kind, lx, ly, lz, hash01(i), kind.weight / (1 + d2 * 0.012)));
      }
      // star pickups: faint golden companions, deliberately low-weight so a
      // wandering star can never steal a torch's slot — and on a software
      // rasteriser they skip the shader entirely (every loop is real work)
      if (budget >= MAX_WORLD_LIGHTS) {
        for (const s of stars) {
          if (!s.mesh.visible) continue;
          const d2 = s.pos.distanceToSquared(camP);
          if (d2 > CULL_R2) continue;
          pool.push(this.candidate(
            STAR_KIND, s.pos.x, s.pos.y, s.pos.z,
            hash01(s.index * 17 + 5), STAR_KIND.weight / (1 + d2 * 0.05),
          ));
        }
      }
      // ---- the eight that get to be lights tonight --------------------------
      pool.sort((a, b) => b.score - a.score);
      if (pool.length > budget) pool.length = budget;
    }
    this.last = pool;
    this.kit.setLights(pool);

    // ---- torch flames -------------------------------------------------------
    // Only in-range torches wear a flame; each wobbles on the kit clock, so
    // the sprite and the shader-side pool flicker are one and the same fire.
    let near = 0;
    for (const i of this.cells) {
      const [x, y, z] = unidx(i);
      if (!enabled || this.world.get(x, y, z) !== TORCH) {
        this.removeFlame(i);
        continue;
      }
      const d2 = (x + 0.5 - camP.x) ** 2 + (z + 0.5 - camP.z) ** 2;
      if (d2 > FLAME_R2 || ++near > FLAME_MAX) {
        this.removeFlame(i);
        continue;
      }
      const spr = this.flames.get(i) ?? this.addFlame(i);
      const seed = hash01(i) * 31.4;
      const w = Math.sin(t * 8.1 + seed) + 0.5 * Math.sin(t * 17.3 + seed * 1.7);
      spr.scale.set(0.5 * (1 - 0.07 * w), 0.78 * (1 + 0.15 * w), 1);
      spr.position.set(
        x + 0.5 + 0.035 * Math.sin(t * 11.2 + seed),
        y + TORCH_POST_H + 0.30 + 0.05 * Math.sin(t * 9.4 + seed * 2.3),
        z + 0.5 + 0.035 * Math.cos(t * 10.3 + seed),
      );
    }

    // ---- the material sweep (see `ensurePatched`) ---------------------------
    if (++this.sweep >= 20) {
      this.sweep = 0;
      this.ensurePatched();
    }
  }

  /** e2e lens: what the shaders were told last frame */
  debug(): {
    count: number; max: number; flames: number; emitters: number;
    lights: { x: number; y: number; z: number; r: number; kind: string }[];
  } {
    return {
      count: this.last.length,
      max: MAX_WORLD_LIGHTS,
      flames: this.flames.size,
      emitters: this.cells.size,
      lights: this.last.map((l) => ({ x: l.x, y: l.y, z: l.z, r: l.radius, kind: l.kind })),
    };
  }

  /** the kit-facing light count (0 when the grown-up switch is off) */
  get activeCount(): number {
    return this.last.length;
  }

  /** how many emitter cells the world has (e2e lens) */
  get emitterCount(): number {
    return this.cells.size;
  }

  /** put every flame away (fresh world; the grown-up switch is handled by sync) */
  clearFlames(): void {
    for (const i of [...this.flames.keys()]) this.removeFlame(i);
  }

  // ------------------------------------------------------------------ internals

  private candidate(kind: KindDef, x: number, y: number, z: number, seed: number, score: number): Candidate {
    // Full daylight already lights everything a torch could reach — the
    // keeper fades its pools to embers by day (flame sprite still burns)
    // and to full strength at dusk, so noon torchlight can never stack on
    // the sun and wash the meadow out. See ShaderKit.dayLight.
    const day = this.kit.dayLight;
    return {
      x, y, z,
      r: kind.color[0] * day, g: kind.color[1] * day, b: kind.color[2] * day,
      radius: kind.radius, seed, score, kind: kind.name,
    };
  }

  /**
   * Avatars, animals and fish are Lambert too — they should catch a torch.
   * Costumes are rebuilt on every swap and fish drift in and out, so rather
   * than trusting a creation hook we re-sweep the scene every twenty frames
   * and hand `patchDynamicLights` to any Lambert material that never had one.
   * One program rebuild per material, ever — the lights themselves never
   * rebuild anything again (fixed cache key, uniform-driven count).
   */
  private ensurePatched(): void {
    const seen = new Set<THREE.Material>();
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const one of Array.isArray(m) ? m : [m]) {
        if (!(one as THREE.MeshLambertMaterial).isMeshLambertMaterial) continue;
        if (seen.has(one)) continue;
        seen.add(one);
        // A patched material always carries a custom cache key (see the
        // patch* helpers); base three.js returns '' — so '' means "never
        // compiled with our code yet", and it needs the light injection.
        if (one.customProgramCacheKey() !== '') continue;
        patchDynamicLights(one as THREE.MeshLambertMaterial, this.kit);
        one.needsUpdate = true; // it has already rendered once without lights
      }
    });
  }

  private addFlame(i: number): THREE.Sprite {
    const spr = new THREE.Sprite(this.flameMat);
    spr.scale.set(0.62, 0.95, 1);
    spr.renderOrder = 2; // over blocks, and never through them (depthTest stays on)
    this.scene.add(spr);
    this.flames.set(i, spr);
    return spr;
  }

  private removeFlame(i: number): void {
    const spr = this.flames.get(i);
    if (!spr) return;
    this.scene.remove(spr);
    this.flames.delete(i);
  }
}
