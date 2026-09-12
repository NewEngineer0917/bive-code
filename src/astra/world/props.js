/**
 * 小物。
 *
 * 町に生活感を出すための道具立て。置きすぎると散らかるので、
 * 町側では「店の前」「家の脇」「路地」など置き場所を決めて使う。
 */

import {
  box, beveledBox, cylinder, lathe, sphere, torus, tube, plane, gableRoof,
} from '../gfx/geo.js';
import { TAU, clamp } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';

/** 屋外テーブル。 */
export function table(mb, mats, r = 0.55, h = 0.74, color = [0.66, 0.48, 0.32]) {
  mb.at(0, h, 0);
  mb.add(cylinder(r, r, 0.06, 16), mats.wood, { color, ao: 0.98 });
  mb.add(cylinder(r * 0.98, r * 0.94, 0.04, 16, { yOffset: -0.04 }), mats.woodDark,
    { color: color.map((v) => v * 0.8), ao: 0.9 });
  mb.pop();
  mb.at(0, h / 2, 0);
  mb.add(cylinder(0.06, 0.075, h, 10, { yOffset: -h / 2 }), mats.metalDark, { color: [0.3, 0.32, 0.34], ao: 0.8 });
  mb.pop();
  mb.add(lathe([[0.3, 0], [0.28, 0.03], [0.08, 0.06]], 12), mats.metalDark, { color: [0.3, 0.32, 0.34], ao: 0.6 });
}

/** 椅子。 */
export function chair(mb, mats, color = [0.62, 0.45, 0.3]) {
  mb.at(0, 0.44, 0);
  mb.add(beveledBox(0.42, 0.05, 0.42, 0.012), mats.wood, { color, ao: 0.95 });
  mb.pop();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    mb.at(sx * 0.17, 0.22, sz * 0.17);
    mb.add(cylinder(0.02, 0.022, 0.44, 6, { yOffset: -0.22 }), mats.metalDark, { color: [0.28, 0.3, 0.32], ao: 0.7 });
    mb.pop();
  }
  mb.at(0, 0.68, -0.19);
  mb.add(beveledBox(0.4, 0.42, 0.04, 0.012), mats.wood, { color, ao: 0.95 });
  mb.pop();
  for (const sx of [-1, 1]) {
    mb.at(sx * 0.17, 0.66, -0.17);
    mb.add(cylinder(0.018, 0.018, 0.46, 6, { yOffset: -0.23 }), mats.metalDark, { color: [0.28, 0.3, 0.32], ao: 0.85 });
    mb.pop();
  }
}

/** 荷車（配達用）。 */
export function cart(mb, mats, opts = {}) {
  const { loaded = true, color = [0.58, 0.42, 0.28] } = opts;
  mb.at(0, 0.62, 0);
  mb.add(beveledBox(1.25, 0.1, 2.0, 0.02), mats.wood, { color, ao: 0.9 });
  mb.pop();
  for (const sx of [-1, 1]) {
    mb.at(sx * 0.62, 0.8, 0);
    mb.add(beveledBox(0.06, 0.34, 1.95, 0.015), mats.wood, { color: color.map((v) => v * 0.9), ao: 0.9 });
    mb.pop();
  }
  mb.at(0, 0.8, -1.0);
  mb.add(beveledBox(1.25, 0.34, 0.06, 0.015), mats.wood, { color: color.map((v) => v * 0.9), ao: 0.9 });
  mb.pop();
  // 車輪
  for (const sx of [-1, 1]) {
    mb.atFull(sx * 0.68, 0.42, -0.25, 0, 0, Math.PI / 2);
    mb.add(torus(0.4, 0.055, 18, 7), mats.woodDark, { color: [0.42, 0.3, 0.2], ao: 0.85 });
    mb.add(cylinder(0.08, 0.08, 0.1, 10, { yOffset: -0.05 }), mats.metalDark, { color: [0.32, 0.3, 0.3], ao: 0.9 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      mb.atFull(0, 0, 0, 0, 0, a);
      mb.add(box(0.03, 0.72, 0.03), mats.woodDark, { color: [0.46, 0.33, 0.22], ao: 0.9 });
      mb.pop();
    }
    mb.pop();
  }
  // 引き手
  for (const sx of [-1, 1]) {
    mb.atFull(sx * 0.45, 0.6, 1.3, -0.18, 0, 0);
    mb.add(cylinder(0.04, 0.035, 1.3, 8, { yOffset: -0.65 }), mats.wood, { color, ao: 0.9 });
    mb.pop();
  }
  if (loaded) {
    for (let i = 0; i < 4; i++) {
      const x = (hash2(i, 1, 3) - 0.5) * 0.7;
      const z = (hash2(i, 2, 3) - 0.5) * 1.4;
      mb.at(x, 0.9, z, hash2(i, 3, 3) * TAU, 0.55, 0.55, 0.55);
      mb.add(beveledBox(0.6, 0.55, 0.6, 0.03), mats.wood, {
        color: [0.6 + hash2(i, 4, 3) * 0.2, 0.46, 0.3], ao: 0.9
      });
      mb.pop();
    }
  }
}

/** 洗濯紐（布が風に揺れる）。 */
export function laundryLine(mb, mats, length, opts = {}) {
  const { sag = 0.3, items = 5, height = 2.4 } = opts;
  const path = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    path.push([(t - 0.5) * length, height - Math.sin(t * Math.PI) * sag, 0]);
  }
  mb.add(tube(path, 0.012, 4), mats.metalDark, { color: [0.6, 0.58, 0.54], ao: 1 });
  for (let i = 0; i < items; i++) {
    const t = (i + 0.6) / (items + 0.2);
    const x = (t - 0.5) * length;
    const y = height - Math.sin(t * Math.PI) * sag;
    const w = 0.4 + hash2(i, 1, 7) * 0.3;
    const h = 0.5 + hash2(i, 2, 7) * 0.45;
    const col = [0.6 + hash2(i, 3, 7) * 0.6, 0.6 + hash2(i, 4, 7) * 0.5, 0.65 + hash2(i, 5, 7) * 0.45];
    mb.at(x, y - h / 2 - 0.02, 0, (hash2(i, 6, 7) - 0.5) * 0.2);
    mb.add(box(w, h, 0.012), mats.fabric, { color: col, ao: 0.95, windFromY: [-h / 2, h / 2, 0.85] });
    mb.pop();
  }
}

