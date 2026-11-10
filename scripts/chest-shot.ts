/**
 * Chest study: the shut chest, the opened one from the side, and the same
 * chest from above so the opening (and the treasure at the bottom of it) is in
 * frame. Run against a dev server (fresh world data recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/chest-shot.ts [out-prefix]
 */
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '/tmp/opencode/chest';

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

// a plank counter in clear air, three chests on it: shut, opened, opened again
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR, STONE, PLANKS, CHEST, CHEST_OPEN } = (window as any).__lbw.ids;
  const p = game.players[0];
  const cx = Math.round(p.entity.pos.x), cz = Math.round(p.entity.pos.z);
  const G = S.surfaceY(cx, cz);
  for (let x = cx - 4; x <= cx + 6; x++) {
    for (let z = cz - 4; z <= cz + 4; z++) {
      for (let y = G - 3; y <= G + 6; y++) S.set(x, y, z, AIR);
      S.set(x, G, z, STONE);
    }
  }
  for (let x = cx - 1; x <= cx + 3; x++) for (let z = cz - 1; z <= cz + 1; z++) S.set(x, G + 1, z, PLANKS);
  S.set(cx, G + 2, cz, CHEST);
  S.set(cx + 2, G + 2, cz, CHEST_OPEN);
  S.set(cx + 2, G + 2, cz + 2, CHEST_OPEN);

  // the camera is parked, not followed: these are still lifes of a chest
  const aim = { eye: [cx - 2.1, G + 4.1, cz - 2.6], look: [cx + 1.2, G + 2.35, cz + 0.6] };
  (window as any).__cam = aim;
  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    if (lp.ghost) lp.ghost.visible = false;
    if (lp.outline) lp.outline.visible = false;
    if (lp.entity.avatar) lp.entity.avatar.group.visible = false;
    const a = (window as any).__cam;
    lp.camera.position.set(a.eye[0], a.eye[1], a.eye[2]);
    lp.camera.lookAt(a.look[0], a.look[1], a.look[2]);
  };
  void orig;
});

const shoot = async (name: string): Promise<void> => {
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}-${name}.jpg`, type: 'jpeg', quality: 92 });
};
await shoot('side');

// the same counter from above, straight down the opening
await page.evaluate(() => {
  const a = (window as any).__cam;
  a.eye = [a.look[0] - 1.6, a.eye[1] + 5.5, a.look[2] - 1.6];
});
await shoot('above');

// and from the lid side, so the standing lid is the nearest thing in frame
await page.evaluate(() => {
  const a = (window as any).__cam;
  a.eye = [a.look[0] + 3.4, a.eye[1] + 0.4, a.look[2] + 4.2];
});
await shoot('front');

console.log('chest shots done');
await browser.close();
