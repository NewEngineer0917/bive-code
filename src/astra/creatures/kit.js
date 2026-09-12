/**
 * アストラ造形キット。
 *
 * 球・立方体・カプセルを並べて作るのは禁止。ここにあるのは
 *   ・断面を並べて作る胴体（ロフト）
 *   ・骨に沿って太さが変わる四肢
 *   ・目（白目・虹彩・瞳・ハイライト・まぶた・睫毛）
 *   ・角／結晶板／ひれ／毛束／周回する元素
 * といった「生き物の部品」で、これらを組み合わせて種を作る。
 *
 * 全パーツに骨番号が入るので、1 体 1 ドローコールで動かせる。
 */

import { MeshBuilder } from '../gfx/builder.js';
import { sphere, tube, torus, deform, faceted, recomputeNormals } from '../gfx/geo.js';
import { jointWorldPositions } from '../core/skeleton.js';
import { TAU, lerp } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';

/** ジオメトリを移動／拡大したコピー。 */
export function xform(geo, { pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0] } = {}) {
  const [rx, ry, rz] = rot;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const out = {
    positions: new Array(geo.positions.length),
    normals: new Array(geo.normals.length),
    uvs: geo.uvs, indices: geo.indices,
  };
  const apply = (x, y, z) => {
    // Z → X → Y の順で回す
    let a = x * cz - y * sz, b = x * sz + y * cz, c = z;
    let d = b * cx - c * sx, e = b * sx + c * cx;
    let f = a * cy + e * sy, g = -a * sy + e * cy;
    return [f, d, g];
  };
  for (let i = 0; i < geo.positions.length; i += 3) {
    const p = apply(geo.positions[i] * scale[0], geo.positions[i + 1] * scale[1], geo.positions[i + 2] * scale[2]);
    out.positions[i] = p[0] + pos[0];
    out.positions[i + 1] = p[1] + pos[1];
    out.positions[i + 2] = p[2] + pos[2];
    const n = apply(geo.normals[i] / scale[0], geo.normals[i + 1] / scale[1], geo.normals[i + 2] / scale[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    out.normals[i] = n[0] / l; out.normals[i + 1] = n[1] / l; out.normals[i + 2] = n[2] / l;
  }
  return out;
}

/**
 * 胴体。断面（楕円）を前後に並べてロフトする。
 * sections: [{ pos:[x,y,z], rx, ry, bone, squash }]
 * 前後の端は閉じる。断面ごとに骨を割り当てるので、背骨を曲げると胴がしなる。
 */
export function loftBody(sections, opts = {}) {
  const { segments = 16, closeFront = true, closeBack = true, twist = 0 } = opts;
  const geo = { positions: [], normals: [], uvs: [], indices: [] };
  const bones = [];
  const rings = sections.length;
  for (let s = 0; s < rings; s++) {
    const sec = sections[s];
    const prev = sections[Math.max(0, s - 1)];
    const next = sections[Math.min(rings - 1, s + 1)];
    // 断面の向き（背骨の接線）
    let tx = next.pos[0] - prev.pos[0], ty = next.pos[1] - prev.pos[1], tz = next.pos[2] - prev.pos[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    // 接線に垂直な右・上ベクトル
    let ux = 0, uy = 1, uz = 0;
    let rx = uy * tz - uz * ty, ry = uz * tx - ux * tz, rz = ux * ty - uy * tx;
    let rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    const vx = ty * rz - tz * ry, vy = tz * rx - tx * rz, vz = tx * ry - ty * rx;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * TAU + twist * (s / rings);
      let ca = Math.cos(a), sa = Math.sin(a);
      // 下側を平たくして「腹」を作る（真円にすると風船に見える）
      const squash = sec.squash === undefined ? 0.22 : sec.squash;
      const yFlat = sa < 0 ? 1 - squash * (-sa) : 1;
      const ox = rx * ca * sec.rx + vx * sa * sec.ry * yFlat;
      const oy = ry * ca * sec.rx + vy * sa * sec.ry * yFlat;
      const oz = rz * ca * sec.rx + vz * sa * sec.ry * yFlat;
      geo.positions.push(sec.pos[0] + ox, sec.pos[1] + oy, sec.pos[2] + oz);
      const nl = Math.hypot(ox, oy, oz) || 1;
      geo.normals.push(ox / nl, oy / nl, oz / nl);
      geo.uvs.push((i / segments) * 2.2, (s / (rings - 1)) * 2.4);
      bones.push(sec.bone);
    }
  }
  for (let s = 0; s < rings - 1; s++) {
    for (let i = 0; i < segments; i++) {
      const a = s * (segments + 1) + i, b = a + 1, c = a + segments + 1, d = c + 1;
      geo.indices.push(a, c, b, b, c, d);
    }
  }
  const cap = (index, dir) => {
    const sec = sections[index];
    const base = geo.positions.length / 3;
    geo.positions.push(sec.pos[0], sec.pos[1], sec.pos[2] + dir * sec.rx * 0.4);
    geo.normals.push(0, 0, dir);
    geo.uvs.push(0, 0);
    bones.push(sec.bone);
    const start = index * (segments + 1);
    for (let i = 0; i <= segments; i++) {
      const o = (start + i) * 3;
      geo.positions.push(geo.positions[o], geo.positions[o + 1], geo.positions[o + 2]);
      geo.normals.push(geo.normals[o], geo.normals[o + 1], geo.normals[o + 2]);
      geo.uvs.push(0, 0);
      bones.push(sec.bone);
    }
    for (let i = 0; i < segments; i++) {
      if (dir > 0) geo.indices.push(base, base + 1 + i, base + 2 + i);
      else geo.indices.push(base, base + 2 + i, base + 1 + i);
    }
  };
  if (closeFront) cap(rings - 1, 1);
  if (closeBack) cap(0, -1);
  return { geo, bones };
}

/** ロフト結果をビルダへ流し込む（頂点ごとに骨番号を持たせる）。 */
export function addLoft(mb, loft, material, boneIds, opts = {}) {
  let i = 0;
  mb.add(loft.geo, material, {
    ...opts,
    bone: () => boneIds[loft.bones[i++]] ?? 0,
  });
}

/**
 * 四肢。骨のバインド位置をつないだチューブ＋関節球。
 * names: 骨名の配列（付け根 → 先端）
 * radii: 各節の半径
 */
export function buildLimb(mb, mats, joints, boneIds, names, radii, material, opts = {}) {
  const { color = [1, 1, 1], ao = 0.95, jointScale = 1.05, segments = 9, footGeo = null } = opts;
  for (let i = 0; i < names.length - 1; i++) {
    const a = joints[names[i]], b = joints[names[i + 1]];
    const path = [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], b];
    const r0 = radii[i], r1 = radii[i + 1];
    mb.add(tube(path, (t) => lerp(r0, r1, t), segments, { closeStart: i === 0, closeEnd: false }),
      material, { color, ao, bone: boneIds[names[i]] });
    // 関節球（剛体スキニングの折れ目を隠す）
    mb.add(xform(sphere(r1 * jointScale, segments, Math.max(6, segments - 2)), { pos: b }),
      material, { color, ao, bone: boneIds[names[i + 1]] });
  }
  if (footGeo) {
    const last = names[names.length - 1];
    mb.add(xform(footGeo, { pos: joints[last] }), material, { color, ao, bone: boneIds[last] });
  }
}

/**
 * 目。黒丸で終わらせない：白目・虹彩の外輪・虹彩・瞳・ハイライト 2 点・
 * まぶた・睫毛のラインを重ねる。生き物の印象はここで決まる。
 */
export function buildEye(mb, mats, pos, opts = {}) {
  const {
    size = 0.06, bone = 0, iris = [1.0, 0.62, 0.12], pupil = [0.04, 0.03, 0.03],
    facing = [0, 0, 1], slant = 0, lidColor = null, lashColor = [0.05, 0.05, 0.06],
    sclera = [1.5, 1.48, 1.45], glow = 0, squint = 0,
  } = opts;
  const dir = facing;
  const push = (r, offset, color, mat, yScale = 1, ao = 1) => {
    mb.add(xform(sphere(r, 12, 9, { yScale }), {
      pos: [pos[0] + dir[0] * offset, pos[1] + dir[1] * offset, pos[2] + dir[2] * offset],
      rot: [0, 0, slant],
    }), mat, { color, ao, bone });
  };
  // 白目（少し扁平）
  push(size, 0, sclera, mats.skin, 0.86 - squint * 0.3);
  // 虹彩（外輪を濃く）
  push(size * 0.66, size * 0.5, iris.map((c) => c * 0.45), mats.skin, 0.95);
  push(size * 0.54, size * 0.62, iris, glow > 0 ? mats.crystal : mats.skin, 0.95, 1);
  // 瞳
  push(size * 0.27, size * 0.76, pupil, mats.skin, 1.15);
  // ハイライト（大小 2 点あると濡れて見える）
  mb.add(xform(sphere(size * 0.17, 8, 6), {
    pos: [pos[0] + dir[0] * size * 0.86 - size * 0.24, pos[1] + size * 0.26, pos[2] + dir[2] * size * 0.86],
  }), mats.skin, { color: [3, 3, 3.1], ao: 1, bone });
  mb.add(xform(sphere(size * 0.09, 6, 5), {
    pos: [pos[0] + dir[0] * size * 0.84 + size * 0.28, pos[1] - size * 0.3, pos[2] + dir[2] * size * 0.84],
  }), mats.skin, { color: [2.4, 2.4, 2.5], ao: 1, bone });
  // 上まぶた（生き物の「表情」はこの角度で決まる）
  if (lidColor) {
    mb.add(xform(sphere(size * 1.07, 12, 7, { yScale: 0.55, phiLength: Math.PI * 0.5 }), {
      pos: [pos[0], pos[1] + size * 0.28, pos[2]], rot: [0.3, 0, slant],
    }), mats.fur, { color: lidColor, ao: 0.95, bone });
  }
  // 睫毛のライン
  mb.add(xform(torus(size * 0.94, size * 0.09, 14, 5), {
    pos: [pos[0] + dir[0] * size * 0.2, pos[1] + size * 0.02, pos[2] + dir[2] * size * 0.2],
    rot: [Math.PI / 2, 0, slant], scale: [1, 0.35, 1],
  }), mats.fur, { color: lashColor, ao: 1, bone });
}

/** 角・牙・棘。根元が太く先が細い、少し曲がった形。 */
export function buildHorn(mb, mats, from, dir, length, radius, opts = {}) {
  const { color = [1, 1, 1], curve = 0.3, segments = 8, bone = 0, material = null, rings = 0 } = opts;
  const path = [];
  const steps = 6;
  // 曲がりの方向（上向き成分を強める）
  const side = [dir[2], 0, -dir[0]];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const bend = Math.pow(t, 1.8) * curve;
    path.push([
      from[0] + dir[0] * length * t + side[0] * bend * length,
      from[1] + dir[1] * length * t + bend * length * 0.7,
      from[2] + dir[2] * length * t + side[2] * bend * length,
    ]);
  }
  mb.add(tube(path, (t) => radius * (1 - t * 0.92), segments, { closeStart: true }),
    material || mats.fur, { color, ao: (p) => 0.85, bone });
  for (let i = 1; i <= rings; i++) {
    const t = i / (rings + 1);
    const idx = Math.round(t * steps);
    mb.add(xform(torus(radius * (1 - t * 0.9) * 1.22, radius * 0.16, 12, 5),
      { pos: path[idx], rot: [Math.PI / 2 - dir[1] * 1.2, 0, 0] }),
      material || mats.fur, { color: color.map((c) => c * 0.82), ao: 0.9, bone });
  }
  return path[steps];
}

