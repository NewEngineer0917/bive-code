/**
 * アストラのアニメーション。
 *
 * 種ごとに骨の構成が違うので、クリップは「あれば動かす」方式で書く。
 * 完全静止は禁止：待機でも呼吸・まばたき・耳・尻尾・元素の揺れが入る。
 * 歩きと走りは移動速度と位相を同期させ、足を滑らせない。
 */

import { clamp, lerp } from '../core/math.js';

/** 骨名のリストからポーズ入れ物を作る。 */
function makePose(names) {
  const p = {};
  for (const n of names) p[n] = { rx: 0, ry: 0, rz: 0, tx: 0, ty: 0, tz: 0, sx: 1, sy: 1, sz: 1 };
  return p;
}

const has = (p, n) => p[n] !== undefined;
const legTags = ['FL', 'FR', 'BL', 'BR'];

/** 呼吸・耳・尻尾など、どのクリップにも乗せる下地。 */
function baseLife(p, t, o) {
  const breath = Math.sin(t * 1.9);
  if (has(p, 'chest')) { p.chest.sx = 1 + breath * 0.018; p.chest.sy = 1 + breath * 0.022; }
  if (has(p, 'spine1')) p.spine1.rx = breath * 0.012;
  if (has(p, 'head')) {
    p.head.ry += Math.sin(t * 0.43) * 0.16;
    p.head.rx += Math.sin(t * 0.31 + 1) * 0.07;
  }
  // 耳
  for (const e of ['ear0', 'ear1', 'ear0b', 'ear1b']) {
    if (!has(p, e)) continue;
    const k = e.endsWith('b') ? 1.6 : 1;
    const side = e.includes('0') ? 1 : -1;
    p[e].rz += Math.sin(t * 1.7 + side) * 0.09 * k;
    p[e].rx += Math.sin(t * 2.3 + side * 2) * 0.06 * k;
  }
  // 尻尾は付け根から先へ波が伝わるように位相をずらす
  for (let i = 0; i < 6; i++) {
    const n = `tail${i}`;
    if (!has(p, n)) break;
    p[n].ry += Math.sin(t * 1.4 - i * 0.6) * (0.06 + i * 0.02);
    p[n].rx += Math.sin(t * 1.1 - i * 0.5) * 0.04;
  }
  // 翼はたたんだ状態でも微かに動かす
  for (const w of ['wingL0', 'wingR0']) {
    if (!has(p, w)) continue;
    p[w].rz += (w === 'wingL0' ? 1 : -1) * (0.05 + breath * 0.02);
  }
}

/** 待機 A：落ち着いた基本の立ち。 */
function idle(p, t, o) {
  baseLife(p, t, o);
  const sway = Math.sin(t * 0.6);
  if (has(p, 'hips')) { p.hips.ty = Math.sin(t * 1.9) * 0.004; p.hips.rz = sway * 0.02; }
  if (has(p, 'neck')) p.neck.rx = -0.05 + Math.sin(t * 1.9) * 0.02;
  for (const tag of legTags) {
    if (!has(p, `leg${tag}1`)) continue;
    p[`leg${tag}1`].rx = 0.06;
    p[`leg${tag}2`].rx = -0.1;
  }
}

/** 待機 B：周囲を警戒して見回す。 */
function idleAlert(p, t, o) {
  baseLife(p, t, o);
  const cycle = (t * 0.5) % 4;
  const look = cycle < 1 ? 0.8 : cycle < 2 ? -0.1 : cycle < 3 ? -0.75 : 0.05;
  if (has(p, 'head')) { p.head.ry = lerp(p.head.ry, look, 0.85); p.head.rx = -0.12; }
  if (has(p, 'neck')) p.neck.rx = -0.16;
  if (has(p, 'hips')) p.hips.ty = -0.02;
  for (const tag of legTags) {
    if (!has(p, `leg${tag}1`)) continue;
    p[`leg${tag}1`].rx = 0.2;
    p[`leg${tag}2`].rx = -0.3;
  }
}

/** 待機 C：くつろぐ／伏せる。 */
function idleRest(p, t, o) {
  baseLife(p, t * 0.6, o);
  if (has(p, 'hips')) { p.hips.ty = -0.16; p.hips.rx = 0.1; }
  if (has(p, 'neck')) p.neck.rx = 0.18;
  if (has(p, 'head')) p.head.rx = -0.1;
  for (const tag of legTags) {
    if (!has(p, `leg${tag}1`)) continue;
    p[`leg${tag}0`].rx = tag[0] === 'F' ? 0.9 : -0.6;
    p[`leg${tag}1`].rx = tag[0] === 'F' ? -1.5 : 1.3;
    p[`leg${tag}2`].rx = tag[0] === 'F' ? 0.6 : -0.6;
  }
}

