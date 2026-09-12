/**
 * 手続き的ジオメトリ生成。
 *
 * すべての建物・小物・生き物は、ここにあるプリミティブと押し出し／回転体を
 * 組み合わせて作る。返す形は `{ positions, normals, uvs, indices }` で統一する。
 * UV は「ワールド 1m = テクスチャ 1 タイル」を基準にしているので、
 * 石壁でも木箱でも同じ材質テクスチャの密度が揃う。
 */

import { TAU, clamp } from '../core/math.js';

function emptyGeo() {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

function addQuad(g, a, b, c, d, uvs) {
  const i = g.positions.length / 3;
  const pts = [a, b, c, d];
  // 法線は 2 辺の外積から
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  for (let k = 0; k < 4; k++) {
    g.positions.push(pts[k][0], pts[k][1], pts[k][2]);
    g.normals.push(nx, ny, nz);
    g.uvs.push(uvs[k * 2], uvs[k * 2 + 1]);
  }
  g.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
}

/** 直方体。中心は原点、size は各辺の長さ。 */
export function box(sx, sy, sz, opts = {}) {
  const { uvScale = 1, top = true, bottom = true } = opts;
  const g = emptyGeo();
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const u = uvScale;
  const q = (a, b, c, d, w, h) => addQuad(g, a, b, c, d, [0, 0, w * u, 0, w * u, h * u, 0, h * u]);
  q([-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], sx, sy);      // +Z
  q([hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], sx, sy);  // -Z
  q([hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], sz, sy);      // +X
  q([-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], sz, sy);  // -X
  if (top) q([-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], sx, sz);
  if (bottom) q([-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], sx, sz);
  return g;
}

/** 面取りした直方体。石材や家具の角を柔らかくして安っぽさを消す。 */
export function beveledBox(sx, sy, sz, bevel = 0.03, opts = {}) {
  const b = Math.min(bevel, sx / 2.5, sy / 2.5, sz / 2.5);
  const g = emptyGeo();
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const uvScale = opts.uvScale || 1;
  // 内側に寄せた 8 頂点の組み合わせで 6 面 + 12 辺 + 8 角を張る
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const sxp = (i & 1) ? 1 : -1, syp = (i & 2) ? 1 : -1, szp = (i & 4) ? 1 : -1;
    corners.push([sxp * (hx - b), syp * (hy - b), szp * (hz - b), sxp, syp, szp]);
  }
  const pushTri = (p0, p1, p2, n) => {
    const i = g.positions.length / 3;
    for (const p of [p0, p1, p2]) {
      g.positions.push(p[0], p[1], p[2]);
      g.normals.push(n[0], n[1], n[2]);
      g.uvs.push((p[0] + p[2]) * uvScale, (p[1] + p[2] * 0.0) * uvScale);
    }
    g.indices.push(i, i + 1, i + 2);
  };
  const faceQuad = (axis, sign) => {
    const n = [0, 0, 0]; n[axis] = sign;
    const pts = corners.filter((c) => c[3 + axis] === sign).map((c) => {
      const p = [c[0], c[1], c[2]];
      p[axis] = sign * (axis === 0 ? hx : axis === 1 ? hy : hz);
      return p;
    });
    // 正しい巻き順に並べ替え
    const a0 = (axis + 1) % 3, a1 = (axis + 2) % 3;
    pts.sort((p, q2) => Math.atan2(p[a1], p[a0]) - Math.atan2(q2[a1], q2[a0]));
    if (pts.length === 4) {
      const ordered = sign > 0 ? pts : [pts[0], pts[3], pts[2], pts[1]];
      const i = g.positions.length / 3;
      for (const p of ordered) {
        g.positions.push(p[0], p[1], p[2]);
        g.normals.push(n[0], n[1], n[2]);
        g.uvs.push(p[a0] * uvScale, p[a1] * uvScale);
      }
      g.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  };
  for (let axis = 0; axis < 3; axis++) { faceQuad(axis, 1); faceQuad(axis, -1); }
  // 角（球の一部を面で近似）と辺を 1 枚の三角で埋める（小さいので十分）
  for (const c of corners) {
    const n = [c[3], c[4], c[5]];
    const l = Math.sqrt(3);
    const nn = [n[0] / l, n[1] / l, n[2] / l];
    const px = [c[0] + n[0] * b, c[1], c[2]];
    const py = [c[0], c[1] + n[1] * b, c[2]];
    const pz = [c[0], c[1], c[2] + n[2] * b];
    const flip = n[0] * n[1] * n[2] > 0;
    if (flip) pushTri(px, py, pz, nn); else pushTri(px, pz, py, nn);
  }
  for (let axis = 0; axis < 3; axis++) {
    const a0 = (axis + 1) % 3, a1 = (axis + 2) % 3;
    for (const s0 of [-1, 1]) for (const s1 of [-1, 1]) {
      const ends = corners.filter((c) => c[3 + a0] === s0 && c[3 + a1] === s1);
      ends.sort((p, q2) => p[axis] - q2[axis]);
      const [lo, hi] = ends;
      const mk = (c, which) => {
        const p = [c[0], c[1], c[2]];
        p[which] += c[3 + which] * b;
        return p;
      };
      const n = [0, 0, 0]; n[a0] = s0 / Math.SQRT2; n[a1] = s1 / Math.SQRT2;
      const p0 = mk(lo, a0), p1 = mk(lo, a1), p2 = mk(hi, a1), p3 = mk(hi, a0);
      const winding = s0 * s1 * (axis === 1 ? -1 : 1) > 0;
      if (winding) addQuad(g, p0, p1, p2, p3, [0, 0, 1, 0, 1, 1, 0, 1]);
      else addQuad(g, p3, p2, p1, p0, [0, 0, 1, 0, 1, 1, 0, 1]);
      // 法線を辺方向に上書きして光の乗りを良くする
      for (let k = 0; k < 4; k++) {
        const idx = g.normals.length - 12 + k * 3;
        g.normals[idx] = n[0]; g.normals[idx + 1] = n[1]; g.normals[idx + 2] = n[2];
      }
    }
  }
  return g;
}

/** XZ 平面の板。subdiv を上げると風で揺らす頂点が増える。 */
export function plane(sx, sz, subdiv = 1, opts = {}) {
  const { uvScale = 1, y = 0, flip = false } = opts;
  const g = emptyGeo();
  for (let j = 0; j <= subdiv; j++) {
    for (let i = 0; i <= subdiv; i++) {
      const fx = i / subdiv, fz = j / subdiv;
      g.positions.push((fx - 0.5) * sx, y, (fz - 0.5) * sz);
      g.normals.push(0, flip ? -1 : 1, 0);
      g.uvs.push(fx * sx * uvScale, fz * sz * uvScale);
    }
  }
  for (let j = 0; j < subdiv; j++) {
    for (let i = 0; i < subdiv; i++) {
      const a = j * (subdiv + 1) + i, b = a + 1, c = a + subdiv + 1, d = c + 1;
      if (flip) g.indices.push(a, b, c, b, d, c);
      else g.indices.push(a, c, b, b, c, d);
    }
  }
  return g;
}

/** Y 軸に沿った円柱／円錐台。 */
export function cylinder(rBottom, rTop, height, segments = 16, opts = {}) {
  const { caps = true, uvScale = 1, yOffset = 0, arc = TAU, twist = 0 } = opts;
  const g = emptyGeo();
  const slope = Math.atan2(rBottom - rTop, height);
  const cs = Math.cos(slope), sn = Math.sin(slope);
  const closed = Math.abs(arc - TAU) < 1e-6;
  const cols = closed ? segments : segments;
  for (let i = 0; i <= cols; i++) {
    const t = i / segments;
    const a = t * arc;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j < 2; j++) {
      const r = j ? rTop : rBottom;
      const y = j ? height : 0;
      const tw = twist * (j ? 1 : 0);
      const ca2 = Math.cos(a + tw), sa2 = Math.sin(a + tw);
      g.positions.push(ca2 * r, y + yOffset, sa2 * r);
      g.normals.push(ca * cs, sn, sa * cs);
      g.uvs.push(t * arc * (rBottom + rTop) * 0.5 * uvScale, (j ? height : 0) * uvScale);
    }
  }
  for (let i = 0; i < cols; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    g.indices.push(a, c, b, b, c, d);
  }
  if (caps) {
    for (const [r, y, ny] of [[rTop, height, 1], [rBottom, 0, -1]]) {
      if (r <= 0.0001) continue;
      const center = g.positions.length / 3;
      g.positions.push(0, y + yOffset, 0); g.normals.push(0, ny, 0); g.uvs.push(0, 0);
      for (let i = 0; i <= cols; i++) {
        const a = (i / segments) * arc;
        g.positions.push(Math.cos(a) * r, y + yOffset, Math.sin(a) * r);
        g.normals.push(0, ny, 0);
        g.uvs.push(Math.cos(a) * r * uvScale, Math.sin(a) * r * uvScale);
      }
      for (let i = 0; i < cols; i++) {
        if (ny > 0) g.indices.push(center, center + 1 + i, center + 2 + i);
        else g.indices.push(center, center + 2 + i, center + 1 + i);
      }
    }
  }
  return g;
}

