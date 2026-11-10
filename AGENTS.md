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
  blocks or water, and `SCORCH` is deliberately not in the palette. A **lit
  fuse rides the save and keeps burning in every later boot** of a shared
  world — the persistence e2e leaves one alight on purpose, so it now defuses
  (`world.set(AIR)`; the manager extinguishes the rig when the voxel is gone)
  before it ends, or the next terrain-sensitive course near spawn gets its
  wall carved mid-test (that is how the ladder e2e failed on its CI debut).
- Swimming (`players/playerEntity.ts`): buoyancy is a *levelled float*, not a
  speed cap — `physics.submergedFraction` samples four heights up the body and
  the vertical target is `(frac - SWIM_TRIM) * 2.2`, so deep under drifts you
  up and shallow water lets you wade; a passive kid settles head-out at the
  surface instead of sinking to the bottom (a pure "cap fall speed" swim made
  walk-ins plunge to the pond floor). Hold jump to kick (`SWIM_UP_V`), hold
  the sneak buttons (Ctrl / B / ◯ — `stepInput.swimDown`, `SWIM_DOWN_V`; the
  crouch *toggle* is refused while swimming) to dive. The surface push-off
  jump needs `headClearOfWater` AND `physics.nearShore` (solid cell at foot/
  waist one step in any direction) — open water must never bunny-hop the kid
  (Nov 2026 complaint; the swimming test asserts `waterJump` stays 0 for a
  mid-pond kick). Strokes tick `events.stroked` every
  `STROKE_SECONDS` **only while paddling** (move/jump/dive input — idle
  floating is quiet, Nov 2026 complaint; the swimming test asserts
  `lastStroke` freezes while floating) → `Game.lastStroke` dedups →
  `audio.swimStroke`. The avatar
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
  `entity.headHeight`; the look of it is a pose, never a scale (see below).
  Flight force-clears crouch.
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
- Block ids a test reaches for must exist on `__lbw.ids` (`src/main.ts`) —
  `ids.MISSING` handed back `undefined`, which `World.set` wrote as AIR, so a
  test could "place" nothing and still pass off whatever geometry the scene
  already held (`world.set` now refuses a non-integer id). When an assertion
  depends on a block being drawn: place it, read the voxel back, and let a few
  frames pass — chunk remeshing is budgeted a few chunks per frame.
- Physical gamepad behaviour is verified manually (checklist in the README);
  virtual pads in tests exercise the same input abstraction, which is not a
  substitute for hardware QA.
- Physical gamepads **have** been tested on real hardware by the family
  (Xbox One + PS5 DualSense, 2026-11-02: join, sticks, build, palette, menus,
  split screen, waking a sleeping pad). Virtual pads in tests drive the same
  input abstraction, so they are a good regression net — but re-check the
  README's manual checklist with real pads after any input change (newly added
  Leave / Waiting-Players rows, the water-jump fix, the slab / real-stairs /
  treasure-chest blocks, the crouch **pose**, and **this branch's whole set**:
  the **LT = build+pet · RT = break** trigger remap (with the pet-outranks-
  build latch, the fly-descent LT coupling, and X as a second break), the 🪣
  bucket now living entirely on LT, the new Weather / Day & Night /
  Treasure-Chests / **Shadows** rows (Back is row 10 now) and the D-pad ▾
  satchel) still owe the couch a turn.
