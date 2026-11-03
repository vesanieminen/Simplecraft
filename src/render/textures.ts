/**
 * Procedural textures (no external assets), all drawn on canvases:
 *  - a horizontal atlas of 32x32 *plant* cells (red flower, sunflower, grass
 *    tuft) sampled by the cross-quads with alpha-test cutout;
 *  - a horizontal atlas of 32x32 *block* cells: every block in the game is
 *    painted from here rather than flat-tinted (grass, dirt, stone, planks,
 *    bricks, glass, water, the candy colours, bedrock, scorch, dynamite…).
 *
 * A block face is only a few dozen pixels on screen and side faces lose about
 * half their brightness to the baked face shading, ambient occlusion and
 * Lambert light — so all of this is authored chunky and very bright.
 */

import * as THREE from 'three';
import {
  ATLAS_BOUNCY, ATLAS_BRICKS, ATLAS_CELL_COUNT, ATLAS_DIRT, ATLAS_DOOR, ATLAS_DOOR_TOP, ATLAS_DYNAMITE_CAP,
  ATLAS_DYNAMITE_SIDE, ATLAS_GLASS, ATLAS_GLOW, ATLAS_GRASS_SIDE, ATLAS_GRASS_TOP,
  ATLAS_LEAVES, ATLAS_LOG_END, ATLAS_LOG_SIDE, ATLAS_MUSIC, ATLAS_PLANKS, ATLAS_ROCK,
  ATLAS_SAND, ATLAS_SCORCH, ATLAS_SPARKLE, ATLAS_STONE, ATLAS_WATER, ATLAS_WEAVE,
  PLANT_ATLAS_CELLS,
} from '../core/blocks';

export const PLANT_CELLS = PLANT_ATLAS_CELLS; // atlas cells side by side

/** number of cells in the block atlas (side by side) */
export const BLOCK_CELLS = ATLAS_CELL_COUNT;

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

/**
 * A baby tree for the sapling block: little trunk, a leafy hand of a crown.
 * Big enough that a planted sapling reads as "this will be a tree".
 */
function drawSapling(ctx: CanvasRenderingContext2D, ox: number): void {
  // trunk
  stem(ctx, ox, 14, 20, 32, 3, '#7a5230');
  stem(ctx, ox, 15, 20, 32, 1, '#a3754a');
  // two roots flaring into the ground line
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(ox + 11, 30, 3, 2);
  ctx.fillRect(ox + 19, 30, 3, 2);
  // crown: chunky leaf clusters, bright where the sun hits
  ctx.fillStyle = '#3f8536';
  ctx.fillRect(ox + 8, 10, 16, 11);
  ctx.fillRect(ox + 11, 7, 10, 3);
  ctx.fillRect(ox + 5, 14, 4, 6);
  ctx.fillRect(ox + 23, 14, 4, 6);
  ctx.fillStyle = '#5cae4e';
  ctx.fillRect(ox + 10, 9, 12, 6);
  ctx.fillStyle = '#8ade68';
  ctx.fillRect(ox + 12, 8, 6, 3);
  ctx.fillRect(ox + 8, 12, 3, 3);
  // a couple of leaf tips poking out
  ctx.fillStyle = '#4d9c43';
  ctx.fillRect(ox + 6, 10, 3, 3);
  ctx.fillRect(ox + 24, 11, 3, 3);
}

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
  drawSapling(ctx, S * 3);
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

function rect(ctx: CanvasRenderingContext2D, ox: number, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(ox + x, y, w, h);
}

/** deterministic speckle: paper, grit, sand — never the same twice per cell */
function speckle(ctx: CanvasRenderingContext2D, ox: number, color: string, density: number, seed = 7): void {
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  ctx.fillStyle = color;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) if (rnd() < density) ctx.fillRect(ox + x, y, 1, 1);
  }
}