/** 結晶の板（背中や関節に生やす）。面取りせず、鋭い面で。 */
export function buildCrystalPlate(mb, mats, pos, dir, size, opts = {}) {
  const { color = [0.5, 0.95, 1.0], bone = 0, tilt = 0, material = null, sides = 5 } = opts;
  const geo = faceted(deform(sphere(1, sides, 4, { yScale: 1.9 }), (p) => {
    // 先端を尖らせ、根元を平たくする
    const t = (p[1] + 1.9) / 3.8;
    const k = 0.5 + Math.pow(1 - t, 0.7) * 0.7;
    return [p[0] * k, p[1], p[2] * k * 0.42];
  }));
  const ang = Math.atan2(dir[0], dir[2]);
  mb.add(xform(geo, { pos, scale: [size, size, size], rot: [tilt, ang, 0] }),
    material || mats.crystal, { color, ao: 1, bone });
}

/** ひれ・翼膜。半透明にはせず、薄い板に葉脈を入れる。 */
export function buildMembrane(mb, mats, root, tip, spread, opts = {}) {
  const { color = [1, 1, 1], bone = 0, material = null, ribs = 3, curve = 0.25 } = opts;
  const geo = { positions: [], normals: [], uvs: [], indices: [] };
  const cols = 6, rows = 4;
  const dir = [tip[0] - root[0], tip[1] - root[1], tip[2] - root[2]];
  const side = [spread[0], spread[1], spread[2]];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      // 後縁を波打たせる
      const sweep = Math.sin(u * Math.PI) * curve;
      const x = root[0] + dir[0] * u + side[0] * v * (1 - u * 0.35) + dir[0] * sweep * 0.2;
      const y = root[1] + dir[1] * u + side[1] * v * (1 - u * 0.35) + Math.sin(v * Math.PI) * 0.02;
      const z = root[2] + dir[2] * u + side[2] * v * (1 - u * 0.35) + dir[2] * sweep * 0.2;
      geo.positions.push(x, y, z);
      geo.normals.push(0, 1, 0);
      geo.uvs.push(u * 1.6, v * 1.6);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      geo.indices.push(a, d, b, b, d, e, a, b, d, b, e, d);
    }
  }
  recomputeNormals(geo);
  mb.add(geo, material || mats.leaves, { color, ao: 0.95, bone });
  // 骨（筋）
  for (let i = 0; i < ribs; i++) {
    const v = (i + 0.5) / ribs;
    const path = [];
    for (let k = 0; k <= 4; k++) {
      const u = k / 4;
      path.push([
        root[0] + dir[0] * u + side[0] * v * (1 - u * 0.35),
        root[1] + dir[1] * u + side[1] * v * (1 - u * 0.35),
        root[2] + dir[2] * u + side[2] * v * (1 - u * 0.35),
      ]);
    }
    mb.add(tube(path, (t) => 0.012 * (1 - t * 0.7), 5), material || mats.bark,
      { color: color.map((c) => c * 0.8), ao: 1, bone });
  }
}

