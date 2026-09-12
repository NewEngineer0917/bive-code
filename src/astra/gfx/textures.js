/**
 * 材質テクスチャの手続き生成。
 *
 * 画像ファイルを一切持たずに、石・木・漆喰・屋根瓦・金属・ガラス・布・葉・
 * 樹皮・結晶などを合成する。各生成関数は
 *   albedo（RGB = 色, A = 自発光マスク）と height / roughness
 * を返し、height からノーマルマップを作る。ノーマルマップの A には
 * roughness を詰めているので、テクスチャ 2 枚で PBR に必要な情報が揃う。
 */

import { fbm, ridged, worley, hash2, sat, mix, smooth } from './noise.js';

export const TEX_SIZE = 256;

function buffers(S) {
  return {
    rgba: new Uint8ClampedArray(S * S * 4),
    height: new Float32Array(S * S),
    rough: new Float32Array(S * S).fill(0.8)
  };
}

function setPx(b, i, r, g, bl, a, h, rough) {
  b.rgba[i * 4] = r * 255; b.rgba[i * 4 + 1] = g * 255;
  b.rgba[i * 4 + 2] = bl * 255; b.rgba[i * 4 + 3] = a * 255;
  b.height[i] = h;
  b.rough[i] = rough;
}

/* ============================================================= 石・舗装 */

/** 切石積みの壁。目地が通り、石ごとに色と粗さが違う。 */
function stoneWall(S) {
  const b = buffers(S);
  const rows = 6, courseH = S / rows;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const row = Math.floor(y / courseH);
      const offset = (row % 2) * courseH * 0.9;
      const blocksPerRow = 3 + (row % 2);
      const blockW = S / blocksPerRow;
      const bx = Math.floor(((x + offset) % S) / blockW);
      const seed = row * 31 + bx * 7;
      const lx = ((x + offset) % S) / blockW - bx;
      const ly = y / courseH - row;
      const mortar = 0.055;
      const inBlock = lx > mortar && lx < 1 - mortar && ly > mortar * 2.2 && ly < 1 - mortar * 2.2;
      const edge = smooth(0, 0.035, Math.min(lx, 1 - lx)) * smooth(0, 0.07, Math.min(ly, 1 - ly));
      const grain = fbm(x / 12, y / 12, 4, 22, seed) * 0.5 + fbm(x / 3, y / 3, 3, 86, seed + 5) * 0.5;
      const tint = hash2(bx, row, 17);
      // 暖色の石。個体ごとに黄み〜灰みへ揺らす
      let r = mix(0.62, 0.74, tint) * (0.82 + grain * 0.36);
      let g = mix(0.56, 0.66, tint) * (0.82 + grain * 0.36);
      let bl = mix(0.46, 0.55, tint) * (0.84 + grain * 0.32);
      let h = 0.55 + grain * 0.22;
      let rough = 0.72 + grain * 0.2;
      if (!inBlock) {
        const m = 0.4 + fbm(x / 6, y / 6, 3, 44, 9) * 0.25;
        r = m * 0.78; g = m * 0.76; bl = m * 0.7;
        h = 0.18;
        rough = 0.95;
      } else {
        h = mix(0.3, h, edge);
        // 欠けと汚れ
        const chip = worley(x / 26, y / 26, 10, seed + 3).edge;
        if (chip < 0.08) { h -= 0.12; r *= 0.9; g *= 0.9; bl *= 0.9; }
      }
      const dirt = smooth(0.55, 0.95, fbm(x / 30, y / 18, 3, 9, 71)) * 0.22;
      r = mix(r, 0.3, dirt); g = mix(g, 0.31, dirt); bl = mix(bl, 0.26, dirt);
      setPx(b, i, r, g, bl, 0, h, sat(rough));
    }
  }
  return b;
}

