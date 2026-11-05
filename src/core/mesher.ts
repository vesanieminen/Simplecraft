/**
 * Chunk mesher: turns voxel data into BufferGeometry with hidden-face
 * culling and baked ambient occlusion. Three layers per chunk:
 * opaque cubes, translucent cubes (water/glass), and cross-quads (plants).
 */

import * as THREE from 'three';
import {
  ATLAS_CELL_COUNT, ATLAS_DOOR, ATLAS_PLANKS, blockDef, isCrossBlock, isDoorBlock,
  isDoorClosedBlock, isFullCellBlock, isOpaqueBlock, isStairsBlock, isTranslucentBlock,
  PLANT_ATLAS_CELLS, SAND, StairFacing, stairBoxes, VoxelBox,
} from './blocks';
import { CHUNK, idx as worldIdx, WORLD_SY, World } from './world';

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
  /** cubes painted from the block texture atlas (dynamite, grass, stone…) */
  textured: THREE.BufferGeometry | null;
  /** see-through cubes painted from the same atlas (glass, water) */
  texturedTranslucent: THREE.BufferGeometry | null;
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

export function buildChunkGeometry(
  world: World, cx: number, cz: number,
  /** sand cells currently gliding (rendered by SandFalls cubes instead) */
  skipSand?: Set<number>,
): ChunkGeometry {
  const opaque = new GeomBuilder();
  const transp = new GeomBuilder();
  const cross = new GeomBuilder();
  const tex = new GeomBuilder();
  const texT = new GeomBuilder(); // painted glass and water: atlas art, see-through

  const x0 = cx * CHUNK, z0 = cz * CHUNK;

  for (let x = x0; x < x0 + CHUNK; x++) {
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let y = 0; y < WORLD_SY; y++) {
        const id = world.get(x, y, z);
        if (id === 0) continue;
        if (skipSand?.has(worldIdx(x, y, z)) && id === SAND) continue; // in flight
        const def = blockDef(id);

        if (isCrossBlock(id)) {
          addCrossQuads(cross, x, y, z, def.atlasCell ?? 2);
          continue;
        }

        if (isStairsBlock(id)) {
          // A real step: one half of the cell is full height, the other is a
          // half-high tread. Three boxes, with the faces that meet inside the
          // step skipped, so the tread and the riser stay painted.
          const facing = (world.stairFacing.get(worldIdx(x, y, z)) ?? 0) as StairFacing;
          addStairShape(tex, world, x, y, z, facing, def.sideAtlasCell ?? ATLAS_PLANKS);
          continue;
        }
        if (isDoorBlock(id)) {
          // A door is two cells tall (DOOR + DOOR_TOP) and its panel is only
          // half a block deep, standing in the middle of its cell while closed
          // and swung flat along the doorway while open. doorFacing says which
          // axis it is thin along. Open halves are never solid, so you walk
          // straight through them.
          const box = doorPanelBox(world, x, y, z)!;
          addTexturedSubBox(tex, world, [x, y, z], box, def.sideAtlasCell ?? ATLAS_DOOR,
            { cullFlush: true });
          continue;
        }

        const sideCell = def.sideAtlasCell;
        const isTextured = sideCell !== undefined;
        const seeThrough = isTranslucentBlock(id);
        const target = isTextured
          ? (seeThrough ? texT : tex)
          : (seeThrough ? transp : opaque);

        if (isTextured && def.solidHeight !== undefined && def.solidHeight < 1) {
          // a painted block that does not fill its cell — a slab plate, a squat
          // treasure chest — drawn as exactly the box physics collides with
          addTexturedSubBox(target, world, [x, y, z], [x, y, z, x + 1, y + def.solidHeight, z + 1],
            sideCell, {
              cullFlush: true,
              capCell: def.capAtlasCell ?? sideCell,
              bottomCell: def.bottomAtlasCell ?? def.capAtlasCell ?? sideCell,
            });
          continue;
        }

        for (let fi = 0; fi < 6; fi++) {
          const f = FACES[fi];
          const nx = x + f.dir[0], ny = y + f.dir[1], nz = z + f.dir[2];
          const n = world.get(nx, ny, nz);
          if (isFullCellBlock(n)) continue; // that neighbour already covers this face
          if (n === id) continue; // water-water, glass-glass: hide interior

          // base tint for this face
          let base = def.color;
          if (isTextured) {
            // painted blocks carry their own colour; the candy colours keep the tint
            if (!def.tintTexture) base = TEXTURE_TINT;
          } else {
            if (def.topColor && fi === 2) base = def.topColor;
            else if (def.topColor && fi === 3) base = def.color;
            if (def.sideColor && (fi === 0 || fi === 1 || fi === 4 || fi === 5)) base = def.sideColor;
          }

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
            sideCell !== undefined
              ? faceUvs(fi, sideCell, def.capAtlasCell ?? sideCell, def.bottomAtlasCell ?? def.capAtlasCell ?? sideCell)
              : undefined,
          );
        }
      }
    }
  }

  return {
    opaque: opaque.build(), translucent: transp.build(), cross: cross.build(),
    textured: tex.build(), texturedTranslucent: texT.build(),
  };
}