- Ladders (`LADDER=40`, atlas cell `ATLAS_LADDER=28`→count 29, `drawLadder`):
  **not solid, not opaque** (you walk INTO the cell — never write a test that
  expects to stand on one), wood sound family, palette right after DOOR, icon
  🧗 (🪜 stays with STAIRS). A 0.22-thin panel (`blocks.LADDER_DEPTH`,
  `ladderBoxes`) flush against the wall its CLIMB SIDE faces away from; the
  direction lives in `world.ladderFacing` (LadderFacing 0..3), saved as
  **version 5** (server validates 0..3 and merges like the other maps).
  `setLadderFacing` must `touchAt` (same id, so `world.set` early-returns).
  The mesher draws it via `addTexturedSubBox(..., { cullFlush: true })` — the
  face buried in the wall is culled only when that neighbour is a full cell.
  **Climbing** is a branch in `playerEntity.step` BEFORE swimming (a ladder
  over a pond beats the water — pond tests live near spawn): `physics.onLadder`
  (feet cell or head cell is a ladder → gravity off, cling); hold jump →
  `CLIMB_V` up but **only while the FEET cell is a ladder** (that's what
  stops you rising past the top rung); hold `swimDown` (same dive/crouch
  buttons) → down; rung hand-over-hand footfalls every `STROKE_SECONDS` on
  the LADDER id. Tap-crouch is force-cleared while climbing. **Mantel**:
  climbing + jump, any SOLID neighbour whose `topY - pos.y <= 1.05` and
  `canStandAt` → teleport onto it — the wall's own cells block mid-climb
  mantels because canStandAt collides the whole body, so the top is cleared
  first (that's the whole trick — "get on the wall" with no extra button).
  **Placement needs a wall**: facing from aim (`game.ladderFacingFromAim`,
  wall→cell direction, yaw fallback when aiming at a floor), refuse with red
  particles unless the cell BEHIND (opposite the climb side) is solid or a
  ladder, or the cell below is a ladder; pet button spins it (`rotateLadder`,
  reuses `rotateStairFacing`). `ladderFacing.delete` on replace/remove/blast
  (the server merge keeps deleted keys as harmless orphans — blocks decide).
  `entity.climbingNow` is the e2e lens; `__lbw.atlas.ladder` decodes the
  painted art off mesh UVs. The e2e restores its near-spawn wall **byte for
  byte + saveNow** — `world.set` records mods literally, so restoring to AIR
  saves a hole in the meadow for every later test.
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
- Sounds are all procedural WebAudio (`core/audio.ts`) and **material-aware**:
  `blocks.soundFamilyOf(id)` → wood/stone/soft/glass/plant recipes for
  `place`/`remove`/`land`/`footstep`. Footsteps ride `StepEvents.footfall`
  (one per ~1.7 blocks walked, throttled per player in `Game`, alternating
  pitch via `footAlt`); `landedOn` gives landings the right thud; water
  entry/exit is `audio.splash()`, chests are `chestOpen()`. `AudioKit.recent`
  is a 30-entry ring of sound names — the headless e2e asserts the wiring
  through it (`sounds carry the material` test).
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
  (~8/s, `STEP_SECONDS`), water sinks through (displaced water rides up),
  cross plants are squashed (`crushed` hook forgets the sapling), and it
  never occupies a cell a player overlaps — it just rests over their head
  with `sandThud`. Terrain writes cells directly (no hook), so natural sand
  never falls until something changes under it — same as floating sand in
  Minecraft. **Falls are animated** (`render/sandFalls.ts`, `Game.sandFalls`):
  each `moved` hook glide spawns/continues one atlas-textured cube per block,
  eased one cell per `STEP_SECONDS` in game time; the voxel stays authoritative
  (physics/saves) while the mesher skips the in-flight cell via
  `chunks.skipSand` (= `sandFalls.hidden`) so a block never draws twice — the
  cube alone is the block mid-fall, and finishing the glide dirties the chunk
  (`world.touchAt`) so the voxel takes over seamlessly. e2e: an in-page sampler
  asserts `sandFalls.count` rises during a fall and returns to 0 after.
- Water flows (`core/water.ts`, `Game.water`): **two ids**. `WATER` (10) is an
  eternal source (the sea, and any a kid places from the palette) — unbreakable,
  never an aim target (`raycast.hitRemovable`), full-cell. `WATER_FLOW` (38) is
  travelling water; its depth lives in `world.waterLevel` (flat index → level),
  saved as **version 4** `waterLevels` (server merges it like the other maps).
  The sim is a dirty set driven by the same `World.onCellChanged` hook as sand.
  **The model is Minecraft parity (Nov 2026, twice — the second pass fixed the
  falls), five rules:** (1) a spring reaches **exactly seven cells** —
  `MAX_WATER_LEVEL` is 7, sideways spread costs +1 level per cell and level 7
  cells stop; (2) water spreads sideways only into a cell with **something
  under it** (`supported`: solid or settled water) — it never leans out into
  thin air; (3) where it runs out of ground it **falls straight down, the whole
  drop in ONE step, and lands at FULL strength**: `fall()` writes the start
  cell at the feeder's level and every cell below it at level 0 (the big game
  fills the block under a flow at depth 0 — "a fluid can flow much farther if
  it flows downward occasionally"), stops at water (upgrading that surface to
  0; the `fy !== start` guard keeps the stream's own top cell from
  self-upgrading), returns the landing cell, and `cascadeFall()` re-spreads
  from there in the same step (≤`FALL_CHAIN`=24, so a staircase drains top to
  bottom in a couple of steps). Mid-drop cells ride the `pouring` set: they
  feed only the column below and NEVER spread sideways; `pouring` clears only
  on **solid** footing (`standsOnGround`) — clearing on `supported` fans a
  waterfall into a curtain. A WATER source over a hole never moves, it pours
  from `y − 1`. (4) **Spread beelines for the drop** (the big game's flow
  weights): `flowWeights`/`dropDistance` BFS each direction ≤`DROP_SEARCH`=4
  cells of flat walking for a way down (`NO_WAY_DOWN`=1000) and `spread`
  flows only the lowest-weight directions — one-cell streams near an edge,
  symmetric fans on flat floors. The down-check runs **before** reach, so even
  a thin last cell beside a drop goes over. Trap that made a waterfall
  curtain: the fall's own column counts as footing (`supported` accepts
  water), so `dropDistance` must also treat `pouring` cells as the edge or
  the weight of the down direction inflates, ties with sideways, and every
  fanned cell pours its own fall. (5) **Two sources feed a third**
  (`makesSource`, checked in `evaluate` before the supply math): a flow cell
  with ≥2 horizontal `WATER` neighbours, or ≥1 plus a `WATER` above, standing
  on ground/settled water, converts to `WATER` (level entry deleted). Traps:
  those new springs are eternal **and unbreakable** like the sea (bucket them
  away in tests, or overwrite with `world.set`), and digging a corner off the
  shore really does leave a spring behind — Java does the same. Held up only
  by a **strictly deeper** side neighbour or by water falling in from above
  (`pouring` above supplies level 0), so a cut-off flood cannot prop itself
  up: the shallow end fails first and `drain` cascades the news
  (≤`CASCADE_CELLS`=4 per step), which is the dry line walking back up the
  channel. **Bounds:** `World.get` out-of-bounds is AIR while `set` no-ops —
  `setFlow`/`fall` guard with `inBounds` or drops at the map's edge write
  phantom `pouring`/dirty entries forever. **Bedrock divergence, deliberate:**
  Java water never drains on its own; ours does (the user picked it, and the
  bucket depends on "pull the spring, the flood runs home").
  `world.set` deletes the level entry; improving an existing flow
  cell's depth needs `world.touchAt` (same id, so `set` early-returns). Levels
  0..7 are the whole scale — `world.applySave` clamps waterLevels to `v <= 7`,
  `flowLevelAt` defaults to 7, and `server/index.ts` validates 0..7. Anything
  wet is `blocks.isWaterId(id)` — physics, sand (displaced water rides up),
  blasts (skip both ids), animals/collectibles all use it, never a bare
  `=== WATER`. Terrain writes cells directly (no hook), so a fresh sea starts
  still. **Tests:** terrain ponds and the sea are eternal
  *flowing* sources on this branch — any e2e course near spawn must ring its
  site with a full-height stone caisson and scrub every wet cell inside, since
  falling water lands full-strength and one wet cell left above a wall re-rains
  on the course forever (the sand and water-flow tests do exactly this, and
  their dry-waits dump wet-cell maps on failure for the next CI sleuth). The
  sim's own clock is the test clock — `WaterFlow.steps` (`__lbw.waterSteps`)
  and `isPouring` (`__lbw.waterFallingAt`); headless Chromium runs game time
  at ~half wall clock, so never `waitForTimeout` for a flood, and audit only
  after the descent settles. The slope test asserts the flood **runs down the
  whole staircase** (the old expectation that the seven-cell reach ends it
  partway down was wrong and deliberately changed); the cliff test measures
  the descent in steps and demands one stream, a full seven-cell pool, and
  nothing standing tall.
