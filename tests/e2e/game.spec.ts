/**
 * End-to-end tests driving the game through the same input abstraction
 * real controllers use (virtual pads). These are NOT a substitute for
 * physical gamepad verification — see README for the manual checklist.
 */

import { expect, test, type Page } from '@playwright/test';

type Pad = {
  setMove: (x: number, y: number) => void;
  setLook: (x: number, y: number) => void;
  set: (action: string, down: boolean) => void;
  tap: (...actions: string[]) => void;
  press: (action: string) => void;
  release: (action: string) => void;
};

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('AudioContext')) errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });
  expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
}

async function joinWithPad(page: Page, confirmDelay = true): Promise<Pad> {
  const pad = await page.evaluate(() => (window as any).__lbw.addVirtualPad());
  void pad;
  // wake the join card
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const src = [...game.input.sources.values()].find((s: any) => s.kind === 'virtual' && !game.sourceToPlayer.has(s.id));
    (window as any).__testPad = src;
    src.tap('jump');
  });
  await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0');
  if (confirmDelay) {
    await page.evaluate(() => (window as any).__testPad.tap('jump'));
  }
  await page.waitForFunction('window.__lbw.game.players.length > 0');
  return pad;
}

/** waits for n animation frames (a big world can render slowly in headless CI) */
function frames(page: Page, n = 2): Promise<unknown> {
  return page.evaluate((k: number) => new Promise<void>((resolve) => {
    let left = k;
    const tick = (): void => {
      left--;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), n);
}

/** taps one button and lets a couple of frames pass, so taps never merge */
async function tap(page: Page, action: string): Promise<void> {
  await page.evaluate((a: string) => (window as any).__testPad.tap(a), action);
  await frames(page, 2);
}

/** waits until a player has actually walked `minDist` blocks from `from` */
async function waitForMove(
  page: Page, from: { x: number; z: number }, minDist: number, playerIdx = 0,
): Promise<void> {
  await page.waitForFunction(
    (arg: { f: { x: number; z: number }; d: number; i: number }) => {
      const e = (window as any).__lbw.game.players[arg.i].entity;
      return Math.hypot(e.pos.x - arg.f.x, e.pos.z - arg.f.z) > arg.d;
    },
    { f: from, d: minDist, i: playerIdx },
    { timeout: 20000 },
  );
}

/** waits until a player has decelerated to a standstill */
async function waitForStop(page: Page, playerIdx = 0): Promise<void> {
  await page.waitForFunction(
    (i: number) => {
      const e = (window as any).__lbw.game.players[i].entity;
      return Math.hypot(e.vel.x, e.vel.z) < 0.05;
    },
    playerIdx,
    { timeout: 10000 },
  );
}

test('game loads without console errors and shows welcome', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.welcome')).toBeVisible();
  // canvas has actually rendered something
  const nonBlank = await page.evaluate(() => {
    const c = document.getElementById('gl') as HTMLCanvasElement;
    return c.width > 0 && c.height > 0;
  });
  expect(nonBlank).toBe(true);
});

test('keyboard player can join with Enter only', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Enter'); // wakes join card for keyboard
  await page.waitForFunction('window.__lbw.game.pendingJoins.size === 1');
  await page.keyboard.press('Enter'); // confirm
  await page.waitForFunction('window.__lbw.game.players.length === 1');
  const name = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.name);
  expect(typeof name).toBe('string');
});

test('controller player joins and can move + jump', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  // let the join-confirm jump finish and the player settle on the ground
  await page.evaluate(() => (window as any).__testPad.set('jump', false));
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 5000 });
  const pos0 = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { x: e.pos.x, z: e.pos.z };
  });
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await waitForMove(page, pos0, 1);
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));

  // jump raises the player
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 5000 });
  const y0 = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.pos.y);
  await page.evaluate(() => (window as any).__testPad.set('jump', true));
  await page.waitForFunction((y: number) => (window as any).__lbw.game.players[0].entity.pos.y > y + 0.5, y0, { timeout: 5000 });
  await page.evaluate(() => (window as any).__testPad.set('jump', false));
});

