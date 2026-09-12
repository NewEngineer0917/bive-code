/**
 * ランドマーク。
 *
 * 町の中で「あれが見えるからこっちは南だ」と分かる目印を作る。
 * Nova の泉、石橋、森の門、小さな社、展望台。
 * どれも遠くからシルエットで判別できる高さと形を持たせている。
 */

import {
  box, beveledBox, cylinder, lathe, sphere, torus, extrude, insetPolygon, gableRoof,
  curvedRoof, stairs, tube, faceted, deform,
} from '../gfx/geo.js';
import { stoneRim, bench } from './buildingKit.js';
import { PALETTE } from './buildings.js';
import { TAU, clamp } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';

/**
 * Nova の泉。中央広場の主役。
 * 三段の水盤の上に浮かぶ Nova クリスタルが、夜は町の光源になる。
 */
export function novaFountain(mb, mats, opts = {}) {
  const { radius = 4.6 } = opts;
  const stone = PALETTE.stoneWarm;

  // 石畳の台座（八角）
  const oct = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    oct.push([Math.cos(a) * (radius + 2.4), Math.sin(a) * (radius + 2.4)]);
  }
  mb.add(extrude(oct, -0.3, 0.16, { cap: true, uvScale: 0.9 }), mats.cobble,
    { color: [0.98, 0.97, 0.94], ao: 0.85 });
  mb.add(extrude(insetPolygon(oct, 0.35), 0.16, 0.3, { cap: true }), mats.stone,
    { color: stone, ao: 0.92 });

  // 外周の縁石と水盤
  stoneRim(mb, mats.stone, radius, 0.62, 0.42, stone);
  // 水盤の底
  mb.at(0, 0.12, 0);
  mb.add(cylinder(radius - 0.42, radius - 0.42, 0.08, 36), mats.stone,
    { color: stone.map((v) => v * 0.82), ao: 0.55 });
  mb.pop();

  // 中央の柱（回転体）
  mb.add(lathe([
    [1.5, 0.2], [1.55, 0.35], [1.3, 0.5], [1.15, 0.62],
    [0.78, 0.76], [0.62, 1.0], [0.58, 1.5], [0.66, 1.75],
    [0.92, 1.9], [1.0, 1.98],
  ], 28, { capBottom: true }), mats.stone, {
    color: stone, ao: (p) => clamp(0.6 + p[1] * 0.2, 0.6, 1)
  });

  // 二段目の水盤
  mb.at(0, 1.98, 0);
  mb.add(lathe([
    [0.55, 0], [2.1, 0.06], [2.25, 0.22], [2.3, 0.42],
    [2.12, 0.46], [2.05, 0.3], [1.9, 0.18], [0.5, 0.14],
  ], 28), mats.stone, { color: stone, ao: (p) => clamp(0.72 + p[1] * 0.2, 0.72, 1) });
  mb.pop();

  // 三段目
  mb.at(0, 2.44, 0);
  mb.add(lathe([[0.44, 0], [0.4, 0.5], [0.5, 0.9]], 20), mats.stone, { color: stone, ao: 0.9 });
  mb.at(0, 0.9, 0);
  mb.add(lathe([
    [0.3, 0], [1.25, 0.05], [1.35, 0.18], [1.38, 0.32],
    [1.24, 0.35], [1.18, 0.22], [1.05, 0.12], [0.28, 0.1],
  ], 24), mats.stone, { color: stone, ao: 0.95 });
  mb.pop();
  mb.pop();

  // 支える 4 体の小さなアストラ像（水を吐く）
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const r = 1.62;
    mb.at(Math.cos(a) * r, 0.62, Math.sin(a) * r, -a + Math.PI / 2, 0.55, 0.55, 0.55);
    // 座った獣のシルエット
    mb.add(sphere(0.5, 12, 9, { yScale: 0.85 }), mats.stone, { color: stone.map((v) => v * 0.96), ao: 0.8 });
    mb.at(0, 0.52, 0.2);
    mb.add(sphere(0.33, 12, 9, { yScale: 0.95 }), mats.stone, { color: stone, ao: 0.9 });
    for (const side of [-1, 1]) {
      mb.atFull(side * 0.18, 0.3, -0.02, 0, 0, side * 0.5);
      mb.add(cylinder(0.09, 0.02, 0.3, 7), mats.stone, { color: stone, ao: 0.95 });
      mb.pop();
    }
    mb.pop();
    // 尻尾
    const tail = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      tail.push([0, 0.2 + t * 0.55, -0.4 - t * 0.35 + Math.sin(t * 2.4) * 0.15]);
    }
    mb.add(tube(tail, (t) => 0.1 * (1 - t * 0.75), 6), mats.stone, { color: stone, ao: 0.9 });
    mb.pop();
  }

  // 浮かぶ Nova クリスタル
  const crystalY = 4.25;
  mb.at(0, crystalY, 0);
  const shard = faceted(deform(sphere(0.62, 8, 6, { yScale: 1.65 }), (p) => {
    const k = 1 + Math.sin(p[1] * 4.2) * 0.16;
    return [p[0] * k, p[1], p[2] * k];
  }));
  mb.add(shard, mats.crystal, { color: PALETTE.novaGlow, ao: 1 });
  // 周回する小結晶
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    mb.atFull(Math.cos(a) * 1.05, Math.sin(a * 2) * 0.3, Math.sin(a) * 1.05, 0.4, a, 0.3, 0.22, 0.34, 0.22);
    mb.add(faceted(sphere(1, 6, 5, { yScale: 1.6 })), mats.crystal, { color: PALETTE.novaGlow, ao: 1 });
    mb.pop();
  }
  // 光の輪
  mb.add(torus(1.45, 0.035, 40, 6), mats.crystal, { color: PALETTE.cyan, ao: 1 });
  mb.atFull(0, 0, 0, 0.9, 0.4, 0);
  mb.add(torus(1.15, 0.028, 36, 6), mats.crystal, { color: PALETTE.cyan, ao: 1 });
  mb.pop();
  mb.pop();

  return {
    radius: radius + 0.5,
    waterLevel: 0.42,
    upperBasins: [
      { x: 0, y: 2.42, z: 0, r: 2.05 },
      { x: 0, y: 3.44, z: 0, r: 1.2 },
    ],
    crystal: [0, crystalY, 0],
    spouts: [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * TAU + Math.PI / 4;
      return [Math.cos(a) * 1.62, 1.4, Math.sin(a) * 1.62];
    })
  };
}