- Fish (`core/fish.ts`, `Game.fish`) live in every column of water: five
  kinds, **minnow + sunfish school** (a `School` anchor wanders through valid
  water and the flock follows via anchor-seek + slowly circling offsets +
  separation; stragglers hurry), puffer/bass/golden prowl alone. `kind` is
  public (e2e reads it). Fish never leave the water: `swimable()` validates
  the *destination* column's swim band (`waterRunAt`, water standing on solid
  ground — never a bare `=== WATER`), so they wade the shoreline steps instead
  of freezing there; when the water under them goes away (drain, fill, blast)
  `rescue()` darts them to the nearest pond or they die, and the refill timer
  drifts new ones back in. They flee swimming kids (the whole school panics).
  Population is seeded from `world.seed` (mulberry32 — the LCG animals use
  correlated x/z) and rebuilt in `applyNewWorld`; **no fish are saved**.
- Fishing (`core/fishing.ts`, `Game.fishing`) hangs off the pet button: the
  interact hook checks `this.fishing.active(id)` FIRST (a line in the water
  outranks doors/chests/pets, and reels it in), and an aim whose `lp.target`
  (not `removeTarget` — it excludes water sources!) is `isWaterId` casts. The
  bobber flies 0.5 s, plops (`audio.plip`), bobs `biteWait` game-seconds, then
  **bites** for `biteWindow` — reel during the bite for a fish. Kind comes from
  `pickFishKind(fish.nearbyKinds(...))` (×3 weight where the kind actually
  lives), stars only, and `fish.takeNearest` removes the very swimmer caught.
  Tests hurry bites via `game.fishing.biteWait = [0.1, 0.4]`. Sounds log as
  `fish:cast/plip/bite/reel/escape/caught:<kind>` into `AudioKit.recent`. The
  fishing e2e digs the swimming test's below-grade pond recipe (banks wall the
  water in, no caisson needed since the surface stays under the meadow).
  The line hangs from a **rod**, never the eyes: `buildRod()` makes a blocky
  tapered rod per line — one parented to `avatar.rightArm` (swings with the
  walk, follows the arm after a `cycleModel` costume swap), and one held low
  right of the angler's own camera when `firstPerson` (layer `ROD_LAYER` 7:
  `applyAvatarLayers` enables it per camera, so only its owner sees it).
  `tipWorld(l, angler)` is the single source of truth for the line's start —
  the active rod tip's world position — used for cast start, geometry and the
  reel-away distance; the no-avatar fallback is a waist-high hand.