/** 歩き。対角の脚が同時に出る（トロット）。 */
function walk(p, phase, o) {
  baseLife(p, phase * 0.5, o);
  const amp = o.amp === undefined ? 1 : o.amp;
  const bounce = Math.abs(Math.sin(phase));
  if (has(p, 'hips')) {
    p.hips.ty = (bounce * 0.03 - 0.014) * amp;
    p.hips.rz = Math.cos(phase) * 0.05 * amp;
    p.hips.ry = Math.sin(phase) * 0.05 * amp;
  }
  if (has(p, 'spine1')) p.spine1.ry = -Math.sin(phase) * 0.05 * amp;
  if (has(p, 'chest')) p.chest.ry = -Math.sin(phase) * 0.06 * amp;
  if (has(p, 'neck')) p.neck.rx = -0.06 + Math.sin(phase * 2) * 0.03;
  const offsets = { FL: 0, BR: 0, FR: Math.PI, BL: Math.PI };
  for (const tag of legTags) {
    if (!has(p, `leg${tag}0`)) continue;
    const a = phase + offsets[tag];
    const front = tag[0] === 'F';
    p[`leg${tag}0`].rx = Math.sin(a) * 0.52 * amp;
    p[`leg${tag}1`].rx = -clamp(Math.sin(a - 1.0), -1, 0.2) * (front ? 0.8 : 1.0) * amp - 0.08;
    p[`leg${tag}2`].rx = clamp(Math.sin(a + 0.8), -0.4, 1) * 0.45 * amp * (front ? 1 : -1);
    p[`leg${tag}3`].rx = -Math.sin(a) * 0.3 * amp;
  }
  for (let i = 0; i < 6; i++) {
    if (!has(p, `tail${i}`)) break;
    p[`tail${i}`].ry += Math.sin(phase - i * 0.5) * 0.08;
  }
}

/** 走り。背骨がうねり、脚が前後で揃う（バウンド）。 */
function run(p, phase, o) {
  baseLife(p, phase * 0.5, o);
  const amp = 1.5;
  const bounce = Math.sin(phase * 2);
  if (has(p, 'hips')) { p.hips.ty = bounce * 0.05 + 0.02; p.hips.rx = Math.sin(phase * 2 + 0.6) * 0.12; }
  if (has(p, 'spine1')) p.spine1.rx = -Math.sin(phase * 2) * 0.16;
  if (has(p, 'spine2')) p.spine2.rx = -Math.sin(phase * 2 + 0.3) * 0.14;
  if (has(p, 'chest')) p.chest.rx = Math.sin(phase * 2 + 0.6) * 0.1;
  if (has(p, 'neck')) p.neck.rx = -0.24;
  for (const tag of legTags) {
    if (!has(p, `leg${tag}0`)) continue;
    const front = tag[0] === 'F';
    const a = phase * 2 + (front ? 0 : Math.PI * 0.72);
    p[`leg${tag}0`].rx = Math.sin(a) * 0.85 * amp * 0.6;
    p[`leg${tag}1`].rx = -clamp(Math.sin(a - 1.1), -1, 0.3) * 1.15;
    p[`leg${tag}2`].rx = clamp(Math.sin(a + 0.9), -0.5, 1) * 0.7 * (front ? 1 : -1);
  }
  for (let i = 0; i < 6; i++) {
    if (!has(p, `tail${i}`)) break;
    p[`tail${i}`].rx += 0.12 + Math.sin(phase * 2 - i * 0.4) * 0.1;
  }
}

/** 飛行（羽ばたき）。 */
function fly(p, t, o) {
  baseLife(p, t, o);
  const beat = Math.sin(t * 7.5);
  const beat2 = Math.sin(t * 7.5 - 0.7);
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    if (!has(p, `wing${side}0`)) continue;
    p[`wing${side}0`].rz = s * (0.2 + beat * 0.85);
    p[`wing${side}0`].rx = beat * 0.2;
    p[`wing${side}1`].rz = s * (0.1 + beat2 * 0.5);
    if (has(p, `wing${side}2`)) p[`wing${side}2`].rz = s * (beat2 * 0.4);
  }
  if (has(p, 'hips')) p.hips.ty = Math.sin(t * 7.5 - 1.2) * 0.03;
  if (has(p, 'chest')) p.chest.rx = beat * 0.06;
  for (const tag of ['L', 'R']) {
    if (!has(p, `leg${tag}0`)) continue;
    p[`leg${tag}0`].rx = 0.9;
    p[`leg${tag}1`].rx = -1.1;
  }
  for (let i = 0; i < 4; i++) {
    if (!has(p, `tail${i}`)) break;
    p[`tail${i}`].rx += Math.sin(t * 3 - i * 0.4) * 0.08;
  }
}