test('second controller joins and split screen activates', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  // second pad
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const src = game.addVirtualPad('xbox');
    src.tap('jump');
  });
  await page.waitForFunction('window.__lbw.game.pendingJoins.size === 1');
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const src = [...game.pendingJoins.keys()].map((k) => game.input.sources.get(k))[0];
    src.tap('jump');
  });
  await page.waitForFunction('window.__lbw.game.players.length === 2');
  const rects = await page.evaluate(() => (window as any).__lbw.game.viewportMgr.rects.length);
  expect(rects).toBe(2);
  const panes = await page.evaluate(() => document.querySelectorAll('.pane').length);
  expect(panes).toBe(2);
});

test('both local players move independently', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const src = game.addVirtualPad('xbox');
    src.tap('jump');
  });
  await page.waitForFunction('window.__lbw.game.pendingJoins.size === 1');
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const src = [...game.pendingJoins.keys()].map((k) => game.input.sources.get(k))[0];
    src.tap('jump');
    (window as any).__testPad2 = src;
  });
  await page.waitForFunction('window.__lbw.game.players.length === 2');

  const before = await page.evaluate(() =>
    (window as any).__lbw.game.players.map((p: any) => ({ x: p.entity.pos.x, z: p.entity.pos.z })),
  );
  await page.evaluate(() => {
    (window as any).__testPad.setMove(0, -1);
    (window as any).__testPad2.setMove(0, 1);
  });
  await waitForMove(page, before[0], 0.8, 0);
  await waitForMove(page, before[1], 0.8, 1);
  await page.evaluate(() => {
    (window as any).__testPad.setMove(0, 0);
    (window as any).__testPad2.setMove(0, 0);
  });
});

test('RT places a block and LT removes it', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await page.waitForTimeout(300);
  const targetInfo = await page.evaluate(() => {
    const p = (window as any).__lbw.game.players[0];
    return { target: p.target ? { x: p.target.x, y: p.target.y, z: p.target.z, px: p.target.px, py: p.target.py, pz: p.target.pz } : null, pitch: p.entity.pitch, y: p.entity.pos.y };
  });
  console.log('pre-place state:', JSON.stringify(targetInfo));
  // wait until the player is grounded and has a valid target (kid-logic: aim at ground first)
  await page.waitForFunction('window.__lbw.game.players[0].target !== null', null, { timeout: 15000 });
  const modsBefore = await page.evaluate(() => (window as any).__lbw.game.world.mods.size);
  // place
  await page.evaluate(() => (window as any).__testPad.set('place', true));
  await page.waitForTimeout(600);
  await page.evaluate(() => (window as any).__testPad.set('place', false));
  const modsAfterPlace = await page.evaluate(() => (window as any).__lbw.game.world.mods.size);
  expect(modsAfterPlace).toBeGreaterThan(modsBefore);
  // remove the block we just placed (search for the first added non-zero mod)
  const removed = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const { sz, sy } = (window as any).__lbw.dims;
    for (const [i, v] of game.world.mods) {
      if (v !== 0 && i > 0) {
        const y = i % sy, xz = Math.floor(i / sy);
        game.world.set(Math.floor(xz / sz), y, xz % sz, 0);
        return true;
      }
    }
    return false;
  });
  expect(removed).toBe(true);
});

test('right stick turns the view right (and stick up looks up)', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await page.evaluate(() => (window as any).__testPad.set('jump', false));
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 5000 });
  const y0 = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.yaw);
  // hold the right stick RIGHT for 300ms
  await page.evaluate(() => (window as any).__testPad.setLook(1, 0));
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).__testPad.setLook(0, 0));
  const y1 = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.yaw);
  // dir=(sin yaw, cos yaw): turning right means yaw decreases
  expect(y1).toBeLessThan(y0);

  // stick UP (negative axis) must look up (pitch increases)
  const p0 = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.pitch);
  await page.evaluate(() => (window as any).__testPad.setLook(0, -1));
  await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).__testPad.setLook(0, 0));
  const p1 = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.pitch);
  expect(p1).toBeGreaterThan(p0);
});

