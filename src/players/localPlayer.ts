/**
 * A local player: entity + own camera + own controller + own build state.
 * This is the object that makes split-screen work: everything a player
 * needs is per-instance, the world and scene are shared.
 */

import * as THREE from 'three';
import { BlockId, blockDef, FAVORITES } from '../core/blocks';
import { generousTarget, hitRemovable, hitSolid, RayHit, raycastVoxel } from '../core/raycast';
import { Satchel } from '../core/satchel';
import { World } from '../core/world';
import { FrameControls } from '../input/types';
import { SKY_FAR } from '../render/sky';
import { PlayerEntity, StepEvents } from './playerEntity';

const REACH = 6.5;
const LOOK_RATE = 2.6;

export interface WorldHooks {
  tryPlace(lp: LocalPlayer, hit: RayHit): boolean;
  tryRemove(lp: LocalPlayer, hit: RayHit): void;
  interact(lp: LocalPlayer): void;
  events: StepEvents;
}

export class LocalPlayer {
  camera: THREE.PerspectiveCamera;
  selected: BlockId = FAVORITES[0];
  /**
   * 🪣 Is the bucket full of water right now? Every kid carries exactly one
   * bucket (the palette's water tile became a tool in Nov 2026), so a single
   * flag is the whole inventory. Like the fish satchel it is session-only:
   * reloading goes home with an empty bucket.
   */
  bucketFull = false;
  firstPerson = false;
  sensitivity = 1;
  target: RayHit | null = null;
  /** separate forgiving-aim target that also matches breakable plants */
  removeTarget: RayHit | null = null;
  sourceId = '';
  /** set true while this player's own menu is open (movement stops for them) */
  uiOpen = false;
  /** the fish they have caught and not eaten yet (core/satchel.ts) */
  readonly satchel = new Satchel();

  private outline: THREE.LineSegments;
  private ghost: THREE.Mesh;
  private ghostBlock = -1;
  private buildCooldown = 0;
  private cameraDist = 4.8;
  private camPos = new THREE.Vector3();
  /** camera punch after an explosion nearby */
  private shakeT = 0;
  private shakeTotal = 1;
  private shakeMag = 0;

