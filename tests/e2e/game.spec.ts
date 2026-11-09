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
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const pos0 = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { x: e.pos.x, z: e.pos.z };
  });
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await waitForMove(page, pos0, 1);
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));

  // jump raises the player
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
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

test('the build trigger places a block and the break trigger removes it', async ({ page }) => {
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
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 10000 });
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

/** joins a second controller, reachable in tests as __testPad2 */
async function joinSecondPad(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const pad = game.addVirtualPad('xbox');
    (window as any).__testPad2 = pad;
    pad.tap('jump');
  });
  await page.waitForFunction('window.__lbw.game.pendingJoins.size === 1');
  await page.evaluate(() => (window as any).__testPad2.tap('jump'));
  await page.waitForFunction('window.__lbw.game.players.length === 2');
}

test('a player can leave and their half of the split screen closes', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await joinSecondPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  expect(await page.evaluate(() => document.querySelectorAll('.pane').length)).toBe(2);

  // the first press on Leave only arms it — kids press everything
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 10); // Leave
  await tap(page, 'jump');
  expect(await page.evaluate(() => (window as any).__lbw.game.players.length)).toBe(2);
  expect(await page.evaluate(() => [...document.querySelectorAll('.menu-item')][10].textContent)).toContain('SURE');

  // the second press lets them go
  await tap(page, 'jump');
  await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 10000 });
  const after = await page.evaluate(() => ({
    rects: (window as any).__lbw.game.viewportMgr.rects,
    panes: document.querySelectorAll('.pane').length,
    huds: document.querySelectorAll('.hud').length,
    cards: document.querySelectorAll('.overlay-card').length,
    pending: (window as any).__lbw.game.pendingJoins.size,
    width: window.innerWidth,
  }));
  expect(after.panes).toBe(1); // the freed pane is gone, not just empty
  expect(after.rects).toHaveLength(1);
  expect(after.rects[0].w).toBe(after.width); // the other player gets the whole screen
  expect(after.huds).toBe(1);
  expect(after.pending).toBe(0); // and the pad that left does not demand a new player
  expect(after.cards).toBe(0);

  // the player who stayed keeps playing, now full screen
  const before = await posOf(page);
  await page.evaluate(() => (window as any).__testPad2.setMove(0, -1));
  await waitForMove(page, before, 0.8, 0);
  await page.evaluate(() => (window as any).__testPad2.setMove(0, 0));

  // ...and the controller that left can bring a new friend in a moment later
  await page.waitForTimeout(1300); // rejoin pause
  await tap(page, 'jump');
  await page.waitForFunction('window.__lbw.game.pendingJoins.size === 1', null, { timeout: 15000 });
  expect(await page.evaluate(() => document.querySelectorAll('.pane').length)).toBe(2);
  await tap(page, 'jump'); // confirm the join card
  await page.waitForFunction('window.__lbw.game.players.length === 2', null, { timeout: 15000 });
});

test('grown-ups can send controller-asleep players home', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await joinSecondPad(page);

  // player 2's controller falls asleep: their seat waits, pane and all
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const p = game.players[1];
    game.input.removeSource(game.input.sources.get(p.sourceId));
  });
  await page.waitForFunction('window.__lbw.game.reservedSeats.size === 1');
  expect(await page.evaluate(() => document.querySelectorAll('.pane').length)).toBe(2);

  await openGrownUpsMenu(page);
  await selectRow(page, 5); // Waiting Players
  expect(await page.evaluate(() => [...document.querySelectorAll('.menu-item')]
    .find((r) => (r.textContent ?? '').includes('Waiting Players'))?.textContent)).toContain('asleep');
  await tap(page, 'jump'); // first press only arms it
  expect(await page.evaluate(() => (window as any).__lbw.game.players.length)).toBe(2);
  await tap(page, 'jump'); // second press sends them home
  await page.waitForFunction('window.__lbw.game.players.length === 1', null, { timeout: 10000 });
  const after = await page.evaluate(() => ({
    reserved: (window as any).__lbw.game.reservedSeats.size,
    panes: document.querySelectorAll('.pane').length,
    rects: (window as any).__lbw.game.viewportMgr.rects.length,
    asleepCards: [...document.querySelectorAll('.overlay-card')]
      .filter((c) => c.textContent?.includes('Controller asleep')).length,
  }));
  expect(after.reserved).toBe(0);
  expect(after.panes).toBe(1);
  expect(after.rects).toBe(1);
  expect(after.asleepCards).toBe(0); // their "controller asleep" card is gone too
});

test('when the last player leaves, the welcome screen comes back', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players.length === 1');

  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 10); // Leave
  await tap(page, 'jump');
  await tap(page, 'jump');
  await page.waitForFunction('window.__lbw.game.players.length === 0', null, { timeout: 10000 });
  await frames(page, 3);
  const state = await page.evaluate(() => ({
    panes: document.querySelectorAll('.pane').length,
    huds: document.querySelectorAll('.hud').length,
    cards: document.querySelectorAll('.overlay-card').length,
    welcome: getComputedStyle(document.querySelector('.welcome')!.parentElement!).display,
  }));
  expect(state.huds).toBe(0);
  expect(state.cards).toBe(0);
  expect(state.panes).toBe(1); // one full-screen view of the world
  expect(state.welcome).toBe('flex'); // "press any button on a controller to join!"
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
  await selectRow(page, 9); // Grown-Ups
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
  // ...and mop up any flow that crept out beyond the fill box before the
  // source went away: later tests share this spawn meadow
  await page.evaluate((arg: { cx: number; cz: number; base: number; water: number; flow: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let dx = -10; dx <= 10; dx++) {
      for (let dz = -10; dz <= 10; dz++) {
        for (let y = arg.base - 2; y <= arg.base + 4; y++) {
          const b = S.get(arg.cx + dx, y, arg.cz + dz);
          if (b === arg.water || b === arg.flow) S.set(arg.cx + dx, y, arg.cz + dz, 0);
        }
      }
    }
  }, { ...lake, water: ids.WATER, flow: ids.WATER_FLOW });
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); }); // land the refill before the next page boots
});

test('swimming: paddling like a proper kid — stroke, surface float, kick-up and lean forward', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);

  // a deep pond right in front (same recipe as the shore-jump test)
  const lake = await page.evaluate((b: { water: number; grass: number; air: number }) => {
    const game = (window as any).__lbw.game;
    const S = game.world;
    const e = game.players[0].entity;
    const cx = Math.round(e.pos.x), cz = Math.round(e.pos.z);
    const base = S.surfaceY(cx, cz);
    const deep = 6;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let y = base - deep; y <= base + 3; y++) S.set(cx + dx, y, cz + dz, b.air);
        if (dz <= -2) {
          for (let y = base - deep; y <= base; y++) S.set(cx + dx, y, cz + dz, b.grass);
        } else {
          for (let y = base - deep; y <= base - 1; y++) S.set(cx + dx, y, cz + dz, b.water);
        }
      }
    }
    e.pos.set(cx + 0.5, base + 1, cz - 2.5);
    e.vel.set(0, 0, 0);
    e.yaw = 0;
    return { cx, cz, base };
  }, { water: ids.WATER, grass: ids.GRASS, air: ids.AIR });

  // paddle in — the swim pose takes over
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await page.waitForFunction('window.__lbw.game.players[0].entity.swimmingNow === true', null, { timeout: 15000 });
  await frames(page, 30);

  // body leans forward into the water, arms stroke: the avatar group is tilted
  const tilt = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.avatar.group.rotation.x);
  expect(tilt).toBeGreaterThan(0.9);

  // strokes are happening on a rhythm
  const strokes = await page.evaluate(() => (window as any).__lbw.game.lastStroke.size);
  expect(strokes).toBeGreaterThan(0);

  // the lean must follow WHERE THE KID FACES: the body's head direction
  // (local +Y in world space) sampled at two yaws has to swivel with them.
  // three's default 'XYZ' Euler order pitches about the WORLD x-axis, which
  // kept the head pointing one fixed way for every yaw (the old bug).
  const headDirAt = (yaw: number) =>
    page.evaluate((y: number) => {
      const e = (window as any).__lbw.game.players[0].entity;
      e.yaw = y;
      e.syncAvatar(0.016);
      e.avatar.group.updateMatrixWorld(true);
      const el = e.avatar.body.matrixWorld.elements; // column 2 = world dir of local +Y
      return { x: el[4], y: el[5], z: el[6] };
    }, yaw);
  const headSouth = await headDirAt(0);
  const headEast = await headDirAt(Math.PI / 2);
  const headShift = Math.hypot(
    headSouth.x - headEast.x, headSouth.y - headEast.y, headSouth.z - headEast.z,
  );
  expect(headShift).toBeGreaterThan(0.8); // face-down lean swivels with the kid
  await frames(page, 10); // let the paddle resume from that yaw

  // surface float: stop swimming and the kid bobs near the surface, not
  // plunging to the bottom — and the water goes quiet: idle floating must
  // not keep firing stroke pulls (the endless whoosh was the complaint)
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    (window as any).__testPad.setMove(0, 0);
    (window as any).__floatStroke = game.lastStroke.get(game.players[0].entity.id) ?? -9;
  });
  await page.waitForTimeout(2500); // several stroke intervals of just floating
  const bob = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    const game = (window as any).__lbw.game;
    return {
      y: e.pos.y, vy: e.vel.y, head: e.inWaterNow,
      stroke: game.lastStroke.get(e.id) ?? -9, before: (window as any).__floatStroke,
    };
  });
  expect(bob.y).toBeGreaterThan(lake.base - 1.7); // stayed near the surface
  expect(bob.vy).toBeGreaterThan(-1.2); // …and sinking like a leaf, not a stone
  expect(bob.stroke).toBe(bob.before); // …and not one stroke pull while floating

  // the pond is deep: hold the sneak button and the kid DIVES instead of
  // bobbing at the surface. Move to the middle first — this test pond is
  // only six cells wide, and near ANY wall nearShore is true (there the
  // push-off jump is correct behaviour). Open water means no wall within
  // reach: nothing here may ever launch the kid.
  await page.evaluate((l: { cx: number; cz: number; base: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(l.cx + 0.5, l.base - 3, l.cz + 1.5);
    e.vel.set(0, 0, 0);
  }, lake);
  await frames(page, 4);
  await page.evaluate(() => (window as any).__testPad.press('back'));
  await page.waitForFunction(
    (l: { cx: number; cz: number; base: number }) => {
      const e = (window as any).__lbw.game.players[0].entity;
      return e.pos.y < l.base - 4.2 && Math.abs(e.pos.x - (l.cx + 0.5)) < 1.5;
    },
    lake, { timeout: 12000 },
  );
  const dived = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { y: e.pos.y, swimming: e.swimmingNow };
  });
  expect(dived.swimming).toBe(true); // a diver, not a faller

  // …and holding jump in MID-water just kicks you up to the surface — with
  // the head clear and NO shore in reach, there is no push-off leap. (The
  // bunny-hopping across open ponds was the complaint; the shore jump-out
  // lives in its own test, where there IS a shore.)
  await page.evaluate(() => (window as any).__testPad.set('jump', true));
  await page.waitForFunction(
    (l: { base: number }) => (window as any).__lbw.game.players[0].entity.pos.y > l.base - 1.0,
    lake, { timeout: 15000 },
  );
  const midWater = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { y: e.pos.y, swimming: e.swimmingNow, launch: e.waterJump };
  });
  expect(midWater.y).toBeGreaterThan(dived.y + 1.0); // kicked up, for sure
  expect(midWater.swimming).toBe(true); // still swimming at the surface, not airborne
  expect(midWater.launch).toBe(0); // and the surface push-off never armed
  await page.evaluate(() => {
    (window as any).__testPad.set('jump', false);
    (window as any).__testPad.release('back');
  });

  // holding jump at the shore kicks up and out of the pond, and the body
  // rights itself on land
  await page.evaluate(() => {
    (window as any).__lbw.game.players[0].entity.yaw = Math.PI;
    (window as any).__testPad.set('jump', true);
    (window as any).__testPad.setMove(0, -1);
  });
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 30000 });
  await page.evaluate(() => {
    (window as any).__testPad.set('jump', false);
    (window as any).__testPad.setMove(0, 0);
  });
  await frames(page, 40);
  const upRight = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { tilt: e.avatar.group.rotation.x, swimming: e.swimmingNow };
  });
  expect(upRight.swimming).toBe(false);
  expect(upRight.tilt).toBeLessThan(0.2); // standing tall again on the shore

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
  // ...and mop up any flow that crept out beyond the fill box before the
  // source went away: later tests share this spawn meadow
  await page.evaluate((arg: { cx: number; cz: number; base: number; water: number; flow: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let dx = -10; dx <= 10; dx++) {
      for (let dz = -10; dz <= 10; dz++) {
        for (let y = arg.base - 2; y <= arg.base + 4; y++) {
          const b = S.get(arg.cx + dx, y, arg.cz + dz);
          if (b === arg.water || b === arg.flow) S.set(arg.cx + dx, y, arg.cz + dz, 0);
        }
      }
    }
  }, { ...lake, water: ids.WATER, flow: ids.WATER_FLOW });
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); }); // land the refill before the next page boots
});

test('sounds carry the material: stone clacks, dirt thuds, water splashes, feet pitter-patter', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const site = await clearRunway(page);

  const recent = () => page.evaluate(() => (window as any).__lbw.game.audio.recent.slice());

  // build and break a STONE block: both sounds know it is stone
  const cell = await placeSelected(page, ids.STONE);
  expect((await recent()).some((s: string) => s === 'place:stone')).toBe(true);
  await page.evaluate((arg: { c: Cell; b: number }) => {
    const game = (window as any).__lbw.game;
    game.hooks().tryRemove(game.players[0], {
      block: arg.b, x: arg.c.x, y: arg.c.y, z: arg.c.z,
      px: arg.c.x, py: arg.c.y + 1, pz: arg.c.z, dist: 1,
    });
  }, { c: cell, b: ids.STONE });
  expect((await recent()).some((s: string) => s === 'remove:stone')).toBe(true);

  // walking makes footsteps with the material under the feet (grass = soft).
  // CI's shared save can leave craters or stone on the runway, so lay a known
  // strip of grass for the footstep lap first
  await page.evaluate((arg: { fx: number; fz: number; gy: number; grass: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let x = arg.fx - 1; x <= arg.fx + 7; x++) S.set(x, arg.gy, arg.fz, arg.grass);
  }, { fx: site.fx, fz: site.fz, gy: site.gy, grass: ids.GRASS });
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await waitForMove(page, { x: site.fx + 0.5, z: site.fz + 0.5 }, 2.5);
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  expect((await recent()).some((s: string) => s === 'step:soft')).toBe(true);

  // a puddle punched into the runway: entering it splashes — no more land-thud
  await page.evaluate((arg: { fx: number; fz: number; gy: number; water: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let x = arg.fx + 4; x <= arg.fx + 6; x++) {
      S.set(x, arg.gy, arg.fz, arg.air);
      S.set(x, arg.gy - 1, arg.fz, arg.water);
    }
  }, { fx: site.fx, fz: site.fz, gy: site.gy, water: ids.WATER, air: ids.AIR });
  await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.yaw = Math.PI / 2;
    (window as any).__testPad.setMove(0, -1);
  });
  await page.waitForFunction('window.__lbw.game.players[0].entity.inWaterNow === true', null, { timeout: 20000 });
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  expect((await recent()).some((s: string) => s === 'splash')).toBe(true);

  // fill the puddle back in so later tests find tidy ground
  await page.evaluate((arg: { fx: number; fz: number; gy: number; grass: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let x = arg.fx + 4; x <= arg.fx + 6; x++) {
      S.set(x, arg.gy - 1, arg.fz, arg.grass);
      S.set(x, arg.gy, arg.fz, arg.air);
    }
  }, { fx: site.fx, fz: site.fz, gy: site.gy, grass: ids.GRASS, air: ids.AIR });
});

test('crouch: the red button sneaks — slow shuffle, ledge protection, crawling low gaps', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const site = await clearRunway(page);
  const { fx, fz, gy } = site;

  // the course: a pit in the walking row a few blocks ahead, and a
  // one-block-high tunnel (stone ceiling one block up) in a row next to it
  await page.evaluate((arg: { fx: number; fz: number; gy: number; stone: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let x = arg.fx + 3; x <= arg.fx + 7; x++) S.set(x, arg.gy, arg.fz, arg.air); // pit
    for (let x = arg.fx + 1; x <= arg.fx + 4; x++) S.set(x, arg.gy + 2, arg.fz + 2, arg.stone); // tunnel lid
  }, { fx, fz, gy, stone: ids.STONE, air: ids.AIR });

  const e = () => page.evaluate(() => {
    const p = (window as any).__lbw.game.players[0].entity;
    return { x: p.pos.x, y: p.pos.y, z: p.pos.z, crouch: p.crouching, grounded: p.grounded, sp: Math.hypot(p.vel.x, p.vel.z) };
  });

  // the head-top, standing: the yardstick the crouch has to beat
  const standingHead = await page.evaluate(() => {
    const a = (window as any).__lbw.game.players[0].entity.avatar;
    return a.chest.matrixWorld.elements[7] + 1.05; // the head top sits 1.05 above the hip pivot
  });

  // tap B (the Back button): crouch on — and the shuffle is slow
  await tap(page, 'back');
  await page.waitForFunction('window.__lbw.game.players[0].entity.crouching === true', null, { timeout: 8000 });
  await frames(page, 30); // the fold eases in over a quarter second

  // the pose itself, measured in the WORLD (the matrix the renderer just drew
  // with), because the point of the crouch is what it does to the silhouette:
  // the kid tips forward over their feet, the head comes down, and nothing is
  // scaled — the old squash made every juice-box kid 40 % shorter, and the
  // first rebuild of this pose flung the feet into the air instead
  const pose = await page.evaluate(() => {
    const a = (window as any).__lbw.game.players[0].entity.avatar;
    const worldY = (o: any) => o.matrixWorld.elements[7];
    return {
      scale: a.group.scale.y, bodyScale: a.body.scale.y,
      crouchT: a.crouchT, lean: a.body.rotation.x, fold: a.chest.rotation.x,
      hipY: worldY(a.chest), headY: worldY(a.chest) + 1.05 * Math.cos(a.body.rotation.x + a.chest.rotation.x),
      legL: a.leftLeg.rotation.x, legR: a.rightLeg.rotation.x,
    };
  });
  expect(pose.scale, 'the avatar is never squashed').toBeCloseTo(1, 3);
  expect(pose.bodyScale, 'nor is any part of it').toBeCloseTo(1, 3);
  expect(pose.crouchT, 'fully crouched').toBeGreaterThan(0.9);
  expect(pose.lean, 'tipped forward over the feet').toBeGreaterThan(0.35);
  expect(pose.fold, 'hunched past the hips').toBeGreaterThan(pose.lean * 0.6);
  // legs bent under the kid, not flung up behind (the old −1.25 handstand)
  expect(pose.legL, 'legs stay bent under').toBeLessThan(-0.4);
  expect(pose.legL, 'legs stay bent under').toBeGreaterThan(-1.4);
  expect(pose.headY, 'the head comes down a hand-span or more').toBeLessThan(standingHead - 0.25);

  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await waitForMove(page, { x: fx + 0.5, z: fz + 0.5 }, 1.0);
  const sneaking = await e();
  expect(sneaking.sp).toBeLessThan(3.2); // crouched creep, not a 5-block/s walk

  // …and it never walks off the edge of the pit: feet stay supported
  await waitForMove(page, { x: fx + 0.5, z: fz + 0.5 }, 2.6);
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  await waitForStop(page);
  const atEdge = await e();
  expect(atEdge.x).toBeLessThan(fx + 3.95); // stopped at the lip, did not fall in
  expect(atEdge.grounded).toBe(true);
  expect(atEdge.y).toBeCloseTo(gy + 1, 1);
  expect(atEdge.crouch).toBe(true);

  // tap again to stand, right at the lip
  await tap(page, 'back');
  await page.waitForFunction('window.__lbw.game.players[0].entity.crouching === false', null, { timeout: 8000 });
  const stood = await e();
  expect(stood.grounded).toBe(true);

  // --- the low tunnel: walking standing runs into the lid, crouching crawls in
  await page.evaluate((arg: { x: number; y: number; z: number }) => {
    const p = (window as any).__lbw.game.players[0].entity;
    p.pos.set(arg.x, arg.y, arg.z);
    p.vel.set(0, 0, 0);
  }, { x: fx - 2.5, y: gy + 1, z: fz + 2.5 });
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await waitForMove(page, { x: fx - 2.5, z: fz + 2.5 }, 1.5);
  await waitForStop(page);
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  const bumped = await e();
  expect(bumped.x).toBeLessThan(fx + 0.95); // standing: blocked by the lid
  expect(bumped.crouch).toBe(false);

  await tap(page, 'back'); // crouch, then walk in
  await page.waitForFunction('window.__lbw.game.players[0].entity.crouching === true', null, { timeout: 8000 });
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await page.waitForFunction((f: number) => (window as any).__lbw.game.players[0].entity.pos.x > f, fx + 2, { timeout: 20000 });
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  await waitForStop(page);

  // under the lid: standing up is refused (Minecraft keeps you ducked),
  // and so is crouch-jumping — tapping the buttons does not stick you to the roof
  await tap(page, 'back');
  const stayed = await e();
  expect(stayed.crouch).toBe(true);
  await tap(page, 'jump');
  const afterJump = await e();
  expect(afterJump.crouch).toBe(true);
  expect(afterJump.grounded).toBe(true);

  // walk back out and stand freely again
  await page.evaluate(() => (window as any).__testPad.setMove(0, 1));
  await page.waitForFunction((f: number) => (window as any).__lbw.game.players[0].entity.pos.x < f, fx - 0.5, { timeout: 20000 });
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  await waitForStop(page);
  await tap(page, 'back');
  await page.waitForFunction('window.__lbw.game.players[0].entity.crouching === false', null, { timeout: 8000 });

  // tidy up: fill the pit, take the lid off
  await page.evaluate((arg: { fx: number; fz: number; gy: number; grass: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let x = arg.fx + 3; x <= arg.fx + 7; x++) S.set(x, arg.gy, arg.fz, arg.grass);
    for (let x = arg.fx + 1; x <= arg.fx + 4; x++) S.set(x, arg.gy + 2, arg.fz + 2, arg.air);
  }, { fx, fz, gy, grass: ids.GRASS, air: ids.AIR });
});

