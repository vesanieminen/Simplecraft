/**
 * Player entity simulation: movement, gravity, jump forgiveness
 * (coyote time + jump buffering), flying, water and special blocks.
 */

import * as THREE from 'three';
import { blockDef } from '../core/blocks';
import {
  canStandAt, CROUCH_H, inWater, moveAabb, PLAYER_H, playerAabb,
  grounded as groundedTest, headClearOfWater, MoveResult,
} from '../core/physics';
import { World, WORLD_SX, WORLD_SZ, WORLD_SY } from '../core/world';
import { AvatarParts, animateAvatar, createAvatar, ModelId, nextModel } from './avatar';

export const GRAVITY = 26;
export const JUMP_V = 8.9;
export const WALK_SPEED = 5.0;
export const FLY_SPEED = 7.2;
export const FLY_VERT = 4.6;
/** creeping along while crouched (like Minecraft: barely a shuffle) */
export const CROUCH_MUL = 0.42;
/** treasure boosts: zoomy boots run this much faster, boing boots jump this much higher */
export const ZOOM_MUL = 1.5;
export const BOING_MUL = 1.4;

const JUMP_BUFFER = 0.16; // a jump pressed just before landing still counts
const SWIM_UP_V = 3.2; // hold jump to kick up through the water
const SWIM_SINK_V = -2.2; // sink gently when nobody holds jump
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
}

export class PlayerEntity {
  pos: THREE.Vector3; // feet center
  vel = new THREE.Vector3();
  yaw = 0; // facing / camera yaw
  pitch = -0.28; // look slightly down by default so kids aim at the ground
  flying = false;
  grounded = false;
  inWaterNow = false;
  /** Minecraft-style sneak: squat hitbox, slow creep, ledge protection */
  crouching = false;
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
  private wasInAir = false;
  private wasInWater = false;

  avatar: AvatarParts;
  /** the costume this kid picked (see players/avatar.ts AVATAR_MODELS) */
  model: ModelId;

  constructor(
    public id: number,
    public name: string,
    public colorHex: string,
    public spawn: THREE.Vector3,
    model: ModelId = 'kid',
  ) {
    this.pos = spawn.clone();
    this.model = model;
    this.avatar = createAvatar(colorHex, model);
    this.syncAvatar(0);
  }

  /**
   * Swap the costume mid-game: build the new avatar, and if the old one is in
   * the scene, the new one slides into the very same place (Game re-layers all
   * bodies every frame, so the split-screen visibility sorts itself out).
   */
  setModel(model: ModelId): void {
    if (model === this.model) return;
    const old = this.avatar.group;
    const parent = old.parent;
    this.model = model;
    this.avatar = createAvatar(this.colorHex, model);
    this.syncAvatar(0);
    if (parent) {
      parent.remove(old);
      parent.add(this.avatar.group);
    }
  }

  cycleModel(): ModelId {
    this.setModel(nextModel(this.model));
    return this.model;
  }

  get aabb() {
    return playerAabb(this.pos.x, this.pos.y, this.pos.z, this.crouching ? CROUCH_H : PLAYER_H);
  }

  /** the avatar/camera head height, standing or crouched */
  get headHeight(): number {
    return this.crouching ? 0.82 : 1.45;
  }

  /**
   * B/Circle in the world, or Ctrl on the keyboard: crouch, or stand up
   * again if there is headroom. Under a low ceiling the tap is ignored
   * (Minecraft keeps you ducked) — tapping again after leaving works.
   */
  toggleCrouch(world: World): void {
    if (this.crouching) {
      if (canStandAt(world, this.pos.x, this.pos.y, this.pos.z)) this.crouching = false;
    } else {
      this.crouching = true;
    }
  }

  step(world: World, input: StepInput, events: StepEvents): void {
    const dt = Math.min(input.dt, 0.05);
    this.zoomTime = Math.max(0, this.zoomTime - dt);
    this.boingTime = Math.max(0, this.boingTime - dt);
    this.inWaterNow = inWater(world, this.aabb);
    this.waterJump = Math.max(0, this.waterJump - dt);
    // a push-off leap is a real jump: buoyancy is off while it lasts
    const swimming = this.inWaterNow && this.waterJump <= 0;

    // horizontal target velocity in yaw space.
    // forward F = (sin yaw, 0, cos yaw) matches the avatar facing (+Z at yaw 0).
    // right R = (-cos yaw, 0, sin yaw).
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const fwd = -input.moveY; // stick up (-1) means forward
    const fx = sin * fwd - cos * input.moveX;
    const fz = cos * fwd + sin * input.moveX;
    const speed = (this.flying ? FLY_SPEED : swimming ? WALK_SPEED * 0.55
      : this.crouching ? WALK_SPEED * CROUCH_MUL : WALK_SPEED)
      * (this.zoomTime > 0 ? ZOOM_MUL : 1);
    const tvx = fx * speed, tvz = fz * speed;
    const accel = 1 - Math.exp(-(this.grounded || this.flying ? 14 : 6) * dt);
    this.vel.x += (tvx - this.vel.x) * accel;
    this.vel.z += (tvz - this.vel.z) * accel;
    this.moving = Math.hypot(this.vel.x, this.vel.z) > 0.6;

    if (this.flying) {
      this.crouching = false; // no sneaking mid-flight, thanks
      let vy = 0;
      if (input.jump || input.flyUp) vy += FLY_VERT;
      if (input.flyDown) vy -= FLY_VERT;
      this.vel.y += (vy - this.vel.y) * (1 - Math.exp(-12 * dt));
    } else if (swimming) {
      // gentle buoyancy: hold jump to swim up, sink slowly otherwise
      const targetVy = input.jump ? SWIM_UP_V : SWIM_SINK_V;
      this.vel.y += (targetVy - this.vel.y) * (1 - Math.exp(-6 * dt));
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
      // crouch + jump = stand up and go, unless a low ceiling says stay down
      if (input.jump && this.crouching && canStandAt(world, this.pos.x, this.pos.y, this.pos.z)) {
        this.crouching = false;
      }
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -30) this.vel.y = -30;
      // forgiving jumping
      if (input.jump) this.jumpBuffer = JUMP_BUFFER;
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
      if (!this.crouching && this.jumpBuffer > 0 && this.coyote > 0) {
        this.vel.y = JUMP_V * (this.boingTime > 0 ? BOING_MUL : 1);
        this.jumpBuffer = 0;
        this.coyote = 0;
      }
    }

    const box = this.aabb;
    const preX = box.x, preZ = box.z;
    const wasGrounded = this.grounded;
    const res: MoveResult = moveAabb(world, box, this.vel.x, this.vel.y, this.vel.z, dt);
    // sneak edge protection (Minecraft): a crouched kid never walks off a
    // ledge — if the step would leave their feet unsupported, undo it
    if (this.crouching && !this.flying && wasGrounded && !groundedTest(world, box)) {
      box.x = preX;
      box.z = preZ;
      res.vx = 0;
      res.vz = 0;
    }
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
    else if (!this.grounded) this.walkPhase += dt * 2;
    animateAvatar(this.avatar, this.walkPhase, this.moving && this.grounded, !this.grounded, dt, this.crouching);
    this.syncAvatar(dt);
  }

  syncAvatar(dt: number): void {
    const g = this.avatar.group;
    g.position.copy(this.pos);
    g.rotation.y = this.yaw;
    // face forward: model faces +Z when yaw 0? our face plane is at +Z; yaw applied directly.
    void dt;
  }

  dispose(): void {
    this.avatar.group.removeFromParent();
  }
}
