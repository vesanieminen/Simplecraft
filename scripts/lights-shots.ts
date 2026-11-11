/**
 * Lights study: a midnight meadow lit only by torches (before/after the
 * Grown-Ups switch), a torch row whose pools overlap into a lane of warm
 * light, the low-sun horizon glare, and the shallow-water foam line.
 * Run against a local production server (the local test runner uses :3150;
 * this script keeps to its own port + data dir):
 *   npm run build
 *   NODE_ENV=production PORT=3152 LBW_DATA_DIR=/tmp/opencode/lbw-test-lights-shots npx tsx server/index.ts &
 *   npx tsx scripts/lights-shots.ts [out-prefix]
 */
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? '/tmp/opencode/lightshots';
const port = process.env.SHOT_PORT ?? '3152';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
page.on('console', (m) => { if (m.text().startsWith('shot')) console.log('PAGE:', m.text()); });

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

// Stage the yard: a tidy meadow, a stone wall with a torch row along it, a
// torch on a post by the path, and a shallow shore for the foam.
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const ids = (window as any).__lbw.ids;
  const p = game.players[0];
  const cx = Math.round(p.entity.pos.x), cz = Math.round(p.entity.pos.z);
  const G = S.surfaceY(cx, cz);
  (window as any).__stage = { cx, cz, G };

  // tidy a meadow pad: nothing above the grass, grass floor at G
  for (let x = cx - 13; x <= cx + 13; x++) {
    for (let z = cz - 13; z <= cz + 13; z++) {
      for (let y = G + 1; y <= G + 9; y++) S.set(x, y, z, ids.AIR);
      S.set(x, G, z, ids.GRASS);
    }
  }
  // the wall: 9 long, 3 high, with torches on posts every 3 cells ON THE
  // CAMERA SIDE — pools and flames must be visible (and point light does
  // not know about walls: staging the torches behind would just glow the
  // stone from inside, which is not the story this shot tells)
  for (let z = cz - 4; z <= cz + 4; z++) for (let y = G + 1; y <= G + 3; y++) S.set(cx + 3, y, z, ids.STONE);
  for (const dz of [-3, 0, 3]) {
    S.set(cx + 4, G + 1, cz + dz, ids.STONE); // a plinth to mount the torch on
    S.set(cx + 4, G + 2, cz + dz, ids.TORCH);
  }
  // a lone torch by the path, mid-meadow, for the single-pool shot
  S.set(cx - 2, G + 1, cz + 2, ids.STONE);
  S.set(cx - 2, G + 2, cz + 2, ids.TORCH);
  // an opened treasure chest — its own amber glow, and proof it lights too
  S.set(cx - 5, G, cz - 1, ids.STONE);
  S.set(cx - 5, G + 1, cz - 1, ids.CHEST_OPEN);
  // the shallow shore: a half-drowned stone step the foam must fringe
  S.set(cx - 6, G, cz + 5, ids.STONE);
  S.set(cx - 5, G, cz + 5, ids.WATER);
  S.set(cx - 4, G, cz + 5, ids.WATER);

  // the kid steps aside; the torch keeps burning even in a torchless game
  p.entity.pos.set(cx + 0.5, G + 1.02, cz + 7.5);
  p.entity.vel.set(0, 0, 0);
});

// Park midnight — and WAIT for the night lights to have actually settled
// (the sky lerps in game time, which runs at half wall clock headless), or
// every "night" shot is really a purple dusk.
await page.evaluate(() => (window as any).__lbw.setDayMode('night'));
await page.waitForFunction(() => {
  let dir = 9, hemi = 0;
  (window as any).__lbw.game.scene.traverse((o: any) => {
    if (o.isDirectionalLight) dir = o.intensity;
    if (o.isHemisphereLight) hemi = o.intensity;
  });
  return dir < 0.4 && hemi >= 0.3;
}, null, { timeout: 20000 });
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const st = (window as any).__stage;
  const { cx, cz, G } = st;
  (window as any).__cam = { eye: [cx + 9.5, G + 4.2, cz + 6.5], look: [cx - 1.0, G + 1.2, cz - 0.5] };
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

const shoot = async (name: string, ms = 3200): Promise<void> => {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `${out}-${name}.jpg`, type: 'jpeg', quality: 92 });
  console.log('shot', name);
};

// the BEFORE: midnight with the grown-up's Lights switch off
await page.evaluate(() => {
  const g = (window as any).__lbw.game;
  g.lightsEnabled = false;
});
await shoot('night-off');

// the AFTER: the same frame with the torch pools burning
await page.evaluate(() => {
  const g = (window as any).__lbw.game;
  g.lightsEnabled = true;
});
await shoot('night-torches');

// closer down the wall: the three-pool lane, flames wobbling above the posts
await page.evaluate(() => {
  const st = (window as any).__stage;
  const { cx, cz, G } = st;
  (window as any).__cam.eye = [cx + 8.0, G + 2.9, cz + 4.6];
  (window as any).__cam.look = [cx + 2.2, G + 1.8, cz - 0.4];
});
await shoot('torch-row');

// sunset: un-park the clock and drive it to a low sun — the horizon glare,
// ACES film rolloff, and every torch pool on against the last daylight
await page.evaluate(() => {
  const g = (window as any).__lbw.game;
  const st = (window as any).__stage;
  const { cx, cz, G } = st;
  g.setDayMode('auto');
  const cam = g.players[0].camera;
  // boot phase 0.35 → step the sky clock forward to just past dusk (~0.80)
  for (let k = 0; k < 13; k++) (g as any).skyEnv.update(24, cam); // phase 0.35 → ~0.78: dusk
  (window as any).__cam.eye = [cx + 8.5, G + 3.2, cz + 7.0];
  (window as any).__cam.look = [cx - 4.0, G + 0.8, cz - 2.0];
});
await shoot('dusk', 4200);

// the foam line: shallow water over stone fringes white while the pool stays clean
await page.evaluate(() => {
  const g = (window as any).__lbw.game;
  g.setDayMode('day');
  const st = (window as any).__stage;
  const { cx, cz, G } = st;
  (window as any).__cam.eye = [cx - 3.0, G + 2.4, cz + 8.5];
  (window as any).__cam.look = [cx - 5.2, G - 0.2, cz + 5.0];
});
await shoot('foam');

// the README hero: the midnight meadow with the torch lane burning — what
// night feels like with this branch. The wide angle (not the tight wall):
// pools on the grass, the cool dark beyond their reach, the lone torch by
// the path and the chest's amber glow all in one frame.
await page.evaluate(() => {
  const g = (window as any).__lbw.game;
  g.setDayMode('night');
  const st = (window as any).__stage;
  const { cx, cz, G } = st;
  (window as any).__cam.eye = [cx + 9.5, G + 4.2, cz + 6.5];
  (window as any).__cam.look = [cx - 1.0, G + 1.2, cz - 0.5];
});
await page.waitForTimeout(4200);
await page.screenshot({ path: 'docs/screenshots/lights.jpg', type: 'jpeg', quality: 92 });
console.log('shot docs/screenshots/lights.jpg');

await browser.close();