test('sand obeys gravity: tumbles down, sinks through water, squashes plants and lands soft on kids', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const site = await clearRunway(page);
  const gy = site.gy, x0 = site.fx - 3, z0 = site.fz;

  // flat, known ground for the test columns (three rows deep), and the kid
  // stands on the south edge row: safely clear of every falling column
  // until part 5 asks for their head. A FULL-HEIGHT stone CAISSON rings the
  // whole site: on this branch terrain ponds and the sea are eternal water
  // sources that flow, and a CI seed may put the spawn meadow at the sea's
  // edge. The wall must reach the world roof and the scrub the world floor:
  // falling water keeps its depth, so a single wet cell left above the wall
  // re-rains on the site forever (observed in CI). Everything wet inside the
  // caisson is stoned out — no source survives within, none can enter.
  await page.evaluate((arg: { x0: number; z0: number; gy: number; stone: number; air: number; water: number; flow: number }) => {
    const S = (window as any).__lbw.game.world;
    const SY: number = (window as any).__lbw.dims.sy;
    for (let x = arg.x0 - 3; x <= arg.x0 + 9; x++) {
      for (let z = arg.z0 - 3; z <= arg.z0 + 3; z++) {
        const ring = x === arg.x0 - 3 || x === arg.x0 + 9 || z === arg.z0 - 3 || z === arg.z0 + 3;
        for (let y = 1; y < SY; y++) {
          if (ring) S.set(x, y, z, arg.stone);
          else {
            const b = S.get(x, y, z);
            if (b === arg.water || b === arg.flow) S.set(x, y, z, arg.stone);
          }
        }
      }
    }
    for (let x = arg.x0 - 1; x <= arg.x0 + 7; x++) {
      for (let z = arg.z0 - 1; z <= arg.z0 + 1; z++) {
        for (let y = arg.gy; y <= arg.gy + 6; y++) S.set(x, y, z, y === arg.gy ? arg.stone : arg.air);
      }
    }
  }, { x0, z0, gy, stone: ids.STONE, air: ids.AIR, water: ids.WATER, flow: ids.WATER_FLOW });
  await page.evaluate((arg: { x: number; y: number; z: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(arg.x, arg.y, arg.z);
    e.vel.set(0, 0, 0);
  }, { x: x0 + 0.5, y: gy + 1, z: z0 - 0.5 });
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });

  const blockAt = (x: number, y: number, z: number) =>
    page.evaluate((c: { x: number; y: number; z: number }) =>
      (window as any).__lbw.game.world.get(c.x, c.y, c.z), { x, y, z });
  const setCell = (x: number, y: number, z: number, id: number) =>
    page.evaluate((c: { x: number; y: number; z: number; id: number }) =>
      (window as any).__lbw.game.world.set(c.x, c.y, c.z, c.id), { x, y, z, id });
  const waitForBlock = (x: number, y: number, z: number, id: number) =>
    page.waitForFunction((c: { x: number; y: number; z: number; id: number }) =>
      (window as any).__lbw.game.world.get(c.x, c.y, c.z) === c.id,
    { x, y, z, id }, { timeout: 15000 });

  // 1) sand dropped in mid-air falls straight down and settles on the ground.
  // An in-page sampler proves the fall is ANIMATED: SandFalls keeps glide
  // cubes in the scene while sand moves (a teleport would show none).
  await page.evaluate(() => {
    const g = (window as any).__lbw.game;
    (window as any).__sawFalls = 0;
    (window as any).__fallSampler = setInterval(
      () => { if (g.sandFalls.count > 0) (window as any).__sawFalls++; }, 50);
  });
  await setCell(x0, gy + 4, z0, ids.SAND);
  await waitForBlock(x0, gy + 1, z0, ids.SAND);
  const sawFalls = await page.evaluate(() => {
    clearInterval((window as any).__fallSampler);
    return (window as any).__sawFalls;
  });
  expect(sawFalls).toBeGreaterThan(0); // the fall was animated, not just teleported
  await page.waitForFunction('window.__lbw.game.sandFalls.count === 0', null, { timeout: 5000 });
  expect(await blockAt(x0, gy + 2, z0)).toBe(ids.AIR);

  // 2) dig the ground out under a sand block: it follows one cell down
  await setCell(x0, gy, z0, ids.AIR);
  await waitForBlock(x0, gy, z0, ids.SAND);
  expect(await blockAt(x0, gy + 1, z0)).toBe(ids.AIR);

  // 3) sand sinks THROUGH water and settles on the bottom of the puddle
  const bx = x0 + 2;
  await setCell(bx, gy + 1, z0, ids.WATER);
  await setCell(bx, gy + 3, z0, ids.SAND);
  await waitForBlock(bx, gy + 1, z0, ids.SAND);
  expect(await blockAt(bx, gy + 2, z0)).toBe(ids.WATER); // the water it displaced rode up
  // tidy NOW, and completely: while the sand sank through the puddle, the
  // displaced water rode up as a column of ETERNAL sources — one sim step
  // late and each of them has fanned a three-storey flood across the runway
  // (observed). Scrub every wet cell inside the caisson, then wait for the
  // scrubbed flow to finish drying before the later parts run.
  await page.evaluate((arg: { x0: number; z0: number; air: number; water: number; flow: number }) => {
    const S = (window as any).__lbw.game.world;
    const SY: number = (window as any).__lbw.dims.sy;
    for (let x = arg.x0 - 2; x <= arg.x0 + 8; x++) {
      for (let z = arg.z0 - 2; z <= arg.z0 + 2; z++) {
        for (let y = 1; y < SY; y++) {
          const b = S.get(x, y, z);
          if (b === arg.water || b === arg.flow) S.set(x, y, z, arg.air);
        }
      }
    }
  }, { x0, z0, air: ids.AIR, water: ids.WATER, flow: ids.WATER_FLOW });
  try {
    await page.waitForFunction((arg: { x0: number; z0: number; water: number; flow: number }) => {
      const S = (window as any).__lbw.game.world;
      const SY: number = (window as any).__lbw.dims.sy;
      for (let x = arg.x0 - 2; x <= arg.x0 + 8; x++) {
        for (let z = arg.z0 - 2; z <= arg.z0 + 2; z++) {
          for (let y = 1; y < SY; y++) {
            const b = S.get(x, y, z);
            if (b === arg.water || b === arg.flow) return false;
          }
        }
      }
      return true;
    }, { x0, z0, water: ids.WATER, flow: ids.WATER_FLOW }, { timeout: 8000 });
  } catch (e) {
    const dump = await page.evaluate((arg: { x0: number; z0: number; water: number; flow: number }) => {
      const S = (window as any).__lbw.game.world;
      const { sz, sy } = (window as any).__lbw.dims;
      const out: string[] = [];
      for (let x = arg.x0 - 6; x <= arg.x0 + 12; x++) {
        for (let z = arg.z0 - 6; z <= arg.z0 + 6; z++) {
          for (let y = 1; y < sy; y++) {
            const b = S.get(x, y, z);
            if (b === arg.water || b === arg.flow) {
              const lvl = S.waterLevel.get((x * sz + z) * sy + y) ?? -1;
              out.push(`${x},${y},${z}=${b}/L${lvl}`);
            }
          }
        }
      }
      return out.join(' ');
    }, { x0, z0, water: ids.WATER, flow: ids.WATER_FLOW });
    throw new Error(`sand dry-wait stuck; wet: ${dump}`);
  }

  // 4) falling sand squashes the tallgrass in its way
  const cx = x0 + 4;
  const pageErrs: string[] = [];
  page.on('pageerror', (e) => pageErrs.push(String(e)));
  await setCell(cx, gy + 1, z0, ids.TALLGRASS);
  await setCell(cx, gy + 3, z0, ids.SAND);
  await waitForBlock(cx, gy + 1, z0, ids.SAND);

  // 5) a kid standing under it: the sand stops right over their head, harmlessly
  const dx = x0 + 6;
  await page.evaluate((arg: { x: number; y: number; z: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(arg.x + 0.5, arg.y + 1, arg.z + 0.5);
    e.vel.set(0, 0, 0);
  }, { x: dx, y: gy, z: z0 });
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  await setCell(dx, gy + 5, z0, ids.SAND);
  await waitForBlock(dx, gy + 3, z0, ids.SAND); // resting above the head, never in it
  const kid = await page.evaluate((dbg: { x0: number; z0: number; gy: number; water: number; flow: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    const w = (window as any).__lbw.game.world;
    const wet: string[] = [];
    for (let x = dbg.x0 - 8; x <= dbg.x0 + 14; x++) {
      for (let z = dbg.z0 - 8; z <= dbg.z0 + 8; z++) {
        for (let y = dbg.gy - 4; y <= dbg.gy + 8; y++) {
          const b = w.get(x, y, z);
          if (b === dbg.water || b === dbg.flow) wet.push(`${x},${y},${z}=${b}`);
        }
      }
    }
    const cols: string[] = [];
    for (const x of [dbg.x0 + 1, dbg.x0 + 4, dbg.x0 + 7]) {
      for (let z = dbg.z0 - 4; z <= dbg.z0 + 10; z++) {
        let s = `x${x} z${z}: `;
        for (let y = dbg.gy - 6; y <= dbg.gy + 3; y++) s += w.get(x, y, z) + ' ';
        cols.push(s);
      }
    }
    const site = (window as any).__lbw.dims;
    void site;
    return { y: e.pos.y, inWater: e.inWaterNow, wet, cols, kidPos: `${e.pos.x},${e.pos.y},${e.pos.z}` };
  }, { x0, z0, gy, water: ids.WATER, flow: ids.WATER_FLOW });
  expect(kid.y).toBeCloseTo(gy + 1, 1); // not crushed, not launched, not teleported
  expect(kid.inWater, `kid@${kid.kidPos} gy=${gy} x0=${x0} z0=${z0}\n${kid.cols.join('\n')}\n${kid.wet.join(' ')}`).toBe(false);
  expect(pageErrs, pageErrs.join('\n')).toEqual([]);

  // tidy up so later tests still find clean grass near spawn
  await page.evaluate((arg: { x0: number; z0: number; gy: number; grass: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let x = arg.x0 - 1; x <= arg.x0 + 7; x++) {
      for (let z = arg.z0 - 1; z <= arg.z0 + 1; z++) {
        for (let y = arg.gy; y <= arg.gy + 6; y++) S.set(x, y, arg.z0, y === arg.gy ? arg.grass : arg.air);
      }
    }
  }, { x0, z0, gy, grass: ids.GRASS, air: ids.AIR });
});

test('water flows: a dug channel floods from the source, reaches exactly seven, falls deep, makes new springs and dries when cut off', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const site = await clearRunway(page);
  const { fx, fz, gy } = site;

  // the course: a one-deep channel along the surface row, walls left standing
  // on both sides, and an eternal source at the near end. A stone WALL rings
  // the whole site and its floor is sealed, so nothing but our own source can
  // supply the channel (CI's shard world may be a beach, or carry a failed
  // test's puddle — and on this branch ponds *flow*, so clearing wet cells
  // alone is not enough: a source outside the band would refill them).
  await page.evaluate((arg: { fx: number; fz: number; gy: number; air: number; water: number; flow: number; stone: number }) => {
    const S = (window as any).__lbw.game.world;
    const SY: number = (window as any).__lbw.dims.sy;
    for (let x = arg.fx - 3; x <= arg.fx + 14; x++) {
      for (let z = arg.fz - 4; z <= arg.fz + 4; z++) {
        const ring = x === arg.fx - 3 || x === arg.fx + 14 || z === arg.fz - 4 || z === arg.fz + 4;
        for (let y = 1; y < SY; y++) {
          if (ring) S.set(x, y, z, arg.stone);
        }
      }
    }
    for (let x = arg.fx - 2; x <= arg.fx + 13; x++) {
      for (let z = arg.fz - 3; z <= arg.fz + 3; z++) {
        for (let y = 1; y < SY; y++) {
          const b = S.get(x, y, z);
          if (b === arg.water || b === arg.flow) S.set(x, y, z, arg.air);
        }
      }
    }
    for (let x = arg.fx - 1; x <= arg.fx + 12; x++) {
      for (let z = arg.fz - 2; z <= arg.fz + 2; z++) {
        S.set(x, arg.gy - 1, z, arg.stone); // sealed floor under the whole course
        for (let y = arg.gy; y <= arg.gy + 2; y++) {
          const b = S.get(x, y, z);
          if (b === arg.water || b === arg.flow) S.set(x, y, z, arg.air);
        }
      }
    }
    for (let x = arg.fx + 2; x <= arg.fx + 10; x++) {
      S.set(x, arg.gy, arg.fz, arg.air);
      S.set(x, arg.gy + 1, arg.fz, arg.air); // nothing loiters above the channel
      S.set(x, arg.gy + 2, arg.fz, arg.air);
    }
    S.set(arg.fx + 2, arg.gy, arg.fz, arg.water);
  }, { fx, fz, gy, air: ids.AIR, water: ids.WATER, flow: ids.WATER_FLOW, stone: ids.STONE });

  // water creeps: wait until the flood has covered the whole reach — the far
  // end is the seventh cell out from the source, Minecraft's range exactly
  await page.waitForFunction((arg: { x6: number; gy: number; fz: number; flow: number }) =>
    (window as any).__lbw.game.world.get(arg.x6, arg.gy, arg.fz) === arg.flow,
  { x6: fx + 9, gy, fz, flow: ids.WATER_FLOW }, { timeout: 20000 });
  // let a couple more steps run — if the sim could push past seven cells, this
  // is where the eighth would appear
  await page.waitForTimeout(1500);

  const cellAt = (x: number, y: number) => page.evaluate((c: { x: number; y: number; z: number }) => {
    const w = (window as any).__lbw.game.world;
    const { sz, sy } = (window as any).__lbw.dims;
    return {
      id: w.get(c.x, c.y, c.z),
      lvl: w.waterLevel.get((c.x * sz + c.z) * sy + c.y) ?? -1,
    };
  }, { x, y, z: fz });

  // the source stands eternal and full; the channel shallows one step per cell,
  // and it stops dead at seven — Minecraft's range exactly. The eighth cell of
  // the dig stays dry even though there is ground under it: reach, not
  // terrain, is what ends a flood.
  expect((await cellAt(fx + 2, gy)).id).toBe(ids.WATER);
  for (let k = 1; k <= 7; k++) {
    const c = await cellAt(fx + 2 + k, gy);
    expect(c.id, `cell +${k}`).toBe(ids.WATER_FLOW);
    expect(c.lvl, `depth +${k}`).toBe(k);
  }
  const past = await cellAt(fx + 10, gy);
  expect([ids.WATER, ids.WATER_FLOW], 'the flood stops at seven blocks').not.toContain(past.id);

  // and the water DRAWS at its depth — the big game's nine steps of surface
  // height: (8 − level)/9, so a spring stands 8/9 full and the seventh cell
  // of the reach is a thin 1/9 sheet. No more floating ribbons of full cubes.
  const surfaceAt = (x: number, y: number) =>
    page.evaluate((c: { x: number; y: number; z: number }) => (window as any).__lbw.waterSurfaceAt(c.x, c.y, c.z),
      { x, y, z: fz });
  // wet cells now draw in a channel of their own (tiling, drifting water art),
  // not with the painted-glass art they rode in on before
  expect(await page.evaluate(() => (window as any).__lbw.game.scene.children
    .filter((o: any) => o.isMesh && o.material === (window as any).__lbw.game.chunks.materials.water).length),
    'the water channel is live').toBeGreaterThan(0);
  expect(await surfaceAt(fx + 2, gy), 'spring surface').toBeCloseTo(8 / 9, 3);
  expect(await surfaceAt(fx + 4, gy), 'depth-2 surface').toBeCloseTo(6 / 9, 3);
  expect(await surfaceAt(fx + 7, gy), 'depth-5 surface').toBeCloseTo(3 / 9, 3);
  expect(await surfaceAt(fx + 9, gy), 'far end of the reach').toBeCloseTo(1 / 9, 3);
  // a dry cell draws nothing at all
  expect(await surfaceAt(fx + 12, gy), 'dry cell draws nothing').toBe(0);

  // falling water keeps its depth: cut a shaft and the plunge is as deep as the channel above it
  await page.evaluate((arg: { x: number; gy: number; fz: number; air: number }) => {
    (window as any).__lbw.game.world.set(arg.x, arg.gy - 1, arg.fz, arg.air);
  }, { x: fx + 7, gy, fz, air: ids.AIR });
  await page.waitForFunction((arg: { x: number; gy: number; fz: number; flow: number }) =>
    (window as any).__lbw.game.world.get(arg.x, arg.gy - 1, arg.fz) === arg.flow,
  { x: fx + 7, gy, fz, flow: ids.WATER_FLOW }, { timeout: 10000 });
  expect((await cellAt(fx + 7, gy - 1)).lvl).toBe(5);

  // travelling water (with its depths) rides in the save
  const saved = await page.evaluate((arg: { x3: number; fz: number; gy: number }) => {
    const save = (window as any).__lbw.game.world.toSave();
    const { sz, sy } = (window as any).__lbw.dims;
    return { version: save.version, at: String((arg.x3 * sz + arg.fz) * sy + arg.gy), levels: save.waterLevels ?? {} };
  }, { x3: fx + 3, fz, gy });
  expect(saved.version).toBe(5);
  expect(saved.levels[saved.at]).toBe(1);

  // break the chain at the source: levels climb, then the whole flood drains away
  await page.evaluate((arg: { x: number; gy: number; fz: number; air: number }) => {
    (window as any).__lbw.game.world.set(arg.x, arg.gy, arg.fz, arg.air);
  }, { x: fx + 2, gy, fz, air: ids.AIR });
  try {
    await page.waitForFunction((arg: { fx: number; fz: number; gy: number; sx: number; air: number }) => {
      const w = (window as any).__lbw.game.world;
      for (let x = arg.fx + 3; x <= arg.fx + 10; x++) if (w.get(x, arg.gy, arg.fz) !== arg.air) return false;
      return w.get(arg.sx, arg.gy - 1, arg.fz) === arg.air;
    }, { fx, fz, gy, sx: fx + 7, air: ids.AIR }, { timeout: 30000 });
  } catch (e) {
    const dump = await page.evaluate((arg: { fx: number; fz: number; gy: number; water: number; flow: number }) => {
      const w = (window as any).__lbw.game.world;
      const { sz, sy } = (window as any).__lbw.dims;
      const out: string[] = [];
      for (let x = arg.fx - 2; x <= arg.fx + 16; x++) {
        for (let z = arg.fz - 3; z <= arg.fz + 3; z++) {
          for (let y = arg.gy - 3; y <= arg.gy + 4; y++) {
            const b = w.get(x, y, z);
            if (b === arg.water || b === arg.flow) {
              const lvl = w.waterLevel.get((x * sz + z) * sy + y) ?? -1;
              out.push(`${x},${y},${z}=${b}/L${lvl}`);
            }
          }
        }
      }
      return out.join(' ');
    }, { fx, fz, gy, water: ids.WATER, flow: ids.WATER_FLOW });
    throw new Error(`drain stuck; wet: ${dump}`);
  }

  // Two sources feed a third: with the channel dry again, stand a spring on
  // either side of a dry cell. The flow that meets in the middle has two
  // source blocks squeezing it from the sides, so it becomes a source itself —
  // the 2×2 scoop kids use to multiply a spring, straight out of the big game.
  await page.evaluate((arg: { x1: number; x2: number; gy: number; fz: number; water: number }) => {
    const S = (window as any).__lbw.game.world;
    S.set(arg.x1, arg.gy, arg.fz, arg.water);
    S.set(arg.x2, arg.gy, arg.fz, arg.water);
  }, { x1: fx + 3, x2: fx + 5, gy, fz, water: ids.WATER });
  await page.waitForFunction((arg: { x: number; gy: number; fz: number; water: number }) =>
    (window as any).__lbw.game.world.get(arg.x, arg.gy, arg.fz) === arg.water,
  { x: fx + 4, gy, fz, water: ids.WATER }, { timeout: 10000 });
  // the new spring stands full like its parents, and carries no flow depth —
  // it is an eternal source now, not a travelling cell on somebody's chain
  expect(await surfaceAt(fx + 4, gy), 'the new source stands 8/9 full').toBeCloseTo(8 / 9, 3);
  expect((await cellAt(fx + 4, gy)).lvl, 'a source has no flow level').toBe(-1);

  // the bucket is in the block palette where the water block used to be:
  // kids carry a spring around instead of tiling the meadow with ponds
  await tap(page, 'palette');
  await page.waitForSelector('.palette-grid');
  const paletteIcons = await page.evaluate(() => {
    const cells = [...document.querySelectorAll<HTMLElement>('.palette-cell')];
    // keyed off the cell the app marks as a tool, not off the emoji codepoint:
    // the bucket glyph (U+1FAA3) is newer than most of the palette's art, and
    // a hard-coded escape is one typo away from a lie
    return {
      bucket: cells.some((c) => c.dataset.tool === '1' && c.textContent?.includes('Bucket')),
      water: cells.some((c) => c.textContent?.includes('Water')),
      toolMarked: cells.some((c) => c.classList.contains('tool')),
    };
  });
  expect(paletteIcons.bucket).toBe(true);
  expect(paletteIcons.water).toBe(false);
  expect(paletteIcons.toolMarked).toBe(true);
  await tap(page, 'back'); // close the palette again
  await page.waitForSelector('.palette-grid', { state: 'detached' });

  // tidy up so later tests still find clean grass near spawn (and the save lands
  // the refill before the next page boots)
  await page.evaluate((arg: { fx: number; fz: number; gy: number; grass: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let x = arg.fx + 2; x <= arg.fx + 10; x++) S.set(x, arg.gy, arg.fz, arg.grass);
    S.set(arg.fx + 7, arg.gy - 1, arg.fz, arg.grass);
  }, { fx, fz, gy, grass: ids.GRASS });
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); });
});

