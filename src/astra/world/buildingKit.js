/**
 * モジュラー建築キット。
 *
 * 建物は「箱を置いたもの」ではなく、
 *   基礎 → 壁（開口つき）→ 胴蛇腹 → 窓 → 扉 → 屋根 → 軒 → 付属物
 * の部品を積み上げて作る。同じ部品を違う寸法・色・組み合わせで使うので、
 * 統一感を保ったまま家ごとの違いが出せる。
 *
 * ローカル座標は「足元中央が原点、+Z が正面」。
 */

import {
  box, beveledBox, cylinder, lathe, gableRoof, extrude, insetPolygon, sphere, tube,
  crossBillboard,
} from '../gfx/geo.js';
import { TAU, clamp } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';

/* ------------------------------------------------------------ 壁 */

/**
 * 開口（窓・扉）を持つ壁を、格子に切り分けた板の集合として作る。
 * openings: [{ x, y, w, h }]（壁の左下が原点の座標系）
 */
export function wallWithOpenings(mb, mat, width, height, thickness, openings, opts = {}) {
  const { color = [1, 1, 1], ao = 1, uvScale = 1, aoBottom = 0.55 } = opts;
  const xsSet = new Set([0, width]);
  const ysSet = new Set([0, height]);
  for (const o of openings) {
    xsSet.add(clamp(o.x, 0, width));
    xsSet.add(clamp(o.x + o.w, 0, width));
    ysSet.add(clamp(o.y, 0, height));
    ysSet.add(clamp(o.y + o.h, 0, height));
  }
  const xs = [...xsSet].sort((a, b) => a - b);
  const ys = [...ysSet].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (openings.some((o) => cx > o.x && cx < o.x + o.w && cy > o.y && cy < o.y + o.h)) continue;
      const w = x1 - x0, h = y1 - y0;
      if (w < 0.01 || h < 0.01) continue;
      mb.at(x0 + w / 2 - width / 2, y0 + h / 2, 0);
      mb.add(box(w, h, thickness, { uvScale }), mat, {
        color,
        ao: (p) => ao * clamp(aoBottom + (p[1]) * 0.35, aoBottom, 1)
      });
      mb.pop();
    }
  }
}

/** 窓一式：枠・桟・ガラス・窓台・（任意で）鎧戸と花箱。 */
export function windowUnit(mb, mats, w, h, depth, opts = {}) {
  const {
    frameColor = [0.92, 0.9, 0.84], shutters = false, shutterColor = [0.35, 0.45, 0.55],
    flowerBox = false, sill = true, arched = false, mullions = true, glassTint = [1, 1, 1]
  } = opts;
  const fw = 0.09;                       // 枠の太さ
  // 枠（4 辺）
  const frames = [
    [0, h / 2 - fw / 2, w, fw], [0, -h / 2 + fw / 2, w, fw],
    [-w / 2 + fw / 2, 0, fw, h - fw * 2], [w / 2 - fw / 2, 0, fw, h - fw * 2],
  ];
  for (const [fx, fy, fwx, fhy] of frames) {
    mb.at(fx, fy, depth * 0.42);
    mb.add(beveledBox(fwx, fhy, depth * 0.5, 0.018), mats.wood, { color: frameColor, ao: 0.9 });
    mb.pop();
  }
  // ガラス（少し奥に落とす）
  mb.at(0, 0, depth * 0.12);
  mb.add(box(w - fw * 1.7, h - fw * 1.7, 0.04), mats.window, { color: glassTint, ao: 1 });
  mb.pop();
  // 桟
  if (mullions) {
    mb.at(0, 0, depth * 0.3);
    mb.add(box(0.045, h - fw * 2, depth * 0.35), mats.wood, { color: frameColor, ao: 0.95 });
    mb.pop();
    mb.at(0, h * 0.06, depth * 0.3);
    mb.add(box(w - fw * 2, 0.045, depth * 0.35), mats.wood, { color: frameColor, ao: 0.95 });
    mb.pop();
  }
  // アーチ窓の上飾り
  if (arched) {
    mb.atFull(0, h / 2, depth * 0.4, 0, 0, 0, 1, 1, 1);
    mb.add(cylinder(w * 0.52, w * 0.52, depth * 0.5, 14, { arc: Math.PI, caps: false }), mats.stone,
      { color: frameColor, ao: 0.9 });
    mb.pop();
  }
  // 窓台
  if (sill) {
    mb.at(0, -h / 2 - 0.06, depth * 0.62);
    mb.add(beveledBox(w + 0.22, 0.1, depth * 1.35, 0.025), mats.stone, { color: [0.95, 0.93, 0.88], ao: 0.95 });
    mb.pop();
  }
  // 鎧戸
  if (shutters) {
    for (const side of [-1, 1]) {
      mb.atFull(side * (w / 2 + w * 0.26), 0, depth * 0.75, 0, side * -0.28, 0);
      mb.add(beveledBox(w * 0.5, h * 0.96, 0.05, 0.012), mats.wood, { color: shutterColor, ao: 0.88 });
      for (let k = 0; k < 5; k++) {
        mb.at(0, -h * 0.38 + k * h * 0.19, 0.035);
        mb.add(box(w * 0.44, 0.035, 0.02), mats.wood, { color: shutterColor.map((c) => c * 0.82), ao: 0.85 });
        mb.pop();
      }
      mb.pop();
    }
  }
  // 花箱
  if (flowerBox) {
    mb.at(0, -h / 2 - 0.2, depth * 0.95);
    mb.add(beveledBox(w * 0.92, 0.2, 0.22, 0.02), mats.wood, { color: [0.55, 0.4, 0.3], ao: 0.8 });
    mb.pop();
    for (let k = 0; k < 4; k++) {
      const fx = (-0.5 + k / 3) * w * 0.7;
      mb.at(fx, -h / 2 - 0.06, depth * 0.95, hash2(k, 3, 9) * TAU, 0.26, 0.26, 0.26);
      mb.add(crossBillboard(1.0, 1.1, 2, { taper: 0.2, rows: 2 }), mats.flowers, {
        color: [1, 1, 1], ao: 0.95, windFromY: [0, 1.1, 0.5]
      });
      mb.pop();
    }
  }
}

