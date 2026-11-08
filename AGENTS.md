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
  travelling water; its depth 0..6 lives in `world.waterLevel` (flat index →
  level), saved as **version 4** `waterLevels` (server merges it like the other
  maps). The sim is a dirty-set driven by the same `World.onCellChanged` hook as
  sand: each 0.2 s step re-reads every dirty cell's best supply (a side
  neighbour one level deeper, or water falling in from **above keeps its depth**),
  >`MAX_WATER_LEVEL` (6) drains to AIR. Sideways spread is `level+1`, capped at
  6 and unconditional — water reaching a ledge edge **pours over it** like the
  big game (an elevated source fans out; accepted as MC-like). Reach is
  strictly bounded: the shallowest cell always
  needs a deeper one. Cutting a chain makes levels **climb** (each flow cell
  `notify`s its neighbours when its own level changes, incl. shallowing) until
  they fall past the cap and dry, cell by cell. `world.set` deletes the level
  entry; improving an existing flow cell's depth needs `world.touchAt` (same id,
  so `set` early-returns). **All water renders full-cell** — sources and flow
  cells are the same translucent textured cube; the depth level is sim-only
  (reach, drying), never a draw height, so floods read as solid water bodies
  instead of floating ribbons. The general face pass culls water↔water faces
  (`isWaterId(id) && isWaterId(n)`) so a pool reads as one body. Anything wet
  is `blocks.isWaterId(id)` — physics, sand (displaced water rides up), blasts
  (skip both ids), animals/collectibles all use it, never a bare `=== WATER`.
  Terrain writes cells directly (no hook), so a fresh sea starts still. **Tests:** terrain ponds and the sea are eternal
  *flowing* sources on this branch — any e2e course near spawn must ring its
  site with a full-height stone caisson and scrub every wet cell inside, since
  falling water keeps its depth and one wet cell left above a wall re-rains
  on the course forever (the sand and water-flow tests do exactly this, and
  their dry-waits dump wet-cell maps on failure for the next CI sleuth).
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
  (Weather 6, Day & Night 7, Treasure Chests 8) sit **after** Waiting Players
  so row pins 0–5 hold; **Back is now index 9** — `selectRow(6)` would hit
  Weather. Chests still never appear in `FAVORITES`.
- The bucket (`core/bucket.ts`, `BUCKET=39` where WATER sat in `PALETTE`):
  every kid carries one, `LocalPlayer.bucketFull` is **session-only**. Only a
  WATER source fills it; pouring sets a new WATER source at the aim's
  `px/py/pz`. Digging with a bucket scoops; WATER_FLOW still breaks normally.
  The reverse-order drain is the flow sim's own shallowest-first drying — no
  extra code. e2e: 'the water bucket scoops a spring…' drives it through
  `__lbw.bucketAt(playerIdx, aim)` with exact RayHits.
- Interaction is **LT / L2** (`BUTTON_MAP` 6→interact, 7→place, 2→remove;
  keyboard E/R-Click/L-Click unchanged). `GAMEPAD_BUTTON_MAP` is exported and
  mirrored on `__lbw.padMap` — the 'the triggers are the hands' test pins it.
  Keyboard contract (R-Click builds, L-Click breaks, E interacts) still holds.
- Crouch is a **pose, not a squash** (`players/avatar.ts`): `parts.chest` is a
  hip pivot at `CROUCH_HIP=0.5` holding torso/head/arms/upper costume; the
  fold is `CROUCH_SINK`+`CROUCH_FOLD` (+knee bend `CROUCH_KNEE`), lerped by
  `parts.crouchT`. The avatar group's scale stays **1** (the old scale.y pose
  squashed juice-box kids and every costume with them). Lowered head height
  already flows from `headHeight`; the crouch e2e asserts scale===1, hipY,
  lean and knee while crouched.
- Water draws at its depth: `water.ts waterSurfaceHeight(world,x,y,z)` (source
  0.92, flow `0.92 − level·0.12` floor 0.22, falling water full) feeds the
  mesher's dedicated **water channel** (`ChunkGeometry.water`,
  `materials.water`, tiling `textures.waterTexture`, drifting via
  `chunks.tickWater(dt)` — Game calls it every frame). Physics still treats
  every wet cell as a full cell. `__lbw.waterSurfaceAt` is the test lens.
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
- ⚠️ **This worktree has twice silently reverted working-tree files mid-session**
  (game.ts, sky.ts, main.ts, tests…): commit early, commit often, and re-check
  `git status`/`git log` after any mysterious failure.
