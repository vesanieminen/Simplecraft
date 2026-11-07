/**
 * Feature screenshot for the fish + fishing PR: a kid on the shore of a lake
 * full of fish, bobber diving mid-bite, the line running out to a school that
 * just noticed the newcomer. Run against a dev server (fresh world data
 * recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/pr-fish-shot.ts
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

await page.goto(process.env.LBW_SHOT_URL ?? 'http://localhost:3100/?seed=20261102&world=0');
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

// ---- find the biggest school, put the kid on its shore, and cast right in
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR } = (window as any).__lbw.ids;
  const school = game.fish.schools.slice().sort((a: any, b: any) => b.fish.length - a.fish.length)[0];
  const ax = school.anchor.x, az = school.anchor.z, ay = school.anchor.y;

  // dry ground within six blocks of the school: that's the fishing spot
  let shore: [number, number] | null = null;
  for (let r = 3; r <= 8 && !shore; r++) {
    for (let a = 0; a < 12 && !shore; a++) {
      const x = Math.round(ax + Math.cos((a / 12) * Math.PI * 2) * r);
      const z = Math.round(az + Math.sin((a / 12) * Math.PI * 2) * r);
      const gy = S.surfaceY(x, z);
      if (gy >= 0 && S.get(x, gy + 1, z) === AIR && S.get(x, gy + 2, z) === AIR) shore = [x, z];
    }
  }
  if (!shore) throw new Error('no shore found near the school');
  const p = game.players[0];
  p.firstPerson = false;
  p.cameraDist = 2.4;
  p.entity.pos.set(shore[0] + 0.5, S.surfaceY(shore[0], shore[1]) + 1, shore[1] + 0.5);
  p.entity.vel.set(0, 0, 0);
  p.entity.yaw = Math.atan2(ax - p.entity.pos.x, az - p.entity.pos.z); // face the school
  p.entity.pitch = -0.35;
  (window as any).__spot = { ax, az, ay };

  // clear the ghost/outline and park a low camera skimming the water at the
  // school, so the flock under the surface is the subject of the photo
  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    if (lp.ghost) lp.ghost.visible = false;
    if (lp.outline) lp.outline.visible = false;
    if ((window as any).__lakeCam) {
      const { ax: sx, az: sz } = (window as any).__spot;
      const bx = Math.round(sx), bz = Math.round(sz);
      const { WATER, WATER_FLOW } = (window as any).__lbw.ids;
      // skim the shot from just above the surface: under the water the fish
      // read as pale ghosts, over it the whole lake goes milky
      let wt = S.surfaceY(bx, bz) + 1; // top of the water column = surface
      while (S.get(bx, wt, bz) === WATER || S.get(bx, wt, bz) === WATER_FLOW) wt++;
      (window as any).__wt = wt;
      lp.camera.position.set(sx - 2.2, wt + 1.7, sz + 1.9);
      lp.camera.lookAt(sx + 0.5, wt - 0.55, sz - 0.5);
    }
  };

  // and hurry a bite along while we're at it
  game.fishing.biteWait = [0.4, 0.6];
});

// cast through the real path once the aim has settled on the water
await page.waitForFunction(() => {
  const t = (window as any).__lbw.game.players[0].target;
  return !!t && [window.__lbw.ids.WATER, window.__lbw.ids.WATER_FLOW].includes(t.block);
}, null, { timeout: 20000 });
await page.evaluate(() => (window as any).__pad.tap('interact'));
await page.waitForFunction('window.__lbw.game.fishing.lines.size === 1', null, { timeout: 15000 });
await page.waitForFunction(() => {
  const game = (window as any).__lbw.game;
  const l = game.fishing.lines.get(game.players[0].entity.id);
  return !!l && l.phase === 'bite';
}, null, { timeout: 20000 });

// the lake's schools re-home to the bobber — anchor first, so the AI holds
// the flock there — then swing the lake cam and pose for the shutter
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const l = game.fishing.lines.get(game.players[0].entity.id);
  (window as any).__bob = { x: l.pos.x, y: l.pos.y, z: l.pos.z };
  for (const s of game.fish.schools) {
    if (s.anchor.distanceTo(l.pos) > 14) continue; // only this lake's residents
    s.anchor.set(l.pos.x + (Math.random() - 0.5) * 2, l.pos.y, l.pos.z + (Math.random() - 0.5) * 2);
    if (s.target && typeof s.target.copy === 'function') s.target.copy(s.anchor);
    s.timer = 99; // don't pick a new wander target mid-photo
  }
  (window as any).__lakeCam = true;
});
await page.waitForTimeout(700);
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const b = (window as any).__bob;
  const wt = (window as any).__wt ?? b.y;
  for (const f of game.fish.fishes) {
    if (Math.hypot(f.pos.x - b.x, f.pos.z - b.z) > 6) continue;
    f.pos.x += (b.x - f.pos.x) * 0.5;
    f.pos.z += (b.z - f.pos.z) * 0.5;
    const i = game.fish.fishes.indexOf(f);
    const surf = wt + (i % 2 === 0 ? 0.32 : -0.05); // half breach the surface
    f.pos.y += (surf - f.pos.y) * 0.95;
    f.group.position.copy(f.pos);
  }
});
await page.waitForTimeout(150);
await page.screenshot({ path: `${outDir}/fishing.jpg`, type: 'jpeg', quality: 92 });

await browser.close();
console.log('fishing shot done');