/** UV 球（生き物の胴体・果物・水滴などの土台）。 */
export function sphere(radius, segments = 16, rings = 12, opts = {}) {
  const { uvScale = 1, yScale = 1, phiStart = 0, phiLength = Math.PI } = opts;
  const g = emptyGeo();
  for (let j = 0; j <= rings; j++) {
    const phi = phiStart + (j / rings) * phiLength;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let i = 0; i <= segments; i++) {
      const th = (i / segments) * TAU;
      const nx = sp * Math.cos(th), ny = cp, nz = sp * Math.sin(th);
      g.positions.push(nx * radius, ny * radius * yScale, nz * radius);
      const l = Math.hypot(nx, ny / yScale, nz) || 1;
      g.normals.push(nx / l, (ny / yScale) / l, nz / l);
      g.uvs.push((i / segments) * TAU * radius * uvScale, (j / rings) * Math.PI * radius * uvScale);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1;
      if (j !== 0) g.indices.push(a, c, b);
      if (j !== rings - 1) g.indices.push(b, c, d);
    }
  }
  return g;
}

/** ドーナツ形（リング状の VFX、装飾、輪）。 */
export function torus(radius, tube, seg = 24, tubeSeg = 10) {
  const g = emptyGeo();
  for (let j = 0; j <= tubeSeg; j++) {
    const v = (j / tubeSeg) * TAU;
    for (let i = 0; i <= seg; i++) {
      const u = (i / seg) * TAU;
      const cx = Math.cos(u) * radius, cz = Math.sin(u) * radius;
      const nx = Math.cos(u) * Math.cos(v), ny = Math.sin(v), nz = Math.sin(u) * Math.cos(v);
      g.positions.push(cx + nx * tube, ny * tube, cz + nz * tube);
      g.normals.push(nx, ny, nz);
      g.uvs.push(i / seg * radius * TAU, j / tubeSeg * tube * TAU);
    }
  }
  for (let j = 0; j < tubeSeg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      g.indices.push(a, c, b, b, c, d);
    }
  }
  return g;
}