/** 石畳。丸みのある敷石と目地の草。 */
function cobble(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const cell = S / 6;
      const w = worley(x / cell, y / cell, 6, 3);
      const stone = smooth(0.015, 0.09, w.edge);
      const tint = hash2(w.cellX, w.cellY, 41);
      const grain = fbm(x / 5, y / 5, 3, 51, 13);
      // 暖かい砂岩色。個体差を大きめに取り、同じ石が並ばないようにする
      let r = mix(0.58, 0.78, tint) * (0.86 + grain * 0.26);
      let g = mix(0.52, 0.7, tint) * (0.86 + grain * 0.26);
      let bl = mix(0.44, 0.58, tint) * (0.88 + grain * 0.22);
      // 目地は砂を噛んだ明るいグレー。黒い溝にすると「ひび割れた泥」に見える
      const moss = smooth(0.66, 0.92, fbm(x / 18, y / 18, 3, 13, 88)) * (1 - stone);
      r = mix(r * 0.72, r, stone); g = mix(g * 0.73, g, stone); bl = mix(bl * 0.72, bl, stone);
      r = mix(r, 0.3, moss * 0.7); g = mix(g, 0.42, moss * 0.7); bl = mix(bl, 0.22, moss * 0.7);
      const h = mix(0.3, 0.8 - w.d1 * 0.2, stone);
      const rough = mix(0.92, 0.6 + grain * 0.2, stone);
      setPx(b, i, r, g, bl, 0, h, sat(rough));
    }
  }
  return b;
}

/** 砂利／土の小径。 */
function dirtPath(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const n = fbm(x / 26, y / 26, 4, 10, 61);
      const g1 = worley(x / (S / 9), y / (S / 9), 9, 7);
      const pebble = smooth(0.34, 0.08, g1.d1);
      const tint = hash2(g1.cellX, g1.cellY, 5);
      let r = mix(0.42, 0.5, n) , g = mix(0.35, 0.41, n), bl = mix(0.27, 0.31, n);
      r = mix(r, mix(0.5, 0.62, tint), pebble * 0.7);
      g = mix(g, mix(0.47, 0.58, tint), pebble * 0.7);
      bl = mix(bl, mix(0.42, 0.52, tint), pebble * 0.7);
      const h = n * 0.4 + pebble * 0.45;
      setPx(b, i, r, g, bl, 0, h, sat(0.94 - pebble * 0.2));
    }
  }
  return b;
}

/** 芝の地面（草メッシュの下に敷く色）。 */
function grassGround(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const blade = ridged(x / 2.2, y / 5.5, 3, 116, 3);
      const patch = fbm(x / 26, y / 26, 4, 10, 23);
      const dry = smooth(0.55, 0.85, fbm(x / 40, y / 40, 3, 6, 77));
      let r = mix(0.2, 0.4, patch) * (0.74 + blade * 0.52);
      let g = mix(0.42, 0.66, patch) * (0.76 + blade * 0.48);
      let bl = mix(0.14, 0.26, patch) * (0.74 + blade * 0.52);
      r = mix(r, 0.5, dry * 0.3); g = mix(g, 0.54, dry * 0.22); bl = mix(bl, 0.24, dry * 0.26);
      setPx(b, i, r, g, bl, 0, blade * 0.4 + patch * 0.3, 0.88);
    }
  }
  return b;
}

/** 磨いた大理石（研究所やクリニックの床・外装）。 */
function marble(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const warp = fbm(x / 40, y / 40, 3, 6, 12) * 30;
      const vein = ridged((x + warp) / 55, (y - warp) / 70, 4, 5, 31);
      const v = smooth(0.62, 0.93, vein);
      const fine = fbm(x / 4, y / 4, 2, 64, 8) * 0.06;
      let r = mix(0.9, 0.66, v) + fine;
      let g = mix(0.91, 0.69, v) + fine;
      let bl = mix(0.89, 0.72, v) + fine;
      setPx(b, i, r, g, bl, 0, 0.5 + v * 0.04, sat(0.24 + v * 0.16));
    }
  }
  return b;
}

/* ================================================================ 木 */

