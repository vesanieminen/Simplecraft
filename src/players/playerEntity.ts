/**
 * Player entity simulation: movement, gravity, jump forgiveness
 * (coyote time + jump buffering), flying, water and special blocks.
 */

import * as THREE from 'three';
import { blockDef } from '../core/blocks';
import { inWater, moveAabb, playerAabb, grounded as groundedTest, MoveResult } from '../core/physics';
import { World, WORLD_SX, WORLD_SZ, WORLD_SY } from '../core/world';
import { AvatarParts, animateAvatar, createAvatar } from './avatar';

export const GRAVITY = 26;
export const JUMP_V = 8.9;
export const WALK_SPEED = 5.0;
export const FLY_SPEED = 7.2;
export const FLY_VERT = 4.6;

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
  walkPhase = 0;
  moving = false;
  starsCount = 0;

  jumpBuffer = 0;
  coyote = 0;
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
    this.inWaterNow = inWater(world, this.aabb);

    // horizontal target velocity in yaw space.
    // forward F = (sin yaw, 0, cos yaw) matches the avatar facing (+Z at yaw 0).
    // right R = (-cos yaw, 0, sin yaw).
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const fwd = -input.moveY; // stick up (-1) means forward
    const fx = sin * fwd - cos * input.moveX;
    const fz = cos * fwd + sin * input.moveX;
    const speed = this.flying ? FLY_SPEED : this.inWaterNow ? WALK_SPEED * 0.55 : WALK_SPEED;
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
    } else if (this.inWaterNow) {
      // gentle buoyancy: hold jump to swim up, sink slowly otherwise
      const targetVy = input.jump ? 3.2 : -2.2;
      this.vel.y += (targetVy - this.vel.y) * (1 - Math.exp(-6 * dt));
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -30) this.vel.y = -30;
      // forgiving jumping
      if (input.jump) this.jumpBuffer = 0.16;
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
      if (this.jumpBuffer > 0 && this.coyote > 0) {
        this.vel.y = JUMP_V;
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
    else if (!this.grounded) this.walkPhase += dt * 2;
    animateAvatar(this.avatar, this.walkPhase, this.moving && this.grounded, !this.grounded, dt);
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
