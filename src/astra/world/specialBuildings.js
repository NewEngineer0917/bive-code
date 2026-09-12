/**
 * 町の顔になる建物。
 *
 * 一般の民家と同じ部品を使いつつ、寸法・素材・装飾を大きく変えて、
 * 遠くからでも「あれが研究所」「あれが診療所」と分かるようにする。
 */

import {
  box, beveledBox, cylinder, lathe, sphere, torus, extrude, insetPolygon, curvedRoof, stairs,
} from '../gfx/geo.js';
import {
  wallWithOpenings, windowUnit, doorUnit, cornice, chimney,
} from './buildingKit.js';
import { buildBuilding, PALETTE } from './buildings.js';
import { TAU, clamp } from '../core/math.js';

const rect = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];

/**
 * ノヴァ研究所。町でいちばん大きく、いちばん光る建物。
 * 石造の基壇に、ガラスとノヴァパネルの本体、中央にドームと結晶塔。
 */
export function buildResearchCenter(mb, mats) {
  const W = 24, D = 13.5, floorH = 3.6;
  const stone = [0.96, 0.96, 0.94];
  const lights = [];

  // 基壇と正面階段
  mb.add(extrude(rect(W + 3, D + 3), -1.4, 0.9, { cap: true, uvScale: 0.8 }), mats.stone,
    { color: stone, ao: (p) => clamp(0.6 + p[1] * 0.3, 0.6, 1) });
  mb.at(0, 0, D / 2 + 1.5);
  mb.add(stairs(9, 0.9, 2.6, 5), mats.stone, { color: [1.0, 0.99, 0.96], ao: 0.86 });
  mb.pop();
  // 階段脇の手すり壁
  for (const s of [-1, 1]) {
    mb.at(s * 4.9, 0.5, D / 2 + 2.8);
    mb.add(beveledBox(0.6, 1.1, 3.0, 0.05), mats.stone, { color: stone, ao: 0.8 });
    mb.at(0, 0.66, -1.2);
    mb.add(lathe([[0.34, 0], [0.28, 0.25], [0.34, 0.4], [0.1, 0.52]], 12), mats.metalDark,
      { color: [0.3, 0.34, 0.4], ao: 1 });
    mb.at(0, 0.26, 0);
    mb.add(sphere(0.2, 12, 9, { yScale: 1.25 }), mats.crystal, { color: PALETTE.novaGlow, ao: 1 });
    mb.pop();
    mb.pop();
    mb.pop();
    lights.push([s * 4.9, 2.3, -(D / 2 + 1.6), PALETTE.novaGlow, 4.4, 12]);
  }

  // 本体：3 層。1 階は石、2〜3 階はノヴァパネルとガラス
  const foot = rect(W, D);
  for (let f = 0; f < 3; f++) {
    const y0 = 0.9 + f * floorH;
    for (let e = 0; e < 4; e++) {
      const a = foot[e], b = foot[(e + 1) % 4];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      const angle = Math.atan2(dx, dz);
      const isFront = e === 2;
      const bays = Math.max(2, Math.round(length / 3.0));
      const openings = [];
      const step = length / bays;
      for (let i = 0; i < bays; i++) {
        const cx = step * (i + 0.5);
        if (isFront && f === 0 && Math.abs(cx - length / 2) < step * 0.9) continue;  // 玄関ぶん空ける
        openings.push({ x: cx - step * 0.34, y: f === 0 ? 1.1 : 0.55, w: step * 0.68, h: f === 0 ? 1.9 : 2.4 });
      }
      if (isFront && f === 0) openings.push({ x: length / 2 - 1.9, y: 0, w: 3.8, h: 3.0 });
      mb.at(a[0] + dx / 2, y0, a[1] + dz / 2, -angle + Math.PI / 2);
      wallWithOpenings(mb, f === 0 ? mats.marble : mats.techPanel, length, floorH, 0.4, openings, {
        color: f === 0 ? stone : [0.98, 1.0, 1.02], aoBottom: f === 0 ? 0.7 : 0.84
      });
      for (const o of openings) {
        const cx = o.x + o.w / 2;
        if (isFront && f === 0 && o.w > 3) {
          mb.at(cx - length / 2, 0, 0.2);
          doorUnit(mb, mats, 3.6, 3.0, 0.4, {
            doorColor: [0.3, 0.4, 0.52], frameColor: stone, twoLeaf: true, glassPanel: true, step: false
          });
          mb.pop();
          continue;
        }
        // 全面ガラスの窓
        mb.at(cx - length / 2, o.y + o.h / 2, 0.2);
        mb.add(box(o.w - 0.1, o.h - 0.1, 0.06), mats.window, { color: [0.92, 0.98, 1.05], ao: 1 });
        for (let k = 1; k < 3; k++) {
          mb.at(0, -o.h / 2 + (k / 3) * o.h, 0.06);
          mb.add(box(o.w, 0.07, 0.08), mats.metal, { color: [0.7, 0.74, 0.8], ao: 1 });
          mb.pop();
        }
        mb.add(box(0.08, o.h, 0.1), mats.metal, { color: [0.7, 0.74, 0.8], ao: 1 });
        mb.pop();
      }
      mb.pop();
    }
    if (f < 2) cornice(mb, mats.metal, foot, 0.9 + (f + 1) * floorH - 0.2, 0.2, 0.18, [0.78, 0.82, 0.88]);
  }
  cornice(mb, mats.stone, foot, 0.9 + 3 * floorH - 0.3, 0.34, 0.34, stone);

  // 屋上：中央ドームと結晶塔
  const roofY = 0.9 + 3 * floorH;
  mb.at(0, roofY, 0);
  mb.add(extrude(rect(W + 0.7, D + 0.7), 0, 0.3, { cap: true }), mats.stone, { color: stone, ao: 0.96 });
  // パラペット
  mb.add(extrude(rect(W + 0.7, D + 0.7), 0.3, 1.0, { cap: false }), mats.marble, { color: stone, ao: 0.9 });
  mb.add(extrude(insetPolygon(rect(W + 0.7, D + 0.7), 0.35), 0.3, 0.96, { cap: true }), mats.stone,
    { color: stone.map((v) => v * 0.94), ao: 0.7 });
  // ドーム
  mb.at(0, 0.3, 0);
  mb.add(cylinder(5.2, 5.0, 1.1, 24), mats.marble, { color: stone, ao: 0.95 });
  mb.at(0, 1.1, 0);
  mb.add(sphere(5.0, 26, 13, { yScale: 0.72, phiLength: Math.PI / 2 }), mats.metal,
    { color: [0.62, 0.72, 0.86], ao: 1 });
  // ドームの窓（帯）
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    mb.at(Math.cos(a) * 4.55, 0.9, Math.sin(a) * 4.55, -a);
    mb.add(box(1.0, 1.5, 0.2), mats.window, { color: [0.9, 0.98, 1.05], ao: 1 });
    mb.pop();
  }
  // 頂の結晶
  mb.at(0, 3.7, 0);
  mb.add(lathe([[0.9, 0], [0.7, 0.5], [0.42, 1.0], [0.1, 1.7]], 10), mats.crystal,
    { color: PALETTE.novaGlow, ao: 1 });
  mb.add(torus(1.5, 0.06, 30, 6), mats.crystal, { color: PALETTE.cyan, ao: 1 });
  mb.pop();
  mb.pop();
  mb.pop();
  lights.push([0, roofY + 5.4, 0, PALETTE.novaGlow, 8.0, 30]);

  // 両翼の塔
  for (const s of [-1, 1]) {
    mb.at(s * (W / 2 - 1.6), 0, 0);
    mb.add(cylinder(2.3, 2.15, 0.9 + 3 * floorH + 2.2, 16), mats.marble,
      { color: stone, ao: (p) => clamp(0.6 + p[1] * 0.04, 0.6, 1) });
    // 縦の発光ライン
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.4;
      mb.at(Math.cos(a) * 2.2, (0.9 + 3 * floorH) * 0.55, Math.sin(a) * 2.2, -a);
      mb.add(box(0.22, 0.9 + 3 * floorH - 2.2, 0.1), mats.crystal, { color: PALETTE.cyan, ao: 1 });
      mb.pop();
    }
    mb.at(0, 0.9 + 3 * floorH + 2.2, 0);
    mb.add(cylinder(2.6, 0.3, 2.6, 16, { caps: false }), mats.roofSlate, { color: [0.68, 0.74, 0.86], ao: 1 });
    mb.at(0, 2.6, 0);
    mb.add(sphere(0.42, 12, 9, { yScale: 1.4 }), mats.crystal, { color: PALETTE.novaGlow, ao: 1 });
    mb.pop();
    mb.pop();
    mb.pop();
    lights.push([s * (W / 2 - 1.6), 0.9 + 3 * floorH + 5.2, 0, PALETTE.novaGlow, 5.2, 16]);
  }

  // 正面の看板
  mb.at(0, 0.9 + 3 * floorH - 1.3, D / 2 + 0.3);
  mb.add(beveledBox(9, 1.2, 0.22, 0.04), mats.metalDark, { color: [0.22, 0.28, 0.38], ao: 1 });
  mb.at(0, 0, 0.16);
  mb.add(box(7.4, 0.42, 0.04), mats.crystal, { color: PALETTE.cyan, ao: 1 });
  mb.pop();
  mb.pop();

  // 前庭のノヴァ柱
  for (const s of [-1, 1]) {
    mb.at(s * 8.5, 0.9, D / 2 + 3.4);
    mb.add(lathe([[0.7, 0], [0.62, 0.3], [0.42, 1.4], [0.5, 2.6], [0.38, 3.0]], 14, { capBottom: true }),
      mats.marble, { color: stone, ao: (p) => clamp(0.6 + p[1] * 0.15, 0.6, 1) });
    mb.at(0, 3.0, 0);
    mb.add(sphere(0.5, 14, 10, { yScale: 1.5 }), mats.crystal, { color: PALETTE.novaGlow, ao: 1 });
    mb.pop();
    mb.pop();
    lights.push([s * 8.5, 4.6, -(D / 2 + 3.4), PALETTE.novaGlow, 4.8, 14]);
  }

  return { lights, height: 0.9 + 3 * floorH + 8 };
}

