/**
 * スケルトン（骨組み）。
 *
 * 頂点はバインドポーズのワールド座標で焼いてあるので、
 * シェーダへ渡す行列は  world(骨) × inverse(bindWorld(骨))  になる。
 * 1 頂点 1 骨の剛体スキニングだが、関節に球を置いておけば折れ目は見えない。
 *
 * 骨の定義: { name, parent, offset:[x,y,z] }
 *   offset は親から見た休息時の位置。回転はポーズ側で与える。
 */

import { mat4, m4mul, m4invert, m4trs } from './math.js';

export class Skeleton {
  constructor(def) {
    this.names = def.map((j) => j.name);
    this.index = {};
    def.forEach((j, i) => { this.index[j.name] = i; });
    this.parents = def.map((j) => (j.parent === undefined || j.parent === null
      ? -1 : (typeof j.parent === 'string' ? this.index[j.parent] : j.parent)));
    this.offsets = def.map((j) => j.offset || [0, 0, 0]);
    this.count = def.length;

    // ポーズ（骨ごとの回転・移動・拡大）
    this.pose = def.map(() => ({ rx: 0, ry: 0, rz: 0, tx: 0, ty: 0, tz: 0, sx: 1, sy: 1, sz: 1 }));

    this.local = def.map(() => mat4());
    this.world = def.map(() => mat4());
    this.inverseBind = def.map(() => mat4());
    this.skinData = new Float32Array(def.length * 16);
    this._tmp = mat4();

    this._computeBind();
  }

  _computeBind() {
    for (let i = 0; i < this.count; i++) {
      const o = this.offsets[i];
      const m = m4trs(mat4(), o[0], o[1], o[2], 0, 0, 0, 1, 1, 1);
      const p = this.parents[i];
      const w = mat4();
      if (p >= 0) m4mul(w, this.world[p], m); else w.set(m);
      this.world[i].set(w);
      m4invert(this.inverseBind[i], w);
    }
  }

  /** 名前でポーズを取り出す。 */
  j(name) {
    const i = this.index[name];
    return i === undefined ? null : this.pose[i];
  }

  /** すべてのポーズを初期状態へ。 */
  reset() {
    for (const p of this.pose) {
      p.rx = p.ry = p.rz = 0;
      p.tx = p.ty = p.tz = 0;
      p.sx = p.sy = p.sz = 1;
    }
  }

  /** ポーズからスキン行列を更新し、シェーダへ渡す配列を作る。 */
  update() {
    for (let i = 0; i < this.count; i++) {
      const o = this.offsets[i];
      const p = this.pose[i];
      m4trs(this.local[i],
        o[0] + p.tx, o[1] + p.ty, o[2] + p.tz,
        p.rx, p.ry, p.rz, p.sx, p.sy, p.sz);
      const parent = this.parents[i];
      if (parent >= 0) m4mul(this.world[i], this.world[parent], this.local[i]);
      else this.world[i].set(this.local[i]);
    }
    for (let i = 0; i < this.count; i++) {
      m4mul(this._tmp, this.world[i], this.inverseBind[i]);
      this.skinData.set(this._tmp, i * 16);
    }
    return this.skinData;
  }

  /** 骨の現在のワールド位置（VFX の取り付け位置に使う）。 */
  jointPosition(name, out = [0, 0, 0]) {
    const i = this.index[name];
    if (i === undefined) return out;
    const m = this.world[i];
    out[0] = m[12]; out[1] = m[13]; out[2] = m[14];
    return out;
  }

  /** バインドポーズでの骨の位置（メッシュを組むときの基準）。 */
  bindPosition(name, out = [0, 0, 0]) {
    const i = this.index[name];
    if (i === undefined) return out;
    const inv = this.inverseBind[i];
    const m = mat4();
    m4invert(m, inv);
    out[0] = m[12]; out[1] = m[13]; out[2] = m[14];
    return out;
  }
}

/** 骨の定義から「絶対位置」を先に求めておくヘルパ（メッシュ作成で使う）。 */
export function jointWorldPositions(def) {
  const map = {};
  const out = {};
  def.forEach((j) => { map[j.name] = j; });
  const resolve = (name) => {
    if (out[name]) return out[name];
    const j = map[name];
    const o = j.offset || [0, 0, 0];
    if (!j.parent) { out[name] = [...o]; return out[name]; }
    const p = resolve(j.parent);
    out[name] = [p[0] + o[0], p[1] + o[1], p[2] + o[2]];
    return out[name];
  };
  def.forEach((j) => resolve(j.name));
  return out;
}