/** 樽・木箱・袋を積んだ荷置き場。 */
export function supplyPile(mb, mats, seed = 1) {
  const put = (f, x, y, z, ry, s) => { mb.at(x, y, z, ry, s, s, s); f(); mb.pop(); };
  // 袋
  for (let i = 0; i < 3; i++) {
    const a = hash2(seed, i, 5) * TAU;
    put(() => {
      mb.add(lathe([[0.02, 0], [0.22, 0.08], [0.26, 0.28], [0.16, 0.46], [0.06, 0.52]], 10, { capBottom: true }),
        mats.fabric, { color: [0.82, 0.76, 0.6], ao: (p) => clamp(0.55 + p[1], 0.55, 1) });
    }, Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5, a, 0.9 + hash2(seed, i + 3, 5) * 0.3);
  }
}

/** 道具（シャベル・熊手・箒）を壁に立てかける。 */
export function tools(mb, mats, seed = 1) {
  const kinds = ['broom', 'rake', 'shovel'];
  const kind = kinds[Math.floor(hash2(seed, 1, 3) * kinds.length)];
  mb.atFull(0, 0.85, 0, 0.16, hash2(seed, 2, 3) * 0.6, 0.1);
  mb.add(cylinder(0.022, 0.02, 1.7, 7, { yOffset: -0.85 }), mats.wood, { color: [0.62, 0.46, 0.3], ao: 0.9 });
  mb.at(0, 0.85, 0);
  if (kind === 'broom') {
    mb.add(lathe([[0.03, 0], [0.11, 0.1], [0.13, 0.3], [0.02, 0.34]], 9), mats.awning,
      { color: [0.82, 0.68, 0.4], ao: 0.9 });
  } else if (kind === 'rake') {
    mb.add(box(0.42, 0.04, 0.03), mats.metalDark, { color: [0.4, 0.42, 0.44], ao: 1 });
    for (let i = 0; i < 6; i++) {
      mb.at((-0.5 + i / 5) * 0.38, -0.09, 0);
      mb.add(cylinder(0.01, 0.008, 0.18, 5, { yOffset: -0.09 }), mats.metalDark, { color: [0.4, 0.42, 0.44], ao: 1 });
      mb.pop();
    }
  } else {
    mb.add(beveledBox(0.2, 0.26, 0.03, 0.01), mats.metal, { color: [0.6, 0.62, 0.64], ao: 1 });
  }
  mb.pop();
  mb.pop();
}