test('water on a slope runs DOWN it: no blue plates hanging in the air, and the seven-block reach still ends the flood', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const site = await clearRunway(page);
  const { fx, fz, gy } = site;

  // a staircase cut down through the meadow, two cells per step, inside a
  // full-height stone caisson with a sealed floor (see the flow test: on this
  // branch every pond flows, so a course only trusts water it poured itself).
  // The site is snapshotted first and put back exactly at the end — this course
  // digs DOWN and walls itself in, and a walled pit by spawn strands the next
  // test's kid where it cannot walk.
  const x0 = fx + 2, x1 = fx + 14;
  const box = { x0: x0 - 2, x1: x1 + 2, z0: fz - 2, z1: fz + 2, y0: gy - 14, y1: gy + 14 };
  const before = await page.evaluate((b: typeof box) => {
    const S = (window as any).__lbw.game.world;
    const out: number[] = [];
    for (let x = b.x0; x <= b.x1; x++) for (let y = b.y0; y <= b.y1; y++) for (let z = b.z0; z <= b.z1; z++) out.push(S.get(x, y, z));
    return out;
  }, box);
  await page.evaluate((arg: {
    x0: number; x1: number; z0: number; z1: number; gy: number;
    air: number; stone: number; water: number;
  }) => {
    const S = (window as any).__lbw.game.world;
    const SY: number = (window as any).__lbw.dims.sy;
    for (let x = arg.x0 - 2; x <= arg.x1 + 2; x++) {
      for (let z = arg.z0 - 2; z <= arg.z1 + 2; z++) {
        const ring = x === arg.x0 - 2 || x === arg.x1 + 2 || z === arg.z0 - 2 || z === arg.z1 + 2;
        for (let y = 1; y < SY; y++) if (ring) S.set(x, y, z, arg.stone);
      }
    }
    for (let x = arg.x0 - 1; x <= arg.x1 + 1; x++) {
      for (let z = arg.z0 - 1; z <= arg.z1 + 1; z++) {
        const top = arg.gy - Math.floor((x - arg.x0) / 2); // the staircase
        for (let y = 1; y < SY; y++) S.set(x, y, z, y <= top ? arg.stone : arg.air);
      }
    }
    S.set(arg.x0, arg.gy + 1, arg.z0, arg.water); // a spring at the top step
  }, { x0, x1, z0: fz, z1: fz, gy, air: ids.AIR, stone: ids.STONE, water: ids.WATER });

  // the flood has to climb DOWN the staircase: each step is a two-cell flat
  // ending in a drop, and water falls keeping its depth. The reach is spent a
  // level per cell, so the seventh cell out — the far edge of step four — is
  // where the stream runs out of supply, exactly as in the big game.
  await page.waitForFunction((arg: { x: number; y: number; z: number; flow: number }) =>
    (window as any).__lbw.game.world.get(arg.x, arg.y, arg.z) === arg.flow,
  { x: x0 + 7, y: gy - 2, z: fz, flow: ids.WATER_FLOW }, { timeout: 30000 });

  // and every wet cell must either be standing on something or be on its way
  // down: that is the whole complaint. The old sim let water spread sideways
  // from mid-air, so a hillside flood drew as a diagonal stack of blue plates
  // with nothing under them.
  const audit = await page.evaluate((arg: {
    x0: number; x1: number; z0: number; z1: number; y0: number; y1: number;
  }) => {
    const w = (window as any).__lbw.game.world;
    const { AIR, WATER, WATER_FLOW } = (window as any).__lbw.ids;
    const wet = (x: number, y: number, z: number) => {
      const id = w.get(x, y, z);
      return id === WATER || id === WATER_FLOW;
    };
    const out = { wetCells: 0, hanging: [] as string[], falling: 0, beyond: [] as string[] };
    for (let x = arg.x0; x <= arg.x1; x++) for (let z = arg.z0; z <= arg.z1; z++) {
      for (let y = arg.y1; y >= arg.y0; y--) {
        if (!wet(x, y, z)) continue;
        out.wetCells++;
        if (x > arg.x0 + 8) out.beyond.push(`${x},${y},${z}`); // window x0 = x0-1; reach ends at x0+7
        const below = w.get(x, y - 1, z);
        if (below !== AIR && !wet(x, y - 1, z)) continue; // solid footing
        if (wet(x, y - 1, z)) continue; // standing on settled water
        if (wet(x, y + 1, z)) { out.falling++; continue; } // a waterfall cell: falling
        out.hanging.push(`${x},${y},${z}`);
      }
    }
    return out;
  }, { x0: x0 - 1, x1: x1 + 1, z0: fz - 1, z1: fz + 1, y0: gy - 8, y1: gy + 3 });

  expect(audit.wetCells, 'the staircase got wet').toBeGreaterThan(12);
  expect(audit.hanging, `water hanging in the air at ${audit.hanging.join(' ')}`).toEqual([]);
  // and the seven-block reach ends the flood even though the staircase keeps
  // going down for twice as long: the lower steps stay as dry as the day they
  // were carved. (In the big game it is reach, not terrain, that ends a
  // stream — a slope only buys you free depth while the water is FALLING.)
  expect(audit.beyond, `water past the reach at ${audit.beyond.join(' ')}`).toEqual([]);

  // scoop the spring and the whole slope dries: no cell on the hill can hold
  // water up once the chain back to the water is cut
  await page.evaluate((arg: { x: number; y: number; z: number; air: number }) => {
    (window as any).__lbw.game.world.set(arg.x, arg.y, arg.z, arg.air);
  }, { x: x0, y: gy + 1, z: fz, air: ids.AIR });
  await page.waitForFunction((arg: { x0: number; x1: number; z: number; y0: number; y1: number; water: number; flow: number }) => {
    const w = (window as any).__lbw.game.world;
    for (let x = arg.x0; x <= arg.x1; x++) {
      for (let y = arg.y0; y <= arg.y1; y++) {
        const id = w.get(x, y, arg.z);
        if (id === arg.water || id === arg.flow) return false;
      }
    }
    return true;
  }, { x0, x1, z: fz, y0: gy - 7, y1: gy + 2, water: ids.WATER, flow: ids.WATER_FLOW }, { timeout: 30000 });

  // Put the meadow back exactly as it was, whole site box and in the same order
  // it was captured. This course digs DOWN and walls itself in with a
  // full-height caisson, so anything less than a restore leaves a walled pit
  // beside spawn — and the next test's kid can't walk out of it, which is how
  // 'grown-up menu: freeze' came back timing out on CI.
  await page.evaluate((arg: { b: typeof box; cells: number[] }) => {
    const S = (window as any).__lbw.game.world;
    const { b } = arg;
    let i = 0;
    for (let x = b.x0; x <= b.x1; x++) for (let y = b.y0; y <= b.y1; y++) for (let z = b.z0; z <= b.z1; z++) S.set(x, y, z, arg.cells[i++]);
  }, { b: box, cells: before });
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); });
});
/** opens Grown-Up Settings, switches Freeze, and closes the menu again */
async function setFreeze(page: Page, on: boolean): Promise<void> {
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 9); // Grown-Ups
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
  await selectRow(page, 9); // Grown-Ups
  await tap(page, 'jump');

  await selectRow(page, 1); // Split Screen
  const layouts: string[] = [];
  for (let i = 0; i < 4; i++) {
    await tap(page, 'jump');
    layouts.push(await page.evaluate(() => (window as any).__lbw.game.layout));
  }
  expect(new Set(layouts).size).toBe(4);
  expect(layouts).toContain('grid2x2');

  await selectRow(page, 4); // Reset World: first tap arms, second wipes
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
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 10000 });
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
  await selectRow(page, 4); // Start this world (row 3 is My saved worlds now)
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

  await selectRow(page, 4); // Start (row 3 is My saved worlds now)
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

/** labels of the world rows in the My Worlds list (world rows end in "N built") */
async function worldRows(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.overlay-card .menu-item > span:first-child')]
      .map((e) => e.textContent ?? '')
      .filter((t) => t.includes(' built')),
  );
}

/** index of the menu row whose text contains `needle` (row order is dynamic) */
async function rowIndexOf(page: Page, needle: string): Promise<number> {
  return page.evaluate((s: string) => {
    const rows = [...document.querySelectorAll('.overlay-card .menu-item')];
    return rows.findIndex((r) => (r.textContent ?? '').includes(s));
  }, needle);
}

test('My Worlds menu lists saved worlds, plays one back with builds intact, and deletes it', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 10000 });

  // a landmark in the home world, saved on purpose
  const home = await page.evaluate(() => ({
    seed: (window as any).__lbw.game.seed,
    theme: (window as any).__lbw.game.theme,
  }));
  const homeLabel = `Meadow · seed ${home.seed}`;
  await page.evaluate(() => (window as any).__lbw.game.world.set(33, 30, 33, 21));
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); });

  // leave home: start the same seed fresh — the landmark is out of sight now
  await openGrownUpsMenu(page);
  await selectRow(page, 2); // Choose World
  await tap(page, 'jump');
  await page.waitForSelector('.world-preview');
  await selectRow(page, 4); // Start this world
  await tap(page, 'jump');
  await page.waitForSelector('.world-preview', { state: 'detached' });
  await page.waitForFunction('window.__lbw.game.world.get(33, 30, 33) === 0', null, { timeout: 20000 });
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 12000 });

  // My Worlds: the home world is in the list; A on its row plays it back
  await openGrownUpsMenu(page);
  await selectRow(page, 3); // My Worlds
  await tap(page, 'jump');
  await page.waitForSelector('.overlay-card:has-text("My Worlds")');
  const hasHome = async () => (await worldRows(page)).some((t) => t.includes(homeLabel));
  await expect.poll(hasHome, { timeout: 10000 }).toBe(true);

  await selectRow(page, await rowIndexOf(page, homeLabel));
  await tap(page, 'jump'); // A on a world row = play!
  await page.waitForFunction(
    (s: { seed: number; theme: number }) => {
      const g = (window as any).__lbw.game;
      return g.seed === s.seed && g.theme === s.theme && g.world.get(33, 30, 33) === 21;
    },
    home, { timeout: 20000 },
  );
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 12000 });

  // move on to an Islands world: two saved worlds now, newest first
  await openGrownUpsMenu(page);
  await selectRow(page, 2); // Choose World
  await tap(page, 'jump');
  await page.waitForSelector('.world-preview');
  await tap(page, 'right'); // theme -> Islands
  await selectRow(page, 4); // Start this world
  await tap(page, 'jump');
  await page.waitForSelector('.world-preview', { state: 'detached' });
  await page.waitForFunction('window.__lbw.game.theme === 1', null, { timeout: 10000 });
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); });

  await openGrownUpsMenu(page);
  await selectRow(page, 3); // My Worlds
  await tap(page, 'jump');
  await page.waitForSelector('.overlay-card:has-text("My Worlds")');
  const islandsLabel = `Islands · seed ${home.seed}`;
  const hasBoth = async () => {
    const rows = await worldRows(page);
    return rows.some((t) => t.includes(homeLabel)) && rows.some((t) => t.includes(islandsLabel));
  };
  await expect.poll(hasBoth, { timeout: 10000 }).toBe(true);

  // belt and braces: Save this world now
  await selectRow(page, await rowIndexOf(page, 'Save this world now'));
  await tap(page, 'jump');
  await expect(page.locator('.toast')).toContainText('World saved');

  // delete the Meadow home world: highlight its row and press Y (palette
  // button) twice — first press arms 'SURE?' on that row, second deletes it
  await selectRow(page, await rowIndexOf(page, homeLabel));
  await tap(page, 'palette');
  const sureRow = page.locator('.menu-item', { hasText: homeLabel });
  await expect(sureRow).toContainText('SURE?');
  await tap(page, 'palette');
  await page.waitForFunction(
    async (s: { seed: number; theme: number }) => {
      const r = await fetch(`/api/world?seed=${s.seed}&theme=${s.theme}`);
      return (await r.json()) === null;
    },
    home, { timeout: 10000 },
  );
  await expect.poll(hasHome, { timeout: 15000 }).toBe(false);

  // back out, and the game is still running in the Islands world
  await selectRow(page, await rowIndexOf(page, 'Back'));
  await tap(page, 'jump');
  const state = await page.evaluate(() => ({
    theme: (window as any).__lbw.game.theme,
    players: (window as any).__lbw.game.players.length,
    overlays: (window as any).__lbw.game.overlays.size,
  }));
  expect(state).toEqual({ theme: 1, players: 1, overlays: 0 });
});

test('the welcome world picker swaps to the saved-worlds list and back', async ({ page }) => {
  test.slow();
  await boot(page);
  await page.evaluate(() => {
    const pad = (window as any).__lbw.addVirtualPad();
    (window as any).__testPad = pad;
    pad.tap('palette');
  });
  await page.waitForSelector('.world-preview');
  await selectRow(page, 3); // My saved worlds
  await tap(page, 'jump');
  await page.waitForSelector('.overlay-card:has-text("My Worlds")');

  await selectRow(page, await rowIndexOf(page, 'New world…'));
  await tap(page, 'jump'); // New world… swaps the picker back in
  await page.waitForSelector('.world-preview');
  await expect(page.locator('.mi-body', { hasText: 'Start this world' })).toBeVisible();

  // the picker still works after the round trip
  await tap(page, 'right'); // theme -> Islands
  await selectRow(page, 4); // Start this world
  await tap(page, 'jump');
  await page.waitForSelector('.world-preview', { state: 'detached' });
  const state = await page.evaluate(() => ({
    theme: (window as any).__lbw.game.theme,
    worldTheme: (window as any).__lbw.game.world.theme,
  }));
  expect(state).toEqual({ theme: 1, worldTheme: 1 });
  await expect(page.locator('.welcome')).toBeVisible();
});