/** a hard outline around the whole face, which is what makes a block a block */
function outline(ctx: CanvasRenderingContext2D, ox: number, color: string): void {
  rect(ctx, ox, 0, 0, S, 1, color);
  rect(ctx, ox, 0, S - 1, S, 1, color);
  rect(ctx, ox, 0, 0, 1, S, color);
  rect(ctx, ox, S - 1, 0, 1, S, color);
}

// --- the dynamite bundle -----------------------------------------------------

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
  outline(ctx, ox, '#f2ddba');
}

// --- ground ------------------------------------------------------------------

/** dirt: soft clods of two browns */
function drawDirt(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#c07f49');
  speckle(ctx, ox, '#9c6534', 0.12, 3);
  for (const [x, y, r] of [[5, 7, 3], [20, 5, 2], [12, 19, 3], [26, 22, 2], [3, 26, 2]] as const) {
    disc(ctx, ox + x, y, r, '#a06a37');
    disc(ctx, ox + x - 1, y - 1, r - 1, '#d29259');
  }
}

/** grass top: bright green with little blade tufts */
function drawGrassTop(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#75c751');
  speckle(ctx, ox, '#5cab3f', 0.14, 11);
  ctx.fillStyle = '#8ade68';
  for (let i = 0; i < 26; i++) ctx.fillRect(ox + ((i * 7 + 3) % S), (i * 11 + 5) % S, 1, 3);
  ctx.fillStyle = '#4f9a35';
  for (let i = 0; i < 12; i++) ctx.fillRect(ox + ((i * 13 + 2) % S), (i * 5 + 9) % S, 2, 1);
}

/** grass side: the dirt block with a green fringe hanging over the top */
function drawGrassSide(ctx: CanvasRenderingContext2D, ox: number): void {
  drawDirt(ctx, ox);
  rect(ctx, ox, 0, 0, S, 5, '#75c751');
  rect(ctx, ox, 0, 5, S, 1, '#4f9a35');
  ctx.fillStyle = '#8ade68';
  for (let x = 0; x < S; x += 3) ctx.fillRect(ox + x, 1, 2, 3);
  ctx.fillStyle = '#75c751';
  for (const x of [1, 6, 13, 18, 24, 29]) ctx.fillRect(ox + x, 6, 2, 2);
  ctx.fillStyle = '#3f7d2b';
  outline(ctx, ox, '#3f7d2b');
  rect(ctx, ox, 0, 0, S, 1, '#8ade68');
}

/** scorch: what the rim of a crater looks like afterwards */
function drawScorch(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#8b6748');
  speckle(ctx, ox, '#4c3a2a', 0.18, 19);
  for (const [x, y, r] of [[7, 8, 4], [21, 6, 3], [14, 20, 4], [27, 24, 3]] as const) {
    disc(ctx, ox + x, y, r, '#3a2c20');
    disc(ctx, ox + x - 1, y - 1, r - 2, '#6b4f37');
  }
  ctx.fillStyle = '#2c211a';
  ctx.fillRect(ox + 2, 14, 12, 1); // cracks the blast left behind
  ctx.fillRect(ox + 18, 12, 11, 1);
  outline(ctx, ox, '#5b4430');
}

// --- stone, sand and wood ----------------------------------------------------

/** stone: cool grey boulders with dark cracks between them */
function drawStone(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#a7afba');
  for (const [x, y, w, h] of [[1, 1, 13, 12], [16, 2, 14, 10], [2, 15, 11, 13], [15, 14, 15, 15]] as const) {
    rect(ctx, ox, x, y, w, h, '#bcc4cd');
    rect(ctx, ox, x, y, w, 1, '#d3dae1');
    rect(ctx, ox, x, y + h - 1, w, 1, '#8b939e');
  }
  rect(ctx, ox, 14, 0, 2, S, '#868e99');
  rect(ctx, ox, 0, 13, S, 2, '#868e99');
  speckle(ctx, ox, '#98a0aa', 0.08, 5);
}

