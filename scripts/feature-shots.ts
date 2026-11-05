/**
 * Feature screenshots: the world picker (with its live map preview), a close-up
 * of the textured plants, every block in the atlas, a stick of dynamite and a
 * staircase with a treasure chest on it.
 * Run against a dev server (fresh world data recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/feature-shots.ts
 * (LBW_SHOT_URL points the shots at another port if 3100 is busy)
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  (window as any).__name = (fn: unknown) => fn;
});
// headless Chromium has no emoji font: strip emoji from UI text nodes so labels read cleanly
await page.addInitScript(() => {
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
  const fix = () => {
    for (const root of document.querySelectorAll('.overlay-card, .hud')) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      for (const node of nodes) {
        const cleaned = node.data.replace(EMOJI, '').replace(/\s{2,}/g, ' ');
        if (cleaned !== node.data) node.data = cleaned;
      }
    }
  };
  new MutationObserver(fix).observe(document, { subtree: true, childList: true, characterData: true });
  document.addEventListener('DOMContentLoaded', fix);
});
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
// a seed nobody has built on yet, so the shots show pure generated terrain
await page.goto('http://localhost:3100/?seed=8675309&world=0');
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });
const frames = (n: number) => page.evaluate((k: number) => new Promise<void>((resolve) => {
  let left = k;
  const tick = (): void => { left--; if (left <= 0) resolve(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), n);
const tap = async (a: string): Promise<void> => {
  await page.evaluate((x: string) => (window as any).__pad.tap(x), a);
  await frames(2);
};

// ---- 1. world picker: one controller, no players yet ----
await page.evaluate(() => {
  const pad = (window as any).__lbw.addVirtualPad('xbox');
  (window as any).__pad = pad;
  pad.tap('palette');
});
await page.waitForSelector('.world-preview');
await tap('right'); // Islands
await tap('right'); // Mountains
await page.waitForTimeout(1500); // let the orbit backdrop settle behind the card
await page.screenshot({ path: `${outDir}/worlds.jpg`, type: 'jpeg', quality: 92 });
await tap('right'); // Deep Forest
await tap('right'); // back to Meadow (prettier for the garden shot)

// start this world (bottom row)
for (let i = 0; i < 8; i++) {
  const sel = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.overlay-card .menu-item')];
    return { sel: rows.findIndex((r) => r.classList.contains('sel')), n: rows.length };
  });
  if (sel.sel === sel.n - 1) break;
  await tap('down');
}
await tap('jump');
await page.waitForSelector('.world-preview', { state: 'detached' });
await page.waitForFunction('window.__lbw.game.world.theme === 0', null, { timeout: 20000 });

// ---- 2. the same controller joins (its Start press also wakes a join card) ----
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0', null, { timeout: 20000 });
await tap('jump'); // confirm the join card
await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 20000 });
await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 20000 });

await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const mid = Math.floor(((window as any).__lbw.dims.sx) / 2);

  // a tidy flower bed on the meadow, plus a few tall tufts to hide behind
  for (let x = mid - 6; x <= mid + 6; x++) {
    for (let z = mid - 9; z <= mid - 2; z++) {
      const top = S.surfaceY(x, z);
      for (let y = top + 1; y <= top + 3; y++) if (S.get(x, y, z) !== 0) S.set(x, y, z, 0);
    }
  }
  const kinds = [11, 12, 13]; // flower, sunflower, tuft
  for (let x = mid - 5; x <= mid + 5; x++) {
    for (let z = mid - 8; z <= mid - 4; z++) {
      S.set(x, S.surfaceY(x, z) + 1, z, kinds[(x * 3 + z) % 3]);
    }
  }
  // a couple of tufts at the near edge for depth
  S.set(mid - 4, S.surfaceY(mid - 4, mid - 2) + 1, mid - 2, 13);
  S.set(mid + 4, S.surfaceY(mid + 4, mid - 2) + 1, mid - 2, 13);

  // first person, standing a few steps back, looking into the bed
  const p = game.players[0];
  p.firstPerson = true;
  p.selected = 11;
  const fx = mid, fz = mid + 4;
  p.entity.pos.set(fx + 0.5, S.surfaceY(fx, fz) + 1.02, fz + 0.5);
  p.entity.yaw = Math.PI; // face -Z, into the bed
  p.entity.pitch = -0.13;
  p.entity.vel.set(0, 0, 0);
});
await page.waitForTimeout(3000); // chunk remeshes + camera settle
await page.screenshot({ path: `${outDir}/plants.jpg`, type: 'jpeg', quality: 92 });

// ---- 3. every block, painted from the atlas (cleared glade, so sky is the backdrop) ----
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const mid = Math.floor(((window as any).__lbw.dims.sx) / 2);
  const wall: number[][] = [
    [1, 2, 3, 4, 5, 6, 7, 8], // grass dirt stone sand wood planks bricks glass
    [9, 10, 14, 15, 16, 17, 18, 27], // leaves water glow bouncy sparkle music red dynamite
    // the "not a cube" shape language: slab, step, chest shut, chest open
    [32, 35, 36, 37],
  ];
  // the step in the shape row (second cell) shows the camera its tread
  game.world.setStairFacing(bx, by + 2, mid - 3, 0);
  const bx = mid + 9;
  const by = S.surfaceY(bx, mid) + 1;
  // clear the air between the camera and the wall, and the wall's own cells
  for (let x = mid - 1; x <= bx + 1; x++) {
    for (let z = mid - 6; z <= mid + 6; z++) {
      for (let y = S.surfaceY(x, z) + 1; y <= by + 3; y++) if (S.get(x, y, z) !== 0) S.set(x, y, z, 0);
    }
  }
  wall.forEach((row, r) => row.forEach((id, c) => S.set(bx, by + r, mid + c - 4, id)));
  const p = game.players[0];
  p.firstPerson = true;
  p.entity.pos.set(bx - 9, S.surfaceY(bx - 9, mid) + 1.02, mid + 0.5);
  p.entity.yaw = Math.PI / 2; // face +X, at the wall
  p.entity.pitch = 0.02;
  p.entity.vel.set(0, 0, 0);
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/blocks.jpg`, type: 'jpeg', quality: 92 });

// ---- 4. dynamite, fuse well underway ----
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const mid = Math.floor(((window as any).__lbw.dims.sx) / 2);
  const fx = mid - 1, fz = mid + 3;
  const top = S.surfaceY(fx, fz) + 1;
  S.set(fx, top, fz, 27);
  game.dynamite.clear();
  game.dynamite.light(fx, top, fz, 12); // a long fuse, so the shot catches it mid-burn
  const p = game.players[0];
  p.firstPerson = true;
  // the aim helpers re-show themselves every frame, so pin them off for the photo
  for (const obj of [p.ghost, p.outline]) {
    Object.defineProperty(obj, 'visible', { get: () => false, set: () => undefined });
  }
  p.entity.pos.set(fx - 2.7, S.surfaceY(fx - 3, fz) + 1.02, fz + 0.4);
  p.entity.yaw = Math.PI / 2;
  p.entity.pitch = -0.12; // the stick, its fuse and the "!" all in one frame
  p.entity.vel.set(0, 0, 0);
});
await page.waitForTimeout(2600);
await page.screenshot({ path: `${outDir}/dynamite.jpg`, type: 'jpeg', quality: 92 });

// ---- 5. slabs, stairs and a treasure chest: a build a kid could walk up ----
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const ids = (window as any).__lbw.ids;
  const mid = Math.floor(((window as any).__lbw.dims.sx) / 2);
  const bx = mid + 10;
  const by = S.surfaceY(bx, mid) + 1; // the first free cell above the meadow floor
  // flatten the stand for the build
  for (let x = bx - 12; x <= bx + 2; x++) {
    for (let z = mid - 5; z <= mid + 3; z++) {
      for (let y = by; y <= by + 5; y++) if (S.get(x, y, z) !== 0) S.set(x, y, z, 0);
    }
  }
  const deck = by + 3; // top of the platform, where the chest sits
  for (let x = bx - 4; x <= bx - 1; x++) {
    for (let z = mid - 2; z <= mid + 1; z++) {
      for (let y = by; y <= deck - 1; y++) S.set(x, y, z, ids.PLANKS);
    }
  }
  // three steps climbing to the deck: one block over, one block up, riser away
  for (let i = 0; i < 3; i++) {
    const x = bx - 5 - i, y = deck - 1 - i;
    for (let z = mid - 2; z <= mid + 1; z++) {
      S.set(x, y, z, ids.STAIRS);
      S.setStairFacing(x, y, z, 0); // tall half towards the deck
    }
  }
  // slabs pave the approach, where the meadow is flat
  for (let x = bx - 11; x <= bx - 8; x++) {
    for (let z = mid - 2; z <= mid + 1; z++) {
      if (S.surfaceY(x, z) + 1 === by) S.set(x, by, z, ids.SLAB);
    }
  }
  S.set(bx - 2, deck, mid - 1, ids.CHEST);

  const p = game.players[0];
  p.firstPerson = true;
  // stood on the top step, looking across the deck at the lid
  p.entity.pos.set(bx - 4.8, deck - 0.5, mid - 0.5);
  p.entity.yaw = Math.PI / 2; // face +x: up the steps, at the chest
  p.entity.pitch = -0.1;
  p.entity.vel.set(0, 0, 0);
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${outDir}/steps.jpg`, type: 'jpeg', quality: 92 });

console.log('saved', fs.readdirSync(outDir).join(', '));
await browser.close();
