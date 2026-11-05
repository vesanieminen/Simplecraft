/**
 * Feature screenshots for the water-flow PR: a channel that shallows as it
 * spreads from its source, and a waterfall that keeps its depth down a pit.
 * Run against a dev server (fresh world data recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/pr-water-shot.ts
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

// a seed nobody has built on, so the shot shows clean generated terrain
await page.goto(process.env.LBW_SHOT_URL ?? 'http://localhost:3100/?seed=8675309&world=0');
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });

// one joined player (we only use its camera)
await page.evaluate(() => {
  const pad = (window as any).__lbw.addVirtualPad('xbox');
  (window as any).__pad = pad;
  pad.tap('jump'); // world picker → start
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0', null, { timeout: 20000 });
await page.evaluate(() => (window as any).__pad.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 20000 });
await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 20000 });

// ---- the water park: a shallow-spreading channel and a full-depth waterfall ----
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR, WATER } = (window as any).__lbw.ids;
  const mid = Math.floor((window as any).__lbw.dims.sx / 2);

  // level a wide meadow: solid floor row at gy, air above, so the water reads clean
  const gy = S.surfaceY(mid, mid);
  for (let x = mid - 10; x <= mid + 14; x++) {
    for (let z = mid - 8; z <= mid + 8; z++) {
      for (let y = gy + 1; y <= gy + 14; y++) if (S.get(x, y, z) !== AIR) S.set(x, y, z, AIR);
      if (S.get(x, gy, z) === AIR) S.set(x, gy, z, 3); // stone floor everywhere
    }
  }

  // two features on one lawn: a flush pond whose water reaches exactly six
  // cells from its sources, and a stone cliff with a source on its rim — the
  // water spills over the edge and runs down the cliff face into a splash
  // pool. Everything renders as full water blocks (the flow depths are sim
  // state, not draw height), so the whole thing reads as one body of water.
  for (let x = mid - 8; x <= mid - 2; x++) {
    for (let z = mid - 3; z <= mid + 2; z++) S.set(x, gy, z, AIR); // pond (floor: ground)
  }
  S.set(mid - 8, gy, mid - 1, WATER);
  S.set(mid - 8, gy, mid, WATER);

  for (let x = mid + 3; x <= mid + 6; x++) {
    for (let z = mid - 3; z <= mid + 2; z++) {
      for (let y = gy + 1; y <= gy + 7; y++) S.set(x, y, z, 3); // 7-tall cliff tower
    }
  }
  S.set(mid + 6, gy + 8, mid, WATER); // source on the rim's east edge

  // third-person camera will be parked by the shots below
  const p = game.players[0];
  p.firstPerson = false;
});

// let the flow settle: the far channel cell must be wet before we shoot
await page.waitForFunction((m: number) => {
  const S = (window as any).__lbw.game.world;
  const flow = (window as any).__lbw.ids.WATER_FLOW;
  for (let y = 40; y >= 0; y--) if (S.get(m - 2, y, m) === flow) return true;
  return false;
}, Math.floor(128 / 2), { timeout: 30000 });
await page.waitForTimeout(2500); // let the shallow edge steps finish spreading

// no place-ghost or aim-outline in the shots: force them hidden every frame
await page.evaluate(() => {
  const lp = (window as any).__lbw.game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    lp.ghost.visible = false;
    lp.outline.visible = false;
  };
});

// ---- shot 1: the channel, low and along the water line ----
await page.evaluate((m: number) => {
  const game = (window as any).__lbw.game;
  const gy = game.world.surfaceY(m, m);
  const p = game.players[0];
  p.firstPerson = true;
  p.entity.pos.set(m - 5, gy + 1.02, m + 7);
  p.entity.yaw = Math.PI; // look north, down the length of the pond
  p.entity.pitch = -0.28;
  p.entity.vel.set(0, 0, 0);
}, Math.floor(128 / 2));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/water-channel.jpg`, type: 'jpeg', quality: 92 });

// ---- shot 2: the waterfall — tall stone tower, full-height cascade ----
// far south-east so the bare stone faces and the water shelf read separately
await page.evaluate((m: number) => {
  const game = (window as any).__lbw.game;
  const gy = game.world.surfaceY(m, m);
  const p = game.players[0];
  p.entity.pos.set(m + 10, gy + 10, m + 16);
  p.entity.yaw = Math.atan2((m + 5) - (m + 10), m - (m + 16)); // face the tower
  p.entity.pitch = -0.4;
  p.entity.vel.set(0, 0, 0);
}, Math.floor(128 / 2));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/water-fall.jpg`, type: 'jpeg', quality: 92 });

await browser.close();
console.log('water shots done');
