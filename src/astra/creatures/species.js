/**
 * 町にいるアストラたち。
 *
 * 人とアストラが共に暮らしていることを、説明ではなく風景で見せるための 5 種。
 * どれもシルエットが違う（飛ぶ／泳ぐ／小さい／大きい／丸い）ので、
 * 黒いシルエットにしても見分けがつく。
 * 同じキットで作った仲間は、そのまま野生アストラとしても使える。
 */

import {
  assembleCreature, loftBody, addLoft, buildLimb, buildEye, buildHorn,
  buildCrystalPlate, buildMembrane, buildFurTuft, buildOrbit, xform,
} from './kit.js';
import { quadrupedBones, aquaticBones, flyerBones, heavyBones } from './skeletons.js';
import { sphere, tube, lathe, crossBillboard } from '../gfx/geo.js';
import { TAU, lerp, clamp } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';

/* ===================================================== ルミウィング */

/** 小型の飛行アストラ。屋根や街灯にとまり、夕暮れに群れで舞う。 */
export function lumiwing(mats, opts = {}) {
  const def = flyerBones({ bodyY: 0.5, wingSpan: 0.22 });
  const body = opts.color || [0.72, 0.86, 1.05];
  const accent = opts.accent || [0.4, 0.92, 1.0];
  return assembleCreature(mats, def, ({ mb, joints, ids }) => {
    const B = joints;
    // 胴体：しずく型。前が丸く、後ろが尖る
    const sections = [];
    for (let i = 0; i <= 9; i++) {
      const t = i / 9;
      const z = lerp(B.hips[2] - 0.1, B.chest[2] + 0.1, t);
      const r = (0.055 + Math.sin(Math.pow(t, 0.75) * Math.PI) * 0.085);
      sections.push({
        pos: [0, lerp(B.hips[1] - 0.01, B.chest[1] + 0.02, t), z],
        rx: r, ry: r * 1.08, squash: 0.28,
        bone: t < 0.45 ? ids.hips : ids.chest,
      });
    }
    addLoft(mb, loftBody(sections, { segments: 14 }), mats.fur, Object.values(ids).map((_, i) => i),
      { color: body, ao: (p) => clamp(0.68 + (p[1] - 0.35) * 0.6, 0.62, 1) });

    // 頭
    mb.add(xform(sphere(0.082, 14, 11, { yScale: 1.02 }), { pos: B.head }), mats.fur,
      { color: body.map((c) => c * 1.04), ao: 1, bone: ids.head });
    // くちばし
    mb.add(xform(lathe([[0.03, 0], [0.026, 0.03], [0.008, 0.075], [0, 0.085]], 9),
      { pos: B.beak, rot: [Math.PI / 2 - 0.15, 0, 0] }), mats.metal,
      { color: [1.1, 0.78, 0.35], ao: 1, bone: ids.beak });
    // 冠羽（シルエットの決め手）
    for (const [name, side] of [['crestL', 1], ['crestR', -1]]) {
      for (let i = 0; i < 3; i++) {
        const t = i / 3;
        buildHorn(mb, mats, B[name], [side * (0.25 + t * 0.3), 0.9 - t * 0.2, -0.35 - t * 0.2],
          0.13 - t * 0.02, 0.014, {
            color: accent, bone: ids[name], curve: 0.35, material: mats.crystal,
          });
      }
    }
    // 目
    for (const side of [1, -1]) {
      buildEye(mb, mats, [side * 0.042, B.head[1] + 0.012, B.head[2] + 0.056], {
        size: 0.032, bone: ids.head, iris: [0.3, 0.85, 1.0], glow: 1,
        lidColor: body.map((c) => c * 0.92), facing: [side * 0.25, 0, 0.95],
      });
    }
    // 翼：三枚の風切り羽で構成する
    for (const side of ['L', 'R']) {
      const w0 = B[`wing${side}0`], w1 = B[`wing${side}1`], w2 = B[`wing${side}2`];
      buildLimb(mb, mats, joints, ids, [`wing${side}0`, `wing${side}1`, `wing${side}2`],
        [0.03, 0.022, 0.014], mats.fur, { color: body, segments: 7 });
      buildMembrane(mb, mats, w0, w1, [0, -0.01, -0.14], {
        color: body.map((c) => c * 0.96), bone: ids[`wing${side}0`], material: mats.fur, ribs: 2,
      });
      buildMembrane(mb, mats, w1, w2, [0, -0.01, -0.17], {
        color: body.map((c) => c * 1.02), bone: ids[`wing${side}1`], material: mats.fur, ribs: 3,
      });
      // 翼端の光
      mb.add(xform(sphere(0.022, 9, 7, { yScale: 1.4 }), { pos: w2 }), mats.crystal,
        { color: accent, ao: 1, bone: ids[`wing${side}2`] });
      // 脚
      buildLimb(mb, mats, joints, ids, [`leg${side}0`, `leg${side}1`], [0.016, 0.012], mats.metal,
        { color: [1.05, 0.76, 0.34], segments: 6 });
      for (let k = -1; k <= 1; k++) {
        const f = B[`leg${side}1`];
        mb.add(tube([f, [f[0] + k * 0.012, f[1] - 0.012, f[2] + 0.024],
          [f[0] + k * 0.02, f[1] - 0.018, f[2] + 0.042]], (t) => 0.006 * (1 - t * 0.5), 5),
          mats.metal, { color: [1.05, 0.76, 0.34], ao: 1, bone: ids[`leg${side}1`] });
      }
    }
    // 尾羽
    for (let i = 0; i < 3; i++) {
      const t = joints[`tail${i}`];
      mb.add(xform(sphere(0.03 - i * 0.006, 10, 8, { yScale: 0.7 }), { pos: t, scale: [1, 1, 1.6] }),
        mats.fur, { color: body.map((c) => c * (1 - i * 0.04)), ao: 0.95, bone: ids[`tail${i}`] });
    }
    const tailEnd = joints.tail2;
    for (let i = -1; i <= 1; i++) {
      buildMembrane(mb, mats, tailEnd, [tailEnd[0] + i * 0.07, tailEnd[1] + 0.01, tailEnd[2] - 0.16],
        [0.02, 0, -0.03], { color: accent.map((c) => c * 0.7 + 0.2), bone: ids.tail2, material: mats.fur, ribs: 1 });
    }
    return { scale: 1, sockets: { mouth: B.beak, center: B.chest, tail: tailEnd } };
  });
}

