/**
 * 植物。
 *
 * 木は「幹＋枝＋葉の房」で作る。葉は
 *   1. 変形させた球（葉テクスチャの切り抜き）＝ 密度
 *   2. 縁に刺したクロスボード          ＝ シルエットのほつれ
 * の 2 層で、遠目には塊として、近くでは葉として見えるようにしている。
 * すべての葉と枝先には風の重みが入っていて、町ぜんぶが同じ風で揺れる。
 */

import { tube, sphere, cylinder, crossBillboard, deform } from '../gfx/geo.js';
import { TAU, clamp, lerp } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';

/** 幹と枝。戻り値は枝先の座標（葉を付ける場所）。 */
function trunkAndBranches(mb, mats, opts) {
  const {
    height, baseRadius, topRadius, curve, branches, seed, barkColor,
    branchStart = 0.45, segments = 7, lod = 1
  } = opts;
  const tips = [];
  const path = [];
  const rows = Math.max(4, Math.round(6 * lod));
  const leanX = (hash2(seed, 1, 5) - 0.5) * curve;
  const leanZ = (hash2(seed, 2, 5) - 0.5) * curve;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const bend = Math.pow(t, 1.7);
    path.push([
      leanX * bend + Math.sin(t * 3 + seed) * 0.06 * height * 0.1,
      t * height,
      leanZ * bend + Math.cos(t * 2.3 + seed) * 0.06 * height * 0.1,
    ]);
  }
  mb.add(tube(path, (t) => lerp(baseRadius, topRadius, Math.pow(t, 0.7)), Math.max(5, Math.round(segments * lod)),
    { closeEnd: false }), mats.bark, {
    color: barkColor,
    ao: (p) => clamp(0.42 + (p[1] / height) * 0.62, 0.42, 1),
    windFromY: [height * 0.25, height, 0.18]
  });
  // 根張り
  const roots = Math.round(4 * lod) + 2;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * TAU + hash2(seed, i, 9);
    const len = baseRadius * (2.1 + hash2(seed, i + 3, 9) * 1.3);
    const rp = [];
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      rp.push([Math.cos(a) * len * t, baseRadius * 0.9 * (1 - t) * (1 - t) - 0.04, Math.sin(a) * len * t]);
    }
    mb.add(tube(rp, (t) => baseRadius * 0.42 * (1 - t * 0.85), 5), mats.bark,
      { color: barkColor.map((v) => v * 0.88), ao: 0.5 });
  }
  // 枝
  const n = Math.max(2, Math.round(branches * lod));
  for (let i = 0; i < n; i++) {
    const t0 = branchStart + (i / n) * (1 - branchStart) * 0.92;
    const a = i * 2.39996 + seed;
    const idx = clamp(Math.floor(t0 * rows), 0, rows);
    const from = path[idx];
    const len = height * (0.2 + hash2(seed, i, 11) * 0.22) * (1 - t0 * 0.4);
    const up = 0.45 + hash2(seed, i + 5, 11) * 0.5;
    const bp = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      bp.push([
        from[0] + Math.cos(a) * len * t,
        from[1] + len * up * Math.pow(t, 0.75),
        from[2] + Math.sin(a) * len * t,
      ]);
    }
    const r0 = lerp(baseRadius, topRadius, t0) * 0.55;
    mb.add(tube(bp, (t) => r0 * (1 - t * 0.8), 5), mats.bark, {
      color: barkColor.map((v) => v * 0.95),
      ao: (p) => clamp(0.6 + (p[1] / height) * 0.4, 0.6, 1),
      windFromY: [from[1], from[1] + len, 0.55]
    });
    tips.push(bp[4]);
  }
  return { tips, top: path[rows] };
}