/** bedrock: the same idea, darker and sturdier */
function drawRock(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#666d7a');
  for (const [x, y, w, h] of [[1, 1, 13, 13], [16, 3, 13, 11], [3, 17, 12, 13], [18, 17, 12, 12]] as const) {
    rect(ctx, ox, x, y, w, h, '#7a8290');
    rect(ctx, ox, x, y, w, 1, '#949cab');
    rect(ctx, ox, x, y + h - 1, w, 1, '#4c525d');
  }
  speckle(ctx, ox, '#4c525d', 0.12, 37);
}

/** sand: pale grains */
function drawSand(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#f7e3ae');
  speckle(ctx, ox, '#e6cd8f', 0.16, 17);
  speckle(ctx, ox, '#fff6d8', 0.10, 23);
}

/** log side: bark with vertical grain */
function drawLogSide(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#9a6738');
  for (const [x, w, c] of [
    [1, 3, '#75491f'], [7, 2, '#b47c46'], [11, 4, '#75491f'],
    [18, 3, '#b47c46'], [23, 2, '#75491f'], [27, 4, '#87582b'],
  ] as const) rect(ctx, ox, x, 0, w, S, c);
  speckle(ctx, ox, '#653d18', 0.07, 13);
  rect(ctx, ox, 0, 0, S, 1, '#75491f');
  rect(ctx, ox, 0, S - 1, S, 1, '#75491f');
}

/** log end: growth rings */
function drawLogEnd(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#d5a96e');
  disc(ctx, ox + 16, 16, 14, '#c2925a');
  disc(ctx, ox + 16, 16, 11, '#d5a96e');
  disc(ctx, ox + 16, 16, 8, '#c2925a');
  disc(ctx, ox + 16, 16, 5, '#d5a96e');
  disc(ctx, ox + 16, 16, 2, '#ad7c46');
  outline(ctx, ox, '#75491f');
}

/** planks: four boards with real gaps, staggered butt joints, grain and nails */
function drawPlanks(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#a97e46'); // the dark gap behind the boards
  for (const y of [0, 8, 16, 24]) {
    rect(ctx, ox, 0, y, S, 7, '#f2c98c'); // the board
    rect(ctx, ox, 0, y, S, 1, '#ffe3ae'); // bright top edge
    rect(ctx, ox, 0, y + 6, S, 1, '#d3a463'); // shaded bottom edge
    // long pale grain streaks
    ctx.fillStyle = '#e2b473';
    for (let i = 0; i < 4; i++) {
      const gx = (i * 7 + y * 3 + 2) % 24;
      ctx.fillRect(ox + gx, y + 1 + (i % 3) * 2, 6 + (i % 2) * 4, 1);
    }
    // staggered butt joint: where one board ends and the next begins
    const seam = (y / 8) % 2 === 0 ? 6 : 22;
    rect(ctx, ox, seam, y, 1, 7, '#a97e46');
    rect(ctx, ox, seam + 1, y, 1, 7, '#ffe3ae');
    // nail heads near both ends
    for (const nx of [3, S - 5]) {
      ctx.fillStyle = '#7c5a2e';
      ctx.fillRect(ox + nx, y + 2, 2, 2);
      ctx.fillStyle = '#fff7e0';
      ctx.fillRect(ox + nx, y + 2, 1, 1);
    }
  }
}

/** bricks: red bricks over pale mortar, rows offset */
function drawBricks(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#f0e6d2');
  for (let row = 0; row < 4; row++) {
    const y = row * 8;
    const off = row % 2 === 0 ? 0 : 8;
    for (let col = -1; col < 3; col++) {
      const x = col * 16 + off;
      rect(ctx, ox, x + 1, y + 1, 14, 6, '#e35c40');
      rect(ctx, ox, x + 1, y + 1, 14, 1, '#f78060');
      rect(ctx, ox, x + 1, y + 6, 14, 1, '#b03d27');
    }
  }
}

