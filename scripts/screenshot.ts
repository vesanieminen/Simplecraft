/**
 * Manual visual QA helper: boots the game, joins two players with
 * virtual controllers, builds a few blocks, saves screenshots.
 * Run: npx tsx scripts/screenshot.ts [outDir]
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const outDir = process.argv[2] ?? '/tmp/opencode/lbw-shots';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
await page.goto('http://localhost:3100/');
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/0-welcome.png` });

// join player 1
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const pad = game.addVirtualPad('xbox');
  window.__pad1 = pad;
  pad.tap('jump');
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0');
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/1-join-card.png` });
await page.evaluate(() => window.__pad1.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 1');
await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/2-single.png` });

// build some blocks in front of player 1
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const p = game.players[0];
  // little house: 5x5 floor + corners
  const x0 = Math.floor(p.entity.pos.x + Math.sin(p.entity.yaw) * 7);
  const z0 = Math.floor(p.entity.pos.z + Math.cos(p.entity.yaw) * 7);
  const y = game.world.surfaceY(x0, z0) + 1;
  for (let x = x0; x < x0 + 5; x++) {
    for (let z = z0; z < z0 + 5; z++) {
      game.world.set(x, y, z, 6); // planks
    }
  }
  for (let h = 1; h <= 3; h++) {
    for (let i = 0; i < 5; i++) {
      game.world.set(x0 + i, y + h, z0, i === 2 ? 8 : 7);
      game.world.set(x0 + i, y + h, z0 + 4, 7);
      game.world.set(x0, y + h, z0 + i, 7);
      game.world.set(x0 + 4, y + h, z0 + i, 7);
    }
  }
  game.world.set(x0 + 2, y + 4, z0 + 2, 14); // glow inside
  // pet an animal: walk player near
  const a = game.animals.animals[0];
  if (a) { a.pos.x = p.entity.pos.x + 1.5; a.pos.z = p.entity.pos.z + 1.5; }
});
await page.waitForTimeout(900);

// join player 2
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const pad = game.addVirtualPad('playstation');
  window.__pad2 = pad;
  pad.tap('jump');
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0');
await page.waitForTimeout(300);
await page.evaluate(() => window.__pad2.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 2');

// player 2 opens its palette
await page.evaluate(() => window.__pad2.tap('palette'));
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/3-split-palette.png` });
await page.evaluate(() => window.__pad2.tap('back'));

// both look at the house
await page.waitForTimeout(1200);
await page.screenshot({ path: `${outDir}/4-split.png` });

// vertical layout
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  game.layout = 'vertical';
  game.resize();
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/5-split-vertical.png` });

console.log('screenshots saved to', outDir);
await browser.close();