/** 葉の房。球を歪めたものにクロスボードを足す。 */
function leafCluster(mb, mats, x, y, z, radius, opts = {}) {
  const {
    color = [1, 1, 1], seed = 0, lod = 1, cards = 5, windBase = 0, flatten = 0.78,
    leafMat = null
  } = opts;
  const mat = leafMat || mats.leaves;
  const segs = Math.max(7, Math.round(12 * lod));
  const shell = deform(sphere(radius, segs, Math.max(5, Math.round(8 * lod)), { yScale: flatten }), (p) => {
    const n = Math.sin(p[0] * 2.1 + seed) * Math.cos(p[2] * 1.9 + seed * 2) * Math.sin(p[1] * 1.6);
    const k = 1 + n * 0.24;
    return [p[0] * k, p[1] * k, p[2] * k];
  });
  mb.at(x, y, z, hash2(seed, 4, 3) * TAU);
  mb.add(shell, mat, {
    color,
    ao: (p) => clamp(0.52 + (p[1] - y + radius) / (radius * 2) * 0.62, 0.5, 1.06),
    wind: (p) => clamp(windBase + 0.35, 0, 1)
  });
  mb.pop();
  const nCards = Math.max(2, Math.round(cards * lod));
  for (let i = 0; i < nCards; i++) {
    const a = i * 2.39996 + seed;
    const r = radius * (0.72 + hash2(seed, i, 7) * 0.42);
    const yy = y + (hash2(seed, i + 2, 7) - 0.42) * radius * 1.1;
    mb.at(x + Math.cos(a) * r * 0.8, yy, z + Math.sin(a) * r * 0.8, a,
      radius * 1.15, radius * 1.0, radius * 1.15);
    mb.add(crossBillboard(1.0, 1.0, 2, { taper: 0.15, rows: 2 }), mat, {
      color, ao: 0.92, wind: clamp(windBase + 0.55, 0, 1)
    });
    mb.pop();
  }
}

/** 広葉樹。町の並木と広場の主役。 */
export function oakTree(mb, mats, opts = {}) {
  const {
    height = 7.5, seed = 1, lod = 1,
    leafColor = [0.95, 1.0, 0.85], barkColor = [1, 1, 1], scale = 1
  } = opts;
  const h = height * scale;
  const { tips, top } = trunkAndBranches(mb, mats, {
    height: h, baseRadius: h * 0.055, topRadius: h * 0.02, curve: h * 0.06,
    branches: 5, seed, barkColor, branchStart: 0.42, lod
  });
  leafCluster(mb, mats, top[0], top[1] + h * 0.06, top[2], h * 0.27,
    { color: leafColor, seed: seed + 1, lod, cards: 6, windBase: 0.25 });
  for (let i = 0; i < tips.length; i++) {
    const t = tips[i];
    leafCluster(mb, mats, t[0], t[1] + h * 0.02, t[2], h * (0.15 + hash2(seed, i, 3) * 0.08),
      { color: leafColor.map((v) => v * (0.9 + hash2(seed, i + 1, 3) * 0.2)), seed: seed + i * 3, lod, cards: 4, windBase: 0.45 });
  }
  return { height: h, radius: h * 0.42, trunkRadius: h * 0.06 };
}

/** 針葉樹。森の門と遠景の森に。 */
export function pineTree(mb, mats, opts = {}) {
  const { height = 9, seed = 2, lod = 1, leafColor = [0.7, 0.95, 0.78], barkColor = [0.85, 0.82, 0.8], scale = 1 } = opts;
  const h = height * scale;
  const path = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    path.push([Math.sin(t * 2 + seed) * h * 0.012, t * h, Math.cos(t * 1.7 + seed) * h * 0.012]);
  }
  mb.add(tube(path, (t) => h * 0.038 * (1 - t * 0.82), 6), mats.bark, {
    color: barkColor, ao: (p) => clamp(0.45 + p[1] / h * 0.6, 0.45, 1)
  });
  const tiers = Math.max(4, Math.round(7 * lod));
  for (let i = 0; i < tiers; i++) {
    const t = 0.22 + (i / tiers) * 0.76;
    const r = h * 0.3 * (1 - t) * (1.1 + hash2(seed, i, 5) * 0.25);
    const y = t * h;
    mb.at(0, y, 0, hash2(seed, i, 8) * TAU);
    mb.add(cylinder(r, r * 0.1, h * 0.16, Math.max(7, Math.round(11 * lod)), { caps: false }), mats.leaves, {
      color: leafColor.map((v) => v * (0.86 + hash2(seed, i + 2, 5) * 0.24)),
      ao: clamp(0.55 + t * 0.5, 0.55, 1),
      wind: clamp(0.12 + t * 0.4, 0, 1)
    });
    mb.pop();
    // 縁の房でシルエットをほぐす
    const cards = Math.max(2, Math.round(4 * lod));
    for (let k = 0; k < cards; k++) {
      const a = k / cards * TAU + i * 1.1;
      mb.at(Math.cos(a) * r * 0.85, y + h * 0.03, Math.sin(a) * r * 0.85, a, r * 0.9, r * 0.7, r * 0.9);
      mb.add(crossBillboard(1.0, 1.0, 2, { taper: 0.3, rows: 2 }), mats.leaves,
        { color: leafColor, ao: 0.88, wind: clamp(0.2 + t * 0.5, 0, 1) });
      mb.pop();
    }
  }
  return { height: h, radius: h * 0.3, trunkRadius: h * 0.05 };
}