function woodPlanks(S, dark = false) {
  const b = buffers(S);
  const planks = 5;
  const pw = S / planks;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const pi = Math.floor(x / pw);
      const lx = x / pw - pi;
      const seed = pi * 13 + 3;
      const warp = fbm(x / 30, y / 7, 3, 12, seed) * 10;
      const rings = Math.abs(Math.sin((x + warp) * 0.42 + hash2(pi, 0, 2) * 6.28));
      const grain = Math.pow(rings, 0.55);
      const fine = fbm(x / 1.6, y / 26, 3, 128, seed + 9);
      const tint = hash2(pi, 1, 44);
      const baseR = dark ? 0.26 : 0.58, baseG = dark ? 0.18 : 0.42, baseB = dark ? 0.12 : 0.26;
      let r = baseR * (0.66 + grain * 0.5) * mix(0.88, 1.12, tint) + fine * 0.05;
      let g = baseG * (0.68 + grain * 0.48) * mix(0.9, 1.1, tint) + fine * 0.04;
      let bl = baseB * (0.7 + grain * 0.46) * mix(0.9, 1.1, tint) + fine * 0.03;
      let h = 0.55 + grain * 0.12 + fine * 0.1;
      const gap = smooth(0.03, 0, Math.min(lx, 1 - lx));
      if (gap > 0) { r *= 0.35; g *= 0.32; bl *= 0.3; h = 0.15; }
      // 節
      const kn = worley(x / 70, y / 70, 4, seed).d1;
      if (kn < 0.16) {
        const k = smooth(0.16, 0.03, kn);
        r = mix(r, baseR * 0.42, k); g = mix(g, baseG * 0.4, k); bl = mix(bl, baseB * 0.4, k);
        h = mix(h, 0.44, k);
      }
      setPx(b, i, r, g, bl, 0, h, sat(0.66 + fine * 0.2));
    }
  }
  return b;
}

function bark(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const warp = fbm(x / 20, y / 60, 3, 12, 5) * 14;
      const fissure = ridged((x + warp) / 7, y / 48, 4, 36, 19);
      const crack = Math.pow(1 - fissure, 2.2);
      const n = fbm(x / 6, y / 12, 4, 42, 3);
      let r = mix(0.24, 0.42, n) * (0.5 + fissure * 0.8);
      let g = mix(0.19, 0.33, n) * (0.52 + fissure * 0.76);
      let bl = mix(0.15, 0.25, n) * (0.55 + fissure * 0.7);
      const moss = smooth(0.62, 0.92, fbm(x / 34, y / 34, 3, 7, 55)) * smooth(0.4, 0.9, y / S);
      r = mix(r, 0.17, moss * 0.55); g = mix(g, 0.31, moss * 0.55); bl = mix(bl, 0.13, moss * 0.55);
      setPx(b, i, r, g, bl, 0, fissure * 0.85 + n * 0.15, sat(0.88 - crack * 0.1));
    }
  }
  return b;
}

/* ============================================================== 屋根 */

/** 瓦。半円の筒が並ぶ。 */
function roofTile(S) {
  const b = buffers(S);
  const cols = 8, rows = 6;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const cw = S / cols, ch = S / rows;
      const ci = Math.floor(x / cw), ri = Math.floor(y / ch);
      const lx = x / cw - ci;
      const ly = y / ch - ri;
      const round = Math.sin(lx * Math.PI);
      const overlap = smooth(0, 0.18, ly);
      const tint = hash2(ci, ri, 23);
      const grain = fbm(x / 8, y / 8, 3, 32, 11);
      let r = mix(0.56, 0.72, tint) * (0.55 + round * 0.5) * (0.86 + grain * 0.26);
      let g = mix(0.28, 0.36, tint) * (0.58 + round * 0.48) * (0.86 + grain * 0.26);
      let bl = mix(0.21, 0.26, tint) * (0.6 + round * 0.45) * (0.88 + grain * 0.22);
      let h = round * 0.6 * overlap + overlap * 0.2;
      if (ly < 0.06) { h = 0.1; r *= 0.5; g *= 0.5; bl *= 0.5; }
      const moss = smooth(0.68, 0.95, fbm(x / 24, y / 24, 3, 11, 93)) * 0.5;
      r = mix(r, 0.22, moss); g = mix(g, 0.33, moss); bl = mix(bl, 0.18, moss);
      setPx(b, i, r, g, bl, 0, h, sat(0.7 + grain * 0.2));
    }
  }
  return b;
}

