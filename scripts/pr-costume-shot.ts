/**
 * Feature screenshots for the costumes PR: the join card where you cycle a
 * costume, and one kid wearing the Astronaut, the Wizard and the Dino.
 * Run against a dev server (fresh world data recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/pr-costume-shot.ts
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
  pad.tap('jump'); // world picker → start
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0', null, { timeout: 20000 });

// the join card: step to the Costume row and cycle it to Astronaut
await page.evaluate(() => {
  const pad = (window as any).__pad;
  pad.tap('down'); pad.tap('down'); pad.tap('down'); pad.tap('down');
  pad.tap('nextBlock'); // Kid -> Astronaut
});
await page.waitForTimeout(400);
const card = await page.$('.overlay-card');
if (card) await card.screenshot({ path: `${outDir}/costume-join.jpg`, type: 'jpeg', quality: 92 });

await page.evaluate(() => (window as any).__pad.tap('jump')); // join as the Astronaut
await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 20000 });
await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 20000 });

// dress up on the lawn, one model per shot
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR } = (window as any).__lbw.ids;
  const mid = Math.floor((window as any).__lbw.dims.sx / 2);
  const gy = S.surfaceY(mid, mid);
  for (let x = mid - 5; x <= mid + 5; x++) {
    for (let z = mid - 5; z <= mid + 5; z++) {
      for (let y = gy + 1; y <= gy + 10; y++) if (S.get(x, y, z) !== AIR) S.set(x, y, z, AIR);
    }
  }
  const p = game.players[0];
  p.firstPerson = false;
  p.cameraDist = 3.0;
  p.entity.pos.set(mid + 0.5, S.surfaceY(mid, mid) + 1.02, mid + 0.5);
  p.entity.yaw = -2.2; // three-quarter view for the camera trailing behind
  p.entity.pitch = -0.12;
  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    if (lp.ghost) lp.ghost.visible = false;
    if (lp.outline) lp.outline.visible = false;
  };
});

for (const [model, file] of [
  ['astronaut', 'costume-astronaut'],
  ['wizard', 'costume-wizard'],
  ['knight', 'costume-knight'],
] as const) {
  await page.evaluate((m: string) => (window as any).__lbw.game.players[0].entity.setModel(m), model);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${outDir}/${file}.jpg`, type: 'jpeg', quality: 92 });
}

await browser.close();
console.log('costume shots done');