/** 泳ぎ（体をくねらせて進む）。 */
function swim(p, t, o) {
  baseLife(p, t * 0.7, o);
  const wave = (i) => Math.sin(t * 2.6 - i * 0.8);
  if (has(p, 'hips')) p.hips.ry = wave(0) * 0.12;
  if (has(p, 'chest')) p.chest.ry = wave(-0.5) * 0.08;
  if (has(p, 'neck')) p.neck.ry = wave(-1) * 0.06;
  for (let i = 0; i < 6; i++) {
    if (!has(p, `tail${i}`)) break;
    p[`tail${i}`].ry = wave(i + 1) * (0.18 + i * 0.05);
  }
  for (let i = 0; i < 4; i++) {
    const n = `fin${i}`;
    if (!has(p, n)) continue;
    const s = i % 2 === 0 ? 1 : -1;
    p[n].rz = s * (0.25 + Math.sin(t * 2.2 + i) * 0.18);
    if (has(p, `${n}b`)) p[`${n}b`].rz = s * Math.sin(t * 2.2 + i - 0.5) * 0.25;
  }
}

/** 眠る。 */
function sleep(p, t, o) {
  const breath = Math.sin(t * 0.9);
  if (has(p, 'hips')) { p.hips.ty = -0.22; p.hips.rz = 0.25; }
  if (has(p, 'chest')) { p.chest.sy = 1 + breath * 0.05; p.chest.sx = 1 + breath * 0.04; }
  if (has(p, 'neck')) { p.neck.rx = 0.5; p.neck.ry = 0.5; }
  if (has(p, 'head')) { p.head.rx = 0.35; p.head.rz = 0.3; }
  for (const tag of legTags) {
    if (!has(p, `leg${tag}0`)) continue;
    p[`leg${tag}0`].rx = tag[0] === 'F' ? 1.2 : -0.9;
    p[`leg${tag}1`].rx = tag[0] === 'F' ? -1.9 : 1.7;
    p[`leg${tag}2`].rx = 0.5;
  }
  for (let i = 0; i < 6; i++) {
    if (!has(p, `tail${i}`)) break;
    p[`tail${i}`].ry = 0.3 + Math.sin(t * 0.7 - i * 0.4) * 0.05;
  }
}

/** 食べる／飲む（地面へ頭を下げる）。 */
function eat(p, t, o) {
  baseLife(p, t, o);
  const bob = Math.sin(t * 4.5);
  if (has(p, 'neck')) p.neck.rx = 0.9 + bob * 0.08;
  if (has(p, 'head')) p.head.rx = 0.45 + bob * 0.1;
  if (has(p, 'jaw')) p.jaw.rx = Math.max(0, Math.sin(t * 9)) * 0.35;
  if (has(p, 'hips')) p.hips.ty = -0.03;
}

/** 鳴く（体を伸ばして吠える／さえずる）。 */
function cry(p, t, o) {
  baseLife(p, t, o);
  const k = clamp(Math.sin(t * 3.2), 0, 1);
  if (has(p, 'neck')) p.neck.rx = -0.5 - k * 0.3;
  if (has(p, 'head')) p.head.rx = -0.35 - k * 0.25;
  if (has(p, 'jaw')) p.jaw.rx = 0.15 + k * 0.55;
  if (has(p, 'chest')) p.chest.rx = -0.12;
  if (has(p, 'hips')) p.hips.ty = k * 0.03;
}

