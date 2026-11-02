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
  Leave / Waiting-Players rows and the water-jump fix still owe the couch a
  turn).