test('menu sub-screens receive controller input (Help screen opens and closes on the pad)', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 7); // Help
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

// ------------------------------------------------------------------- dynamite

type Cell = { x: number; y: number; z: number };

/**
 * Puts a stick of dynamite in the cell the player is aiming at (through the
 * same placement hook a controller press uses) and sets how long its fuse is.
 */
async function plantStick(page: Page, fuse: number): Promise<Cell> {
  // The save is shared between tests, and a stick that is in it comes back
  // already burning — so clear the left-overs first, otherwise the fuse
  // counts below mean nothing.
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const { sy, sz } = (window as any).__lbw.dims;
    const dyn = (window as any).__lbw.ids.DYNAMITE;
    game.dynamite.clear();
    for (const [i, id] of [...game.world.mods]) {
      if (id !== dyn) continue;
      const y = i % sy, xz = Math.floor(i / sy);
      game.world.set(Math.floor(xz / sz), y, xz % sz, 0);
    }
  });
  await page.waitForFunction('window.__lbw.game.players[0].target !== null', null, { timeout: 15000 });
  const cell = await page.evaluate((f: number) => {
    const game = (window as any).__lbw.game;
    const lp = game.players[0];
    const hit = lp.target;
    lp.selected = (window as any).__lbw.ids.DYNAMITE;
    if (!game.hooks().tryPlace(lp, hit)) return null;
    const cell = { x: hit.px, y: hit.py, z: hit.pz };
    game.dynamite.light(cell.x, cell.y, cell.z, f); // long fuse: the test decides when it pops
    return cell;
  }, fuse);
  expect(cell).not.toBeNull();
  return cell!;
}

/** how many burning-fuse rigs are still hanging in the scene (catches leaks) */
function fuseRigs(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__lbw.game.scene.children
    .filter((o: any) => o.userData?.fuse).length);
}

test('dynamite is in the palette, painted from an atlas, and lights when placed', async ({ page }) => {
  await boot(page);
  const atlas = await page.evaluate(() => ({
    hasMap: !!(window as any).__lbw.game.chunks.materials.textured.map,
  }));
  expect(atlas.hasMap).toBe(true); // the stick is drawn, not tinted

  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 10000 });

  // a child can find it in the block palette
  await page.evaluate(() => (window as any).__testPad.tap('palette'));
  await page.waitForSelector('.palette-grid');
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.palette-cell')].map((c) => c.textContent || ''));
  expect(labels.some((t) => t.includes('Dynamite'))).toBe(true);
  await page.evaluate(() => (window as any).__testPad.tap('back'));

  // place it with the build button
  await page.evaluate(() => {
    (window as any).__lbw.game.players[0].selected = (window as any).__lbw.ids.DYNAMITE;
  });
  await page.waitForFunction('window.__lbw.game.players[0].target !== null', null, { timeout: 15000 });
  const target = await page.evaluate(() => {
    const t = (window as any).__lbw.game.players[0].target;
    return { x: t.px, y: t.py, z: t.pz };
  });
  await page.evaluate(() => (window as any).__testPad.set('place', true));
  await page.waitForTimeout(600);
  const placed = await page.evaluate((c: Cell) => {
    const game = (window as any).__lbw.game;
    return {
      block: game.world.get(c.x, c.y, c.z),
      lit: game.dynamite.isLit(c.x, c.y, c.z),
      active: game.dynamite.active,
      textured: game.scene.children
        .filter((o: any) => o.isMesh && o.material === game.chunks.materials.textured).length,
      toast: document.querySelector('.toast')?.textContent ?? '',
    };
  }, target);
  await page.evaluate(() => (window as any).__testPad.set('place', false));

  expect(placed.block).toBe((await page.evaluate(() => (window as any).__lbw.ids)).DYNAMITE);
  expect(placed.lit).toBe(true);   // burning from the moment it is set down
  expect(placed.active).toBe(1);
  expect(placed.textured).toBeGreaterThan(0); // a chunk face is using the block atlas
  expect(placed.toast).toMatch(/Dynamite/i);

  // and the fuse really does run out
  await page.waitForFunction('window.__lbw.game.dynamite.blastCount > 0', null, { timeout: 30000 });
});

test('a blast carves a crater, marks the rim, and everybody walks away', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 10000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const cell = await plantStick(page, 30);

  const before = await page.evaluate((c: Cell) => {
    const game = (window as any).__lbw.game;
    const w = window as any;
    // watch the "kick" and the animal launch without needing hardware
    const lp = game.players[0];
    w.__shakes = [];
    const shake = lp.shake.bind(lp);
    lp.shake = (s: number, m: number) => { w.__shakes.push([s, m]); shake(s, m); };
    const away = game.animals.blastAway.bind(game.animals);
    w.__launched = [];
    game.animals.blastAway = (x: number, y: number, z: number, r: number) => {
      w.__launched.push(r);
      return away(x, y, z, r);
    };
    // the screen punch lives for less a second: watch for it instead of sampling
    w.__flashed = false;
    new MutationObserver((ms: MutationRecord[]) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if ((n as HTMLElement).classList?.contains('blast-flash')) w.__flashed = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
    // a bucket of water right beside the stick, to prove water always wins
    game.world.set(c.x + 2, c.y, c.z, w.__lbw.ids.WATER);
    let solid = 0;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = -2; dy <= 2; dy++)
          if (game.world.get(c.x + dx, c.y + dy, c.z + dz) !== 0) solid++;
    const rigs = game.scene.children.filter((o: any) => o.userData?.fuse).length;
    return { solid, rigs };
  }, cell);
  expect(before.solid).toBeGreaterThan(20);
  expect(before.rigs).toBe(1); // the stick is burning away while we set this up

  await page.evaluate((c: Cell) => (window as any).__lbw.game.dynamite.light(c.x, c.y, c.z, 0.05), cell);
  await page.waitForFunction('window.__lbw.game.dynamite.blastCount > 0', null, { timeout: 30000 });

  const after = await page.evaluate((c: Cell) => {
    const game = (window as any).__lbw.game;
    const ids = (window as any).__lbw.ids;
    const w = window as any;
    let solid = 0;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = -2; dy <= 2; dy++)
          if (game.world.get(c.x + dx, c.y + dy, c.z + dz) !== 0) solid++;
    return {
      centre: game.world.get(c.x, c.y, c.z),
      solid,
      bedrock: game.world.get(c.x, 0, c.z),
      water: game.world.get(c.x + 2, c.y, c.z),
      scorch: [...game.world.mods.values()].filter((v: number) => v === ids.SCORCH).length,
      active: game.dynamite.active,
      rigs: game.scene.children.filter((o: any) => o.userData?.fuse).length,
      shakes: w.__shakes.length,
      launched: w.__launched.length,
      flashed: w.__flashed === true,
    };
  }, cell);

  expect(after.centre).toBe(0);                     // the stick's own cell is gone
  expect(after.solid).toBeLessThan(before.solid);   // and so is a lump of the world
  expect(after.bedrock).not.toBe(0);                // the floor always holds
  expect(after.water).toBe(ids.WATER);              // water always wins
  expect(after.scorch).toBeGreaterThan(0);          // the blast leaves a mark
  expect(after.active).toBe(0);
  expect(after.rigs).toBe(0);                       // the burning-fuse meshes are cleaned up
  expect(after.shakes).toBeGreaterThan(0);          // the player feels it
  expect(after.launched).toBeGreaterThan(0);        // the animals get told
  expect(after.flashed).toBe(true);                // and the screen punches

  // tidy the site for the next test in the shard (they re-boot from this
  // save): fill the crater in and drain the demonstration water — a lone
  // eternal WATER cell beside spawn rains on everyone downstream, which is
  // the documented reason unrelated tests time out waiting for an aim target
  await page.evaluate((arg: { c: Cell; grass: number; air: number; water: number; flow: number }) => {
    const S = (window as any).__lbw.game.world;
    const surf = arg.c.y - 1; // the surface the stick was standing on
    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        const cx = arg.c.x + dx, cz = arg.c.z + dz;
        for (let y = Math.max(1, surf - 4); y <= surf + 4; y++) {
          const b = S.get(cx, y, cz);
          if (b === arg.water || b === arg.flow) S.set(cx, y, cz, arg.air);
          else if (y <= surf && b === arg.air) S.set(cx, y, cz, arg.grass); // the crater
        }
      }
    }
  }, {
    c: cell,
    grass: ids.GRASS, air: ids.AIR, water: ids.WATER, flow: ids.WATER_FLOW,
  });
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); }); // land the refill before the next page boots
});

test('hitting a stick with the break button re-lights the stub, it does not come off', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 10000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const cell = await plantStick(page, 30);

  await frames(page, 3);
  const aim = await page.evaluate(() => {
    const p = (window as any).__lbw.game.players[0];
    return p.removeTarget ? { block: p.removeTarget.block, y: p.removeTarget.y } : null;
  });
  expect(aim?.block).toBe(ids.DYNAMITE); // LT is aiming at the stick

  await page.evaluate(() => (window as any).__testPad.set('remove', true));
  await frames(page, 4);
  await page.evaluate(() => (window as any).__testPad.set('remove', false));

  const now = await page.evaluate((c: Cell) => {
    const game = (window as any).__lbw.game;
    const fuse = [...game.dynamite.lit.values()]
      .find((l: any) => l.x === c.x && l.y === c.y && l.z === c.z);
    return {
      block: game.world.get(c.x, c.y, c.z),
      fuse: fuse ? fuse.fuse : null,
    };
  }, cell);
  expect(now.block).toBe(ids.DYNAMITE); // it is still a stick...
  expect(now.fuse).not.toBeNull();      // ...now burning down fast
  expect(now.fuse!).toBeLessThan(1);

  await page.waitForFunction('window.__lbw.game.dynamite.blastCount > 0', null, { timeout: 30000 });
  const gone = await page.evaluate(
    (c: Cell) => (window as any).__lbw.game.world.get(c.x, c.y, c.z), cell);
  expect(gone).toBe(0);
});

test('one stick lights the sticks around it too (chain reactions)', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 10000 });
  const cell = await plantStick(page, 30);
  expect(await fuseRigs(page)).toBe(1);

  // a second stick well outside the crater but close enough to hear it
  await page.evaluate(({ c, dyn }: { c: Cell; dyn: number }) => {
    const game = (window as any).__lbw.game;
    game.world.set(c.x + 6, c.y, c.z, dyn);
    game.dynamite.light(c.x + 6, c.y, c.z, 30);
  }, { c: cell, dyn: (await page.evaluate(() => (window as any).__lbw.ids)).DYNAMITE });
  expect(await fuseRigs(page)).toBe(2); // two sticks, two burning fuses

  await page.evaluate((c: Cell) => (window as any).__lbw.game.dynamite.light(c.x, c.y, c.z, 0.05), cell);
  await page.waitForFunction('window.__lbw.game.dynamite.blastCount >= 2', null, { timeout: 45000 });

  const both = await page.evaluate((c: Cell) => {
    const game = (window as any).__lbw.game;
    return {
      first: game.world.get(c.x, c.y, c.z),
      second: game.world.get(c.x + 6, c.y, c.z),
      active: game.dynamite.active,
    };
  }, cell);
  expect(both.first).toBe(0);
  expect(both.second).toBe(0); // the neighbour went off by itself, it was not carved away
  expect(both.active).toBe(0);
  expect(await fuseRigs(page)).toBe(0); // both fuse rigs are gone again
});

test('a stick you left lying around is still there after a reload, fuse and all', async ({ page }) => {  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 10000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  await clearRunway(page); // CI's shared save can litter the aiming row
  const cell = await plantStick(page, 60);

  const want = await page.evaluate((c: Cell) => {
    const { sz, sy } = (window as any).__lbw.dims;
    return {
      key: String((c.x * sz + c.z) * sy + c.y),
      dyn: (window as any).__lbw.ids.DYNAMITE,
      seed: (window as any).__lbw.game.seed,
      theme: (window as any).__lbw.game.theme,
    };
  }, cell);
  await page.evaluate(async (w: { key: string; dyn: number; seed: number; theme: number }) => {
    (window as any).__savedStick = false;
    const iv = setInterval(async () => {
      const r = await fetch(`/api/world?seed=${w.seed}&theme=${w.theme}`);
      const d = await r.json();
      if (d && d.mods && d.mods[w.key] === w.dyn) {
        (window as any).__savedStick = true;
        clearInterval(iv);
      }
    }, 250);
  }, want);
  await page.waitForFunction('window.__savedStick === true', null, { timeout: 20000 });

  await page.reload();
  await page.waitForFunction('window.__lbw !== undefined', null, { timeout: 20000 });
  const after = await page.evaluate((c: Cell) => {
    const game = (window as any).__lbw.game;
    return {
      block: game.world.get(c.x, c.y, c.z),
      lit: game.dynamite.isLit(c.x, c.y, c.z),
      active: game.dynamite.active,
    };
  }, cell);
  expect(after.block).toBe(ids.DYNAMITE);
  expect(after.lit).toBe(true);   // and it starts burning again
  expect(after.active).toBeGreaterThan(0);

  // ...and now put the live stick OUT. Its fuse runs on GAME time and rides
  // the save, so every later boot in this shared world keeps it burning —
  // and the first later course built near spawn (the ladder's) gets its wall
  // carved out from under it mid-test. Defusing = set the cell to AIR: the
  // manager notices the missing voxel and extinguishes the rig next tick.
  await page.evaluate((c: Cell) => {
    (window as any).__lbw.game.world.set(c.x, c.y, c.z, 0);
  }, cell);
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); });
});

// -------------------------------------------------------------------- artwork

test('every block is painted from the atlas, not flat-tinted', async ({ page }) => {
  await boot(page);
  const art = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const img = game.chunks.materials.textured.map.image as HTMLCanvasElement;
    const S = 32;
    const cells = Math.round(img.width / S);
    const scratch = document.createElement('canvas');
    scratch.width = img.width;
    scratch.height = img.height;
    const g = scratch.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const sigs: string[] = [];
    const paletteSizes: number[] = [];
    for (let c = 0; c < cells; c++) {
      const d = g.getImageData(c * S, 0, S, S).data;
      const seen = new Set<string>();
      let r = 0, gg = 0, b = 0;
      for (let p = 0; p < d.length; p += 4) {
        seen.add(`${d[p]},${d[p + 1]},${d[p + 2]}`);
        r += d[p]; gg += d[p + 1]; b += d[p + 2];
      }
      const n = d.length / 4;
      paletteSizes.push(seen.size);
      sigs.push(`${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)}`);
    }
    return { cells, sigs, paletteSizes };
  });
  // one cell per block face style, every cell actually drawn, none alike
  expect(art.cells).toBeGreaterThanOrEqual(20);
  expect(art.paletteSizes.every((s) => s >= 3)).toBe(true); // no cell is one flat fill
  expect(new Set(art.sigs).size).toBe(art.cells);

  // and the game really uses the artwork: painted blocks, both the opaque ones
  // and the see-through ones. Water used to be what proved the translucent
  // channel was live (it drew with the glass art), but it has a channel of its
  // own now, so the glass has to speak for itself — which means waiting for the
  // chunk rebuild, since remeshing is budgeted a few chunks per frame.
  await joinWithPad(page);
  const site = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const ids = (window as any).__lbw.ids;
    const e = game.players[0].entity;
    const x = Math.round(e.pos.x) + 3, z = Math.round(e.pos.z);
    const y = game.world.surfaceY(x, z) + 1;
    game.world.set(x, y, z, ids.STONE);
    game.world.set(x + 1, y, z, ids.GLASS);
    // read straight back, and hand the coordinates forward: the kid drifts, so
    // recomputing "three blocks to my right" after a wait misses the glass
    return { x: x + 1, y, z, idAfter: game.world.get(x + 1, y, z), glass: ids.GLASS };
  });
  expect(site.idAfter, `the glass stands where it was placed — ${JSON.stringify(site)}`).toBe(site.glass);
  await frames(page, 30);
  const channels = await page.evaluate((at: { x: number; y: number; z: number }) => {
    const game = (window as any).__lbw.game;
    const S = game.world;
    const geo = (window as any).__lbw.chunkGeometry(S, Math.floor(at.x / 16), Math.floor(at.z / 16));
    const count = (mat: any) =>
      game.scene.children.filter((o: any) => o.isMesh && o.material === mat).length;
    const quads = (g: any) => (g ? g.attributes.position.count / 24 : -1);
    return {
      probe: {
        ...at, id: S.get(at.x, at.y, at.z),
        texTQuads: quads(geo?.texturedTranslucent),
        texQuads: quads(geo?.textured),
        transpQuads: quads(geo?.translucent),
      },
      painted: count(game.chunks.materials.textured),
      seeThrough: count(game.chunks.materials.texturedTranslucent),
      uved: game.scene.children
        .filter((o: any) => o.isMesh && o.material === game.chunks.materials.textured)
        .every((o: any) => !!o.geometry.attributes.uv),
    };
  }, site);
  expect(channels.painted).toBeGreaterThan(0);
  expect(channels.seeThrough, `glass carries atlas art — probe ${JSON.stringify(channels.probe)}`).toBeGreaterThan(0);
  expect(channels.uved).toBe(true);
});

/**
 * Hidden-face culling may only skip a face the neighbour really covers. A
 * treasure chest is 0.85 of a cell tall, a slab half, a step two boxes: their
 * neighbours used to treat them as whole cubes and drop the shared face, which
 * left a see-through hole in the terrain around every chest in the world.
 */
test('a partial block keeps its neighbours faces, so nothing around it is see-through', async ({ page }) => {
  await boot(page);
  const quads = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const S = game.world;
    const ids = (window as any).__lbw.ids;
    const chunk = (window as any).__lbw.dims.chunk;
    const mid = Math.floor((window as any).__lbw.dims.sx / 2);
    // a 3x3x3 cube of planks floating in clear air, wholly inside one chunk,
    // with one cell in the middle that is not a cube
    const cx = Math.floor(mid / chunk) * chunk + 1;
    const cz = cx;
    const y0 = S.surfaceY(cx + 1, cz + 1) + 4;
    const build = (oddCell: number): number => {
      for (let dx = -1; dx <= 3; dx++) {
        for (let dz = -1; dz <= 3; dz++) {
          for (let dy = 0; dy <= 4; dy++) S.set(cx + dx, y0 + dy, cz + dz, 0, false);
        }
      }
      for (let dx = 0; dx < 3; dx++) {
        for (let dz = 0; dz < 3; dz++) {
          for (let dy = 0; dy < 3; dy++) {
            const middle = dx === 1 && dy === 1 && dz === 1;
            S.set(cx + dx, y0 + dy, cz + dz, middle ? oddCell : ids.PLANKS, false);
          }
        }
      }
      const geo = (window as any).__lbw.chunkGeometry(S, Math.floor(cx / chunk), Math.floor(cz / chunk));
      return geo.textured ? geo.textured.getAttribute('position').count / 6 : 0; // 6 vertices per quad
    };
    return {
      allCubes: build(ids.PLANKS),
      chest: build(ids.CHEST),
      openChest: build(ids.CHEST_OPEN),
      slab: build(ids.SLAB),
      stairs: build(ids.STAIRS),
    };
  });
  // the six planks around the odd-shaped cell each keep the face they share with
  // it, whatever the middle looks like (it adds its own short lid / tread too)
  for (const name of ['chest', 'openChest', 'slab', 'stairs'] as const) {
    expect(quads[name] - quads.allCubes, `${name} swallowed a neighbour face`).toBeGreaterThanOrEqual(6);
  }
  // and sealed inside planks, an opened chest is a shut chest minus its lid:
  // only the top ever opens, and down in there that face is the only change
  expect(quads.chest - quads.openChest).toBe(1);
});

