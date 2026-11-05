# Agent notes for this repo

## Naming

The game is **Elocraft** (title, welcome screen, page title, docs). The GitHub
repository is still `Simplecraft`, so the Pages URL stays
`https://vesanieminen.github.io/Simplecraft/`. Internal ids still carry the
first name and must keep doing so: the `lbw-*` localStorage keys (saves, world
index, settings), `LBW_DATA_DIR`, `window.__lbw` and the `lbw-open-palette`
event. Renaming a storage key orphans the family's existing saves.

## Git workflow (always)

- **Never push directly to `main`.** Always work on a feature branch and open
  a pull request; the human tests the PR build before it is merged.
- Branch names: `feature/…`, `fix/…`, `chore/…`.
- **CI-first testing (user's standing instruction — do not re-ask):** the
  e2e suite runs in CI as **four parallel shards** plus a static job
  (`typecheck` + `build`) on every PR and every push to `main`
  (`.github/workflows/test.yml`). Do **not** burn agent time running the
  whole `npm test` suite locally. Instead:
  1. Run `npm run typecheck` and `npm run build` locally (fast) before pushing.
  2. While iterating on a feature, run only the relevant tests locally:
     `rm -rf /tmp/opencode/lbw-test-world && npx playwright test -g "<test name>"`.
  3. **Push the branch and open the PR early** (as soon as the first real
     commit exists) so CI starts working right away; add commits as work
     continues — CI reruns on every push. Watch with `gh pr checks --watch`.
  CI is the full-suite runner; local runs are for quick feedback loops.
- Push the branch and open/update the PR with `gh pr create` / `gh pr push`
  style flows (`gh pr create --head <branch>`), then report the PR URL.
- Merging is the human's call — do not merge or squash-merge unless asked.
- GitHub Pages deploys from `main` only (`.github/workflows/deploy.yml`), so a
  PR branch is testable without touching the live site. To let the human try a
  branch on Pages, ask first (an ad-hoc Pages preview can be added).

## Dev loop notes

- `npm run dev` serves the app and the `api/…` world endpoints on port 3000
  (bound to 0.0.0.0); the e2e suite uses its own server on 3100 with
  `LBW_DATA_DIR=/tmp/opencode/lbw-test-world` — delete that directory for a
  fresh world. Delete it before a **subset** run (`-g "…"`) as well: tests build
  stairs, open chests and blast craters near spawn, and that save carries into
  the next run, which makes unrelated tests time out waiting for an aim target.
- `scripts/hero-shot.ts` and `scripts/feature-shots.ts` regenerate the README
  screenshots against a :3100 server; headless Chromium has no emoji font, so
  both scripts swap/strip emoji in the DOM before shooting.
- Block artwork lives in `src/render/textures.ts`: `blockAtlasTexture()` is a
  row of 32-px cells and `blocks.ts` points a block at them with
  `sideAtlasCell` / `capAtlasCell` / `bottomAtlasCell` (grass needs dirt on its
  underside, logs need rings on the ends). Cell ids and `ATLAS_CELL_COUNT`
  live in `core/blocks.ts` — `core` must not import from `render`. Adding a
  cell without drawing it throws on the first atlas build, which is deliberate.
  The mesher routes painted blocks into separate geometry channels
  (`ChunkGeometry.textured` and `.texturedTranslucent`) drawn with
  `materials.textured` / `materials.texturedTranslucent`, so the flat-tint
  path stays untouched. Two traps: the atlas uses `THREE.NoColorSpace`
  (block tints in this game are plain linear values — an sRGB-decoded canvas
  reads far darker than the flat blocks next to it), and side faces lose
  about half their brightness to `FACE_SHADE` × AO × Lambert, so author the
  art bright and chunky. Near-white cells (the candy-colour weave) set
  `tintTexture: true` so the block's own colour multiplies through.
- Avatars are dressed the same way (`players/avatar.ts`): cloth, denim and
  the jumper front are near-white canvases multiplied by the per-player
  colour, so a player's colour survives. The torso is a six-material box —
  BoxGeometry face order is +x −x +y −y +z −z, and +z is the front that gets
  the collar/pocket/buttons.
- Dynamite: the stick is a real voxel (`DYNAMITE`), so it saves, blocks things
  and can be carved by another blast; `DynamiteManager` only owns the animated
  fuse rig (tagged `group.userData.fuse` for leak checks), the blast and the
  chain reactions. Fuses run on **game** time, which is roughly half wall
  clock in headless Chromium — never `waitForTimeout` for an explosion, poll
  `game.dynamite.blastCount`. Blasts never touch `y <= 0`, `unbreakable`
  blocks or water, and `SCORCH` is deliberately not in the palette.
- Sky/camera invariant: the sky dome (radius `SKY_RADIUS`) is parented to a group
  centred on the **middle** of the world — the coordinate origin is a map
  *corner*, so centring the dome there puts its far side past the far plane and
  three clips a black hole in the sky (it shows up seconds later, as the welcome
  camera drifts). Every camera's far plane comes from `SKY_FAR` in
  `src/render/sky.ts` and must stay bigger than `SKY_RADIUS` + the farthest a
  camera can be from the world middle; `renderer.setClearColor(SKY_CLEAR)` is the
  backstop so a gap reads as haze, not the void.
- Visual regressions can be checked in e2e by decoding `page.screenshot()` into a
  2D canvas in the page and counting offending pixels (see `blackPixels` in
  `tests/e2e/game.spec.ts`); `gl.readPixels` is useless there because the
  drawing buffer is already swapped.
- Physical gamepad behaviour is verified manually (checklist in the README);
  virtual pads in tests exercise the same input abstraction, which is not a
  substitute for hardware QA.
- Physical gamepads **have** been tested on real hardware by the family
  (Xbox One + PS5 DualSense, 2026-11-02: join, sticks, build, palette, menus,
  split screen, waking a sleeping pad). Virtual pads in tests drive the same
  input abstraction, so they are a good regression net — but re-check the
  README's manual checklist with real pads after any input change (newly added
  Leave / Waiting-Players rows, the water-jump fix and the slab / real-stairs /
  treasure-chest blocks still owe the couch a turn).