/** 喜ぶ（跳ねる・尻尾を振る）。 */
function happy(p, t, o) {
  baseLife(p, t, o);
  const hop = Math.abs(Math.sin(t * 4.2));
  if (has(p, 'hips')) { p.hips.ty = hop * 0.09; p.hips.rx = -0.1 + hop * 0.1; }
  if (has(p, 'neck')) p.neck.rx = -0.25;
  if (has(p, 'head')) p.head.rx = -0.15 + Math.sin(t * 8.4) * 0.08;
  for (let i = 0; i < 6; i++) {
    if (!has(p, `tail${i}`)) break;
    p[`tail${i}`].ry = Math.sin(t * 9 - i * 0.5) * (0.2 + i * 0.06);
    p[`tail${i}`].rx = -0.2;
  }
  for (const tag of legTags) {
    if (!has(p, `leg${tag}1`)) continue;
    p[`leg${tag}1`].rx = -hop * 0.5;
    p[`leg${tag}2`].rx = hop * 0.6 * (tag[0] === 'F' ? 1 : -1);
  }
}

export const CREATURE_CLIPS = {
  idle, idleAlert, idleRest, walk, run, fly, swim, sleep, eat, cry, happy,
};
const LOCOMOTION = new Set(['walk', 'run']);

/** 1 体ぶんの再生器。人間用と同じ使い勝手にしてある。 */
export class CreatureAnimator {
  constructor(skeleton, opts = {}) {
    this.sk = skeleton;
    this.names = skeleton.names;
    this.current = makePose(this.names);
    this.target = makePose(this.names);
    this.prev = makePose(this.names);
    this.clip = opts.clip || 'idle';
    this.time = Math.random() * 12;
    this.phase = Math.random() * Math.PI * 2;
    this.blend = 1;
    this.strideLength = opts.strideLength || 0.9;
    this.blinkTimer = 1 + Math.random() * 3;
    this.blink = 0;
    this.cryEvent = 0;
    this.footstep = 0;
    this._lastFoot = 0;
  }

  setClip(name) {
    if (name === this.clip || !CREATURE_CLIPS[name]) return;
    for (const b in this.current) Object.assign(this.prev[b], this.current[b]);
    this.clip = name;
    this.blend = 0;
  }

  update(dt, state = {}) {
    const speed = state.speed || 0;
    this.time += dt;
    if (LOCOMOTION.has(this.clip)) this.phase += (speed / this.strideLength) * Math.PI * dt * 2;
    else this.phase += dt * 2;

    for (const b in this.target) {
      const t = this.target[b];
      t.rx = t.ry = t.rz = t.tx = t.ty = t.tz = 0;
      t.sx = t.sy = t.sz = 1;
    }
    (CREATURE_CLIPS[this.clip] || idle)(this.target,
      LOCOMOTION.has(this.clip) ? this.phase : this.time, { speed, ...state });

    this.blend = Math.min(1, this.blend + dt * 4.5);
    const k = this.blend * this.blend * (3 - 2 * this.blend);
    const smooth = 1 - Math.exp(-16 * dt);
    for (const b in this.current) {
      const cur = this.current[b], tgt = this.target[b], prv = this.prev[b];
      for (const key of ['rx', 'ry', 'rz', 'tx', 'ty', 'tz', 'sx', 'sy', 'sz']) {
        const blended = lerp(prv[key], tgt[key], k);
        cur[key] += (blended - cur[key]) * smooth;
      }
    }

    // まばたき（目を縦に潰す）
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) { this.blinkTimer = 2.2 + Math.random() * 4; this.blink = 1; }
    this.blink = Math.max(0, this.blink - dt * 7);
    const lid = Math.sin(clamp(this.blink, 0, 1) * Math.PI) ;

    for (const b in this.current) {
      const j = this.sk.j(b);
      if (!j) continue;
      const c = this.current[b];
      j.rx = c.rx; j.ry = c.ry; j.rz = c.rz;
      j.tx = c.tx; j.ty = c.ty; j.tz = c.tz;
      j.sx = c.sx; j.sy = c.sy; j.sz = c.sz;
    }
    // 目玉の骨があれば瞬きで潰す
    for (const n of ['eyeL', 'eyeR']) {
      const j = this.sk.j(n);
      if (j) j.sy = 1 - lid * 0.92;
    }

    // 足が地面を打つ瞬間（足音と土煙の合図）
    const fp = Math.sin(this.phase);
    const planted = (this._lastFoot > 0) !== (fp > 0);
    this._lastFoot = fp;
    this.footstep = planted && LOCOMOTION.has(this.clip) && speed > 0.2 ? 1 : 0;
    // 鳴き声のタイミング（Audio と同期させるためのイベント）
    this.cryEvent = this.clip === 'cry' && Math.sin(this.time * 3.2) > 0.98 ? 1 : 0;

    this.sk.update();
    return this.footstep;
  }
}
