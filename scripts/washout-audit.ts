/**
 * Washout audit: drives the parked-camera day/dusk/midnight staging the
 * look pass was tuned against, never touching renderer.toneMapping — so it
 * shoots the SHIPPED state (ACES@1.25 plus the kit's uToneOff day ramp).
 * Prints the kit's blend values and the midnight torch-census delta, and
 * saves PNGs for scripts/washout-stats.ts. Run against a local dev server
 * on :3150 (pw.local.ts's port; keeps its own save dir when given one):
 *   NODE_ENV=development PORT=3150 LBW_DATA_DIR=/tmp/opencode/lbw-test-lights npx tsx server/index.ts &
 *   npx tsx scripts/washout-audit.ts
 */
import { chromium } from '@playwright/test';
import * as fs from 'node:fs';

const OUT = '/tmp/opencode/lights-fix';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 506 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('AudioContext')) console.log('CONSOLE:', m.text().slice(0, 200));
});

await page.goto('http://localhost:3150/');
await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 30000 });
await page.evaluate(() => {
  const pad = (window as any).__lbw.addVirtualPad('xbox');
  (window as any).__pad = pad;
  pad.tap('jump');
});
await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0', null, { timeout: 30000 });
await page.evaluate(() => (window as any).__pad.tap('jump'));
await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 30000 });

await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const ids = (window as any).__lbw.ids;
  const p = game.players[0];
  const cx = Math.round(p.entity.pos.x), cz = Math.round(p.entity.pos.z);
  const G = S.surfaceY(cx, cz);
  (window as any).__stage = { cx, cz, G };
  for (let x = cx - 13; x <= cx + 13; x++) {
    for (let z = cz - 13; z <= cz + 13; z++) {
      for (let y = G + 1; y <= G + 9; y++) S.set(x, y, z, ids.AIR);
      S.set(x, G, z, ids.GRASS);
    }
  }
  for (let z = cz - 4; z <= cz + 4; z++) for (let y = G + 1; y <= G + 3; y++) S.set(cx + 3, y, z, ids.STONE);
  for (const dz of [-3, 0, 3]) {
    S.set(cx + 4, G + 1, cz + dz, ids.STONE);
    S.set(cx + 4, G + 2, cz + dz, ids.TORCH);
  }
  S.set(cx - 2, G + 1, cz + 2, ids.STONE);
  S.set(cx - 2, G + 2, cz + 2, ids.TORCH);
  p.entity.pos.set(cx + 0.5, G + 1.02, cz + 7.5);
  p.entity.vel.set(0, 0, 0);
});

await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const st = (window as any).__stage;
  (window as any).__cam = { eye: [st.cx + 9.5, st.G + 4.2, st.cz + 6.5], look: [st.cx - 1.0, st.G + 1.2, st.cz - 0.5] };
  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    const a = (window as any).__cam;
    lp.camera.position.set(a.eye[0], a.eye[1], a.eye[2]);
    lp.camera.lookAt(a.look[0], a.look[1], a.look[2]);
  };
  void orig;
});

const shoot = async (name: string, ms = 3200): Promise<string> => {
  await page.waitForTimeout(ms);
  const png = await page.screenshot();
  fs.writeFileSync(`${OUT}/${name}.png`, png);
  return png.toString('base64');
};

// the kit's day ramp, live:
const kitNow = () => page.evaluate(() => {
  const k = (window as any).__lbw.game.chunks.shaders;
  return { toneOff: k.uToneOff.value, dayLight: k.dayLight };
});

// day at boot phase — the state the complaint is about
console.log('day kit', JSON.stringify(await kitNow()));
await shoot('br3-day-default', 4000);

// dusk: step the sky clock to just past sunset, torches on
await page.evaluate(() => {
  const g = (window as any).__lbw.game;
  const cam = g.players[0].camera;
  for (let k = 0; k < 10; k++) (g as any).skyEnv.update(24, cam); // ~0.35 -> ~0.68
});
console.log('dusk kit', JSON.stringify(await kitNow()));
await shoot('br3-dusk');

// midnight with the torch wall — off vs on (the census question)
await page.evaluate(() => (window as any).__lbw.setDayMode('night'));
await page.waitForFunction(() => {
  let dir = 9, hemi = 0;
  (window as any).__lbw.game.scene.traverse((o: any) => {
    if (o.isDirectionalLight) dir = o.intensity;
    if (o.isHemisphereLight) hemi = o.intensity;
  });
  return dir < 0.4 && hemi >= 0.3;
}, null, { timeout: 25000 });
console.log('night kit', JSON.stringify(await kitNow()));
await page.evaluate('window.__lbw.game.lightsEnabled = false');
const darkB = await shoot('br3-night-off');
await page.evaluate('window.__lbw.game.lightsEnabled = true');
const litB = await shoot('br3-night-lit');
const census = await page.evaluate(`(${String.raw`(async (a, b) => {
  const load = async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return { d: ctx.getImageData(0, 0, cv.width, cv.height).data, w: img.width, h: img.height };
  };
  const A = await load(a), B = await load(b);
  const lum = (p, d) => d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
  let n = 0, dark = 0;
  const y0 = Math.floor(A.h * 0.45);
  for (let y = y0; y < A.h; y++) {
    for (let x = 0; x < A.w; x++) {
      const p = (y * A.w + x) * 4;
      if (lum(p, B.d) - lum(p, A.d) > 8) n++;
      if (B.d[p] < 26 && B.d[p + 1] < 26 && B.d[p + 2] < 26) dark++;
    }
  }
  return { brighterPixels: n, darkPixelsInLit: dark };
})`})(${JSON.stringify(darkB)}, ${JSON.stringify(litB)})`);
console.log('night census', JSON.stringify(census));

await browser.close();
console.log('probe3 done');
