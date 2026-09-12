/**
 * 水。青い板にはしない。
 *
 * 川は中心線に沿った帯として作り、頂点に「岸からの深さ」と「流れの速さ」を
 * 入れておく。シェーダ側がそれを使って、岸際に泡を立て、深いところほど
 * 濃く、浅いところは透けるようにする。噴水の水盤と落水も同じ材質で作る。
 */

import { MeshBuilder, ChunkedBuilder } from '../gfx/builder.js';
import { RIVER_PATH } from './terrain.js';
import { clamp } from '../core/math.js';

/** 折れ線を細かく分割して滑らかにする（カトマル・ロム）。 */
function resample(pts, step) {
  const out = [];
  const P = (i) => pts[clamp(i, 0, pts.length - 1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(seg / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
        + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
        + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
        + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
        + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, z]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 川の水面。 */
export function buildRiver(terrain, mats) {
  const chunks = new ChunkedBuilder(30);
  const line = resample(RIVER_PATH, 3.5);
  const cols = 9;                 // 岸から岸まで の分割数
  const halfW = terrain.riverWidth * 0.5 + 1.6;

  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    const nx2 = nx, nz2 = nz;

    const geo = { positions: [], normals: [], uvs: [], indices: [] };
    const depths = [];
    const flows = [];
    for (let row = 0; row < 2; row++) {
      const px = row ? bx : ax, pz = row ? bz : az;
      const rnx = row ? nx2 : nx, rnz = row ? nz2 : nz;
      const along = (i + row) * 3.5;
      for (let c = 0; c <= cols; c++) {
        const u = (c / cols) * 2 - 1;                   // -1..1
        const x = px + rnx * u * halfW;
        const z = pz + rnz * u * halfW;
        const y = terrain.waterHeightAt(x, z);
        geo.positions.push(x, y, z);
        geo.normals.push(0, 1, 0);
        geo.uvs.push(u * halfW * 0.35, along * 0.35);
        // 岸に近いほど浅い。地形との高低差も見て、陸に乗り上げた部分は 0 に
        const bed = terrain.height(x, z);
        const depth = clamp((y - bed) / 1.9, 0, 1);
        const shape = 1 - Math.abs(u);
        depths.push(clamp(Math.min(depth, shape * 1.3), 0, 1));
        flows.push(0.4 + shape * 0.75);
      }
    }
    for (let c = 0; c < cols; c++) {
      const a = c, b = c + 1, d = cols + 1 + c, e = cols + 2 + c;
      geo.indices.push(a, d, b, b, d, e);
    }
    let vi = 0;
    const bld = chunks.at((ax + bx) / 2, (az + bz) / 2);
    bld.add(geo, mats.glass, {
      ao: () => depths[vi],
      wind: () => { const f = flows[vi]; vi++; return f; },
      color: [1, 1, 1]
    });
  }
  return chunks.build();
}

/** 円形の水盤（噴水など）。y は水面の高さ。 */
export function buildPool(cx, cy, cz, radius, mats, segments = 40) {
  const b = new MeshBuilder();
  const geo = { positions: [], normals: [], uvs: [], indices: [] };
  const depths = [];
  const rings = 4;
  geo.positions.push(cx, cy, cz);
  geo.normals.push(0, 1, 0);
  geo.uvs.push(0, 0);
  depths.push(1);
  for (let r = 1; r <= rings; r++) {
    const rad = (r / rings) * radius;
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      geo.positions.push(cx + Math.cos(a) * rad, cy, cz + Math.sin(a) * rad);
      geo.normals.push(0, 1, 0);
      geo.uvs.push(Math.cos(a) * rad * 0.4, Math.sin(a) * rad * 0.4);
      depths.push(clamp(1 - (r / rings) * 0.95, 0.05, 1));
    }
  }
  for (let s = 0; s < segments; s++) {
    const n = (s + 1) % segments;
    geo.indices.push(0, 1 + n, 1 + s);
  }
  for (let r = 1; r < rings; r++) {
    const base = 1 + (r - 1) * segments;
    const next = 1 + r * segments;
    for (let s = 0; s < segments; s++) {
      const sn = (s + 1) % segments;
      geo.indices.push(base + s, next + s, base + sn);
      geo.indices.push(base + sn, next + s, next + sn);
    }
  }
  let vi = 0;
  b.add(geo, mats.glass, {
    ao: () => depths[vi++],
    wind: 0.25
  });
  return b.build();
}