/** 扉一式：枠・扉板・金具・踏み段。 */
export function doorUnit(mb, mats, w, h, depth, opts = {}) {
  const {
    doorColor = [0.45, 0.3, 0.22], frameColor = [0.9, 0.88, 0.82],
    arched = false, step = true, twoLeaf: dbl = false, glassPanel = false, handleColor = [0.85, 0.72, 0.4]
  } = opts;
  const fw = 0.12;
  for (const [fx, fy, fwx, fhy] of [
    [-w / 2 - fw / 2, h / 2, fw, h], [w / 2 + fw / 2, h / 2, fw, h], [0, h + fw / 2, w + fw * 2, fw],
  ]) {
    mb.at(fx, fy, depth * 0.45);
    mb.add(beveledBox(fwx, fhy, depth * 0.55, 0.02), mats.stone, { color: frameColor, ao: 0.92 });
    mb.pop();
  }
  const leaves = dbl ? 2 : 1;
  for (let i = 0; i < leaves; i++) {
    const lw = w / leaves - 0.02;
    const lx = dbl ? (i - 0.5) * (w / 2) : 0;
    mb.at(lx, h / 2, depth * 0.2);
    mb.add(beveledBox(lw, h - 0.03, 0.09, 0.015), mats.wood, { color: doorColor, ao: 0.85 });
    // 鏡板
    for (let k = 0; k < 2; k++) {
      mb.at(0, -h * 0.18 + k * h * 0.36, 0.055);
      mb.add(beveledBox(lw * 0.66, h * 0.28, 0.02, 0.012), mats.wood,
        { color: doorColor.map((c) => c * 1.18), ao: 0.9 });
      mb.pop();
    }
    mb.pop();
  }
  if (glassPanel) {
    mb.at(0, h * 0.74, depth * 0.26);
    mb.add(box(w * 0.55, h * 0.2, 0.03), mats.window, { color: [1, 1, 1], ao: 1 });
    mb.pop();
  }
  // 取っ手
  mb.at(dbl ? -0.1 : w * 0.33, h * 0.47, depth * 0.28);
  mb.add(sphere(0.05, 10, 8), mats.metal, { color: handleColor, ao: 1 });
  mb.pop();
  if (arched) {
    mb.at(0, h, depth * 0.42);
    mb.add(cylinder(w * 0.56, w * 0.56, depth * 0.5, 16, { arc: Math.PI, caps: false }), mats.stone,
      { color: frameColor, ao: 0.9 });
    mb.pop();
  }
  if (step) {
    mb.at(0, 0.06, depth * 0.75);
    mb.add(beveledBox(w + 0.7, 0.12, 0.85, 0.03), mats.stone, { color: [0.92, 0.9, 0.85], ao: 0.8 });
    mb.pop();
    mb.at(0, 0.17, depth * 0.62);
    mb.add(beveledBox(w + 0.35, 0.12, 0.55, 0.03), mats.stone, { color: [0.95, 0.93, 0.88], ao: 0.85 });
    mb.pop();
  }
}