/** 枝垂れ木。川沿いに。 */
export function willowTree(mb, mats, opts = {}) {
  const { height = 7, seed = 3, lod = 1, leafColor = [0.86, 1.0, 0.76], barkColor = [0.9, 0.88, 0.82], scale = 1 } = opts;
  const h = height * scale;
  const { top } = trunkAndBranches(mb, mats, {
    height: h * 0.62, baseRadius: h * 0.06, topRadius: h * 0.028, curve: h * 0.1,
    branches: 6, seed, barkColor, branchStart: 0.5, lod
  });
  leafCluster(mb, mats, top[0], top[1] + h * 0.1, top[2], h * 0.24,
    { color: leafColor, seed, lod, cards: 4, windBase: 0.3, flatten: 0.62 });
  // 垂れる枝
  const strands = Math.max(6, Math.round(14 * lod));
  for (let i = 0; i < strands; i++) {
    const a = i * 2.39996 + seed;
    const r = h * (0.14 + hash2(seed, i, 4) * 0.16);
    const len = h * (0.3 + hash2(seed, i + 1, 4) * 0.3);
    const sx = top[0] + Math.cos(a) * r, sz = top[2] + Math.sin(a) * r;
    const sy = top[1] + h * 0.1;
    const p = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      p.push([sx + Math.cos(a) * t * r * 0.5, sy - len * t, sz + Math.sin(a) * t * r * 0.5]);
    }
    mb.add(tube(p, (t) => h * 0.008 * (1 - t * 0.6), 4), mats.bark,
      { color: barkColor, ao: 0.8, windFromY: [sy - len, sy, 0.9] });
    for (let k = 1; k <= 3; k++) {
      const t = k / 3.2;
      mb.at(sx + Math.cos(a) * t * r * 0.5, sy - len * t, sz + Math.sin(a) * t * r * 0.5, a,
        h * 0.06, h * 0.11, h * 0.06);
      mb.add(crossBillboard(1.0, 1.0, 2, { taper: 0.4, rows: 2 }), mats.leaves,
        { color: leafColor, ao: 0.9, wind: 0.55 + t * 0.4 });
      mb.pop();
    }
  }
  return { height: h, radius: h * 0.34, trunkRadius: h * 0.07 };
}

/** 白樺。細く背が高く、住宅街のアクセントに。 */
export function birchTree(mb, mats, opts = {}) {
  const { height = 8.5, seed = 4, lod = 1, leafColor = [0.95, 1.0, 0.8], scale = 1 } = opts;
  const h = height * scale;
  const { tips, top } = trunkAndBranches(mb, mats, {
    height: h * 0.82, baseRadius: h * 0.028, topRadius: h * 0.012, curve: h * 0.04,
    branches: 4, seed, barkColor: [1.55, 1.55, 1.5], branchStart: 0.55, lod
  });
  leafCluster(mb, mats, top[0], top[1] + h * 0.1, top[2], h * 0.19,
    { color: leafColor, seed, lod, cards: 5, windBase: 0.4, flatten: 0.85 });
  for (let i = 0; i < tips.length; i++) {
    const t = tips[i];
    leafCluster(mb, mats, t[0], t[1], t[2], h * 0.11,
      { color: leafColor, seed: seed + i, lod, cards: 3, windBase: 0.6 });
  }
  return { height: h, radius: h * 0.26, trunkRadius: h * 0.035 };
}