/** textured faces sample the atlas at full brightness; shading comes from AO + face angle */
const TEXTURE_TINT: [number, number, number] = [1, 1, 1];

const ATLAS_CELLS = ATLAS_CELL_COUNT; // from core/blocks.ts, shared with the atlas

/**
 * UVs for one cube face. The four side faces list their corners bottom, top,
 * top, bottom, so upright artwork stands up on every side; the caps map the
 * whole cell across the square.
 */
function faceUvs(
  fi: number, sideCell: number, topCell: number, bottomCell: number,
): [number, number][] {
  const pad = 0.5 / 32; // half-pixel inset to avoid atlas bleed
  const v0 = pad, v1 = 1 - pad;
  const cell = fi === 2 ? topCell : fi === 3 ? bottomCell : sideCell;
  const u0 = (cell + pad) / ATLAS_CELLS;
  const u1 = (cell + 1 - pad) / ATLAS_CELLS;
  if (fi === 2 || fi === 3) {
    return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  }
  return [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
}

/**
 * The painted panel of a door half — the shape the mesher draws and the
 * physics box a closed one collides as (see physics.solidBoxOf). A door is
 * two cells tall (the pair of halves), half a block deep, centred in its cell
 * while closed and swung flat against one side of the doorway while open.
 * Null when the cell holds no door.
 */
function doorPanelBox(
  world: World, x: number, y: number, z: number,
): [number, number, number, number, number, number] | null {
  const id = world.get(x, y, z);
  if (!isDoorBlock(id)) return null;
  const facing = world.doorFacing.get(worldIdx(x, y, z)) ?? 0;
  if (isDoorClosedBlock(id)) {
    return facing === 0
      ? [x + 0.25, y, z, x + 0.75, y + 1, z + 1]
      : [x, y, z + 0.25, x + 1, y + 1, z + 0.75];
  }
  return facing === 0
    ? [x, y, z, x + 1, y + 1, z + 0.5]
    : [x, y, z, x + 0.5, y + 1, z + 1];
}

/**
 * Doors are not opaque (a wall beside one keeps its own faces), so the generic
 * flush cull cannot see them. But the two halves of a door — and two doors
 * standing side by side — share a face exactly, and drawing it twice makes the
 * seam flicker. True when the neighbouring door's panel covers this very face.
 */
function doorSeamCovers(
  world: World,
  box: [number, number, number, number, number, number],
  cx: number, cy: number, cz: number,
  fi: number,
): boolean {
  const f = FACES[fi];
  const nb = doorPanelBox(world, cx + f.dir[0], cy + f.dir[1], cz + f.dir[2]);
  if (!nb) return false;
  const E = 1e-6;
  const same = (a: number, b: number): boolean => Math.abs(a - b) < E;
  if (fi === 0 || fi === 1) return same(nb[1], box[1]) && same(nb[4], box[4]) && same(nb[2], box[2]) && same(nb[5], box[5]);
  if (fi === 2 || fi === 3) return same(nb[0], box[0]) && same(nb[3], box[3]) && same(nb[2], box[2]) && same(nb[5], box[5]);
  return same(nb[0], box[0]) && same(nb[3], box[3]) && same(nb[1], box[1]) && same(nb[4], box[4]);
}

/** face numbers used by FACES / skip masks: +x -x +y -y +z -z */
const FACE_PX = 0, FACE_NX = 1, FACE_PY = 2, FACE_NY = 3, FACE_PZ = 4, FACE_NZ = 5;

/** a skip mask with the given faces marked "do not draw" */
function faceSkip(...faces: number[]): boolean[] {
  const skip = [false, false, false, false, false, false];
  for (const f of faces) skip[f] = true;
  return skip;
}

/**
 * One stair cell, as three boxes: the lower and upper parts of the tall half,
 * and the half-high tread half. The faces where those boxes meet each other are
 * skipped, so the step reads as one solid piece with the tread and the riser
 * painted and nothing doubled up inside.
 */
function addStairShape(
  g: GeomBuilder,
  world: World,
  x: number,
  y: number,
  z: number,
  facing: StairFacing,
  sideCell: number,
): void {
  const { tall, low } = stairBoxes(x, y, z, facing);
  // which way the tall half sits: +x, -x, +z or -z
  const toward = facing === 0 ? FACE_PX : facing === 1 ? FACE_NX : facing === 2 ? FACE_PZ : FACE_NZ;
  const away = facing === 0 ? FACE_NX : facing === 1 ? FACE_PX : facing === 2 ? FACE_NZ : FACE_PZ;
  const mid = y + 0.5;
  const [tx0, , tz0, tx1, , tz1] = tall;
  addTexturedSubBox(g, world, [x, y, z], low, sideCell, { cullFlush: true, skip: faceSkip(toward) });
  addTexturedSubBox(g, world, [x, y, z], [tx0, y, tz0, tx1, mid, tz1], sideCell,
    { cullFlush: true, skip: faceSkip(away, FACE_PY) });
  // the upper part keeps its `away` face: that is the riser of the step
  addTexturedSubBox(g, world, [x, y, z], [tx0, mid, tz0, tx1, tall[4], tz1], sideCell,
    { cullFlush: true, skip: faceSkip(FACE_NY) });
}

/**
 * A painted box smaller than a full cell — the mesher's shape language for
 * "not a cube" blocks (slab plates, stair steps, door panels, treasure
 * chests). Faces that sit flush on the cell border are culled against opaque
 * neighbours when `cullFlush`, faces listed in `skip` are left out (they meet
 * another part of the same block), and shading is face-angle only (no AO: these
 * shapes are small enough that it would only muddy them).
 */
function addTexturedSubBox(
  g: GeomBuilder,
  world: World,
  cell: [number, number, number],
  box: VoxelBox,
  sideCell: number,
  opts: { cullFlush?: boolean; capCell?: number; bottomCell?: number; skip?: boolean[] } = {},
): void {
  const [cx, cy, cz] = cell;
  const [x0, y0, z0, x1, y1, z1] = box;
  const cullFlush = opts.cullFlush ?? false;
  const capCell = opts.capCell ?? sideCell;
  const bottomCell = opts.bottomCell ?? capCell;
  const vary = 1 + (hashByte(cx, cy, cz) - 0.5) * 0.07;
  const E = 1e-6;
  const flush = [
    x1 >= cx + 1 - E, x0 <= cx + E,
    y1 >= cy + 1 - E, y0 <= cy + E,
    z1 >= cz + 1 - E, z0 <= cz + E,
  ];
  for (let fi = 0; fi < 6; fi++) {
    const f = FACES[fi];
    if (opts.skip?.[fi]) continue;
    if (cullFlush && flush[fi]
      && (isFullCellBlock(world.get(cx + f.dir[0], cy + f.dir[1], cz + f.dir[2])) || doorSeamCovers(world, box, cx, cy, cz, fi))) continue;
    const shade = FACE_SHADE[fi] * vary;
    const tint: [number, number, number][] = [
      [shade, shade, shade], [shade, shade, shade], [shade, shade, shade], [shade, shade, shade],
    ];
    const pts = f.corners.map(([ax, ay, az]) => [
      ax ? x1 : x0, ay ? y1 : y0, az ? z1 : z0,
    ] as [number, number, number]);
    g.quad(pts[0], pts[1], pts[2], pts[3], f.dir, tint, faceUvs(fi, sideCell, capCell, bottomCell));
  }
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
  const CELLS = PLANT_ATLAS_CELLS;
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