- Treasure chests: the loot roll is `core/treasure.ts` (weights + messages),
  the effects live in `Game.grantTreasure` (no inventory, so prizes happen to
  the world: star counters, `starField.spawnAt` stars, `playerEntity.zoomTime`
  / `boingTime`, `animals.spawn`). Opened = `CHEST_OPEN` in the voxel, so it
  needs no extra save field — once a lid is up it is open in that world
  forever, and an empty one toasts `EMPTY_CHEST_MESSAGE`. Chests are NOT in
  `PALETTE`/`FAVORITES` on purpose: they are only *found* in the environment,
  never built. Terrain hides `CHESTS_PER_WORLD` chests in `generateTerrain`
  step 6 — remember `idx` strides y by 1, not by `WORLD_SY`.
- Fish satchel (`core/satchel.ts`, `LocalPlayer.satchel`): catches are banked
  per player, not spent at the bobber — `Game.reelIn` adds the kind and the
  HUD chip (`hud.ts .pouch`, hidden while empty) counts the catch. The pouch
  opens **in the world** via a new `satchel` input action — D-pad ▾ on a pad,
  `I` on the keyboard — never from the PlayerMenu (deliberate: the menu is
  settings, the pouch is play). Gamepad `BUTTON_MAP` values are now `Action[]`
  so button 13 can emit `['down', 'satchel']` — D-pad ▾ does nothing else
  in-world (only `up` is jump, menus consume `down`). `SatchelOverlay`
  (ui/overlays.ts) lists kinds with ×count + boost badges; A eats the
  highlighted one. `Game.eatFish` takes the fish, applies `FISH_SNACKS[kind]`
  to `entity.zoomTime`/`boingTime` (there is no health, so boosts ARE the
  dinner), toasts, and `audio.munch` logs `fish:eat` into `AudioKit.recent`.
  Like stars and fish, the pouch is **session-only** — never saved. e2e: 'the
  satchel keeps the catch' (reuses the fishing test's pond recipe and refill
  ritual, and asserts the menu has NO Satchel row). The D-pad ▾ satchel
  button still owes the couch a hardware check.
