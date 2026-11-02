/**
 * Procedural plant textures (no external assets): a horizontal atlas of
 * 32x32 cells drawn on a canvas — red flower, sunflower, grass tuft.
 * The cross-quads sample these cells with alpha-test cutout.
 */

import * as THREE from 'three';

export const PLANT_CELLS = 3; // atlas cells side by side
export const PLANT_CELL_RED = 0;
export const PLANT_CELL_YELLOW = 1;
export const PLANT_CELL_TUFT = 2;

const S = 32; // cell size in px

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
