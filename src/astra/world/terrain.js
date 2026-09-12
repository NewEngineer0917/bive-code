/**
 * ルミナタウンの地形。
 *
 * 「平らな板の上に建物を置いただけ」にしないため、地面は高さ場で作る。
 *  - 広場・各建物の敷地は平らな段（パッド）
 *  - 北東の展望の丘はなだらかな盛り上がり
 *  - 川は谷として彫り込む
 *  - その他はゆるいうねりのノイズ
 * 舗装は道の中心線からの距離で決まり、石畳 → 土 → 芝 が連続的に混ざる。
 */

import { clamp, smoothstep } from '../core/math.js';
import { fbm } from '../gfx/noise.js';

const HALF = 118;            // 町のおおよその半径（この外は遠景）

/** 滑らかな縁を持つ平坦地。建物の敷地に使う。 */
function pad(x, z, cx, cz, rx, rz, height, feather = 6) {
  const dx = Math.abs(x - cx) - rx;
  const dz = Math.abs(z - cz) - rz;
  const d = Math.max(dx, dz);
  const w = 1 - smoothstep(0, feather, d);
  return { h: height, w };
}

/** 道・川の中心線（折れ線）への距離。 */
export function distToPolyline(x, z, pts) {
  let best = Infinity, bestT = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / len2;
    t = clamp(t, 0, 1);
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) { best = d; bestT = (i + t) / (pts.length - 1); }
  }
  return { d: best, t: bestT };
}

/** 川の中心線（北東から南西へ流れる）。 */
export const RIVER_PATH = [
  [86, -112], [78, -78], [72, -44], [66, -14], [60, 12],
  [52, 38], [42, 62], [30, 86], [18, 112],
];

/** 道の定義。種類ごとに舗装と幅が違う。 */
export const ROADS = [
  // 広場から北：研究所への並木道
  { pts: [[0, -18], [0, -30], [-2, -42]], width: 7.5, kind: 'stone' },
  // 広場から南：マーケットストリート → 森の門
  { pts: [[0, 18], [0, 34], [1, 52], [0, 70], [0, 88], [0, 101]], width: 8.5, kind: 'stone' },
  // 広場から東：クリニック経由で橋へ
  { pts: [[18, -4], [30, -12], [36, -20], [44, -14], [52, -4], [58, 6]], width: 6.5, kind: 'stone' },
  // 広場から西：住宅街へ
  { pts: [[-18, 4], [-30, 12], [-42, 18]], width: 6.5, kind: 'stone' },
  // 住宅街の環状路
  { pts: [[-42, 18], [-58, 24], [-66, 38], [-60, 52], [-46, 58], [-34, 50], [-30, 36], [-42, 18]], width: 5, kind: 'stone' },
  // 丘への小径（土）
  { pts: [[26, -16], [30, -30], [26, -44], [32, -58], [40, -68]], width: 3.4, kind: 'dirt' },
  // 川沿いの小径（土）
  { pts: [[52, -10], [48, 14], [42, 36], [34, 58], [24, 80]], width: 3.2, kind: 'dirt' },
  // 裏路地（狭い石畳）
  { pts: [[-9, 44], [-16, 47], [-24, 52], [-28, 46]], width: 2.6, kind: 'stone' },
  // 橋から神社へ
  { pts: [[62, 8], [70, 16], [76, 28]], width: 3.6, kind: 'dirt' },
  // マーケットから川沿いへ抜ける道
  { pts: [[6, 56], [18, 58], [30, 60]], width: 4, kind: 'dirt' },
];

/** 平坦にする敷地。 */
const PADS = [
  { cx: 0, cz: 0, rx: 21, rz: 21, h: 0.0, feather: 7 },       // 中央広場
  { cx: -2, cz: -52, rx: 22, rz: 14, h: 1.4, feather: 6 },    // 研究所
  { cx: 34, cz: -26, rx: 11, rz: 10, h: 0.7, feather: 5 },    // クリニック
  { cx: -27, cz: -9, rx: 8, rz: 7, h: 0.25, feather: 4 },     // 道具屋
  { cx: 23, cz: 9, rx: 8, rz: 7, h: 0.2, feather: 4 },        // カフェ
  { cx: 0, cz: 46, rx: 14, rz: 26, h: -0.5, feather: 7 },     // マーケット通り
  { cx: -48, cz: 38, rx: 24, rz: 24, h: 1.9, feather: 9 },    // 住宅街の段
  { cx: 76, cz: 32, rx: 10, rz: 10, h: 2.6, feather: 7 },     // 神社
  { cx: 0, cz: 96, rx: 13, rz: 9, h: 0.9, feather: 6 },       // 森の門
];

