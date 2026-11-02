/**
 * Hero-shot generator: builds a cute staged scene (house, animals,
 * stars, path) and saves README screenshots into docs/screenshots.
 * Run against a dev/prod server on :3100 (fresh world data recommended):
 *   rm -rf /tmp/opencode/lbw-test-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-test-world npx tsx server/index.ts &
 *   npx tsx scripts/hero-shot.ts
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
// tsx/esbuild's keepNames injects __name() wrappers into compiled functions;
// provide a shim so functions defined inside page.evaluate run in the browser.
await page.addInitScript(() => {
  (window as any).__name = (fn: unknown) => fn;
});
// headless Chromium has no emoji font: swap HUD emoji for BMP glyphs that render
await page.addInitScript(() => {
  const fix = () => {
    for (const el of document.querySelectorAll('.hud .stars')) {
      if (el.textContent && el.textContent.indexOf('\u2b50') >= 0) {
        el.textContent = el.textContent.replace('\u2b50', '\u2605');
      }
    }
    for (const el of document.querySelectorAll('.block-swatch')) el.textContent = '';
  };
  new MutationObserver(fix).observe(document, { subtree: true, childList: true, characterData: true });
  document.addEventListener('DOMContentLoaded', fix);
});
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
await page.goto('http://localhost:3100/');
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });

// join player 1
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const pad = game.addVirtualPad('xbox');
  (window as any).__pad1 = pad;
  pad.tap('jump');
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0');
await page.evaluate(() => (window as any).__pad1.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 1');

// Stage the scene. The meadow center is now (64,64), so the whole staged
// yard (designed around the old 32,32 spawn) is shifted by OX/OZ.
// Sun comes from (+X east, -Z north), so the house's NORTH wall (z = hz side,
// facing -Z) catches the warm light — that's the front door side, and the
// camera views it from the north-west yard.
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const dims = (window as any).__lbw.dims;
  const OX = dims.sx / 2 - 32, OZ = dims.sz / 2 - 32;
  const S = game.world;
  const hx = 31 + OX, hz = 26 + OZ; // footprint 5 wide; door on the north wall (z=hz)
  const y = S.surfaceY(hx, hz) + 1; // capture BEFORE staging
  function put(x: number, yy: number, z: number, b: number): void {
    S.set(x, y + yy, z, b);
  }

  // tidy the north yard: remove scattered flowers/tallgrass (full-column scan)
  for (let x = hx - 12; x <= hx + 14; x++) {
    for (let z = hz - 14; z <= hz + 14; z++) {
      for (let yy = 2; yy <= 24; yy++) {
        const id = S.get(x, yy, z);
        if (id === 11 || id === 12 || id === 13) S.set(x, yy, z, 0);
      }
    }
  }

  // floor (planks)
  for (let x = hx; x <= hx + 4; x++) for (let z = hz; z <= hz + 4; z++) put(x, 0, z, 6);
  // walls: brick, with a wide doorway + windows + attic window on the NORTH wall
  for (let h = 1; h <= 3; h++) {
    for (let i = 0; i <= 4; i++) {
      const door = h === 1 && (i === 2 || i === 3);
      const win = (h === 2 && i === 1) || (h === 3 && (i === 2 || i === 3));
      if (!door) put(hx + i, h, hz, win ? 8 : 7);
      put(hx + i, h, hz + 4, 7);
      put(hx, h, hz + i, 7);
      put(hx + 4, h, hz + i, 7);
    }
  }
  // windows on the east (sunlit) wall too
  put(hx + 4, 2, hz + 2, 8);
  // glow-lit interior so windows glow warmly
  put(hx + 2, 1, hz + 2, 14);
  put(hx + 2, 3, hz + 2, 14); // behind the attic window
  put(hx + 1, 3, hz + 2, 14);
  put(hx + 3, 3, hz + 2, 14);
  // warm plank roof + sparkle chimney
  for (let x = hx; x <= hx + 4; x++) for (let z = hz; z <= hz + 4; z++) put(x, 4, z, 6);
  put(hx + 4, 5, hz + 1, 7); // brick chimney
  put(hx + 4, 6, hz + 1, 16); // sparkle top
  put(hx + 2, 1, hz - 1, 14); // glowing lantern block beside the door

  // bouncy block at the yard edge
  S.set(hx + 5, S.surfaceY(hx + 5, hz - 2) + 1, hz - 2, 15);
  // colorful stepping-stone path leading to the north door
  const pathCols = [4, 20, 6, 24, 22, 19];
  for (let i = 0; i < 6; i++) S.set(hx + 2, S.surfaceY(hx + 2, hz - 2 - i) + 1, hz - 2 - i, pathCols[i]);
  // tidy flower + tuft clusters around the yard (shows off all three plant textures)
  const spots: [number, number][] = [[hx - 1, hz - 1], [hx - 2, hz - 3], [hx + 6, hz - 4], [hx + 5, hz - 8], [hx - 3, hz - 6], [hx + 8, hz + 1], [hx + 1, hz - 9], [hx + 3, hz - 9]];
  const PLANTS = [11, 12, 13];
  spots.forEach(function ([fx, fz], i) {
    S.set(fx, S.surfaceY(fx, fz) + 1, fz, PLANTS[i % PLANTS.length]);
  });

  // pose the animals in the north yard; park all others far away out of frame
  const near: [number, number][] = [[hx - 1.5, hz + 0.5], [hx - 2.5, hz - 1.0], [hx + 7.5, hz + 0.5]];
  const farm: [number, number][] = [[8, 12], [10, 9], [12, 14], [9, 7], [14, 11], [7, 15], [13, 8], [11, 13]];
  game.animals.animals.forEach(function (a: any, i: number) {
    const spot = i < 3 ? near[i] : farm[i % farm.length];
    a.pos.x = spot[0] + 0.5;
    a.pos.z = spot[1] + 0.5;
    a.pos.y = S.surfaceY(Math.floor(spot[0]), Math.floor(spot[1])) + 1.02;
  });

  // hang stars around the door; park the rest far behind the camera
  game.starField.stars.forEach(function (s: any, i: number) {
    if (i < 3) s.pos.set(hx + 0.8 + i * 1.5, y + 3.2 + (i % 2) * 0.7, hz - 1.4 - i * 0.3);
    else s.pos.set(14 + (i % 4) * 3 + OX, y + 8 + (i % 3), 14 + Math.floor(i / 4) * 3 + OZ);
  });
});
await page.waitForTimeout(1200); // let chunk remeshes land

// HERO SHOT: first-person on the path, facing the sunlit front door
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const dims = (window as any).__lbw.dims;
  const OX = dims.sx / 2 - 32, OZ = dims.sz / 2 - 32;
  const S = game.world;
  const p1 = game.players[0];
  p1.firstPerson = true;
  p1.selected = 6; // planks in the pod
  p1.entity.pos.set(30.6 + OX, S.surfaceY(30 + OX, 20 + OZ) + 1.02, 19.8 + OZ);
  p1.entity.yaw = 0.44; // face south-east toward the door + lit corner
  p1.entity.pitch = 0.22;
});
await page.waitForTimeout(1500); // animals wander into the yard, stars bob
await page.screenshot({ path: `${outDir}/hero.jpg`, type: 'jpeg', quality: 92 });

// SPLIT SHOT: back to third person; join player 2 on the west side
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const pad = game.addVirtualPad('playstation');
  (window as any).__pad2 = pad;
  pad.tap('jump');
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0');
await page.waitForTimeout(250);
await page.evaluate(() => (window as any).__pad2.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 2');
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const dims = (window as any).__lbw.dims;
  const OX = dims.sx / 2 - 32, OZ = dims.sz / 2 - 32;
  const S = game.world;
  const p1 = game.players[0], p2 = game.players[1];
  p1.firstPerson = false;
  p1.entity.pos.set(31.6 + OX, S.surfaceY(31 + OX, 17 + OZ) + 1.02, 17.0 + OZ);
  p1.entity.yaw = 0.3;
  p1.entity.pitch = 0.12;
  p1.camPos.set(30.3 + OX, S.surfaceY(31 + OX, 17 + OZ) + 3.0, 12.4 + OZ); // settle the camera early
  p2.entity.pos.set(26.0 + OX, S.surfaceY(26 + OX, 21 + OZ) + 1.02, 21.0 + OZ);
  p2.entity.yaw = 0.79; // look east at the house
  p2.entity.pitch = 0.12;
  p2.camPos.set(22.6 + OX, S.surfaceY(26 + OX, 21 + OZ) + 3.0, 17.6 + OZ);
});
await page.waitForTimeout(1600); // third-person cameras settle in
await page.screenshot({ path: `${outDir}/split.jpg`, type: 'jpeg', quality: 92 });

console.log('saved', fs.readdirSync(outDir).join(', '));
await browser.close();