/* ========================================================== ナギラ */

/** 川に棲むアストラ。滑らかな体と長いリボン状の尾。 */
export function nagira(mats, opts = {}) {
  const def = aquaticBones({ bodyY: 0.42, segs: 5, segLen: 0.14, earLen: 0.1 });
  const body = opts.color || [0.55, 0.9, 1.0];
  const accent = opts.accent || [0.75, 0.98, 1.0];
  return assembleCreature(mats, def, ({ mb, joints, ids }) => {
    const B = joints;
    const sections = [];
    const path = [
      [B.hips[0], B.hips[1], B.hips[2] - 0.06],
      [0, B.hips[1] + 0.02, B.hips[2] + 0.1],
      [0, B.chest[1], B.chest[2] - 0.06],
      [0, B.chest[1] + 0.01, B.chest[2] + 0.06],
      [0, B.neck[1] - 0.02, B.neck[2] + 0.02],
    ];
    path.forEach((p, i) => {
      const t = i / (path.length - 1);
      const r = 0.075 + Math.sin(t * Math.PI * 0.9) * 0.07;
      sections.push({ pos: p, rx: r, ry: r * 0.92, squash: 0.15,
        bone: t < 0.45 ? ids.hips : ids.chest });
    });
    addLoft(mb, loftBody(sections, { segments: 16 }), mats.scales,
      Object.values(ids).map((_, i) => i),
      { color: body, ao: (p) => clamp(0.66 + (p[1] - 0.28) * 0.7, 0.6, 1.05) });

    // 頭：丸みのある獣頭に短い口吻
    mb.add(xform(sphere(0.085, 16, 12, { yScale: 0.95 }), { pos: B.head, scale: [1, 1, 1.08] }),
      mats.scales, { color: body.map((c) => c * 1.03), ao: 1, bone: ids.head });
    mb.add(xform(sphere(0.05, 12, 9, { yScale: 0.78 }), { pos: [0, B.head[1] - 0.026, B.head[2] + 0.06], scale: [1, 1, 1.25] }),
      mats.scales, { color: body.map((c) => c * 1.06), ao: 1, bone: ids.jaw });
    mb.add(xform(sphere(0.016, 9, 7), { pos: [0, B.head[1] - 0.018, B.head[2] + 0.105] }),
      mats.skin, { color: [0.3, 0.42, 0.5], ao: 1, bone: ids.jaw });

    // 長い耳（月のリボン）
    for (const [e, eb, side] of [['ear0', 'ear0b', 1], ['ear1', 'ear1b', -1]]) {
      buildLimb(mb, mats, joints, ids, [e, eb], [0.022, 0.016], mats.scales, { color: body, segments: 7 });
      buildMembrane(mb, mats, B[e], B[eb], [side * 0.035, 0, -0.05], {
        color: accent, bone: ids[e], material: mats.scales, ribs: 1,
      });
      const tipPos = B[eb];
      mb.add(xform(sphere(0.024, 10, 8, { yScale: 1.5 }), { pos: [tipPos[0] + side * 0.02, tipPos[1] + 0.02, tipPos[2] - 0.03] }),
        mats.crystal, { color: [0.6, 0.95, 1.0], ao: 1, bone: ids[eb] });
    }

    // 目
    for (const side of [1, -1]) {
      buildEye(mb, mats, [side * 0.048, B.head[1] + 0.015, B.head[2] + 0.055], {
        size: 0.036, bone: ids.head, iris: [0.35, 0.7, 1.0], glow: 1,
        lidColor: body.map((c) => c * 0.9), facing: [side * 0.3, 0.05, 0.94], sclera: [1.5, 1.5, 1.55],
      });
    }

    // 胸びれ
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      buildLimb(mb, mats, joints, ids, [`fin${i}`, `fin${i}b`], [0.028, 0.018], mats.scales, { color: body, segments: 7 });
      buildMembrane(mb, mats, B[`fin${i}`], B[`fin${i}b`], [side * 0.06, -0.02, -0.09], {
        color: accent, bone: ids[`fin${i}`], material: mats.scales, ribs: 3, curve: 0.35,
      });
    }

    // 尾：先へ細くなり、リボン状のひれが付く
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const p = joints[`tail${i}`];
      mb.add(xform(sphere(0.06 * (1 - t * 0.78), 12, 9, { yScale: 0.9 }), { pos: p, scale: [1, 1, 1.5] }),
        mats.scales, { color: body.map((c) => c * (1 - t * 0.08)), ao: 0.95, bone: ids[`tail${i}`] });
      if (i >= 2) {
        buildMembrane(mb, mats, p, [p[0], p[1] + 0.05, p[2] - 0.08], [0, 0.02, -0.05], {
          color: accent, bone: ids[`tail${i}`], material: mats.scales, ribs: 1,
        });
      }
    }
    // 尾びれ
    const end = joints.tail4;
    for (const side of [1, -1]) {
      buildMembrane(mb, mats, end, [end[0] + side * 0.02, end[1] + 0.12, end[2] - 0.13],
        [side * 0.1, -0.03, -0.05], { color: accent, bone: ids.tail4, material: mats.scales, ribs: 3, curve: 0.4 });
    }
    // 体を巡る水の玉
    buildOrbit(mb, mats, [0, B.chest[1] + 0.02, B.chest[2] - 0.05], 0.2, 6,
      { color: [0.6, 0.95, 1.1], size: 0.026, bone: ids.chest, material: mats.crystal });
    return { sockets: { mouth: [0, B.head[1] - 0.018, B.head[2] + 0.11], center: B.chest, tail: end } };
  });
}