/** door: wooden boards, two recessed panels, hinges and a round brass knob */
function drawDoor(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#c98d52'); // the door slab
  for (const x of [2, 10, 18, 26]) rect(ctx, ox, x, 1, 1, S - 2, '#a86e3a'); // board gaps
  speckle(ctx, ox, '#b87c44', 0.06, 43);
  rect(ctx, ox, 0, 0, S, 2, '#e0aa70'); // frame top
  rect(ctx, ox, 0, S - 2, S, 2, '#8a5a2c'); // frame bottom (shadow side)
  rect(ctx, ox, 0, 0, 2, S, '#e0aa70'); // frame left…
  rect(ctx, ox, S - 2, 0, 2, S, '#8a5a2c'); // …and right
  // two recessed panels: light face, dark inset edge
  for (const [py, ph] of [[5, 11], [19, 9]] as const) {
    rect(ctx, ox, 5, py, 22, ph, '#d9a766');
    rect(ctx, ox, 5, py, 22, 1, '#96632f');
    rect(ctx, ox, 5, py, 1, ph, '#96632f');
    rect(ctx, ox, 5, py + ph - 1, 22, 1, '#efd0a0');
    rect(ctx, ox, 26, py, 1, ph, '#efd0a0');
  }
  // hinges on the left edge
  ctx.fillStyle = '#5c4a38';
  ctx.fillRect(ox + 1, 4, 4, 3);
  ctx.fillRect(ox + 1, 24, 4, 3);
  ctx.fillStyle = '#8f7a5f';
  ctx.fillRect(ox + 1, 4, 4, 1);
  ctx.fillRect(ox + 1, 24, 4, 1);
  // brass knob on the right
  disc(ctx, ox + 27, 16, 2, '#8a5a2c');
  disc(ctx, ox + 27, 16, 2, '#f2c14e');
  ctx.fillStyle = '#fff3c4';
  ctx.fillRect(ox + 26, 15, 1, 1);
}

/**
 * The upper half of the two-block door: the same slab and frame, one tall
 * panel, and a little window so a kid can see who is on the other side.
 */
function drawDoorTop(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#c98d52'); // the door slab
  for (const x of [2, 10, 18, 26]) rect(ctx, ox, x, 1, 1, S - 2, '#a86e3a'); // board gaps
  speckle(ctx, ox, '#b87c44', 0.06, 71);
  rect(ctx, ox, 0, 0, S, 2, '#e0aa70'); // frame top
  rect(ctx, ox, 0, S - 2, S, 2, '#8a5a2c'); // frame bottom (shadow side)
  rect(ctx, ox, 0, 0, 2, S, '#e0aa70'); // frame left…
  rect(ctx, ox, S - 2, 0, 2, S, '#8a5a2c'); // …and right
  // one tall recessed panel, same style as the lower half's panels
  rect(ctx, ox, 5, 5, 22, 22, '#d9a766');
  rect(ctx, ox, 5, 5, 22, 1, '#96632f');
  rect(ctx, ox, 5, 5, 1, 22, '#96632f');
  rect(ctx, ox, 5, 26, 22, 1, '#efd0a0');
  rect(ctx, ox, 26, 5, 1, 22, '#efd0a0');
  // the window: dark reveal, pale glass, glazing bars and one bright pane
  rect(ctx, ox, 9, 9, 14, 14, '#6c4f30');
  rect(ctx, ox, 10, 10, 12, 12, '#cfe6f2');
  rect(ctx, ox, 10, 10, 12, 1, '#9fc4d8');
  rect(ctx, ox, 15, 10, 1, 12, '#7d9fb3');
  rect(ctx, ox, 10, 15, 12, 1, '#7d9fb3');
  ctx.fillStyle = '#f4fbff';
  ctx.fillRect(ox + 11, 11, 3, 3);
}

// --- see-through and special blocks -----------------------------------------