/** 毛束・鬣（たてがみ）。輪郭をほぐして「置物」感を消す。 */
export function buildFurTuft(mb, mats, pos, dir, length, opts = {}) {
  const { color = [1, 1, 1], bone = 0, count = 5, width = 0.05, material = null, spread = 0.5 } = opts;
  for (let i = 0; i < count; i++) {
    const a = (i / count - 0.5) * spread;
    const d = [
      dir[0] * Math.cos(a) - dir[2] * Math.sin(a),
      dir[1] + (hash2(i, 3, 5) - 0.5) * 0.4,
      dir[0] * Math.sin(a) + dir[2] * Math.cos(a),
    ];
    const len = length * (0.7 + hash2(i, 1, 5) * 0.6);
    const path = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      path.push([
        pos[0] + d[0] * len * t,
        pos[1] + d[1] * len * t - t * t * len * 0.25,
        pos[2] + d[2] * len * t,
      ]);
    }
    mb.add(tube(path, (t) => width * (1 - t * 0.94), 5, { closeStart: true }),
      material || mats.fur, { color, ao: 0.9, bone });
  }
}

/** 元素を体の周りに回らせる（水・火・光の球）。 */
export function buildOrbit(mb, mats, center, radius, count, opts = {}) {
  const { color = [0.6, 0.9, 1.0], size = 0.05, bone = 0, material = null, tilt = 0.3, vary = 0.5 } = opts;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    const r = radius * (1 - vary * 0.3 + hash2(i, 2, 7) * vary * 0.5);
    mb.add(xform(sphere(size * (0.6 + hash2(i, 5, 7) * 0.8), 10, 8, { yScale: 1.3 }), {
      pos: [
        center[0] + Math.cos(a) * r,
        center[1] + Math.sin(a * 2 + tilt) * radius * 0.3,
        center[2] + Math.sin(a) * r,
      ],
    }), material || mats.crystal, { color, ao: 1, bone });
  }
}

/** 骨名 → 骨番号の辞書を作る。 */
export function boneIndex(def) {
  const map = {};
  def.forEach((b, i) => { map[b.name] = i; });
  return map;
}

/** 生き物 1 体を組み立てる共通の入口。 */
export function assembleCreature(mats, def, compose) {
  const mb = new MeshBuilder();
  const joints = jointWorldPositions(def);
  const ids = boneIndex(def);
  const ctx = { mb, mats, joints, ids, def };
  const meta = compose(ctx) || {};
  return { batches: mb.build(), boneCount: def.length, bones: def, joints, ids, ...meta };
}