/** 胴蛇腹（階の切れ目に回す帯）。建物が「のっぺりした箱」に見えなくなる。 */
export function cornice(mb, mat, footprint, y, thickness = 0.16, overhang = 0.14, color = [1, 1, 1]) {
  const outer = footprint.map(([x, z]) => [x, z]);
  const expanded = insetPolygon(outer, -overhang);
  mb.add(extrude(expanded, y, y + thickness, { uvScale: 1, cap: false }), mat, { color, ao: 0.92 });
  const slope = insetPolygon(outer, -overhang * 0.4);
  mb.add(extrude(slope, y + thickness, y + thickness + 0.07, { cap: true }), mat, { color, ao: 0.98 });
}

/** 煙突。 */
export function chimney(mb, mats, w = 0.7, h = 1.8, color = [0.85, 0.78, 0.7]) {
  mb.add(beveledBox(w, h, w * 0.8, 0.03), mats.stone, {
    color, ao: (p) => clamp(0.6 + p[1] * 0.2, 0.6, 1)
  });
  mb.at(0, h / 2 + 0.08, 0);
  mb.add(beveledBox(w * 1.3, 0.16, w * 1.05, 0.03), mats.stone, { color, ao: 1 });
  mb.pop();
  for (const dx of [-w * 0.22, w * 0.22]) {
    mb.at(dx, h / 2 + 0.28, 0);
    mb.add(cylinder(0.09, 0.1, 0.3, 10), mats.metalDark, { color: [0.5, 0.5, 0.52], ao: 1 });
    mb.pop();
  }
}

/** 屋根窓（ドーマー）。屋根に変化をつける。 */
export function dormer(mb, mats, w, h, depth, colors) {
  mb.add(box(w, h, depth), mats.plaster, { color: colors.wall, ao: 0.9 });
  mb.at(0, h * 0.55, depth * 0.5);
  windowUnit(mb, mats, w * 0.6, h * 0.62, 0.16, { frameColor: colors.trim, sill: true });
  mb.pop();
  mb.at(0, h / 2 + 0.02, 0);
  mb.add(gableRoof(w + 0.28, depth + 0.3, 0.42, 0.06), mats.roofTile, { color: colors.roof, ao: 1 });
  mb.pop();
}

/** バルコニー（手すり付き）。 */
export function balcony(mb, mats, w, depth, colors) {
  mb.add(beveledBox(w, 0.12, depth, 0.02), mats.stone, { color: colors.trim, ao: 0.85 });
  // 持ち送り
  for (const dx of [-w * 0.38, 0, w * 0.38]) {
    mb.atFull(dx, -0.18, depth * 0.3, 0.5, 0, 0);
    mb.add(beveledBox(0.1, 0.34, 0.3, 0.02), mats.stone, { color: colors.trim, ao: 0.7 });
    mb.pop();
  }
  // 手すり
  const railY = 0.5;
  mb.at(0, railY, depth / 2 - 0.05);
  mb.add(box(w, 0.06, 0.07), mats.metalDark, { color: colors.metal, ao: 1 });
  mb.pop();
  for (const side of [-1, 1]) {
    mb.at(side * (w / 2 - 0.03), railY / 2, depth / 2 - 0.05);
    mb.add(box(0.05, railY, 0.05), mats.metalDark, { color: colors.metal, ao: 0.95 });
    mb.pop();
  }
  const bars = Math.max(3, Math.floor(w / 0.24));
  for (let i = 1; i < bars; i++) {
    const x = (-0.5 + i / bars) * w;
    mb.at(x, railY / 2, depth / 2 - 0.05);
    mb.add(cylinder(0.016, 0.016, railY, 6, { yOffset: -railY / 2 }), mats.metalDark, { color: colors.metal, ao: 0.95 });
    mb.pop();
  }
  for (const side of [-1, 1]) {
    mb.at(side * (w / 2 - 0.03), railY / 2, 0);
    mb.add(box(0.05, railY, depth - 0.1), mats.metalDark, { color: colors.metal, ao: 0.9 });
    mb.pop();
  }
}

