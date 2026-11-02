/**
 * Procedural textures (no external assets), all drawn on canvases:
 *  - a horizontal atlas of 32x32 *plant* cells (red flower, sunflower, grass
 *    tuft) sampled by the cross-quads with alpha-test cutout;
 *  - a horizontal atlas of 32x32 *block* cells used to paint blocks that want
 *    more than a flat tint — right now the dynamite bundle (sides + ends).
 */

import * as THREE from 'three';
import { ATLAS_DYNAMITE_CAP, ATLAS_DYNAMITE_SIDE } from '../core/blocks';

export const PLANT_CELLS = 3; // atlas cells side by side
export const PLANT_CELL_RED = 0;
export const PLANT_CELL_YELLOW = 1;
export const PLANT_CELL_TUFT = 2;

/** number of cells in the block atlas (side by side) */
export const BLOCK_CELLS = 2;

export const S = 32; // cell size in px

function stem(ctx: CanvasRenderingContext2D, ox: number, x0: number, y0: number, y1: number, w: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(ox + x0, y0, w, y1 - y0);
}

function drawFlower(ctx: CanvasRenderingContext2D, ox: number, petal: string, center: string): void {
  // stems (three slightly leaning)
  stem(ctx, ox, 14, 14, 32, 2, '#3e7d35');
  stem(ctx, ox, 10, 18, 32, 2, '#478c3d');
  stem(ctx, ox, 19, 20, 32, 2, '#356b2e');
  // leaves
  ctx.fillStyle = '#4a9440';
  ctx.fillRect(ox + 8, 24, 5, 2);
  ctx.fillRect(ox + 19, 26, 5, 2);
  // petals: a chunky flower head
  ctx.fillStyle = petal;
  ctx.fillRect(ox + 11, 4, 10, 10);
  ctx.fillRect(ox + 8, 7, 16, 5);
  ctx.fillRect(ox + 13, 1, 6, 4);
  ctx.fillRect(ox + 13, 13, 6, 3);
  // bright petal tips
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(ox + 11, 4, 10, 2);
  // center
  ctx.fillStyle = center;
  ctx.fillRect(ox + 14, 7, 5, 5);
}

function drawTuft(ctx: CanvasRenderingContext2D, ox: number): void {
  // blades of grass fanning out, drawn as thin leaning bars
  const blades: [number, number, number][] = [
    [15, 6, 3], // [x at top, top y, width]
    [9, 10, 3],
    [21, 9, 3],
    [5, 16, 2],
    [26, 15, 2],
    [12, 4, 2],
    [19, 5, 2],
  ];
  for (let b = 0; b < blades.length; b++) {
    const [tx, ty, w] = blades[b];
    const base = 32;
    const shade = b % 3 === 0 ? '#4d9c43' : b % 3 === 1 ? '#5cae4e' : '#3f8536';
    ctx.fillStyle = shade;
    // simple leaning blade: fill a quad from base up to the tip
    const bx = 16 + (tx - 16) * 0.35;
    ctx.beginPath();
    ctx.moveTo(ox + bx - w, base);
    ctx.lineTo(ox + tx - w / 2, ty);
    ctx.lineTo(ox + tx + w / 2, ty);
    ctx.lineTo(ox + bx + w, base);
    ctx.closePath();
    ctx.fill();
  }
  // a couple of seed heads
  ctx.fillStyle = '#8fbf6a';
  ctx.fillRect(ox + 11, 12, 3, 4);
  ctx.fillRect(ox + 20, 14, 3, 4);
}

let cached: THREE.CanvasTexture | null = null;

export function plantAtlasTexture(): THREE.CanvasTexture {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = S * PLANT_CELLS;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawFlower(ctx, 0, '#ff5f5f', '#ffd23e');
  drawFlower(ctx, S, '#ffd23e', '#e2762d');
  drawTuft(ctx, S * 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cached = tex;
  return tex;
}

// ---------------------------------------------------------------- block atlas

/** little pixel-art disc, drawn a pixel at a time so it stays chunky */
function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r + r * 0.6) continue;
      ctx.fillRect(cx + x, cy + y, 1, 1);
    }
  }
}

/**
 * The dynamite cells. A block face is only a few dozen pixels on screen and
 * side faces lose about half their brightness to the baked face shading, so
 * the artwork is bold, mostly red, and authored very bright.
 */
const DYNAMITE_STICKS: [number, number][] = [[1, 10], [12, 21], [23, 30]]; // [x0, x1]