/**
 * 回転体。profile は [[半径, 高さ], ...] を下から上へ並べたもの。
 * 噴水・柱・壺・街灯・木の幹など、町の「丸いもの」はすべてこれで作る。
 */
export function lathe(profile, segments = 20, opts = {}) {
  const { uvScale = 1, capBottom = false, capTop = false } = opts;
  const g = emptyGeo();
  const rows = profile.length;
  for (let j = 0; j < rows; j++) {
    const [r, y] = profile[j];
    const prev = profile[Math.max(0, j - 1)];
    const next = profile[Math.min(rows - 1, j + 1)];
    const dr = next[0] - prev[0], dy = next[1] - prev[1];
    const nl = Math.hypot(dr, dy) || 1;
    const nr = dy / nl, ny = -dr / nl;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      g.positions.push(ca * r, y, sa * r);
      g.normals.push(ca * nr, ny, sa * nr);
      g.uvs.push((i / segments) * TAU * Math.max(r, 0.1) * uvScale, y * uvScale);
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1;
      g.indices.push(a, c, b, b, c, d);
    }
  }
  if (capBottom) {
    const [r, y] = profile[0];
    const center = g.positions.length / 3;
    g.positions.push(0, y, 0); g.normals.push(0, -1, 0); g.uvs.push(0, 0);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * TAU;
      g.positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
      g.normals.push(0, -1, 0);
      g.uvs.push(Math.cos(a) * r * uvScale, Math.sin(a) * r * uvScale);
    }
    for (let i = 0; i < segments; i++) g.indices.push(center, center + 2 + i, center + 1 + i);
  }
  if (capTop) {
    const [r, y] = profile[rows - 1];
    const center = g.positions.length / 3;
    g.positions.push(0, y, 0); g.normals.push(0, 1, 0); g.uvs.push(0, 0);
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * TAU;
      g.positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
      g.normals.push(0, 1, 0);
      g.uvs.push(Math.cos(a) * r * uvScale, Math.sin(a) * r * uvScale);
    }
    for (let i = 0; i < segments; i++) g.indices.push(center, center + 1 + i, center + 2 + i);
  }
  return g;
}