test('world modifications persist across a page reload', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  const want = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const { sz, sy } = (window as any).__lbw.dims;
    game.world.set(33, 30, 33, 21); // a green block high in the air
    return { key: String((33 * sz + 33) * sy + 30), seed: game.seed, theme: game.theme };
  });
  await page.evaluate(async (w: { key: string; seed: number; theme: number }) => {
    (window as any).__savedOk = false;
    const iv = setInterval(async () => {
      const r = await fetch(`/api/world?seed=${w.seed}&theme=${w.theme}`);
      const d = await r.json();
      if (d && d.mods && d.mods[w.key] === 21) {
        (window as any).__savedOk = true;
        clearInterval(iv);
      }
    }, 250);
  }, want);
  await page.waitForFunction('window.__savedOk === true', null, { timeout: 15000 });
  await page.reload();
  await page.waitForFunction('window.__lbw !== undefined');
  const found = await page.evaluate(() => (window as any).__lbw.game.world.get(33, 30, 33));
  expect(found).toBe(21);
});

test('block palette opens on Y and picks with dpad+A, without pausing the other player', async ({ page }) => {
  await boot(page);
  await joinWithPad(page); // player 1
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const src = game.addVirtualPad('xbox');
    src.tap('jump');
  });
  await page.waitForFunction('window.__lbw.game.pendingJoins.size === 1');
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const src = [...game.pendingJoins.keys()].map((k) => game.input.sources.get(k))[0];
    src.tap('jump');
    (window as any).__testPad2 = src;
  });
  await page.waitForFunction('window.__lbw.game.players.length === 2');

  // player 2 keeps walking while player 1 opens the palette
  await page.evaluate(() => {
    (window as any).__testPad2.setMove(0, -1);
    (window as any).__testPad.tap('palette');
  });
  await page.waitForSelector('.palette-grid');
  const before = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[1].entity;
    return { x: e.pos.x, z: e.pos.z };
  });
  await waitForMove(page, before, 0.8, 1);
  await page.evaluate(() => (window as any).__testPad2.setMove(0, 0));

  // navigate with dpad, pick with A
  await page.evaluate(() => (window as any).__testPad.tap('right'));
  await page.waitForTimeout(150);
  await page.evaluate(() => (window as any).__testPad.tap('jump'));
  await page.waitForFunction('window.__lbw.game.players[0].selected !== 1', null, { timeout: 5000 });
  const sel = await page.evaluate(() => (window as any).__lbw.game.players[0].selected);
  expect(sel).not.toBe(1);
  // palette closed after pick
  await page.waitForSelector('.palette-grid', { state: 'detached' });
});

test('shoulder buttons cycle blocks', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  const sel0 = await page.evaluate(() => (window as any).__lbw.game.players[0].selected);
  await page.evaluate(() => (window as any).__testPad.tap('nextBlock'));
  await page.waitForTimeout(150);
  const sel1 = await page.evaluate(() => (window as any).__lbw.game.players[0].selected);
  expect(sel1).not.toBe(sel0);
});

test('start button opens the player menu, dpad navigates, A toggles fly', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await page.evaluate(() => (window as any).__testPad.tap('menu'));
  await page.waitForSelector('.menu-list');
  await page.evaluate(() => (window as any).__testPad.tap('down')); // to Fly row
  await page.waitForTimeout(120);
  await page.evaluate(() => (window as any).__testPad.tap('jump'));
  await page.waitForFunction('window.__lbw.game.players[0].entity.flying === true');
  // close menu with B
  await page.evaluate(() => (window as any).__testPad.tap('back'));
  await page.waitForSelector('.menu-list', { state: 'detached' });
});

