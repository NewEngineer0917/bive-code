/**
 * 人間のキャラクター（プレイヤーと NPC）。
 *
 * 1 体 1 ドローコールで動かせるよう、全パーツを 1 つのメッシュに焼き、
 * 頂点ごとに骨番号を持たせる（剛体スキニング）。関節は球で覆うので、
 * 肘や膝が曲がっても割れて見えない。
 *
 * 体型・肌・髪・服の色・小物を振ることで、同じ骨組みから違う人を作る。
 */

import { jointWorldPositions } from '../core/skeleton.js';
import { sphere, cylinder, beveledBox, lathe, tube, torus } from '../gfx/geo.js';
import { MeshBuilder } from '../gfx/builder.js';
import { clamp, lerp } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';

/** 人型の骨組み。単位はメートル、身長 1.72 を基準にしている。 */
export const HUMAN_BONES = [
  { name: 'root', offset: [0, 0, 0] },
  { name: 'hips', parent: 'root', offset: [0, 0.9, 0] },
  { name: 'spine', parent: 'hips', offset: [0, 0.14, 0] },
  { name: 'chest', parent: 'spine', offset: [0, 0.19, 0] },
  { name: 'neck', parent: 'chest', offset: [0, 0.2, 0] },
  { name: 'head', parent: 'neck', offset: [0, 0.08, 0] },
  { name: 'shoulderL', parent: 'chest', offset: [0.08, 0.14, 0] },
  { name: 'armL', parent: 'shoulderL', offset: [0.11, -0.02, 0] },
  { name: 'foreArmL', parent: 'armL', offset: [0, -0.27, 0] },
  { name: 'handL', parent: 'foreArmL', offset: [0, -0.25, 0] },
  { name: 'shoulderR', parent: 'chest', offset: [-0.08, 0.14, 0] },
  { name: 'armR', parent: 'shoulderR', offset: [-0.11, -0.02, 0] },
  { name: 'foreArmR', parent: 'armR', offset: [0, -0.27, 0] },
  { name: 'handR', parent: 'foreArmR', offset: [0, -0.25, 0] },
  { name: 'thighL', parent: 'hips', offset: [0.095, -0.06, 0] },
  { name: 'shinL', parent: 'thighL', offset: [0, -0.42, 0] },
  { name: 'footL', parent: 'shinL', offset: [0, -0.4, 0] },
  { name: 'thighR', parent: 'hips', offset: [-0.095, -0.06, 0] },
  { name: 'shinR', parent: 'thighR', offset: [0, -0.42, 0] },
  { name: 'footR', parent: 'shinR', offset: [0, -0.4, 0] },
];

export const HUMAN_JOINTS = jointWorldPositions(HUMAN_BONES);

const BONE_ID = {};
HUMAN_BONES.forEach((b, i) => { BONE_ID[b.name] = i; });

export const SKIN_TONES = [
  [1.08, 0.7, 0.52], [0.98, 0.6, 0.42], [0.82, 0.47, 0.3],
  [0.6, 0.33, 0.21], [0.42, 0.22, 0.15], [1.1, 0.78, 0.6],
];
export const HAIR_COLORS = [
  [0.14, 0.11, 0.1], [0.3, 0.18, 0.1], [0.55, 0.38, 0.18],
  [0.75, 0.62, 0.38], [0.5, 0.52, 0.58], [0.3, 0.4, 0.6], [0.6, 0.3, 0.36],
];
export const CLOTH_COLORS = [
  [0.28, 0.36, 0.52], [0.36, 0.5, 0.44], [0.62, 0.36, 0.32], [0.85, 0.8, 0.7],
  [0.44, 0.36, 0.55], [0.8, 0.66, 0.4], [0.24, 0.28, 0.34], [0.72, 0.78, 0.84],
];

/** 骨に紐づけて部品を足す小さなヘルパ。 */
function part(mb, mats, geo, bone, mat, opts = {}) {
  mb.add(geo, mat, { ...opts, bone: BONE_ID[bone] });
}

/**
 * 人間メッシュを作る。
 * look: { skin, hair, hairStyle, top, bottom, apron, hat, height, build, accessory }
 */