/* ========================================================= コポニ */

/** 小さなもふもふのアストラ。老人の散歩の相棒。 */
export function koponi(mats, opts = {}) {
  const def = quadrupedBones({
    hipY: 0.3, hipZ: -0.14, chestZ: 0.1, neckY: 0.08, headZ: 0.14,
    legSpread: 0.085, frontLegZ: 0.1, backLegZ: -0.12,
    upperLeg: 0.1, lowerLeg: 0.09, tailSegs: 3, tailLen: 0.07,
  });
  const body = opts.color || [1.15, 1.0, 0.82];
  const accent = opts.accent || [1.0, 0.72, 0.55];
  return assembleCreature(mats, def, ({ mb, joints, ids }) => {
    const B = joints;
    const sections = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const z = lerp(B.hips[2] - 0.1, B.chest[2] + 0.08, t);
      const r = 0.085 + Math.sin(Math.pow(t, 0.9) * Math.PI) * 0.055;
      sections.push({ pos: [0, lerp(B.hips[1], B.chest[1] + 0.01, t), z], rx: r, ry: r * 0.95, squash: 0.3,
        bone: t < 0.35 ? ids.hips : t < 0.7 ? ids.spine1 : ids.chest });
    }
    addLoft(mb, loftBody(sections, { segments: 14 }), mats.fur, Object.values(ids).map((_, i) => i),
      { color: body, ao: (p) => clamp(0.62 + (p[1] - 0.12) * 1.0, 0.58, 1) });
    // 胸のもこもこ
    buildFurTuft(mb, mats, [0, B.chest[1] - 0.03, B.chest[2] + 0.06], [0, 0.2, 0.9], 0.075,
      { color: body.map((c) => c * 1.06), bone: ids.chest, count: 7, width: 0.026, spread: 2.2 });

    // 頭（大きめ・丸い）
    mb.add(xform(sphere(0.088, 16, 12, { yScale: 0.96 }), { pos: B.head }), mats.fur,
      { color: body.map((c) => c * 1.03), ao: 1, bone: ids.head });
    mb.add(xform(sphere(0.045, 12, 9, { yScale: 0.8 }), { pos: [0, B.head[1] - 0.024, B.head[2] + 0.06] }),
      mats.fur, { color: body.map((c) => c * 1.06), ao: 1, bone: ids.jaw });
    mb.add(xform(sphere(0.013, 9, 7), { pos: [0, B.head[1] - 0.016, B.head[2] + 0.095] }), mats.skin,
      { color: [0.5, 0.3, 0.32], ao: 1, bone: ids.jaw });
    // 大きな耳（垂れ耳）
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const e = B[`ear${i}`];
      const path = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        path.push([e[0] + side * t * 0.05, e[1] + 0.02 - t * t * 0.13, e[2] - t * 0.03]);
      }
      mb.add(tube(path, (t) => 0.033 * (1 - t * 0.55), 9, { closeStart: true, closeEnd: true }),
        mats.fur, { color: body.map((c) => c * 0.97), ao: 0.95, bone: ids[`ear${i}`] });
      mb.add(xform(sphere(0.022, 9, 7, { yScale: 1.3 }), { pos: path[4] }), mats.fur,
        { color: accent, ao: 1, bone: ids[`ear${i}`] });
    }
    // 目（大きく、優しい）
    for (const side of [1, -1]) {
      buildEye(mb, mats, [side * 0.044, B.head[1] + 0.012, B.head[2] + 0.058], {
        size: 0.036, bone: ids.head, iris: [0.5, 0.32, 0.2], lidColor: body.map((c) => c * 0.9),
        facing: [side * 0.3, 0.04, 0.94],
      });
    }
    // 脚（短くて太い）
    for (const tag of ['FL', 'FR', 'BL', 'BR']) {
      buildLimb(mb, mats, joints, ids, [`leg${tag}0`, `leg${tag}1`, `leg${tag}2`, `leg${tag}3`],
        [0.036, 0.03, 0.026, 0.024], mats.fur, { color: body.map((c) => c * 0.98), segments: 8 });
      const f = B[`leg${tag}3`];
      mb.add(xform(sphere(0.03, 10, 8, { yScale: 0.62 }), { pos: [f[0], f[1] - 0.008, f[2] + 0.012], scale: [1, 1, 1.3] }),
        mats.fur, { color: accent, ao: 0.85, bone: ids[`leg${tag}3`] });
    }
    // 短い尻尾
    for (let i = 0; i < 3; i++) {
      const p = joints[`tail${i}`];
      mb.add(xform(sphere(0.038 - i * 0.008, 10, 8), { pos: p }), mats.fur,
        { color: body.map((c) => c * 1.02), ao: 0.95, bone: ids[`tail${i}`] });
    }
    return { sockets: { mouth: [0, B.head[1] - 0.016, B.head[2] + 0.1], center: B.chest } };
  });
}

