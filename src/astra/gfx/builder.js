/**
 * メッシュビルダ。
 *
 * 手続きで作った小さなジオメトリを、材質ごとに 1 本の大きな頂点バッファへ
 * 溶かし込む。町ぜんぶを数十ドローコールで描けるのはこの仕組みのおかげ。
 *
 * 頂点属性は 17 float:
 *   位置(3) 法線(3) UV(2) 色(3) AO(1) 風の重み(1) 材質(1) 第2材質(1) 混合(1) ボーン(1)
 * ボーンはスキニング用の骨番号。1 頂点 1 骨の剛体スキニングで、関節は球で
 * 隠す方式。おかげでキャラクターも生き物も 1 ドローコールで動かせる。
 * 第2材質と混合は地面で使う。石畳から芝へ、土から草へと連続的に変えるため、
 * 面ごとに材質が切り替わるカクカクした境界にならない。
 * 色は材質テクスチャに掛ける「同じ建材でも家ごとに色を変える」ための係数。
 * AO は角や地面際を暗くする事前計算の遮蔽。風の重みは葉や旗を揺らす強さ。
 * 材質レイヤはテクスチャ配列の添字で、これがあるおかげで「石も木も屋根も
 * 混ざった 1 個のバッファ」を 1 ドローコールで描ける。
 *
 * まとめ先はパス（opaque / cutout / transparent）ごと。材質ごとではない。
 */

import { m4compose, m4trs, mat4 } from '../core/math.js';

export const VERTEX_FLOATS = 17;

export class MeshBuilder {
  constructor() {
    /** @type {Map<string, {positions:number[], normals:number[], uvs:number[], colors:number[], ao:number[], wind:number[], indices:number[]}>} */
    this.groups = new Map();
    this.matrixStack = [mat4()];
  }

  get matrix() { return this.matrixStack[this.matrixStack.length - 1]; }