/** 日除け（布のテント）。市場と店の前に。 */
export function awning(mb, mats, w, depth, opts = {}) {
  const { color = [1, 1, 1], drop = 0.5, segments = 8 } = opts;
  const geo = { positions: [], normals: [], uvs: [], indices: [] };
  for (let j = 0; j <= 3; j++) {
    const t = j / 3;
    const z = t * depth;
    const y = -Math.pow(t, 1.6) * drop;
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      // 波打つ縁
      const ripple = Math.sin(u * Math.PI * segments * 0.5) * 0.035 * t;
      geo.positions.push((u - 0.5) * w, y + ripple, z);
      geo.normals.push(0, 1, -0.35);
      geo.uvs.push(u * w * 0.6, t * depth * 0.6);
    }
  }
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1;
      geo.indices.push(a, c, b, b, c, d, a, b, c, b, d, c);
    }
  }
  mb.add(geo, mats.awning, { color, ao: 0.95, windFromY: [-drop, 0.1, 0.35] });
  // 縁の波飾り
  for (let i = 0; i < segments; i++) {
    const u = (i + 0.5) / segments;
    mb.at((u - 0.5) * w, -drop - 0.07, depth);
    mb.add(box(w / segments * 0.85, 0.14, 0.02), mats.awning, { color, ao: 0.88, wind: 0.3 });
    mb.pop();
  }
  // 支柱
  for (const side of [-1, 1]) {
    mb.atFull(side * w * 0.46, -drop * 0.5, depth * 0.5, -0.55, 0, 0);
    mb.add(cylinder(0.03, 0.03, depth * 1.05, 6), mats.metalDark, { color: [0.4, 0.4, 0.42], ao: 0.9 });
    mb.pop();
  }
}

/** 看板（吊り下げ／壁付け）。 */
export function shopSign(mb, mats, w, h, opts = {}) {
  const { hanging = true, color = [1, 1, 1], iconColor = [0.4, 0.9, 1.0], armLength = 0.8 } = opts;
  if (hanging) {
    mb.at(-armLength / 2, 0.35, 0);
    mb.add(cylinder(0.035, 0.035, armLength, 8, { arc: TAU }), mats.metalDark, { color: [0.35, 0.35, 0.38], ao: 1 });
    mb.pop();
    mb.atFull(-armLength / 2, 0.35, 0, 0, 0, Math.PI / 2);
    mb.add(cylinder(0.03, 0.03, armLength, 8), mats.metalDark, { color: [0.35, 0.35, 0.38], ao: 1 });
    mb.pop();
    for (const dx of [-w * 0.3, w * 0.3]) {
      mb.at(dx - armLength, 0.18, 0);
      mb.add(cylinder(0.012, 0.012, 0.34, 6, { yOffset: -0.17 }), mats.metalDark, { color: [0.4, 0.4, 0.42], ao: 1 });
      mb.pop();
    }
    mb.at(-armLength, -h / 2, 0);
    mb.add(beveledBox(w, h, 0.07, 0.02), mats.sign, { color, ao: 0.95 });
    mb.at(0, 0, 0.05);
    mb.add(box(w * 0.42, h * 0.42, 0.02), mats.crystal, { color: iconColor, ao: 1 });
    mb.pop();
    mb.pop();
  } else {
    mb.add(beveledBox(w, h, 0.1, 0.025), mats.sign, { color, ao: 0.95 });
    mb.at(0, 0, 0.07);
    mb.add(box(w * 0.5, h * 0.36, 0.02), mats.crystal, { color: iconColor, ao: 1 });
    mb.pop();
    // 上に小さな庇
    mb.at(0, h / 2 + 0.08, 0.12);
    mb.add(box(w + 0.2, 0.07, 0.32), mats.woodDark, { color: [0.5, 0.4, 0.32], ao: 0.9 });
    mb.pop();
  }
}

