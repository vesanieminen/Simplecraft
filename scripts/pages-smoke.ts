/**
 * GH Pages smoke test: serves-like-Pages static hosting (sub-path, no API)
 * and verifies join, build, browser-save persistence across reload.
 * Run: python3 -m http.server on a dir containing dist as /Simplecraft/, then
 *   npx tsx scripts/pages-smoke.ts [url]
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:3200/Simplecraft/';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => {
  (window as any).__name = (fn: unknown) => fn;
});
await page.goto(url);
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });

// join a player with a virtual pad
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const pad = game.addVirtualPad('xbox');
  (window as any).__pad = pad;
  pad.tap('jump');
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0');
await page.evaluate(() => (window as any).__pad.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 1');

// build a block, wait for the debounced save to hit localStorage
await page.evaluate(() => (window as any).__lbw.game.world.set(33, 30, 33, 21));
await page.waitForFunction(() => {
  const raw = localStorage.getItem('lbw-world');
  return !!raw && JSON.parse(raw).mods[String((33 * 64 + 33) * 64 + 30)] === 21;
}, null, { timeout: 10000 });
const mode = await page.evaluate(() => (window as any).__lbw.game.serverBacked);
console.log('serverBacked (expect false on Pages):', mode);

// reload: the block must come back from the browser save
await page.reload();
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });
const found = await page.evaluate(() => (window as any).__lbw.game.world.get(33, 30, 33));
console.log('block after reload (expect 21):', found);

console.log('page errors:', errors.length ? errors : 'none');
const ok = found === 21 && mode === false && errors.length === 0;
console.log(ok ? 'PAGES SMOKE: PASS' : 'PAGES SMOKE: FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
