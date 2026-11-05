/**
 * Feature screenshot for the sand-fall-animation PR: a sand tower caught
 * mid-tumble — the glide cubes stretch the pile so the fall reads as motion
 * instead of a row of block teleports.
 * Run against a dev server (fresh world data recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/pr-sand-shot.ts
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

// a seed nobody has built on, so the shot shows clean generated terrain
await page.goto(process.env.LBW_SHOT_URL ?? 'http://localhost:3100/?seed=8675309&world=0');
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });

await page.evaluate(() => {
  const pad = (window as any).__lbw.addVirtualPad('xbox');
  (window as any).__pad = pad;
  pad.tap('jump'); // world picker → start
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0', null, { timeout: 20000 });
await page.evaluate(() => (window as any).__pad.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 20000 });
await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 20000 });

// ---- a sand tower over a shallow pit; the pit's floor gets knocked out ----
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR, SAND, STONE } = (window as any).__lbw.ids;
  const mid = Math.floor((window as any).__lbw.dims.sx / 2);
  const gy = S.surfaceY(mid, mid);

  // level the lawn
  for (let x = mid - 8; x <= mid + 8; x++) {
    for (let z = mid - 6; z <= mid + 6; z++) {
      for (let y = gy + 1; y <= gy + 12; y++) if (S.get(x, y, z) !== AIR) S.set(x, y, z, AIR);
      if (S.get(x, gy, z) === AIR) S.set(x, gy, z, STONE);
    }
  }
  // a 3x3 sand tower, six tall, standing on the lawn at mid+2
  for (let x = mid + 1; x <= mid + 3; x++) {
    for (let z = mid + 1; z <= mid + 3; z++) {
      for (let y = gy + 1; y <= gy + 6; y++) S.set(x, y, z, SAND);
    }
  }

  // no place-ghost or aim outline in the shot
  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    if (lp.ghost) lp.ghost.visible = false;
    if (lp.outline) lp.outline.visible = false;
  };

  // camera parked well back on the lawn, facing the tower, high enough to
  // keep the whole fall (tower top to pit floor) inside the frame
  const p = game.players[0];
  p.firstPerson = true;
  p.entity.pos.set(mid - 7.5, gy + 1.02, mid - 6);
  p.entity.yaw = Math.atan2((mid + 2) - (mid - 7.5), (mid + 2) - (mid - 6));
  p.entity.pitch = 0.12;
  p.entity.vel.set(0, 0, 0);
});
await page.waitForTimeout(800); // camera settles

// knock three layers of lawn out under the tower: the whole pile falls three
// cells, which gives the camera a comfortable mid-slide window to catch
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR } = (window as any).__lbw.ids;
  const mid = Math.floor((window as any).__lbw.dims.sx / 2);
  const gy = S.surfaceY(mid, mid);
  for (let x = mid; x <= mid + 4; x++) {
    for (let z = mid; z <= mid + 4; z++) {
      for (let y = gy; y >= gy - 2; y--) S.set(x, y, z, AIR);
    }
  }
});

// catch the pile mid-slide: the glide cubes are alive while sand moves; a
// beat later and every layer is a step into its fall — the cascade at its
// most legible
await page.waitForFunction('window.__lbw.game.sandFalls.count > 0', null, { timeout: 5000 });
await page.waitForTimeout(350);
await page.screenshot({ path: `${outDir}/sand-falling.jpg`, type: 'jpeg', quality: 92 });
console.log('mid-fall glide cubes:', await page.evaluate(() => (window as any).__lbw.game.sandFalls.count));

await browser.close();
console.log('sand shot done');