/** アストラ診療所。白と緑、丸い屋根、外にアストラの休息場。 */
export function buildClinic(mb, mats) {
  const W = 12, D = 10.5, floorH = 3.3;
  const wall = [1.02, 1.04, 1.0];

  mb.add(extrude(rect(W + 1.2, D + 1.2), -0.8, 0.4, { cap: true }), mats.stone,
    { color: [0.95, 0.95, 0.92], ao: 0.7 });

  const foot = rect(W, D);
  for (let f = 0; f < 2; f++) {
    const y0 = 0.4 + f * floorH;
    for (let e = 0; e < 4; e++) {
      const a = foot[e], b = foot[(e + 1) % 4];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      const angle = Math.atan2(dx, dz);
      const isFront = e === 2;
      const openings = [];
      const bays = Math.max(2, Math.round(length / 2.8));
      const step = length / bays;
      for (let i = 0; i < bays; i++) {
        const cx = step * (i + 0.5);
        if (isFront && f === 0 && Math.abs(cx - length / 2) < step * 0.8) {
          openings.push({ x: length / 2 - 1.3, y: 0, w: 2.6, h: 2.6 });
          continue;
        }
        openings.push({ x: cx - 0.72, y: f === 0 ? 1.0 : 0.9, w: 1.44, h: 1.7 });
      }
      mb.at(a[0] + dx / 2, y0, a[1] + dz / 2, -angle + Math.PI / 2);
      wallWithOpenings(mb, mats.plaster, length, floorH, 0.34, openings, { color: wall, aoBottom: 0.74 });
      for (const o of openings) {
        const cx = o.x + o.w / 2;
        if (o.h > 2.4) {
          mb.at(cx - length / 2, 0, 0.17);
          doorUnit(mb, mats, 2.4, 2.6, 0.34, {
            doorColor: [0.75, 0.88, 0.84], frameColor: [0.98, 0.98, 0.95],
            arched: true, twoLeaf: true, glassPanel: true
          });
          mb.pop();
        } else {
          mb.at(cx - length / 2, o.y + o.h / 2, 0.17);
          windowUnit(mb, mats, o.w, o.h, 0.34, {
            frameColor: [0.98, 0.98, 0.96], arched: true,
            flowerBox: isFront && f === 1
          });
          mb.pop();
        }
      }
      mb.pop();
    }
    if (f === 0) cornice(mb, mats.stone, foot, 0.4 + floorH - 0.16, 0.16, 0.12, [0.98, 0.98, 0.95]);
  }
  cornice(mb, mats.stone, foot, 0.4 + 2 * floorH - 0.22, 0.22, 0.2, [0.98, 0.98, 0.95]);

  // 丸屋根
  mb.at(0, 0.4 + 2 * floorH, 0);
  mb.add(curvedRoof(W, D, 2.4, 0.5, 8, { overhang: 0.7 }), mats.roofSlate,
    { color: [0.6, 0.86, 0.78], ao: 0.95 });
  mb.at(0, 2.5, 0);
  mb.add(lathe([[0.5, 0], [0.4, 0.4], [0.2, 0.8]], 12), mats.metal, { color: [0.7, 0.9, 0.85], ao: 1 });
  mb.at(0, 0.8, 0);
  mb.add(sphere(0.3, 12, 9, { yScale: 1.3 }), mats.crystal, { color: [0.5, 1.0, 0.86], ao: 1 });
  mb.pop();
  mb.pop();
  mb.pop();

  // 玄関のガラス庇
  mb.at(0, 0.4 + 3.1, D / 2 + 0.1);
  mb.add(cylinder(2.6, 2.6, 0.14, 18, { arc: Math.PI, caps: true }), mats.glass,
    { color: [0.85, 1.0, 0.95], ao: 1 });
  for (const s of [-1, 1]) {
    mb.atFull(s * 2.2, -1.4, 0.4, 0.5, 0, 0);
    mb.add(cylinder(0.05, 0.04, 3.2, 8, { yOffset: -1.6 }), mats.metal, { color: [0.75, 0.85, 0.82], ao: 1 });
    mb.pop();
  }
  mb.pop();

  // 診療所の紋章（アストラの葉と十字）
  mb.at(0, 0.4 + 2 * floorH - 1.0, D / 2 + 0.25);
  mb.add(cylinder(1.15, 1.15, 0.16, 24), mats.plaster, { color: [1.05, 1.06, 1.02], ao: 1 });
  mb.at(0, 0, 0.12);
  mb.add(box(1.3, 0.32, 0.06), mats.crystal, { color: [0.45, 1.0, 0.8], ao: 1 });
  mb.add(box(0.32, 1.3, 0.06), mats.crystal, { color: [0.45, 1.0, 0.8], ao: 1 });
  mb.pop();
  mb.pop();

  // 外のアストラ休息場（柵と敷き藁とベッド）
  mb.at(-W / 2 - 3.6, 0, 1.5);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    if (a > 1.2 && a < 2.2) continue;
    mb.at(Math.cos(a) * 3.0, 0.5, Math.sin(a) * 3.0, -a);
    mb.add(beveledBox(0.09, 1.0, 0.09, 0.015), mats.wood, { color: [0.66, 0.5, 0.34], ao: 0.8 });
    mb.pop();
  }
  for (const y of [0.42, 0.78]) {
    mb.add(torus(3.0, 0.04, 26, 5), mats.wood, { color: [0.66, 0.5, 0.34], ao: 0.9 });
    mb.at(0, y, 0);
    mb.pop();
  }
  mb.at(0, 0.06, 0);
  mb.add(cylinder(2.6, 2.6, 0.12, 20), mats.awning, { color: [1.0, 0.9, 0.6], ao: 0.8 });
  mb.pop();
  mb.at(0.6, 0.2, -0.4);
  mb.add(lathe([[1.0, 0], [1.1, 0.1], [1.05, 0.26], [0.8, 0.3], [0.85, 0.1]], 16), mats.fabric,
    { color: [0.75, 0.85, 0.95], ao: 0.95 });
  mb.pop();
  mb.pop();

  return { height: 0.4 + 2 * floorH + 3.5 };
}