export function buildHuman(mats, look = {}) {
  const J = HUMAN_JOINTS;
  const mb = new MeshBuilder();
  const skin = look.skin || SKIN_TONES[0];
  const hair = look.hair || HAIR_COLORS[0];
  const top = look.top || CLOTH_COLORS[0];
  const bottom = look.bottom || CLOTH_COLORS[6];
  const shoe = look.shoe || [0.24, 0.2, 0.18];
  const build = look.build === undefined ? 1 : look.build;   // 0.85 細身 〜 1.2 がっしり

  const limb = (bone, from, to, r0, r1, mat, color, segs = 9) => {
    const path = [from, [
      lerp(from[0], to[0], 0.5), lerp(from[1], to[1], 0.5), lerp(from[2], to[2], 0.5),
    ], to];
    part(mb, mats, tube(path, (t) => lerp(r0, r1, t), segs, { closeStart: true, closeEnd: true }),
      bone, mat, { color, ao: 0.92 });
  };

  // ---- 胴体
  // 箱ではなく回転体で作り、腰でくびれ胸で広がるシルエットにする。
  const hipsP = J.hips, chestP = J.chest, neckP = J.neck, headP = J.head;

  // 腰まわり（ズボン）
  {
    const profile = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const y = lerp(hipsP[1] - 0.14, hipsP[1] + 0.08, t);
      profile.push([(0.135 + Math.sin(t * Math.PI * 0.8) * 0.022) * build, y]);
    }
    part(mb, mats, lathe(profile, 18, { capBottom: true, capTop: true }), 'hips', mats.fabric,
      { color: bottom, ao: (p) => clamp(0.72 + (p[1] - hipsP[1]) * 0.5, 0.7, 1) });
  }

  // 上半身（上着）。首の付け根までつなげて、隙間ができないようにする
  {
    const profile = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = lerp(hipsP[1] - 0.06, neckP[1] + 0.01, t);
      // ウエストでくびれ、胸でふくらみ、肩で絞る
      const waist = Math.exp(-Math.pow((t - 0.28) / 0.22, 2)) * 0.026;
      const bust = Math.exp(-Math.pow((t - 0.72) / 0.26, 2)) * 0.042;
      const shoulder = Math.pow(clamp((t - 0.88) / 0.12, 0, 1), 1.4) * 0.075;
      profile.push([(0.152 - waist + bust - shoulder) * build, y]);
    }
    part(mb, mats, lathe(profile, 20, { capBottom: false, capTop: false }), 'chest', mats.fabric,
      { color: top, ao: (p) => clamp(0.7 + (p[1] - hipsP[1]) * 0.42, 0.7, 1) });
    // 肩の張り出し（三角筋）
    for (const side of [-1, 1]) {
      part(mb, mats, translated(sphere(0.072 * build, 12, 9, { yScale: 0.85 }),
        side * 0.135 * build, chestP[1] + 0.12, 0), 'chest', mats.fabric, { color: top, ao: 0.95 });
    }
    // 背中側を少し厚くして板に見せない
    part(mb, mats, translated(sphere(0.1 * build, 14, 10, { yScale: 1.5 }), 0, chestP[1] + 0.02, -0.03),
      'chest', mats.fabric, { color: top.map((c) => c * 0.96), ao: 0.9 });
  }
  // 襟
  part(mb, mats, translated(lathe([[0.072, 0], [0.082, 0.03], [0.076, 0.07]], 14), 0, neckP[1] - 0.035, 0),
    'neck', mats.fabric, { color: top.map((v) => Math.min(1.4, v * 1.25 + 0.04)), ao: 0.95 });
  // 首
  part(mb, mats, translated(cylinder(0.05, 0.052, 0.12, 12, { yOffset: -0.05 }), 0, neckP[1], 0),
    'neck', mats.skin, { color: skin.map((c) => c * 0.94), ao: 0.82 });

  // ---- 頭
  const hy = headP[1] + 0.085;
  part(mb, mats, translated(scaled(sphere(0.112, 18, 13, { yScale: 1.14 }), 0.94, 1, 1.04), 0, hy, 0),
    'head', mats.skin, { color: skin, ao: 1 });
  // 顎のライン
  // 顎（下へ向かって細くなる）
  part(mb, mats, translated(scaled(sphere(0.086, 14, 10, { yScale: 0.9 }), 0.92, 1, 1.06), 0, hy - 0.056, 0.016),
    'head', mats.skin, { color: skin, ao: 1 });
  // 目：白目・虹彩・瞳・ハイライト・上まぶた。
  // 目を黒丸だけで済ませると顔が「骸骨」に見えるので、層を分けて作る。
  for (const side of [-1, 1]) {
    const ex = side * 0.039, ey = hy - 0.004, ez = 0.09;
    const eyeColor = look.eye || [0.22, 0.34, 0.5];
    // 白目（少しつぶした球を顔の曲面に沿わせる）
    part(mb, mats, translated(scaled(sphere(0.019, 12, 9, { yScale: 0.62 }), 1.15, 1, 0.75), ex, ey, ez - 0.016),
      'head', mats.skin, { color: [1.35, 1.34, 1.34], ao: 1 });
    // 虹彩（外周を濃く、中心を明るく）
    part(mb, mats, translated(scaled(sphere(0.0105, 12, 9), 1, 1, 0.7), ex, ey - 0.001, ez - 0.004),
      'head', mats.skin, { color: eyeColor.map((c) => c * 0.65), ao: 1 });
    part(mb, mats, translated(scaled(sphere(0.0082, 12, 9), 1, 1, 0.7), ex, ey + 0.0015, ez - 0.0015),
      'head', mats.skin, { color: eyeColor.map((c) => c * 1.45), ao: 1 });
    // 瞳
    part(mb, mats, translated(scaled(sphere(0.0044, 8, 6), 1, 1, 0.7), ex, ey, ez + 0.004),
      'head', mats.skin, { color: [0.04, 0.04, 0.06], ao: 1 });
    // ハイライト（これがあるだけで生きた目になる）
    part(mb, mats, translated(sphere(0.0026, 6, 5), ex + side * 0.005, ey + 0.007, ez + 0.007),
      'head', mats.skin, { color: [2.6, 2.6, 2.7], ao: 1 });
    // 上まぶた（細い帯を目にかぶせる）
    part(mb, mats, translated(beveledBox(0.042, 0.009, 0.018, 0.003), ex, ey + 0.0155, ez - 0.008),
      'head', mats.skin, { color: skin.map((c) => c * 0.92), ao: 1 });
    // 眉：髪より少し明るく、細く
    part(mb, mats, translated(beveledBox(0.036, 0.0065, 0.012, 0.002), ex, ey + 0.036, ez - 0.004),
      'head', mats.skin, { color: hair.map((c) => Math.min(1, c * 1.25 + 0.05)), ao: 1 });
    // 耳
    part(mb, mats, translated(scaled(sphere(0.0165, 9, 7, { yScale: 1.45 }), 0.5, 1, 0.95), side * 0.1, hy - 0.012, -0.002),
      'head', mats.skin, { color: skin, ao: 0.92 });
  }
  // 鼻（小さく、影が出すぎないように）と口
  part(mb, mats, translated(scaled(sphere(0.0125, 9, 7, { yScale: 1.3 }), 0.85, 1, 1.15), 0, hy - 0.028, 0.099),
    'head', mats.skin, { color: skin.map((v) => v * 1.02), ao: 1 });
  part(mb, mats, translated(beveledBox(0.024, 0.005, 0.009, 0.002), 0, hy - 0.058, 0.096),
    'head', mats.skin, { color: [skin[0] * 0.82, skin[1] * 0.58, skin[2] * 0.56], ao: 1 });

  // ---- 髪
  const style = look.hairStyle === undefined ? Math.floor(hash2(look.seed || 0, 3, 7) * 4) : look.hairStyle;
  buildHair(mb, mats, style, hy, hair);

  // ---- 帽子
  if (look.hat) {
    const hc = look.hatColor || top;
    if (look.hat === 'cap') {
      part(mb, mats, translated(sphere(0.128, 15, 9, { yScale: 0.68, phiLength: Math.PI / 2 }), 0, hy + 0.03, 0),
        'head', mats.fabric, { color: hc, ao: 1 });
      part(mb, mats, translated(beveledBox(0.17, 0.015, 0.11, 0.006), 0, hy + 0.032, 0.112),
        'head', mats.fabric, { color: hc.map((v) => v * 0.85), ao: 1 });
    } else if (look.hat === 'straw') {
      part(mb, mats, translated(lathe([[0.26, 0], [0.22, 0.018], [0.123, 0.05], [0.118, 0.12], [0, 0.15]], 16), 0, hy + 0.03, 0),
        'head', mats.awning, { color: [1.15, 0.95, 0.6], ao: 1 });
    } else if (look.hat === 'scarf') {
      part(mb, mats, translated(torus(0.075, 0.028, 14, 7), 0, J.neck[1] - 0.01, 0),
        'neck', mats.fabric, { color: hc, ao: 1 });
    }
  }

  // ---- 腕
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const sh = J[`shoulder${side}`], up = J[`arm${side}`], fore = J[`foreArm${side}`], hand = J[`hand${side}`];
    part(mb, mats, translated(sphere(0.058 * build, 11, 9), sh[0] + s * 0.035, sh[1] - 0.01, 0),
      `shoulder${side}`, mats.fabric, { color: top, ao: 0.9 });
    limb(`arm${side}`, up, fore, 0.053 * build, 0.042 * build, mats.fabric, top);
    part(mb, mats, translated(sphere(0.046 * build, 10, 8), fore[0], fore[1], 0), `foreArm${side}`,
      look.sleeves === 'long' ? mats.fabric : mats.skin,
      { color: look.sleeves === 'long' ? top : skin, ao: 0.95 });
    limb(`foreArm${side}`, fore, hand, 0.045 * build, 0.036 * build,
      look.sleeves === 'long' ? mats.fabric : mats.skin, look.sleeves === 'long' ? top : skin);
    // 手
    part(mb, mats, translated(scaled(sphere(0.042, 10, 8, { yScale: 1.35 }), 0.78, 1, 1.15),
      hand[0], hand[1] - 0.025, 0), `hand${side}`, mats.skin, { color: skin, ao: 1 });
  }

  // ---- 脚
  for (const side of ['L', 'R']) {
    const th = J[`thigh${side}`], sh = J[`shin${side}`], ft = J[`foot${side}`];
    part(mb, mats, translated(sphere(0.072 * build, 10, 8), th[0], th[1], 0), `thigh${side}`, mats.fabric,
      { color: bottom, ao: 0.88 });
    limb(`thigh${side}`, th, sh, 0.068 * build, 0.052 * build, mats.fabric, bottom);
    part(mb, mats, translated(sphere(0.05, 9, 7), sh[0], sh[1], 0), `shin${side}`, mats.fabric,
      { color: bottom, ao: 0.9 });
    limb(`shin${side}`, sh, ft, 0.05, 0.038, mats.fabric, bottom.map((v) => v * 0.94));
    // 靴
    part(mb, mats, translated(beveledBox(0.082, 0.062, 0.2, 0.02), ft[0], ft[1] + 0.028, 0.035),
      `foot${side}`, mats.fur, { color: shoe, ao: 0.8 });
    part(mb, mats, translated(beveledBox(0.086, 0.022, 0.21, 0.008), ft[0], ft[1] + 0.008, 0.035),
      `foot${side}`, mats.fur, { color: shoe.map((v) => v * 0.6), ao: 0.6 });
  }

  // ---- エプロン・道具など
  if (look.apron) {
    part(mb, mats, translated(beveledBox(0.26 * build, 0.42, 0.05, 0.01), 0, hipsP[1] + 0.08, 0.13),
      'hips', mats.fabric, { color: look.apronColor || [0.9, 0.88, 0.82], ao: 0.85 });
  }
  if (look.belt) {
    part(mb, mats, translated(cylinder(0.152 * build, 0.152 * build, 0.05, 14, { yOffset: hipsP[1] + 0.03 }), 0, 0, 0),
      'hips', mats.fur, { color: [0.3, 0.22, 0.16], ao: 0.85 });
  }
  if (look.bag) {
    part(mb, mats, translated(beveledBox(0.2, 0.22, 0.1, 0.02), 0.17, hipsP[1] + 0.12, -0.02),
      'hips', mats.fur, { color: [0.42, 0.3, 0.22], ao: 0.85 });
  }

  return { batches: mb.build(), boneCount: HUMAN_BONES.length };
}

