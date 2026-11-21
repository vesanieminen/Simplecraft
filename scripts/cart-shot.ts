/**
 * Cart study: a line of track with a crossing, a red rail and a climb; a cart
 * standing in the middle of it; a kid riding one; and one that ran off the end
 * and is lying in the grass. Run against a dev server (fresh world data
 * recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/cart-shot.ts [out-prefix]
 */
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '/tmp/opencode/carts';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
await page.addInitScript(() => {
  (window as any).__name = (fn: unknown) => fn;
});
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

// the railway: nine sleepers, a siding through the third one, a red rail, and a
// climb onto the shoulder — with a cart standing in the middle of the line
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR, STONE } = (window as any).__lbw.ids;
  const p = game.players[0];
  const cx = Math.round(p.entity.pos.x), cz = Math.round(p.entity.pos.z);
  const G = S.surfaceY(cx, cz);
  for (let x = cx - 4; x <= cx + 12; x++) {
    for (let z = cz - 4; z <= cz + 4; z++) {
      for (let y = G - 2; y <= G + 6; y++) S.set(x, y, z, AIR);
      S.set(x, G, z, STONE);
    }
  }
  game.minecarts.clear(); // one cart in the picture: whatever an earlier shoot left behind
  const rows: [number, number, number, number][] = [];
  for (let i = 0; i <= 4; i++) rows.push([cx + i, G + 1, cz, i === 3 ? 1 : 0]);
  for (let i = 5; i <= 9; i++) {
    S.set(cx + i, G + 1, cz, STONE);            // the shoulder the rail stands on
    rows.push([cx + i, G + 2, cz, 0]);          // and the climb up onto it
  }
  rows.push([cx + 2, G + 1, cz + 1, 0], [cx + 2, G + 1, cz - 1, 0]); // the siding
  (window as any).__lbw.layRails(rows);
  (window as any).__lbw.spawnCart(cx + 1, G + 1, cz, 0);
  (window as any).__site = { cx, cz, G };

  // the camera is parked, not followed: these are still lifes of a railway
  const aim = { eye: [cx - 2.4, G + 4.6, cz - 3.4], look: [cx + 3.4, G + 1.6, cz] };
  (window as any).__cam = aim;
  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    if (lp.ghost) lp.ghost.visible = false;
    if (lp.outline) lp.outline.visible = false;
    const a = (window as any).__cam;
    const follow = (window as any).__followCart as { i: number; dx: number; dy: number; dz: number } | undefined;
    if (follow) {
      // sit in on a cart's own still life: the camera keeps its distance from
      // the cart, wherever the cart happens to have stopped
      const c = game.minecarts.carts[follow.i] ?? game.minecarts.carts[0];
      if (c) {
        a.look = [c.x, c.y + 0.45, c.z];
        a.eye = [c.x + follow.dx, c.y + follow.dy, c.z + follow.dz];
      }
    }
    lp.camera.position.set(a.eye[0], a.eye[1], a.eye[2]);
    lp.camera.lookAt(a.look[0], a.look[1], a.look[2]);
  };
  void orig;
});

const shoot = async (name: string): Promise<void> => {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}-${name}.jpg`, type: 'jpeg', quality: 92 });
};
await shoot('line');

// a kid climbs in and leans the stick: the cart runs, then settles again with
// somebody sitting in it, which is the picture worth looking at
await page.evaluate(() => {
  (window as any).__lbw.rideCart(0, 0);
  (window as any).__pad.setMove(0, -1); // lean into it
});
await page.waitForTimeout(1200);
await page.evaluate(() => {
  (window as any).__pad.setMove(0, 0);
  const s = (window as any).__site;
  void s;
  (window as any).__followCart = { i: 0, dx: -2.6, dy: 1.9, dz: -2.6 };
});
await page.waitForFunction(() => {
  const c = (window as any).__lbw.carts()[0];
  return !!c && c.speed === 0;
}, null, { timeout: 20000 });
await shoot('riding');

// and one that ran off the end of the track: a cart in the grass, empty
await page.evaluate(() => {
  const s = (window as any).__site;
  const game = (window as any).__lbw.game;
  for (const c of [...game.minecarts.carts]) game.minecarts.despawn(c);
  game.world.set(s.cx + 11, s.G + 1, s.cz, (window as any).__lbw.ids.RAIL);
  (window as any).__lbw.spawnCart(s.cx + 12, s.G + 1, s.cz, 0);
  const a = (window as any).__cam;
  a.eye = [s.cx + 8.4, s.G + 3.2, s.cz - 3.6];
  a.look = [s.cx + 11.6, s.G + 1.2, s.cz];
});
await shoot('derailed');

console.log('cart shots done');
await browser.close();
