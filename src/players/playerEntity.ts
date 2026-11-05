/**
 * Player entity simulation: movement, gravity, jump forgiveness
 * (coyote time + jump buffering), flying, water and special blocks.
 */

import * as THREE from 'three';
import { blockDef } from '../core/blocks';
import { inWater, moveAabb, playerAabb, grounded as groundedTest, headClearOfWater, submergedFraction, MoveResult } from '../core/physics';
import { World, WORLD_SX, WORLD_SZ, WORLD_SY } from '../core/world';
import { AvatarParts, animateAvatar, createAvatar } from './avatar';

export const GRAVITY = 26;
export const JUMP_V = 8.9;
export const WALK_SPEED = 5.0;
export const FLY_SPEED = 7.2;
export const FLY_VERT = 4.6;
/** treasure boosts: zoomy boots run this much faster, boing boots jump this much higher */
export const ZOOM_MUL = 1.5;
export const BOING_MUL = 1.4;

const JUMP_BUFFER = 0.16; // a jump pressed just before landing still counts
const SWIM_UP_V = 3.2; // hold jump to kick up through the water
const SWIM_SINK_V = -1.8; // fastest anyone sinks when nobody holds jump
const SWIM_TRIM = 0.62; // this fraction of the body under water is neutral buoyancy
const STROKE_SECONDS = 0.85; // one breaststroke pull per…
export const WATER_JUMP_V = 8.4; // push-off at the surface: clears a one-block shore
const WATER_JUMP_TIME = 0.45; // buoyancy stays off while that leap carries them out

export interface StepInput {
  moveX: number; // strafe (-1..1)
  moveY: number; // forward (-1..1)
  jump: boolean; // want jump (already edge-handled by caller for buffering)
  flyUp: boolean;
  flyDown: boolean;
  dt: number;
}

export interface StepEvents {
  landed: boolean;
  bounced: null | number; // bounce velocity
  steppedOnMusic: null | { note: number; x: number; y: number; z: number };
  steppedOnSparkle: boolean;
  splashed: boolean;
  /** one swim stroke just happened (whoosh sound please) */
  stroked: boolean;
}

export class PlayerEntity {
  pos: THREE.Vector3; // feet center
  vel = new THREE.Vector3();
  yaw = 0; // facing / camera yaw
  pitch = -0.28; // look slightly down by default so kids aim at the ground
  flying = false;
  grounded = false;
  inWaterNow = false;
  /** true while paddling in water (drives the horizontal swim pose) */
  swimmingNow = false;
  walkPhase = 0;
  moving = false;
  starsCount = 0;
  /**
   * Treasure boosts, counted down in seconds of game time: `zoomTime` while
   * zoomy boots are running fast, `boingTime` while boing boots are jumping
   * high. A treasure chest sets them; the HUD shows a tag while they last.
   */
  zoomTime = 0;
  boingTime = 0;

  jumpBuffer = 0;
  coyote = 0;
  /** > 0 while a push-off jump out of the water carries the player up */
  waterJump = 0;
  /** countdown between swim strokes (sound + reach) */
  private strokeT = 0;
  private wasInAir = false;
  private wasInWater = false;

  readonly avatar: AvatarParts;

  constructor(
    public id: number,
    public name: string,
    public colorHex: string,
    public spawn: THREE.Vector3,
  ) {
    this.pos = spawn.clone();
    this.avatar = createAvatar(colorHex);
    this.syncAvatar(0);
  }

  get aabb() {
    return playerAabb(this.pos.x, this.pos.y, this.pos.z);
  }

