# 🧱 Little Block World

A colorful, controller-first voxel sandbox for kids — inspired by Minecraft
Creative mode, built for a 5-year-old and a parent on one couch.

- No accounts, no internet needed after install, no external services.
- Two controllers on one computer = instant split screen (up to 4 players).
- A world that saves itself and survives restarts.
- Friendly animals, glowing stars to collect, bouncy blocks, musical
  blocks, and a world full of flowers, lakes, and trees.

## Launch

```bash
npm install
npm run dev
```

Then open **http://localhost:3000** — that's it. The terminal prints the
exact address to use from other computers.

Production mode (faster):

```bash
npm run build
npm start
```

## Playing together

### Two controllers, one computer (split screen)

1. Plug in two controllers (Xbox, PlayStation, or any standard pad).
2. Open the game in a browser.
3. **Player 1 presses any button** on their controller → pick a color and
   name → press **A / ✕** to join.
4. **Player 2 presses any button** on the *other* controller → join card
   appears in a new half of the screen → confirm.
5. Split screen activates automatically. Side-by-side on wide screens,
   top/bottom on tall ones (change it in Grown-Up Settings).

Up to **four players** can join on one computer (2×2 grid). Just press a
button on each additional controller. You can also mix: player 1 on
keyboard + player 2 on a controller.

### Other computers on the home network (LAN)

The dev server binds to `0.0.0.0`, so other computers on the same Wi-Fi
can open the address the terminal prints, e.g. `http://192.168.1.50:3000`.
(Sharing one world across computers — true multiplayer sync — is the next
milestone; see Roadmap. Today, each computer gets the same saved world.)

## Controller controls

| Button | Action |
|---|---|
| Left stick | Walk / swim / fly sideways |
| Right stick | Look around / aim |
| A / ✕ | Jump (hold while flying = up) |
| RT / R2 | Place block |
| LT / L2 | Break block |
| LB / L1 | Previous block |
| RB / R1 | Next block |
| X / ☐ | Pet animals (hold while flying = down) |
| Y / △ | Open the block palette |
| D-pad | Navigate menus |
| Start / Options | Player menu (fly, camera, home, help…) |
| B / ◯ | Back / close |

Everything is doable with a controller only — joining, palettes, menus,
settings, help, everything.

## Keyboard & mouse (optional)

WASD move · arrow keys look · Space jump · LMB place · RMB break ·
Q/R cycle blocks · F palette · E pet animals · Esc menu · Enter confirm.

## How the world saves

- The terrain you start with is generated from a **seed** (default
  `20261102`). Only player edits (blocks placed/removed, stars collected)
  are stored — a few KB, not the whole world.
- Edits are saved through the local server to `world-data/world.json`
  (atomic write + backup + corruption recovery), with a browser-cache
  fallback if the server is briefly unreachable.
- Restart the server any time; your buildings are still there.
- **Reset the world** deliberately from *Start → Grown-Ups → Reset World*
  (asks twice). Grown-Ups also has **Freeze Game** (parents can pause
  everything) and the split-screen layout switch.
- Use a different world per family with `?seed=12345` in the URL (each
  seed gets its own saved edits).

## Troubleshooting

- **Controller not detected** — browsers only expose gamepads after a
  button press and usually need one "activation": click the page once,
  press a button. Chrome/Edge/Steam Link work best. Firefox works but
  may need `gamepad.enabled`.
- **Both players joined with one controller** — press the *other*
  controller's button *first*; each controller is bound to whoever
  pressed it. A disconnected controller keeps its player's seat warm:
  press any button on it (or any new pad) to resume the same character.
- **Mouse cursor steals focus** — keyboard player 1 uses Esc for menus;
  game keeps running for everyone else.
- **Block won't place** — you can never place a block inside yourself or
  an animal (you'd get stuck); back up half a step.
- **Low framerate on an old laptop** — close other tabs; the renderer is
  capped at 1.5× pixel ratio; quarter (4-player) panes cost the most.

## Testing status (honest)

Automated (Playwright, real Chromium, 13 tests): game loads error-free,
keyboard-only join, controller join/move/jump/build/cycle, palette with
D-pad, per-player menu + fly toggle, split-screen activation, 2×2
four-player grid, independent movement, one player's palette not pausing
the other, resize re-layout, controller disconnect/resume UI, and world
persistence across a server-backed reload.

```bash
npm test          # e2e suite (starts its own server on :3100)
npm run typecheck
```

**Physical controllers have NOT been hardware-tested yet.** Virtual pads
drive the exact same input abstraction (dead zones, edge detection,
button mapping all shared), but you should verify with real pads. A
5-minute parent checklist:

1. Press A on each pad at the welcome screen → two join cards appear.
2. In a card: D-pad changes name/color, A joins, B cancels.
3. Right stick looks around on both pads simultaneously.
4. RT/LT place and break blocks; LB/RB cycle; Y opens palette;
   D-pad + A picks a block while the other kid keeps running around.
5. Start menu → Fly ON → A rises, X descends, gentle landing.
6. Unplug a controller mid-game → "controller asleep" appears → plug in
   (or press another pad) → same character resumes.
7. Analog: gentle stick tilts walk slowly; menus don't machine-gun.

## Roadmap

Implemented: full voxel world + building + animals + stars + special
blocks + audio + particles, complete controller UX, 2–4 player split
screen, world persistence.

Next (designed for): LAN multiplayer — the architecture already separates
*local player*, *remote player*, *controller*, *camera*, and *network
player*; the save API already merges concurrent writers, so Socket.IO
sync is the next step.

## Tech

TypeScript · Three.js · Vite · Node/Express (+ `ws` ready) · Playwright.
All art, models, and sounds are original and procedural — no Minecraft
assets. Original code, MIT-style for your family's fun.