test('split-screen layout recomputes on window resize without errors', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const src = game.addVirtualPad('xbox');
    src.tap('jump');
  });
  await page.waitForFunction('window.__lbw.game.pendingJoins.size === 1');
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const src = [...game.pendingJoins.keys()].map((k) => game.input.sources.get(k))[0];
    src.tap('jump');
  });
  await page.waitForFunction('window.__lbw.game.players.length === 2');
  const r1 = await page.evaluate(() => (window as any).__lbw.game.viewportMgr.rects.map((r: any) => r.w));
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(400);
  const r2 = await page.evaluate(() => (window as any).__lbw.game.viewportMgr.rects.map((r: any) => r.w));
  expect(r1).not.toEqual(r2);
  expect(r2[0]).toBe(450);
});

test('four controllers join and get a 2x2 grid', async ({ page }) => {
  await boot(page);
  await joinWithPad(page); // 1
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const game = (window as any).__lbw.game;
      const src = game.addVirtualPad('xbox');
      src.tap('jump');
    });
    await page.waitForFunction('window.__lbw.game.pendingJoins.size === 1');
    await page.evaluate(() => {
      const game = (window as any).__lbw.game;
      const src = [...game.pendingJoins.keys()].map((k) => game.input.sources.get(k))[0];
      src.tap('jump');
    });
    await page.waitForFunction(`window.__lbw.game.players.length === ${i + 2}`);
  }
  const state = await page.evaluate(() => ({
    rects: (window as any).__lbw.game.viewportMgr.rects.length,
    panes: document.querySelectorAll('.pane').length,
  }));
  expect(state.rects).toBe(4);
  expect(state.panes).toBe(4);
});

test('controller disconnect shows reconnect UI and any new controller resumes the player', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  const name = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.name);
  // unplug
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const p = game.players[0];
    const src = game.input.sources.get(p.sourceId);
    game.input.removeSource(src);
  });
  await page.waitForSelector('.overlay-card', { timeout: 5000 });
  // press any button on any other controller -> seat is refilled, same character
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const pad = game.addVirtualPad('xbox');
    pad.tap('jump');
  });
  await page.waitForFunction('window.__lbw.game.reservedSeats.size === 0');
  const state = await page.evaluate(() => ({
    name: (window as any).__lbw.game.players[0].entity.name,
    pending: (window as any).__lbw.game.pendingJoins.size,
    players: (window as any).__lbw.game.players.length,
  }));
  expect(state.name).toBe(name);
  expect(state.pending).toBe(0);
  expect(state.players).toBe(1);
});

// ------------------------------------------------------- world & menu tests

/** reads which menu row is currently highlighted (0-based) */
async function selectedRow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('.overlay-card .menu-item')];
    return rows.findIndex((r) => r.classList.contains('sel'));
  });
}

async function selectRow(page: Page, index: number): Promise<void> {
  for (let guard = 0; guard < 30; guard++) {
    const cur = await selectedRow(page);
    if (cur === index) return;
    await tap(page, cur === -1 ? 'down' : cur < index ? 'down' : 'up');
  }
  throw new Error(`could not highlight menu row ${index}`);
}

async function openGrownUpsMenu(page: Page): Promise<void> {
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 8); // Grown-Ups
  await tap(page, 'jump');
  await page.waitForTimeout(300);
  expect(await selectedRow(page)).toBe(0);
}

const posOf = (page: Page) =>
  page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { x: e.pos.x, z: e.pos.z, y: e.pos.y };
  });