  constructor(
    public entity: PlayerEntity,
    scene: THREE.Scene,
    private world: World,
  ) {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, SKY_FAR);
    this.camPos.copy(entity.pos);

    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.005, 1.005, 1.005)),
      new THREE.LineBasicMaterial({ color: 0x1c2430, transparent: true, opacity: 0.9 }),
    );
    this.outline.visible = false;
    this.outline.renderOrder = 10;
    scene.add(this.outline);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.94, 0.94),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.ghost.visible = false;
    this.ghost.renderOrder = 9;
    scene.add(this.ghost);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.outline, this.ghost);
    this.outline.geometry.dispose();
    this.ghost.geometry.dispose();
  }

  setSelected(id: BlockId): void {
    this.selected = id;
  }

  cycle(dir: number): void {
    let i = FAVORITES.indexOf(this.selected);
    if (i < 0) i = 0;
    i = (i + dir + FAVORITES.length) % FAVORITES.length;
    this.selected = FAVORITES[i];
  }

  aimDir(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.entity.pitch);
    return out.set(
      Math.sin(this.entity.yaw) * cp,
      Math.sin(this.entity.pitch),
      Math.cos(this.entity.yaw) * cp,
    );
  }

  update(dt: number, frame: FrameControls, hooks: WorldHooks, worldMenuBlock: boolean): void {
    // ---- look ----
    if (!worldMenuBlock) {
      // turning right must rotate aim toward the player's right (yaw decreases
      // with dir=(sin yaw, cos yaw)); verified against strafe-right convention
      this.entity.yaw -= frame.look.x * LOOK_RATE * this.sensitivity * dt;
      this.entity.pitch -= frame.look.y * LOOK_RATE * this.sensitivity * dt;
      const maxPitch = Math.PI / 2 - 0.05;
      this.entity.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.entity.pitch));
    }

    // ---- crouch (B / Circle / Ctrl): tap to crouch, tap again to stand ----
    // in water those buttons are the DIVE control instead (see swimDown), so
    // the squat toggle stays ashore — no half-crouched kids paddling about
    if (!worldMenuBlock && !this.entity.swimmingNow && (frame.pressed.has('crouch') || frame.pressed.has('back'))) {
      this.entity.toggleCrouch(this.world);
    }

    // ---- step simulation ----
    const stepInput = worldMenuBlock
      ? { moveX: 0, moveY: 0, jump: false, swimDown: false, flyUp: false, flyDown: false, dt }
      : {
          moveX: frame.move.x,
          moveY: frame.move.y,
          // d-pad up doubles as jump — but NOT on a keyboard, where the arrow
          // keys are the look controls (ArrowUp tilts the view, nothing else)
          jump: frame.held.has('jump') || (frame.kind !== 'keyboard' && frame.held.has('up')),
          // swim down: the sneak buttons (Ctrl / B / ◯) do double duty in
          // water — the Minecraft convention of shift sinking you
          swimDown: frame.held.has('crouch') || frame.held.has('back'),
          flyUp: frame.held.has('jump'),
          flyDown: frame.held.has('interact') && this.entity.flying,
          dt,
        };
    this.entity.step(this.world, stepInput, hooks.events);

    // ---- targeting & building ----
    this.updateTarget();
    this.buildCooldown = Math.max(0, this.buildCooldown - dt);

    if (!worldMenuBlock) {
      const placePressed = frame.pressed.has('place');
      const removePressed = frame.pressed.has('remove');
      const repeat = (frame.held.has('place') || frame.held.has('remove')) && this.buildCooldown <= 0;
      if ((placePressed || removePressed || repeat) && this.buildCooldown <= 0) {
        this.buildCooldown = 0.28;
        if (frame.held.has('place') && this.target) hooks.tryPlace(this, this.target);
        else if (frame.held.has('remove') && this.removeTarget) hooks.tryRemove(this, this.removeTarget);
      }
      if (frame.pressed.has('interact') && !this.entity.flying) hooks.interact(this);
      if (frame.pressed.has('nextBlock')) this.cycle(1);
      if (frame.pressed.has('prevBlock')) this.cycle(-1);
    }

    this.updateCamera(dt);
  }

  private updateTarget(): void {
    const head = new THREE.Vector3(this.entity.pos.x, this.entity.pos.y + this.entity.headHeight, this.entity.pos.z);
    const dir = this.aimDir();
    const right = new THREE.Vector3(Math.cos(this.entity.yaw), 0, -Math.sin(this.entity.yaw));
    const up = new THREE.Vector3(0, 1, 0);

    // place targets solid blocks only; remove also targets plants (never water)
    this.target = generousTarget(this.world, head, dir, REACH, up, right, hitSolid);
    this.removeTarget = generousTarget(this.world, head, dir, REACH, up, right, hitRemovable);

    const shown = this.removeTarget ?? this.target;
    if (shown) {
      this.outline.visible = true;
      this.outline.position.set(shown.x + 0.5, shown.y + 0.5, shown.z + 0.5);
    } else {
      this.outline.visible = false;
    }

    const placing = true; // ghost follows camera aim
    if (this.target && placing) {
      const def = blockDef(this.selected);
      if (this.ghostBlock !== this.selected) {
        this.ghostBlock = this.selected;
        (this.ghost.material as THREE.MeshBasicMaterial).color.setRGB(def.color[0], def.color[1], def.color[2]);
      }
      this.ghost.visible = true;
      this.ghost.position.set(this.target.px + 0.5, this.target.py + 0.5, this.target.pz + 0.5);
    } else {
      this.ghost.visible = false;
    }
  }

  /**
   * Should this player's own camera see their avatar body? Third person only,
   * and not when the camera is hugging them inside a build. Other players
   * always see the body — the visibility is per-camera (three.js layers).
   */
  get showOwnBody(): boolean {
    return !this.firstPerson && this.cameraDist >= 2.4;
  }

  private updateCamera(dt: number): void {
    const e = this.entity;
    const head = new THREE.Vector3(e.pos.x, e.pos.y + e.headHeight, e.pos.z);
    const dir = this.aimDir();
    const k = 1 - Math.exp(-22 * dt);
    if (this.firstPerson) {
      this.camera.position.copy(head);
    } else {
      // third-person with terrain-aware pull-in
      const probe = raycastVoxel(this.world, head.x, head.y, head.z, -dir.x, -dir.y, -dir.z, 8, hitSolid);
      const wanted = probe ? Math.max(1.1, probe.dist - 0.2) : 4.8;
      this.cameraDist += (wanted - this.cameraDist) * k;
      const want = head.clone().addScaledVector(dir, -this.cameraDist);
      // smooth camera position
      this.camPos.lerp(want, k);
      this.camera.position.copy(this.camPos);
      // When the camera hugs us (inside a build), our own body is hidden from
      // *our* view via layers (see Game.applyAvatarLayers) — never faded out,
      // because other players share the very same avatar meshes and materials.
    }
    this.camera.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(this.camera.position, head.clone().addScaledVector(dir, 2), new THREE.Vector3(0, 1, 0)),
    );

    // a nearby blast rattles this player's view (and the one two panes over
    // feels a smaller kick), then it settles straight back down
    if (this.shakeT > 0) {
      this.shakeT = Math.max(0, this.shakeT - dt);
      const k = this.shakeT / this.shakeTotal;
      const m = this.shakeMag * k * 0.3;
      this.camera.position.x += (Math.random() - 0.5) * m;
      this.camera.position.y += (Math.random() - 0.5) * m;
      this.camera.rotateZ((Math.random() - 0.5) * 0.06 * k);
      if (this.shakeT === 0) this.shakeMag = 0;
    }
  }

  /** how much this player's camera should shake for `seconds` */
  shake(seconds: number, mag = 1): void {
    if (seconds <= 0 || mag <= 0) return;
    if (seconds > this.shakeT) {
      this.shakeT = seconds;
      this.shakeTotal = seconds;
    }
    this.shakeMag = Math.max(this.shakeMag, mag);
  }

  respawnAt(p: THREE.Vector3): void {
    this.entity.pos.copy(p);
    this.entity.vel.set(0, 0, 0);
    this.entity.flying = false;
    this.entity.crouching = false;
  }
}