- Treasure chests are **placeable** (palette + `paletteFor(allowChests)`, save
  version still 4) and a kid's own chest pays random treasure every time. The
  Grown-Ups row **🧰 Treasure Chests** (`chests`/`toggleChests`) hides the
  palette entry *and* refuses placement (`chestsAllowed` in `lbw-settings`);
  hidden worlds still contain terrain chests. The new GrownUps rows
  (Weather 6, Day & Night 7, Treasure Chests 8, **Shadows 9**) sit **after**
  Waiting Players so row pins 0–5 hold; **Back is now index 10** —
  `selectRow(6)` would hit Weather. Chests still never appear in `FAVORITES`.
- An opened chest opens **only at the top** (Nov 2026 user complaint: the old
  one painted an open lid down its SIDES). `CHEST_OPEN` keeps CHEST's
  `sideAtlasCell`/`bottomAtlasCell` and both use `CHEST_HEIGHT` — from the
  side they are the same box; `chestOpenBoxes` (blocks.ts) is body + `inner`
  (walls `CHEST_INSET` in, treasure at `CHEST_DEPTH` below the rim).
  `mesher.addChestShape`: open body = `addTexturedSubBox` with
  `skip: faceSkip(FACE_PY)`; then 4 rim strips (`atlasUvs` samples a SLICE of
  a cell — a thin strip shows a thin slice of planks, never the whole tile
  stretched), `addInnerFace` for the 4 walls seen from INSIDE + the treasure
  quad, all skipped when `isFullCellBlock` sits above (never draw an interior
  nobody can see). The LID is pure render, `addLidPlate`: two quads (art side
  `ATLAS_CHEST_LID`, shaded side `ATLAS_CHEST_INSIDE`) hinged on the −z rim
  and leaning back into the cell ABOVE — it's the only chest part that leaves
  the cell, so skip it when `(x, y+1, z−1)` is full, and give up any test that
  assumes chests never render outside their cell (the new chest test's z
  window is −0.6..+1.6 for this reason). Atlas cell 26 is repurposed
  `ATLAS_CHEST_OPEN_SIDE` → `ATLAS_CHEST_INSIDE` (`drawChestOpenSide` is
  gone); `ATLAS_CELL_COUNT` stays 28. The sealed-cube quad test now asserts
  `chest − openChest === 1` (the lid top is the only difference in there),
  and `__lbw.atlas` exposes the chest cell ids so the geometry test can
  decode a face's artwork from its UV (`cell = floor(u × cells)`).
  `scripts/chest-shot.ts` parks a camera (hides the avatar) for still lifes
  of shut/opened from three angles.
