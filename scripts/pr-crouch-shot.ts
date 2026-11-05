/**
 * Feature screenshot for the crouch PR: a kid sneaking through a one-block
 * tunnel (CROUCH_H fits; standing never would) while a friend stands outside.
 * Run against a dev server (fresh world data recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/pr-crouch-shot.ts
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

// two joined kids: player 1 with the main pad, player 2 with a second pad
await page.evaluate(() => {
  const pad = (window as any).__lbw.addVirtualPad('xbox');
  (window as any).__pad = pad;
  pad.tap('jump'); // world picker → start
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0', null, { timeout: 20000 });
await page.evaluate(() => (window as any).__pad.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 20000 });
await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 20000 });

// ---- the tunnel: a 3-wide roof one block above the lawn, only a croucher fits ----
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR } = (window as any).__lbw.ids;
  const mid = Math.floor((window as any).__lbw.dims.sx / 2);
  const gy = S.surfaceY(mid, mid);

  for (let x = mid - 6; x <= mid + 6; x++) {
    for (let z = mid - 7; z <= mid + 4; z++) {
      for (let y = gy + 1; y <= gy + 12; y++) if (S.get(x, y, z) !== AIR) S.set(x, y, z, AIR);
      if (S.get(x, gy, z) === AIR) S.set(x, gy, z, 3);
    }
  }
  for (let x = mid - 2; x <= mid + 2; x++) {
    for (let z = mid - 3; z <= mid + 1; z++) S.set(x, gy + 2, z, 3); // stone roof
  }
  // a full-height wall beside the mouth: shows the gap is only knee+head tall
  for (let z = mid - 3; z <= mid + 1; z++) {
    S.set(mid - 3, gy + 1, z, 3);
    S.set(mid - 3, gy + 2, z, 3);
  }

  // kid 1 crouches mid-tunnel facing out; the camera parks outside the mouth
  const p1 = game.players[0];
  p1.firstPerson = false;
  p1.entity.pos.set(mid + 0.5, gy + 1.02, mid - 1.2);
  p1.entity.yaw = 0; // face +z, toward the camera
  p1.entity.pitch = -0.05;
  p1.entity.vel.set(0, 0, 0);
  p1.entity.crouching = true;

  // no place-ghosts or aim outlines in the shot
  for (const lp of game.players) {
    const orig = lp.update.bind(lp);
    lp.update = (...args: unknown[]): void => {
      orig(...args);
      if (lp.ghost) lp.ghost.visible = false;
      if (lp.outline) lp.outline.visible = false;
    };
  }
});
await page.waitForTimeout(2500); // let the camera settle behind the crouched kid
await page.screenshot({ path: `${outDir}/crouch.jpg`, type: 'jpeg', quality: 92 });

await browser.close();
console.log('crouch shot done');
