/**
 * Mine carts, the way the big game does them.
 *
 * A cart is not a block: it is a thing that rolls. It lives on the track graph
 * (core/rails.ts) and remembers only where along that graph it is — the cell it
 * is in, how far through the cell, which way it is headed and how fast. From
 * that, everything else follows: corners, slopes, crossings, the shove of a
 * powered rail, and what happens when the track runs out from under it.
 *
 * A cart carries one rider. While a kid is aboard, the stick leans the cart
 * forwards or backwards and, at a corner, the cart turns the way they are
 * looking — steering without a steering wheel. An empty cart is just as much
 * fun: shove it and it rolls away down the line, faster over every red rail,
 * and off the end of the track if there is no red rail to save it.
 */

import * as THREE from 'three';
import {
  CART_HEIGHT, CART_LENGTH, CART_SEAT, CART_WIDTH, isRailBlock, isSolidBlock, isWaterId, RAIL_HEIGHT, solidHeightOf,
} from './blocks';
import { AudioKit } from './audio';
import { ParticleSystem } from './particles';
import {
  BACK, chooseExit, DIRS, exitLevelOf, isSlopeCell, LINK_DOWN, LINK_UP, railCellAt, RailCell,
} from './rails';
import { World, WORLD_SX, WORLD_SY, WORLD_SZ } from './world';

/** how fast a cart may go, in cells per second */
export const CART_MAX_SPEED = 8.4;
/** the speed a powered rail throws a cart into */
export const CART_BOOST_SPEED = 6.6;

/** cells/s² of ordinary rolling friction */
const FRICTION = 0.85;
/** ...plus a little air resistance, so a fast cart sheds speed faster than a crawl */
const DRAG = 0.05;
/** cells/s² that gravity contributes on a one-block-per-cell slope */
const SLOPE_ACCEL = 6.6;
/** cells/s² a kid leaning into it adds */
const RIDER_PUSH = 5.0;
/** under this speed, and with nobody pushing, a cart settles */
const STOP_SPEED = 0.3;
/** gravity for a cart that has run off the end of the track */
const GRAVITY = 24;
/** a bump is only fun once, so each cart waits a beat between them */
const BUMP_SECONDS = 0.7;
/** and neither a shove nor a hill may spin a parked cart round every single step */
const FLIP_COOLDOWN = 0.9;
/** how long one roll of the rumble lasts while a cart is running */
const ROLL_SECONDS = 0.34;
/** how high the rider sits above the cart's own floor */
export const CART_RIDE_SEAT = CART_SEAT;

/**
 * What the cart needs from a riding kid. PlayerEntity satisfies this on its own,
 * so this module never has to know anything about players.
 */
export interface CartRider {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** which way they are LOOKING: at a corner the cart goes the way they look */
  yaw: number;
  /** -1..1: how hard they lean into it (forward = the way the cart is headed) */
  cartPush: number;
  /** which way the seat faces: the cart turns the rider with it at corners */
  seatYaw: number;
}

/** which way a rider's seat faces for each track direction (yaw, see PlayerEntity) */
export const SEAT_YAW: ReadonlyArray<number> = [Math.PI / 2, -Math.PI / 2, 0, Math.PI];

/** a bystander big enough to be bumped: a kid, or a sheep */
export interface CartBystander {
  pos: THREE.Vector3;
}

/** a cart as it is written into a save: one row per cart standing in the world */
export interface SavedCart {
  x: number;
  y: number;
  z: number;
  dir: number;
}

const STEEL = 0x8f97a8;
const STEEL_DARK = 0x5d6472;
const RIM_YELLOW = 0xffc94a;

interface CartGeometries {
  floor: THREE.BoxGeometry;
  end: THREE.BoxGeometry;
  side: THREE.BoxGeometry;
  rimLong: THREE.BoxGeometry;
  rimShort: THREE.BoxGeometry;
}

let cartGeo: CartGeometries | null = null;

/** one set of shared boxes for every cart in the world (the cart is long ways along x) */
function cartGeometries(): CartGeometries {
  if (!cartGeo) {
    const t = 0.12; // the tub's wall thickness
    cartGeo = {
      floor: new THREE.BoxGeometry(CART_LENGTH, t, CART_WIDTH),
      end: new THREE.BoxGeometry(t, CART_HEIGHT, CART_WIDTH),
      side: new THREE.BoxGeometry(CART_LENGTH, CART_HEIGHT, t),
      // the bright edge goes round the top, it does not close it over: a plate
      // there turned the tub into a lid and the cart read as a chest
      rimLong: new THREE.BoxGeometry(CART_LENGTH + 0.1, 0.09, 0.11),
      rimShort: new THREE.BoxGeometry(0.11, 0.09, CART_WIDTH + 0.1),
    };
  }
  return cartGeo;
}

