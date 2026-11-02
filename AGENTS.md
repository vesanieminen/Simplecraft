# Agent notes for this repo

## Git workflow (always)

- **Never push directly to `main`.** Always work on a feature branch and open
  a pull request; the human tests the PR build before it is merged.
- Branch names: `feature/…`, `fix/…`, `chore/…`.
- Before opening or updating a PR, run:
  `npm run typecheck` · `npm test` (Playwright e2e, starts its own server on
  :3100) · `npm run build`.
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
  fresh world.
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
- Physical gamepad behaviour is verified manually (checklist in the README);
  virtual pads in tests exercise the same input abstraction, which is not a
  substitute for hardware QA.