/* ========================================================= バッガル */

/** 荷運びの大型アストラ。石と苔をまとった穏やかな体。 */
export function baggal(mats, opts = {}) {
  const def = heavyBones();
  const body = opts.color || [0.72, 0.68, 0.6];
  const moss = opts.accent || [0.5, 0.78, 0.42];
  return assembleCreature(mats, def, ({ mb, joints, ids }) => {
    const B = joints;
    const sections = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const z = lerp(B.hips[2] - 0.24, B.chest[2] + 0.18, t);
      const r = 0.2 + Math.sin(Math.pow(t, 0.85) * Math.PI) * 0.15;
      sections.push({ pos: [0, lerp(B.hips[1] + 0.02, B.chest[1] + 0.04, t), z],
        rx: r, ry: r * 0.92, squash: 0.28,
        bone: t < 0.3 ? ids.hips : t < 0.55 ? ids.spine1 : t < 0.8 ? ids.spine2 : ids.chest });
    }
    addLoft(mb, loftBody(sections, { segments: 18 }), mats.fur, Object.values(ids).map((_, i) => i),
      { color: body, ao: (p) => clamp(0.58 + (p[1] - 0.2) * 0.5, 0.55, 1) });
    // 背中の岩板
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const z = lerp(B.hips[2] - 0.1, B.chest[2] + 0.05, t);
      const y = lerp(B.hips[1] + 0.3, B.chest[1] + 0.36, t);
      const bone = t < 0.4 ? ids.spine1 : t < 0.75 ? ids.spine2 : ids.chest;
      buildCrystalPlate(mb, mats, [0, y, z], [0, 1, 0], 0.13 - Math.abs(t - 0.5) * 0.08,
        { color: [0.82, 0.8, 0.76], bone, material: mats.stone, tilt: -0.35, sides: 6 });
      if (i % 2 === 0) {
        mb.add(xform(sphere(0.07, 10, 8, { yScale: 0.4 }), { pos: [0, y - 0.03, z], scale: [1.4, 1, 1.2] }),
          mats.moss, { color: moss, ao: 0.9, bone });
      }
    }
    // 頭
    mb.add(xform(sphere(0.17, 16, 12, { yScale: 0.9 }), { pos: B.head, scale: [1, 1, 1.15] }), mats.fur,
      { color: body.map((c) => c * 1.02), ao: 1, bone: ids.head });
    mb.add(xform(sphere(0.1, 14, 10, { yScale: 0.72 }), { pos: [0, B.head[1] - 0.06, B.head[2] + 0.13], scale: [1, 1, 1.3] }),
      mats.fur, { color: body.map((c) => c * 1.05), ao: 1, bone: ids.jaw });
    mb.add(xform(sphere(0.032, 10, 8), { pos: [0, B.head[1] - 0.05, B.head[2] + 0.21] }), mats.skin,
      { color: [0.32, 0.28, 0.26], ao: 1, bone: ids.jaw });
    // 角（前へ張り出す大きな角）
    for (const [n, side] of [['hornL', 1], ['hornR', -1]]) {
      buildHorn(mb, mats, B[n], [side * 0.45, 0.6, 0.6], 0.42, 0.05,
        { color: [0.92, 0.9, 0.85], bone: ids[n], curve: 0.35, rings: 3, material: mats.stone });
    }
    // 目（小さく穏やか）
    for (const side of [1, -1]) {
      buildEye(mb, mats, [side * 0.09, B.head[1] + 0.03, B.head[2] + 0.11], {
        size: 0.038, bone: ids.head, iris: [0.85, 0.6, 0.25], lidColor: body.map((c) => c * 0.88),
        facing: [side * 0.45, 0.05, 0.89],
      });
    }
    // 脚
    for (const tag of ['FL', 'FR', 'BL', 'BR']) {
      buildLimb(mb, mats, joints, ids, [`leg${tag}0`, `leg${tag}1`, `leg${tag}2`, `leg${tag}3`],
        [0.1, 0.085, 0.075, 0.07], mats.fur, { color: body.map((c) => c * 0.96), segments: 10 });
      const f = B[`leg${tag}3`];
      mb.add(xform(lathe([[0.1, 0], [0.11, 0.03], [0.09, 0.07]], 12), { pos: [f[0], f[1] - 0.02, f[2]] }),
        mats.stone, { color: [0.78, 0.76, 0.72], ao: 0.8, bone: ids[`leg${tag}3`] });
    }
    // 尻尾
    for (let i = 0; i < 4; i++) {
      const p = joints[`tail${i}`];
      mb.add(xform(sphere(0.08 - i * 0.014, 12, 9), { pos: p, scale: [1, 1, 1.3] }), mats.fur,
        { color: body, ao: 0.95, bone: ids[`tail${i}`] });
    }
    buildFurTuft(mb, mats, joints.tail3, [0, -0.2, -0.9], 0.18,
      { color: moss, bone: ids.tail3, count: 6, width: 0.022, spread: 1.6, material: mats.leaves });
    return { sockets: { mouth: [0, B.head[1] - 0.05, B.head[2] + 0.22], center: B.chest, back: [0, B.chest[1] + 0.4, B.chest[2] - 0.1] } };
  });
}