- The bucket (`core/bucket.ts`, `BUCKET=39` where WATER sat in `PALETTE`):
  every kid carries one, `LocalPlayer.bucketFull` is **session-only**. Only a
  WATER source fills it; pouring sets a new WATER source at the aim's
  `px/py/pz`. Digging with a bucket scoops; WATER_FLOW still breaks normally.
  The drain-back is the flow sim's own cut-off drying (levels climb until they
  pass the reach cap) — no extra code, and the whole channel is dry within a
  second. Don't claim a per-cell reverse wave in docs or tests: the levels
  re-equilibrate across the pool first, so the dry-out order is ±1 step and
  not assertable. e2e: 'the water bucket scoops a spring…' drives it through
  `__lbw.bucketAt(playerIdx, aim)` with exact RayHits.
- Interaction is **LT / L2, both hands** (`BUTTON_MAP` 6→`['interact','place']`,
  7→remove, 2→remove alias; keyboard E/R-Click/L-Click unchanged). L2/LT emits
  interact AND place: `LocalPlayer.update` runs the interact hook FIRST (it
  returns true when the aim held fishing/door/chest/stairs/ladder/bucket/water
  — or a real pet, `petNearest(...) !== null`) and only places when nothing
  nice was found; `interactHold` latches placement off until the trigger
  releases (holding LT on a door opens it, never bricks it in), and while
  FLYING a held pad `interact` is the descent button only (`descending` skips
  the build block). Both couplings are gated on `frame.kind !== 'keyboard'` —
  the keyboard contract (R-Click builds, L-Click breaks, E interacts) is
  exactly what it was. R2/RT breaks; X is kept as a second break button for
  muscle memory. `GAMEPAD_BUTTON_MAP` is exported and mirrored on
  `__lbw.padMap` — the 'the triggers are the hands' test pins it, and
  'LT is both hands' e2e taps `interact`+`place` in one frame (that IS an LT
  press on a virtual pad) to pin build/pet/priority/RT-break.
- Crouch is a **pose, not a squash** (`players/avatar.ts`), and the rig has no
  knees — so the pose is three angles, worked out against the pivot geometry:
  `parts.body` (which pivots at the FEET) tips forward `CROUCH_LEAN`, which is
  the only thing that can lower the hips; `CROUCH_LEGS` swings the legs further
  forward *inside* the tipped body so the feet plant themselves in front; and
  `parts.chest` (the hip pivot at `CROUCH_HIP=0.5`) hangs the torso forward over
  them by `CROUCH_FOLD`. Everything is lerped by `parts.crouchT`. Traps learned
  the hard way: rotating a leg about the hip **cannot** lower the hip (the old
  `CROUCH_KNEE=-1.25` just flung the feet up — a handstand); tipping the body
  and the legs by the same angle is only a leaning plank; and a limb pointing
  DOWN swings BACKWARD for a positive `rotation.x`, so "arms hang" under a
  forward-tipped torso means a positive arm angle. Scale stays **1** everywhere
  (the original pose scaled `group.scale.y` and squashed juice-box kids and
  every costume with them). `body.rotation`/`body.position` belong to the
  crouch; `group.rotation` belongs to the swim lean. The crouch e2e measures the
  drawn matrices: scale 1 on group and body, `body.rotation.x`, the hunch past
  the tip, the legs inside a sane band, and the head top at least 0.25 below its
  standing height. `scripts/crouch-shots.ts` shoots the profile + the in-play
  three-quarter view for eyeballing it.