  /** 変換を積む。戻すときは pop()。 */
  push(matrix) {
    const cur = this.matrix;
    const out = mat4();
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = cur[r] * matrix[c * 4] + cur[4 + r] * matrix[c * 4 + 1]
          + cur[8 + r] * matrix[c * 4 + 2] + cur[12 + r] * matrix[c * 4 + 3];
      }
    }
    this.matrixStack.push(out);
    return this;
  }

  pop() {
    if (this.matrixStack.length > 1) this.matrixStack.pop();
    return this;
  }

  /** 位置・Y回転・スケールを積む簡易版。 */
  at(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx) {
    return this.push(m4compose(mat4(), x, y, z, ry, sx, sy, sz));
  }

  /** 3 軸回転つき。 */
  atFull(x, y, z, rx, ry, rz, sx = 1, sy = sx, sz = sx) {
    return this.push(m4trs(mat4(), x, y, z, rx, ry, rz, sx, sy, sz));
  }

  group(pass) {
    let g = this.groups.get(pass);
    if (!g) {
      g = { positions: [], normals: [], uvs: [], colors: [], ao: [], wind: [], mat: [], mat2: [], blend: [], bone: [], indices: [] };
      this.groups.set(pass, g);
    }
    return g;
  }

  /**
   * ジオメトリを現在の変換で書き込む。
   * opts: color, ao（数値 or (p)=>数値）, wind, uvScale, uvOffset, windFromY
   */
  add(geo, material, opts = {}) {
    const {
      color = [1, 1, 1], ao = 1, wind = 0,
      uvScale = 1, uvOffset = [0, 0], windFromY = null, jitterUV = false,
    } = opts;
    const g = this.group(material.pass || 'opaque');
    const layer = material.layer === undefined ? 0 : material.layer;
    const material2 = opts.material2 || material;
    const layer2 = material2.layer === undefined ? layer : material2.layer;
    const blend = opts.blend === undefined ? 0 : opts.blend;
    const blendFn = typeof blend === 'function' ? blend : null;
    const bone = opts.bone === undefined ? 0 : opts.bone;
    const boneFn = typeof bone === 'function' ? bone : null;
    const m = this.matrix;
    const base = g.positions.length / 3;
    const n = geo.positions.length / 3;
    // 法線変換（一様スケール前提の簡易版。非一様でも見た目の破綻は小さい）
    const sx = Math.hypot(m[0], m[1], m[2]) || 1;
    const sy = Math.hypot(m[4], m[5], m[6]) || 1;
    const sz = Math.hypot(m[8], m[9], m[10]) || 1;
    const uo = jitterUV ? [uvOffset[0] + (m[12] * 0.37 + m[14] * 0.11) % 1, uvOffset[1] + (m[14] * 0.29) % 1] : uvOffset;
    const colFn = typeof color === 'function' ? color : null;
    const aoFn = typeof ao === 'function' ? ao : null;
    const windFn = typeof wind === 'function' ? wind : null;

    for (let i = 0; i < n; i++) {
      const px = geo.positions[i * 3], py = geo.positions[i * 3 + 1], pz = geo.positions[i * 3 + 2];
      const wx = m[0] * px + m[4] * py + m[8] * pz + m[12];
      const wy = m[1] * px + m[5] * py + m[9] * pz + m[13];
      const wz = m[2] * px + m[6] * py + m[10] * pz + m[14];
      g.positions.push(wx, wy, wz);

      const nx = geo.normals[i * 3] / sx, ny = geo.normals[i * 3 + 1] / sy, nz = geo.normals[i * 3 + 2] / sz;
      let tnx = m[0] * nx + m[4] * ny + m[8] * nz;
      let tny = m[1] * nx + m[5] * ny + m[9] * nz;
      let tnz = m[2] * nx + m[6] * ny + m[10] * nz;
      const nl = Math.hypot(tnx, tny, tnz) || 1;
      g.normals.push(tnx / nl, tny / nl, tnz / nl);

      g.uvs.push(geo.uvs[i * 2] * uvScale + uo[0], geo.uvs[i * 2 + 1] * uvScale + uo[1]);

      const c = colFn ? colFn([wx, wy, wz], i) : color;
      g.colors.push(c[0], c[1], c[2]);
      g.ao.push(aoFn ? aoFn([wx, wy, wz], i) : ao);
      if (windFromY) {
        const t = Math.max(0, Math.min(1, (py - windFromY[0]) / Math.max(0.001, windFromY[1] - windFromY[0])));
        g.wind.push(t * t * (windFromY[2] === undefined ? 1 : windFromY[2]));
      } else {
        g.wind.push(windFn ? windFn([wx, wy, wz], i, [px, py, pz]) : wind);
      }
      g.mat.push(layer);
      g.mat2.push(layer2);
      g.blend.push(blendFn ? blendFn([wx, wy, wz], i, [px, py, pz]) : blend);
      g.bone.push(boneFn ? boneFn([wx, wy, wz], i, [px, py, pz]) : bone);
    }
    for (let i = 0; i < geo.indices.length; i++) g.indices.push(base + geo.indices[i]);
    return this;
  }

  /** 他のビルダの中身を取り込む（部品ごとに作って合流させる用）。 */
  merge(other) {
    for (const [pass, src] of other.groups) {
      const dst = this.group(pass);
      const base = dst.positions.length / 3;
      const cat = (a, b) => { for (let i = 0; i < b.length; i++) a.push(b[i]); };
      cat(dst.positions, src.positions);
      cat(dst.normals, src.normals);
      cat(dst.uvs, src.uvs);
      cat(dst.colors, src.colors);
      cat(dst.ao, src.ao);
      cat(dst.wind, src.wind);
      cat(dst.mat, src.mat);
      cat(dst.mat2, src.mat2);
      cat(dst.blend, src.blend);
      cat(dst.bone, src.bone);
      for (const i of src.indices) dst.indices.push(base + i);
    }
    return this;
  }

  get triangleCount() {
    let t = 0;
    for (const g of this.groups.values()) t += g.indices.length / 3;
    return t;
  }

  /**
   * 描画可能な形へ焼き込む。
   * 返り値: [{ material, data, indices, bounds:{cx,cy,cz,r,min,max} }]
   */
  build() {
    const out = [];
    for (const [pass, g] of this.groups) {
      const n = g.positions.length / 3;
      if (!n) continue;
      const data = new Float32Array(n * VERTEX_FLOATS);
      let min = [Infinity, Infinity, Infinity];
      let max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) {
        const o = i * VERTEX_FLOATS;
        const x = g.positions[i * 3], y = g.positions[i * 3 + 1], z = g.positions[i * 3 + 2];
        data[o] = x; data[o + 1] = y; data[o + 2] = z;
        data[o + 3] = g.normals[i * 3]; data[o + 4] = g.normals[i * 3 + 1]; data[o + 5] = g.normals[i * 3 + 2];
        data[o + 6] = g.uvs[i * 2]; data[o + 7] = g.uvs[i * 2 + 1];
        data[o + 8] = g.colors[i * 3]; data[o + 9] = g.colors[i * 3 + 1]; data[o + 10] = g.colors[i * 3 + 2];
        data[o + 11] = g.ao[i];
        data[o + 12] = g.wind[i];
        data[o + 13] = g.mat[i];
        data[o + 14] = g.mat2[i];
        data[o + 15] = g.blend[i];
        data[o + 16] = g.bone[i];
        if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
        if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
      }
      const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
      const r = Math.hypot(max[0] - cx, max[1] - cy, max[2] - cz);
      const indices = n > 65535 ? new Uint32Array(g.indices) : new Uint16Array(g.indices);
      out.push({ pass, data, indices, bounds: { cx, cy, cz, r, min, max } });
    }
    return out;
  }
}

/**
 * 空間を格子に区切り、材質ごとのバッチをさらにタイルへ分ける。
 * 町のような広い静的メッシュを視錐台カリングできるようにするため。
 */
export class ChunkedBuilder {
  constructor(chunkSize = 26) {
    this.chunkSize = chunkSize;
    /** @type {Map<string, MeshBuilder>} */
    this.chunks = new Map();
  }

  /** 座標からその場所のビルダを得る。 */
  at(x, z) {
    const cx = Math.floor(x / this.chunkSize);
    const cz = Math.floor(z / this.chunkSize);
    const key = `${cx},${cz}`;
    let b = this.chunks.get(key);
    if (!b) { b = new MeshBuilder(); this.chunks.set(key, b); }
    return b;
  }

  build() {
    const out = [];
    for (const b of this.chunks.values()) out.push(...b.build());
    return out;
  }

  get triangleCount() {
    let t = 0;
    for (const b of this.chunks.values()) t += b.triangleCount;
    return t;
  }
}