/** one stick of dynamite, standing up, from x0..x1 */
function stick(ctx: CanvasRenderingContext2D, ox: number, x0: number, x1: number, topY: number): void {
  const w = x1 - x0 + 1;
  ctx.fillStyle = '#ff7d5c'; // the stick body
  ctx.fillRect(ox + x0, topY, w, S - topY);
  ctx.fillStyle = '#ffcdb9'; // light side
  ctx.fillRect(ox + x0, topY, 2, S - topY);
  ctx.fillStyle = '#e0492a'; // shadow side
  ctx.fillRect(ox + x1 - 1, topY, 2, S - topY);
  ctx.fillStyle = '#8e2b18'; // the gap between sticks
  ctx.fillRect(ox + x1, topY, 2, S - topY);
}

/** sides of the dynamite block: a bundle of three sticks in a paper wrapper */
function drawDynamiteSides(ctx: CanvasRenderingContext2D, ox: number): void {
  for (const [x0, x1] of DYNAMITE_STICKS) stick(ctx, ox, x0, x1, 1);
  // the kraft-paper band holding the bundle together, with stitching
  ctx.fillStyle = '#ffefd2';
  ctx.fillRect(ox, 12, S, 6);
  ctx.fillStyle = '#a8875a';
  ctx.fillRect(ox, 11, S, 1);
  ctx.fillRect(ox, 18, S, 1);
  ctx.fillStyle = '#6e5638';
  for (let x = 2; x < S; x += 5) ctx.fillRect(ox + x, 14, 2, 2);
  // hand-drawn "careful!" spark stamped under the band (no fonts, no assets)
  ctx.fillStyle = '#7a2a17';
  ctx.fillRect(ox + 15, 22, 2, 7);
  ctx.fillRect(ox + 12, 25, 8, 2);
  for (const [dx, dy] of [[-3, -3], [3, -3], [-3, 4], [3, 4]]) {
    ctx.fillRect(ox + 16 + dx, 25 + dy, 2, 2);
  }
  // paper foot of the bundle + dark rim along the top
  ctx.fillStyle = '#f2ddba';
  ctx.fillRect(ox, 29, S, 3);
  ctx.fillStyle = '#a8875a';
  ctx.fillRect(ox, 28, S, 1);
  ctx.fillStyle = '#8e2b18';
  ctx.fillRect(ox, 0, S, 1);
}

/** top/bottom of the dynamite block: the ends of the bundle + the fuse hole */
function drawDynamiteEnds(ctx: CanvasRenderingContext2D, ox: number): void {
  ctx.fillStyle = '#ff7d5c';
  ctx.fillRect(ox, 0, S, S);
  for (const [x0, x1] of DYNAMITE_STICKS) {
    const cx = Math.round((x0 + x1) / 2), cy = 16;
    disc(ctx, ox + cx, cy, 6, '#8e2b18');
    disc(ctx, ox + cx, cy, 5, '#e0492a');
    disc(ctx, ox + cx, cy, 4, '#ff7d5c');
    disc(ctx, ox + cx - 1, cy - 1, 2, '#ffcdb9');
  }
  // fuse hole in the middle stick, with a short stub of fuse
  disc(ctx, ox + 16, 16, 2, '#6e5638');
  ctx.fillStyle = '#a8875a';
  ctx.fillRect(ox + 15, 13, 2, 4);
  // paper wrapper edge around the whole face
  ctx.fillStyle = '#f2ddba';
  ctx.fillRect(ox, 0, S, 1);
  ctx.fillRect(ox, S - 1, S, 1);
  ctx.fillRect(ox, 0, 1, S);
  ctx.fillRect(ox + S - 1, 0, 1, S);
}

let cachedBlock: THREE.CanvasTexture | null = null;

export function blockAtlasTexture(): THREE.CanvasTexture {
  if (cachedBlock) return cachedBlock;
  const canvas = document.createElement('canvas');
  canvas.width = S * BLOCK_CELLS;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawDynamiteSides(ctx, S * ATLAS_DYNAMITE_SIDE);
  drawDynamiteEnds(ctx, S * ATLAS_DYNAMITE_CAP);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // These faces are lit like every other block, and block colours in this game
  // are used as plain linear values — decoding the canvas as sRGB would make
  // the artwork much darker than the flat-tint blocks next to it.
  tex.colorSpace = THREE.NoColorSpace;
  cachedBlock = tex;
  return tex;
}

/** u-range of one block-atlas cell, inset by half a pixel to stop bleeding */
export function blockCellU(cell: number): [number, number] {
  const pad = 0.5 / S;
  return [(cell + pad) / BLOCK_CELLS, (cell + 1 - pad) / BLOCK_CELLS];
}
