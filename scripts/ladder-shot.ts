/**
 * Ladder study: a stone wall with a ladder nailed to it, seen three ways —
 * the bare ladder (avatar hidden, to judge the art and the flush panel), a
 * kid clinging mid-ladder (the hand-over-hand pose), and the same kid from
 * across the wall so the panel against the wall is in profile. Run against a
 * dev server (fresh world data recommended):
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/ladder-shot.ts [out-prefix]
 */
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '/tmp/opencode/ladder';

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

// a stone wall with a ladder on its near face, the kid on a middle rung;
// the camera is parked — these are still lifes
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const ids = (window as any).__lbw.ids;
  const p = game.players[0];
  const cx = Math.round(p.entity.pos.x), cz = Math.round(p.entity.pos.z);
  const G = S.surfaceY(cx, cz);
  for (let x = cx - 5; x <= cx + 5; x++) {
    for (let z = cz - 5; z <= cz + 5; z++) {
      for (let y = G - 2; y <= G + 7; y++) S.set(x, y, z, ids.AIR);
      S.set(x, G, z, ids.GRASS);
    }
  }
  for (let k = 1; k <= 4; k++) for (let x = cx - 1; x <= cx + 3; x++) {
    S.set(x, G + k, cz + 1, ids.STONE); // the wall
  }
  for (let k = 1; k <= 4; k++) {
    S.set(cx + 1, G + k, cz, ids.LADDER);
    S.setLadderFacing(cx + 1, G + k, cz, 3); // panel against the +z wall
  }
  const e = p.entity;
  e.pos.set(cx + 1.5, G + 2, cz + 0.5); // clinging on the second rung
  e.vel.set(0, 0, 0);
  e.yaw = 0; // facing the wall (the climb side)

  const aim = { eye: [cx - 1.4, G + 3.6, cz - 3.2], look: [cx + 1, G + 2.9, cz + 0.8], hide: true };
  (window as any).__cam = aim;
  p.firstPerson = false; // first person hides the kid's own avatar; the parked camera frames it anyway
  const orig = p.update.bind(p);
  p.update = (...args: unknown[]): void => {
    orig(...args);
    p.cameraDist = 3.5; // showOwnBody wants third person AND this >= 2.4 (localPlayer.ts); applyAvatarLayers reads it after update
    if (p.ghost) p.ghost.visible = false;
    if (p.outline) p.outline.visible = false;
    if (p.entity.avatar) p.entity.avatar.group.visible = !(window as any).__cam.hide;
    const a = (window as any).__cam;
    p.camera.position.set(a.eye[0], a.eye[1], a.eye[2]);
    p.camera.lookAt(a.look[0], a.look[1], a.look[2]);
  };
  void orig;
});

const shoot = async (name: string): Promise<void> => {
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${out}-${name}.jpg`, type: 'jpeg', quality: 92 });
};
await shoot('art'); // bare ladder: the panel, the flush wall, the rung rhythm

// the kid on it: a frozen hand-over-hand frame (walkPhase ≈ π/2 → one arm
// high, opposite knee up), still clinging so the pose holds
await page.evaluate(() => {
  (window as any).__cam.hide = false;
  const e = (window as any).__lbw.game.players[0].entity;
  e.walkPhase = Math.PI / 2;
});
await shoot('climb');

// and from the far side of the wall, so the thin panel in profile reads
await page.evaluate(() => {
  const a = (window as any).__cam;
  a.eye = [a.look[0] + 3.2, a.look[1] + 1.8, a.look[2] + 4.4];
});
await shoot('profile');

console.log('ladder shots done');
await browser.close();