/** 石造りのアーチ橋。 */
export function stoneBridge(mb, mats, span = 16, width = 6, rise = 1.6) {
  const stone = PALETTE.stoneWarm;
  const segs = 16;
  // 桁（アーチの上に載る路面）
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const z0 = (t0 - 0.5) * span, z1 = (t1 - 0.5) * span;
    const y0 = Math.sin(t0 * Math.PI) * rise, y1 = Math.sin(t1 * Math.PI) * rise;
    const cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const len = Math.hypot(z1 - z0, y1 - y0);
    const ang = Math.atan2(y1 - y0, z1 - z0);
    mb.atFull(0, cy, cz, ang, 0, 0);
    mb.add(box(width, 0.34, len * 1.02, { uvScale: 1 }), mats.cobble,
      { color: [0.98, 0.97, 0.95], ao: 0.92 });
    mb.at(0, -0.3, 0);
    mb.add(box(width * 0.96, 0.3, len * 1.02), mats.stone, { color: stone.map((v) => v * 0.9), ao: 0.6 });
    mb.pop();
    mb.pop();
  }
  // アーチ（下から支える）
  for (const side of [-1, 1]) {
    for (let i = 0; i < segs; i++) {
      const t = (i + 0.5) / segs;
      const z = (t - 0.5) * span;
      const yTop = Math.sin(t * Math.PI) * rise - 0.6;
      const arch = Math.sin(t * Math.PI) * (rise + 2.6) - 2.6;
      const h = Math.max(0.2, yTop - arch);
      mb.at(side * (width / 2 - 0.3), arch + h / 2, z);
      mb.add(box(0.6, h, span / segs * 1.05), mats.stone, {
        color: stone.map((v) => v * (0.9 + hash2(i, side, 4) * 0.14)),
        ao: (p) => clamp(0.5 + (p[1] + 2.6) * 0.12, 0.5, 1)
      });
      mb.pop();
    }
  }
  // 欄干
  for (const side of [-1, 1]) {
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const z = (t - 0.5) * span;
      const y = Math.sin(t * Math.PI) * rise;
      if (i % 3 === 0) {
        mb.at(side * (width / 2 - 0.22), y + 0.55, z);
        mb.add(lathe([[0.13, 0], [0.09, 0.2], [0.12, 0.42], [0.08, 0.6], [0.14, 0.72]], 10), mats.stone,
          { color: stone, ao: 0.95 });
        mb.pop();
      }
    }
    mb.at(side * (width / 2 - 0.22), 0, 0);
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const z0 = (t0 - 0.5) * span, z1 = (t1 - 0.5) * span;
      const y0 = Math.sin(t0 * Math.PI) * rise + 0.88, y1 = Math.sin(t1 * Math.PI) * rise + 0.88;
      mb.atFull(0, (y0 + y1) / 2, (z0 + z1) / 2, Math.atan2(y1 - y0, z1 - z0), 0, 0);
      mb.add(beveledBox(0.34, 0.18, Math.hypot(z1 - z0, y1 - y0) * 1.02, 0.03), mats.stone,
        { color: stone, ao: 1 });
      mb.pop();
    }
    mb.pop();
  }
  // 親柱の灯
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      mb.at(side * (width / 2 - 0.22), 0.2, end * (span / 2 - 0.4));
      mb.add(beveledBox(0.42, 1.1, 0.42, 0.04), mats.stone, { color: stone, ao: 0.85 });
      mb.at(0, 0.72, 0);
      mb.add(lathe([[0.2, 0], [0.16, 0.12], [0.2, 0.34], [0.1, 0.42]], 10), mats.metalDark,
        { color: [0.3, 0.32, 0.36], ao: 1 });
      mb.at(0, 0.2, 0);
      mb.add(sphere(0.13, 10, 8, { yScale: 1.2 }), mats.lampGlow, { color: PALETTE.lampGlow, ao: 1 });
      mb.pop();
      mb.pop();
      mb.pop();
    }
  }
  return {
    lights: [-1, 1].flatMap((side) => [-1, 1].map((end) => [side * (width / 2 - 0.22), 1.15, end * (span / 2 - 0.4)]))
  };
}