/** 多角形を三角形分割（耳切り法）。凹んだ敷地形状にも対応する。 */
export function triangulate(points) {
  const n = points.length;
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) idx.reverse();
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 4000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = points[i0], b = points[i1], c = points[i2];
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross <= 0) continue;
      let contains = false;
      for (const k of idx) {
        if (k === i0 || k === i1 || k === i2) continue;
        const p = points[k];
        const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        const d2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
        const d3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
        if (d1 >= 0 && d2 >= 0 && d3 >= 0) { contains = true; break; }
      }
      if (contains) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/**
 * 平面多角形（XZ）を Y 方向に押し出す。建物の躯体・台座・花壇に使う。
 * points は [[x, z], ...]。
 */
export function extrude(points, y0, y1, opts = {}) {
  const { uvScale = 1, cap = true, capBottom = false, inset = 0 } = opts;
  const g = emptyGeo();
  const pts = inset ? insetPolygon(points, inset) : points;
  const n = pts.length;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    addQuad(g,
      [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]],
      [run * uvScale, y0 * uvScale, (run + len) * uvScale, y0 * uvScale,
        (run + len) * uvScale, y1 * uvScale, run * uvScale, y1 * uvScale]);
    run += len;
  }
  if (cap) {
    const tris = triangulate(pts);
    const base = g.positions.length / 3;
    for (const p of pts) {
      g.positions.push(p[0], y1, p[1]);
      g.normals.push(0, 1, 0);
      g.uvs.push(p[0] * uvScale, p[1] * uvScale);
    }
    for (const t of tris) g.indices.push(base + t[0], base + t[2], base + t[1]);
  }
  if (capBottom) {
    const tris = triangulate(pts);
    const base = g.positions.length / 3;
    for (const p of pts) {
      g.positions.push(p[0], y0, p[1]);
      g.normals.push(0, -1, 0);
      g.uvs.push(p[0] * uvScale, p[1] * uvScale);
    }
    for (const t of tris) g.indices.push(base + t[0], base + t[1], base + t[2]);
  }
  return g;
}

/** 多角形を内側に縮める（軒・胴蛇腹・窓枠づくり用）。 */
export function insetPolygon(points, amount) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n], cur = points[i], next = points[(i + 1) % n];
    const d0x = cur[0] - prev[0], d0z = cur[1] - prev[1];
    const d1x = next[0] - cur[0], d1z = next[1] - cur[1];
    const l0 = Math.hypot(d0x, d0z) || 1, l1 = Math.hypot(d1x, d1z) || 1;
    const n0x = d0z / l0, n0z = -d0x / l0;
    const n1x = d1z / l1, n1z = -d1x / l1;
    let bx = n0x + n1x, bz = n0z + n1z;
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl; bz /= bl;
    const cosHalf = Math.max(0.35, (n0x * bx + n0z * bz));
    out.push([cur[0] - bx * amount / cosHalf, cur[1] - bz * amount / cosHalf]);
  }
  return out;
}

/**
 * 曲線に沿ったチューブ。枝・つる・尻尾・パイプ・水流に使う。
 * path は [[x,y,z], ...]、radiusAt(t) で太さを変えられる。
 */
