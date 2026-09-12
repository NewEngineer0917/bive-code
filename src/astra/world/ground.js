/**
 * 地面のメッシュ生成。
 *
 * 高さ場を格子でメッシュ化し、道からの距離で石畳／土／芝を混ぜる。
 * 遠景用に外側は粗い格子を張り、川底だけは水面の下へ潜り込ませる。
 * 草はクロスボードを「見える範囲だけ」敷き詰め、距離カリングで切る。
 */

import { ChunkedBuilder } from '../gfx/builder.js';
import { crossBillboard, rock } from '../gfx/geo.js';
import { fbm, hash2 } from '../gfx/noise.js';
import { clamp, TAU } from '../core/math.js';

const CORE = 104;      // 細かい格子を張る範囲
const CELL = 1.7;
const OUTER = 190;
const OUTER_CELL = 9;

/**
 * 地面を作る。
 * aoField(x, z) は 0..1 の環境遮蔽（建物の影になる場所を暗くする）。
 */
export function buildGround(terrain, mats, aoField) {
  const chunks = new ChunkedBuilder(26);
  const ao = aoField || (() => 1);

  const heightCache = new Map();
  const H = (x, z) => {
    const k = `${x.toFixed(2)},${z.toFixed(2)}`;
    let v = heightCache.get(k);
    if (v === undefined) { v = terrain.height(x, z); heightCache.set(k, v); }
    return v;
  };

  const surfaceCache = new Map();
  const S = (x, z) => {
    const k = `${x.toFixed(2)},${z.toFixed(2)}`;
    let v = surfaceCache.get(k);
    if (v === undefined) { v = terrain.roadField(x, z); surfaceCache.set(k, v); }
    return v;
  };

  const grassTint = (x, z) => {
    const p = fbm(x * 0.035, z * 0.035, 3, 512, 5);
    const dry = fbm(x * 0.012 + 9, z * 0.012 + 9, 2, 512, 17);
    return [
      0.82 + p * 0.38 + dry * 0.18,
      0.86 + p * 0.3,
      0.78 + p * 0.32,
    ];
  };

  /** 1 枚の四角形を張る。材質は中心の舗装具合で決める。 */
  const quad = (x0, z0, size) => {
    const x1 = x0 + size, z1 = z0 + size;
    const cx = x0 + size / 2, cz = z0 + size / 2;
    const s = S(cx, cz);
    let matA, matB;
    if (s.stone >= s.dirt && s.stone > 0.04) { matA = mats.cobble; matB = mats.ground; }
    else if (s.dirt > 0.04) { matA = mats.dirt; matB = mats.ground; }
    else { matA = mats.ground; matB = mats.dirt; }

    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const geo = { positions: [], normals: [], uvs: [], indices: [0, 3, 1, 1, 3, 2] };
    const cols = [];
    const aos = [];
    const blends = [];
    for (const [px, pz] of corners) {
      const h = H(px, pz);
      const n = terrain.normal(px, pz, 0.8);
      geo.positions.push(px, h, pz);
      geo.normals.push(n[0], n[1], n[2]);
      // 1 タイル ≒ 0.8m。石畳の一粒が 10cm 前後になる密度。
      geo.uvs.push(px * 1.25, pz * 1.25);
      const sv = S(px, pz);
      let blend;
      if (matA === mats.cobble) blend = 1 - sv.stone;
      else if (matA === mats.dirt) blend = 1 - sv.dirt;
      else blend = clamp(sv.dirt * 0.9 + fbm(px * 0.08, pz * 0.08, 2, 512, 61) * 0.25 - 0.1, 0, 1);
      blends.push(blend);
      // 舗装の上は色を抑えめに、芝は場所ごとに色を振る
      const g = grassTint(px, pz);
      const paved = Math.max(sv.stone, sv.dirt);
      cols.push([
        g[0] * (1 - paved) + (0.95 + hash2(Math.floor(px), Math.floor(pz), 3) * 0.12) * paved,
        g[1] * (1 - paved) + (0.94 + hash2(Math.floor(px), Math.floor(pz), 4) * 0.12) * paved,
        g[2] * (1 - paved) + (0.93 + hash2(Math.floor(px), Math.floor(pz), 5) * 0.12) * paved,
      ]);
      // 低い場所と建物の近くを暗くする
      const cavity = clamp(0.62 + (h - H(px + 2.4, pz) + h - H(px - 2.4, pz)
        + h - H(px, pz + 2.4) + h - H(px, pz - 2.4)) * -0.16, 0.4, 1.08);
      aos.push(clamp(cavity * ao(px, pz), 0.25, 1));
    }
    const b = chunks.at(cx, cz);
    let ci = 0;
    b.add(geo, matA, {
      material2: matB,
      color: () => cols[ci],
      ao: () => aos[ci],
      blend: () => { const v = blends[ci]; ci++; return v; }
    });
  };

  // 中心部：細かい格子
  for (let z = -CORE; z < CORE; z += CELL) {
    for (let x = -CORE; x < CORE; x += CELL) quad(x, z, CELL);
  }
  // 外周：粗い格子（町の外の景色）
  for (let z = -OUTER; z < OUTER; z += OUTER_CELL) {
    for (let x = -OUTER; x < OUTER; x += OUTER_CELL) {
      if (x + OUTER_CELL > -CORE && x < CORE && z + OUTER_CELL > -CORE && z < CORE) continue;
      quad(x, z, OUTER_CELL);
    }
  }

  return chunks.build();
}