/** 街灯（Nova クリスタルの灯）。光源は別途 town が登録する。 */
export function streetLamp(mb, mats, height = 3.6, opts = {}) {
  const { crystalColor = [1.0, 0.82, 0.5], poleColor = [0.24, 0.26, 0.3], double = false } = opts;
  mb.add(lathe([[0.24, 0], [0.22, 0.1], [0.16, 0.18], [0.12, 0.3], [0.1, 0.5]], 12, { capBottom: true }),
    mats.stone, { color: [0.8, 0.78, 0.74], ao: 0.75 });
  mb.at(0, 0.5, 0);
  mb.add(cylinder(0.075, 0.055, height - 0.5, 10), mats.metalDark, {
    color: poleColor, ao: (p) => clamp(0.62 + p[1] * 0.09, 0.62, 1)
  });
  mb.pop();
  const arms = double ? [-1, 1] : [0];
  for (const dir of arms) {
    const ax = dir * 0.45;
    if (dir !== 0) {
      // 曲がった腕
      const path = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        path.push([dir * t * 0.55, height - 0.1 + Math.sin(t * Math.PI * 0.5) * 0.28, 0]);
      }
      mb.add(tube(path, 0.035, 6), mats.metalDark, { color: poleColor, ao: 1 });
    }
    const topY = dir === 0 ? height : height + 0.2;
    mb.at(ax, topY, 0);
    // 笠
    mb.add(lathe([[0.02, 0.42], [0.2, 0.3], [0.24, 0.22], [0.1, 0.2]], 12), mats.metalDark, { color: poleColor, ao: 1 });
    // ガラスの覆い
    mb.add(lathe([[0.1, 0.2], [0.17, 0.08], [0.15, -0.12], [0.06, -0.2]], 12), mats.glass,
      { color: [0.8, 0.85, 0.9], ao: 1 });
    // 中の結晶
    mb.at(0, -0.02, 0);
    mb.add(sphere(0.1, 10, 8, { yScale: 1.35 }), mats.lampGlow, { color: crystalColor, ao: 1 });
    mb.pop();
    mb.pop();
  }
  return { lightY: height + (double ? 0.18 : 0), armOffset: double ? 0.45 : 0 };
}

/** ベンチ。 */
export function bench(mb, mats, width = 1.8, opts = {}) {
  const { woodColor = [0.62, 0.44, 0.3], metalColor = [0.26, 0.3, 0.34], back = true } = opts;
  for (let i = 0; i < 3; i++) {
    mb.at(0, 0.44, -0.18 + i * 0.17);
    mb.add(beveledBox(width, 0.055, 0.14, 0.015), mats.wood, { color: woodColor, ao: 0.9 });
    mb.pop();
  }
  if (back) {
    for (let i = 0; i < 2; i++) {
      mb.atFull(0, 0.72 + i * 0.18, -0.26 - i * 0.05, 0.22, 0, 0);
      mb.add(beveledBox(width, 0.055, 0.13, 0.015), mats.wood, { color: woodColor, ao: 0.95 });
      mb.pop();
    }
  }
  for (const side of [-1, 1]) {
    const lx = side * (width / 2 - 0.12);
    // 脚（鋳物風の曲線）
    mb.at(lx, 0.22, 0.1);
    mb.add(beveledBox(0.07, 0.44, 0.07, 0.015), mats.metalDark, { color: metalColor, ao: 0.7 });
    mb.pop();
    mb.at(lx, 0.22, -0.22);
    mb.add(beveledBox(0.07, 0.44, 0.07, 0.015), mats.metalDark, { color: metalColor, ao: 0.7 });
    mb.pop();
    mb.at(lx, 0.42, -0.06);
    mb.add(box(0.06, 0.06, 0.42), mats.metalDark, { color: metalColor, ao: 0.85 });
    mb.pop();
    if (back) {
      mb.atFull(lx, 0.7, -0.3, 0.22, 0, 0);
      mb.add(box(0.06, 0.5, 0.06), mats.metalDark, { color: metalColor, ao: 0.9 });
      mb.pop();
    }
  }
}

/** 樽。 */
export function barrel(mb, mats, r = 0.32, h = 0.8, color = [0.58, 0.42, 0.28]) {
  const profile = [];
  const rows = 7;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const bulge = Math.sin(t * Math.PI) * 0.14;
    profile.push([r * (0.86 + bulge), t * h]);
  }
  mb.add(lathe(profile, 14, { capTop: true, capBottom: true }), mats.wood, {
    color, ao: (p) => clamp(0.6 + p[1] * 0.4, 0.6, 1)
  });
  for (const t of [0.18, 0.5, 0.82]) {
    const bulge = Math.sin(t * Math.PI) * 0.14;
    mb.at(0, t * h, 0);
    mb.add(cylinder(r * (0.88 + bulge), r * (0.88 + bulge), 0.06, 14, { yOffset: -0.03, caps: false }),
      mats.metalDark, { color: [0.34, 0.32, 0.3], ao: 0.95 });
    mb.pop();
  }
}