/** 診療所で休む、丸くて植物質のアストラ。 */
export function dozuri(mats, opts = {}) {
  const def = quadrupedBones({
    hipY: 0.26, hipZ: -0.1, chestZ: 0.08, neckY: 0.04, headZ: 0.1,
    legSpread: 0.09, frontLegZ: 0.08, backLegZ: -0.1,
    upperLeg: 0.07, lowerLeg: 0.06, tailSegs: 2, tailLen: 0.05,
  });
  const body = opts.color || [0.72, 0.95, 0.6];
  const bloom = opts.accent || [1.15, 0.8, 0.9];
  return assembleCreature(mats, def, ({ mb, joints, ids }) => {
    const B = joints;
    const sections = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const z = lerp(B.hips[2] - 0.12, B.chest[2] + 0.08, t);
      const r = 0.1 + Math.sin(t * Math.PI) * 0.075;
      sections.push({ pos: [0, lerp(B.hips[1], B.chest[1], t), z], rx: r, ry: r * 0.9, squash: 0.35,
        bone: t < 0.4 ? ids.hips : t < 0.72 ? ids.spine1 : ids.chest });
    }
    addLoft(mb, loftBody(sections, { segments: 14 }), mats.moss, Object.values(ids).map((_, i) => i),
      { color: body, ao: (p) => clamp(0.6 + (p[1] - 0.1) * 1.1, 0.55, 1) });
    // 背中の若葉
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const z = lerp(B.hips[2] - 0.04, B.chest[2], t);
      const bone = t < 0.5 ? ids.spine1 : ids.chest;
      mb.add(xform(crossBillboard(0.12, 0.14, 2, { taper: 0.2, rows: 2 }),
        { pos: [(hash2(i, 1, 3) - 0.5) * 0.06, B.chest[1] + 0.08, z], rot: [0, hash2(i, 2, 3) * TAU, 0] }),
        mats.leaves, { color: [1, 1, 1], ao: 0.95, bone, wind: 0.5 });
    }
    // 頭
    mb.add(xform(sphere(0.085, 16, 12, { yScale: 0.92 }), { pos: B.head }), mats.moss,
      { color: body.map((c) => c * 1.05), ao: 1, bone: ids.head });
    // 花（額）
    mb.add(xform(crossBillboard(0.1, 0.1, 3, { taper: 0.1, rows: 2 }),
      { pos: [0, B.head[1] + 0.075, B.head[2] + 0.01] }), mats.flowers,
      { color: bloom, ao: 1, bone: ids.head, wind: 0.4 });
    for (const side of [1, -1]) {
      buildEye(mb, mats, [side * 0.04, B.head[1] + 0.005, B.head[2] + 0.058], {
        size: 0.032, bone: ids.head, iris: [0.9, 0.5, 0.6], lidColor: body.map((c) => c * 0.9),
        facing: [side * 0.3, 0, 0.95], squint: 0.35,
      });
    }
    for (const tag of ['FL', 'FR', 'BL', 'BR']) {
      buildLimb(mb, mats, joints, ids, [`leg${tag}0`, `leg${tag}1`, `leg${tag}2`],
        [0.03, 0.026, 0.024], mats.moss, { color: body.map((c) => c * 0.96), segments: 7 });
    }
    return { sockets: { center: B.chest, head: B.head } };
  });
}

export const TOWN_SPECIES = { lumiwing, nagira, koponi, baggal, dozuri };

/** 図鑑用の基本情報。 */
export const SPECIES_INFO = {
  lumiwing: { name: 'ルミウィング', element: 'Radiant', size: 0.55, skeleton: 'flyer', locomotion: 'fly' },
  nagira: { name: 'ナギラ', element: 'Aqua', size: 1.0, skeleton: 'aquatic', locomotion: 'swim' },
  koponi: { name: 'コポニ', element: 'Bloom', size: 0.6, skeleton: 'quadruped', locomotion: 'walk' },
  baggal: { name: 'バッガル', element: 'Terra', size: 2.2, skeleton: 'heavy', locomotion: 'walk' },
  dozuri: { name: 'ドズリ', element: 'Bloom', size: 0.5, skeleton: 'quadruped', locomotion: 'walk' },
};