/** スレート葺き。平たい板が段になって重なる。 */
function roofSlate(S) {
  const b = buffers(S);
  const rows = 9;
  const rh = S / rows;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const ri = Math.floor(y / rh);
      const ly = y / rh - ri;
      const offset = (ri % 2) * 0.5;
      const tw = S / 6;
      const tx = ((x / tw) + offset);
      const ti = Math.floor(tx);
      const lx = tx - ti;
      const tint = hash2(ti, ri, 61);
      const grain = fbm(x / 7, y / 7, 3, 36, 21);
      const edgeX = smooth(0, 0.04, Math.min(lx, 1 - lx));
      const edgeY = smooth(0, 0.1, ly);
      let r = mix(0.2, 0.31, tint) * (0.82 + grain * 0.3);
      let g = mix(0.22, 0.33, tint) * (0.82 + grain * 0.3);
      let bl = mix(0.27, 0.39, tint) * (0.84 + grain * 0.28);
      let h = 0.25 + edgeY * 0.5 + ly * 0.2;
      if (edgeX < 0.5) { h -= 0.2; r *= 0.75; g *= 0.75; bl *= 0.78; }
      setPx(b, i, r, g, bl, 0, h, sat(0.56 + grain * 0.25));
    }
  }
  return b;
}

/* ============================================================== 仕上げ */

/** 漆喰。塗りむらとひび。 */
function plaster(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const coarse = fbm(x / 26, y / 26, 4, 10, 3);
      const fine = fbm(x / 2.4, y / 2.4, 3, 108, 17);
      const crack = smooth(0.965, 1, ridged(x / 30, y / 30, 3, 9, 44));
      let v = 0.86 + coarse * 0.16 + fine * 0.07 - crack * 0.35;
      const stain = smooth(0.6, 1, fbm(x / 60, y / 22, 3, 5, 71)) * 0.16;
      let r = v * 0.98, g = v * 0.96, bl = v * 0.9;
      r = mix(r, 0.5, stain); g = mix(g, 0.5, stain); bl = mix(bl, 0.46, stain);
      setPx(b, i, r, g, bl, 0, coarse * 0.3 + fine * 0.25 - crack * 0.5, sat(0.84 + fine * 0.14));
    }
  }
  return b;
}

/** 金属（手すり・金具・看板の枠）。 */
function metalBrushed(S, dark = false) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const brush = fbm(x / 1.4, y / 40, 3, 180, 7);
      const patina = smooth(0.55, 0.9, fbm(x / 34, y / 34, 4, 7, 29));
      const base = dark ? 0.22 : 0.62;
      let r = base * (0.85 + brush * 0.3);
      let g = base * (0.86 + brush * 0.28) * (dark ? 1.02 : 1.0);
      let bl = base * (0.9 + brush * 0.26) * (dark ? 1.12 : 1.02);
      r = mix(r, 0.32, patina * 0.35); g = mix(g, 0.42, patina * 0.35); bl = mix(bl, 0.38, patina * 0.35);
      setPx(b, i, r, g, bl, 0, brush * 0.2, sat((dark ? 0.55 : 0.34) + brush * 0.2 + patina * 0.25));
    }
  }
  return b;
}

/** 窓ガラス。A に自発光マスクを入れて、夜だけ室内光が灯る。 */
function glass(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const streak = fbm(x / 3, y / 34, 3, 84, 13);
      const dust = fbm(x / 18, y / 18, 3, 14, 5);
      const r = 0.5 + streak * 0.12, g = 0.58 + streak * 0.12, bl = 0.66 + streak * 0.1;
      setPx(b, i, r, g, bl, 0.85 + dust * 0.15, 0.5, sat(0.08 + dust * 0.1));
    }
  }
  return b;
}

