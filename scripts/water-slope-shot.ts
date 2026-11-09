/**
 * Slope study for the water: a spring poured at the top of a staircase hill,
 * shot from the side so the drop reads as a drop. Run against a dev server:
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/water-slope-shot.ts [out-prefix]
 */
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '/tmp/opencode/waterslope';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => { (window as any).__name = (fn: unknown) => fn; });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));

await page.goto('http://localhost:3100/?seed=4242&world=0');
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });
await page.evaluate(() => {
  const pad = (window as any).__lbw.addVirtualPad('xbox');
  (window as any).__pad = pad;
  pad.tap('jump');
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0', null, { timeout: 20000 });
await page.evaluate(() => (window as any).__pad.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 20000 });

// a clean staircase hill with a spring at the top, carved around where the kid
// actually landed, plus a flat pool basin at the foot
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR, WATER, STONE, GRASS } = (window as any).__lbw.ids;
  const p = game.players[0];
  const cx = Math.round(p.entity.pos.x), cz = Math.round(p.entity.pos.z);
  const base = Math.floor(p.entity.pos.y);
  for (let x = cx - 14; x <= cx + 22; x++) {
    for (let z = cz - 8; z <= cz + 8; z++) {
      const top = x <= cx ? base : Math.max(base - 5, base - Math.floor((x - cx) / 3));
      for (let y = 1; y < base + 12; y++) S.set(x, y, z, y <= top ? (y === top ? GRASS : STONE) : AIR);
    }
  }
  // the basin at the foot, walled so the flood has somewhere to collect
  for (let x = cx + 16; x <= cx + 22; x++) for (let z = cz - 8; z <= cz + 8; z++) {
    for (let y = base - 8; y <= base - 3; y++) S.set(x, y, z, AIR);
    for (let z2 = cz - 8; z2 <= cz + 8; z2++) S.set(x, base - 9, z2, STONE);
  }
  // and a spring up top
  S.set(cx - 2, base + 1, cz, WATER);
  p.entity.pos.set(cx - 6.5, base + 1.05, cz);
  p.firstPerson = false;
  p.cameraDist = 6;
  p.entity.yaw = Math.PI / 2;

  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    if (lp.ghost) lp.ghost.visible = false;
    if (lp.outline) lp.outline.visible = false;
    const e = lp.entity;
    lp.camera.position.set(e.pos.x - 2, e.pos.y + 6.5, e.pos.z + 16);
    lp.camera.lookAt(e.pos.x + 10, e.pos.y - 1.5, e.pos.z);
  };
  void orig;
});

// let the sim run a few game seconds, then report where the water actually is
await page.waitForTimeout(4000);
console.log(await page.evaluate(() => {
  const w = (window as any).__lbw.game.world;
  const { WATER, WATER_FLOW } = (window as any).__lbw.ids;
  const { sy, sz } = (window as any).__lbw.dims;
  const p = (window as any).__lbw.game.players[0].entity.pos;
  const cx = Math.round(p.x), cz = Math.round(p.z);
  const rows: string[] = [];
  for (let y = Math.floor(p.y) + 4; y >= Math.floor(p.y) - 9; y--) {
    let s = '';
    for (let x = cx - 12; x <= cx + 22; x++) {
      const id = w.get(x, y, cz);
      s += id === WATER ? 'S' : id === WATER_FLOW ? String(w.waterLevel.get((x * sz + cz) * sy + y) ?? 9 % 10) : '.';
    }
    if (/[S\d]/.test(s)) rows.push(`y${String(y).padStart(2)} ${s}`);
  }
  return rows.join('\n');
}));

await page.screenshot({ path: `${out}.jpg`, type: 'jpeg', quality: 92 });
await browser.close();
console.log('slope shot done');