/** 本と巻物の山。研究所と家の中に。 */
export function bookStack(mb, mats, count = 4, seed = 1) {
  let y = 0;
  for (let i = 0; i < count; i++) {
    const w = 0.2 + hash2(seed, i, 4) * 0.08;
    const d = 0.26 + hash2(seed, i + 1, 4) * 0.08;
    const h = 0.035 + hash2(seed, i + 2, 4) * 0.03;
    mb.at((hash2(seed, i + 3, 4) - 0.5) * 0.05, y + h / 2, (hash2(seed, i + 4, 4) - 0.5) * 0.05,
      (hash2(seed, i + 5, 4) - 0.5) * 0.4);
    mb.add(beveledBox(w, h, d, 0.006), mats.fabric, {
      color: [0.3 + hash2(seed, i + 6, 4) * 0.6, 0.28 + hash2(seed, i + 7, 4) * 0.5, 0.35 + hash2(seed, i + 8, 4) * 0.5],
      ao: 0.9
    });
    mb.pop();
    y += h;
  }
}

/** 瓶。 */
export function bottle(mb, mats, color = [0.4, 0.8, 0.6], scale = 1) {
  mb.at(0, 0, 0, 0, scale, scale, scale);
  mb.add(lathe([[0.06, 0], [0.075, 0.03], [0.072, 0.17], [0.03, 0.23], [0.028, 0.31], [0.036, 0.33]], 10,
    { capBottom: true, capTop: true }), mats.glass, { color, ao: 1 });
  mb.at(0, 0.33, 0);
  mb.add(cylinder(0.03, 0.03, 0.03, 8), mats.wood, { color: [0.55, 0.4, 0.28], ao: 1 });
  mb.pop();
  mb.pop();
}

/** 木の柵。区画の仕切りに。 */
export function fence(mb, mats, length, opts = {}) {
  const { height = 1.0, color = [0.6, 0.46, 0.32], seed = 1 } = opts;
  const posts = Math.max(2, Math.round(length / 1.6));
  for (let i = 0; i <= posts; i++) {
    const x = (-0.5 + i / posts) * length;
    const jit = (hash2(seed, i, 5) - 0.5) * 0.05;
    mb.at(x, height * 0.5, jit, jit * 2);
    mb.add(beveledBox(0.09, height, 0.09, 0.012), mats.wood, {
      color: color.map((v) => v * (0.9 + hash2(seed, i + 2, 5) * 0.2)),
      ao: (p) => clamp(0.55 + p[1] * 0.4, 0.55, 1)
    });
    mb.pop();
  }
  for (const y of [height * 0.72, height * 0.38]) {
    mb.at(0, y, 0);
    mb.add(box(length, 0.07, 0.045), mats.wood, { color, ao: 0.9 });
    mb.pop();
  }
}

/** 落ち葉と塵の吹きだまり（地面に貼る）。 */
export function leafLitter(mb, mats, radius, seed = 1) {
  const n = Math.round(radius * 6);
  for (let i = 0; i < n; i++) {
    const a = hash2(seed, i, 9) * TAU;
    const r = Math.sqrt(hash2(seed, i + 1, 9)) * radius;
    mb.at(Math.cos(a) * r, 0.012, Math.sin(a) * r, hash2(seed, i + 2, 9) * TAU,
      0.1 + hash2(seed, i + 3, 9) * 0.08, 1, 0.1 + hash2(seed, i + 4, 9) * 0.08);
    mb.add(plane(1, 1, 1, { uvScale: 1 }), mats.leaves, {
      color: [1.1, 0.85 + hash2(seed, i + 5, 9) * 0.3, 0.5], ao: 0.85
    });
    mb.pop();
  }
}

/** 井戸。 */
export function well(mb, mats) {
  mb.add(lathe([[0.9, 0], [0.95, 0.1], [0.98, 0.7], [0.9, 0.78], [0.78, 0.74], [0.8, 0.08]], 20),
    mats.stone, { color: [0.94, 0.92, 0.86], ao: (p) => clamp(0.55 + p[1] * 0.5, 0.55, 1) });
  for (const sx of [-1, 1]) {
    mb.at(sx * 0.82, 1.0, 0);
    mb.add(beveledBox(0.1, 2.0, 0.1, 0.015), mats.woodDark, { color: [0.5, 0.36, 0.26], ao: 0.85 });
    mb.pop();
  }
  mb.at(0, 2.1, 0);
  mb.add(gableRoof(2.3, 1.4, 0.5, 0.18), mats.roofTile, { color: [0.95, 0.82, 0.76], ao: 1 });
  mb.pop();
  mb.atFull(0, 1.86, 0, 0, 0, Math.PI / 2);
  mb.add(cylinder(0.07, 0.07, 1.5, 10, { yOffset: -0.75 }), mats.wood, { color: [0.55, 0.4, 0.28], ao: 1 });
  mb.pop();
  // 桶と縄
  mb.add(tube([[0, 1.84, 0], [0, 1.2, 0], [0, 0.95, 0]], 0.012, 4), mats.fabric, { color: [0.72, 0.66, 0.54], ao: 1 });
  mb.at(0, 0.82, 0);
  mb.add(lathe([[0.16, 0], [0.19, 0.05], [0.2, 0.22], [0.17, 0.24]], 12, { capBottom: true }), mats.wood,
    { color: [0.56, 0.4, 0.28], ao: 0.95 });
  mb.pop();
}