export function tube(path, radiusAt, segments = 8, opts = {}) {
  const { uvScale = 1, closeStart = false, closeEnd = false } = opts;
  const g = emptyGeo();
  const rows = path.length;
  let up = [0, 1, 0];
  for (let j = 0; j < rows; j++) {
    const p = path[j];
    const prev = path[Math.max(0, j - 1)];
    const next = path[Math.min(rows - 1, j + 1)];
    let tx = next[0] - prev[0], ty = next[1] - prev[1], tz = next[2] - prev[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    let nx = up[1] * tz - up[2] * ty, ny = up[2] * tx - up[0] * tz, nz = up[0] * ty - up[1] * tx;
    let nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-4) { up = [1, 0, 0]; nx = up[1] * tz - up[2] * ty; ny = up[2] * tx - up[0] * tz; nz = up[0] * ty - up[1] * tx; nl = Math.hypot(nx, ny, nz) || 1; }
    nx /= nl; ny /= nl; nz /= nl;
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const r = typeof radiusAt === 'function' ? radiusAt(j / (rows - 1), j) : radiusAt;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const ox = nx * ca + bx * sa, oy = ny * ca + by * sa, oz = nz * ca + bz * sa;
      g.positions.push(p[0] + ox * r, p[1] + oy * r, p[2] + oz * r);
      g.normals.push(ox, oy, oz);
      g.uvs.push((i / segments) * TAU * r * uvScale, (j / (rows - 1)) * uvScale * 4);
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1;
      g.indices.push(a, c, b, b, c, d);
    }
  }
  const cap = (rowIndex, dir) => {
    const p = path[rowIndex];
    const base = g.positions.length / 3;
    g.positions.push(p[0], p[1], p[2]); g.normals.push(0, dir, 0); g.uvs.push(0, 0);
    const start = rowIndex * (segments + 1);
    for (let i = 0; i <= segments; i++) {
      const o = (start + i) * 3;
      g.positions.push(g.positions[o], g.positions[o + 1], g.positions[o + 2]);
      g.normals.push(0, dir, 0); g.uvs.push(0, 0);
    }
    for (let i = 0; i < segments; i++) {
      if (dir > 0) g.indices.push(base, base + 1 + i, base + 2 + i);
      else g.indices.push(base, base + 2 + i, base + 1 + i);
    }
  };
  if (closeStart) cap(0, -1);
  if (closeEnd) cap(rows - 1, 1);
  return g;
}

/** 切妻屋根。幅 sx・奥行 sz・高さ h、overhang で軒を出す。 */
export function gableRoof(sx, sz, h, overhang = 0.25, opts = {}) {
  const { uvScale = 1, ridgeShift = 0 } = opts;
  const g = emptyGeo();
  const hx = sx / 2 + overhang, hz = sz / 2 + overhang;
  const ridge = ridgeShift;
  const slopeLen = Math.hypot(hx, h);
  addQuad(g, [-hx, 0, hz], [hx, 0, hz], [hx + 0, h, ridge], [-hx, h, ridge],
    [0, 0, sx * uvScale, 0, sx * uvScale, slopeLen * uvScale, 0, slopeLen * uvScale]);
  addQuad(g, [hx, 0, -hz], [-hx, 0, -hz], [-hx, h, ridge], [hx, h, ridge],
    [0, 0, sx * uvScale, 0, sx * uvScale, slopeLen * uvScale, 0, slopeLen * uvScale]);
  // 妻側の三角
  const tri = (x, flip) => {
    const i = g.positions.length / 3;
    const pts = [[x, 0, hz], [x, 0, -hz], [x, h, ridge]];
    for (const p of pts) {
      g.positions.push(p[0], p[1], p[2]);
      g.normals.push(flip ? -1 : 1, 0, 0);
      g.uvs.push(p[2] * uvScale, p[1] * uvScale);
    }
    if (flip) g.indices.push(i, i + 1, i + 2); else g.indices.push(i, i + 2, i + 1);
  };
  tri(hx, false); tri(-hx, true);
  return g;
}