/** leaves: chunky green lumps with darker veins and gaps */
function drawLeaves(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#57b84a');
  for (const [x, y] of [[2, 2], [12, 1], [22, 3], [5, 12], [17, 13], [27, 15], [3, 23], [13, 25], [24, 26]] as const) {
    disc(ctx, ox + x + 3, y + 3, 4, '#6ccd59');
    disc(ctx, ox + x + 2, y + 2, 2, '#86e071');
  }
  ctx.fillStyle = '#347c2c';
  for (const [x, y] of [[8, 8], [20, 9], [10, 20], [26, 21]] as const) {
    ctx.fillRect(ox + x, y, 1, 4); // little twigs
    ctx.fillRect(ox + x - 2, y + 2, 2, 1);
    ctx.fillRect(ox + x + 2, y + 1, 2, 1);
  }
  speckle(ctx, ox, '#47953b', 0.09, 29);
}

/** glass: barely-there blue, one bright streak and a frame you can see */
function drawGlass(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#dff2fa');
  ctx.fillStyle = '#ffffff';
  for (const [x, y, w, h] of [[4, 3, 2, 12], [7, 3, 1, 8], [18, 8, 2, 14], [21, 12, 1, 7]] as const) {
    ctx.fillRect(ox + x, y, w, h);
  }
  ctx.fillStyle = '#a8d8ea';
  ctx.fillRect(ox, 0, S, 2);
  ctx.fillRect(ox, S - 2, S, 2);
  ctx.fillRect(ox, 0, 2, S);
  ctx.fillRect(ox + S - 2, 0, 2, S);
}

/** water: blue with wave lines and a little foam */
function drawWater(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#5cb4ee');
  ctx.fillStyle = '#8fd2f7';
  for (let y = 2; y < S; y += 6) {
    for (let x = 0; x < S; x += 8) {
      ctx.fillRect(ox + x, y, 5, 2);
      ctx.fillRect(ox + x + 4, y + 2, 4, 1);
    }
  }
  ctx.fillStyle = '#3a8ecb';
  for (let y = 5; y < S; y += 6) ctx.fillRect(ox, y, S, 1);
  ctx.fillStyle = '#e8f8ff';
  ctx.fillRect(ox + 6, 14, 3, 1);
  ctx.fillRect(ox + 22, 26, 4, 1);
}

/** glow block: a little sun */
function drawGlow(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#ffe774');
  disc(ctx, ox + 16, 16, 9, '#fff6ac');
  disc(ctx, ox + 16, 16, 5, '#fffef4');
  ctx.fillStyle = '#f6bd3e';
  for (const [x, y, w, h] of [
    [2, 2, 4, 1], [2, 2, 1, 4], [26, 2, 4, 1], [29, 2, 1, 4],
    [2, 28, 4, 1], [2, 25, 1, 4], [26, 29, 4, 1], [29, 25, 1, 4],
  ] as const) ctx.fillRect(ox + x, y, w, h);
}

/** bouncy block: springs in a row, so you know what it does */
function drawBouncy(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#ff77a5');
  ctx.fillStyle = '#ffd8e7';
  for (let y = 2; y < S; y += 8) {
    for (let x = 0; x < S; x += 8) {
      ctx.fillRect(ox + x + 3, y, 2, 2);
      ctx.fillRect(ox + x + 1, y + 2, 2, 2);
      ctx.fillRect(ox + x + 5, y + 2, 2, 2);
      ctx.fillRect(ox + x, y + 4, 2, 2);
      ctx.fillRect(ox + x + 6, y + 4, 2, 2);
    }
  }
  ctx.fillStyle = '#e0537f';
  ctx.fillRect(ox, S - 2, S, 2);
}

/** sparkle block: lavender with little four-point stars */
function drawSparkle(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#c6a3f5');
  for (const [x, y] of [[6, 5], [20, 3], [12, 15], [26, 18], [4, 25], [21, 27]] as const) {
    ctx.fillStyle = '#f7eeff';
    ctx.fillRect(ox + x, y - 2, 2, 6);
    ctx.fillRect(ox + x - 2, y, 6, 2);
  }
  speckle(ctx, ox, '#ad82e2', 0.09, 31);
}