/** 木箱。 */
export function crate(mb, mats, size = 0.6, color = [0.62, 0.46, 0.3]) {
  mb.add(beveledBox(size, size * 0.92, size, size * 0.04), mats.wood, {
    color, ao: (p) => clamp(0.62 + p[1] * 0.5, 0.62, 1)
  });
  const f = size * 0.5 + 0.012;
  for (const [ax, az] of [[0, f], [0, -f], [f, 0], [-f, 0]]) {
    const ry = ax !== 0 ? Math.PI / 2 : 0;
    for (const y of [size * 0.26, size * 0.66]) {
      mb.at(ax, y, az, ry);
      mb.add(box(size * 0.94, size * 0.1, 0.02), mats.woodDark, { color: color.map((c) => c * 0.72), ao: 0.9 });
      mb.pop();
    }
    mb.at(ax, size * 0.46, az, ry);
    mb.add(box(size * 0.1, size * 0.86, 0.02), mats.woodDark, { color: color.map((c) => c * 0.72), ao: 0.9 });
    mb.pop();
  }
}

/** 植木鉢と花。 */
export function flowerPot(mb, mats, r = 0.28, opts = {}) {
  const { potColor = [0.72, 0.42, 0.3], plantScale = 1 } = opts;
  mb.add(lathe([[r * 0.72, 0], [r * 0.8, 0.06], [r * 0.92, 0.3], [r, 0.4], [r * 0.92, 0.42]], 14,
    { capBottom: true }), mats.stone, { color: potColor, ao: (p) => clamp(0.55 + p[1] * 0.9, 0.55, 1) });
  mb.at(0, 0.36, 0);
  mb.add(cylinder(r * 0.86, r * 0.86, 0.05, 14), mats.dirt, { color: [0.6, 0.5, 0.42], ao: 0.6 });
  mb.pop();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + r;
    mb.at(Math.cos(a) * r * 0.32, 0.38, Math.sin(a) * r * 0.32, a, plantScale * 0.42, plantScale * 0.5, plantScale * 0.42);
    mb.add(crossBillboard(1.1, 1.4, 2, { taper: 0.25, rows: 3, bend: 0.15 }), mats.flowers,
      { color: [1, 1, 1], ao: 0.95, windFromY: [0, 1.4, 0.75] });
    mb.pop();
  }
}

/** 提灯・ランタン（吊り下げ）。夜の光源になる。 */
export function lantern(mb, mats, opts = {}) {
  const { color = [1.0, 0.78, 0.42], size = 1, chain = 0.5 } = opts;
  mb.at(0, chain / 2, 0);
  mb.add(cylinder(0.012, 0.012, chain, 6, { yOffset: -chain / 2 }), mats.metalDark, { color: [0.4, 0.4, 0.42], ao: 1 });
  mb.pop();
  mb.at(0, 0, 0, 0, size, size, size);
  mb.add(lathe([[0.02, 0.2], [0.13, 0.12], [0.15, 0.0], [0.13, -0.12], [0.03, -0.19]], 10), mats.lampGlow,
    { color, ao: 1 });
  mb.add(lathe([[0.03, 0.22], [0.14, 0.15], [0.05, 0.16]], 10), mats.metalDark, { color: [0.3, 0.3, 0.33], ao: 1 });
  mb.add(lathe([[0.05, -0.2], [0.13, -0.16], [0.03, -0.23]], 10), mats.metalDark, { color: [0.3, 0.3, 0.33], ao: 1 });
  mb.pop();
}

/** 井戸・水飲み場・石の縁。 */
export function stoneRim(mb, mat, radius, height, thickness = 0.3, color = [0.9, 0.88, 0.82]) {
  mb.add(lathe([
    [radius - thickness, 0], [radius, 0],
    [radius + 0.04, height * 0.75], [radius, height],
    [radius - thickness, height], [radius - thickness - 0.03, height * 0.6],
  ], 30, { capBottom: false }), mat, {
    color, ao: (p) => clamp(0.55 + p[1] * 0.5, 0.55, 1)
  });
}
