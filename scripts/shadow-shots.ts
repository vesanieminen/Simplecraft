/**
 * Shadow & shader study: a low parked sun throwing a wall, a cliff and a
 * five-block tower shadow across the meadow, a pond that should glint, and a
 * midnight pass that must stay blue. Run against the local shader server
 * (pw.local.ts uses :3130; production mode avoids the shared vite HMR port):
 *   npm run build
 *   NODE_ENV=production PORT=3130 LBW_DATA_DIR=/tmp/opencode/lbw-test-shaders npx tsx server/index.ts &
 *   npx tsx scripts/shadow-shots.ts [out-prefix]
 */
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '/tmp/opencode/shadowshots';
const port = process.env.SHOT_PORT ?? '3130';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
await page.addInitScript(() => { (window as any).__name = (fn: unknown) => fn; });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
page.on('console', (m) => console.log('PAGE:', m.text()));

await page.goto(`http://localhost:${port}/`);
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });
await page.evaluate(() => {
  const pad = (window as any).__lbw.addVirtualPad('xbox');
  (window as any).__pad = pad;
  pad.tap('jump');
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0', null, { timeout: 20000 });
await page.evaluate(() => (window as any).__pad.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 20000 });

// Stage the yard: a tidy meadow, a stone wall, a tall tower, a raised grass
// cliff, and a below-grade spring pond for the glint.
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const ids = (window as any).__lbw.ids;
  const p = game.players[0];
  const cx = Math.round(p.entity.pos.x), cz = Math.round(p.entity.pos.z);
  const G = S.surfaceY(cx, cz);
  (window as any).__stage = { cx, cz, G };

  // tidy a meadow pad: nothing above the grass, grass floor at G
  for (let x = cx - 11; x <= cx + 11; x++) {
    for (let z = cz - 11; z <= cz + 11; z++) {
      for (let y = G + 1; y <= G + 9; y++) S.set(x, y, z, ids.AIR);
      S.set(x, G, z, ids.GRASS);
    }
  }
  // the wall: 7 long, 3 high — its shadow is the hero line across the grass
  for (let z = cz - 3; z <= cz + 3; z++) for (let y = G + 1; y <= G + 3; y++) S.set(cx + 3, y, z, ids.STONE);
  // the tower: throws the longest single shadow
  for (let y = G + 1; y <= G + 5; y++) S.set(cx + 5, y, cz + 2, ids.STONE);
  // the cliff: 6×4 raised two blocks — a cliff must shade the meadow
  for (let x = cx - 5; x <= cx; x++) {
    for (let z = cz - 7; z <= cz - 4; z++) {
      for (let y = G + 1; y <= G + 2; y++) S.set(x, y, z, ids.GRASS);
    }
  }
  // the pond: dug one below grade and filled with an eternal spring (sitting
  // under the meadow with solid banks, so the flow sim has nothing to do)
  for (let x = cx - 7; x <= cx - 3; x++) {
    for (let z = cz + 2; z <= cz + 5; z++) {
      S.set(x, G, z, ids.AIR);
      S.set(x, G - 1, z, ids.WATER);
    }
  }
  // the kid stands by the tower so their shadow joins the crowd
  p.entity.pos.set(cx + 1.5, G + 1.02, cz + 0.5);
  p.entity.vel.set(0, 0, 0);
});

// Park the day clock (the low parked sun = long shadows) and look straight
// down the shadow: the camera faces the sun, so shadows run towards us.
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  game.setDayMode('day');
  const st = (window as any).__stage;
  const { cx, cz, G } = st;
  // camera sits down-sun of the staging and looks up-sun
  // parked 'day' puts the lit ball on the (−x, +z) horizon: stand on the
  // opposite corner and look into the sun, so the wall/tower shadows run
  // straight towards the camera
  const aim = { eye: [cx + 11.5, G + 5.6, cz + 4.0], look: [cx - 2.0, G + 0.6, cz - 1.5] };
  (window as any).__cam = aim;
  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    if (lp.ghost) lp.ghost.visible = false;
    const a = (window as any).__cam;
    lp.camera.position.set(a.eye[0], a.eye[1], a.eye[2]);
    lp.camera.lookAt(a.look[0], a.look[1], a.look[2]);
  };
  void orig;
});

const shoot = async (name: string, ms = 2600): Promise<void> => {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `${out}-${name}.jpg`, type: 'jpeg', quality: 92 });
  console.log('shot', name);
};

await shoot('golden');

// same frame, shadows switched off, for the before/after comparison
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  game.shadowsEnabled = false;
  (game as any).applyShadowSettings();
});
await shoot('shadowsoff', 3200);

// the pond close-up: low angle, waves + fresnel + glint
await page.evaluate(() => {
  const st = (window as any).__stage;
  const { cx, cz, G } = st;
  // low across the pond, looking at the sun: glint band + wave normals
  (window as any).__cam.eye = [cx - 0.5, G + 2.6, cz + 0.0];
  (window as any).__cam.look = [cx - 5.5, G - 0.2, cz + 3.5];
});
await shoot('pond');

// midnight: moon shadow, blue not black
await page.evaluate(() => {
  const st = (window as any).__stage;
  const { cx, cz, G } = st;
  (window as any).__lbw.game.setDayMode('night');
  (window as any).__cam.eye = [cx - 8.5, G + 5.2, cz + 8.5];
  (window as any).__cam.look = [cx + 2.5, G + 1.4, cz - 2.5];
});
await shoot('night', 3600);

// morning: un-park the clock and fast-forward it by driving sky.update with
// big dts (phase rides dt/DAY_SECONDS) to a bright ~0.15 — high enough sun
// for a crisp, hard-edged shadow, low enough for a long one
await page.evaluate(() => {
  const g = (window as any).__lbw.game;
  const st = (window as any).__stage;
  const { cx, cz, G } = st;
  g.setDayMode('auto');
  const cam = g.players[0].camera;
  // boot phase 0.35 + 22·(28/720) = 1.205 → 0.205: full-morning sunlight
  for (let k = 0; k < 22; k++) (g as any).skyEnv.update(28, cam);
  (window as any).__cam.eye = [cx - 11.5, G + 5.2, cz - 6.0];
  (window as any).__cam.look = [cx + 3.0, G + 0.8, cz + 3.0];
  console.log('phase now', (window as any).__lbw.dayPhase().toFixed(3));
});
await shoot('morning', 3200);

// the pond again under the high sun: glint + fresnel at full strength.
// The high morning sun sits over (+x, +z), so the eye has to be on the
// opposite (−x, −z) side of the pond to catch the mirror band across it.
await page.evaluate(() => {
  const st = (window as any).__stage;
  const { cx, cz, G } = st;
  (window as any).__cam.eye = [cx - 11.0, G + 1.9, cz - 1.0];
  (window as any).__cam.look = [cx - 3.8, G - 0.9, cz + 4.2];
});
await shoot('pond-morning', 2600);

await browser.close();