- Water draws at its depth (`water.ts waterSurfaceHeight(world,x,y,z)`): submerged
  cell (water above) or a falling cell → **1** (a full cell — this is what stops
  a deep body drawing as a stack of thin plates); otherwise the big game's nine
  steps: **`(8 − level) / 9`** — a source or a full-strength plunge stands
  8/9, level 4 stands 4/9, and the seventh cell of a reach is a thin 1/9 sheet
  (`level = world.flowLevelAt`, 0 for WATER). So a soak lies flat and thin, a
  pool stands to its brim, and a waterfall is a solid
  ribbon. The mesher's **water channel** (`ChunkGeometry.water`,
  `materials.water`, tiling `textures.waterTexture`, drifting via
  `chunks.tickWater(dt)` — Game calls it every frame) draws each cell as a box
  to `addWaterCube`'s **corner-averaged** height (`waterCornerHeights`: the wet
  cells meeting at each corner, same y only — blending with a lower column's
  absolute height flips the quad inside out). Two traps that made water look
  like a chessboard of coasters: per-cell UVs (one whole wave tile per cell —
  `waterFaceUvs` samples in WORLD units instead) and `materials.water`
  `depthWrite: false`, which blended every surface of every cell in a body into
  every other one. Physics still treats every wet cell as a full cell.
  `__lbw.waterSurfaceAt` is the test lens; `scripts/water-slope-shot.ts` shoots
  a spring pouring down a staircase for eyeballing it.
- Sky & weather: `core/weather.ts` `WeatherClock` (game time, public
  `weatherNow('rain'|'snow'|'off')` on Game; `__lbw.weatherNow`) decides what
  falls; `render/sky.ts` draws it (sun+moon orbit pivot, stars, cloud puffs,
  rain/snow `THREE.Points` riding `__lbw.renderCam` — Game sets it each frame
  before `skyEnv.update(dt, cam)`, dome vertex colours repaint only when the
  hour moves). Day-phase lives in the sky (`setDayMode('auto'|'day'|'night'|
  'none')`, `dayPhase()`; `__lbw.setDayMode` / `__lbw.dayPhase`). **Night is
  never black**: light floors ≥ ~0.3, so the 'no black hole' and 'blackPixels'
  tests stay green at midnight (the weather test asserts it). Audio:
  `audio.rainLoop(intensity)` must be re-called ~1×/s (it re-triggers itself;
  stop via `rainLoopStop()`), thunder only on heavy rain every ≥9 s; both log
  `weather:rain…/weather:thunder` into `AudioKit.recent` (that ring must not
  overflow the 'sounds carry the material' test — it samples 25).
- **Shadows & shader polish**: `src/render/shaders.ts` owns the GLSL kit
  (`ShaderKit` + `patchWaterSurface` / `patchTerrainFinish`) — `onBeforeCompile`
  on the three shared chunk materials with uniforms **shared by reference**, so
  animation is a per-frame `chunks.tickShaders(dt, sunInfo(), fogColor)` and
  never a program rebuild. `customProgramCacheKey` keeps the variants distinct.
  The shadow caster is the sky's `DirectionalLight` (`getSunLight()`); its
  direction **must stay the visible ball's direction** (`skyEnv.sunBallDir()`),
  which is what the e2e pins — an earlier hand-written azimuth disagreed with
  the drawn sun and the user noticed. `sunInfo().dir` is that vector with the
  elevation floored (~11°) so the ortho frustum can hold the shadow.
  Traps: `dir.shadow.autoUpdate = false` (three would re-bake once **per
  pane**), and the map is marked dirty only for a "donor" pane —
  `viewportMgr.render(…, onPane)` — because `shadowMap.render()` cannot be
  called outside `renderer.render()` (three's `currentRenderState` is null
  there and it throws mid-frame, blanking the world). Redraws are **wall-clock**
  driven: `SHADOW_HEARTBEAT` 1 s, `moving`/`focusMoved` triggers, and a 1 s
  `SHADOW_EDIT_WINDOW` after every voxel change so budgeted remeshes still land
  inside a bake — a game-time beat goes stale exactly when the world is busy.
  Type is auto-set by `Game.setShadowQuality` — `PCFSoftShadowMap` on a 2048²
  map for real GPUs, `BasicShadowMap` on 1024² for software GL (nine taps per
  pixel cost hundreds of ms on CI's software rasteriser; the e2e pins the
  detector against real renderer strings). Shadows are gated by
  the Grown-Ups 🌒 row (`shadowsEnabled`, persisted in `lbw-settings`);
  toggling must poke `needsUpdate` on every material (shadow-ness is baked
  into the program cache key). The e2e asserts the look by diffing screenshots
  of the same frame with the row flipped — chunk remeshing is budgeted, so the
  census waits 25 frames and stays inside one `test()` (a reload would reset
  the parked clock). `scripts/shadow-shots.ts` shoots the eyeball set.