/**
 * The cart: a boxy iron tub with a bright yellow rim to its top edge, sitting
 * on the track. Open at the top so a kid riding it is plainly sitting in it.
 */
function buildCartMesh(): THREE.Group {
  const geo = cartGeometries();
  const g = new THREE.Group();
  const iron = new THREE.MeshLambertMaterial({ color: STEEL });
  const dark = new THREE.MeshLambertMaterial({ color: STEEL_DARK });
  const bright = new THREE.MeshLambertMaterial({ color: RIM_YELLOW });
  const wall = CART_HEIGHT / 2 + 0.07;
  const add = (mesh: THREE.Mesh, mat: THREE.Material, x: number, y: number, z: number): void => {
    mesh.material = mat;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(new THREE.Mesh(geo.floor), dark, 0, 0.07, 0);
  add(new THREE.Mesh(geo.end), iron, -(CART_LENGTH / 2 - 0.06), wall, 0);
  add(new THREE.Mesh(geo.end), iron, CART_LENGTH / 2 - 0.06, wall, 0);
  add(new THREE.Mesh(geo.side), iron, 0, wall, -(CART_WIDTH / 2 - 0.06));
  add(new THREE.Mesh(geo.side), iron, 0, wall, CART_WIDTH / 2 - 0.06);
  const rim = CART_HEIGHT + 0.075;
  add(new THREE.Mesh(geo.rimLong), bright, 0, rim, -(CART_WIDTH / 2 + 0.005));
  add(new THREE.Mesh(geo.rimLong), bright, 0, rim, CART_WIDTH / 2 + 0.005);
  add(new THREE.Mesh(geo.rimShort), bright, -(CART_LENGTH / 2 + 0.005), rim, 0);
  add(new THREE.Mesh(geo.rimShort), bright, CART_LENGTH / 2 + 0.005, rim, 0);
  g.userData.cart = true; // so a tidy-up (or a test) can spot a cart rig
  return g;
}

/** the top of the first solid cell at or below y in this column, or null */
function solidTopBelow(world: World, x: number, y: number, z: number): number | null {
  for (let cy = Math.min(WORLD_SY - 1, y); cy >= 0; cy--) {
    const id = world.get(x, cy, z);
    if (isRailBlock(id)) return cy + RAIL_HEIGHT;
    const h = solidHeightOf(id);
    if (h > 0) return cy + h;
  }
  return null;
}

/** can the cart's box move through this cell? (rails, flowers and air are fine) */
function openForCart(world: World, x: number, y: number, z: number): boolean {
  const id = world.get(x, y, z);
  return !isSolidBlock(id) && !isWaterId(id);
}

/**
 * One cart. The cell it is in plus `s` (how far through that cell, from -0.5 at
 * the way it came in to +0.5 at the way out) says exactly where it is, and the
 * three levels say how high the track is at the entry edge, in the middle and
 * at the exit edge — which is how slopes work with no curved geometry at all.
 */
export class Minecart {
  /** the rail cell the cart's centre is in */
  cx: number;
  cy: number;
  cz: number;
  /** -0.5..0.5 of the way through that cell, measured along `dir` */
  s = 0;
  dir: number;
  speed = 0;
  /** the track height at the entry edge, the middle and the exit edge */
  enterLevel: number;
  midLevel: number;
  exitLevel: number;
  /** false once the cart is off the rails — falling, or lying on the ground */
  onRails = true;
  /** where it actually is: the middle of the cart's floor, in world space */
  x: number;
  y: number;
  z: number;
  /** how fast it is falling, when it is off the rails */
  fallV = 0;
  rider: CartRider | null = null;
  readonly group: THREE.Group;
  /** the junction in this cell has already been taken care of */
  private decided = false;
  /** no clunk, no second shove: the manager reads and sets these */
  bumpCool = 0;
  rollCool = 0;
  /** a cart that has just been turned round does not turn again until asked to */
  private flipCool = 0;
  /** how long the rider has been leaning backwards (it owns the turn) */
  private leanFlipped = false;
  private bob = 0;

  constructor(world: World, cx: number, cy: number, cz: number, dir = 0) {
    this.cx = cx; this.cy = cy; this.cz = cz;
    this.dir = dir >= 0 && dir <= 3 ? dir : 0;
    this.x = cx + 0.5;
    this.z = cz + 0.5;
    const cell = railCellAt(world, cx, cy, cz);
    if (cell) {
      this.enterLevel = this.midLevel = this.exitLevel = cy + RAIL_HEIGHT;
      this.y = this.midLevel;
    } else {
      // no track under it: it sits on whatever is down there instead
      this.y = solidTopBelow(world, cx, cy, cz) ?? 0;
      this.enterLevel = this.midLevel = this.exitLevel = this.y;
      this.onRails = false;
    }
    this.group = buildCartMesh();
    this.syncMesh();
  }

  /** where the cart is — the e2e lens, and anything that wants to find it */
  get center(): [number, number, number] {
    return [this.x, this.y, this.z];
  }

  /** true while the cart is genuinely running (the rumble, and the e2e) */
  get moving(): boolean {
    return this.speed > 0.4;
  }

  /**
   * Which way the cart leaves its cell, settled once per cell at its middle.
   * Cheap to call again from the move loop — a cart carried over the middle by a
   * coarse frame must still take the corner before it leaves the cell.
   */
  private decideJunction(world: World, cell: RailCell): void {
    if (this.decided || this.s < 0) return;
    this.decided = true;
    const go = chooseExit(cell, this.dir, this.rider ? this.rider.yaw : null, Math.random);
    // go < 0 is a dead end: keep going and see what happens (that is the fun part)
    if (go >= 0) this.setDir(world, go, cell);
    this.exitLevel = exitLevelOf(cell, this.dir);
  }

  /** point the cart a new way, keeping the ground it has already covered */
  private setDir(world: World, d: number, cell: RailCell): void {
    if (d < 0 || d > 3 || d === this.dir) return;
    this.dir = d;
    this.s = Math.max(0, this.s); // the few pixels past the middle are forgiven
    this.midLevel = this.cy + RAIL_HEIGHT + (isSlopeCell(cell, d) ? 0.5 : 0);
    this.exitLevel = exitLevelOf(cell, d);
    void world;
  }

  /** spin on the spot without losing ground: this is what bouncing back is */
  private turnAround(): void {
    this.dir = BACK[this.dir];
    this.s = -this.s;
    const swap = this.enterLevel;
    this.enterLevel = this.exitLevel;
    this.exitLevel = swap;
    this.midLevel = this.cy + RAIL_HEIGHT + (this.midLevel > this.cy + RAIL_HEIGHT + 0.25 ? 0.5 : 0);
  }

  /**
   * One step of the ride. The cart is the authority on where it is; a rider is
   * carried along afterwards (see MinecartManager.update).
   */
  step(world: World, dt: number, mgr: MinecartManager): void {
    this.bumpCool = Math.max(0, this.bumpCool - dt);
    this.flipCool = Math.max(0, this.flipCool - dt);
    if (!this.onRails) {
      this.stepOffRail(world, dt);
      return;
    }

    let cell = railCellAt(world, this.cx, this.cy, this.cz);
    if (!cell) {
      // somebody pulled the rail out from under it
      this.leaveTrack();
      this.stepOffRail(world, dt);
      return;
    }

    // ---- what pushes on it ----
    // The stick leans the cart: forward goes the way the seat faces, back turns
    // it round (the seat turns with it, so the kid is always leaning the way
    // they travel) and goes the other way. The lean stays in charge until the
    // stick comes back, which is what stops a parked cart shivering on a hill.
    const push = this.rider ? Math.max(-1, Math.min(1, this.rider.cartPush)) : 0;
    if (push > -0.2) this.leanFlipped = false;
    if (push !== 0) {
      if (push < 0 && !this.leanFlipped && this.flipCool <= 0) {
        this.turnAround();
        this.flipCool = FLIP_COOLDOWN;
        this.leanFlipped = true;
      }
      const drive = push > 0 || this.leanFlipped;
      if (drive) this.speed += Math.abs(push) * RIDER_PUSH * dt;
      else this.speed = Math.max(0, this.speed - Math.abs(push) * RIDER_PUSH * dt);
    }
    // gravity along the slope of the cell it is crossing
    const grade = this.exitLevel - this.enterLevel;
    if (grade !== 0) this.speed -= grade * SLOPE_ACCEL * dt;
    // and plain rolling friction — which is why kids line the line with red rails
    this.speed = Math.max(0, this.speed - (FRICTION + DRAG * this.speed) * dt);
    // A cart with nobody leaning in settles — unless gravity has hold of it.
    // On a downhill cell the crawl it just earned is how a parked cart starts
    // rolling, so pinching that off is what made carts sit frozen on slopes
    // instead of running away down them.
    if (this.speed < STOP_SPEED && push === 0 && grade >= 0) {
      this.speed = 0;
      if (grade > 0 && this.flipCool <= 0) {
        this.turnAround(); // parked facing uphill on a slope: it rolls back down
        this.flipCool = FLIP_COOLDOWN;
      }
    }
    if (this.speed > CART_MAX_SPEED) this.speed = CART_MAX_SPEED;

    // ---- the junction, taken at the middle of the cell ----
    this.decideJunction(world, cell);

    // ---- the red rail: any cart that rolls over gets thrown along ----
    if (cell.powered && this.speed < CART_BOOST_SPEED) {
      this.speed = CART_BOOST_SPEED;
      mgr.boosted(this);
    }

    // ---- another cart sitting in the cell ahead: catch up and follow it ----
    let [dx, dz] = DIRS[this.dir];
    const ahead = mgr.cartIn(this.cx + dx, this.cy + (cell.links[this.dir] === LINK_UP ? 1 : 0), this.cz + dz, this);
    if (ahead && this.speed > ahead.speed) {
      this.speed = ahead.speed;
      mgr.coupled(this, ahead);
    }

    // ---- move ----
    this.s += this.speed * dt;
    while (this.s >= 0.5) {
      // Settle the junction before leaving the cell. With `dt` capped at 0.05 a
      // cart can't cross the middle and the far side in one step, so today this
      // only ever repeats a decision already made — it is here for whoever
      // raises CART_MAX_SPEED or the cap and would otherwise ship a cart that
      // barrels straight off the end of a line at a corner.
      this.decideJunction(world, cell);
      [dx, dz] = DIRS[this.dir];
      const link = cell.links[this.dir];
      cell = railCellAt(world,
        this.cx + dx,
        this.cy + (link === LINK_UP ? 1 : link === LINK_DOWN ? -1 : 0),
        this.cz + dz,
      );
      this.cx += dx;
      this.cz += dz;
      if (link === LINK_UP) this.cy++;
      else if (link === LINK_DOWN) this.cy--;
      this.s -= 1;
      this.decided = false;
      if (!cell) {
        this.leaveTrack();
        return;
      }
      this.enterLevel = this.exitLevel;
      this.midLevel = this.cy + RAIL_HEIGHT + (isSlopeCell(cell, this.dir) ? 0.5 : 0);
      this.exitLevel = exitLevelOf(cell, this.dir);
    }

    // the track height: one straight ramp through each half of the cell
    this.y = this.s < 0
      ? this.enterLevel + (this.midLevel - this.enterLevel) * (this.s + 0.5) * 2
      : this.midLevel + (this.exitLevel - this.midLevel) * this.s * 2;
    this.x = this.cx + 0.5 + dx * this.s;
    this.z = this.cz + 0.5 + dz * this.s;
    if (this.x < 0.25 || this.x > WORLD_SX - 0.25 || this.z < 0.25 || this.z > WORLD_SZ - 0.25) this.leaveTrack();
  }

  /** step off the rails: keep the speed, start falling, sit down when land appears */
  private leaveTrack(): void {
    if (this.onRails) {
      this.onRails = false;
      this.fallV = 0;
    }
  }

  /** off the track: a straight roll, gravity, and the ground always winning */
  private stepOffRail(world: World, dt: number): void {
    const [dx, dz] = DIRS[this.dir];
    if (this.speed > 0) {
      const nx = this.x + dx * this.speed * dt;
      const nz = this.z + dz * this.speed * dt;
      if (openForCart(world, Math.floor(nx), Math.floor(this.y + 0.3), Math.floor(nz))) {
        this.x = Math.max(0.25, Math.min(WORLD_SX - 0.25, nx));
        this.z = Math.max(0.25, Math.min(WORLD_SZ - 0.25, nz));
        this.speed = Math.max(0, this.speed - (FRICTION * 3 + DRAG * this.speed) * dt);
      } else {
        this.speed = 0; // it ran into the side of a wall
      }
    }
    const cx = Math.floor(this.x), cz = Math.floor(this.z);
    const floor = solidTopBelow(world, cx, Math.floor(this.y), cz) ?? 0;
    if (this.y > floor + 0.001) {
      this.fallV = Math.min(this.fallV + GRAVITY * dt, 30);
      this.y = Math.max(floor, this.y - this.fallV * dt);
      if (this.y <= floor + 0.001) this.fallV = 0;
    } else {
      this.y = floor;
      this.fallV = 0;
      // re-rail it: somebody may have laid track underneath in the meantime.
      // The cart lies with its wheels on the ground, which is the floor of the
      // cell a rail in that column would occupy — so the cell it is IN is the
      // cell to look at, not the one below it.
      const cell = railCellAt(world, cx, Math.floor(this.y + 0.01), cz);
      if (cell) {
        this.onRails = true;
        this.cx = cx; this.cy = cell.y; this.cz = cz;
        this.s = 0;
        this.decided = false;
        this.enterLevel = this.midLevel = this.exitLevel = cell.y + RAIL_HEIGHT;
      }
    }
  }

  /** put the meshes where the state says the cart is */
  syncMesh(dt = 0): void {
    this.group.position.set(this.x, this.y, this.z);
    // the long way of the cart lies along the track; a corner swings it round
    const wantYaw = this.dir === 2 || this.dir === 3 ? Math.PI / 2 : 0;
    let diff = wantYaw - this.group.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y += diff * (dt > 0 ? 1 - Math.exp(-12 * dt) : 1);
    // a running cart rattles; a parked one sits still
    if (dt > 0) {
      this.bob = this.moving ? this.bob + this.speed * dt * 6 : this.bob * 0.85;
      this.group.position.y += Math.sin(this.bob) * 0.014;
      this.group.rotation.z = Math.sin(this.bob * 0.5) * 0.02;
    }
  }
}

export interface CartHooks {
  /** the kids and the animals a runaway cart may bump into */
  bystanders: () => CartBystander[];
  /** a cart ran into somebody, and the game decides what that means */
  onBump: (cart: Minecart, who: CartBystander, speed: number) => void;
}

export class MinecartManager {
  readonly carts: Minecart[] = [];
  /** how many carts have been set down this session (the e2e lens) */
  spawnCount = 0;
  private hooks: CartHooks;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private particles: ParticleSystem,
    private audio: AudioKit,
    hooks: CartHooks,
  ) {
    this.hooks = hooks;
  }

  get count(): number {
    return this.carts.length;
  }

  /** the cart a kid is riding, if any */
  cartOfRider(riderId: number): Minecart | null {
    return this.carts.find((c) => c.rider?.id === riderId) ?? null;
  }

  /**
   * Set a cart down on the rail at this cell — or on the bare ground where
   * there is no rail, which is how a cart ends up in a kid's garden.
   */
  spawn(cx: number, cy: number, cz: number, dir = 0): Minecart | null {
    if (!this.world.inBounds(cx, cy, cz)) return null;
    if (this.cartIn(cx, cy, cz)) return null;
    const cart = new Minecart(this.world, cx, cy, cz, dir);
    this.carts.push(cart);
    this.scene.add(cart.group);
    this.spawnCount++;
    this.audio.cartSet();
    this.particles.burst(cart.x, cart.y + 0.4, cart.z, 0xb7c0cf, 8, 0.8);
    return cart;
  }

  /** take a cart out of the world: it comes apart into a handful of sparkles */
  despawn(cart: Minecart): void {
    if (!this.carts.includes(cart)) return;
    cart.rider = null;
    this.carts.splice(this.carts.indexOf(cart), 1);
    this.scene.remove(cart.group);
    this.particles.burst(cart.x, cart.y + 0.4, cart.z, 0x9aa3b2, 14, 1.1);
    this.audio.cartBreak();
  }

  /** every cart out of the scene — a new world is coming in */
  clear(): void {
    for (const c of [...this.carts]) {
      c.rider = null;
      this.scene.remove(c.group);
    }
    this.carts.length = 0;
  }

  /** carts that came back with the save stand where the family left them */
  restoreFromSave(list: SavedCart[] | undefined): void {
    if (!list) return;
    for (const c of list) {
      if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || !Number.isInteger(c.z)) continue;
      if (!this.world.inBounds(c.x, c.y, c.z)) continue;
      this.spawn(c.x, c.y, c.z, c.dir);
    }
  }

  /** what the save should remember about the carts right now */
  toSave(): SavedCart[] {
    return this.carts.map((c) => ({ x: c.cx, y: c.cy, z: c.cz, dir: c.dir }));
  }

  /** hop in */
  board(cart: Minecart, rider: CartRider): boolean {
    if (!cart || cart.rider || !rider) return false;
    cart.rider = rider;
    rider.cartPush = 0;
    this.audio.cartBoard();
    return true;
  }

  /** hop out */
  dismount(riderId: number): Minecart | null {
    const cart = this.cartOfRider(riderId);
    if (!cart) return null;
    cart.rider = null;
    this.audio.cartExit();
    return cart;
  }

  /**
   * Which cart the aim is on, if any: march the ray and stop at the first cart
   * it touches — or at the first wall, so a cart behind a wall stays behind it.
   */
  pickAim(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist = 4.6,
  ): Minecart | null {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
    for (let t = 0.2; t <= maxDist; t += 0.12) {
      const px = origin.x + dx * t, py = origin.y + dy * t, pz = origin.z + dz * t;
      if (isSolidBlock(this.world.get(Math.floor(px), Math.floor(py), Math.floor(pz)))) return null;
      const hit = this.near(px, py, pz, 0.62);
      if (hit) return hit;
    }
    return null;
  }

  /** the closest cart within `radius` of a point */
  near(x: number, y: number, z: number, radius = 0.8): Minecart | null {
    let best: Minecart | null = null, bestD = radius;
    for (const c of this.carts) {
      const d = Math.hypot(c.x - x, c.y + 0.35 - y, c.z - z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** is a cart already standing in this cell? (two carts do not share a cell) */
  cartIn(x: number, y: number, z: number, except?: Minecart): Minecart | null {
    for (const c of this.carts) {
      if (c === except) continue;
      if (c.onRails) {
        if (c.cx === x && c.cy === y && c.cz === z) return c;
      } else if (Math.floor(c.x) === x && Math.floor(c.y) === y && Math.floor(c.z) === z) return c;
    }
    return null;
  }

  /** called as a cart rolls over a powered rail */
  boosted(cart: Minecart): void {
    this.audio.cartBoost();
    this.particles.burst(cart.x, cart.y + 0.25, cart.z, 0xffd24a, 6, 0.7);
  }

  /** two carts came together: they match speeds and carry on as a train */
  coupled(a: Minecart, b: Minecart): void {
    if (a.bumpCool > 0 || b.bumpCool > 0) return;
    a.bumpCool = BUMP_SECONDS;
    b.bumpCool = BUMP_SECONDS;
    this.audio.cartBump();
  }

  update(dt: number): void {
    for (const c of this.carts) {
      const beforeY = c.y;
      c.step(this.world, dt, this);
      if (c.rider) {
        // the cart carries the kid: feet on the seat, velocity along the track
        const [dx, dz] = DIRS[c.dir];
        c.rider.seatYaw = SEAT_YAW[c.dir];
        c.rider.pos.set(c.x, c.y + CART_RIDE_SEAT, c.z);
        c.rider.vel.set(
          c.onRails ? dx * c.speed : 0,
          (c.y - beforeY) / Math.max(dt, 1e-4),
          c.onRails ? dz * c.speed : 0,
        );
      }
      // the rumble: one sample every beat while the cart is actually running
      c.rollCool -= dt;
      if (c.moving && c.rollCool <= 0) {
        c.rollCool = ROLL_SECONDS;
        this.audio.cartRoll(c.speed / CART_MAX_SPEED);
      }
      this.bumpAround(c);
      c.syncMesh(dt);
    }
  }

  /** a cart at speed shoves whatever is standing in its way */
  private bumpAround(cart: Minecart): void {
    if (!cart.moving || cart.bumpCool > 0 || cart.speed < 2.2) return;
    const [dx, dz] = DIRS[cart.dir];
    for (const who of this.hooks.bystanders()) {
      if (who === cart.rider) continue;
      const rx = who.pos.x - cart.x, rz = who.pos.z - cart.z;
      // the cart hits things with its front end, so the box is longer one way
      const along = rx * dx + rz * dz;
      const across = Math.abs(rx * dz - rz * dx);
      if (Math.abs(along) > CART_LENGTH / 2 + 0.4 || across > CART_WIDTH / 2 + 0.34) continue;
      if (who.pos.y > cart.y + CART_HEIGHT || cart.y > who.pos.y + 1.9) continue;
      cart.bumpCool = BUMP_SECONDS;
      cart.speed *= 0.45;
      this.audio.cartBump();
      this.particles.burst(cart.x, cart.y + 0.5, cart.z, 0xffe14d, 6, 0.8);
      this.hooks.onBump(cart, who, cart.speed);
      return; // one bump per beat: a crowd is not a stutter of clunks
    }
  }
}
