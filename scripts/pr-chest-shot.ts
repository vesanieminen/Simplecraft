/**
 * Feature screenshot for the rare-chests PR: a found treasure chest as the
 * world hides it (lid shut) next to one whose lid is up for good (opened
 * chests never close again). Not in the palette any more — these two were
 * dug out of a hillside, which is the only way to meet one.
 * Run against a dev server (fresh world data recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/pr-chest-shot.ts
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

// ---- the dig site: a cut into the hillside, one chest shut, one open ----
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR, CHEST, CHEST_OPEN, DIRT, STONE } = (window as any).__lbw.ids;
  const mid = Math.floor((window as any).__lbw.dims.sx / 2);
  const gy = S.surfaceY(mid, mid);

  // level the lawn so the little dig reads clearly
  for (let x = mid - 8; x <= mid + 8; x++) {
    for (let z = mid - 6; z <= mid + 6; z++) {
      for (let y = gy + 1; y <= gy + 10; y++) if (S.get(x, y, z) !== AIR) S.set(x, y, z, AIR);
      if (S.get(x, gy, z) === AIR) S.set(x, gy, z, STONE);
    }
  }
  // a 3-wide dig strip: dirt walls at the back, floors dug one cell down
  for (let x = mid - 3; x <= mid + 3; x++) {
    for (let z = mid - 2; z <= mid; z++) {
      S.set(x, gy, z, AIR);
      S.set(x, gy - 1, z, STONE);
    }
    S.set(x, gy, mid - 3, DIRT); // back wall
    S.set(x, gy + 1, mid - 3, DIRT);
  }
  // the two chests, side by side in the trench: shut and opened-for-good
  S.set(mid - 1, gy, mid - 1, CHEST);
  S.set(mid + 1, gy, mid - 1, CHEST_OPEN);

  // no place-ghost or aim outline in the shot
  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    if (lp.ghost) lp.ghost.visible = false;
    if (lp.outline) lp.outline.visible = false;
  };

  // park the camera low, looking down the trench
  const p = game.players[0];
  p.firstPerson = true;
  p.entity.pos.set(mid + 0.5, gy + 0.9, mid + 3.6);
  p.entity.yaw = Math.atan2((mid - 1) - (mid + 0.5), (mid - 1) - (mid + 3.6)); // face the shut chest
  p.entity.pitch = -0.12;
  p.entity.vel.set(0, 0, 0);
});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/chests-found.jpg`, type: 'jpeg', quality: 92 });

await browser.close();
console.log('chest shot done');