- **World lights** (`render/lights.ts`, `Game.lights` + `ShaderKit` in
  `render/shaders.ts`): torches, glow blocks, opened chests and star pickups
  light the world through **scalar uniforms** on the shared chunk materials —
  `uL0P/uL0C/uL0R`… ×8 (`MAX_WORLD_LIGHTS`), hand-unrolled by
  `lightsGlslBody()`. Do **not** "tidy" these into a uniform array: on
  SwiftShader a dynamically indexed uniform array spills the whole program
  out of the constant banks, and branches are flattened — an `if (i < count)`
  decode runs the full loop even at count 0. Both measured ~2× frame cost on
  CI's rasteriser; the unrolled scalar chain with `elBreak` is what survives.
  `ShaderKit.lightCompileMax` (8 on real GPU, **3** on software GL) is set
  **once at boot** in `game.ts` from the same `detectShadowQuality` detector,
  before the first frame compiles the programs — that's what keeps "lights
  never rebuild a program" true *including* for the 🔥 Lights toggle, which
  only ever changes `uLightCount` (and `LightKeeper.sync`'s `budget`, which
  also star-lights and the flame-pool cap). Light list: `LightKeeper.sync`
  gathers torch/glow/chest emitters within a radius of each camera (plus the
  nearest 4 star pickups — `pool` + `starLight`, both session-only like the
  satchel), scores `weight × (1 − d/r)`, sorts, truncates to `max`, and
  publishes. **Flicker is CPU-side**: `setLights` folds two detuned sines
  (9.3 / 23.7 rad/s, phase from the cell hash) into `uLightColor` per frame,
  so the fragment decode is a pure FMA chain; the flame sprites wobble on
  the same clock, so the pool and the flame are provably the same fire.
  Attenuation is `(1 − d²/r²)³` — the cube is what keeps a 7.2-r torch from
  washing a stone wall to flat cream; colours are tuned hot-at-the-flame
  (see the constants in `lights.ts`). A torch is a real voxel (`TORCH=41`,
  atlas cell 29, mesher `addTorchShape` post-pass, non-solid, needs a
  solid/neighbour support or `trySet` refuses it). **Day/night parks**:
  `DAY_PARK=0.32` / `NIGHT_PARK=0.78` — the palette stops say 0/1=midnight,
  but `sunElevation=sin(2πh)` puts zenith at 0.25, so the old parks (0.5 and
  0.0) sat on the elevation's zero crossings and a "parked night" was
  geometrically sunrise (black sun orb on the horizon, full low-sun wash —
  pre-existing, exposed by the sun-glare sprite). The glare follows the
  ball's TRUE elevation (`skyEnv.ballY` is captured *before* `sunInfo()`
  floors the elevation to ~11° for the shadow frustum) and is `visible =
  false` when faded, not just transparent, so an invisible orb can't bleed
  through bright snow. Grown-Ups **🔥 Lights** row sits at index **10**
  (after Shadows 9; **Back moved to 11** — the weather e2e row labels are
  pinned, and the torch e2e toggles row 10). e2e lens: `__lbw.lightsNow()`
  (`count/max/flames/emitters/lights[{x,y,z,r,kind}]`) and
  `__lbw.shaderTime()`; the torch test drives placement through the real
  `trySet`, counts brighter-than-day pixels at a 640×360 viewport (the
  software-GL budget), and restores its wall byte-for-byte + `saveNow`
  like the ladder test. `scripts/lights-shots.ts` shoots the before/after
  pair and the hero (`docs/screenshots/lights.jpg`).
- ⚠️ **This worktree has twice silently reverted working-tree files mid-session**
  (game.ts, sky.ts, main.ts, tests…): commit early, commit often, and re-check
  `git status`/`git log` after any mysterious failure.