/** 日除け／テントの縞布。 */
function awningCloth(S) {
  const b = buffers(S);
  const stripes = 6;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const s = Math.floor(x / (S / stripes)) % 2;
      const weave = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.5 + 0.5;
      const wear = fbm(x / 30, y / 30, 3, 8, 19);
      let r = s ? 0.92 : 0.2, g = s ? 0.9 : 0.34, bl = s ? 0.84 : 0.44;
      r *= 0.84 + weave * 0.24 + wear * 0.1;
      g *= 0.84 + weave * 0.24 + wear * 0.1;
      bl *= 0.86 + weave * 0.2 + wear * 0.1;
      setPx(b, i, r, g, bl, 0, weave * 0.3, sat(0.88 - weave * 0.08));
    }
  }
  return b;
}

/** 布（洗濯物・旗・敷物）。縞を持たない素の織り。 */
function fabric(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const weave = (Math.sin(x * 2.1) * 0.5 + 0.5) * 0.5 + (Math.sin(y * 2.1) * 0.5 + 0.5) * 0.5;
      const n = fbm(x / 24, y / 24, 3, 10, 37);
      const v = 0.78 + weave * 0.2 + n * 0.1;
      setPx(b, i, v, v * 0.99, v * 0.96, 0, weave * 0.4, sat(0.9 - weave * 0.06));
    }
  }
  return b;
}

/* ============================================================== 植物 */

/** 葉の房。A はアルファ（切り抜き）。 */
function leafCluster(S) {
  const b = buffers(S);
  const leaves = [];
  for (let k = 0; k < 34; k++) {
    leaves.push({
      x: hash2(k, 1, 3) * S, y: hash2(k, 2, 3) * S,
      r: (0.062 + hash2(k, 3, 3) * 0.1) * S,
      a: hash2(k, 4, 3) * Math.PI * 2,
      tint: hash2(k, 5, 3)
    });
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let alpha = 0, r = 0, g = 0, bl = 0, h = 0, best = -1;
      for (const lf of leaves) {
        for (let wrapX = -1; wrapX <= 1; wrapX++) {
          for (let wrapY = -1; wrapY <= 1; wrapY++) {
            const dx = x - lf.x - wrapX * S, dy = y - lf.y - wrapY * S;
            const ca = Math.cos(lf.a), sa = Math.sin(lf.a);
            const lx = (dx * ca + dy * sa) / lf.r;
            const ly = (-dx * sa + dy * ca) / (lf.r * 0.45);
            // 葉の形（根元が丸く先が尖る楕円）。
            // 係数を正に保たないと、遠い座標で d が負になり全面が葉になる。
            const taper = Math.max(0.3, 1 + lx * 0.6);
            const d = lx * lx + ly * ly * taper;
            if (d < 1) {
              const edge = smooth(1, 0.55, d);
              const vein = Math.abs(ly) < 0.06 ? 1 : smooth(0.5, 0, Math.abs(Math.sin(lx * 9) * 0.4 - ly));
              const depth = lf.tint + lx * 0.1;
              if (depth > best) {
                best = depth;
                alpha = 1;
                const shade = 0.78 + edge * 0.34 - vein * 0.1;
                r = mix(0.2, 0.46, lf.tint) * shade;
                g = mix(0.46, 0.78, lf.tint) * shade;
                bl = mix(0.14, 0.3, lf.tint) * shade;
                h = 0.4 + edge * 0.4 + vein * 0.15;
              }
            }
          }
        }
      }
      setPx(b, i, r, g, bl, alpha, h, 0.72);
    }
  }
  return b;
}

/**
 * 草の葉。クロスボードの UV に合わせ、v=0 が根元・v=1 が先端。
 * 向きを取り違えると、根元が透明で先端が太いという破綻した草になる。
 */
