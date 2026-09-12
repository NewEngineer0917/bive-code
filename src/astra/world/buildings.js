/**
 * 建物。
 *
 * 立方体は使わない。どの建物も
 *   基礎 → 各階の壁（窓・扉の開口つき）→ 胴蛇腹 → 屋根 → 付属物
 * という同じ組み立て方をするが、寸法・階数・素材・屋根形状・色・装飾を
 * 変えることで、統一感のある町並みの中に個性を作る。
 *
 * 返り値には当たり判定と入口の情報が入り、町がそのまま使う。
 */

import {
  box, cylinder, lathe, sphere, gableRoof, hipRoof, curvedRoof, extrude, insetPolygon,
} from '../gfx/geo.js';
import {
  wallWithOpenings, windowUnit, doorUnit, cornice, chimney, dormer, balcony, awning, shopSign,
  lantern,
} from './buildingKit.js';
import { clamp } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';

/** 町の配色。どの建物もここから色を取り、全体の色調を揃える。 */
export const PALETTE = {
  stoneWarm: [1.02, 0.98, 0.9],
  stoneCool: [0.92, 0.94, 0.98],
  plaster: [
    [1.05, 1.0, 0.92],   // 生成り
    [1.02, 0.96, 0.86],  // 砂色
    [0.94, 0.98, 1.0],   // 白藍
    [1.0, 0.92, 0.84],   // 桜みの白
    [0.9, 0.95, 0.92],   // 薄緑
  ],
  roof: [
    [1.0, 0.86, 0.82],   // 赤瓦
    [0.86, 0.9, 1.0],    // 青スレート
    [0.95, 0.82, 0.7],   // 茶瓦
    [0.78, 0.86, 0.86],  // 灰青
  ],
  trim: [
    [0.36, 0.42, 0.52],  // ネイビー
    [0.35, 0.5, 0.45],   // 深緑
    [0.6, 0.42, 0.32],   // 焦茶
    [0.82, 0.78, 0.72],  // 白木
  ],
  navy: [0.2, 0.28, 0.42],
  cyan: [0.35, 0.92, 1.0],
  novaGlow: [0.42, 0.95, 1.0],
  lampGlow: [1.0, 0.8, 0.48]
};

const rect = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];

/** 壁 1 面ぶんの開口（窓・扉）を決める。 */
function planOpenings(length, height, floorIndex, opts) {
  const { doorBay = -1, bayWidth = 2.6, windowW = 1.15, windowH = 1.4, doorW = 1.25, doorH = 2.15, seed = 0 } = opts;
  const bays = Math.max(1, Math.round(length / bayWidth));
  const step = length / bays;
  const openings = [];
  const meta = [];
  for (let i = 0; i < bays; i++) {
    const cx = step * (i + 0.5);
    if (floorIndex === 0 && i === doorBay) {
      openings.push({ x: cx - doorW / 2, y: 0, w: doorW, h: doorH });
      meta.push({ type: 'door', cx, w: doorW, h: doorH, y: 0 });
      continue;
    }
    if (step < 1.7) continue;
    const wy = floorIndex === 0 ? 1.0 : 0.95;
    // たまに窓を抜く（全部同じ顔にしない）
    if (hash2(i, floorIndex + seed, 13) < 0.12 && bays > 2) { meta.push({ type: 'none' }); continue; }
    openings.push({ x: cx - windowW / 2, y: wy, w: windowW, h: windowH });
    meta.push({ type: 'window', cx, w: windowW, h: windowH, y: wy });
  }
  return { openings, meta, bays, step };
}

/**
 * 一般的な建物を組む。
 * def: { w, d, floors, floorHeight, style, roof, colors, front, details }
 * 返り値: { collider, entry }
 */
