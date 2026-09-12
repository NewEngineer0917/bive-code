/**
 * アストラの骨組み。
 *
 * 生き物ごとに専用の骨を持たせる（人型を流用しない）。
 * 単位は「体長 1」の正規化座標で、実寸はモデル生成時に掛ける。
 * すべて +Z が前方、+Y が上。
 */

/** 四足獣（PYRAIL / VERDYN / 野生の小型種）。 */
export function quadrupedBones(o = {}) {
  const {
    hipY = 0.46, hipZ = -0.24, chestZ = 0.14, neckY = 0.12, headZ = 0.2,
    legSpread = 0.13, frontLegZ = 0.16, backLegZ = -0.2,
    upperLeg = 0.2, lowerLeg = 0.18, tailSegs = 4, tailLen = 0.13,
    earCount = 2,
  } = o;
  const b = [
    { name: 'root', offset: [0, 0, 0] },
    { name: 'hips', parent: 'root', offset: [0, hipY, hipZ] },
    { name: 'spine1', parent: 'hips', offset: [0, 0.01, 0.16] },
    { name: 'spine2', parent: 'spine1', offset: [0, 0.015, 0.16] },
    { name: 'chest', parent: 'spine2', offset: [0, 0.01, chestZ - 0.26] },
    { name: 'neck', parent: 'chest', offset: [0, neckY, 0.13] },
    { name: 'head', parent: 'neck', offset: [0, 0.05, headZ - 0.12] },
    { name: 'jaw', parent: 'head', offset: [0, -0.05, 0.06] },
  ];
  for (let i = 0; i < earCount; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    b.push({ name: `ear${i}`, parent: 'head', offset: [side * 0.05, 0.07, -0.02] });
  }
  for (const [tag, z, parent] of [['FL', frontLegZ, 'chest'], ['FR', frontLegZ, 'chest'],
    ['BL', backLegZ, 'hips'], ['BR', backLegZ, 'hips']]) {
    const side = tag.endsWith('L') ? 1 : -1;
    const base = parent === 'chest' ? [side * legSpread, -0.06, z - chestZ] : [side * legSpread, -0.04, z - hipZ];
    b.push({ name: `leg${tag}0`, parent, offset: base });
    b.push({ name: `leg${tag}1`, parent: `leg${tag}0`, offset: [0, -upperLeg, 0] });
    b.push({ name: `leg${tag}2`, parent: `leg${tag}1`, offset: [0, -lowerLeg, 0] });
    b.push({ name: `leg${tag}3`, parent: `leg${tag}2`, offset: [0, -0.07, 0.03] });
  }
  for (let i = 0; i < tailSegs; i++) {
    b.push({
      name: `tail${i}`,
      parent: i === 0 ? 'hips' : `tail${i - 1}`,
      offset: i === 0 ? [0, 0.06, -0.12] : [0, 0.01, -tailLen],
    });
  }
  return b;
}

/** 水棲・浮遊型（MIZUNE / 水の野生種）。後脚がなく、尾びれが長い。 */
export function aquaticBones(o = {}) {
  const { bodyY = 0.5, segs = 5, segLen = 0.14, finCount = 2, earLen = 0.12 } = o;
  const b = [
    { name: 'root', offset: [0, 0, 0] },
    { name: 'hips', parent: 'root', offset: [0, bodyY, -0.1] },
    { name: 'chest', parent: 'hips', offset: [0, 0.03, 0.22] },
    { name: 'neck', parent: 'chest', offset: [0, 0.08, 0.12] },
    { name: 'head', parent: 'neck', offset: [0, 0.04, 0.1] },
    { name: 'jaw', parent: 'head', offset: [0, -0.04, 0.06] },
    { name: 'ear0', parent: 'head', offset: [0.05, 0.06, -0.03] },
    { name: 'ear1', parent: 'head', offset: [-0.05, 0.06, -0.03] },
    { name: 'ear0b', parent: 'ear0', offset: [0.02, earLen, -0.04] },
    { name: 'ear1b', parent: 'ear1', offset: [-0.02, earLen, -0.04] },
  ];
  for (let i = 0; i < finCount; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    b.push({ name: `fin${i}`, parent: 'chest', offset: [side * 0.15, -0.04, 0.0] });
    b.push({ name: `fin${i}b`, parent: `fin${i}`, offset: [side * 0.12, -0.05, -0.05] });
  }
  for (let i = 0; i < segs; i++) {
    b.push({ name: `tail${i}`, parent: i === 0 ? 'hips' : `tail${i - 1}`, offset: [0, i === 0 ? 0 : 0.005, -segLen] });
  }
  return b;
}

/** 飛行型（小型のトリ型アストラ）。 */
export function flyerBones(o = {}) {
  const { bodyY = 0.5, wingSpan = 0.2 } = o;
  const b = [
    { name: 'root', offset: [0, 0, 0] },
    { name: 'hips', parent: 'root', offset: [0, bodyY, -0.08] },
    { name: 'chest', parent: 'hips', offset: [0, 0.02, 0.16] },
    { name: 'neck', parent: 'chest', offset: [0, 0.07, 0.08] },
    { name: 'head', parent: 'neck', offset: [0, 0.04, 0.07] },
    { name: 'beak', parent: 'head', offset: [0, -0.02, 0.08] },
    { name: 'crestL', parent: 'head', offset: [0.03, 0.07, -0.02] },
    { name: 'crestR', parent: 'head', offset: [-0.03, 0.07, -0.02] },
  ];
  for (const side of [1, -1]) {
    const tag = side > 0 ? 'L' : 'R';
    b.push({ name: `wing${tag}0`, parent: 'chest', offset: [side * 0.07, 0.03, 0] });
    b.push({ name: `wing${tag}1`, parent: `wing${tag}0`, offset: [side * wingSpan, 0.02, -0.02] });
    b.push({ name: `wing${tag}2`, parent: `wing${tag}1`, offset: [side * wingSpan * 0.9, -0.01, -0.05] });
    b.push({ name: `leg${tag}0`, parent: 'hips', offset: [side * 0.05, -0.06, 0.02] });
    b.push({ name: `leg${tag}1`, parent: `leg${tag}0`, offset: [0, -0.09, 0.01] });
  }
  for (let i = 0; i < 3; i++) {
    b.push({ name: `tail${i}`, parent: i === 0 ? 'hips' : `tail${i - 1}`, offset: [0, 0.01, -0.09] });
  }
  return b;
}

/** 大型（荷運び役・ボス）。四足だが首と角が長い。 */
export function heavyBones(o = {}) {
  const bones = quadrupedBones({
    hipY: 0.78, hipZ: -0.4, chestZ: 0.26, neckY: 0.22, headZ: 0.34,
    legSpread: 0.24, frontLegZ: 0.28, backLegZ: -0.34,
    upperLeg: 0.3, lowerLeg: 0.28, tailSegs: 4, tailLen: 0.16, earCount: 2,
  });
  bones.push({ name: 'hornL', parent: 'head', offset: [0.08, 0.1, 0.02] });
  bones.push({ name: 'hornR', parent: 'head', offset: [-0.08, 0.1, 0.02] });
  bones.push({ name: 'hornL2', parent: 'hornL', offset: [0.06, 0.16, -0.04] });
  bones.push({ name: 'hornR2', parent: 'hornR', offset: [-0.06, 0.16, -0.04] });
  return bones;
}