test('plants are textured atlas quads and the break button destroys them', async ({ page }) => {
  await boot(page);
  const mat = await page.evaluate(() => {
    const m = (window as any).__lbw.game.chunks.materials.cross;
    return { hasMap: !!m.map, alphaTest: m.alphaTest, doubleside: m.side === 2 };
  });
  expect(mat.hasMap).toBe(true); // the procedural plant atlas, not flat polygons
  expect(mat.alphaTest).toBeGreaterThan(0);
  expect(mat.doubleside).toBe(true);

  await joinWithPad(page);
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 10000 });

  // stand a grass tuft right in the cell the player is aiming at
  let spot: { x: number; y: number; z: number } | null = null;
  for (let i = 0; i < 30 && !spot; i++) {
    spot = await page.evaluate((tuft: number) => {
      const game = (window as any).__lbw.game;
      const t = game.players[0].target;
      if (!t) return null;
      game.world.set(t.px, t.py, t.pz, tuft);
      return { x: t.px, y: t.py, z: t.pz };
    }, ids.TALLGRASS);
    if (!spot) await page.waitForTimeout(100);
  }
  expect(spot).not.toBeNull();
  const cell = spot!;

  await frames(page, 3);
  const aim = await page.evaluate(() => {
    const p = (window as any).__lbw.game.players[0];
    const r = p.removeTarget, s = p.target;
    return {
      removeBlock: r ? r.block : -1, removeY: r ? r.y : -1,
      placeBlock: s ? s.block : -1,
    };
  });
  // LT aims at the plant, RT still aims through it at the ground
  expect(aim.removeBlock).toBe(ids.TALLGRASS);
  expect(aim.removeY).toBe(cell.y);
  expect(aim.placeBlock).not.toBe(ids.TALLGRASS);

  // hold the break button (LT) — the plant must disappear
  await page.evaluate(() => (window as any).__testPad.set('remove', true));
  await page.waitForFunction(
    (c: { x: number; y: number; z: number }) => (window as any).__lbw.game.world.get(c.x, c.y, c.z) === 0,
    cell, { timeout: 10000 },
  );
  await page.evaluate(() => (window as any).__testPad.set('remove', false));
});

test('water cannot be destroyed by the break button', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const blocked = await page.evaluate((water: number) => {
    const game = (window as any).__lbw.game;
    const { sx, sz } = (window as any).__lbw.dims;
    let found: { x: number; y: number; z: number } | null = null;
    outer: for (let x = 2; x < sx - 2; x++) {
      for (let z = 2; z < sz - 2; z++) {
        for (let y = 1; y < 20; y++) {
          if (game.world.get(x, y, z) === water) {
            found = { x, y, z };
            break outer;
          }
        }
      }
    }
    if (!found) return null;
    const before = game.world.get(found.x, found.y, found.z);
    const hit = { block: before, x: found.x, y: found.y, z: found.z, px: found.x, py: found.y + 1, pz: found.z, dist: 1 };
    game.hooks().tryRemove(game.players[0], hit);
    return { after: game.world.get(found.x, found.y, found.z), water };
  }, ids.WATER);
  test.skip(blocked === null, 'no water found in this world');
  expect(blocked!.after).toBe(blocked!.water);
});

