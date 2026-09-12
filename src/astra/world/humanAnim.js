/**
 * 人間のアニメーション。
 *
 * クリップは「時刻を受け取って骨のポーズを書き込む関数」。
 * 切り替えはポーズ同士の補間でつなぐので、立ち止まった瞬間に
 * 足がパッと変わるようなことがない。
 *
 * 歩幅と再生速度は移動速度から決めるので、足が滑らない。
 */

import { clamp, lerp } from '../core/math.js';

const BONES = ['hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'armL', 'foreArmL', 'handL',
  'shoulderR', 'armR', 'foreArmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];

function zeroPose() {
  const p = {};
  for (const b of BONES) p[b] = { rx: 0, ry: 0, rz: 0, tx: 0, ty: 0, tz: 0 };
  return p;
}

/** 立ち。呼吸・重心移動・まばたき相当の頭の揺れ。 */
function idle(p, t, o) {
  const breath = Math.sin(t * 1.5);
  const sway = Math.sin(t * 0.42);
  p.hips.ty = breath * 0.006 - 0.004;
  p.hips.rz = sway * 0.018;
  p.hips.ry = sway * 0.03;
  p.spine.rx = -0.02 + breath * 0.012;
  p.chest.rx = 0.03 + breath * 0.018;
  p.chest.ry = -sway * 0.04;
  p.neck.rx = -0.02 - breath * 0.01;
  p.head.ry = Math.sin(t * 0.31 + 1.2) * 0.14;
  p.head.rx = Math.sin(t * 0.23) * 0.05;
  for (const s of ['L', 'R']) {
    const sign = s === 'L' ? 1 : -1;
    p[`arm${s}`].rz = sign * (0.1 + breath * 0.012);
    p[`arm${s}`].rx = Math.sin(t * 1.5 + (s === 'L' ? 0 : 0.4)) * 0.02;
    p[`foreArm${s}`].rx = -0.18 - breath * 0.02;
    p[`foreArm${s}`].ry = sign * 0.1;
  }
  p.thighL.rx = 0.02; p.thighR.rx = -0.02;
  p.thighL.rz = 0.03; p.thighR.rz = -0.03;
}

/** 歩き。phase は歩幅で進む位相（速度と同期させる）。 */
function walk(p, phase, o) {
  const a = phase;
  const amp = o.amp === undefined ? 1 : o.amp;
  const bounce = Math.abs(Math.sin(a));
  p.hips.ty = (bounce * 0.035 - 0.018) * amp;
  p.hips.ry = Math.sin(a) * 0.1 * amp;
  p.hips.rz = Math.cos(a) * 0.045 * amp;
  p.spine.ry = -Math.sin(a) * 0.06 * amp;
  p.chest.ry = -Math.sin(a) * 0.1 * amp;
  p.chest.rx = 0.05 + o.lean * 0.4;
  p.neck.rx = -0.04 - o.lean * 0.3;
  p.head.ry = -Math.sin(a) * 0.03;

  const swing = 0.62 * amp;
  p.thighL.rx = Math.sin(a) * swing;
  p.thighR.rx = -Math.sin(a) * swing;
  p.shinL.rx = -clamp(Math.sin(a - 1.1), -1, 0.25) * 0.9 * amp - 0.06;
  p.shinR.rx = -clamp(Math.sin(a + Math.PI - 1.1), -1, 0.25) * 0.9 * amp - 0.06;
  p.footL.rx = -p.thighL.rx * 0.35 - p.shinL.rx * 0.5 + Math.sin(a + 0.6) * 0.18;
  p.footR.rx = -p.thighR.rx * 0.35 - p.shinR.rx * 0.5 + Math.sin(a + Math.PI + 0.6) * 0.18;

  const arm = 0.52 * amp;
  p.armL.rx = -Math.sin(a) * arm;
  p.armR.rx = Math.sin(a) * arm;
  p.armL.rz = 0.11; p.armR.rz = -0.11;
  p.foreArmL.rx = -0.3 - clamp(Math.sin(a + 0.8), 0, 1) * 0.42 * amp;
  p.foreArmR.rx = -0.3 - clamp(Math.sin(a + Math.PI + 0.8), 0, 1) * 0.42 * amp;
  p.foreArmL.ry = 0.12; p.foreArmR.ry = -0.12;
}

/** 走り。歩きより前傾・大振り・両足が浮く瞬間がある。 */
function run(p, phase, o) {
  walk(p, phase, { ...o, amp: 1.55, lean: 0.5 });
  p.hips.ty += Math.abs(Math.sin(phase)) * 0.03;
  p.chest.rx = 0.22;
  p.neck.rx = -0.2;
  p.armL.rz = 0.24; p.armR.rz = -0.24;
  p.foreArmL.rx = -1.1 - Math.sin(phase) * 0.35;
  p.foreArmR.rx = -1.1 + Math.sin(phase) * 0.35;
}

/** 話す。身振りが入る。 */
function talk(p, t, o) {
  idle(p, t, o);
  const beat = Math.sin(t * 3.1) * 0.5 + Math.sin(t * 1.7 + 1) * 0.5;
  p.head.rx += Math.sin(t * 2.6) * 0.07;
  p.head.ry += Math.sin(t * 1.3) * 0.1;
  p.chest.ry += beat * 0.05;
  p.armR.rx = -0.5 - beat * 0.35;
  p.armR.rz = -0.42;
  p.foreArmR.rx = -1.1 - beat * 0.4;
  p.foreArmR.ry = -0.55;
  p.handR.rz = beat * 0.3;
  p.armL.rx = -0.12;
}

/** 座る。ベンチ用。 */
function sit(p, t, o) {
  const breath = Math.sin(t * 1.3);
  p.hips.ty = -0.44;
  p.hips.rx = -0.06;
  p.spine.rx = 0.06 + breath * 0.012;
  p.chest.rx = 0.04;
  p.head.ry = Math.sin(t * 0.28) * 0.2;
  p.thighL.rx = -1.42; p.thighR.rx = -1.4;
  p.thighL.rz = 0.1; p.thighR.rz = -0.08;
  p.shinL.rx = 1.36; p.shinR.rx = 1.34;
  p.footL.rx = 0.1; p.footR.rx = 0.1;
  p.armL.rx = -0.3 + breath * 0.02; p.armR.rx = -0.28;
  p.armL.rz = 0.22; p.armR.rz = -0.22;
  p.foreArmL.rx = -0.9; p.foreArmR.rx = -0.88;
}

/** 掃く。箒を持っている想定の腕の動き。 */
function sweep(p, t, o) {
  const a = t * 2.2;
  p.hips.ry = Math.sin(a) * 0.12;
  p.spine.rx = 0.22;
  p.chest.rx = 0.2;
  p.chest.ry = Math.sin(a) * 0.16;
  p.neck.rx = -0.3;
  p.head.rx = -0.1;
  p.armL.rx = -0.95 + Math.sin(a) * 0.28;
  p.armR.rx = -0.62 + Math.sin(a) * 0.34;
  p.armL.rz = 0.35; p.armR.rz = -0.2;
  p.foreArmL.rx = -0.55; p.foreArmR.rx = -0.85;
  p.thighL.rx = 0.16; p.thighR.rx = -0.12;
}

/** 荷物を持つ。 */
function carry(p, t, o) {
  const breath = Math.sin(t * 1.4);
  p.spine.rx = -0.1;
  p.chest.rx = -0.06 + breath * 0.01;
  p.neck.rx = 0.04;
  p.head.ry = Math.sin(t * 0.4) * 0.08;
  for (const s of ['L', 'R']) {
    const sign = s === 'L' ? 1 : -1;
    p[`arm${s}`].rx = -1.05;
    p[`arm${s}`].rz = sign * 0.3;
    p[`foreArm${s}`].rx = -1.15;
    p[`foreArm${s}`].ry = sign * -0.35;
  }
  p.hips.ty = breath * 0.004;
}

/** 作業（台の上で手を動かす）。 */
function work(p, t, o) {
  const a = t * 2.6;
  p.spine.rx = 0.2;
  p.chest.rx = 0.16;
  p.neck.rx = -0.34;
  p.head.rx = -0.12;
  p.head.ry = Math.sin(t * 0.6) * 0.06;
  p.armL.rx = -1.0 + Math.sin(a) * 0.16;
  p.armR.rx = -1.02 + Math.cos(a * 1.2) * 0.18;
  p.armL.rz = 0.36; p.armR.rz = -0.34;
  p.foreArmL.rx = -0.95 - Math.sin(a) * 0.22;
  p.foreArmR.rx = -0.98 - Math.cos(a * 1.2) * 0.24;
  p.handL.rz = Math.sin(a * 2) * 0.3;
  p.handR.rz = Math.cos(a * 2.3) * 0.3;
}

/** きょろきょろ見回す。 */
function lookAround(p, t, o) {
  idle(p, t, o);
  const cycle = (t * 0.55) % 4;
  const target = cycle < 1 ? 0.75 : cycle < 2 ? 0 : cycle < 3 ? -0.7 : 0;
  p.head.ry = lerp(p.head.ry, target, 0.9);
  p.chest.ry += target * 0.22;
  p.head.rx += Math.sin(t * 0.9) * 0.08;
}

/** 手を振る。 */
function wave(p, t, o) {
  idle(p, t, o);
  p.armR.rx = -2.2;
  p.armR.rz = -0.55;
  p.foreArmR.rx = -0.4;
  p.foreArmR.rz = Math.sin(t * 7) * 0.55;
  p.chest.ry = -0.12;
  p.head.ry = -0.18;
}

export const CLIPS = { idle, walk, run, talk, sit, sweep, carry, work, lookAround, wave };
/** 移動速度に同期させるクリップ（位相を歩幅から決める）。 */
const LOCOMOTION = new Set(['walk', 'run']);

/**
 * 1 体ぶんのアニメーション状態。
 * update(dt, { speed, clip, lean }) を毎フレーム呼び、skeleton へ流し込む。
 */
export class HumanAnimator {
  constructor(skeleton, opts = {}) {
    this.sk = skeleton;
    this.time = Math.random() * 10;
    this.phase = Math.random() * Math.PI * 2;
    this.clip = 'idle';
    this.blend = 1;
    this.prevClip = 'idle';
    this.current = zeroPose();
    this.target = zeroPose();
    this.prev = zeroPose();
    this.strideLength = opts.strideLength || 1.5;
    this.footPlant = 0;
    this.lastFootPhase = 0;
  }

  setClip(name) {
    if (name === this.clip) return;
    this.prevClip = this.clip;
    for (const b in this.current) Object.assign(this.prev[b], this.current[b]);
    this.clip = name;
    this.blend = 0;
  }

  update(dt, state = {}) {
    const speed = state.speed || 0;
    this.time += dt;
    // 歩幅に合わせて位相を進める（足が滑らない）
    if (LOCOMOTION.has(this.clip)) {
      this.phase += (speed / this.strideLength) * Math.PI * dt * 2;
    } else {
      this.phase += dt * 2;
    }
    const fn = CLIPS[this.clip] || CLIPS.idle;
    for (const b in this.target) {
      const t = this.target[b];
      t.rx = t.ry = t.rz = t.tx = t.ty = t.tz = 0;
    }
    fn(this.target, LOCOMOTION.has(this.clip) ? this.phase : this.time, {
      lean: state.lean || 0, speed
    });

    this.blend = Math.min(1, this.blend + dt * 5.5);
    const k = this.blend * this.blend * (3 - 2 * this.blend);
    const smoothing = 1 - Math.exp(-18 * dt);
    for (const b in this.current) {
      const cur = this.current[b], tgt = this.target[b], prv = this.prev[b];
      for (const key of ['rx', 'ry', 'rz', 'tx', 'ty', 'tz']) {
        const blended = lerp(prv[key], tgt[key], k);
        cur[key] += (blended - cur[key]) * smoothing;
      }
    }

    // 骨へ反映
    for (const b in this.current) {
      const j = this.sk.j(b);
      if (!j) continue;
      const c = this.current[b];
      j.rx = c.rx; j.ry = c.ry; j.rz = c.rz;
      j.tx = c.tx; j.ty = c.ty; j.tz = c.tz;
    }
    // 足が地面を蹴った瞬間（足音の合図）
    const fp = Math.sin(this.phase);
    const planted = (this.lastFootPhase > 0) !== (fp > 0);
    this.lastFootPhase = fp;
    this.footPlant = planted && LOCOMOTION.has(this.clip) && speed > 0.3 ? 1 : 0;
    this.sk.update();
    return this.footPlant;
  }
}