export class Terrain {
  constructor(seed = 7) {
    this.seed = seed;
    this.riverWidth = 7.5;
    this.riverDepth = 3.4;
    this.waterLevel = -1.35;
    this._cache = new Map();
  }

  /** 地面の高さ。 */
  height(x, z) {
    // ベース：ゆるいうねり
    let h = (fbm(x * 0.012 + 40, z * 0.012 + 40, 3, 512, this.seed) - 0.5) * 3.0;
    h += (fbm(x * 0.045 + 11, z * 0.045 + 11, 2, 512, this.seed + 3) - 0.5) * 0.7;

    // 展望の丘（北東）
    const hillD = Math.hypot(x - 40, z - 70 + 138) / 30;   // 中心 (40, -68)
    const hill = Math.pow(Math.max(0, 1 - hillD), 1.7) * 9.4;
    h += hill;

    // 町の外周は少し盛り上げて「外に出られない」を自然に見せる
    const rim = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(HALF - 22, HALF + 16, rim) * 12;

    // 敷地を平らにする
    for (const p of PADS) {
      const r = pad(x, z, p.cx, p.cz, p.rx, p.rz, p.h, p.feather);
      h = h * (1 - r.w) + r.h * r.w;
    }

    // 道はなだらかに（急な段差で歩けなくならないように少しだけ均す）
    const road = this.roadField(x, z);
    if (road.w > 0.01) {
      const smoothH = (this._rawNear(x, z) + h) * 0.5;
      h = h * (1 - road.w * 0.35) + smoothH * road.w * 0.35;
    }

    // 川を彫る
    const river = distToPolyline(x, z, RIVER_PATH);
    const bank = 1 - smoothstep(this.riverWidth * 0.5, this.riverWidth * 0.5 + 7, river.d);
    if (bank > 0) {
      const profile = Math.pow(bank, 1.5);
      h = h - profile * this.riverDepth;
      // 川底は平たく
      const core = 1 - smoothstep(0, this.riverWidth * 0.5, river.d);
      h = h * (1 - core * 0.8) + (this.waterLevel - 1.5) * core * 0.8;
    }

    return h;
  }

  _rawNear(x, z) {
    let h = (fbm(x * 0.012 + 40, z * 0.012 + 40, 3, 512, this.seed) - 0.5) * 3.0;
    const hillD = Math.hypot(x - 40, z + 68) / 30;
    h += Math.pow(Math.max(0, 1 - hillD), 1.7) * 9.4;
    for (const p of PADS) {
      const r = pad(x, z, p.cx, p.cz, p.rx, p.rz, p.h, p.feather);
      h = h * (1 - r.w) + r.h * r.w;
    }
    return h;
  }

  /** 法線（坂の向き。移動と草の向きに使う）。 */
  normal(x, z, eps = 0.6) {
    const hL = this.height(x - eps, z), hR = this.height(x + eps, z);
    const hD = this.height(x, z - eps), hU = this.height(x, z + eps);
    const nx = hL - hR, nz = hD - hU, ny = 2 * eps;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  /** 傾斜（0 = 平ら、1 = 垂直）。 */
  slope(x, z) {
    return 1 - this.normal(x, z)[1];
  }

  /** 道からの影響。w は舗装の強さ、kind は石畳／土。 */
  roadField(x, z) {
    let w = 0, stone = 0, dirt = 0;
    for (const r of ROADS) {
      const { d } = distToPolyline(x, z, r.pts);
      const half = r.width * 0.5;
      // 縁はほつれさせて直線的にしない
      const noise = (fbm(x * 0.35, z * 0.35, 2, 512, 91) - 0.5) * 1.5;
      const v = 1 - smoothstep(half - 0.6, half + 2.0 + noise, d);
      if (v <= 0) continue;
      w = Math.max(w, v);
      if (r.kind === 'dirt') dirt = Math.max(dirt, v); else stone = Math.max(stone, v);
    }
    // 中央広場そのものは全面石畳
    const plazaD = Math.hypot(x, z);
    const noise = (fbm(x * 0.3, z * 0.3, 2, 512, 33) - 0.5) * 2.2;
    const plaza = 1 - smoothstep(19.5, 22.5 + noise, plazaD);
    if (plaza > 0) { w = Math.max(w, plaza); stone = Math.max(stone, plaza); }
    return { w, stone, dirt };
  }

  /** 川の水面高さ（緩やかに下る）。 */
  waterHeightAt(x, z) {
    const { t } = distToPolyline(x, z, RIVER_PATH);
    return this.waterLevel - t * 1.1;
  }

  /** その地点が川の中か。 */
  riverInfo(x, z) {
    const { d, t } = distToPolyline(x, z, RIVER_PATH);
    return { dist: d, t, inWater: d < this.riverWidth * 0.5 + 0.5 };
  }
}