  step(world: World, input: StepInput, events: StepEvents): void {
    const dt = Math.min(input.dt, 0.05);
    this.zoomTime = Math.max(0, this.zoomTime - dt);
    this.boingTime = Math.max(0, this.boingTime - dt);
    this.inWaterNow = inWater(world, this.aabb);
    this.waterJump = Math.max(0, this.waterJump - dt);
    // a push-off leap is a real jump: buoyancy is off while it lasts
    const swimming = this.inWaterNow && this.waterJump <= 0;
    this.swimmingNow = swimming;

    // horizontal target velocity in yaw space.
    // forward F = (sin yaw, 0, cos yaw) matches the avatar facing (+Z at yaw 0).
    // right R = (-cos yaw, 0, sin yaw).
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const fwd = -input.moveY; // stick up (-1) means forward
    const fx = sin * fwd - cos * input.moveX;
    const fz = cos * fwd + sin * input.moveX;
    const speed = (this.flying ? FLY_SPEED : swimming ? WALK_SPEED * 0.7 : WALK_SPEED)
      * (this.zoomTime > 0 ? ZOOM_MUL : 1);
    const tvx = fx * speed, tvz = fz * speed;
    const accel = 1 - Math.exp(-(this.grounded || this.flying ? 14 : 6) * dt);
    this.vel.x += (tvx - this.vel.x) * accel;
    this.vel.z += (tvz - this.vel.z) * accel;
    this.moving = Math.hypot(this.vel.x, this.vel.z) > 0.6;

    if (this.flying) {
      let vy = 0;
      if (input.jump || input.flyUp) vy += FLY_VERT;
      if (input.flyDown) vy -= FLY_VERT;
      this.vel.y += (vy - this.vel.y) * (1 - Math.exp(-12 * dt));
    } else if (swimming) {
      // gentle buoyancy: hold jump to kick up; deep under floats you back to
      // the surface, shallow water lets you wade down — like the big game
      const targetVy = input.jump ? SWIM_UP_V
        : Math.max(SWIM_SINK_V, Math.min(SWIM_UP_V, (submergedFraction(world, this.aabb) - SWIM_TRIM) * 2.2));
      this.vel.y += (targetVy - this.vel.y) * (1 - Math.exp(-6 * dt));
      // strokes: a pull every strokeT, with a muffled whoosh
      this.strokeT -= dt;
      if (this.strokeT <= 0) {
        this.strokeT = STROKE_SECONDS;
        events.stroked = true;
      }
      // climbing out of a lake: buoyancy alone can never lift a whole block, so
      // once the head is clear of the surface the jump button becomes a real
      // jump that carries them up onto the shore.
      if (input.jump) this.jumpBuffer = JUMP_BUFFER;
      this.coyote = 0; // no stale land-jump while paddling
      if (this.jumpBuffer > 0 && headClearOfWater(world, this.aabb)) {
        this.vel.y = WATER_JUMP_V * (this.boingTime > 0 ? BOING_MUL : 1);
        this.jumpBuffer = 0;
        this.waterJump = WATER_JUMP_TIME;
        events.splashed = true; // a splash on the way out
      }
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -30) this.vel.y = -30;
      // forgiving jumping
      if (input.jump) this.jumpBuffer = JUMP_BUFFER;
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
      if (this.jumpBuffer > 0 && this.coyote > 0) {
        this.vel.y = JUMP_V * (this.boingTime > 0 ? BOING_MUL : 1);
        this.jumpBuffer = 0;
        this.coyote = 0;
      }
    }

    const box = this.aabb;
    const res: MoveResult = moveAabb(world, box, this.vel.x, this.vel.y, this.vel.z, dt);
    this.pos.set(box.x + box.w / 2, box.y, box.z + box.d / 2);
    this.vel.set(res.vx, res.vy, res.vz);
    this.grounded = res.hitGround || groundedTest(world, box);

    // keep inside world bounds (invisible walls)
    this.pos.x = Math.max(0.35, Math.min(WORLD_SX - 0.35, this.pos.x));
    this.pos.z = Math.max(0.35, Math.min(WORLD_SZ - 0.35, this.pos.z));
    if (this.pos.y < -4) { // safety net
      this.pos.copy(this.spawn);
      this.vel.set(0, 0, 0);
    }
    if (this.pos.y > WORLD_SY + 8) {
      this.pos.y = WORLD_SY + 8;
      this.vel.y = Math.min(this.vel.y, 0);
    }

    // special blocks under feet
    if (this.grounded) {
      const bx = Math.floor(this.pos.x);
      const by = Math.floor(this.pos.y - 0.1);
      const bz = Math.floor(this.pos.z);
      const def = blockDef(world.get(bx, by, bz));
      if (def.bounce && res.hitGround) {
        events.bounced = def.bounce;
        this.flying = false;
      } else if (def.note !== undefined) {
        events.steppedOnMusic = { note: def.note, x: bx, y: by, z: bz };
      }
      if (def.sparkle) events.steppedOnSparkle = true;
      // a sparkle block anywhere nearby is fine; handled in placement
    }

    if (events.bounced) {
      this.vel.y = events.bounced;
      this.grounded = false;
    }

    // landing event
    if (res.hitGround && this.wasInAir && !events.bounced) {
      events.landed = true;
    }
    this.wasInAir = !this.grounded;

    // water splash
    if (this.inWaterNow && !this.wasInWater) events.splashed = true;
    this.wasInWater = this.inWaterNow;

    if (this.moving && this.grounded) this.walkPhase += dt * 9.5;
    else if (swimming) this.walkPhase += dt * 8; // stroke tempo
    else if (!this.grounded) this.walkPhase += dt * 2;
    animateAvatar(this.avatar, this.walkPhase, this.moving && this.grounded, !this.grounded && !swimming, dt, swimming);
    this.syncAvatar(dt);
  }

  syncAvatar(dt: number): void {
    const g = this.avatar.group;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    // face down in the water while swimming, upright again out of it
    const lean = this.swimmingNow ? 1.2 : 0;
    g.rotation.x += (lean - g.rotation.x) * (1 - Math.exp(-9 * dt));
  }

  dispose(): void {
    this.avatar.group.removeFromParent();
  }
}