function grassBlade(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const v = y / S;          // 0 = 根元, 1 = 先端
      const u = x / S;
      const blades = 4;
      let alpha = 0, shade = 0, tint = 0;
      for (let k = 0; k < blades; k++) {
        // 先へ行くほど細く、少し反る
        const cx = (k + 0.5) / blades + Math.sin(v * 2.4 + k * 1.7) * 0.05 * v;
        const w = 0.115 * (1 - v * 0.88) * (0.7 + hash2(k, 3, 9) * 0.6);
        const d = Math.abs(u - cx);
        if (d < w && v < 0.97) {
          alpha = 1;
          shade = 0.55 + (1 - d / w) * 0.45;
          tint = hash2(k, 7, 2);
        }
      }
      const grad = mix(0.6, 1.15, v);
      const r = mix(0.18, 0.38, tint) * shade * grad;
      const g = mix(0.44, 0.76, tint) * shade * grad;
      const bl = mix(0.14, 0.26, tint) * shade * grad;
      setPx(b, i, r, g, bl, alpha, 0.5, 0.8);
    }
  }
  return b;
}

/** 花（プランター・花壇用の切り抜き板）。 */
function flowers(S) {
  const b = buffers(S);
  const blooms = [];
  for (let k = 0; k < 14; k++) {
    blooms.push({
      x: hash2(k, 11, 6) * S, y: S * (0.55 + hash2(k, 12, 6) * 0.42),
      r: (0.038 + hash2(k, 13, 6) * 0.05) * S,
      hue: hash2(k, 14, 6),
      petals: 5 + Math.floor(hash2(k, 15, 6) * 3)
    });
  }
  const palette = [[0.95, 0.4, 0.52], [0.98, 0.78, 0.32], [0.72, 0.5, 0.95], [0.95, 0.95, 0.96], [0.4, 0.72, 0.98]];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      let alpha = 0, r = 0, g = 0, bl = 0;
      // 茎と葉
      for (const f of blooms) {
        const dxs = Math.abs(x - f.x - Math.sin((y / S) * 10) * S * 0.016);
        if (dxs < S * 0.008 && y < f.y) { alpha = 1; r = 0.2; g = 0.44; bl = 0.16; }
      }
      for (const f of blooms) {
        const dx = x - f.x, dy = y - f.y;
        const d = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        const petal = f.r * (0.55 + 0.45 * Math.abs(Math.cos(ang * f.petals * 0.5)));
        if (d < petal) {
          alpha = 1;
          const c = palette[Math.floor(f.hue * palette.length) % palette.length];
          const core = smooth(f.r * 0.28, 0, d);
          const shade = 0.78 + (1 - d / petal) * 0.3;
          r = mix(c[0] * shade, 0.98, core * 0.8);
          g = mix(c[1] * shade, 0.86, core * 0.8);
          bl = mix(c[2] * shade, 0.3, core * 0.8);
        }
      }
      setPx(b, i, r, g, bl, alpha, 0.5, 0.74);
    }
  }
  return b;
}

/** 苔。石やレンガの根元に貼る。 */
function moss(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const clump = worley(x / 10, y / 10, 26, 12).edge;
      const n = fbm(x / 4, y / 4, 4, 64, 51);
      const v = 0.55 + clump * 0.8 + n * 0.3;
      const r = 0.14 * v, g = 0.34 * v, bl = 0.13 * v;
      setPx(b, i, r, g, bl, 0, clump * 0.6 + n * 0.4, 0.93);
    }
  }
  return b;
}

/* ============================================================ Nova 技術 */

/** Nova クリスタル。自発光つきの結晶。 */
function novaCrystal(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const w = worley(x / 26, y / 26, 10, 71);
      const facet = smooth(0.0, 0.2, w.edge);
      const inner = fbm(x / 12, y / 12, 4, 22, 8);
      const glow = sat(smooth(0.35, 0.9, inner) * facet + (1 - facet) * 0.85);
      const r = mix(0.16, 0.5, glow) * 0.6;
      const g = mix(0.5, 0.95, glow);
      const bl = mix(0.7, 1.0, glow);
      setPx(b, i, r, g, bl, glow, facet * 0.5 + inner * 0.3, sat(0.12 + facet * 0.2));
    }
  }
  return b;
}