/** 寄棟屋根（四方に流れる）。 */
export function hipRoof(sx, sz, h, overhang = 0.25, ridgeRatio = 0.45, opts = {}) {
  const { uvScale = 1 } = opts;
  const g = emptyGeo();
  const hx = sx / 2 + overhang, hz = sz / 2 + overhang;
  const rz = hz * ridgeRatio;
  // 前後の台形
  addQuad(g, [-hx, 0, hz], [hx, 0, hz], [hx * 0.35, h, rz], [-hx * 0.35, h, rz], [0, 0, sx * uvScale, 0, sx * 0.7 * uvScale, uvScale * h * 1.6, sx * 0.3 * uvScale, uvScale * h * 1.6]);
  addQuad(g, [hx, 0, -hz], [-hx, 0, -hz], [-hx * 0.35, h, -rz], [hx * 0.35, h, -rz], [0, 0, sx * uvScale, 0, sx * 0.7 * uvScale, uvScale * h * 1.6, sx * 0.3 * uvScale, uvScale * h * 1.6]);
  // 左右の三角
  addQuad(g, [hx, 0, hz], [hx, 0, -hz], [hx * 0.35, h, -rz], [hx * 0.35, h, rz], [0, 0, sz * uvScale, 0, sz * 0.7 * uvScale, uvScale * h * 1.6, sz * 0.3 * uvScale, uvScale * h * 1.6]);
  addQuad(g, [-hx, 0, -hz], [-hx, 0, hz], [-hx * 0.35, h, rz], [-hx * 0.35, h, -rz], [0, 0, sz * uvScale, 0, sz * 0.7 * uvScale, uvScale * h * 1.6, sz * 0.3 * uvScale, uvScale * h * 1.6]);
  return g;
}

/** 反りのある屋根（研究所・神社など、直線にしたくない建物用）。 */
export function curvedRoof(sx, sz, h, curve = 0.35, segments = 6, opts = {}) {
  const { uvScale = 1, overhang = 0.4 } = opts;
  const g = emptyGeo();
  const hx = sx / 2 + overhang, hz = sz / 2 + overhang;
  const profile = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const z = (1 - t) * hz;
    const y = h * Math.sin(t * Math.PI * 0.5) + curve * h * Math.sin(t * Math.PI) * -0.5;
    profile.push([z, y]);
  }
  for (const side of [1, -1]) {
    for (let i = 0; i < segments; i++) {
      const [z0, y0] = profile[i], [z1, y1] = profile[i + 1];
      addQuad(g,
        [-hx, y0, z0 * side], [hx, y0, z0 * side], [hx, y1, z1 * side], [-hx, y1, z1 * side],
        [0, i * uvScale, sx * uvScale, i * uvScale, sx * uvScale, (i + 1) * uvScale, 0, (i + 1) * uvScale]);
      if (side < 0) {
        // 巻き順を裏返す
        const n = g.indices.length;
        const t = g.indices[n - 6]; g.indices[n - 6] = g.indices[n - 5]; g.indices[n - 5] = t;
        const t2 = g.indices[n - 3]; g.indices[n - 3] = g.indices[n - 2]; g.indices[n - 2] = t2;
        for (let k = 0; k < 4; k++) {
          const idx = g.normals.length - 12 + k * 3;
          g.normals[idx] *= -1; g.normals[idx + 1] *= -1; g.normals[idx + 2] *= -1;
        }
      }
    }
  }
  for (const x of [hx, -hx]) {
    const base = g.positions.length / 3;
    const nx = x > 0 ? 1 : -1;
    g.positions.push(x, 0, 0); g.normals.push(nx, 0, 0); g.uvs.push(0, 0);
    for (const side of [1, -1]) {
      for (let i = 0; i <= segments; i++) {
        const [z, y] = profile[i];
        g.positions.push(x, y, z * side);
        g.normals.push(nx, 0, 0);
        g.uvs.push(z * side * uvScale, y * uvScale);
      }
    }
    const cnt = (segments + 1) * 2;
    for (let i = 1; i < cnt; i++) {
      if (nx > 0) g.indices.push(base, base + i, base + i + 1);
      else g.indices.push(base, base + i + 1, base + i);
    }
  }
  return g;
}

/** 階段。高低差のある町を歩けるようにする。 */
export function stairs(width, totalRise, totalRun, steps = 6, opts = {}) {
  const { uvScale = 1 } = opts;
  const g = emptyGeo();
  const rise = totalRise / steps, run = totalRun / steps;
  for (let i = 0; i < steps; i++) {
    const y = i * rise, z = i * run;
    const tread = box(width, rise, run, { uvScale });
    const off = [0, y + rise / 2, z + run / 2];
    const base = g.positions.length / 3;
    for (let k = 0; k < tread.positions.length; k += 3) {
      g.positions.push(tread.positions[k] + off[0], tread.positions[k + 1] + off[1], tread.positions[k + 2] + off[2]);
    }
    g.normals.push(...tread.normals);
    g.uvs.push(...tread.uvs);
    for (const idx of tread.indices) g.indices.push(base + idx);
  }
  return g;
}