/** Nova ツリー。広場の象徴。結晶の花が咲き、夜は光る。 */
export function novaTree(mb, mats, opts = {}) {
  const { height = 8, seed = 5, lod = 1, scale = 1, glowColor = [0.5, 0.95, 1.0] } = opts;
  const h = height * scale;
  const { tips, top } = trunkAndBranches(mb, mats, {
    height: h * 0.72, baseRadius: h * 0.05, topRadius: h * 0.018, curve: h * 0.07,
    branches: 7, seed, barkColor: [1.25, 1.2, 1.3], branchStart: 0.38, lod
  });
  const petalColor = [1.25, 1.05, 1.2];
  leafCluster(mb, mats, top[0], top[1] + h * 0.08, top[2], h * 0.22,
    { color: petalColor, seed, lod, cards: 5, windBase: 0.35, flatten: 0.72 });
  for (let i = 0; i < tips.length; i++) {
    const t = tips[i];
    leafCluster(mb, mats, t[0], t[1], t[2], h * (0.11 + hash2(seed, i, 6) * 0.06),
      { color: petalColor, seed: seed + i * 2, lod, cards: 3, windBase: 0.55 });
    // 結晶の実
    if (hash2(seed, i + 9, 6) > 0.35) {
      mb.at(t[0], t[1] - h * 0.03, t[2], 0, h * 0.03, h * 0.05, h * 0.03);
      mb.add(sphere(1, 8, 6, { yScale: 1.4 }), mats.crystal, { color: glowColor, ao: 1, wind: 0.5 });
      mb.pop();
    }
  }
  return { height: h, radius: h * 0.36, trunkRadius: h * 0.055, glow: true };
}

/** 低木。 */
export function bush(mb, mats, opts = {}) {
  const { radius = 0.8, seed = 1, lod = 1, color = [0.9, 1.0, 0.82] } = opts;
  const blobs = Math.max(2, Math.round(3 * lod));
  for (let i = 0; i < blobs; i++) {
    const a = i * 2.39996 + seed;
    const r = radius * (0.55 + hash2(seed, i, 3) * 0.4);
    leafCluster(mb, mats,
      Math.cos(a) * radius * 0.38, r * 0.8 + hash2(seed, i + 1, 3) * 0.15, Math.sin(a) * radius * 0.38,
      r, { color, seed: seed + i, lod, cards: 3, windBase: 0.4, flatten: 0.72 });
  }
  return { radius: radius * 1.2, height: radius * 1.8 };
}

/** 生垣（区画の仕切り）。 */
export function hedge(mb, mats, length, height = 1.0, opts = {}) {
  const { seed = 1, color = [0.82, 0.96, 0.76], lod = 1 } = opts;
  const n = Math.max(2, Math.round(length / 0.9));
  for (let i = 0; i < n; i++) {
    const x = (-0.5 + (i + 0.5) / n) * length;
    const r = height * (0.5 + hash2(seed, i, 5) * 0.14);
    leafCluster(mb, mats, x, height * 0.55, (hash2(seed, i + 3, 5) - 0.5) * 0.2, r,
      { color, seed: seed + i, lod, cards: 2, windBase: 0.18, flatten: 0.9 });
  }
}

/** つる。壁や塀に這わせる。 */
export function vine(mb, mats, height, opts = {}) {
  const { seed = 1, color = [0.85, 1.0, 0.8], strands = 3 } = opts;
  for (let i = 0; i < strands; i++) {
    const x = (i / strands - 0.5) * 0.9;
    const p = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      p.push([x + Math.sin(t * 6 + seed + i) * 0.12, height * t, Math.cos(t * 4 + i) * 0.04]);
    }
    mb.add(tube(p, 0.022, 4), mats.bark, { color: [0.7, 0.85, 0.6], ao: 0.85, windFromY: [0, height, 0.4] });
    for (let k = 1; k <= 4; k++) {
      const t = k / 4.5;
      mb.at(x + Math.sin(t * 6 + seed + i) * 0.12, height * t, 0.05, t * 3 + i, 0.26, 0.24, 0.26);
      mb.add(crossBillboard(1.0, 1.0, 2, { taper: 0.2, rows: 2 }), mats.leaves,
        { color, ao: 0.9, wind: 0.3 + t * 0.4 });
      mb.pop();
    }
  }
}

/** 木の種類の一覧（町の配置側から名前で呼ぶ）。 */
export const TREES = { oak: oakTree, pine: pineTree, willow: willowTree, birch: birchTree, nova: novaTree };