export function buildBuilding(mb, mats, def) {
  const {
    w = 7, d = 6, floors = 2, floorHeight = 2.9, seed = 1,
    roof = 'gable', style = 'plaster',
    colors = {}, details = {}, groundStyle = null
  } = def;

  const c = {
    wall: colors.wall || PALETTE.plaster[Math.floor(hash2(seed, 1, 5) * PALETTE.plaster.length)],
    roof: colors.roof || PALETTE.roof[Math.floor(hash2(seed, 2, 5) * PALETTE.roof.length)],
    trim: colors.trim || PALETTE.trim[Math.floor(hash2(seed, 3, 5) * PALETTE.trim.length)],
    stone: colors.stone || PALETTE.stoneWarm,
    metal: colors.metal || [0.3, 0.33, 0.38],
    door: colors.door || [0.42, 0.28, 0.2]
  };

  const wallMatFor = (floorIndex) => {
    if (style === 'stone') return mats.stone;
    if (style === 'tech') return mats.techPanel;
    if (style === 'timber') return floorIndex === 0 ? mats.stone : mats.plaster;
    if (groundStyle && floorIndex === 0) return mats[groundStyle];
    return mats.plaster;
  };
  const wallColorFor = (floorIndex) => {
    if (style === 'stone') return c.stone;
    if (style === 'timber' && floorIndex === 0) return c.stone;
    return c.wall;
  };

  const foot = rect(w, d);
  const thickness = 0.3;
  const totalH = floors * floorHeight;

  // ---- 基礎
  mb.add(extrude(insetPolygon(foot, -0.16), -0.6, 0.32, { cap: false }), mats.stone,
    { color: c.stone.map((v) => v * 0.92), ao: 0.62 });
  mb.add(extrude(insetPolygon(foot, -0.22), 0.32, 0.4, { cap: true }), mats.stone,
    { color: c.stone, ao: 0.72 });

  // ---- 各階の壁
  const frontIndex = 2;  // foot の 3 番目の辺（+Z 側）が正面
  const entry = { x: 0, z: d / 2, dir: [0, 1] };
  for (let f = 0; f < floors; f++) {
    const y0 = 0.4 + f * floorHeight;
    const h = floorHeight - (f === floors - 1 ? 0 : 0.02);
    for (let e = 0; e < 4; e++) {
      const a = foot[e], b = foot[(e + 1) % 4];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const length = Math.hypot(dx, dz);
      const angle = Math.atan2(dx, dz);
      const isFront = e === frontIndex;
      const plan = planOpenings(length, h, f, {
        doorBay: isFront && f === 0 ? Math.floor(Math.max(1, Math.round(length / 2.6)) / 2) : -1,
        seed: seed * 7 + e,
        bayWidth: def.bayWidth || 2.6,
        doorW: details.wideDoor ? 1.8 : 1.25
      });
      mb.at(a[0] + dx / 2, y0, a[1] + dz / 2, -angle + Math.PI / 2);
      // 壁本体
      wallWithOpenings(mb, wallMatFor(f), length, h, thickness, plan.openings, {
        color: wallColorFor(f), uvScale: 1, aoBottom: f === 0 ? 0.68 : 0.78
      });
      // ハーフティンバー（木骨）の装飾
      if (style === 'timber' && f > 0) {
        const beamColor = c.trim;
        for (const bw2 of [length]) {
          for (const by of [0.02, h - 0.14]) {
            mb.at(0, by + 0.07, thickness / 2 + 0.02);
            mb.add(box(bw2, 0.14, 0.06), mats.woodDark, { color: beamColor, ao: 0.9 });
            mb.pop();
          }
        }
        const posts = Math.max(2, Math.round(length / 1.5));
        for (let i = 0; i <= posts; i++) {
          const x = (-0.5 + i / posts) * length;
          if (plan.openings.some((o) => x + length / 2 > o.x - 0.1 && x + length / 2 < o.x + o.w + 0.1)) continue;
          mb.at(x, h / 2, thickness / 2 + 0.02);
          mb.add(box(0.13, h - 0.2, 0.06), mats.woodDark, { color: beamColor, ao: 0.92 });
          mb.pop();
        }
        // 斜め材
        for (let i = 0; i < posts; i++) {
          if (hash2(i, f + seed, 21) > 0.45) continue;
          const x = (-0.5 + (i + 0.5) / posts) * length;
          mb.atFull(x, h / 2, thickness / 2 + 0.02, 0, 0, hash2(i, f, 8) > 0.5 ? 0.6 : -0.6);
          mb.add(box(0.11, h * 1.15, 0.05), mats.woodDark, { color: beamColor, ao: 0.9 });
          mb.pop();
        }
      }
      // 開口の中身
      for (const m of plan.meta) {
        if (m.type === 'window') {
          mb.at(m.cx - length / 2, y0 + m.y + m.h / 2 - y0 + (y0 - y0), thickness / 2);
          mb.pop();
          mb.at(m.cx - length / 2, m.y + m.h / 2, thickness / 2);
          windowUnit(mb, mats, m.w, m.h, thickness, {
            frameColor: c.trim.map((v) => v * 0.6 + 0.45),
            shutters: details.shutters && f === 0 ? false : !!details.shutters,
            shutterColor: c.trim,
            flowerBox: !!details.flowerBoxes && isFront && f > 0 && hash2(Math.round(m.cx), f, 3) > 0.35,
            arched: !!details.archedWindows
          });
          mb.pop();
        } else if (m.type === 'door') {
          mb.at(m.cx - length / 2, 0, thickness / 2);
          doorUnit(mb, mats, m.w, m.h, thickness, {
            doorColor: c.door, frameColor: c.stone,
            arched: !!details.archedDoor, glassPanel: !!details.shopFront,
            twoLeaf: !!details.wideDoor
          });
          mb.pop();
          if (isFront) {
            entry.x = a[0] + dx * (m.cx / length);
            entry.z = a[1] + dz * (m.cx / length);
          }
        }
      }
      mb.pop();
    }
    // 階の切れ目に胴蛇腹
    if (f < floors - 1) {
      cornice(mb, mats.stone, foot, 0.4 + (f + 1) * floorHeight - 0.14, 0.14, 0.1, c.stone);
    }
  }

  // ---- 軒の胴蛇腹
  cornice(mb, mats.stone, foot, 0.4 + totalH - 0.18, 0.18, 0.16, c.stone);

  // ---- 屋根
  const roofY = 0.4 + totalH;
  buildRoof(mb, mats, roof, w, d, c, seed, roofY, details);

  // ---- 付属物
  if (details.chimney !== false && roof !== 'flat' && roof !== 'dome') {
    const cxp = (hash2(seed, 9, 4) - 0.5) * w * 0.5;
    const czp = (hash2(seed, 10, 4) - 0.5) * d * 0.4;
    mb.at(cxp, roofY + (details.roofHeight || Math.min(w, d) * 0.42) * 0.45, czp);
    chimney(mb, mats, 0.62, 1.7, c.stone);
    mb.pop();
  }
  if (details.balcony) {
    mb.at(0, 0.4 + floorHeight + 0.1, d / 2 + 0.5);
    balcony(mb, mats, Math.min(w * 0.55, 3), 1.0, { trim: c.stone, metal: c.metal });
    mb.pop();
  }
  if (details.awning) {
    mb.at(0, 0.4 + 2.5, d / 2 + 0.05);
    awning(mb, mats, Math.min(w * 0.8, 4.5), 1.7, { color: details.awningColor || [1, 1, 1], drop: 0.45 });
    mb.pop();
  }
  if (details.sign) {
    mb.at(w / 2 - 0.4, 0.4 + 2.9, d / 2 + 0.25);
    shopSign(mb, mats, 1.25, 0.72, { hanging: true, color: c.trim, iconColor: details.signColor || PALETTE.cyan });
    mb.pop();
  }
  if (details.wallLantern) {
    for (const side of [-1, 1]) {
      mb.at(side * (w / 2 - 0.55), 0.4 + 2.55, d / 2 + 0.22);
      mb.add(box(0.06, 0.06, 0.36), mats.metalDark, { color: c.metal, ao: 1 });
      mb.at(0, -0.22, 0.3);
      lantern(mb, mats, { color: PALETTE.lampGlow, size: 1.05, chain: 0.22 });
      mb.pop();
      mb.pop();
    }
  }
  if (details.downspout) {
    for (const side of [-1, 1]) {
      mb.at(side * (w / 2 + 0.06), 0.4 + totalH / 2, d / 2 - 0.15);
      mb.add(cylinder(0.055, 0.055, totalH, 8, { yOffset: -totalH / 2 }), mats.metalDark,
        { color: [0.42, 0.44, 0.42], ao: 0.85 });
      mb.pop();
    }
  }

  return {
    collider: { type: 'box', w: w + 0.3, d: d + 0.3, rot: 0 },
    entry,
    height: roofY + (details.roofHeight || Math.min(w, d) * 0.42)
  };
}