/** 三角形の集合を「面ごとに分離した法線」に作り直す（結晶やロー面の表現用）。 */
export function faceted(g) {
  const out = emptyGeo();
  for (let i = 0; i < g.indices.length; i += 3) {
    const ia = g.indices[i], ib = g.indices[i + 1], ic = g.indices[i + 2];
    const p = (k) => [g.positions[k * 3], g.positions[k * 3 + 1], g.positions[k * 3 + 2]];
    const a = p(ia), b = p(ib), c = p(ic);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = out.positions.length / 3;
    for (const [k, q] of [[ia, a], [ib, b], [ic, c]]) {
      out.positions.push(q[0], q[1], q[2]);
      out.normals.push(nx, ny, nz);
      out.uvs.push(g.uvs[k * 2], g.uvs[k * 2 + 1]);
    }
    out.indices.push(base, base + 1, base + 2);
  }
  return out;
}

/** 頂点を関数で動かす（幹のうねり、岩の凹凸、結晶の歪みなど）。 */
export function deform(g, fn) {
  for (let i = 0; i < g.positions.length; i += 3) {
    const p = [g.positions[i], g.positions[i + 1], g.positions[i + 2]];
    const q = fn(p, i / 3);
    g.positions[i] = q[0]; g.positions[i + 1] = q[1]; g.positions[i + 2] = q[2];
  }
  return recomputeNormals(g);
}

/** 面法線の平均から頂点法線を作り直す。 */
export function recomputeNormals(g) {
  const n = g.positions.length / 3;
  const acc = new Float32Array(n * 3);
  for (let i = 0; i < g.indices.length; i += 3) {
    const ia = g.indices[i], ib = g.indices[i + 1], ic = g.indices[i + 2];
    const ax = g.positions[ia * 3], ay = g.positions[ia * 3 + 1], az = g.positions[ia * 3 + 2];
    const bx = g.positions[ib * 3], by = g.positions[ib * 3 + 1], bz = g.positions[ib * 3 + 2];
    const cx = g.positions[ic * 3], cy = g.positions[ic * 3 + 1], cz = g.positions[ic * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [ia, ib, ic]) {
      acc[k * 3] += nx; acc[k * 3 + 1] += ny; acc[k * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2]) || 1;
    g.normals[i * 3] = acc[i * 3] / l;
    g.normals[i * 3 + 1] = acc[i * 3 + 1] / l;
    g.normals[i * 3 + 2] = acc[i * 3 + 2] / l;
  }
  return g;
}

/** 交差する 2 枚のクロスボード（草・葉・低木を安く密に見せる基本形）。 */
export function crossBillboard(width, height, blades = 2, opts = {}) {
  const { bend = 0, taper = 0.5, rows = 3 } = opts;
  const g = emptyGeo();
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI;
    const dx = Math.cos(a), dz = Math.sin(a);
    const base = g.positions.length / 3;
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const w = (width / 2) * (1 - t * taper);
      const y = height * t;
      const off = bend * t * t;
      g.positions.push(-dx * w + dz * off, y, -dz * w - dx * off);
      g.normals.push(dz, 0.45, -dx);
      g.uvs.push(0, t);
      g.positions.push(dx * w + dz * off, y, dz * w - dx * off);
      g.normals.push(dz, 0.45, -dx);
      g.uvs.push(1, t);
    }
    for (let r = 0; r < rows; r++) {
      const i = base + r * 2;
      g.indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  return g;
}

/** 岩。球をノイズで潰して面取りを消す。 */
export function rock(radius, seed = 1, detail = 10) {
  const g = sphere(radius, detail + 4, detail, { yScale: 0.75 });
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const freqs = [];
  for (let i = 0; i < 4; i++) freqs.push([rnd() * 6 + 1, rnd() * 6 + 1, rnd() * 6 + 1, rnd() * TAU]);
  return faceted(deform(g, (p) => {
    let d = 0;
    for (const [fx, fy, fz, ph] of freqs) {
      d += Math.sin(p[0] * fx / radius + ph) * Math.cos(p[2] * fz / radius + ph) * Math.sin(p[1] * fy / radius + ph);
    }
    const k = 1 + d * 0.12;
    return [p[0] * k, Math.max(0, p[1] * k) * 1.0, p[2] * k];
  }));
}

export { emptyGeo, addQuad, clamp };