/** 道具屋。大きなショーウィンドウと日除け、看板。 */
export function buildItemShop(mb, mats) {
  const W = 10, D = 9;
  const colors = {
    wall: [1.02, 0.95, 0.84], roof: [1.0, 0.82, 0.74],
    trim: [0.4, 0.34, 0.5], stone: [0.98, 0.95, 0.9], door: [0.38, 0.26, 0.2]
  };
  const r = buildBuilding(mb, mats, {
    w: W, d: D, floors: 2, floorHeight: 3.2, roof: 'gable', style: 'timber', seed: 7,
    colors, bayWidth: 3.2,
    details: {
      shutters: true, flowerBoxes: true, dormers: 1, shopFront: true,
      awning: true, awningColor: [0.92, 0.55, 0.45], sign: true, signColor: [1.0, 0.8, 0.4],
      wallLantern: true, downspout: true, wideDoor: true, balcony: false
    }
  });
  // ショーウィンドウ（1 階の正面を大きなガラスに）
  mb.at(-W * 0.3, 1.9, D / 2 + 0.02);
  mb.add(box(2.4, 1.9, 0.1), mats.window, { color: [0.95, 0.95, 1.0], ao: 1 });
  mb.add(box(2.6, 0.12, 0.16), mats.wood, { color: colors.trim, ao: 1 });
  mb.at(0, 0.95, 0);
  mb.add(box(2.6, 0.12, 0.16), mats.wood, { color: colors.trim, ao: 1 });
  mb.pop();
  mb.at(0, -0.95, 0.06);
  mb.add(beveledBox(2.7, 0.16, 0.4, 0.03), mats.wood, { color: colors.trim, ao: 0.9 });
  mb.pop();
  // ウィンドウの中の商品
  for (let i = 0; i < 3; i++) {
    mb.at((i - 1) * 0.7, -0.6, -0.25);
    mb.add(lathe([[0.08, 0], [0.1, 0.04], [0.09, 0.2], [0.04, 0.26], [0.045, 0.32]], 8, { capBottom: true }),
      mats.glass, { color: [0.5 + i * 0.25, 0.9 - i * 0.2, 0.6 + i * 0.15], ao: 1 });
    mb.pop();
  }
  mb.pop();
  return r;
}

/** カフェ。暖色、テラス、煙突。 */
export function buildCafe(mb, mats) {
  const r = buildBuilding(mb, mats, {
    w: 9.5, d: 8.5, floors: 2, floorHeight: 3.0, roof: 'hip', style: 'plaster', seed: 23,
    colors: {
      wall: [1.04, 0.92, 0.8], roof: [0.95, 0.8, 0.72], trim: [0.5, 0.36, 0.28],
      stone: [1.0, 0.97, 0.92], door: [0.5, 0.32, 0.22]
    },
    details: {
      shutters: true, flowerBoxes: true, awning: true, awningColor: [1.0, 0.82, 0.55],
      sign: true, signColor: [1.0, 0.7, 0.35], wallLantern: true, downspout: true, balcony: true
    }
  });
  // 屋根に小さな煙突をもう 1 本
  mb.at(-2.6, 6.2, 1.6);
  chimney(mb, mats, 0.5, 1.3, [1.0, 0.96, 0.9]);
  mb.pop();
  return r;
}