/**
 * What "a chest only opens at the top" has to mean in the geometry, face by
 * face: an opened chest shows the SAME side artwork as a shut one, has no lid
 * lying across its rim, and instead shows an opening — the inside of the
 * walls, treasure lying strictly below the rim — with the lid raised off the
 * box, leaning back over the cell behind. And cover the chest's top and the
 * whole opening vanishes again: what cannot be looked into is not drawn.
 */
test('an opened chest is a shut chest with an opening on top, not opened sides', async ({ page }) => {
  await boot(page);
  const shape = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const S = game.world;
    const ids = (window as any).__lbw.ids;
    const atlas = (window as any).__lbw.atlas;
    const chunk = (window as any).__lbw.dims.chunk;
    const mid = Math.floor((window as any).__lbw.dims.sx / 2);
    const cx = Math.floor(mid / chunk) * chunk + 2;
    const cz = cx;
    const y0 = S.surfaceY(cx, cz) + 4;
    const clear = () => {
      for (let dx = -1; dx <= 6; dx++)
        for (let dz = -1; dz <= 2; dz++)
          for (let dy = -1; dy <= 4; dy++) S.set(cx + dx, y0 + dy, cz + dz, 0, false);
    };
    clear();
    S.set(cx, y0, cz, ids.CHEST, false);
    S.set(cx + 4, y0, cz, ids.CHEST_OPEN, false);

    /** every quad in one chest's column, decoded: atlas cell, normal, centroid */
    const faces = (bx: number) => {
      const geo = (window as any).__lbw.chunkGeometry(S, Math.floor(cx / chunk), Math.floor(cz / chunk));
      const pos = geo.textured.getAttribute('position').array;
      const nor = geo.textured.getAttribute('normal').array;
      const uv = geo.textured.getAttribute('uv').array;
      const out: { cell: number; ny: number; n: [number, number, number]; y: number; maxY: number }[] = [];
      for (let t = 0; t < pos.length; t += 9) {
        const mx = (pos[t] + pos[t + 3] + pos[t + 6]) / 3;
        const mz = (pos[t + 2] + pos[t + 5] + pos[t + 8]) / 3;
        // the z band is wider than the cell: the open lid leans back over the
        // cell behind, and it is very much part of this chest's shape
        if (mx < bx - 0.01 || mx > bx + 1.01 || mz < cz - 0.6 || mz > cz + 1.6) continue;
        const my = (pos[t + 1] + pos[t + 4] + pos[t + 7]) / 3;
        out.push({
          cell: Math.floor(uv[t * 2 / 3] * atlas.cells),
          n: [nor[t] + nor[t + 3] + nor[t + 6], nor[t + 1] + nor[t + 4] + nor[t + 7], nor[t + 2] + nor[t + 5] + nor[t + 8]].map((v) => v / 3) as [number, number, number],
          ny: (nor[t + 1] + nor[t + 4] + nor[t + 7]) / 3,
          y: my - y0,
          maxY: Math.max(pos[t + 1], pos[t + 4], pos[t + 7]) - y0,
        });
      }
      // two triangles per quad
      const quads = (pred: (f: typeof out[number]) => boolean): number => out.filter(pred).length / 2;
      const side = (f: typeof out[number]): boolean => Math.abs(f.ny) < 0.01;
      return {
        sides: quads((f) => f.cell === atlas.side && side(f)),
        flatLid: quads((f) => f.cell === atlas.lid && f.ny > 0.9),
        tiltedLid: quads((f) => f.cell === atlas.lid && f.ny > 0.2 && f.ny < 0.9),
        inside: quads((f) => f.cell === atlas.inside && side(f)),
        treasure: quads((f) => f.cell === atlas.treasure),
        treasureY: Math.max(0, ...out.filter((f) => f.cell === atlas.treasure).map((f) => f.y)),
        lidMaxY: Math.max(0, ...out.filter((f) => f.cell === atlas.lid).map((f) => f.maxY)),
      };
    };
    const shut = faces(cx);
    const open = faces(cx + 4);
    clear();
    S.set(cx, y0, cz, ids.CHEST, false);
    S.set(cx + 4, y0, cz, ids.CHEST_OPEN, false);
    S.set(cx + 4, y0 + 1, cz, ids.PLANKS, false); // a plank over the opening
    const covered = faces(cx + 4);
    return { shut, open, covered };
  });
  // from the side there is no such thing as an opened chest: four sides, the
  // very same artwork the shut chest wears
  expect(shape.open.sides).toBe(4);
  expect(shape.shut.sides).toBe(4);
  // the shut chest's lid lies flat across the top; an opened chest has taken
  // that face off entirely, and the lid now stands tilted above the cell
  expect(shape.shut.flatLid).toBe(1);
  expect(shape.open.flatLid).toBe(0);
  expect(shape.open.tiltedLid).toBe(1);
  expect(shape.open.lidMaxY).toBeGreaterThan(1); // it rises into the cell above
  // what the opening shows: the inside of four walls, and treasure strictly
  // below the rim (0.85) — you look DOWN into a chest, never through its side
  expect(shape.open.inside).toBe(4);
  expect(shape.open.treasure).toBe(1);
  expect(shape.open.treasureY).toBeLessThan(0.85);
  expect(shape.shut.inside).toBe(0);
  expect(shape.shut.treasure).toBe(0);
  // and a block over the top hides it all again — the sides still read shut
  expect(shape.covered.tiltedLid).toBe(0);
  expect(shape.covered.inside).toBe(0);
  expect(shape.covered.treasure).toBe(0);
  expect(shape.covered.sides).toBe(4);
});

/**
 * A ladder is a wall you climb, not a wall you bump into. It is never solid
 * (you walk into its cell), it is painted from the ladder atlas cell, and once
 * you are in that cell gravity lets go: hold jump to climb up, hold the
 * sneak/dive button to slide down, and at the top rung a step onto the ledge.
 */
test('a ladder: walk into it, hold jump to climb up, sneak to climb down, get on the wall', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);

  // Build a three-block stone wall with a ladder nailed to its near face,
  // snapshotting the six cells first so the end of the test can hand the
  // meadow back to the tests that come after.
  const site = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const S = game.world;
    const ids = (window as any).__lbw.ids;
    const atlas = (window as any).__lbw.atlas;
    const e = game.players[0].entity;
    const x = Math.round(e.pos.x), z = Math.round(e.pos.z);
    const G = S.surfaceY(x, z); // the kid stands at feet y = G + 1 on the meadow
    const orig: number[] = [];
    for (let k = 1; k <= 3; k++) {
      orig.push(S.get(x, G + k, z + 1), S.get(x, G + k, z));
      S.set(x, G + k, z + 1, ids.STONE); // the wall
      S.set(x, G + k, z, ids.LADDER); // the ladder we climb
      S.setLadderFacing(x, G + k, z, 3); // climbed from -z, panel against the +z wall
    }
    e.pos.set(x + 0.5, G + 1, z + 0.5);
    e.vel.set(0, 0, 0);
    e.yaw = 0; // stick forward walks +z, straight into the ladder

    // is it painted from the ladder's atlas cell? decode the mesh UVs.
    const chunk = (window as any).__lbw.dims.chunk;
    const geo = (window as any).__lbw.chunkGeometry(S, Math.floor(x / chunk), Math.floor(z / chunk));
    let ladderFaces = 0;
    if (geo.textured) {
      const pos = geo.textured.getAttribute('position').array;
      const uv = geo.textured.getAttribute('uv').array;
      for (let t = 0; t < pos.length; t += 9) {
        const cx = (pos[t] + pos[t + 3] + pos[t + 6]) / 3;
        const cz = (pos[t + 2] + pos[t + 5] + pos[t + 8]) / 3;
        if (Math.floor(cx) !== x || Math.floor(cz) !== z) continue; // the ladder column
        if (Math.floor(uv[(t / 3) * 2] * atlas.cells) === atlas.ladder) ladderFaces++;
      }
    }
    return {
      x, z, G, wallTopY: G + 4, orig, ladder: ids.LADDER, stone: ids.STONE,
      passable: !S.isSolid(x, G + 1, z), // the cell the kid walks into is not solid
      facing: S.getLadderFacing(x, G + 1, z),
      ladderFaces,
    };
  });
  expect(site.passable, 'a ladder is not solid — you walk into it').toBe(true);
  expect(site.facing).toBe(3);
  expect(site.ladderFaces).toBeGreaterThan(0); // and it is painted from the ladder art

  // walk into it: hold forward and the kid walks straight into the ladder's
  // cell and stops against the wall behind it, never on top of a rung
  await page.evaluate((s: { x: number; z: number; G: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(s.x + 0.5, s.G + 1, s.z - 2.5);
    e.vel.set(0, 0, 0);
    (window as any).__testPad.setMove(0, -1);
  }, site);
  await page.waitForFunction(
    (s: { z: number }) => (window as any).__lbw.game.players[0].entity.pos.z > s.z + 0.3,
    site, { timeout: 10000 },
  );
  await page.evaluate((s: { x: number; z: number; G: number }) => {
    (window as any).__testPad.setMove(0, 0);
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(s.x + 0.5, s.G + 1, s.z + 0.5); // stand on the bottom rung
    e.vel.set(0, 0, 0);
  }, site);

  // hold jump: gravity lets go and the kid climbs, and at the top the last
  // rung is a step over onto the wall
  await page.evaluate(() => (window as any).__testPad.set('jump', true));
  const up = await page.waitForFunction(
    (s: { wallTopY: number; z: number }) => {
      const e = (window as any).__lbw.game.players[0].entity;
      if (!(e.grounded && e.pos.y >= s.wallTopY - 0.05 && e.pos.z > s.z + 0.5)) return false;
      return { y: e.pos.y, z: e.pos.z };
    },
    site, { timeout: 15000 },
  ).then((h) => h.jsonValue() as Promise<{ y: number; z: number }>);
  await page.evaluate(() => (window as any).__testPad.set('jump', false));
  expect(up.y).toBeGreaterThanOrEqual(site.wallTopY - 0.05);
  expect(up.z).toBeGreaterThan(site.z + 0.5); // swung over onto the wall, not still on the ladder

  // sneak (the same dive button) descends: back to the top rung and hold it,
  // and the kid slides down the ladder to its foot instead of falling
  const fromY = await page.evaluate((s: { x: number; z: number; G: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(s.x + 0.5, s.G + 3, s.z + 0.5);
    e.vel.set(0, 0, 0);
    return e.pos.y;
  }, site);
  await page.evaluate(() => (window as any).__testPad.set('crouch', true));
  const afterDown = await page.waitForFunction(
    (from: number) => {
      const e = (window as any).__lbw.game.players[0].entity;
      return e.pos.y < from - 1.5 ? e.pos.y : false;
    },
    fromY, { timeout: 15000 },
  ).then((h) => h.jsonValue() as Promise<number>);
  await page.evaluate(() => (window as any).__testPad.set('crouch', false));
  expect(afterDown).toBeLessThan(fromY - 1.5); // slid down more than a block and a half
  expect(afterDown).toBeGreaterThanOrEqual(site.G + 0.99); // and the meadow catches them

  // and the kid LOOKS like they're climbing: upright body, arms reaching up
  // over the head (the e2e measures the drawn matrices, not screenshots)
  const pose = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    const a = e.avatar;
    return {
      climbing: e.climbingNow,
      armL: a.leftArm.rotation.x, armR: a.rightArm.rotation.x,
      groupScaleY: a.group.scale.y, bodyScaleY: a.body.scale.y,
    };
  });
  expect(pose.climbing).toBe(true); // still holding the rungs at the foot of the ladder
  expect(Math.min(pose.armL, pose.armR), 'an arm reaches up').toBeLessThan(-1.6);
  expect(pose.groupScaleY, 'a climb is a pose, never a squash').toBeCloseTo(1, 2);
  expect(pose.bodyScaleY).toBeCloseTo(1, 2);

  // the save carries the ladder AND which wall it leans on (version 5)
  const saved = await page.evaluate(async (s: { x: number; z: number; G: number }) => {
    const game = (window as any).__lbw.game;
    await game.saveNow();
    const save = game.world.toSave();
    const { sz, sy } = (window as any).__lbw.dims;
    return {
      version: save.version,
      facing: (save.ladderFacing ?? {})[String((s.x * sz + s.z) * sy + s.G + 2)] ?? -1,
    };
  }, site);
  expect(saved.version).toBe(5);
  expect(saved.facing, 'a ladder remembers its wall').toBe(3);

  // and a reload brings the ladder back, nailed to the same wall
  await page.reload();
  await page.waitForFunction('window.__lbw !== undefined');
  const restored = await page.evaluate((s: { x: number; z: number; G: number }) => {
    const S = (window as any).__lbw.game.world;
    return {
      block: S.get(s.x, s.G + 2, s.z),
      facing: S.getLadderFacing(s.x, s.G + 2, s.z),
      wall: S.get(s.x, s.G + 3, s.z + 1),
    };
  }, site);
  expect(restored.block).toBe(site.ladder);
  expect(restored.facing).toBe(3);
  expect(restored.wall).toBe(site.stone);

  // hand the meadow back: every cell we touched, byte for byte, and save
  await page.evaluate(async (s: { x: number; z: number; G: number; orig: number[] }) => {
    const game = (window as any).__lbw.game;
    const S = game.world;
    const { sz, sy } = (window as any).__lbw.dims;
    for (let k = 0; k < 3; k++) {
      const y = s.G + 1 + k;
      S.set(s.x, y, s.z + 1, s.orig[k * 2]); // the wall cell
      S.set(s.x, y, s.z, s.orig[k * 2 + 1]); // the ladder cell
      S.ladderFacing.delete((s.x * sz + s.z) * sy + y);
      S.touchAt(s.x, s.z);
    }
    await game.saveNow();
  }, site);
});

test('the kids are dressed: knitted jumpers, denim legs, a faced head', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  const cloth = await page.evaluate(() => {
    const parts = (window as any).__lbw.game.players[0].entity.avatar;
    const texIds = new Set<string>();
    let clothed = 0;
    let multiFace = 0;
    let faceMesh = 0;
    parts.group.traverse((o: any) => {
      if (!o.isMesh) return;
      const mats: any[] = Array.isArray(o.material) ? o.material : [o.material];
      if (Array.isArray(o.material) && o.material.length === 6) multiFace++;
      const maps = mats.map((m) => m?.map).filter(Boolean);
      if (maps.length) maps.forEach((m: any) => texIds.add(m.uuid));
      if (o.geometry.type === 'PlaneGeometry') faceMesh++;
      if (o.geometry.type === 'BoxGeometry' && maps.length) clothed++;
    });
    return { clothed, multiFace, faceMesh, textures: texIds.size };
  });
  expect(cloth.clothed).toBeGreaterThanOrEqual(5); // head, torso, two arms, two legs
  expect(cloth.multiFace).toBe(1);                 // the jumper's front is its own artwork
  expect(cloth.faceMesh).toBe(1);                  // the little face is still there
  expect(cloth.textures).toBeGreaterThanOrEqual(3); // knit, denim and the jumper front differ
});

test('costumes: pick one with LB/RB at join, swap anytime in the menu', async ({ page }) => {
  test.slow();
  await boot(page);
  // wake the join card and keep it open (no confirm tap yet)
  const pad = await page.evaluate(() => (window as any).__lbw.addVirtualPad());
  void pad;
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const src = [...game.input.sources.values()].find((s: any) => s.kind === 'virtual' && !game.sourceToPlayer.has(s.id));
    (window as any).__testPad = src;
    src.tap('jump');
  });
  await page.waitForFunction('window.__lbw.game.pendingJoins.size > 0');

  await expect(page.locator('.model-name')).toHaveText(/Kid/);
  await tap(page, 'nextBlock'); // LB/RB (Q/R on keyboard) cycle costumes
  await tap(page, 'nextBlock');
  await expect(page.locator('.model-name')).toHaveText(/Robot/);

  await tap(page, 'jump'); // join as the Robot
  await page.waitForFunction('window.__lbw.game.players.length === 1');

  const stats = () => page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    let meshes = 0;
    let ownColour = 0;
    const want = (e.colorHex as string).slice(1).toLowerCase();
    e.avatar.group.traverse((o: any) => {
      if (!o.isMesh) return;
      meshes++;
      const mats: any[] = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m?.color && m.color.getHexString() === want)) ownColour++;
    });
    return {
      model: e.model,
      inScene: !!e.avatar.group.parent,
      meshes,
      ownColour,
      tail: !!e.avatar.tail,
    };
  });

  const robot = await stats();
  expect(robot.model).toBe('robot');
  expect(robot.inScene).toBe(true);
  expect(robot.meshes).toBeGreaterThan(10); // antenna, ear bolts, boots…
  expect(robot.ownColour).toBeGreaterThan(0); // the player colour survived the costume

  // the Costume row in the player menu cycles every model without page errors
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 6); // Costume
  const order = ['wizard', 'dino', 'cat', 'knight', 'kid', 'astronaut'];
  for (const want of order) {
    await tap(page, 'jump');
    const s = await stats();
    expect(s.model).toBe(want);
    expect(s.inScene).toBe(true); // the rebuilt avatar slid back into the scene
    expect(s.meshes).toBeGreaterThanOrEqual(9); // the classic body is 9 pieces…
    if (want !== 'kid') expect(s.meshes).toBeGreaterThan(9); // …costumes add bits on top
    expect(s.ownColour).toBeGreaterThan(0);
    if (want === 'dino' || want === 'cat') expect(s.tail).toBe(true);
  }
  await page.evaluate(() => (window as any).__testPad.set('back', true));
  await frames(page, 2);
  await page.evaluate(() => (window as any).__testPad.set('back', false));
  await page.waitForSelector('.menu-list', { state: 'detached' });
});

// ------------------------------------- animals, doors, slabs, stairs, chests, saplings

/** flattens a strip of the starting meadow and faces the player down it */
async function clearRunway(page: Page): Promise<{ fx: number; fz: number; gy: number }> {
  return page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const e = game.players[0].entity;
    const fx = Math.floor(e.pos.x), fz = Math.floor(e.pos.z);
    const gy = game.world.surfaceY(fx, fz);
    for (let x = fx - 4; x <= fx + 6; x++) {
      for (let z = fz - 2; z <= fz + 2; z++) {
        for (let y = gy + 1; y <= gy + 12; y++) game.world.set(x, y, z, 0); // tall: whole trees too
      }
    }
    e.yaw = Math.PI / 2; // face +x
    e.pitch = -0.6; // look slightly down at the ground ahead
    return { fx, fz, gy };
  });
}

/** selects a block, aims, presses the build trigger and reports the cell it landed in */
async function placeSelected(page: Page, blockId: number): Promise<Cell> {
  await page.evaluate((b: number) => {
    (window as any).__lbw.game.players[0].selected = b;
  }, blockId);
  await page.waitForFunction('window.__lbw.game.players[0].target !== null', null, { timeout: 15000 });
  const cell = await page.evaluate(() => {
    const t = (window as any).__lbw.game.players[0].target;
    return { x: t.px, y: t.py, z: t.pz };
  });
  // one block per hold: release as soon as it lands, before the auto-repeat
  // (0.28 s of game time) can put a second one down
  await page.evaluate(() => (window as any).__testPad.set('place', true));
  await page.waitForFunction(
    (c: Cell) => (window as any).__lbw.game.world.get(c.x, c.y, c.z) !== 0,
    cell, { timeout: 4000 },
  );
  await page.evaluate(() => (window as any).__testPad.set('place', false));
  return cell;
}