/** 森の門。町の南端、フィールドへの出入口。 */
export function forestGate(mb, mats, opts = {}) {
  const { width = 9, height = 7 } = opts;
  const stone = [0.92, 0.94, 0.9];
  // 両脇の塔
  for (const side of [-1, 1]) {
    mb.at(side * width / 2, 0, 0);
    mb.add(lathe([
      [1.5, -0.4], [1.42, 0.3], [1.2, 0.5], [1.1, 3.0],
      [1.22, 3.2], [1.16, 4.4], [1.3, 4.6], [1.24, height],
    ], 14, { capBottom: true }), mats.stone, {
      color: stone, ao: (p) => clamp(0.5 + p[1] * 0.11, 0.5, 1)
    });
    // 銃眼つきの冠
    mb.at(0, height, 0);
    mb.add(cylinder(1.5, 1.5, 0.3, 14), mats.stone, { color: stone, ao: 0.95 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      mb.at(Math.cos(a) * 1.32, 0.48, Math.sin(a) * 1.32, -a);
      mb.add(beveledBox(0.5, 0.66, 0.36, 0.03), mats.stone, { color: stone, ao: 1 });
      mb.pop();
    }
    // 頂の Nova ランプ
    mb.at(0, 0.9, 0);
    mb.add(lathe([[0.36, 0], [0.28, 0.3], [0.34, 0.5], [0.1, 0.72]], 12), mats.metalDark,
      { color: [0.3, 0.33, 0.38], ao: 1 });
    mb.at(0, 0.3, 0);
    mb.add(sphere(0.26, 12, 9, { yScale: 1.3 }), mats.crystal, { color: PALETTE.novaGlow, ao: 1 });
    mb.pop();
    mb.pop();
    mb.pop();
    mb.pop();
  }
  // 渡り（アーチ）
  const arcSegs = 14;
  for (let i = 0; i <= arcSegs; i++) {
    const t = i / arcSegs;
    const x = (t - 0.5) * (width - 1.4);
    const y = 4.2 + Math.cos((t - 0.5) * Math.PI) * 1.0;
    mb.atFull(x, y, 0, 0, 0, -Math.sin((t - 0.5) * Math.PI) * 0.6);
    mb.add(beveledBox((width - 1.4) / arcSegs * 1.25, 0.8, 1.7, 0.04), mats.stone,
      { color: stone.map((v) => v * (0.94 + hash2(i, 2, 5) * 0.1)), ao: 0.9 });
    mb.pop();
  }
  // 楣（まぐさ）と看板
  mb.at(0, 5.9, 0);
  mb.add(beveledBox(width - 0.6, 0.5, 1.9, 0.05), mats.stone, { color: stone, ao: 0.98 });
  mb.pop();
  mb.at(0, 5.9, 0.98);
  mb.add(beveledBox(3.4, 0.85, 0.14, 0.03), mats.sign, { color: [0.9, 0.92, 0.95], ao: 1 });
  mb.at(0, 0, 0.1);
  mb.add(box(2.4, 0.3, 0.03), mats.crystal, { color: PALETTE.cyan, ao: 1 });
  mb.pop();
  mb.pop();
  // 扉（開いた状態）
  for (const side of [-1, 1]) {
    mb.at(side * (width / 2 - 1.5), 0, 0.6, side * 0.9);
    mb.add(beveledBox(3.0, 4.2, 0.18, 0.03), mats.woodDark, { color: [0.42, 0.3, 0.24], ao: 0.7 });
    for (let k = 0; k < 3; k++) {
      mb.at(0, 0.7 + k * 1.3, 0.11);
      mb.add(box(2.9, 0.16, 0.06), mats.metalDark, { color: [0.35, 0.36, 0.4], ao: 0.9 });
      mb.pop();
    }
    mb.pop();
  }
  return { lights: [-1, 1].map((s) => [s * width / 2, height + 1.2, 0]) };
}

/** 小さな社。丘の上や川の向こうに置く静かな場所。 */
export function smallShrine(mb, mats, opts = {}) {
  const { scale = 1 } = opts;
  const wood = [0.78, 0.34, 0.28];
  const stone = [0.93, 0.92, 0.88];
  mb.at(0, 0, 0, 0, scale, scale, scale);

  // 石段
  mb.at(0, 0, 2.6);
  mb.add(stairs(3.4, 0.7, 1.4, 4), mats.stone, { color: stone, ao: 0.8 });
  mb.pop();
  // 基壇
  mb.add(extrude([[-2.4, -2.2], [2.4, -2.2], [2.4, 2.2], [-2.4, 2.2]], -0.4, 0.72, { cap: true }),
    mats.stone, { color: stone, ao: 0.85 });
  // 柱
  for (const sx of [-1.7, 1.7]) {
    for (const sz of [-1.5, 1.5]) {
      mb.at(sx, 0.72, sz);
      mb.add(cylinder(0.16, 0.14, 2.3, 10), mats.wood, { color: wood, ao: (p) => clamp(0.6 + p[1] * 0.2, 0.6, 1) });
      mb.pop();
    }
  }
  // 壁と扉
  mb.at(0, 1.85, -1.5);
  mb.add(box(3.4, 2.26, 0.16), mats.wood, { color: [0.86, 0.8, 0.7], ao: 0.85 });
  mb.pop();
  for (const side of [-1, 1]) {
    mb.at(side * 1.7, 1.85, 0);
    mb.add(box(0.16, 2.26, 3.0), mats.wood, { color: [0.86, 0.8, 0.7], ao: 0.85 });
    mb.pop();
  }
  mb.at(0, 1.7, 1.5);
  mb.add(box(1.6, 1.95, 0.12), mats.woodDark, { color: [0.4, 0.28, 0.22], ao: 0.8 });
  mb.pop();
  // 反りのある屋根
  mb.at(0, 3.05, 0);
  mb.add(curvedRoof(4.6, 4.2, 1.5, 0.5, 8, { overhang: 0.8 }), mats.roofTile,
    { color: [0.62, 0.68, 0.78], ao: 0.95 });
  mb.at(0, 1.5, 0);
  mb.add(box(4.4, 0.22, 0.5), mats.metalDark, { color: [0.42, 0.44, 0.5], ao: 1 });
  mb.pop();
  mb.pop();
  // 鳥居のような門
  mb.at(0, 0, 4.6);
  for (const side of [-1, 1]) {
    mb.at(side * 1.5, 0, 0);
    mb.add(cylinder(0.18, 0.15, 3.0, 10), mats.wood, { color: wood, ao: (p) => clamp(0.55 + p[1] * 0.2, 0.55, 1) });
    mb.pop();
  }
  mb.at(0, 3.05, 0);
  mb.add(beveledBox(4.0, 0.24, 0.36, 0.04), mats.wood, { color: wood, ao: 1 });
  mb.pop();
  mb.at(0, 2.6, 0);
  mb.add(beveledBox(3.4, 0.16, 0.26, 0.03), mats.wood, { color: wood, ao: 1 });
  mb.pop();
  mb.pop();
  // 灯籠
  for (const side of [-1, 1]) {
    mb.at(side * 2.6, 0, 3.2);
    mb.add(lathe([[0.32, 0], [0.26, 0.3], [0.2, 0.55], [0.3, 0.7]], 8), mats.stone, { color: stone, ao: 0.8 });
    mb.at(0, 0.7, 0);
    mb.add(beveledBox(0.6, 0.6, 0.6, 0.04), mats.lampGlow, { color: PALETTE.lampGlow, ao: 1 });
    mb.at(0, 0.42, 0);
    mb.add(cylinder(0.55, 0.05, 0.36, 4, { caps: false, twist: Math.PI / 4 }), mats.stone, { color: stone, ao: 1 });
    mb.pop();
    mb.pop();
    mb.pop();
  }
  mb.pop();
  return { lights: [[-2.6 * scale, 1.1 * scale, 3.2 * scale], [2.6 * scale, 1.1 * scale, 3.2 * scale]] };
}

/** 展望台。丘の上から町全体が見える。 */
export function observationDeck(mb, mats, opts = {}) {
  const { radius = 4.2 } = opts;
  const stone = PALETTE.stoneWarm;
  mb.add(lathe([[radius + 0.4, -1.2], [radius + 0.3, -0.2], [radius, 0], [radius, 0.32], [0, 0.32]], 26,
    { capBottom: false }), mats.stone, { color: stone, ao: (p) => clamp(0.6 + p[1] * 0.3, 0.6, 1) });
  mb.at(0, 0.32, 0);
  mb.add(cylinder(radius - 0.05, radius - 0.05, 0.06, 26), mats.cobble, { color: [0.98, 0.97, 0.94], ao: 0.95 });
  mb.pop();
  // 手すり
  const posts = 16;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * TAU;
    if (a > Math.PI * 0.72 && a < Math.PI * 1.28) continue;  // 入口を開ける
    mb.at(Math.cos(a) * (radius - 0.25), 0.38, Math.sin(a) * (radius - 0.25));
    mb.add(cylinder(0.05, 0.045, 1.0, 8), mats.metalDark, { color: [0.28, 0.31, 0.36], ao: 0.9 });
    mb.pop();
  }
  for (let i = 0; i < posts * 2; i++) {
    const a0 = (i / (posts * 2)) * TAU, a1 = ((i + 1) / (posts * 2)) * TAU;
    if (a0 > Math.PI * 0.72 && a0 < Math.PI * 1.28) continue;
    const r = radius - 0.25;
    const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
    const x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
    for (const y of [1.34, 0.82]) {
      mb.atFull((x0 + x1) / 2, y, (z0 + z1) / 2, 0, -Math.atan2(z1 - z0, x1 - x0), 0);
      mb.add(box(Math.hypot(x1 - x0, z1 - z0) * 1.05, 0.07, 0.07), mats.metalDark,
        { color: [0.28, 0.31, 0.36], ao: 0.95 });
      mb.pop();
    }
  }
  // 望遠鏡
  mb.at(radius * 0.5, 0.38, -radius * 0.4);
  mb.add(cylinder(0.14, 0.1, 1.05, 10), mats.metalDark, { color: [0.3, 0.33, 0.4], ao: 0.9 });
  mb.atFull(0, 1.1, 0, -0.5, 0.8, 0);
  mb.add(cylinder(0.11, 0.08, 0.8, 10), mats.metal, { color: [0.6, 0.62, 0.66], ao: 1 });
  mb.at(0, 0.82, 0);
  mb.add(cylinder(0.09, 0.09, 0.12, 10), mats.glass, { color: [0.7, 0.85, 1.0], ao: 1 });
  mb.pop();
  mb.pop();
  mb.pop();
  // ベンチ 2 脚
  for (const side of [-1, 1]) {
    mb.at(side * radius * 0.55, 0.38, radius * 0.45, side > 0 ? -2.2 : 2.2);
    bench(mb, mats, 1.7, { woodColor: [0.6, 0.44, 0.32], metalColor: [0.28, 0.31, 0.36] });
    mb.pop();
  }
  return { radius: radius + 0.3 };
}