test('kids can jump out of the water onto the shore', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);

  // a deep pond right in front of the player, its shore one block above the
  // water surface. Paddling tops out just under the surface, so climbing out
  // needs a real push-off jump.
  const lake = await page.evaluate((b: { water: number; grass: number; air: number }) => {
    const game = (window as any).__lbw.game;
    const S = game.world;
    const e = game.players[0].entity;
    const cx = Math.round(e.pos.x), cz = Math.round(e.pos.z);
    const base = S.surfaceY(cx, cz); // the pond's water surface ends at y = base
    const deep = 6;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let y = base - deep; y <= base + 3; y++) S.set(cx + dx, y, cz + dz, b.air);
        if (dz <= -2) {
          for (let y = base - deep; y <= base; y++) S.set(cx + dx, y, cz + dz, b.grass); // shore
        } else {
          for (let y = base - deep; y <= base - 1; y++) S.set(cx + dx, y, cz + dz, b.water); // pond
        }
      }
    }
    e.pos.set(cx + 0.5, base + 1, cz - 2.5); // standing on the shore, pond just north
    e.vel.set(0, 0, 0);
    e.yaw = 0; // face the pond
    return { cx, cz, base, shoreFeetY: base + 1, waterAtSurface: S.get(cx, base - 1, cz) };
  }, { water: ids.WATER, grass: ids.GRASS, air: ids.AIR });
  expect(lake.waterAtSurface).toBe(ids.WATER);

  // the kid walks in and paddles for a moment without pressing jump
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await page.waitForFunction('window.__lbw.game.players[0].entity.inWaterNow === true', null, { timeout: 15000 });
  await frames(page, 10);

  // turn around, then hold jump and paddle for the shore
  await page.evaluate(() => {
    (window as any).__lbw.game.players[0].entity.yaw = Math.PI;
    (window as any).__testPad.set('jump', true);
    (window as any).__testPad.setMove(0, -1);
  });
  const escaped = await page.waitForFunction(
    (l: { shoreFeetY: number; cz: number }) => {
      const e = (window as any).__lbw.game.players[0].entity;
      if (!(e.grounded && !e.inWaterNow && e.pos.y >= l.shoreFeetY - 0.05 && e.pos.z <= l.cz - 1.5)) return false;
      return { y: e.pos.y, z: e.pos.z }; // snapshot the exact frame they get out
    },
    lake, { timeout: 30000 },
  );
  const out = (await escaped.jsonValue()) as { y: number; z: number };
  await page.evaluate(() => {
    (window as any).__testPad.set('jump', false);
    (window as any).__testPad.setMove(0, 0);
  });

  expect(out.y).toBeGreaterThanOrEqual(lake.shoreFeetY - 0.05); // dry land, above the water
  expect(out.z).toBeLessThanOrEqual(lake.cz - 1.5); // and ashore, not back in the pond

  // fill the pond in so it cannot confuse later tests
  await page.evaluate((arg: { cx: number; cz: number; base: number; grass: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        for (let y = arg.base - 6; y <= arg.base + 3; y++) {
          S.set(arg.cx + dx, y, arg.cz + dz, y <= arg.base ? arg.grass : arg.air);
        }
      }
    }
  }, { ...lake, grass: ids.GRASS, air: ids.AIR });
});
/** opens Grown-Up Settings, switches Freeze, and closes the menu again */
async function setFreeze(page: Page, on: boolean): Promise<void> {
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 8); // Grown-Ups
  await tap(page, 'jump');
  await selectRow(page, 0); // Freeze Game
  if ((await page.evaluate(() => (window as any).__lbw.game.frozen)) !== on) await tap(page, 'jump');
  await tap(page, 'back'); // close the menu so the player can walk again
  await page.waitForFunction((v: boolean) => (window as any).__lbw.game.frozen === v, on, { timeout: 10000 });
}