/** 髪型。輪郭のシルエットを変えて人物を描き分ける。 */
function buildHair(mb, mats, style, hy, hair) {
  const add = (geo, color = hair) => part(mb, mats, geo, 'head', mats.skin, { color, ao: 1 });
  // 地髪：頭蓋をしっかり覆い、こめかみまで下ろす
  add(translated(scaled(sphere(0.121, 20, 12, { yScale: 1.1, phiLength: Math.PI * 0.66 }), 0.97, 1, 1.03),
    0, hy + 0.004, -0.006));
  // もみあげ
  for (const side of [-1, 1]) {
    add(translated(scaled(sphere(0.036, 10, 8, { yScale: 1.5 }), 0.6, 1, 1.0),
      side * 0.099, hy - 0.012, -0.012));
  }
  if (style === 0) {
    // 短髪：額に自然な前髪の房を作る
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4;
      const x = (t - 0.5) * 0.16;
      add(translated(scaled(sphere(0.042, 10, 8, { yScale: 0.85 }), 1, 1, 0.8),
        x, hy + 0.058 - Math.abs(t - 0.5) * 0.03, 0.062 + Math.sin(t * Math.PI) * 0.016));
    }
    add(translated(scaled(sphere(0.112, 14, 9, { yScale: 0.44, phiLength: Math.PI * 0.5 }), 1, 1, 0.95),
      0, hy + 0.05, 0.012));
  } else if (style === 1) {
    // 長髪：後ろへ流し、肩の手前まで落とす
    add(translated(scaled(sphere(0.122, 16, 11, { yScale: 1.6, phiStart: Math.PI * 0.26, phiLength: Math.PI * 0.5 }),
      1, 1, 1), 0, hy - 0.07, -0.03));
    add(translated(scaled(sphere(0.1, 14, 10, { yScale: 1.9 }), 1, 1, 0.55), 0, hy - 0.14, -0.055));
    for (const side of [-1, 1]) {
      add(translated(scaled(sphere(0.05, 10, 9, { yScale: 2.4 }), 0.65, 1, 0.8),
        side * 0.095, hy - 0.09, 0.018));
    }
    add(translated(scaled(sphere(0.108, 13, 9, { yScale: 0.42, phiLength: Math.PI * 0.5 }), 1, 1, 0.95),
      0, hy + 0.052, 0.02));
  } else if (style === 2) {
    // まとめ髪
    add(translated(sphere(0.056, 12, 9), 0, hy + 0.062, -0.1));
    add(translated(torus(0.043, 0.011, 12, 6), 0, hy + 0.036, -0.094));
    add(translated(scaled(sphere(0.108, 13, 9, { yScale: 0.4, phiLength: Math.PI * 0.5 }), 1, 1, 0.95),
      0, hy + 0.054, 0.016));
  } else {
    // ふわりとしたボブ
    add(translated(scaled(sphere(0.131, 18, 12, { yScale: 0.98, phiStart: 0.08, phiLength: Math.PI * 0.68 }),
      1, 1, 1.02), 0, hy - 0.014, -0.008));
    for (const side of [-1, 1]) {
      add(translated(scaled(sphere(0.06, 12, 10, { yScale: 1.5 }), 0.7, 1, 0.85),
        side * 0.1, hy - 0.062, -0.004));
    }
    add(translated(scaled(sphere(0.114, 14, 9, { yScale: 0.42, phiLength: Math.PI * 0.5 }), 1, 1, 0.95),
      0, hy + 0.05, 0.018));
  }
}

