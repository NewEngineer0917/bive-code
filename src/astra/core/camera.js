/**
 * 三人称カメラ。
 *
 * 追従は指数補間（フレームレートに依存しない）。
 * 壁にめり込まないよう、狙いの位置までを球で掃引して手前に寄せる。
 * 会話・戦闘・カットシーンでは外から目標を差し替えられるようにしてある。
 */

import { v3, v3set, mat4, m4lookAt, damp, clamp, DEG } from './math.js';

export class OrbitCamera {
  constructor(opts = {}) {
    this.target = v3(0, 1.4, 0);
    this.smoothTarget = v3(0, 1.4, 0);
    this.position = v3(0, 3, 6);
    this.forward = v3(0, 0, -1);
    this.yaw = Math.PI;
    this.pitch = 0.24;
    this.distance = opts.distance || 6.2;
    this.targetDistance = this.distance;
    this.minDistance = 1.6;
    this.maxDistance = 11;
    this.fov = (opts.fov || 52) * DEG;
    this.baseFov = this.fov;
    this.near = 0.12;
    this.far = 420;
    this.height = opts.height || 1.45;
    this.minPitch = -0.5;
    this.maxPitch = 1.15;
    this.viewMatrix = mat4();
    this.shake = { amount: 0, time: 0, freq: 26 };
    this.override = null;      // 外部から乗っ取るとき { position, lookAt, fov }
    this.overrideWeight = 0;
  }

  /** マウス／タッチの視点入力。 */
  applyLook(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch + dy, this.minPitch, this.maxPitch);
  }

  zoom(delta) {
    this.targetDistance = clamp(this.targetDistance + delta, this.minDistance, this.maxDistance);
  }

  addShake(amount, freq = 26) {
    this.shake.amount = Math.max(this.shake.amount, amount);
    this.shake.freq = freq;
  }

  /**
   * 追従更新。
   * focus: 注視点（プレイヤーの腰あたり）
   * probe(from, to, radius) は障害物までの距離比（0..1）を返す関数。
   */
  update(dt, focus, probe) {
    v3set(this.smoothTarget,
      damp(this.smoothTarget[0], focus[0], 11, dt),
      damp(this.smoothTarget[1], focus[1] + this.height, 8, dt),
      damp(this.smoothTarget[2], focus[2], 11, dt));
    this.distance = damp(this.distance, this.targetDistance, 7, dt);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    let dirX = Math.sin(this.yaw) * cp;
    let dirY = sp;
    let dirZ = Math.cos(this.yaw) * cp;

    let dist = this.distance;
    if (probe) {
      const to = [
        this.smoothTarget[0] + dirX * dist,
        this.smoothTarget[1] + dirY * dist,
        this.smoothTarget[2] + dirZ * dist,
      ];
      const hit = probe(this.smoothTarget, to, 0.34);
      if (hit < 1) dist = Math.max(this.minDistance * 0.6, dist * hit - 0.12);
    }
    // 寄るのは速く、離れるのはゆっくり（壁際でガタつかせない）
    if (this._lastDist === undefined) this._lastDist = dist;
    this._lastDist = dist < this._lastDist ? dist : damp(this._lastDist, dist, 4, dt);
    dist = this._lastDist;

    this.shake.time += dt;
    this.shake.amount = Math.max(0, this.shake.amount - dt * 2.6);
    const s = this.shake.amount;
    const sx = s ? Math.sin(this.shake.time * this.shake.freq) * s * 0.12 : 0;
    const sy = s ? Math.sin(this.shake.time * this.shake.freq * 1.37 + 1.2) * s * 0.12 : 0;

    const px = this.smoothTarget[0] + dirX * dist + sx;
    const py = this.smoothTarget[1] + dirY * dist + sy;
    const pz = this.smoothTarget[2] + dirZ * dist;

    if (this.override && this.overrideWeight > 0) {
      const w = this.overrideWeight;
      v3set(this.position,
        px + (this.override.position[0] - px) * w,
        py + (this.override.position[1] - py) * w,
        pz + (this.override.position[2] - pz) * w);
      const la = this.override.lookAt;
      const tx = this.smoothTarget[0] + (la[0] - this.smoothTarget[0]) * w;
      const ty = this.smoothTarget[1] + (la[1] - this.smoothTarget[1]) * w;
      const tz = this.smoothTarget[2] + (la[2] - this.smoothTarget[2]) * w;
      this._look(tx, ty, tz);
      if (this.override.fov) this.fov = this.baseFov + (this.override.fov * DEG - this.baseFov) * w;
    } else {
      v3set(this.position, px, py, pz);
      this._look(this.smoothTarget[0], this.smoothTarget[1], this.smoothTarget[2]);
      this.fov = damp(this.fov, this.baseFov, 5, dt);
    }
  }

  _look(tx, ty, tz) {
    const dx = tx - this.position[0], dy = ty - this.position[1], dz = tz - this.position[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    v3set(this.forward, dx / l, dy / l, dz / l);
    m4lookAt(this.viewMatrix, this.position, [tx, ty, tz], [0, 1, 0]);
  }

  /** 水平方向の向き（プレイヤーの移動方向を決めるのに使う）。 */
  get yawDirection() {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }
}
