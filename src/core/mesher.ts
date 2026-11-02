/**
 * Chunk mesher: turns voxel data into BufferGeometry with hidden-face
 * culling and baked ambient occlusion. Three layers per chunk:
 * opaque cubes, translucent cubes (water/glass), and cross-quads (plants).
 */

import * as THREE from 'three';
import { blockDef, isCrossBlock, isOpaqueBlock, isTranslucentBlock } from './blocks';
import { CHUNK, WORLD_SY, World } from './world';

function hashByte(x: number, y: number, z: number): number {
  let h = (x * 73856093 + y * 19349663 + z * 83492791) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const AO_LEVELS = [0.55, 0.74, 0.88, 1.0];
const FACE_SHADE = [0.78, 0.78, 1.0, 0.55, 0.86, 0.86]; // +x -x +y -y +z -z

interface FaceSpec {
  dir: [number, number, number];
  /** quad corners relative to the block min corner */
  corners: [number, number, number][];
  /** for each corner: [side1 offset, side2 offset, corner offset] applied to the neighbor cell */
  ao: [number, number, number][][];
}

const FACES: FaceSpec[] = [
  {
    dir: [1, 0, 0],
    corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
    ao: [
      [[0, -1, 0], [0, 0, -1], [0, -1, -1]],
      [[0, 1, 0], [0, 0, -1], [0, 1, -1]],
      [[0, 1, 0], [0, 0, 1], [0, 1, 1]],
      [[0, -1, 0], [0, 0, 1], [0, -1, 1]],
    ],
  },
  {
    dir: [-1, 0, 0],
    corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
    ao: [
      [[0, -1, 0], [0, 0, 1], [0, -1, 1]],
      [[0, 1, 0], [0, 0, 1], [0, 1, 1]],
      [[0, 1, 0], [0, 0, -1], [0, 1, -1]],
      [[0, -1, 0], [0, 0, -1], [0, -1, -1]],
    ],
  },
  {
    dir: [0, 1, 0],
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    ao: [
      [[-1, 0, 0], [0, 0, 1], [-1, 0, 1]],
      [[1, 0, 0], [0, 0, 1], [1, 0, 1]],
      [[1, 0, 0], [0, 0, -1], [1, 0, -1]],
      [[-1, 0, 0], [0, 0, -1], [-1, 0, -1]],
    ],
  },
  {
    dir: [0, -1, 0],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    ao: [
      [[-1, 0, 0], [0, 0, -1], [-1, 0, -1]],
      [[1, 0, 0], [0, 0, -1], [1, 0, -1]],
      [[1, 0, 0], [0, 0, 1], [1, 0, 1]],
      [[-1, 0, 0], [0, 0, 1], [-1, 0, 1]],
    ],
  },
  {
    dir: [0, 0, 1],
    corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
    ao: [
      [[1, 0, 0], [0, -1, 0], [1, -1, 0]],
      [[1, 0, 0], [0, 1, 0], [1, 1, 0]],
      [[-1, 0, 0], [0, 1, 0], [-1, 1, 0]],
      [[-1, 0, 0], [0, -1, 0], [-1, -1, 0]],
    ],
  },
  {
    dir: [0, 0, -1],
    corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    ao: [
      [[-1, 0, 0], [0, -1, 0], [-1, -1, 0]],
      [[-1, 0, 0], [0, 1, 0], [-1, 1, 0]],
      [[1, 0, 0], [0, 1, 0], [1, 1, 0]],
      [[1, 0, 0], [0, -1, 0], [1, -1, 0]],
    ],
  },
];

export interface ChunkGeometry {
  opaque: THREE.BufferGeometry | null;
  translucent: THREE.BufferGeometry | null;
  cross: THREE.BufferGeometry | null;
  /** cubes painted from the block texture atlas (dynamite) */
  textured: THREE.BufferGeometry | null;
}

class GeomBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];

  quad(
    a: [number, number, number], b: [number, number, number],
    c: [number, number, number], d: [number, number, number],
    n: [number, number, number],
    tint: [number, number, number][], // per-corner rgb
    uv?: [number, number][], // optional per-corner (a,b,c,d) UVs
  ): void {
    // triangulate a,b,c,d (two triangles), flip diagonal for better AO
    const flip = this.aoFlip(tint);
    const push = (p: [number, number, number], i: number) => {
      this.positions.push(p[0], p[1], p[2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(tint[i][0], tint[i][1], tint[i][2]);
      if (uv) this.uvs.push(uv[i][0], uv[i][1]);
    };
    if (!flip) {
      push(a, 0); push(b, 1); push(c, 2);
      push(a, 0); push(c, 2); push(d, 3);
    } else {
      push(a, 0); push(b, 1); push(d, 3);
      push(b, 1); push(c, 2); push(d, 3);
    }
  }

  private aoFlip(tint: [number, number, number][]): boolean {
    // flip diagonal when the two opposite corners are darker
    const l = (t: [number, number, number]) => t[0] + t[1] + t[2];
    return l(tint[0]) + l(tint[2]) < l(tint[1]) + l(tint[3]);
  }

  build(): THREE.BufferGeometry | null {
    if (this.positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    if (this.uvs.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    g.computeBoundingSphere();
    return g;
  }
}

export function buildChunkGeometry(world: World, cx: number, cz: number): ChunkGeometry {
  const opaque = new GeomBuilder();
  const transp = new GeomBuilder();
  const cross = new GeomBuilder();
  const tex = new GeomBuilder();

  const x0 = cx * CHUNK, z0 = cz * CHUNK;

  for (let x = x0; x < x0 + CHUNK; x++) {
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let y = 0; y < WORLD_SY; y++) {
        const id = world.get(x, y, z);
        if (id === 0) continue;
        const def = blockDef(id);

        if (isCrossBlock(id)) {
          addCrossQuads(cross, x, y, z, def.atlasCell ?? 2);
          continue;
        }

        const sideCell = def.sideAtlasCell;
        const isTextured = sideCell !== undefined;
        const target = isTextured ? tex : (isTranslucentBlock(id) ? transp : opaque);

        for (let fi = 0; fi < 6; fi++) {
          const f = FACES[fi];
          const nx = x + f.dir[0], ny = y + f.dir[1], nz = z + f.dir[2];
          const n = world.get(nx, ny, nz);
          if (isOpaqueBlock(n)) continue;
          if (n === id) continue; // water-water, glass-glass: hide interior

          // base tint for this face
          let base = def.color;
          if (isTextured) base = TEXTURE_TINT; // the atlas artwork carries the colour
          else if (def.topColor && fi === 2) base = def.topColor;
          else if (def.topColor && fi === 3) base = def.color;
          if (def.sideColor && (fi === 0 || fi === 1 || fi === 4 || fi === 5)) base = def.sideColor;

          const vary = 1 + (hashByte(x, y, z) - 0.5) * 0.07;
          const emissive = !!def.emissive;
          const shade = emissive ? 1 : FACE_SHADE[fi];
          const aoVals: number[] = new Array(4);

          for (let ci = 0; ci < 4; ci++) {
            const [s1, s2, cc] = f.ao[ci];
            let ao = 3;
            if (!emissive && !isTranslucentBlock(id)) {
              const a = isOpaqueBlock(world.get(nx + s1[0], ny + s1[1], nz + s1[2])) ? 1 : 0;
              const b = isOpaqueBlock(world.get(nx + s2[0], ny + s2[1], nz + s2[2])) ? 1 : 0;
              const c = isOpaqueBlock(world.get(nx + cc[0], ny + cc[1], nz + cc[2])) ? 1 : 0;
              ao = a && b ? 0 : 3 - (a + b + c);
            }
            aoVals[ci] = AO_LEVELS[ao] * shade * vary;
          }

          const tint: [number, number, number][] = f.corners.map((_, ci) => [
            base[0] * aoVals[ci], base[1] * aoVals[ci], base[2] * aoVals[ci],
          ]);
          const cornerPts = f.corners.map((c) => [x + c[0], y + c[1], z + c[2]] as [number, number, number]);
          target.quad(
            cornerPts[0], cornerPts[1], cornerPts[2], cornerPts[3], f.dir, tint,
            sideCell !== undefined ? faceUvs(fi, sideCell, def.capAtlasCell ?? sideCell) : undefined,
          );
        }
      }
    }
  }

  return {
    opaque: opaque.build(), translucent: transp.build(), cross: cross.build(), textured: tex.build(),
  };
}

/** textured faces sample the atlas at full brightness; shading comes from AO + face angle */
const TEXTURE_TINT: [number, number, number] = [1, 1, 1];

const ATLAS_CELL_COUNT = 2; // must match render/textures.ts BLOCK_CELLS

/**
 * UVs for one cube face. The four side faces list their corners bottom, top,
 * top, bottom, so the bundle stands upright on every side; the caps map the
 * whole cell across the square.
 */
function faceUvs(
  fi: number, sideCell: number, capCell: number,
): [number, number][] {
  const pad = 0.5 / 32; // half-pixel inset to avoid atlas bleed
  const v0 = pad, v1 = 1 - pad;
  const cell = fi === 2 || fi === 3 ? capCell : sideCell;
  const u0 = (cell + pad) / ATLAS_CELL_COUNT;
  const u1 = (cell + 1 - pad) / ATLAS_CELL_COUNT;
  if (fi === 2 || fi === 3) {
    return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  }
  return [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
}

/** two crossed vertical quads for flowers / grass tufts, textured from an atlas */
function addCrossQuads(g: GeomBuilder, x: number, y: number, z: number, cell: number): void {
  const s = 0.9, o = (1 - s) / 2;
  // near-white tint; the atlas texture carries the colour, AO-ish shading from edges
  const t: [number, number, number][] = [
    [0.85, 0.85, 0.85],
    [1, 1, 1],
    [1, 1, 1],
    [0.85, 0.85, 0.85],
  ];
  const CELLS = 3;
  const pad = 0.5 / 32; // half-pixel inset to avoid atlas bleed
  const u0 = (cell + pad) / CELLS;
  const u1 = (cell + 1 - pad) / CELLS;
  // UV corners matching quad(a,b,c,d): a=bottom-left, b=top-left, c=top-right, d=bottom-right
  const uv: [number, number][] = [[u0, 0], [u0, 1], [u1, 1], [u1, 0]];
  const n1: [number, number, number] = [0.707, 0, 0.707];
  const n2: [number, number, number] = [0.707, 0, -0.707];
  // diagonal 1
  g.quad(
    [x + o, y, z + o], [x + o, y + 1, z + o], [x + o + s, y + 1, z + o + s], [x + o + s, y, z + o + s],
    n1, t, uv,
  );
  // diagonal 2
  g.quad(
    [x + o + s, y, z + o], [x + o + s, y + 1, z + o], [x + o, y + 1, z + o + s], [x + o, y, z + o + s],
    n2, t, uv,
  );
}