/** Nova 充電スタンド（町の科学技術を見せる小物）。 */
export function novaPylon(mb, mats, height = 2.2, glow = [0.42, 0.95, 1.0]) {
  mb.add(lathe([[0.42, 0], [0.4, 0.12], [0.22, 0.2], [0.16, 0.35]], 14, { capBottom: true }), mats.metal,
    { color: [0.72, 0.76, 0.8], ao: 0.8 });
  mb.at(0, 0.35, 0);
  mb.add(cylinder(0.14, 0.11, height - 0.6, 12), mats.techPanel, { color: [1, 1, 1], ao: 0.95 });
  mb.pop();
  mb.at(0, height - 0.25, 0);
  mb.add(lathe([[0.11, 0], [0.24, 0.1], [0.22, 0.28], [0.08, 0.34]], 14), mats.metal,
    { color: [0.78, 0.82, 0.86], ao: 1 });
  mb.at(0, 0.2, 0);
  mb.add(sphere(0.16, 12, 9, { yScale: 1.3 }), mats.crystal, { color: glow, ao: 1 });
  mb.add(torus(0.3, 0.02, 20, 6), mats.crystal, { color: glow, ao: 1 });
  mb.pop();
  mb.pop();
}

/** ファンタジー版の自転車（浮遊するスクーター）。 */
export function hoverScooter(mb, mats, opts = {}) {
  const { color = [0.4, 0.6, 0.8], glow = [0.42, 0.95, 1.0] } = opts;
  mb.at(0, 0.45, 0);
  mb.add(lathe([[0.1, -0.7], [0.2, -0.5], [0.24, 0], [0.2, 0.6], [0.1, 0.85]], 12, { capBottom: true, capTop: true }),
    mats.metal, { color, ao: 0.9 });
  mb.pop();
  // 床板
  mb.at(0, 0.5, -0.1);
  mb.add(beveledBox(0.34, 0.06, 0.9, 0.02), mats.metalDark, { color: [0.3, 0.32, 0.36], ao: 0.9 });
  mb.pop();
  // ハンドル
  mb.atFull(0, 0.95, 0.55, -0.22, 0, 0);
  mb.add(cylinder(0.035, 0.03, 0.7, 8, { yOffset: -0.35 }), mats.metalDark, { color: [0.3, 0.32, 0.36], ao: 0.95 });
  mb.pop();
  mb.atFull(0, 1.22, 0.62, 0, 0, Math.PI / 2);
  mb.add(cylinder(0.028, 0.028, 0.62, 8, { yOffset: -0.31 }), mats.metalDark, { color: [0.28, 0.3, 0.34], ao: 1 });
  mb.pop();
  // 座席
  mb.at(0, 0.86, -0.4);
  mb.add(lathe([[0.02, 0.06], [0.16, 0.04], [0.14, -0.04], [0.02, -0.05]], 12), mats.fur,
    { color: [0.28, 0.22, 0.2], ao: 1 });
  mb.pop();
  // 浮揚リング
  for (const z of [0.45, -0.5]) {
    mb.at(0, 0.28, z);
    mb.add(torus(0.2, 0.045, 16, 7), mats.crystal, { color: glow, ao: 1 });
    mb.pop();
  }
}

/** 果物かご。市場と家の前に。 */
export function fruitBasket(mb, mats, seed = 1) {
  mb.add(lathe([[0.2, 0], [0.26, 0.04], [0.3, 0.2], [0.28, 0.22], [0.24, 0.06]], 14, { capBottom: true }),
    mats.awning, { color: [0.8, 0.64, 0.38], ao: 0.9 });
  for (let i = 0; i < 7; i++) {
    const a = hash2(seed, i, 4) * TAU;
    const r = Math.sqrt(hash2(seed, i + 1, 4)) * 0.17;
    mb.at(Math.cos(a) * r, 0.22 + hash2(seed, i + 2, 4) * 0.06, Math.sin(a) * r);
    mb.add(sphere(0.062, 9, 7), mats.plaster, {
      color: [1.15, 0.4 + hash2(seed, i + 3, 4) * 0.7, 0.28 + hash2(seed, i + 4, 4) * 0.3], ao: 1
    });
    mb.pop();
  }
}