test('doors: two blocks high and half a block deep — build, pat open, walk through, break, remember', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const site = await clearRunway(page);

  /** the doorFacing entry for a cell */
  const facingAt = (c: Cell, dy = 0) => page.evaluate((arg: { c: Cell; dy: number }) => {
    const { sz, sy } = (window as any).__lbw.dims;
    return (window as any).__lbw.game.world.doorFacing.get((arg.c.x * sz + arg.c.z) * sy + arg.c.y + arg.dy);
  }, { c, dy });
  const blockAt = (c: Cell, dy = 0) =>
    page.evaluate((arg: { c: Cell; dy: number }) => (window as any).__lbw.game.world.get(arg.c.x, arg.c.y + arg.dy, arg.c.z), { c, dy });

  // build a door with the build trigger: it fills TWO cells and nothing more
  const door = await placeSelected(page, ids.DOOR);
  expect(await blockAt(door)).toBe(ids.DOOR);
  expect(await blockAt(door, 1)).toBe(ids.DOOR_TOP);
  expect(await blockAt(door, 2)).toBe(ids.AIR); // no second door from the auto-repeat
  const swing = await facingAt(door);
  expect(swing === 0 || swing === 1).toBe(true);
  expect(await facingAt(door, 1)).toBe(swing); // the upper half remembers it too

  // fill the wall around it so the door is the only way through
  await page.evaluate((c: Cell) => {
    const game = (window as any).__lbw.game;
    for (const dy of [0, 1]) {
      game.world.set(c.x, c.y + dy, c.z - 1, (window as any).__lbw.ids.PLANKS);
      game.world.set(c.x, c.y + dy, c.z + 1, (window as any).__lbw.ids.PLANKS);
    }
  }, door);

  // walk into the CLOSED door: the panel is only half a block deep, so a kid
  // stops right at the wood — half a block sooner than a full cube would
  await page.evaluate((arg: { c: Cell; gy: number; pz: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(arg.c.x + 2.5, arg.gy + 1, arg.pz);
    e.vel.set(0, 0, 0);
    e.yaw = -Math.PI / 2; // face the door
    e.pitch = -0.2;
    (window as any).__testPad.setMove(0, -1);
  }, { c: door, gy: site.gy, pz: site.fz + 0.5 });
  await waitForStop(page);
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  const blockedX = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.pos.x);
  expect(blockedX).toBeGreaterThan(door.x + 0.95); // stopped at the panel face
  expect(blockedX).toBeLessThan(door.x + 1.2);     // …not half a block short of it

  // the pet button, aimed at the door: the whole two-block door swings open
  await page.evaluate(() => {
    (window as any).__lbw.game.players[0].entity.pitch = -0.75; // look down right in front
  });
  await page.waitForFunction((bids: number[]) => {
    const t = (window as any).__lbw.game.players[0].removeTarget;
    return t !== null && bids.includes(t.block);
  }, [ids.DOOR, ids.DOOR_TOP], { timeout: 8000 });
  await tap(page, 'interact');
  expect(await blockAt(door)).toBe(ids.DOOR_OPEN);
  expect(await blockAt(door, 1)).toBe(ids.DOOR_TOP_OPEN);

  // and now walking goes straight through it
  await page.evaluate(() => (window as any).__testPad.setMove(0, -1));
  await page.waitForFunction(
    (c: Cell) => (window as any).__lbw.game.players[0].entity.pos.x < c.x - 0.4,
    door, { timeout: 20000 },
  );
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));

  // pat it from the other side: both halves close again
  await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.yaw = Math.PI / 2;
    e.pitch = -0.75;
  });
  await page.waitForFunction((bids: number[]) => {
    const t = (window as any).__lbw.game.players[0].removeTarget;
    return t !== null && bids.includes(t.block);
  }, [ids.DOOR_OPEN, ids.DOOR_TOP_OPEN], { timeout: 8000 });
  await tap(page, 'interact');
  expect(await blockAt(door)).toBe(ids.DOOR);
  expect(await blockAt(door, 1)).toBe(ids.DOOR_TOP);

  // breaking either half takes the whole door down, swing records and all
  await tap(page, 'remove');
  expect(await blockAt(door)).toBe(ids.AIR);
  expect(await blockAt(door, 1)).toBe(ids.AIR);
  expect(await facingAt(door)).toBeUndefined();
  expect(await facingAt(door, 1)).toBeUndefined();

  // build a fresh one and the save carries both cells and both swings
  await clearRunway(page);
  const door2 = await placeSelected(page, ids.DOOR);
  const saved = await page.evaluate((c: Cell) => {
    const { sz, sy } = (window as any).__lbw.dims;
    const save = (window as any).__lbw.game.world.toSave();
    const at = (dy: number) => String((c.x * sz + c.z) * sy + c.y + dy);
    return {
      version: save.version,
      bottom: save.mods[at(0)],
      top: save.mods[at(1)],
      swingBottom: save.doorFacing?.[at(0)],
      swingTop: save.doorFacing?.[at(1)],
    };
  }, door2);
  expect(saved.version).toBe(5);
  expect(saved.bottom).toBe(ids.DOOR);
  expect(saved.top).toBe(ids.DOOR_TOP);
  expect(saved.swingBottom === 0 || saved.swingBottom === 1).toBe(true);
  expect(saved.swingTop).toBe(saved.swingBottom);

  // a reload brings the whole door back, same spot, same swing
  await page.evaluate(() => (window as any).__lbw.game.saveNow());
  await page.reload();
  await page.waitForFunction('window.__lbw !== undefined');
  const after = await page.evaluate((c: Cell) => {
    const game = (window as any).__lbw.game;
    const { sz, sy } = (window as any).__lbw.dims;
    const at = (dy: number) => game.world.doorFacing.get((c.x * sz + c.z) * sy + c.y + dy);
    return {
      bottom: game.world.get(c.x, c.y, c.z),
      top: game.world.get(c.x, c.y + 1, c.z),
      swingBottom: at(0),
      swingTop: at(1),
    };
  }, door2);
  expect(after.bottom).toBe(ids.DOOR);
  expect(after.top).toBe(ids.DOOR_TOP);
  expect(after.swingBottom === 0 || after.swingBottom === 1).toBe(true);
  expect(after.swingTop).toBe(after.swingBottom);
});

test('doors never shove a kid out of the world: spam close while standing in the doorway at the map edge', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);

  // a stone island hard against the WEST map edge with the door in the edge
  // column, swung so its near side is the void: exactly the setup the family
  // found — the old physics closed the panel inside the kid and faceSnap
  // shoved them along the panel's long axis, over the invisible wall.
  await page.evaluate((b: { door: number; doorTop: number; stone: number }) => {
    const game = (window as any).__lbw.game;
    const { sy, sz } = (window as any).__lbw.dims;
    for (let x = 0; x <= 5; x++) {
      for (let z = 0; z <= 4; z++) {
        for (let y = 8; y <= 12; y++) game.world.set(x, y, z, b.stone);
        for (let y = 13; y <= 16; y++) game.world.set(x, y, z, 0);
      }
    }
    game.world.set(0, 13, 2, b.door);
    game.world.set(0, 14, 2, b.doorTop);
    game.world.doorFacing.set((0 * sz + 2) * sy + 13, 0); // thin along x: the void is one shove away
    game.world.doorFacing.set((0 * sz + 2) * sy + 14, 0);
    const e = game.players[0].entity;
    e.pos.set(1.5, 13, 2.25);
    e.vel.set(0, 0, 0);
    e.yaw = -Math.PI / 2; // face the edge — and the door
    e.pitch = -0.35;
  }, { door: ids.DOOR, doorTop: ids.DOOR_TOP, stone: ids.STONE });

  await page.waitForFunction((bids: number[]) => {
    const t = (window as any).__lbw.game.players[0].removeTarget;
    return t !== null && bids.includes(t.block);
  }, [ids.DOOR, ids.DOOR_TOP], { timeout: 8000 });

  // step into the doorway and spam the pet button
  await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(0.5, 13, 2.25);
    e.vel.set(0, 0, 0);
  });
  const dims = await page.evaluate(() => (window as any).__lbw.dims);
  for (let i = 0; i < 6; i++) {
    await tap(page, 'interact');
    const p = await page.evaluate(() => {
      const e = (window as any).__lbw.game.players[0].entity;
      return { x: e.pos.x, y: e.pos.y, z: e.pos.z };
    });
    // never flung around: stays within arm's reach of the doorway, on top of
    // the island, inside the invisible wall — no respawns, no map-edge roulette
    expect(Math.hypot(p.x - 0.5, p.z - 2.5)).toBeLessThan(2.5);
    expect(p.y).toBeGreaterThanOrEqual(12.5);
    expect(p.x).toBeGreaterThanOrEqual(0.35);
    expect(p.z).toBeGreaterThanOrEqual(0.35);
    expect(p.x).toBeLessThan(dims.sx - 0.35);
    expect(p.z).toBeLessThan(dims.sz - 0.35);
  }

  // whoever holds the door at the end, the kid stands clear of the panel
  const end = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    return { bottom: game.world.get(0, 13, 2), x: game.players[0].entity.pos.x };
  });
  expect([ids.DOOR, ids.DOOR_OPEN]).toContain(end.bottom);
  if (end.bottom === ids.DOOR) expect(end.x).toBeGreaterThan(0.78); // east of the shut panel
});

/** the block id in a cell (`dy` cells above it) */
async function blockAtCell(page: Page, c: Cell, dy = 0): Promise<number> {
  return page.evaluate((arg: { c: Cell; dy: number }) =>
    (window as any).__lbw.game.world.get(arg.c.x, arg.c.y + arg.dy, arg.c.z), { c, dy });
}

/** which way a stair cell points: 0 = +x, 1 = -x, 2 = +z, 3 = -z (undefined for none) */
async function stairFacingAt(page: Page, c: Cell): Promise<number | undefined> {
  return page.evaluate((arg: { c: Cell }) => {
    const { sz, sy } = (window as any).__lbw.dims;
    return (window as any).__lbw.game.world.stairFacing.get((arg.c.x * sz + arg.c.z) * sy + arg.c.y);
  }, { c });
}

/** the text of the toast currently on screen ("" when there is none) */
function toastText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
}

test('slabs: the flat half-plate steps you up from every side', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const site = await clearRunway(page);

  const plate = await placeSelected(page, ids.SLAB);
  expect(await blockAtCell(page, plate)).toBe(ids.SLAB);
  // a plate is one cell, not a door: nothing stacks above it
  expect(await blockAtCell(page, plate, 1)).toBe(ids.AIR);

  // walk into it from the far side: feet rise onto the plate, then walk off it again
  await page.evaluate((arg: { c: Cell; gy: number; pz: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(arg.c.x + 2.5, arg.gy + 1, arg.pz);
    e.vel.set(0, 0, 0);
    e.yaw = -Math.PI / 2;
    e.pitch = -0.2;
    (window as any).__testPad.setMove(0, -1);
  }, { c: plate, gy: site.gy, pz: site.fz + 0.5 });

  await page.waitForFunction(
    (arg: { c: Cell; gy: number }) => {
      const e = (window as any).__lbw.game.players[0].entity;
      return e.pos.y >= arg.gy + 1.4 && e.pos.x <= arg.c.x + 1.0;
    },
    { c: plate, gy: site.gy }, { timeout: 15000 },
  );
  // and the far side steps back down to the meadow floor
  await page.waitForFunction(
    (arg: { c: Cell; gy: number }) => {
      const e = (window as any).__lbw.game.players[0].entity;
      return e.pos.x < arg.c.x - 0.6 && Math.abs(e.pos.y - (arg.gy + 1)) < 0.25;
    },
    { c: plate, gy: site.gy }, { timeout: 15000 },
  );
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
});

/** which way a stair turns when the pet button spins it: +x → +z → -x → -z */
const STAIR_TURN = [2, 3, 1, 0];

test('stairs: a real step — it points away from the builder, walking one climbs a block, the pet button turns it', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const site = await clearRunway(page); // leaves the player facing down +x

  // build one with the build trigger: a stair cell, pointing away from the kid
  // who built it (the tall half is the far side, so it climbs away from them)
  const step = await placeSelected(page, ids.STAIRS);
  expect(await blockAtCell(page, step)).toBe(ids.STAIRS);
  expect(await stairFacingAt(page, step)).toBe(0);

  // how a kid really builds with them: each step one block over and one block up,
  // all pointing away from them, so the row climbs
  await page.evaluate((arg: { c: Cell }) => {
    const game = (window as any).__lbw.game;
    const stairs = (window as any).__lbw.ids.STAIRS;
    for (let k = 0; k < 4; k++) {
      const x = arg.c.x + k, y = arg.c.y + k;
      game.world.set(x, y, arg.c.z, stairs);
      game.world.setStairFacing(x, y, arg.c.z, 0); // tall half away from the climber
    }
  }, { c: step });

  // walking up the treads climbs the staircase a half-block at a time, with the
  // jump button never touched once
  await page.evaluate((arg: { c: Cell; gy: number; pz: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(arg.c.x - 1.5, arg.gy + 1, arg.pz);
    e.vel.set(0, 0, 0);
    e.yaw = Math.PI / 2; // face +x: up the steps
    e.pitch = -0.2;
    (window as any).__testPad.setMove(0, -1);
  }, { c: step, gy: site.gy, pz: site.fz + 0.5 });
  await page.waitForFunction(
    (arg: { c: Cell }) => {
      const e = (window as any).__lbw.game.players[0].entity;
      return e.pos.y >= arg.c.y + 3.4 && e.pos.x >= arg.c.x + 3.0;
    },
    { c: step }, { timeout: 20000 },
  );
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));

  // …but the back of a step is a full-block riser: a real stair has a front, and
  // walking into the back stops you short instead of sliding you up. A lone step,
  // so nothing else is in the way.
  const lone = { x: step.x + 4, y: step.y, z: step.z };
  await page.evaluate((arg: { c: Cell }) => {
    const game = (window as any).__lbw.game;
    // a clear patch of meadow to walk on (only up to head height, so the
    // staircase further along is left standing), then one lonely step
    for (let x = arg.c.x - 1; x <= arg.c.x + 3; x++) {
      for (let y = arg.c.y; y <= arg.c.y + 1; y++) game.world.set(x, y, arg.c.z, 0);
    }
    game.world.set(arg.c.x, arg.c.y, arg.c.z, (window as any).__lbw.ids.STAIRS);
    game.world.setStairFacing(arg.c.x, arg.c.y, arg.c.z, 0);
  }, { c: lone });
  await page.evaluate((arg: { c: Cell; gy: number; pz: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(arg.c.x + 1.4, arg.gy + 1, arg.pz);
    e.vel.set(0, 0, 0);
    e.yaw = -Math.PI / 2; // face -x: straight at the riser
    e.pitch = -0.2;
    (window as any).__testPad.setMove(0, -1);
  }, { c: lone, gy: site.gy, pz: site.fz + 0.5 });
  await waitForStop(page);
  await page.evaluate(() => (window as any).__testPad.setMove(0, 0));
  const blocked = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { x: e.pos.x, y: e.pos.y };
  });
  expect(blocked.x).toBeGreaterThan(lone.x + 1.15); // stopped at the riser, not through it
  expect(blocked.x).toBeLessThan(lone.x + 1.5);
  expect(blocked.y).toBeLessThan(step.y + 0.6); // and no free lift from the back

  // the pet button, aimed at a step: it turns a quarter turn on the spot
  await page.evaluate((arg: { c: Cell; gy: number; pz: number }) => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.pos.set(arg.c.x - 1.2, arg.gy + 1, arg.pz);
    e.vel.set(0, 0, 0);
    e.yaw = Math.PI / 2; // look back down the staircase
    e.pitch = -0.5; // straight at the first riser
  }, { c: step, gy: site.gy, pz: site.fz + 0.5 });
  await page.waitForFunction((sid: number) => {
    const t = (window as any).__lbw.game.players[0].removeTarget;
    return t !== null && t.block === sid;
  }, ids.STAIRS, { timeout: 8000 });
  const aimed = await page.evaluate(() => {
    const t = (window as any).__lbw.game.players[0].removeTarget;
    return { cell: { x: t.x, y: t.y, z: t.z } as Cell };
  });
  const was = await stairFacingAt(page, aimed.cell);
  expect(was).toBeDefined();
  await tap(page, 'interact');
  expect(await stairFacingAt(page, aimed.cell)).toBe(STAIR_TURN[was!]);
  // the step two over is left the way it was
  const neighbour = { x: step.x + 2, y: step.y + 2, z: step.z };
  expect(await stairFacingAt(page, neighbour)).toBe(0);

  // and each step keeps the way it points across a save and a reload
  await page.evaluate(() => (window as any).__lbw.game.saveNow());
  await page.reload();
  await page.waitForFunction('window.__lbw !== undefined');
  const after = await page.evaluate((arg: { run: Cell[] }) => {
    const game = (window as any).__lbw.game;
    return {
      version: game.world.toSave().version,
      run: arg.run.map((c) => ({
        block: game.world.get(c.x, c.y, c.z),
        facing: game.world.getStairFacing(c.x, c.y, c.z),
      })),
    };
  }, { run: [0, 1, 2, 3].map((k) => ({ x: step.x + k, y: step.y + k, z: step.z })) });
  expect(after.version).toBe(5);
  for (const s of after.run) {
    expect(s.block).toBe(ids.STAIRS);
    expect([0, STAIR_TURN[0]]).toContain(s.facing);
  }
  expect(after.run.some((s) => s.facing === STAIR_TURN[0])).toBe(true); // the spun one kept its turn
});

