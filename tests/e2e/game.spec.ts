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

  // tap B (the Back button): crouch on — and the shuffle is slow
  await tap(page, 'back');
  await page.waitForFunction('window.__lbw.game.players[0].entity.crouching === true', null, { timeout: 8000 });
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
  // until part 5 asks for their head
  await page.evaluate((arg: { x0: number; z0: number; gy: number; stone: number; air: number }) => {
    const S = (window as any).__lbw.game.world;
    for (let x = arg.x0 - 1; x <= arg.x0 + 7; x++) {
      for (let z = arg.z0 - 1; z <= arg.z0 + 1; z++) {
        for (let y = arg.gy; y <= arg.gy + 6; y++) S.set(x, y, z, y === arg.gy ? arg.stone : arg.air);
      }
    }
  }, { x0, z0, gy, stone: ids.STONE, air: ids.AIR });
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

  // 1) sand dropped in mid-air falls straight down and settles on the ground
  await setCell(x0, gy + 4, z0, ids.SAND);
  await waitForBlock(x0, gy + 1, z0, ids.SAND);
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
  const kid = await page.evaluate(() => {
    const e = (window as any).__lbw.game.players[0].entity;
    return { y: e.pos.y, inWater: e.inWaterNow };
  });
  expect(kid.y).toBeCloseTo(gy + 1, 1); // not crushed, not launched, not teleported
  expect(kid.inWater).toBe(false);
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

  // and the game really uses the artwork: painted blocks (opaque and see-through)
  await joinWithPad(page);
  const channels = await page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const ids = (window as any).__lbw.ids;
    const e = game.players[0].entity;
    const x = Math.round(e.pos.x) + 3, z = Math.round(e.pos.z);
    const y = game.world.surfaceY(x, z) + 1;
    game.world.set(x, y, z, ids.STONE);
    game.world.set(x + 1, y, z, ids.GLASS);
    return {
      painted: game.scene.children.filter((o: any) => o.isMesh && o.material === game.chunks.materials.textured).length,
      seeThrough: game.scene.children.filter(
        (o: any) => o.isMesh && o.material === game.chunks.materials.texturedTranslucent).length,
      uved: game.scene.children
        .filter((o: any) => o.isMesh && o.material === game.chunks.materials.textured)
        .every((o: any) => !!o.geometry.attributes.uv),
    };
  });
  expect(channels.painted).toBeGreaterThan(0);
  expect(channels.seeThrough).toBeGreaterThan(0); // glass and water carry art too
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
  // and the two chests are the same shape, so they cost the same faces
  expect(quads.openChest).toBe(quads.chest);
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
  expect(saved.version).toBe(3);
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
  expect(after.version).toBe(3);
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

  // a chest can also be built: it is one squat cell, not a two-cell door
  const chest = await placeSelected(page, ids.CHEST);
  expect(await blockAtCell(page, chest)).toBe(ids.CHEST);
  expect(await blockAtCell(page, chest, 1)).toBe(ids.AIR);

  const tally = () => page.evaluate(() => {
    const game = (window as any).__lbw.game;
    const e = game.players[0].entity;
    return {
      stars: e.starsCount, zoom: e.zoomTime, boing: e.boingTime,
      animals: game.animals.animals.length, starsInWorld: game.starField.stars.length,
    };
  });
  const before = await tally();

  // look down at the chest and press the pet button: the lid comes up
  await page.evaluate(() => {
    (window as any).__lbw.game.players[0].entity.pitch = -0.5;
  });
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
