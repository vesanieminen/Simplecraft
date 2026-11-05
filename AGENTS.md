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
- Costumes (`AVATAR_MODELS` in `players/avatar.ts`): one skeleton for every
  model — the arm/leg pivots, head and face stay exactly where
  `animateAvatar`/`syncAvatar` expect them, costumes only add boxes (helmet,
  hat, tail…) and re-tint materials, and each keeps ≥1 mesh in the player's
  own colour (the e2e 'costumes' test counts them). The Kid model is the
  classic 9-mesh body and must stay byte-identical — 'the kids are dressed'
  counts its textures. Costume tails ride `AvatarParts.tail` (animateAvatar
  wags it). Pick at join with prevBlock/nextBlock on the JoinCard; swap in
  play via the PlayerMenu 'Costume' row → `PlayerEntity.cycleModel()`, which
  rebuilds the avatar and re-parents it (the per-frame `applyAvatarLayers`
  sorts split-screen layers out; don't cache AvatarParts anywhere).
  PlayerMenu rows are index-pinned in several tests — inserting a row shifts
  Grown-Ups/Leave/Help indices in `tests/e2e/game.spec.ts`.
- Dynamite: the stick is a real voxel (`DYNAMITE`), so it saves, blocks things
  and can be carved by another blast; `DynamiteManager` only owns the animated
  fuse rig (tagged `group.userData.fuse` for leak checks), the blast and the
  chain reactions. Fuses run on **game** time, which is roughly half wall
  clock in headless Chromium — never `waitForTimeout` for an explosion, poll
  `game.dynamite.blastCount`. Blasts never touch `y <= 0`, `unbreakable`
  blocks or water, and `SCORCH` is deliberately not in the palette.
- Swimming (`players/playerEntity.ts`): buoyancy is a *levelled float*, not a
  speed cap — `physics.submergedFraction` samples four heights up the body and
  the vertical target is `(frac - SWIM_TRIM) * 2.2`, so deep under drifts you
  up and shallow water lets you wade; a passive kid settles head-out at the
  surface instead of sinking to the bottom (a pure "cap fall speed" swim made
  walk-ins plunge to the pond floor). Hold jump to kick (`SWIM_UP_V`); the
  surface push-off jump only fires once `headClearOfWater` (the existing
  shore-escape rule, keep it). Strokes tick `events.stroked` every
  `STROKE_SECONDS` → `Game.lastStroke` dedups → `audio.swimStroke`. The avatar
  leans face-down (`syncAvatar` rotation.x ≈ 1.2) with a breaststroke/flutter
  pose from `animateAvatar(..., swimming)`. The avatar group MUST keep
  `rotation.order = 'YXZ'` (set in `createAvatar`): three's default 'XYZ'
  pitches about the WORLD x-axis, so the lean stayed stuck pointing one fixed
  direction instead of following the facing. The swimming test samples the
  body's world +Y at two yaws to keep that honest. Any test that edits terrain near
  spawn and is followed by a test that re-boots must `await game.saveNow()`
  after the refill — autosave is debounced 1.5 s and a fast page swap loses it
  (this bit the shore-jump → swimming handoff).
- Crouch (Minecraft sneak): **tap B/◯ in the world** (keyboard Ctrl) toggles
  it; menus keep B as Back. `PlayerEntity.crouching` → squat AABB
  (`physics.CROUCH_H` 0.95 — fits a one-block gap), 42 % walk speed, jump
  while crouched stands up first (and jumps; refused under a low ceiling),
  toggle-up is refused under a low ceiling, and `step` undoes any horizontal
  move that would leave the feet unsupported while crouched on the ground —
  kids never walk off ledges. Camera/aim eye height comes from
  `entity.headHeight`; the avatar squats via `group.scale.y` in
  `animateAvatar`. Flight force-clears crouch.
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
  Leave / Waiting-Players rows, the water-jump fix, the slab / real-stairs /
  treasure-chest blocks and the new B/◯ **crouch toggle** still owe the couch
  a turn).
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
- Doors: closing one **makes room first** — `Game.makeRoomForDoor` nudges any
  player overlapping the soon-to-be panel out along the panel's thin axis
  (the walk-through direction) to the nearer clear side, and refuses the
  close when nobody fits or an animal loiters in the doorway. Defence in
  depth: `physics.faceSnap` resolves an embedded box by SHORTEST displacement
  (back off or come through), so no block change can shove a kid a full
  cell sideways and through the ±0.35 map-edge clamp (the old "door pushed
  me out of the world" bug). Regression test spams a door in the edge column.
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
- Treasure chests: the loot roll is `core/treasure.ts` (weights + messages),
  the effects live in `Game.grantTreasure` (no inventory, so prizes happen to
  the world: star counters, `starField.spawnAt` stars, `playerEntity.zoomTime`
  / `boingTime`, `animals.spawn`). Opened = `CHEST_OPEN` in the voxel, so it
  needs no extra save field. Terrain hides `CHESTS_PER_WORLD` chests in
  `generateTerrain` step 6 — remember `idx` strides y by 1, not by `WORLD_SY`.
