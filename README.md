# 🧱 Little Block World

![Little Block World — a kid's house in the meadow at golden hour](docs/screenshots/hero.jpg)

A colorful, controller-first voxel sandbox for kids — inspired by Minecraft
Creative mode, built for a 5-year-old and a parent on one couch.

- 🎮 **Play online right now:** <https://vesanieminen.github.io/Simplecraft/>
  (in-browser save, see [How the world saves](#how-the-world-saves) — a split-screen
  couch session also works on one machine with two controllers plugged into it)
- No accounts, no internet needed after install, no external services.
- Two controllers on one computer = instant split screen (up to 4 players).
- A big world to explore: **128 × 128 × 64** blocks (four times the size of
  the first build), generated from a seed you choose.
- **Four worlds to pick from** at the start — Meadow, Islands, Mountains and
  Deep Forest — plus any seed, with a live map preview.
- A world that saves itself and survives restarts (one save per world).
- Friendly animals, glowing stars to collect, bouncy blocks, musical
  blocks, and a world full of textured flowers, grass tufts, lakes, and trees.

## Choosing your world

![Pick a world and a seed before anyone joins — with a live map preview](docs/screenshots/worlds.jpg)

Before anybody joins, press **Y / △** on a controller (or **F** on the
keyboard) to open the world chooser:

- 🌍 **World** — Meadow · Islands · Mountains · Deep Forest (left/right).
- 🎲 **Seed** — step it up and down, or hit **✨ Surprise me!** for a random one.
- The picture above is drawn from the same heightmap math the generator uses,
  so what you see is what you get.
- **▶ Start this world!** — every (world, seed) pair is saved separately, so
  each family member can keep their own builds.
- Grown-ups can also switch worlds mid-game from *Start → Grown-Ups → Choose
  World*, and the URL takes both: `?seed=12345&world=2`
  (`world` = 0 Meadow, 1 Islands, 2 Mountains, 3 Deep Forest).

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

![Two players sharing one world, each with their own camera and HUD](docs/screenshots/split.jpg)

1. Plug in two controllers (Xbox, PlayStation, or any standard pad).
2. Open the game in a browser. (Optional: press **Y / △** first to pick a
   world — see [Choosing your world](#choosing-your-world).)
3. **Player 1 presses any button** on their controller → pick a color and
   name → press **A / ✕** to join.
4. **Player 2 presses any button** on the *other* controller → join card
   appears in a new half of the screen → confirm.
5. Split screen activates automatically. Side-by-side on wide screens,
   top/bottom on tall ones (change it in Grown-Up Settings).

Up to **four players** can join on one computer (2×2 grid). Just press a
button on each additional controller. You can also mix: player 1 on
keyboard + player 2 on a controller.

### Someone is finished playing

- **Start → 🚪 Leave** (press **A** twice — kids press everything, so it asks):
  that player goes home, *their part of the split screen closes* and the others
  get the space back. Their builds stay in the world.
- Press any button on that controller a moment later and a fresh join card
  appears, so a sibling can take the seat over.
- If the **last** player leaves, the welcome screen comes back.
- A controller that merely *falls asleep* keeps its seat and shows a wake-up
  card. A grown-up can clear those with
  *Start → 🧑 Grown-Ups → 💤 Waiting Players* (two presses again) — the
  sleeping players go home and the screen closes up.

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
| Y / △ | Open the block palette (before anyone joins: choose a world) |
| D-pad | Navigate menus |
| Start / Options | Player menu (fly, camera, home, help…) |
| B / ◯ | Back / close |

Everything is doable with a controller only — joining, palettes, menus,
settings, help, everything.

## Keyboard & mouse (optional)

WASD move · arrow keys look · Space jump · LMB place · RMB break ·
Q/R cycle blocks · F palette · E pet animals · Esc menu · Enter confirm.

## Flowers you can actually pick

![Textured flowers, sunflowers and grass tufts — breakable with LT](docs/screenshots/plants.jpg)

Flowers, sunflowers and grass tufts are real textured plants: each one is a
pair of crossed quads painted from a procedural 32-px atlas (drawn in code,
still no image files). They sway in with the world, you walk straight through
them — and **LT / L2 breaks them**, because the break button also targets
things that aren't solid. Water and bedrock stay indestructible, and plants
never get in the way when you place a block (the two aim at slightly
different things so both just work).

## Swimming — and how to get out

Lakes, rivers and the Islands world are properly swimmable: you bob at the
surface, paddle with the move stick and hold **A / ✕** to kick upward. Once
your head is clear of the water, that same button *pushes you out* — a real
jump, so you hop onto the bank or the rim of a pool instead of paddling in
circles. Fully submerged, kick up to the surface first. If a bank is more than
a block above the water, place a block or dig a step to make a stair.

## How the world saves

- **On the GitHub Pages site** the game runs entirely in your browser: the
  world is saved in that browser's local storage (per computer, per
  browser). Great for playing instantly; for a shared family world, run
  the game from a computer at home as below.
- The terrain you start with is generated from a **seed + world theme**
  (default `20261102`, Meadow). Only player edits (blocks placed/removed,
  stars collected) are stored — a few KB, not the whole world.
- Edits are saved through the local server to
  `world-data/world-<seed>-<world>.json` (atomic write + backup + corruption
  recovery), with a browser-cache fallback if the server is briefly
  unreachable. Each world you choose gets its own file, so nobody overwrites
  anybody else's house.
- Restart the server any time; your buildings are still there.
- **Reset the world** deliberately from *Start → Grown-Ups → Reset World*
  (asks twice).
- Grown-Up Settings (Start → 🧑 Grown-Ups) also has **Freeze Game** — the
  whole world stops dead, animals and players included, so a parent can
  pause the adventure — **Choose World** to move the family to a new
  world/theme/seed mid-game, and the **Split Screen** switch
  (Smart · Left/Right · Up/Down · 2×2 Grid).
- Use a different world per family with `?seed=12345&world=1` in the URL
  (each world + seed gets its own saved edits).

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
- **Paddling in circles in the water** — hold the jump button: at the surface
  it pushes you out onto the bank. If the bank is higher than that, place a
  block or dig a step to make a stair out.
- **Low framerate on an old laptop** — close other tabs; the renderer is
  capped at 1.5× pixel ratio; quarter (4-player) panes cost the most.

## Testing status (honest)

Automated (Playwright, real Chromium, 26 tests): game loads error-free,
keyboard-only join, controller join/move/jump/build/cycle, palette with
D-pad, per-player menu + fly toggle, split-screen activation, 2×2
four-player grid, independent movement, one player's palette not pausing
the other, resize re-layout, controller disconnect/resume UI, and world
persistence across a server-backed reload. New this round: plants render
from the textured atlas and **LT breaks them** (while water and bedrock
refuse to break and plants never block placement), the Grown-Up menu items
really work (Freeze stops the whole world dead, split-screen layouts cycle
through Smart/Left-Right/Up-Down/2×2, Reset World wipes edits, Choose World
starts a new theme+seed and the preview canvas actually paints a map), the
welcome-screen world picker (theme, surprise seed, start), menu
sub-screens receiving controller input, `?seed=…&world=…` handling,
walking into a pond then **hopping back out** with the jump button held, a
player **leaving** so their half of the split screen really closes (pane, HUD
and card removed, the others go full screen, the freed controller can invite a
new player, and the welcome screen returns when the last one leaves), and
clearing controller-asleep players from Grown-Up Settings.

```bash
npm test          # e2e suite (starts its own server on :3100)
npm run typecheck
```

**Physical controllers: tested on real hardware.** The family played it with an
**Xbox One** pad and a **PS5 DualSense** — both worked fine: joining, both
sticks, building, palette, menus, split screen and waking a sleeping
controller. The items below are what to re-check after any input change; the
brand-new **Leave / Waiting Players** rows and the **jump out of water** fix
have not had their couch turn yet. Virtual pads in the automated tests drive
the exact same input abstraction (dead zones, edge detection, button mapping
all shared) — a good regression net, still not a substitute for hardware QA.

1. Press **Y / △** on a pad at the welcome screen → the world chooser opens
   on that pad: D-pad moves, left/right switch world and seed, **✨ Surprise
   me!** rolls a seed, **A** starts that world. The map picture should match
   the world you end up in.
2. Press A on each pad → two join cards appear. In a card: D-pad changes
   name/color, A joins, B cancels.
3. Right stick looks around on both pads simultaneously.
4. RT/LT place and break blocks; LB/RB cycle; Y opens the palette;
   D-pad + A picks a block while the other kid keeps running around.
5. Walk up to a flower and hold **LT** — it pops into particles (and the
   block behind it survives, so you can also dig the ground under it).
6. Walk into a lake and hold **A** — you kick up to the surface, then hop out
   onto the bank instead of paddling in circles (works from the Islands sea too).
7. Start menu → Fly ON → A rises, X descends, gentle landing.
8. Start → Grown-Ups: **Freeze Game** stops players *and* animals dead
   (menus still work), **Split Screen** cycles the layout, **Choose World**
   opens the picker, **Reset World** asks twice.
9. Unplug a controller mid-game → "controller asleep" appears → plug in
   (or press another pad) → same character resumes.
10. Start → 🚪 **Leave** → press **A** twice: that half of the screen closes,
    the other player goes full screen, and the sleeping seat is cleared by
    Start → 🧑 Grown-Ups → 💤 **Waiting Players** (also two presses). A moment
    later, a button on the left controller should open a fresh join card.
11. Analog: gentle stick tilts walk slowly; menus don't machine-gun.

## Roadmap

Implemented: a 128 × 128 × 64 voxel world (four world themes + any seed,
picked on a screen with a live map preview), building, textured plants,
animals, stars, special blocks, audio, particles, complete controller UX,
2–4 player split screen, per-world persistence.

Next (designed for): LAN multiplayer — the architecture already separates
*local player*, *remote player*, *controller*, *camera*, and *network
player*; the save API already merges concurrent writers, so Socket.IO
sync is the next step.

## Tech

TypeScript · Three.js · Vite · Node/Express (+ `ws` ready) · Playwright.
All art, models, and sounds are original and procedural — no Minecraft
assets. Original code, MIT-style for your family's fun.