/** music block: a chunky quaver (drawn with rects — no fonts involved) */
function drawMusic(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#8fe0d0');
  ctx.fillStyle = '#2f6f65';
  ctx.fillRect(ox + 12, 6, 2, 16); // stem
  ctx.fillRect(ox + 14, 6, 6, 2); // flag
  ctx.fillRect(ox + 18, 8, 2, 4);
  disc(ctx, ox + 10, 22, 4, '#2f6f65'); // note head
  ctx.fillStyle = '#eafffb';
  for (const [x, y] of [[4, 4], [26, 6], [24, 26]] as const) {
    ctx.fillRect(ox + x, y, 3, 1);
    ctx.fillRect(ox + x + 1, y - 1, 1, 3);
  }
}

/** the candy colours: near-white weave, so the block's own tint multiplies through */
function drawWeave(ctx: CanvasRenderingContext2D, ox: number): void {
  rect(ctx, ox, 0, 0, S, S, '#ffffff');
  ctx.fillStyle = '#ececec';
  for (let x = 0; x < S; x += 4) ctx.fillRect(ox + x, 0, 2, S);
  ctx.fillStyle = '#f6f6f6';
  for (let y = 0; y < S; y += 4) ctx.fillRect(ox, y, S, 2);
  ctx.fillStyle = '#dcdcdc';
  ctx.fillRect(ox, 0, S, 1);
  ctx.fillRect(ox, S - 1, S, 1);
  ctx.fillRect(ox, 0, 1, S);
  ctx.fillRect(ox + S - 1, 0, 1, S);
  speckle(ctx, ox, '#efefef', 0.07, 41);
}

type CellArt = (ctx: CanvasRenderingContext2D, ox: number) => void;

/** every atlas cell, keyed by its id from core/blocks.ts */
const BLOCK_ART: Record<number, CellArt> = {
  [ATLAS_DYNAMITE_SIDE]: drawDynamiteSides,
  [ATLAS_DYNAMITE_CAP]: drawDynamiteEnds,
  [ATLAS_GRASS_TOP]: drawGrassTop,
  [ATLAS_GRASS_SIDE]: drawGrassSide,
  [ATLAS_DIRT]: drawDirt,
  [ATLAS_STONE]: drawStone,
  [ATLAS_SAND]: drawSand,
  [ATLAS_LOG_SIDE]: drawLogSide,
  [ATLAS_LOG_END]: drawLogEnd,
  [ATLAS_PLANKS]: drawPlanks,
  [ATLAS_BRICKS]: drawBricks,
  [ATLAS_GLASS]: drawGlass,
  [ATLAS_LEAVES]: drawLeaves,
  [ATLAS_WATER]: drawWater,
  [ATLAS_GLOW]: drawGlow,
  [ATLAS_BOUNCY]: drawBouncy,
  [ATLAS_SPARKLE]: drawSparkle,
  [ATLAS_MUSIC]: drawMusic,
  [ATLAS_ROCK]: drawRock,
  [ATLAS_SCORCH]: drawScorch,
  [ATLAS_WEAVE]: drawWeave,
  [ATLAS_DOOR]: drawDoor,
  [ATLAS_DOOR_TOP]: drawDoorTop,
};

let cachedBlock: THREE.CanvasTexture | null = null;

export function blockAtlasTexture(): THREE.CanvasTexture {
  if (cachedBlock) return cachedBlock;
  const canvas = document.createElement('canvas');
  canvas.width = S * BLOCK_CELLS;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let cell = 0; cell < BLOCK_CELLS; cell++) {
    const art = BLOCK_ART[cell];
    if (!art) throw new Error(`block atlas: cell ${cell} has no artwork`);
    art(ctx, S * cell);
  }
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