/** 市場の屋台。マーケットストリートに並べる。 */
export function marketStall(mb, mats, opts = {}) {
  const { width = 2.8, depth = 2.0, variant = 0, awningColor = [1, 1, 1] } = opts;
  const woodColor = [0.62, 0.45, 0.3];
  // 台
  mb.at(0, 0.9, 0);
  mb.add(beveledBox(width, 0.1, depth, 0.02), mats.wood, { color: woodColor, ao: 0.95 });
  mb.pop();
  mb.at(0, 0.45, -depth / 2 + 0.1);
  mb.add(box(width - 0.2, 0.9, 0.06), mats.wood, { color: woodColor.map((v) => v * 0.88), ao: 0.7 });
  mb.pop();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    mb.at(sx * (width / 2 - 0.1), 0.45, sz * (depth / 2 - 0.1));
    mb.add(box(0.09, 0.9, 0.09), mats.woodDark, { color: woodColor.map((v) => v * 0.7), ao: 0.6 });
    mb.pop();
  }
  // 支柱と天幕
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    mb.at(sx * (width / 2 - 0.05), 1.55, sz * (depth / 2 - 0.05));
    mb.add(cylinder(0.045, 0.04, 1.3, 8, { yOffset: -0.65 }), mats.woodDark,
      { color: woodColor.map((v) => v * 0.65), ao: 0.85 });
    mb.pop();
  }
  mb.at(0, 2.2, 0);
  mb.add(gableRoof(width + 0.5, depth + 0.6, 0.38, 0.18), mats.awning,
    { color: awningColor, ao: 0.95, windFromY: [0, 0.4, 0.25] });
  mb.pop();
  // 商品
  const goods = variant % 4;
  for (let i = 0; i < 6; i++) {
    const gx = (-0.5 + (i % 3) / 2.2) * width * 0.7;
    const gz = (Math.floor(i / 3) - 0.5) * depth * 0.35;
    if (goods === 0) {
      // 果物の山
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU;
        mb.at(gx + Math.cos(a) * 0.09, 1.0 + (k === 3 ? 0.1 : 0), gz + Math.sin(a) * 0.09);
        mb.add(sphere(0.085, 8, 6), mats.plaster, {
          color: [1.2, 0.6 + hash2(i, k, 3) * 0.5, 0.35], ao: 1
        });
        mb.pop();
      }
    } else if (goods === 1) {
      // 布のロール
      mb.atFull(gx, 1.02, gz, 0, hash2(i, 1, 4) * 0.6, Math.PI / 2);
      mb.add(cylinder(0.1, 0.1, 0.52, 10), mats.fabric, {
        color: [0.5 + hash2(i, 2, 4) * 0.7, 0.5 + hash2(i, 3, 4) * 0.6, 0.6 + hash2(i, 4, 4) * 0.5], ao: 1
      });
      mb.pop();
    } else if (goods === 2) {
      // 瓶
      mb.at(gx, 0.95, gz);
      mb.add(lathe([[0.06, 0], [0.075, 0.04], [0.07, 0.18], [0.03, 0.24], [0.032, 0.3]], 8, { capBottom: true }),
        mats.glass, { color: [0.5 + hash2(i, 5, 4) * 0.6, 0.8, 0.7], ao: 1 });
      mb.pop();
    } else {
      // 本と巻物
      mb.at(gx, 0.99, gz, hash2(i, 6, 4) * 0.4);
      mb.add(beveledBox(0.22, 0.06, 0.3, 0.01), mats.fabric, {
        color: [0.4 + hash2(i, 7, 4) * 0.6, 0.35, 0.5], ao: 1
      });
      mb.pop();
    }
  }
  return { collider: { w: width + 0.4, d: depth + 0.4 } };
}

/** 掲示板（町の説明を読ませる場所）。 */
export function noticeBoard(mb, mats) {
  for (const side of [-1, 1]) {
    mb.at(side * 0.75, 0.8, 0);
    mb.add(box(0.12, 1.6, 0.12), mats.woodDark, { color: [0.45, 0.32, 0.24], ao: 0.7 });
    mb.pop();
  }
  mb.at(0, 1.85, 0);
  mb.add(beveledBox(1.9, 1.2, 0.1, 0.02), mats.sign, { color: [0.92, 0.9, 0.86], ao: 0.95 });
  for (let i = 0; i < 3; i++) {
    mb.at((-0.5 + i * 0.5) * 1.2, (hash2(i, 1, 3) - 0.5) * 0.5, 0.07, (hash2(i, 2, 3) - 0.5) * 0.25);
    mb.add(box(0.42, 0.5, 0.01), mats.fabric, { color: [1.1, 1.08, 1.0], ao: 1 });
    mb.pop();
  }
  mb.at(0, 0.72, 0.14);
  mb.add(gableRoof(2.2, 0.5, 0.22, 0.1), mats.roofSlate, { color: [0.75, 0.8, 0.9], ao: 1 });
  mb.pop();
  mb.pop();
}
