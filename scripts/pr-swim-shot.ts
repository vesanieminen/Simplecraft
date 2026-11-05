/**
 * Feature screenshot for the swimming PR: a kid gliding face-down across a
 * pond, elbows out mid-stroke, at the surface rather than sunk to the floor.
 * Run against a dev server (fresh world data recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/pr-swim-shot.ts
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

await page.goto(process.env.LBW_SHOT_URL ?? 'http://localhost:3100/?seed=8675309&world=0');
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });
await page.evaluate(() => {
  const pad = (window as any).__lbw.addVirtualPad('xbox');
  (window as any).__pad = pad;
  pad.tap('jump');
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0', null, { timeout: 20000 });
await page.evaluate(() => (window as any).__pad.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 20000 });
await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 20000 });

// ---- a flush little pond; the kid paddles across it at the surface ----
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR, WATER } = (window as any).__lbw.ids;
  const mid = Math.floor((window as any).__lbw.dims.sx / 2);
  const gy = S.surfaceY(mid, mid);

  for (let x = mid - 9; x <= mid + 9; x++) {
    for (let z = mid - 6; z <= mid + 6; z++) {
      for (let y = gy + 1; y <= gy + 12; y++) if (S.get(x, y, z) !== AIR) S.set(x, y, z, AIR);
      if (S.get(x, gy, z) === AIR) S.set(x, gy, z, 3);
    }
  }
  for (let x = mid - 4; x <= mid + 4; x++) {
    for (let z = mid - 2; z <= mid + 2; z++) S.set(x, gy, z, WATER); // flush pond
  }

  const p = game.players[0];
  p.firstPerson = false;
  p.cameraDist = 2.4; // park the camera right over the waterline
  p.entity.pos.set(mid - 1.5, gy + 0.2, mid + 0.3);
  p.entity.yaw = Math.PI / 2; // paddle toward +x; camera trails behind
  p.entity.pitch = -0.32;
  p.entity.vel.set(1.4, 0, 0); // glide while the camera settles

  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    if (lp.ghost) lp.ghost.visible = false;
    if (lp.outline) lp.outline.visible = false;
  };
});
await page.waitForFunction('window.__lbw.game.players[0].entity.inWaterNow === true', null, { timeout: 15000 });
await page.waitForFunction('window.__lbw.game.players[0].entity.swimmingNow === true', null, { timeout: 15000 });
await page.waitForTimeout(1400); // stroke, then catch the kick-up so the head breaks the surface
await page.evaluate(() => {
  const e = (window as any).__lbw.game.players[0].entity;
  e.vel.y = 2.2; // mid-kick, head about to clear the waterline
  e.walkPhase += 1.1; // mid-stroke arms
});
await page.waitForTimeout(420);
await page.screenshot({ path: `${outDir}/swimming.jpg`, type: 'jpeg', quality: 92 });

await browser.close();
console.log('swim shot done');