test('grown-up menu: freeze pauses the world, split screen cycles, reset clears edits', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 10000 });

  // a world edit to lose later + a baseline walk to prove movement works first
  await page.evaluate(() => (window as any).__lbw.game.world.set(10, 40, 10, 21));
  expect(await page.evaluate(() => (window as any).__lbw.game.world.mods.size)).toBeGreaterThan(0);
  const start = await posOf(page);
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await waitForMove(page, start, 0.8);
  const walked = await posOf(page);
  expect(Math.hypot(walked.x - start.x, walked.z - start.z)).toBeGreaterThan(0.8);
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  await waitForStop(page);

  // --- Freeze: walking must stop, unfreezing must bring it back
  await setFreeze(page, true);
  const frozenAt = await posOf(page);
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await page.waitForTimeout(900);
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  await frames(page, 2);
  const stuck = await posOf(page);
  expect(Math.hypot(stuck.x - frozenAt.x, stuck.z - frozenAt.z)).toBeLessThan(0.05);

  await setFreeze(page, false);
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await waitForMove(page, stuck, 0.8);
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  await frames(page, 2);

  // --- Split Screen cycles through every layout, Reset World wipes edits
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 8);
  await tap(page, 'jump');

  await selectRow(page, 1); // Split Screen
  const layouts: string[] = [];
  for (let i = 0; i < 4; i++) {
    await tap(page, 'jump');
    layouts.push(await page.evaluate(() => (window as any).__lbw.game.layout));
  }
  expect(new Set(layouts).size).toBe(4);
  expect(layouts).toContain('grid2x2');

  await selectRow(page, 3); // Reset World: first tap arms, second wipes
  await tap(page, 'jump');
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__lbw.game.world.mods.size)).toBeGreaterThan(0);
  await tap(page, 'jump');
  await page.waitForFunction('window.__lbw.game.world.mods.size === 0', null, { timeout: 20000 });
  const after = await page.evaluate(() => ({
    block: (window as any).__lbw.game.world.get(10, 40, 10),
    players: (window as any).__lbw.game.players.length,
  }));
  expect(after.block).toBe(0);
  expect(after.players).toBe(1);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 12000 });
});

test('grown-up menu: Choose World opens the preview picker and starts a new world', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 5000 });
  await openGrownUpsMenu(page);

  await selectRow(page, 2); // Choose World
  await tap(page, 'jump');
  await page.waitForSelector('.world-preview');

  // the preview canvas really renders a map (many distinct colours)
  const variety = await page.evaluate(() => {
    const c = document.querySelector('.world-preview') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<string>();
    for (let i = 0; i < d.length; i += 4) seen.add(`${d[i] >> 3},${d[i + 1] >> 3},${d[i + 2] >> 3}`);
    return seen.size;
  });
  expect(variety).toBeGreaterThan(12);

  await tap(page, 'right'); // next theme
  await selectRow(page, 3); // Start this world
  await tap(page, 'jump');
  await page.waitForSelector('.world-preview', { state: 'detached' });

  const state = await page.evaluate(() => ({
    theme: (window as any).__lbw.game.theme,
    worldTheme: (window as any).__lbw.game.world.theme,
    seed: (window as any).__lbw.game.seed,
    mods: (window as any).__lbw.game.world.mods.size,
    animals: (window as any).__lbw.game.animals.animals.length,
    players: (window as any).__lbw.game.players.length,
  }));
  expect(state.theme).toBe(1);
  expect(state.worldTheme).toBe(1);
  expect(state.mods).toBe(0);
  expect(state.animals).toBeGreaterThan(0);
  expect(state.players).toBe(1);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 12000 });
});

test('world picker at the welcome screen picks a theme, a surprise seed and starts it', async ({ page }) => {
  test.slow();
  await boot(page);
  await page.evaluate(() => {
    const pad = (window as any).__lbw.addVirtualPad();
    (window as any).__testPad = pad;
    pad.tap('palette');
  });
  await page.waitForSelector('.world-preview');
  expect(await page.evaluate(() => (window as any).__lbw.game.players.length)).toBe(0);

  await tap(page, 'right'); // theme -> Islands
  await selectRow(page, 2); // Surprise me!
  await tap(page, 'jump');
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.overlay-card .menu-item .mi-body')].map((e) => e.textContent ?? ''),
  );
  const shownSeed = Number((rows[1] ?? '').match(/\d+/)?.[0]);
  expect(Number.isInteger(shownSeed)).toBe(true);
  expect(shownSeed).toBeGreaterThan(0);

  await selectRow(page, 3); // Start
  await tap(page, 'jump');
  await page.waitForSelector('.world-preview', { state: 'detached' });
  const state = await page.evaluate(() => ({
    seed: (window as any).__lbw.game.seed,
    theme: (window as any).__lbw.game.theme,
    worldTheme: (window as any).__lbw.game.world.theme,
  }));
  expect(state.seed).toBe(shownSeed);
  expect(state.theme).toBe(1);
  expect(state.worldTheme).toBe(1);
  // back to the welcome screen, ready to join
  await expect(page.locator('.welcome')).toBeVisible();
});