- Partial blocks share one shape language: `BlockDef.solidHeight` is both the
  squat box the mesher paints (`mesher.addTexturedSubBox`) and the box
  `physics.solidBoxesOf` collides with (slab 0.5, treasure chest 0.85). Stairs
  are the exception — two boxes from `blocks.stairBoxes` (tall half + tread
  half) — and which way they point lives in `world.stairFacing` (save
  **version 3**). Spinning a step keeps its block id, so `world.set` would
  early-return: call `world.touchAt(x, z)` to remesh and let autosave notice.
  `physics.stepLift` picks the LOWEST solid top above the feet, which is what
  lets a kid walk up a step without jumping. A staircase is built one block
  over and one block up (that is what aiming while walking produces), and the
  step above does bump a 1.8-tall head from underneath — that is correct.
  Hidden-face culling asks `blocks.isFullCellBlock` (opaque **and** a whole cell
  tall), never `isOpaqueBlock`: a chest is 0.85 of a cell, so treating it as a
  cube made its neighbours drop the shared face and the terrain around every
  chest went see-through. AO still uses `isOpaqueBlock`. The regression test
  counts quads in one chunk's `textured` channel through `__lbw.chunkGeometry`.
- Sand obeys gravity (`core/sand.ts`, `Game.sand`): a cell **changed** id is
  what drives it — `World.onCellChanged` fires from `world.set` for every
  change (buttons, blasts, tests, the sim itself) and `SandGravity.notify`
  tracks the sand at/above that cell, so digging under a cliff cascades:
  each cell's own `set` re-notifies the one above. One cell per step
  (~8/s), water sinks through (displaced water rides up), cross plants are
  squashed (`crushed` hook forgets the sapling), and it never occupies a
  cell a player overlaps — it just rests over their head with `sandThud`.
  Terrain writes cells directly (no hook), so natural sand never falls
  until something changes under it — same as floating sand in Minecraft.
- Water flows (`core/water.ts`, `Game.water`): **two ids**. `WATER` (10) is an
  eternal source (the sea, and any a kid places from the palette) — unbreakable,
  never an aim target (`raycast.hitRemovable`), full-cell. `WATER_FLOW` (38) is
  travelling water; its depth 0..6 lives in `world.waterLevel` (flat index →
  level), saved as **version 4** `waterLevels` (server merges it like the other
  maps). The sim is a dirty-set driven by the same `World.onCellChanged` hook as
  sand: each 0.2 s step re-reads every dirty cell's best supply (a side
  neighbour one level deeper, or water falling in from **above keeps its depth**),
  >`MAX_WATER_LEVEL` (6) drains to AIR. Sideways spread is `level+1`, capped at
  6, so reach is strictly bounded — no support loops, the shallowest cell always
  needs a deeper one. Cutting a chain makes levels **climb** (each flow cell
  `notify`s its neighbours when its own level changes, incl. shallowing) until
  they fall past the cap and dry, cell by cell. `world.set` deletes the level
  entry; improving an existing flow cell's depth needs `world.touchAt` (same id,
  so `set` early-returns). The mesher draws flow cells as shallow
  `addTexturedSubBox`es (`waterTop(id, level)` in blocks.ts = the drawn height)
  with water↔water face culling so a pool reads as one body; sources stay
  full-cell translucent. Anything wet is `blocks.isWaterId(id)` — physics, sand
  (displaced water rides up), blasts (skip both ids), animals/collectibles all
  use it, never a bare `=== WATER`. Terrain writes cells directly (no hook), so
  a fresh sea starts still.
- Treasure chests: the loot roll is `core/treasure.ts` (weights + messages),
  the effects live in `Game.grantTreasure` (no inventory, so prizes happen to
  the world: star counters, `starField.spawnAt` stars, `playerEntity.zoomTime`
  / `boingTime`, `animals.spawn`). Opened = `CHEST_OPEN` in the voxel, so it
  needs no extra save field. Terrain hides `CHESTS_PER_WORLD` chests in
  `generateTerrain` step 6 — remember `idx` strides y by 1, not by `WORLD_SY`.