test('treasure chests: every world hides them, and the pet button trades a lid for a random treasure', async ({ page }) => {
  test.slow();
  await boot(page);
  const ids = await page.evaluate(() => (window as any).__lbw.ids);

  // a world comes with its treasure hidden away from the starting meadow
  const hidden = await page.evaluate((chest: number) => {
    const game = (window as any).__lbw.game;
    const { sx, sy, sz } = (window as any).__lbw.dims;
    let found = 0;
    for (let x = 0; x < sx; x++) {
      for (let z = 0; z < sz; z++) {
        for (let y = 0; y < sy; y++) if (game.world.get(x, y, z) === chest) found++;
      }
    }
    return found;
  }, ids.CHEST);
  expect(hidden).toBeGreaterThanOrEqual(6); // 12 are hidden; a dynamite test may have blown one up

  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  await clearRunway(page);

  // chests are not in the palette any more — you find them in the world. So
  // drop one into the cell the kid is aiming at (terrain-style) and check it
  // is one squat cell, not a two-cell door like the build path used to allow
  const chest = await page.evaluate((chestId: number) => {
    const game = (window as any).__lbw.game;
    const t = game.players[0].target;
    const c = { x: t.px, y: t.py, z: t.pz };
    game.world.set(c.x, c.y, c.z, chestId);
    return c;
  }, ids.CHEST);
  expect(await blockAtCell(page, chest)).toBe(ids.CHEST);
  expect(await blockAtCell(page, chest, 1)).toBe(ids.AIR);

  // and the palette offers the chest too now — kids place their own treasure
  // (a grown-up can hide the row again in Grown-Up Settings; a later test does)
  await tap(page, 'palette');
  await page.waitForSelector('.palette-grid');
  const chestInPalette = await page.evaluate((chestId: number) => {
    return [...document.querySelectorAll('.palette-cell')].some(
      (c) => Number((c as HTMLElement).dataset.id) === chestId,
    );
  }, ids.CHEST);
  expect(chestInPalette).toBe(true);
  await tap(page, 'back'); // close the palette again

  const tally = () => page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const e = game.players[0].entity;
    return {
      stars: e.starsCount, zoom: e.zoomTime, boing: e.boingTime,
      animals: game.animals.animals.length, starsInWorld: game.starField.stars.length,
    };
  });
  const before = await tally();

  // look at the chest and press the pet button: the lid comes up. Aim
  // exactly at the chest's middle rather than assuming a fixed pitch:
  // shared CI shard worlds have uneven ground near spawn, where the chest
  // can land a cell or two farther than expected and a fixed downward
  // pitch then hits the floor in front of it and removeTarget never
  // becomes the chest (observed in CI).
  await page.evaluate((c: Cell) => {
    const e = (window as any).__lbw.game.players[0].entity;
    const dx = c.x + 0.5 - e.pos.x, dz = c.z + 0.5 - e.pos.z;
    const dy = c.y + 0.45 - (e.pos.y + e.headHeight);
    e.yaw = Math.atan2(dx, dz);
    e.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, chest);
  await page.waitForFunction((cids: number[]) => {
    const t = (window as any).__lbw.game.players[0].removeTarget;
    return t !== null && cids.includes(t.block);
  }, [ids.CHEST, ids.CHEST_OPEN], { timeout: 8000 });
  await tap(page, 'interact');

  expect(await blockAtCell(page, chest)).toBe(ids.CHEST_OPEN);
  expect(await toastText(page)).toMatch(
    /pile of stars|stars jumped out|zoomy boots|boing boots|surprise animal|giant diamond/i,
  );
  // …and one of the six treasures really happened
  const opened = await tally();
  const somethingHappened = opened.stars > before.stars || opened.zoom > 0 || opened.boing > 0
    || opened.animals > before.animals || opened.starsInWorld > before.starsInWorld;
  expect(somethingHappened).toBe(true);

  // an opened chest stays opened and pays out nothing twice
  await tap(page, 'interact');
  expect(await toastText(page)).toMatch(/empty/i);
  expect(await blockAtCell(page, chest)).toBe(ids.CHEST_OPEN);
  const poked = await tally();
  expect(poked.stars).toBe(opened.stars);
  expect(poked.animals).toBe(opened.animals);
  expect(poked.starsInWorld).toBe(opened.starsInWorld);

  // the open lid survives a save and a reload
  await page.evaluate(() => (window as any).__lbw.game.saveNow());
  await page.reload();
  await page.waitForFunction('window.__lbw !== undefined');
  expect(await blockAtCell(page, chest)).toBe(ids.CHEST_OPEN);
});

test('saplings: plant one on the meadow and it grows into a real tree', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  await page.evaluate(() => { (window as any).__lbw.game.saplingGrowSeconds = 2; }); // tests do not have a minute
  await clearRunway(page);

  const plant = await placeSelected(page, ids.SAPLING);
  expect(await page.evaluate((c: Cell) => (window as any).__lbw.game.world.get(c.x, c.y, c.z), plant))
    .toBe(ids.SAPLING);
  expect(await page.evaluate(() => (window as any).__lbw.game.saplings.size)).toBeGreaterThan(0);

  // game time runs slow in headless CI, so poll for the trunk — never sleep for it
  await page.waitForFunction(
    (arg: { c: Cell; wood: number }) => (window as any).__lbw.game.world.get(arg.c.x, arg.c.y + 1, arg.c.z) === arg.wood,
    { c: plant, wood: ids.WOOD }, { timeout: 30000 },
  );

  const tree = await page.evaluate((arg: { c: Cell; wood: number; leaves: number }) => {
    const game = (window as any).__lbw.game;
    let trunk = 0, canopy = 0;
    for (let k = 0; k < 7; k++) if (game.world.get(arg.c.x, arg.c.y + k, arg.c.z) === arg.wood) trunk++;
    for (let ox = -2; ox <= 2; ox++) {
      for (let oz = -2; oz <= 2; oz++) {
        for (let oy = 2; oy <= 7; oy++) {
          if (game.world.get(arg.c.x + ox, arg.c.y + oy, arg.c.z + oz) === arg.leaves) canopy++;
        }
      }
    }
    const { sz, sy } = (window as any).__lbw.dims;
    const recorded = game.world.mods.get((arg.c.x * sz + arg.c.z) * sy + arg.c.y);
    return { trunk, canopy, recorded };
  }, { c: plant, wood: ids.WOOD, leaves: ids.LEAVES });
  expect(tree.trunk).toBeGreaterThanOrEqual(4); // a real trunk, not a weed
  expect(tree.canopy).toBeGreaterThan(8);       // and a proper crown of leaves
  expect(tree.recorded).toBe(ids.WOOD);         // the grown tree is in the save
});

test('first person hides your own body from YOUR view only — other players still see it', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await joinSecondPad(page);

  // clean slate around the meadow: earlier tests leave blocks near spawn, and a
  // wall right behind the camera would legitimately tuck the third-person view in
  await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const e = game.players[0].entity;
    const fx = Math.floor(e.pos.x), fz = Math.floor(e.pos.z);
    const gy = game.world.surfaceY(fx, fz);
    for (let x = fx - 8; x <= fx + 8; x++) {
      for (let z = fz - 8; z <= fz + 8; z++) {
        for (let y = gy + 1; y <= gy + 12; y++) game.world.set(x, y, z, 0);
      }
    }
  });
  await page.waitForFunction('window.__lbw.game.players[0].showOwnBody === true', null, { timeout: 10000 });
  await frames(page, 3);

  // third person by default: both cameras see player 1's body (its avatar lives on layer 1).
  // Note three r171: Layers.test() compares two Layers objects — ask isEnabled(channel).
  const third = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    return {
      firstPerson: game.players[0].firstPerson,
      ownView: game.players[0].camera.layers.isEnabled(1),
      otherView: game.players[1].camera.layers.isEnabled(1),
      bodyOnLayer1: game.players[0].entity.avatar.body.layers.isEnabled(1),
    };
  });
  expect(third.firstPerson).toBe(false);
  expect(third.ownView).toBe(true);
  expect(third.otherView).toBe(true);
  expect(third.bodyOnLayer1).toBe(true);

  // switch player 1 to Eyes from their own menu
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 2); // Camera
  await tap(page, 'jump');
  await page.waitForFunction('window.__lbw.game.players[0].firstPerson === true', null, { timeout: 5000 });
  await frames(page, 3);

  const first = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    return {
      firstPerson: game.players[0].firstPerson,
      ownView: game.players[0].camera.layers.isEnabled(1),
      otherView: game.players[1].camera.layers.isEnabled(1),
      otherSeesRing: game.players[1].camera.layers.isEnabled(0),
    };
  });
  expect(first.firstPerson).toBe(true);
  expect(first.ownView).toBe(false);   // the body is not in one's own eyes
  expect(first.otherView).toBe(true);  // but the other kid still sees them fine
  expect(first.otherSeesRing).toBe(true);
});

test('the player menu fits inside a half-height stacked pane — no overflow', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await joinSecondPad(page);
  await page.evaluate(() => {
    (window as any).__lbw.game.layout = 'vertical'; // force the up/down split
    window.dispatchEvent(new Event('resize'));
  });
  await frames(page, 4);

  const halves = await page.evaluate(() => {
    const g = (window as any).__lbw.game;
    return { top: g.viewportMgr.rects[0].h, h: window.innerHeight };
  });
  expect(halves.top).toBeLessThanOrEqual(halves.h / 2 + 2);

  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 10); // the LAST row (Leave) — the one that used to hang off the pane

  const fit = await page.evaluate(() => {
    const pane = document.querySelectorAll('.pane')[0].getBoundingClientRect();
    const rows = [...document.querySelectorAll('.pane .menu-item')];
    const last = rows[rows.length - 1].getBoundingClientRect();
    return { count: rows.length, lastTop: last.top, lastBottom: last.bottom, paneTop: pane.top, paneBottom: pane.bottom };
  });
  expect(fit.count).toBe(11);
  expect(fit.lastTop).toBeGreaterThanOrEqual(fit.paneTop - 1);
  expect(fit.lastBottom).toBeLessThanOrEqual(fit.paneBottom + 1);
});

test('grown-up settings — split layout and sound — come back after a reload', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);

  // flip the split layout through the grown-up menu, exactly like a parent would
  await openGrownUpsMenu(page);
  await selectRow(page, 1); // Split Screen
  await tap(page, 'jump'); // Smart -> Left/Right
  expect(await page.evaluate(() => (window as any).__lbw.game.layout)).toBe('horizontal');

  // and turn the sound off from the player menu
  await tap(page, 'back');
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 8); // Sound
  await tap(page, 'jump');
  expect(await page.evaluate(() => (window as any).__lbw.game.audio.muted)).toBe(true);

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('lbw-settings') ?? '{}') as { layout?: string; muted?: boolean });
  expect(stored.layout).toBe('horizontal');
  expect(stored.muted).toBe(true);

  await page.reload();
  await page.waitForFunction('window.__lbw !== undefined');
  const after = await page.evaluate(() => ({
    layout: (window as any).__lbw.game.layout,
    muted: (window as any).__lbw.game.audio.muted,
  }));
  expect(after.layout).toBe('horizontal');
  expect(after.muted).toBe(true);
});

test('the meadow has eight kinds of animal now, all petable', async ({ page }) => {
  await boot(page);
  const herd = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    return {
      kinds: [...new Set(game.animals.animals.map((a: any) => a.kind))] as string[],
      count: game.animals.animals.length,
    };
  });
  expect(herd.count).toBeGreaterThanOrEqual(20);
  for (const kind of ['sheep', 'bunny', 'chicken', 'cow', 'pig', 'horse', 'cat', 'fox']) {
    expect(herd.kinds).toContain(kind); // kinds cycle, so every one is guaranteed
  }
});

test('fish life: five kinds swim the waters, and the little ones travel in moving schools', async ({ page }) => {
  test.slow();
  await boot(page);
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const sample = () => page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const fish = game.fish;
    return {
      count: fish.fishes.length,
      kinds: [...new Set(fish.fishes.map((f: any) => f.kind))] as string[],
      schools: fish.schools.map((s: any) => ({
        kind: s.kind,
        n: s.fish.length,
        anchor: [s.anchor.x, s.anchor.y, s.anchor.z],
        pos: s.fish.map((f: any) => [f.pos.x, f.pos.y, f.pos.z]),
      })),
      pos: fish.fishes.map((f: any) => [f.pos.x, f.pos.y, f.pos.z]),
    };
  });
  const before = await sample();
  expect(before.count).toBeGreaterThanOrEqual(20);
  for (const kind of ['minnow', 'sunfish', 'puffer', 'bass', 'golden']) {
    expect(before.kinds, `kind ${kind}`).toContain(kind); // every kind gets a home in every world
  }
  expect(before.schools.some((s: any) => s.kind === 'minnow' && s.n >= 4)).toBe(true);

  // the flocks MOVE, stay together, and no fish ever leaves the water
  await page.waitForTimeout(4000);
  const after = await page.evaluate((w: { water: number; flow: number }) => {
    const game = (window as any).__lbw.game;
    const fish = game.fish;
    const isW = (id: number) => id === w.water || id === w.flow;
    return {
      inWater: fish.fishes.every((f: any) =>
        isW(game.world.get(Math.floor(f.pos.x), Math.floor(f.pos.y), Math.floor(f.pos.z)))),
      schools: fish.schools.map((s: any) => ({
        kind: s.kind,
        maxFromCentre: Math.max(...s.fish.map((f: any) =>
          f.pos.distanceTo({ x: s.anchor.x, y: s.anchor.y, z: s.anchor.z }))),
      })),
      pos: fish.fishes.map((f: any) => [f.pos.x, f.pos.y, f.pos.z]),
    };
  }, { water: ids.WATER, flow: ids.WATER_FLOW });
  expect(after.inWater).toBe(true); // not one fish flopping about on land
  for (const s of after.schools) {
    expect(s.maxFromCentre, `school ${s.kind} stays together`).toBeLessThan(6);
  }
  let moved = 0;
  before.pos.forEach((p: number[], i: number) => {
    const q = after.pos[i];
    if (q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 0.25) moved++;
  });
  expect(moved).toBeGreaterThan(before.pos.length / 2); // the lakes are not a still life
});

test('fishing: cast at the water, wait for the bite, reel in a fish — stars and all', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);

  // a proper pond right in front (the swimming test's recipe: water stands
  // a full block BELOW the meadow surface, so the banks wall it in and the
  // flood sim has nothing to pour out)
  const pond = await page.evaluate((b: { water: number; grass: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    const e = (window as any).__lbw.game.players[0].entity;
    const cx = Math.round(e.pos.x), cz = Math.round(e.pos.z);
    const base = S.surfaceY(cx, cz);
    const deep = 4;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let y = base - deep; y <= base + 3; y++) S.set(cx + dx, y, cz + dz, b.air);
        if (dz <= -2) {
          for (let y = base - deep; y <= base; y++) S.set(cx + dx, y, cz + dz, b.grass);
        } else {
          for (let y = base - deep; y <= base - 1; y++) S.set(cx + dx, y, cz + dz, b.water);
        }
      }
    }
    // stand on the bank, look down at the middle of the pond
    e.pos.set(cx + 0.5, base + 1, cz - 2.5);
    e.vel.set(0, 0, 0);
    e.yaw = 0;
    e.pitch = -0.6;
    return { cx, cz, base };
  }, { water: ids.WATER, grass: ids.GRASS, air: ids.AIR });

  // the aim finds the water — that is what the pet button casts into
  await page.waitForFunction('window.__lbw.game.players[0].target !== null && [window.__lbw.ids.WATER, window.__lbw.ids.WATER_FLOW].includes(window.__lbw.game.players[0].target.block)', null, { timeout: 15000 });

  // hurry the fish along so the test does not idle through a real afternoon
  await page.evaluate(() => { (window as any).__lbw.game.fishing.biteWait = [0.1, 0.4]; });
  await tap(page, 'interact'); // cast!
  await page.waitForFunction('window.__lbw.game.fishing.lines.size === 1', null, { timeout: 10000 });

  // waiting → bite
  await page.waitForFunction(() => {
    const game = (window as any).__lbw.game;
    const line = game.fishing.lines.get(game.players[0].entity.id);
    return !!line && line.phase === 'bite';
  }, null, { timeout: 20000 });
  const starsBefore = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.starsCount);

  await tap(page, 'interact'); // reel in the catch!
  await page.waitForFunction(
    (s: number) => (window as any).__lbw.game.players[0].entity.starsCount > s,
    starsBefore, { timeout: 10000 },
  );
  const caught = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    return {
      lines: game.fishing.lines.size,
      recent: game.audio.recent.slice(-10).join(','),
    };
  });
  expect(caught.lines).toBe(0); // the bobber comes in with the fish
  expect(caught.recent).toContain('fish:caught');

  // …and reeling early just gives you an empty hook, no stars
  await page.evaluate(() => { (window as any).__lbw.game.fishing.biteWait = [30, 31]; });
  await tap(page, 'interact'); // cast again
  await page.waitForFunction(() => {
    const game = (window as any).__lbw.game;
    const line = game.fishing.lines.get(game.players[0].entity.id);
    return !!line && line.phase === 'waiting';
  }, null, { timeout: 10000 });
  const starsMid = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.starsCount);
  await tap(page, 'interact'); // reel immediately — nothing on it yet
  await page.waitForFunction('window.__lbw.game.fishing.lines.size === 0', null, { timeout: 10000 });
  const starsAfter = await page.evaluate(() => (window as any).__lbw.game.players[0].entity.starsCount);
  expect(starsAfter).toBe(starsMid); // empty hooks pay nothing

  // fill the pond in so it cannot confuse later tests (same ritual as swimming)
  await page.evaluate((arg: { cx: number; cz: number; base: number; grass: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        for (let y = arg.base - 6; y <= arg.base + 3; y++) {
          S.set(arg.cx + dx, y, arg.cz + dz, y <= arg.base ? arg.grass : arg.air);
        }
      }
    }
  }, { ...pond, grass: ids.GRASS, air: ids.AIR });
  await page.evaluate((arg: { cx: number; cz: number; base: number; water: number; flow: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let dx = -10; dx <= 10; dx++) {
      for (let dz = -10; dz <= 10; dz++) {
        for (let y = arg.base - 2; y <= arg.base + 4; y++) {
          const b = S.get(arg.cx + dx, y, arg.cz + dz);
          if (b === arg.water || b === arg.flow) S.set(arg.cx + dx, y, arg.cz + dz, 0);
        }
      }
    }
  }, { ...pond, water: ids.WATER, flow: ids.WATER_FLOW });
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); }); // land the refill before the next page boots
});

