/**
 * プレイヤーの移動。
 *
 * 加速・減速・重力・坂・段差・衝突を持つ三人称の操作。
 * 入力はカメラ基準（画面の上＝奥へ進む）で、向きは滑らかに回す。
 * 急な坂は滑り落ち、歩ける坂は登る。
 */

import { damp, dampAngle } from '../core/math.js';

export class PlayerController {
  constructor(terrain, collision, opts = {}) {
    this.terrain = terrain;
    this.collision = collision;
    this.x = opts.x || 0;
    this.z = opts.z || 0;
    this.y = terrain.height(this.x, this.z);
    this.vy = 0;
    this.vx = 0;
    this.vz = 0;
    this.facing = opts.facing || 0;
    this.radius = 0.36;
    this.walkSpeed = 3.1;
    this.runSpeed = 6.0;
    this.acceleration = 22;
    this.deceleration = 16;
    this.turnSpeed = 13;
    this.gravity = -22;
    this.grounded = true;
    this.speed = 0;
    this.maxSlope = 0.62;         // これより急だと登れない
    this.inWater = false;
    this.footstepTimer = 0;
    this.locked = false;          // 会話中などは動けない
  }

  get position() { return [this.x, this.y, this.z]; }

  /** 会話や戦闘で操作を止める。 */
  setLocked(v) {
    this.locked = v;
    if (v) { this.vx = 0; this.vz = 0; this.speed = 0; }
  }

  /**
   * input.move（-1..1）とカメラの向きから動かす。
   * 返り値: { speed, moving, running, footstep }
   */
  update(dt, input, camera) {
    const wantRun = input.run;
    let desiredX = 0, desiredZ = 0;
    if (!this.locked) {
      const dir = camera.yawDirection;
      const rightX = -dir.z, rightZ = dir.x;
      desiredX = dir.x * input.move.y + rightX * input.move.x;
      desiredZ = dir.z * input.move.y + rightZ * input.move.x;
    }
    const mag = Math.hypot(desiredX, desiredZ);
    const targetSpeed = mag > 0.02 ? (wantRun ? this.runSpeed : this.walkSpeed) * Math.min(mag, 1) : 0;

    if (mag > 0.02) {
      const nx = desiredX / mag, nz = desiredZ / mag;
      // 進みたい向きへ加速
      const tx = nx * targetSpeed, tz = nz * targetSpeed;
      const rate = targetSpeed > 0.1 ? this.acceleration : this.deceleration;
      this.vx = damp(this.vx, tx, rate / 2.2, dt);
      this.vz = damp(this.vz, tz, rate / 2.2, dt);
      // 向きは移動方向へ滑らかに
      const want = Math.atan2(nx, nz);
      this.facing = dampAngle(this.facing, want, this.turnSpeed, dt);
    } else {
      this.vx = damp(this.vx, 0, this.deceleration / 2.2, dt);
      this.vz = damp(this.vz, 0, this.deceleration / 2.2, dt);
    }

    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;

    // 登れない坂は止める（滑らせる）
    const nextH = this.terrain.height(nx, nz);
    const climb = nextH - this.y;
    if (climb > 0 && climb / Math.max(0.0001, Math.hypot(nx - this.x, nz - this.z)) > 1.9) {
      // 斜面に沿って滑る
      const n = this.terrain.normal(nx, nz);
      const slideX = n[0], slideZ = n[2];
      nx = this.x + slideX * dt * 1.5;
      nz = this.z + slideZ * dt * 1.5;
    }

    const [rx, rz] = this.collision.resolve(nx, nz, this.radius);
    // 押し戻された分だけ速度も殺す（壁に押し付けても震えない）
    if (Math.abs(rx - nx) > 1e-4) this.vx *= 0.2;
    if (Math.abs(rz - nz) > 1e-4) this.vz *= 0.2;
    this.x = rx; this.z = rz;

    const ground = this.terrain.height(this.x, this.z);
    if (this.y > ground + 0.02) {
      this.vy += this.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) { this.y = ground; this.vy = 0; this.grounded = true; }
      else this.grounded = false;
    } else {
      // 段差は滑らかに乗る
      this.y = damp(this.y, ground, 17, dt);
      if (ground - this.y > 0.4) this.y = ground;
      this.vy = 0;
      this.grounded = true;
    }

    this.speed = Math.hypot(this.vx, this.vz);
    const river = this.terrain.riverInfo(this.x, this.z);
    this.inWater = river.inWater && this.y < this.terrain.waterHeightAt(this.x, this.z) + 0.25;

    return {
      speed: this.speed,
      moving: this.speed > 0.15,
      running: this.speed > this.walkSpeed + 0.4,
      grounded: this.grounded
    };
  }

  teleport(x, z, facing) {
    this.x = x; this.z = z;
    this.y = this.terrain.height(x, z);
    this.vx = this.vz = this.vy = 0;
    if (facing !== undefined) this.facing = facing;
  }
}