/** ジオメトリを軸ごとに拡大したコピーを返す（法線もそのまま使える程度の変形）。 */
export function scaled(geo, sx, sy, sz) {
  const out = { positions: new Array(geo.positions.length), normals: new Array(geo.normals.length),
    uvs: geo.uvs, indices: geo.indices };
  for (let i = 0; i < geo.positions.length; i += 3) {
    out.positions[i] = geo.positions[i] * sx;
    out.positions[i + 1] = geo.positions[i + 1] * sy;
    out.positions[i + 2] = geo.positions[i + 2] * sz;
    const nx = geo.normals[i] / sx, ny = geo.normals[i + 1] / sy, nz = geo.normals[i + 2] / sz;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.normals[i] = nx / l; out.normals[i + 1] = ny / l; out.normals[i + 2] = nz / l;
  }
  return out;
}

/** ジオメトリを平行移動したコピーを返す。 */
export function translated(geo, x, y, z) {
  const out = { positions: new Array(geo.positions.length), normals: geo.normals, uvs: geo.uvs, indices: geo.indices };
  for (let i = 0; i < geo.positions.length; i += 3) {
    out.positions[i] = geo.positions[i] + x;
    out.positions[i + 1] = geo.positions[i + 1] + y;
    out.positions[i + 2] = geo.positions[i + 2] + z;
  }
  return out;
}

/** 乱数（シード）から見た目を作る。 */
export function randomLook(seed) {
  const h = (k) => hash2(seed, k, 17);
  const hats = [null, null, null, 'cap', 'straw', 'scarf'];
  return {
    seed,
    skin: SKIN_TONES[Math.floor(h(1) * SKIN_TONES.length)],
    hair: HAIR_COLORS[Math.floor(h(2) * HAIR_COLORS.length)],
    hairStyle: Math.floor(h(3) * 4),
    top: CLOTH_COLORS[Math.floor(h(4) * CLOTH_COLORS.length)],
    bottom: CLOTH_COLORS[Math.floor(h(5) * CLOTH_COLORS.length)],
    eye: [0.2 + h(6) * 0.4, 0.3 + h(7) * 0.35, 0.35 + h(8) * 0.35],
    hat: hats[Math.floor(h(9) * hats.length)],
    sleeves: h(10) > 0.5 ? 'long' : 'short',
    apron: h(11) > 0.7,
    belt: h(12) > 0.45,
    build: 0.88 + h(13) * 0.3,
    heightScale: 0.94 + h(14) * 0.14
  };
}