/**
 * 草を敷く。プレイヤーが通る範囲を中心に密度を上げ、
 * 道と建物の上には生やさない。
 */
export function buildGrass(terrain, mats, isBlocked, regions) {
  const chunks = new ChunkedBuilder(22);
  const tuft = crossBillboard(0.3, 0.5, 2, { taper: 0.5, rows: 3, bend: 0.12 });
  const tall = crossBillboard(0.26, 0.86, 3, { taper: 0.6, rows: 4, bend: 0.18 });
  let placed = 0;

  for (const region of regions) {
    const { cx, cz, radius, density } = region;
    const area = Math.PI * radius * radius;
    const n = Math.floor(area * density);
    for (let i = 0; i < n; i++) {
      // 黄金角で均一に散らす（塊にならない）
      const t = i / n;
      const r = Math.sqrt(t) * radius;
      const a = i * 2.39996 + hash2(Math.floor(cx), i, 3) * 0.8;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const surf = terrain.roadField(x, z);
      if (surf.w > 0.32) continue;
      if (terrain.riverInfo(x, z).dist < 5) continue;
      if (isBlocked && isBlocked(x, z, 0.4)) continue;
      if (terrain.slope(x, z) > 0.55) continue;
      const jitterX = (hash2(i, 1, 7) - 0.5) * 1.1;
      const jitterZ = (hash2(i, 2, 7) - 0.5) * 1.1;
      const px = x + jitterX, pz = z + jitterZ;
      const py = terrain.height(px, pz);
      const scale = 0.75 + hash2(i, 3, 7) * 0.8;
      const isTall = hash2(i, 4, 7) > 0.74;
      const tint = fbm(px * 0.04, pz * 0.04, 2, 512, 5);
      const b = chunks.at(px, pz);
      b.at(px, py - 0.06, pz, hash2(i, 5, 7) * TAU, scale, scale * (isTall ? 1.15 : 1), scale);
      b.add(isTall ? tall : tuft, mats.grassBlade, {
        color: [0.96 + tint * 0.42, 1.04 + tint * 0.3, 0.84 + tint * 0.32],
        ao: (p) => clamp(0.76 + (p[1] - py) * 0.7, 0.74, 1.12),
        windFromY: [0, isTall ? 0.78 : 0.42, 1.25]
      });
      b.pop();
      placed++;
    }
  }
  return { batches: chunks.build(), count: placed };
}

/** 川岸・丘・広場のふちに置く石。 */
export function buildScatterRocks(terrain, mats, isBlocked, spots) {
  const chunks = new ChunkedBuilder(26);
  let n = 0;
  for (const s of spots) {
    for (let i = 0; i < s.count; i++) {
      const a = hash2(i, s.seed, 11) * TAU;
      const r = Math.sqrt(hash2(i, s.seed + 1, 11)) * s.radius;
      const x = s.cx + Math.cos(a) * r;
      const z = s.cz + Math.sin(a) * r;
      if (isBlocked && isBlocked(x, z, 0.8)) continue;
      if (terrain.roadField(x, z).stone > 0.4) continue;
      const y = terrain.height(x, z);
      const size = s.size * (0.6 + hash2(i, s.seed + 2, 11) * 0.9);
      const g = rock(size, i + s.seed * 7, 8);
      const b = chunks.at(x, z);
      b.at(x, y - size * 0.3, z, hash2(i, s.seed + 3, 11) * TAU, 1, 0.8 + hash2(i, s.seed + 4, 11) * 0.5, 1);
      b.add(g, mats.stone, {
        color: [0.78 + hash2(i, 6, 11) * 0.2, 0.78 + hash2(i, 7, 11) * 0.18, 0.74 + hash2(i, 8, 11) * 0.2],
        ao: (p) => clamp(0.5 + (p[1] - y) * 0.55, 0.45, 1)
      });
      b.pop();
      n++;
    }
  }
  return { batches: chunks.build(), count: n };
}