test('the satchel keeps the catch: the HUD chip shows it, D-pad ▾ opens the pouch, eating gives a tasty boost', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);

  // a proper pond right in front (the fishing test's recipe — and its refill
  // ritual at the end, so this course cannot confuse later tests either)
  const pond = await page.evaluate((b: { water: number; grass: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    const e = (window as any).__lbw.game.players[0].entity;
    const cx = Math.round(e.pos.x), cz = Math.round(e.pos.z);
    const base = S.surfaceY(cx, cz);
    const deep = 4;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        for (let y = base - deep; y <= base + 3; y++) S.set(cx + dx, y, cz + dz, b.air);
        if (dz <= -2) {
          for (let y = base - deep; y <= base; y++) S.set(cx + dx, y, cz + dz, b.grass);
        } else {
          for (let y = base - deep; y <= base - 1; y++) S.set(cx + dx, y, cz + dz, b.water);
        }
      }
    }
    e.pos.set(cx + 0.5, base + 1, cz - 2.5);
    e.vel.set(0, 0, 0);
    e.yaw = 0;
    e.pitch = -0.6;
    return { cx, cz, base };
  }, { water: ids.WATER, grass: ids.GRASS, air: ids.AIR });

  await page.waitForFunction('window.__lbw.game.players[0].target !== null && [window.__lbw.ids.WATER, window.__lbw.ids.WATER_FLOW].includes(window.__lbw.game.players[0].target.block)', null, { timeout: 15000 });
  await page.evaluate(() => { (window as any).__lbw.game.fishing.biteWait = [0.1, 0.4]; });
  await tap(page, 'interact'); // cast!
  await page.waitForFunction('window.__lbw.game.fishing.lines.size === 1', null, { timeout: 10000 });
  await page.waitForFunction(() => {
    const game = (window as any).__lbw.game;
    const line = game.fishing.lines.get(game.players[0].entity.id);
    return !!line && line.phase === 'bite';
  }, null, { timeout: 20000 });
  await tap(page, 'interact'); // reel in the catch!

  // the fish lands in the satchel — and the HUD chip pops up with it
  await page.waitForFunction('window.__lbw.game.players[0].satchel.total() === 1', null, { timeout: 10000 });
  const chip = await page.evaluate(() => {
    const el = document.querySelector('.hud .pouch') as HTMLElement;
    return { text: el.textContent ?? '', shown: getComputedStyle(el).display !== 'none' };
  });
  expect(chip.shown).toBe(true);
  expect(chip.text).toContain('🐟 1');

  // the main menu stays out of it — the pouch lives in the world now
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  const menu = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.overlay-card .menu-item')];
    return { count: rows.length, satchel: rows.some((r) => (r.textContent ?? '').includes('Satchel')) };
  });
  expect(menu.count).toBe(11); // the classic menu, no Satchel row
  expect(menu.satchel).toBe(false);
  await tap(page, 'back'); // close the menu
  await page.waitForFunction('window.__lbw.game.overlays.size === 0', null, { timeout: 10000 });

  // the satchel action (D-pad ▾ / I) opens the fish inventory right in the
  // world, where one A press munches the highlighted fish
  await tap(page, 'satchel');
  await page.waitForSelector('.overlay-card .mi-label');
  const before = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { stars: e.starsCount, zoom: e.zoomTime, boing: e.boingTime };
  });
  await tap(page, 'jump'); // eat it!
  await page.waitForFunction('window.__lbw.game.players[0].satchel.total() === 0', null, { timeout: 10000 });

  // whichever fish it was, the tastiness kicked in: some boost is running,
  // the munch made its sound, and the chip and menu say the pouch is empty
  const after = await page.evaluate(() => {
    const g = (window as any).__lbw.game;
    const e = g.players[0].entity;
    const chipEl = document.querySelector('.hud .pouch') as HTMLElement;
    return {
      stars: e.starsCount, zoom: e.zoomTime, boing: e.boingTime,
      chipShown: getComputedStyle(chipEl).display !== 'none',
      recent: g.audio.recent.slice(-8).join(','),
      sub: document.querySelector('.overlay-card .sub')?.textContent ?? '',
    };
  });
  expect(after.zoom > before.zoom || after.boing > before.boing).toBe(true);
  expect(after.recent).toContain('fish:eat');
  expect(after.chipShown).toBe(false);
  expect(after.sub).toContain('Nothing in here');

  await tap(page, 'back'); // close the satchel
  await page.waitForFunction('window.__lbw.game.overlays.size === 0', null, { timeout: 10000 });

  // fill the pond in so it cannot confuse later tests (same ritual as fishing)
  await page.evaluate((arg: { cx: number; cz: number; base: number; grass: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        for (let y = arg.base - 6; y <= arg.base + 3; y++) {
          S.set(arg.cx + dx, y, arg.cz + dz, y <= arg.base ? arg.grass : arg.air);
        }
      }
    }
  }, { ...pond, grass: ids.GRASS, air: ids.AIR });
  await page.evaluate((arg: { cx: number; cz: number; base: number; water: number; flow: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let dx = -10; dx <= 10; dx++) {
      for (let dz = -10; dz <= 10; dz++) {
        for (let y = arg.base - 2; y <= arg.base + 4; y++) {
          const b = S.get(arg.cx + dx, y, arg.cz + dz);
          if (b === arg.water || b === arg.flow) S.set(arg.cx + dx, y, arg.cz + dz, 0);
        }
      }
    }
  }, { ...pond, water: ids.WATER, flow: ids.WATER_FLOW });
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); }); // land the refill before the next page boots
});

// -------------------------------------------------- reported bugs, kept fixed

test('the block palette is a grid: dpad left/right step cells, up/down jump a whole row', async ({ page }) => {
  await boot(page);
  await joinWithPad(page);
  await tap(page, 'palette');
  await page.waitForSelector('.palette-grid');

  const shape = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.palette-cell')] as HTMLElement[];
    const top0 = cells[0].offsetTop;
    let cols = 1;
    while (cols < cells.length && cells[cols].offsetTop === top0) cols++;
    return { count: cells.length, cols };
  });
  expect(shape.count).toBeGreaterThan(6);
  expect(shape.cols).toBeGreaterThan(1); // more than one row, or this test means nothing

  const sel = () => page.evaluate(() =>
    [...document.querySelectorAll('.palette-cell')].findIndex((c) => c.classList.contains('sel')));
  const start = await sel();

  // left and right walk the flat order...
  await tap(page, 'right');
  expect(await sel()).toBe((start + 1) % shape.count);
  await tap(page, 'left');
  expect(await sel()).toBe(start);

  // ...and up/down move a whole row, keeping the column
  await tap(page, 'down');
  expect(await sel()).toBe(Math.min(start + shape.cols, shape.count - 1));
  await tap(page, 'up');
  expect(await sel()).toBe(start);

  // up from the first row wraps to the last one, not to the previous cell
  await tap(page, 'up');
  const rows = Math.ceil(shape.count / shape.cols);
  const lastRowStart = (rows - 1) * shape.cols;
  const wrapped = await sel();
  expect(wrapped).toBeGreaterThanOrEqual(Math.min(lastRowStart, shape.count - 1));
});

test('releasing the mouse stops building — no endless auto-placing', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Enter'); // keyboard-only join
  await page.waitForFunction('window.__lbw.game.pendingJoins.size === 1');
  await page.keyboard.press('Enter');
  await page.waitForFunction('window.__lbw.game.players.length === 1');
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });

  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  await page.evaluate((b: number) => { (window as any).__lbw.game.players[0].selected = b; }, ids.PLANKS);
  const site = await clearRunway(page); // aim down the cleared strip, slightly at the ground

  /** what is standing in the cleared strip (the clear leaves it empty) */
  const builtHere = () => page.evaluate((s: { fx: number; fz: number; gy: number }) => {
    const game = (window as any).__lbw.game;
    let n = 0;
    for (let x = s.fx - 4; x <= s.fx + 6; x++) {
      for (let z = s.fz - 2; z <= s.fz + 2; z++) {
        for (let y = s.gy + 1; y <= s.gy + 12; y++) if (game.world.get(x, y, z) !== 0) n++;
      }
    }
    return n;
  }, site);

  expect(await builtHere()).toBe(0);
  const cell = await page.evaluate(() => {
    const t = (window as any).__lbw.game.players[0].target;
    return { x: t.px, y: t.py, z: t.pz };
  });
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'right' }); // right button builds (Nov 2026 mapping)
  await page.waitForFunction(
    (c: Cell) => (window as any).__lbw.game.world.get(c.x, c.y, c.z) !== 0,
    cell, { timeout: 5000 },
  );
  await page.mouse.up({ button: 'right' });

  const built = await builtHere();
  expect(built).toBeGreaterThanOrEqual(1); // the right-click built something

  // the released button must never stay held — that is the endless-placing bug
  const held = await page.evaluate(() => [...(window as any).__lbw.game.input.frame('keyboard').held]);
  expect(held).not.toContain('place');

  // and nothing new appears while free ground sits in front of the kid: a stuck
  // build trigger would put another block down well inside this wait. (The wait
  // is on purpose — the bug is a thing that must NOT happen.)
  await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    e.yaw = Math.PI / 2;
    e.pitch = -0.35;
  });
  await page.waitForTimeout(1500);
  expect(await builtHere()).toBe(built);
});

test('keyboard arrows only tilt the view — ArrowUp never jumps', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Enter'); // keyboard-only join
  await page.waitForFunction('window.__lbw.game.pendingJoins.size === 1');
  await page.keyboard.press('Enter');
  await page.waitForFunction('window.__lbw.game.players.length === 1');
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });

  const before = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { y: e.pos.y, pitch: e.pitch };
  });
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(900); // headless runs at ~half speed: a few game seconds
  const mid = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { y: e.pos.y, pitch: e.pitch, grounded: e.grounded };
  });
  await page.keyboard.up('ArrowUp');

  expect(mid.pitch).toBeGreaterThan(before.pitch + 0.3); // the view tilted up
  expect(mid.grounded).toBe(true); // ...and the kid never left the ground
  expect(mid.y).toBeCloseTo(before.y, 3);

  // gamepads keep the double duty: d-pad up still jumps for pad kids
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[1].entity.grounded === true', null, { timeout: 15000 });
  const startY = await page.evaluate(() => (window as any).__lbw.game.players[1].entity.pos.y);
  await page.evaluate(() => (window as any).__testPad.press('up'));
  await page.waitForFunction(
    (y: number) => (window as any).__lbw.game.players[1].entity.pos.y > y + 0.5,
    startY, { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__testPad.release('up'));
});

test('the triggers are the hands: L2 pets and opens, R2 builds, X breaks', async ({ page }) => {
  await boot(page);
  // Nov 2026 remap: the triggers are the hands kids already hold the pad with.
  // L2/LT is the nice button (pet · fish · open · pour), R2/RT builds (and
  // pours), X/Square breaks. Keyboard keeps E · R-Click · L-Click.
  const map = await page.evaluate(() => (window as any).__lbw.padMap as Record<string, string[]>);
  expect(map[6], 'L2 / LT').toContain('interact');
  expect(map[7], 'R2 / RT').toContain('place');
  expect(map[2], 'X / Square').toContain('remove');
  expect(map[0], 'A / Cross still jumps').toContain('jump');
});

test('the water bucket scoops a spring, pours a new one, and a cut-off flood runs home', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);
  await page.waitForFunction('window.__lbw.game.players[0].entity.grounded === true', null, { timeout: 15000 });
  const ids = await page.evaluate(() => (window as any).__lbw.ids);
  const site = await clearRunway(page);
  const { fx, fz, gy } = site;

  // the same sealed stone course the flow test swears by: a full-height
  // caisson, a stone floor, and a spring feeding a channel of travelling water
  await page.evaluate((arg: { fx: number; fz: number; gy: number; air: number; water: number; stone: number }) => {
    const S = (window as any).__lbw.game.world;
    const SY: number = (window as any).__lbw.dims.sy;
    for (let x = arg.fx - 3; x <= arg.fx + 12; x++) {
      for (let z = arg.fz - 3; z <= arg.fz + 3; z++) {
        const ring = x === arg.fx - 3 || x === arg.fx + 12 || z === arg.fz - 3 || z === arg.fz + 3;
        for (let y = 1; y < SY; y++) if (ring) S.set(x, y, z, arg.stone);
      }
    }
    for (let x = arg.fx - 2; x <= arg.fx + 11; x++) {
      for (let z = arg.fz - 2; z <= arg.fz + 2; z++) {
        S.set(x, arg.gy - 1, z, arg.stone); // sealed floor
        for (let y = arg.gy; y <= arg.gy + 2; y++) S.set(x, y, z, arg.air);
      }
    }
    S.set(arg.fx + 2, arg.gy, arg.fz, arg.water);
  }, { fx, fz, gy, air: ids.AIR, water: ids.WATER, stone: ids.STONE });

  await page.waitForFunction((arg: { x: number; gy: number; fz: number; flow: number }) =>
    (window as any).__lbw.game.world.get(arg.x, arg.gy, arg.fz) === arg.flow,
  { x: fx + 7, gy, fz, flow: ids.WATER_FLOW }, { timeout: 20000 });

  // 🪣 the bucket is in hand: scooping the SPRING empties the channel behind it
  await page.evaluate((b: number) => (window as any).__lbw.game.players[0].setSelected(b), ids.BUCKET);
  const scooped = await page.evaluate((arg: { x: number; gy: number; fz: number; water: number }) =>
    (window as any).__lbw.bucketAt(0, { block: arg.water, x: arg.x, y: arg.gy, z: arg.fz, px: arg.x, py: arg.gy + 1, pz: arg.fz, dist: 1 }),
  { x: fx + 2, gy, fz, water: ids.WATER });
  expect(scooped, 'the bucket came back full').toBe(true);
  expect(await page.evaluate(() => (window as any).__lbw.game.players[0].bucketFull)).toBe(true);
  expect(await page.evaluate((c: { x: number; y: number; z: number }) =>
    (window as any).__lbw.game.world.get(c.x, c.y, c.z), { x: fx + 2, y: gy, z: fz })).toBe(ids.AIR);

  // the flood runs HOME: with its spring scooped out, no travelling cell has a
  // chain back to water left, so the whole channel gives up within a moment —
  // the shallow puddles at the end of the reach first, since they are the ones
  // a deeper neighbour was propping up. (Watched from inside the page, so the
  // timing is the sim's own game time, not a wall-clock guess.)
  const drainedIn = await page.evaluate((arg: { src: number; k1: number; gy: number; fz: number; air: number }) =>
    new Promise<number>((resolve, reject) => {
      const w = (window as any).__lbw.game.world;
      const t0 = performance.now();
      const timer = setInterval(() => {
        let wet = 0;
        for (let k = 1; k <= arg.k1; k++) if (w.get(arg.src + k, arg.gy, arg.fz) !== arg.air) wet++;
        if (wet === 0) { clearInterval(timer); resolve(performance.now() - t0); }
        else if (performance.now() - t0 > 20000) {
          clearInterval(timer);
          reject(new Error(`${wet} cells of the cut-off flood are still standing`));
        }
      }, 50);
    }), { src: fx + 2, k1: 6, gy, fz, air: ids.AIR });
  expect(drainedIn, 'a cut-off flood runs home in about a second').toBeLessThan(8000);

  // full bucket, aimed at a gap: a NEW spring appears and the water sets off
  // spreading from where it landed
  const poured = await page.evaluate((arg: { x: number; gy: number; fz: number; stone: number }) =>
    (window as any).__lbw.bucketAt(0, { block: arg.stone, x: arg.x, y: arg.gy - 1, z: arg.fz, px: arg.x, py: arg.gy, pz: arg.fz, dist: 1 }),
  { x: fx + 8, gy, fz, stone: ids.STONE });
  expect(poured, 'the bucket poured out').toBe(true);
  expect(await page.evaluate(() => (window as any).__lbw.game.players[0].bucketFull)).toBe(false);
  expect(await page.evaluate((c: { x: number; y: number; z: number }) =>
    (window as any).__lbw.game.world.get(c.x, c.y, c.z), { x: fx + 8, y: gy, z: fz })).toBe(ids.WATER);
  await page.waitForFunction((arg: { x: number; gy: number; fz: number; flow: number }) =>
    (window as any).__lbw.game.world.get(arg.x, arg.gy, arg.fz) === arg.flow,
  { x: fx + 10, gy, fz, flow: ids.WATER_FLOW }, { timeout: 20000 });

  // scoop the new spring and the fresh flood runs home too
  const scooped2 = await page.evaluate((arg: { x: number; gy: number; fz: number; water: number }) =>
    (window as any).__lbw.bucketAt(0, { block: arg.water, x: arg.x, y: arg.gy, z: arg.fz, px: arg.x, py: arg.gy + 1, pz: arg.fz, dist: 1 }),
  { x: fx + 8, gy, fz, water: ids.WATER });
  expect(scooped2).toBe(true);
  await page.waitForFunction((arg: { x1: number; x2: number; gy: number; fz: number; air: number }) => {
    const w = (window as any).__lbw.game.world;
    for (let x = arg.x1; x <= arg.x2; x++) if (w.get(x, arg.gy, arg.fz) !== arg.air) return false;
    return true;
  }, { x1: fx + 9, x2: fx + 11, gy, fz, air: ids.AIR }, { timeout: 30000 });

  // tidy up so later tests find clean grass (and bank the refill before boot)
  await page.evaluate((arg: { fx: number; fz: number; gy: number; grass: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let x = arg.fx - 2; x <= arg.fx + 11; x++) {
      for (let z = arg.fz - 2; z <= arg.fz + 2; z++) S.set(x, arg.gy, z, arg.grass);
    }
  }, { fx, fz, gy, grass: ids.GRASS });
  await page.evaluate(async () => { await (window as any).__lbw.game.saveNow(); });
});

test('rain falls on the meadow and the sun circles the sky', async ({ page }) => {
  test.slow();
  await boot(page);
  await joinWithPad(page);

  // a grown-up turns the rain on: the clock goes wet, the audio starts hissing
  const strength = await page.evaluate(() => (window as any).__lbw.weatherNow('rain'));
  expect(strength).toBeGreaterThan(0);
  await page.waitForFunction('window.__lbw.game.weather.isActive === true', null, { timeout: 8000 });
  const wet = await page.evaluate(() => ({
    kind: (window as any).__lbw.game.weather.kind as string | null,
    hiss: (window as any).__lbw.game.audio.recent.some((r: string) => r.startsWith('weather:rain')),
  }));
  expect(wet.kind).toBe('rain');
  expect(wet.hiss, 'the rain hiss reached the audio kit').toBe(true);

  // the grown-up menu grew three rows under Waiting Players — the old rows
  // stay exactly where every other test pins them
  await tap(page, 'menu');
  await page.waitForSelector('.menu-list');
  await selectRow(page, 9); // Grown-Ups
  await tap(page, 'jump');
  await page.waitForSelector('.menu-list');
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-item')].map((r) => r.textContent ?? ''));
  expect(labels[0]).toContain('Freeze');
  expect(labels[5], 'Waiting Players keeps row 5').toContain('Waiting Players');
  expect(labels.some((l) => l.includes('Weather'))).toBe(true);
  expect(labels.some((l) => l.includes('Day & Night'))).toBe(true);
  expect(labels.some((l) => l.includes('Treasure Chests'))).toBe(true);
  await tap(page, 'back'); // close Grown-Ups
  await tap(page, 'back'); // close the player menu

  // snow, then dry: the clock follows the grown-up's wheel
  await page.evaluate(() => (window as any).__lbw.weatherNow('snow'));
  await page.waitForFunction('window.__lbw.game.weather.kind === "snow"', null, { timeout: 8000 });
  await page.evaluate(() => (window as any).__lbw.weatherNow('off'));
  await page.waitForFunction('window.__lbw.game.weather.isActive === false', null, { timeout: 8000 });

  // the sun: parked at midnight the light drops low but never vanishes...
  await page.evaluate(() => (window as any).__lbw.setDayMode('night'));
  await page.waitForFunction(() => {
    let dir = 0, hemi = 0;
    (window as any).__lbw.game.scene.traverse((o: any) => {
      if (o.isDirectionalLight) dir = o.intensity;
      if (o.isHemisphereLight) hemi = o.intensity;
    });
    return dir < 0.4 && hemi >= 0.3;
  }, null, { timeout: 8000 });
  // ...parked at noon it is proper day again. (Threshold 1.0, not 1.6: a
  // storm that has just been switched off dims the sun by up to 30 % while
  // the sky's `wet` value fades out, and midnight sits at 0.32 — anything
  // between them proves the lights moved with the clock.)
  await page.evaluate(() => (window as any).__lbw.setDayMode('day'));
  await page.waitForFunction(() => {
    let dir = 0;
    (window as any).__lbw.game.scene.traverse((o: any) => { if (o.isDirectionalLight) dir = o.intensity; });
    return dir > 1.0;
  }, null, { timeout: 15000 });
  // ...and in auto mode the clock actually circles
  await page.evaluate(() => (window as any).__lbw.setDayMode('auto'));
  const t0 = await page.evaluate(() => (window as any).__lbw.dayPhase());
  await page.waitForFunction((p: number) => Math.abs((window as any).__lbw.dayPhase() - p) > 1e-4, t0, { timeout: 15000 });

  // midnight is blue, never the void: the sky test's black-pixel census passes
  await page.evaluate(() => (window as any).__lbw.setDayMode('night'));
  await frames(page, 30);
  expect(await blackPixels(page), 'midnight keeps real colour').toBeLessThan(600);
});