/** 研究都市の外装パネル。発光ラインが走る。 */
function techPanel(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const pw = S / 4, ph = S / 8;
      const px = Math.floor(x / pw), py = Math.floor(y / ph);
      const lx = (x % pw) / pw, ly = (y % ph) / ph;
      const seam = smooth(0.03, 0.055, Math.min(lx, 1 - lx)) * smooth(0.05, 0.09, Math.min(ly, 1 - ly));
      const tint = hash2(px, py, 19);
      const brush = fbm(x / 2, y / 48, 3, 128, 6);
      let v = mix(0.78, 0.9, tint) * (0.9 + brush * 0.16);
      let r = v * 0.94, g = v * 0.96, bl = v;
      r = mix(r * 0.55, r, seam); g = mix(g * 0.56, g, seam); bl = mix(bl * 0.6, bl, seam);
      // 発光ライン
      let emis = 0;
      const line = Math.abs(ly - 0.5) < 0.035 && lx > 0.1 && lx < 0.9 ? 1 : 0;
      if (line && hash2(px, py, 3) > 0.55) {
        emis = 0.9;
        r = 0.3; g = 0.85; bl = 1.0;
      }
      setPx(b, i, r, g, bl, emis, seam * 0.4 + 0.3, sat(0.3 + brush * 0.2));
    }
  }
  return b;
}

/** 看板の塗り板。文字は別途ジオメトリで載せる。 */
function signBoard(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const grain = fbm(x / 2, y / 30, 3, 128, 41);
      const wear = smooth(0.6, 1, fbm(x / 22, y / 22, 3, 12, 9));
      const border = smooth(0.02, 0.05, Math.min(x / S, 1 - x / S, y / S, 1 - y / S));
      let r = mix(0.16, 0.2, grain), g = mix(0.2, 0.26, grain), bl = mix(0.3, 0.38, grain);
      r = mix(0.55, r, border); g = mix(0.44, g, border); bl = mix(0.3, bl, border);
      r = mix(r, 0.6, wear * 0.2); g = mix(g, 0.55, wear * 0.2); bl = mix(bl, 0.5, wear * 0.2);
      setPx(b, i, r, g, bl, 0, border * 0.3 + grain * 0.2, 0.6);
    }
  }
  return b;
}

/* =============================================================== 水 */

/** 水面用のさざ波ハイトマップ（法線だけを使う）。 */
function waterSurface(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const w1 = fbm(x / 26, y / 20, 4, 10, 3);
      const w2 = ridged(x / 9, y / 13, 3, 28, 17) * 0.5;
      const h = w1 * 0.6 + w2 * 0.4;
      setPx(b, i, 0.1, 0.3, 0.4, 0, h, 0.06);
    }
  }
  return b;
}

/* =========================================================== 生き物向け */

/** 肌。ほぼ均一だが、わずかな起伏と毛穴でプラスチックに見えないようにする。 */
function skinSurface(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const pore = fbm(x / 1.5, y / 1.5, 2, 170, 3) * 0.06;
      const soft = fbm(x / 22, y / 22, 3, 12, 9);
      // 頬の赤みのような、ゆるい色むら
      const v = 0.94 + soft * 0.1 - pore * 0.5;
      setPx(b, i, v * 1.02, v * 0.965, v * 0.94, 0, soft * 0.25 + pore, sat(0.52 + soft * 0.2));
    }
  }
  return b;
}

/** 毛皮。creature の胴体に使う。 */
function fur(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const strand = ridged(x / 1.6, y / 7, 3, 160, 27);
      const clump = fbm(x / 14, y / 14, 4, 18, 5);
      const v = 0.62 + strand * 0.45 + clump * 0.25;
      setPx(b, i, v, v * 0.98, v * 0.95, 0, strand * 0.5 + clump * 0.4, sat(0.82 - strand * 0.12));
    }
  }
  return b;
}