test('menu sub-screens receive controller input (Help screen opens and closes on the pad)', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 6); // Help
  await tap(page, 'jump');
  await page.waitForSelector('.pad-help');
  expect(await page.evaluate(() => (window as any).__lbw.game.overlays.size)).toBe(1);
  await tap(page, 'back');
  await page.waitForSelector('.pad-help', { state: 'detached' });
  await page.waitForFunction('window.__lbw.game.overlays.size === 0');
});

test('the ?seed= and ?world= url params choose the starting world', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?seed=4242&world=2');
  await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });
  expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
  const state = await page.evaluate(() => ({
    seed: (window as any).__lbw.game.seed,
    theme: (window as any).__lbw.game.theme,
    worldTheme: (window as any).__lbw.game.world.theme,
  }));
  expect(state).toEqual({ seed: 4242, theme: 2, worldTheme: 2 });
});

// ------------------------------------------------------------ sky & rendering

/**
 * Counts pixels that are essentially pure black: the only way to see those is
 * the canvas behind the scene, i.e. something got clipped out of the picture.
 */
async function blackPixels(page: Page): Promise<number> {
  const png = await page.screenshot();
  return page.evaluate(async (b64: string) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < 26 && d[i + 1] < 26 && d[i + 2] < 26) n++;
    }
    return n;
  }, png.toString('base64'));
}

test('no black hole in the sky, wherever the camera looks', async ({ page }) => {
  test.slow();
  await boot(page);

  // the symptom: a few seconds after loading, a black wedge appeared in the
  // background once the welcome camera had drifted to where the sky dome hangs
  // farthest away. Tiny tolerance for the odd dark animal pixel; the bug was
  // ~10 000 pixels.
  for (const angle of [0.5, 1.05, 2.6, 4.2, 5.8]) {
    await page.evaluate((a: number) => { (window as any).__lbw.game.idleAngle = a; }, angle);
    await frames(page, 3);
    expect(await blackPixels(page), `welcome camera at angle ${angle}`).toBeLessThan(200);
  }

  // the invariant that keeps it fixed: the sky dome hangs over the MIDDLE of the
  // world (the origin is a map corner), and every camera's far plane reaches
  // past the dome from the farthest place a camera can be. Checked with a real
  // player camera too, because that is what a kid walking to the map edge uses.
  await joinWithPad(page);
  const sky = await page.evaluate(() => {
    const g = (window as any).__lbw.game;
    const d = (window as any).__lbw.dims;
    const group = g.scene.children.find((o: any) =>
      o.children?.some((c: any) => c.isMesh && (c.geometry?.parameters?.radius ?? 0) > 100));
    const dome = group.children.find((c: any) => c.isMesh && (c.geometry?.parameters?.radius ?? 0) > 100);
    const [cx, cy, cz] = [group.position.x, group.position.y, group.position.z];
    let farthestCam = 0;
    for (const x of [0, d.sx]) for (const y of [0, d.sy]) for (const z of [0, d.sz]) {
      farthestCam = Math.max(farthestCam, Math.hypot(x - cx, y - cy, z - cz));
    }
    const cams = [g.idleCamera, ...g.players.map((p: any) => p.camera)];
    return {
      centre: [cx, cy, cz], worldMiddle: [d.sx / 2, 0, d.sz / 2],
      radius: dome.geometry.parameters.radius,
      farthestPossibleDomeDistance: farthestCam + dome.geometry.parameters.radius,
      farPlanes: cams.map((c: any) => c.far),
    };
  });
  expect(sky.centre).toEqual(sky.worldMiddle);
  for (const far of sky.farPlanes) expect(sky.farthestPossibleDomeDistance).toBeLessThan(far);
});