/** 屋根。形を数種類持ち、同じ屋根が並ばないようにする。 */
export function buildRoof(mb, mats, kind, w, d, c, seed, y, details = {}) {
  const roofMat = (hash2(seed, 4, 6) > 0.5 || details.slate) ? mats.roofSlate : mats.roofTile;
  const h = details.roofHeight || Math.min(w, d) * 0.42;
  mb.at(0, y, 0);
  switch (kind) {
    case 'gable': {
      mb.add(gableRoof(w, d, h, 0.34), roofMat, { color: c.roof, ao: (p) => clamp(0.8 + p[1] * 0.1, 0.8, 1) });
      // 棟
      mb.at(0, h + 0.02, 0);
      mb.add(box(w + 0.72, 0.14, 0.3), mats.roofTile, { color: c.roof.map((v) => v * 0.9), ao: 1 });
      mb.pop();
      // 破風板
      for (const side of [-1, 1]) {
        mb.at(side * (w / 2 + 0.36), h / 2, 0);
        mb.add(box(0.08, 0.2, d + 0.72), mats.wood, { color: c.trim, ao: 0.95 });
        mb.pop();
      }
      break;
    }
    case 'hip': {
      mb.add(hipRoof(w, d, h, 0.34, 0.42), roofMat, { color: c.roof, ao: (p) => clamp(0.8 + p[1] * 0.1, 0.8, 1) });
      break;
    }
    case 'curved': {
      mb.add(curvedRoof(w, d, h * 1.1, 0.4, 7, { overhang: 0.5 }), roofMat,
        { color: c.roof, ao: (p) => clamp(0.82 + p[1] * 0.08, 0.82, 1) });
      break;
    }
    case 'pyramid': {
      mb.add(cylinder(Math.max(w, d) * 0.72, 0.02, h * 1.25, 4, { caps: false, twist: Math.PI / 4 }), roofMat,
        { color: c.roof, ao: 0.95 });
      mb.at(0, h * 1.25, 0);
      mb.add(sphere(0.16, 10, 8), mats.crystal, { color: PALETTE.novaGlow, ao: 1 });
      mb.pop();
      break;
    }
    case 'tower': {
      mb.add(cylinder(Math.min(w, d) * 0.56, Math.min(w, d) * 0.5, 0.3, 16), mats.stone,
        { color: c.stone, ao: 0.9 });
      mb.at(0, 0.3, 0);
      mb.add(cylinder(Math.min(w, d) * 0.5, 0.05, h * 1.9, 16, { caps: false }), roofMat,
        { color: c.roof, ao: (p) => clamp(0.8 + p[1] * 0.08, 0.8, 1) });
      mb.at(0, h * 1.9, 0);
      mb.add(cylinder(0.05, 0.05, 0.5, 6), mats.metalDark, { color: [0.4, 0.4, 0.42], ao: 1 });
      mb.at(0, 0.5, 0);
      mb.add(sphere(0.14, 10, 8), mats.crystal, { color: PALETTE.novaGlow, ao: 1 });
      mb.pop();
      mb.pop();
      mb.pop();
      break;
    }
    case 'dome': {
      mb.add(sphere(Math.min(w, d) * 0.52, 24, 12, { yScale: h / (Math.min(w, d) * 0.52) * 1.35, phiLength: Math.PI / 2 }),
        mats.metal, { color: c.roof, ao: 0.95 });
      mb.at(0, h * 1.32, 0);
      mb.add(lathe([[0.3, 0], [0.22, 0.2], [0.1, 0.45], [0.02, 0.6]], 12), mats.crystal,
        { color: PALETTE.novaGlow, ao: 1 });
      mb.pop();
      break;
    }
    case 'flat':
    default: {
      mb.add(extrude(rect(w + 0.5, d + 0.5), 0, 0.22, { cap: true }), mats.stone, { color: c.stone, ao: 0.95 });
      // パラペット
      const inner = rect(w + 0.5, d + 0.5);
      mb.add(extrude(inner, 0.22, 0.62, { cap: false }), mats.stone, { color: c.stone, ao: 0.9 });
      mb.add(extrude(insetPolygon(inner, 0.18), 0.22, 0.6, { cap: true }), mats.stone,
        { color: c.stone.map((v) => v * 0.94), ao: 0.7 });
      break;
    }
  }
  // ドーマー
  if (details.dormers && (kind === 'gable' || kind === 'hip')) {
    const n = details.dormers;
    for (let i = 0; i < n; i++) {
      const x = (-0.5 + (i + 0.5) / n) * w * 0.78;
      mb.at(x, h * 0.34, d * 0.22);
      dormer(mb, mats, 1.15, 1.05, 0.95, { wall: c.wall, trim: c.trim, roof: c.roof });
      mb.pop();
    }
  }
  mb.pop();
}