/** 黒曜石（Pyrail の体）。内側の赤熱を A の自発光で出す。 */
function obsidian(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const w = worley(x / 20, y / 20, 13, 5);
      const facet = smooth(0.0, 0.16, w.edge);
      const crack = smooth(0.74, 0.98, ridged(x / 18, y / 18, 4, 14, 33));
      const shine = fbm(x / 5, y / 5, 3, 52, 11);
      let v = mix(0.03, 0.11, facet) + shine * 0.05;
      let r = v * 1.25, g = v, bl = v * 1.1;
      const emis = crack;
      if (emis > 0.02) { r = mix(r, 1.0, emis); g = mix(g, 0.42, emis); bl = mix(bl, 0.12, emis); }
      setPx(b, i, r, g, bl, emis, facet * 0.5 + crack * 0.2, sat(mix(0.24, 0.4, 1 - facet)));
    }
  }
  return b;
}

/** 鱗（水棲アストラ）。 */
function scales(S) {
  const b = buffers(S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const cell = S / 16;
      const row = Math.floor(y / cell);
      const ox = (row % 2) * cell * 0.5;
      const cx = Math.round((x + ox) / cell) * cell - ox;
      const cy = row * cell + cell * 0.5;
      const dx = (x - cx) / (cell * 0.56), dy = (y - cy) / (cell * 0.56);
      const d = Math.hypot(dx, dy * 1.2);
      const scale = smooth(1.05, 0.25, d);
      const irid = fbm(x / 20, y / 20, 3, 12, 23);
      const v = 0.4 + scale * 0.5;
      const r = v * mix(0.35, 0.6, irid);
      const g = v * mix(0.72, 0.9, irid);
      const bl = v * mix(0.9, 1.0, irid);
      setPx(b, i, r, g, bl, 0, scale * 0.7, sat(0.2 + (1 - scale) * 0.4));
    }
  }
  return b;
}

/* ====================================================== ノーマルマップ */

/** 高さからノーマルを作り、A に roughness を詰める。 */
export function heightToNormal(b, S, strength = 2.2) {
  const out = new Uint8ClampedArray(S * S * 4);
  const at = (x, y) => b.height[(((y % S) + S) % S) * S + (((x % S) + S) % S)];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // Sobel
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl2 = at(x - 1, y + 1), bo = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl2);
      const dy = (bl2 + 2 * bo + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      const i = y * S + x;
      out[i * 4] = (nx / len * 0.5 + 0.5) * 255;
      out[i * 4 + 1] = (ny / len * 0.5 + 0.5) * 255;
      out[i * 4 + 2] = (nz / len * 0.5 + 0.5) * 255;
      out[i * 4 + 3] = b.rough[i] * 255;
    }
  }
  return out;
}

/* ============================================================= 一覧 */

export const TEXTURE_GENERATORS = {
  stone: stoneWall,
  cobble,
  dirt: dirtPath,
  grassGround,
  marble,
  wood: (S) => woodPlanks(S, false),
  woodDark: (S) => woodPlanks(S, true),
  bark,
  roofTile,
  roofSlate,
  plaster,
  metal: (S) => metalBrushed(S, false),
  metalDark: (S) => metalBrushed(S, true),
  glass,
  awning: awningCloth,
  fabric,
  leaves: leafCluster,
  grassBlade,
  flowers,
  moss,
  crystal: novaCrystal,
  techPanel,
  sign: signBoard,
  water: waterSurface,
  skin: skinSurface,
  fur,
  obsidian,
  scales
};

/**
 * すべてのテクスチャを合成し、テクスチャ配列へ入れられる形で返す。
 * 名前 → レイヤ番号の対応も返す。
 */
export function generateTextureSet(size = TEX_SIZE) {
  const names = Object.keys(TEXTURE_GENERATORS);
  const albedo = [];
  const normal = [];
  const index = {};
  names.forEach((name, i) => {
    const b = TEXTURE_GENERATORS[name](size);
    albedo.push(b.rgba);
    normal.push(heightToNormal(b, size, name === 'glass' || name === 'water' ? 1.0 : 2.4));
    index[name] = i;
  });
  return { names, index, albedo, normal, size };
}
