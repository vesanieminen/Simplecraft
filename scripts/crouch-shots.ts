/**
 * Pose study for the crouch: the same kid standing, then sneaking — idle and
 * mid-stride — shot from the side so the fold, the hip height and, above all,
 * where the FEET end up are unmistakable. Run against a dev server:
 *   rm -rf /tmp/opencode/lbw-shot-world
 *   NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-shot-world npx tsx server/index.ts &
 *   npx tsx scripts/crouch-shots.ts [out-prefix]
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? '/tmp/opencode/crouch';
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.addInitScript(() => {
  (window as any).__name = (fn: unknown) => fn;
});
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e)));

await page.goto('http://localhost:3100/?seed=8675309&world=0');
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

// a flat, empty stage around wherever the kid actually landed, and a camera
// parked at their side: a profile is the only honest way to read a sneak
await page.evaluate(() => {
  const game = (window as any).__lbw.game;
  const S = game.world;
  const { AIR, GRASS } = (window as any).__lbw.ids;
  const p = game.players[0];
  const fx = Math.round(p.entity.pos.x), fz = Math.round(p.entity.pos.z);
  const gy = Math.floor(p.entity.pos.y) - 1; // the floor the kid stands over
  for (let x = fx - 6; x <= fx + 6; x++) {
    for (let z = fz - 6; z <= fz + 6; z++) {
      for (let y = gy + 1; y <= gy + 10; y++) if (S.get(x, y, z) !== AIR) S.set(x, y, z, AIR);
      for (let y = gy - 2; y <= gy; y++) if (S.get(x, y, z) === AIR) S.set(x, y, z, GRASS);
    }
  }
  p.firstPerson = false;
  p.entity.pos.set(fx + 0.5, gy + 1.02, fz + 0.5);
  p.entity.vel.set(0, 0, 0);
  p.entity.yaw = Math.PI / 2; // broadside to the parked camera

  const lp = game.players[0];
  const orig = lp.update.bind(lp);
  lp.update = (...args: unknown[]): void => {
    orig(...args);
    if (lp.ghost) lp.ghost.visible = false;
    if (lp.outline) lp.outline.visible = false;
    if ((window as any).__profile === false) return; // let the game's own follow cam run
    const e = lp.entity;
    // profile view: this rig's front is +x, so the camera stands off to the
    // side, along z, and looks across the kid's profile
    lp.camera.position.set(e.pos.x + 0.12, e.pos.y + 0.78, e.pos.z + 2.55);
    lp.camera.lookAt(e.pos.x, e.pos.y + 0.55, e.pos.z);
  };
  void orig;
});
await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
await page.evaluate(() => { (window as any).__pad.setMove(0, 0); });
await page.waitForTimeout(700);

const shoot = async (name: string): Promise<void> => {
  const pose = await page.evaluate(() => {
    const p = (window as any).__lbw.game.players[0];
    const a = p.entity.avatar;
    const f = (v: number) => Number(v.toFixed(2));
    return {
      crouch: p.entity.crouching, crouchT: f(a.crouchT),
      bodyLean: f(a.body.rotation.x), hipY: f(a.chest.position.y), fold: f(a.chest.rotation.x),
      legL: f(a.leftLeg.rotation.x), legR: f(a.rightLeg.rotation.x),
      armL: f(a.leftArm.rotation.x), armR: f(a.rightArm.rotation.x),
      scale: f(a.group.scale.y),
    };
  });
  console.log(name, JSON.stringify(pose));
  await page.screenshot({ path: `${out}-${name}.jpg`, type: 'jpeg', quality: 92 });
};

await shoot('standing');

// tap B: the sneak, settled
await page.evaluate(() => (window as any).__pad.tap('back'));
await page.waitForFunction('window.__lbw.game.players[0].entity.crouching === true', null, { timeout: 8000 });
await page.waitForTimeout(700);
await shoot('crouch-idle');

// mid-stride: creeping forward. Sample the pose over a whole stride and report
// the extremes — a single frame tells you nothing about the shuffle's swing
await page.evaluate(() => {
  const w = window as any;
  w.__probe = [];
  w.__sampling = setInterval(() => {
    const p = w.__lbw.game.players[0];
    const a = p.entity.avatar;
    w.__probe.push({
      moving: p.entity.moving && p.entity.grounded, vel: Math.hypot(p.entity.vel.x, p.entity.vel.z),
      legL: a.leftLeg.rotation.x, legR: a.rightLeg.rotation.x,
      armL: a.leftArm.rotation.x, armR: a.rightArm.rotation.x,
    });
  }, 40);
  (window as any).__pad.setMove(0, -1);
});
await page.waitForTimeout(1400);
console.log('creep samples:', await page.evaluate(() => {
  clearInterval((window as any).__sampling);
  const s = (window as any).__probe;
  const span = (k: string) => [Math.min(...s.map((r: any) => r[k])).toFixed(2), Math.max(...s.map((r: any) => r[k])).toFixed(2)];
  return {
    moving: s.some((r: any) => r.moving), speed: Math.max(...s.map((r: any) => r.vel)).toFixed(2),
    legL: span('legL'), legR: span('legR'), armL: span('armL'), armR: span('armR'),
  };
}));
await page.evaluate(() => { (window as any).__pad.setMove(0, 0); });
await page.waitForTimeout(450);
await shoot('crouch-walk');

// and how it actually reads in play: the game's own follow camera, three-quarter
// from behind, while the kid creeps
await page.evaluate(() => {
  (window as any).__profile = false;
  (window as any).__lbw.game.players[0].entity.yaw = Math.PI / 2 + 0.8;
  (window as any).__pad.setMove(0, -1);
});
await page.waitForTimeout(700);
await shoot('crouch-play');
await page.evaluate(() => (window as any).__pad.setMove(0, 0));

await browser.close();
console.log('crouch shots done');
