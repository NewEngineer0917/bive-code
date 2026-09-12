/**
 * ルミナタウン。
 *
 * 12 の区画を高低差と複数の道でつなぎ、どこにいてもランドマークが
 * 見えるように配置している。
 *
 *   01 中央広場        02 研究所        03 アストラ診療所   04 道具屋
 *   05 住宅街          06 マーケット通り 07 川沿い          08 展望の丘
 *   09 森の門          10 主人公の家     11 裏路地          12 小さな社
 *
 * この関数は「見える物」「当たり判定」「光」「調べられる物」「NPC の配置」
 * 「音のゾーン」をまとめて返す。
 */

import { ChunkedBuilder } from '../gfx/builder.js';
import { buildGround, buildGrass, buildScatterRocks } from './ground.js';
import { buildRiver, buildPool } from './water.js';
import { buildBuilding, PALETTE } from './buildings.js';
import {
  novaFountain, stoneBridge, forestGate, smallShrine, observationDeck,
  marketStall, noticeBoard
} from './landmarks.js';
import {
  streetLamp, bench, barrel, crate, flowerPot, lantern, stoneRim,
} from './buildingKit.js';
import { TREES, oakTree, bush, vine } from './vegetation.js';
import * as Props from './props.js';
import { CollisionWorld } from './collision.js';
import {
  buildResearchCenter, buildClinic, buildItemShop, buildCafe
} from './specialBuildings.js';
import { box, beveledBox, cylinder, sphere, crossBillboard } from '../gfx/geo.js';
import { TAU, clamp } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';

/** 区画の定義。案内表示とオーディオゾーンにも使う。 */
export const DISTRICTS = [
  { id: 'plaza', name: '中央広場', x: 0, z: 0, r: 24, audio: 'plaza' },
  { id: 'research', name: '研究所', x: -2, z: -52, r: 26, audio: 'research' },
  { id: 'clinic', name: 'アストラ診療所', x: 34, z: -26, r: 16, audio: 'town' },
  { id: 'shop', name: '道具屋', x: -27, z: -9, r: 12, audio: 'town' },
  { id: 'residential', name: '住宅街', x: -48, z: 38, r: 30, audio: 'residential' },
  { id: 'market', name: 'マーケット通り', x: 0, z: 46, r: 22, audio: 'market' },
  { id: 'riverside', name: '川沿い', x: 48, z: 18, r: 26, audio: 'river' },
  { id: 'hill', name: '展望の丘', x: 40, z: -68, r: 26, audio: 'hill' },
  { id: 'gate', name: '森の門', x: 0, z: 98, r: 18, audio: 'forest' },
  { id: 'home', name: '主人公の家', x: -46, z: 44, r: 10, audio: 'residential' },
  { id: 'alley', name: '裏路地', x: -20, z: 47, r: 10, audio: 'alley' },
  { id: 'shrine', name: '小さな社', x: 76, z: 32, r: 14, audio: 'shrine' },
];

/** 花壇の花（何度も使うので 1 回だけ作る）。 */
const FLOWER_CARD = crossBillboard(1.0, 1.2, 2, { taper: 0.25, rows: 3, bend: 0.12 });

export function buildTown(mats, terrain, opts = {}) {
  const quality = opts.quality || 'high';
  const lodScale = quality === 'low' ? 0.55 : quality === 'medium' ? 0.8 : 1;
  const chunks = new ChunkedBuilder(26);
  const collision = new CollisionWorld(terrain);
  const lights = [];
  const interactables = [];
  const npcSpawns = [];
  const audioZones = [];
  const footprints = [];
  const treeSpots = [];

  /** 建物の周りの地面を少し暗くするための登録。 */
  const shade = (x, z, r, strength = 0.45) => footprints.push({ x, z, r, strength });

  /** 指定座標にビルダを開いて処理し、閉じる。 */
  const place = (x, z, rot, fn, yOffset = 0) => {
    const b = chunks.at(x, z);
    const y = terrain.height(x, z) + yOffset;
    b.at(x, y, z, rot);
    const r = fn(b, y);
    b.pop();
    return r;
  };

  const addLight = (x, y, z, color, intensity, radius, o = {}) => {
    lights.push({
      pos: [x, y, z], color, intensity, radius,
      nightOnly: o.nightOnly !== false,
      flicker: o.flicker
    });
  };

  /* ============================================ 遠景（町の外の世界） */
  buildDistantScenery(chunks, mats, terrain, lodScale);

  /* ================================================== 01 中央広場 */
  const fountain = place(0, 0, 0, (b) => novaFountain(b, mats, { radius: 4.6 }));
  const plazaY = terrain.height(0, 0);
  collision.addCircle(0, 0, 5.2, { height: 5, tag: 'fountain' });
  shade(0, 0, 8, 0.25);
  addLight(0, plazaY + 4.25, 0, [0.45, 0.95, 1.0], 7.5, 30, { nightOnly: false });
  addLight(0, plazaY + 1.2, 0, [0.3, 0.8, 1.0], 2.6, 11, { nightOnly: false });
  interactables.push({
    id: 'fountain', x: 0, z: 0, radius: 6.2, label: 'ノヴァの泉',
    text: ['澄んだ水の中心で、ノヴァクリスタルがゆっくりと呼吸するように光っている。',
      '町の灯りはすべて、この泉から分けられた光だという。']
  });

  // 広場を囲むベンチ・街灯・木
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + Math.PI / 8;
    const r = 11.5;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    place(bx, bz, -a + Math.PI / 2, (b) => bench(b, mats, 1.9, { woodColor: [0.68, 0.5, 0.34] }));
    collision.addBox(bx, bz, 2.0, 0.7, -a + Math.PI / 2, { height: 0.9, tag: 'bench' });
    interactables.push({ id: `bench_${i}`, x: bx, z: bz, radius: 1.8, label: 'ベンチ', action: 'sit' });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    const r = 16.5;
    const lx = Math.cos(a) * r, lz = Math.sin(a) * r;
    const info = place(lx, lz, -a, (b) => streetLamp(b, mats, 4.2, { double: true }));
    collision.addCircle(lx, lz, 0.35, { height: 4.5, tag: 'lamp' });
    const ly = terrain.height(lx, lz);
    addLight(lx + Math.cos(-a) * 0.45, ly + info.lightY, lz - Math.sin(-a) * 0.45,
      PALETTE.lampGlow, 6.8, 13, { flicker: { speed: 3.1, phase: i } });
    addLight(lx - Math.cos(-a) * 0.45, ly + info.lightY, lz + Math.sin(-a) * 0.45,
      PALETTE.lampGlow, 6.8, 13, { flicker: { speed: 2.7, phase: i + 2 } });
  }
  // 広場の木（ノヴァツリー 1 本と広葉樹）
  const plazaTrees = [
    { x: -9, z: -13, kind: 'nova', s: 1.1 }, { x: 10, z: -14, kind: 'oak', s: 1.0 },
    { x: -14, z: 9, kind: 'oak', s: 0.92 }, { x: 13, z: 11, kind: 'birch', s: 1.0 },
    { x: 17, z: -6, kind: 'oak', s: 0.86 }, { x: -17, z: -3, kind: 'birch', s: 0.95 },
  ];
  for (const t of plazaTrees) treeSpots.push({ ...t, seed: t.x * 7 + t.z });
  // 花壇
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    const r = 7.6;
    const fx = Math.cos(a) * r, fz = Math.sin(a) * r;
    place(fx, fz, a, (b, y) => {
      stoneRim(b, mats.stone, 1.5, 0.42, 0.26, [0.98, 0.96, 0.9]);
      b.at(0, 0.3, 0);
      b.add(cylinder(1.3, 1.3, 0.06, 18), mats.dirt, { color: [0.6, 0.5, 0.42], ao: 0.6 });
      b.pop();
      for (let k = 0; k < 9; k++) {
        const ka = hash2(i, k, 5) * TAU;
        const kr = Math.sqrt(hash2(i, k + 1, 5)) * 1.1;
        b.at(Math.cos(ka) * kr, 0.34, Math.sin(ka) * kr, hash2(i, k + 2, 5) * TAU, 0.34, 0.42, 0.34);
        b.add(FLOWER_CARD, mats.flowers, { color: [1, 1, 1], ao: 0.95, windFromY: [0, 1.2, 0.7] });
        b.pop();
      }
    });
    collision.addCircle(fx, fz, 1.6, { height: 0.6, tag: 'flowerbed' });
  }
  place(-3.5, 18.5, Math.PI, (b) => noticeBoard(b, mats));
  collision.addBox(-3.5, 18.5, 1.9, 0.4, 0, { height: 2.4, tag: 'sign' });
  interactables.push({
    id: 'notice', x: -3.5, z: 19.4, radius: 2.0, label: '掲示板',
    text: ['「ノヴァ祭まであと三日。広場の飾りつけを手伝ってくれる人を探しています」',
      '「南の森でアストラの目撃が増えています。ひとりで入らないように」',
      '「研究所ではアストラの絆に関する研究協力者を募集中」']
  });
  audioZones.push({ id: 'plaza', x: 0, z: 0, radius: 26, ambience: 'plaza' });

  /* ============================================= 02 研究所（北） */
  const research = place(-2, -52, Math.PI, (b) => buildResearchCenter(b, mats));
  collision.addBox(-2, -52, 26, 15, 0, { height: 16, tag: 'building' });
  shade(-2, -52, 18, 0.5);
  for (const l of research.lights) {
    addLight(-2 - l[0], terrain.height(-2, -52) + l[1], -52 - l[2], l[3] || PALETTE.novaGlow, l[4] || 2.4, l[5] || 14,
      { nightOnly: false });
  }
  interactables.push({
    id: 'research_door', x: -2, z: -44.2, radius: 2.6, label: 'ノヴァ研究所',
    action: 'enter', target: 'research'
  });
  audioZones.push({ id: 'research', x: -2, z: -52, radius: 24, ambience: 'research' });
  // 研究所前の並木と広場
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const z = -22 - Math.floor(i / 2) * 8;
    treeSpots.push({ x: side * 6.5, z, kind: 'birch', s: 1.05, seed: i * 13 });
    const lx = side * 5.2, lz = z + 4;
    const info = place(lx, lz, 0, (b) => streetLamp(b, mats, 3.8));
    collision.addCircle(lx, lz, 0.3, { height: 4, tag: 'lamp' });
    addLight(lx, terrain.height(lx, lz) + info.lightY, lz, PALETTE.lampGlow, 5.7, 11, {});
  }

  /* ========================================== 03 アストラ診療所（東） */
  place(34, -26, Math.PI * 0.85, (b) => buildClinic(b, mats));
  collision.addBox(34, -26, 13, 11.5, Math.PI * 0.85, { height: 10, tag: 'building' });
  shade(34, -26, 11, 0.5);
  addLight(34, terrain.height(34, -26) + 5.6, -22, [0.6, 1.0, 0.9], 5.5, 18, { nightOnly: false });
  interactables.push({
    id: 'clinic_door', x: 32.5, z: -20.8, radius: 2.6, label: 'アストラ診療所',
    action: 'enter', target: 'clinic'
  });
  // 診療所前の休憩スペース
  for (let i = 0; i < 2; i++) {
    const bx = 28 + i * 5, bz = -17;
    place(bx, bz, 0.2, (b) => bench(b, mats, 1.7, { woodColor: [0.7, 0.62, 0.5] }));
    collision.addBox(bx, bz, 1.8, 0.7, 0.2, { height: 0.9, tag: 'bench' });
  }
  treeSpots.push({ x: 41, z: -17, kind: 'oak', s: 0.95, seed: 71 });

  /* ================================================= 04 道具屋 */
  place(-27, -9, Math.PI * 0.75, (b) => buildItemShop(b, mats));
  collision.addBox(-27, -9, 10.4, 9.4, Math.PI * 0.75, { height: 9, tag: 'building' });
  shade(-27, -9, 9, 0.5);
  addLight(-24, terrain.height(-24, -5) + 3.2, -5, PALETTE.lampGlow, 5.2, 10, {});
  interactables.push({
    id: 'shop_door', x: -24.2, z: -5.6, radius: 2.4, label: '道具屋 ルミナ商店',
    action: 'enter', target: 'shop'
  });
  // 店先の品物
  place(-22.6, -7.8, 0.6, (b) => { Props.supplyPile(b, mats, 3); });
  place(-21.4, -4.2, 1.2, (b) => { barrel(b, mats, 0.34, 0.84); });
  place(-20.6, -3.2, 0.3, (b) => { crate(b, mats, 0.62); });
  place(-20.7, -3.3, 0.3, (b) => { b.at(0, 0.62, 0, 0.4); crate(b, mats, 0.5); b.pop(); });

  /* ======================================== カフェ（広場の東側） */
  place(23, 9, -Math.PI * 0.65, (b) => buildCafe(b, mats));
  collision.addBox(23, 9, 10, 9, -Math.PI * 0.65, { height: 9, tag: 'building' });
  shade(23, 9, 9, 0.5);
  interactables.push({ id: 'cafe', x: 20, z: 6, radius: 2.6, label: 'カフェ「陽だまり」',
    text: ['焼きたてのパンとハーブティーの香り。', 'テラス席では旅人がアストラと朝食をとっている。'] });
  // テラス席
  for (let i = 0; i < 3; i++) {
    const a = -0.65 * Math.PI + (i - 1) * 0.5;
    const tx = 23 + Math.cos(a) * 7.4, tz = 9 + Math.sin(a) * 7.4;
    place(tx, tz, 0, (b) => Props.table(b, mats));
    collision.addCircle(tx, tz, 0.7, { height: 0.9, tag: 'table' });
    for (let k = 0; k < 2; k++) {
      const ca = a + Math.PI + (k ? 0.9 : -0.9);
      place(tx + Math.cos(ca) * 0.85, tz + Math.sin(ca) * 0.85, -ca + Math.PI / 2, (b) => Props.chair(b, mats));
    }
    // パラソル
    place(tx, tz, i * 0.6, (b) => {
      b.add(cylinder(0.035, 0.03, 2.2, 8), mats.metalDark, { color: [0.4, 0.4, 0.42], ao: 0.9 });
      b.at(0, 2.2, 0);
      b.add(cylinder(1.5, 0.06, 0.55, 10, { caps: false }), mats.awning, {
        color: [1.0, 0.92, 0.8], ao: 1, windFromY: [0, 0.55, 0.2]
      });
      b.pop();
    });
    addLight(tx, terrain.height(tx, tz) + 2.3, tz, PALETTE.lampGlow, 3.1, 6, {});
  }

  /* ============================================== 05 住宅街（西） */
  const houseDefs = [
    { x: -60, z: 22, rot: 0.5, floors: 2, w: 8.5, d: 7, style: 'timber', roof: 'gable' },
    { x: -68, z: 34, rot: 1.4, floors: 2, w: 7.5, d: 7.5, style: 'plaster', roof: 'hip' },
    { x: -64, z: 48, rot: 2.4, floors: 3, w: 7, d: 6.5, style: 'plaster', roof: 'gable' },
    { x: -52, z: 58, rot: 3.1, floors: 2, w: 9, d: 7, style: 'timber', roof: 'gable' },
    { x: -38, z: 56, rot: 3.6, floors: 2, w: 7.5, d: 7, style: 'stone', roof: 'hip' },
    { x: -30, z: 44, rot: 4.4, floors: 2, w: 8, d: 6.5, style: 'plaster', roof: 'gable' },
    { x: -33, z: 30, rot: 5.0, floors: 3, w: 7, d: 7, style: 'timber', roof: 'tower' },
    { x: -44, z: 22, rot: 5.7, floors: 2, w: 8, d: 7.5, style: 'plaster', roof: 'hip' },
    { x: -55, z: 40, rot: 0.9, floors: 2, w: 7, d: 6, style: 'stone', roof: 'gable' },
  ];
  houseDefs.forEach((h, i) => {
    place(h.x, h.z, h.rot, (b) => buildBuilding(b, mats, {
      w: h.w, d: h.d, floors: h.floors, roof: h.roof, style: h.style, seed: i * 11 + 3,
      details: {
        shutters: true, flowerBoxes: i % 2 === 0, dormers: h.roof === 'gable' && i % 3 === 0 ? 2 : 0,
        balcony: i % 4 === 1, downspout: true, wallLantern: i % 3 === 0, archedDoor: i % 5 === 0
      }
    }));
    collision.addBox(h.x, h.z, h.w + 0.4, h.d + 0.4, h.rot, { height: 12, tag: 'building' });
    shade(h.x, h.z, Math.max(h.w, h.d) * 0.9, 0.5);
    const ex = h.x + Math.sin(h.rot) * (h.d / 2 + 1.4);
    const ez = h.z + Math.cos(h.rot) * (h.d / 2 + 1.4);
    if (i % 3 === 0) addLight(ex, terrain.height(ex, ez) + 2.9, ez, PALETTE.lampGlow, 4.2, 8, {});
    interactables.push({
      id: `house_${i}`, x: ex, z: ez, radius: 2.2, label: '民家',
      text: [['鍵がかかっている。中から楽しそうな話し声が聞こえる。'],
        ['「ただいま」と声をかけたくなるような、あたたかい扉だ。'],
        ['窓際にアストラのぬいぐるみが並んでいる。']][i % 3]
    });
    // 家の脇の生活感
    place(h.x + Math.cos(h.rot + 1.3) * (h.w / 2 + 1.1), h.z - Math.sin(h.rot + 1.3) * (h.w / 2 + 1.1), h.rot,
      (b) => { if (i % 2) Props.tools(b, mats, i); else Props.fence(b, mats, 3.2, { seed: i }); });
    if (i % 2 === 1) {
      place(h.x + Math.cos(h.rot) * (h.w / 2 + 2.6), h.z + Math.sin(h.rot) * (h.w / 2 + 2.6), h.rot + 0.4,
        (b) => Props.laundryLine(b, mats, 5.5, { items: 4 }));
    }
    treeSpots.push({
      x: h.x + Math.cos(h.rot + 2.3) * (h.w / 2 + 3.4),
      z: h.z + Math.sin(h.rot + 2.3) * (h.w / 2 + 3.4),
      kind: i % 3 === 0 ? 'birch' : 'oak', s: 0.8 + (i % 3) * 0.12, seed: i * 17
    });
  });
  audioZones.push({ id: 'residential', x: -48, z: 38, radius: 34, ambience: 'residential' });

  /* =========================================== 10 主人公の家 */
  place(-46, 44, 3.9, (b) => buildBuilding(b, mats, {
    w: 8, d: 7, floors: 2, roof: 'gable', style: 'timber', seed: 99,
    colors: { wall: [1.02, 0.97, 0.88], roof: [0.86, 0.9, 1.0], trim: [0.34, 0.44, 0.56] },
    details: { shutters: true, flowerBoxes: true, dormers: 1, downspout: true, wallLantern: true, balcony: true }
  }));
  collision.addBox(-46, 44, 8.4, 7.4, 3.9, { height: 12, tag: 'building' });
  shade(-46, 44, 8, 0.5);
  {
    const ex = -46 + Math.sin(3.9) * 4.9, ez = 44 + Math.cos(3.9) * 4.9;
    interactables.push({ id: 'home_door', x: ex, z: ez, radius: 2.5, label: '自分の家', action: 'enter', target: 'home' });
    addLight(ex, terrain.height(ex, ez) + 2.9, ez, PALETTE.lampGlow, 5.2, 9, {});
    place(ex + 1.8, ez + 0.6, 0, (b) => flowerPot(b, mats, 0.32));
    place(ex - 1.9, ez + 0.4, 0, (b) => flowerPot(b, mats, 0.28));
    place(ex + 3.2, ez + 2.2, 0.7, (b) => Props.hoverScooter(b, mats));
  }

  /* ======================================= 06 マーケット通り（南） */
  const stallColors = [[1.1, 0.5, 0.45], [0.45, 0.7, 1.05], [1.05, 0.9, 0.5], [0.55, 1.0, 0.7], [0.85, 0.6, 1.0]];
  for (let i = 0; i < 10; i++) {
    const side = i % 2 ? 1 : -1;
    const z = 28 + Math.floor(i / 2) * 8.2;
    const x = side * 7.2;
    place(x, z, side > 0 ? -Math.PI / 2 : Math.PI / 2, (b) => marketStall(b, mats, {
      variant: i, awningColor: stallColors[i % stallColors.length]
    }));
    collision.addBox(x, z, 3.2, 2.4, side > 0 ? -Math.PI / 2 : Math.PI / 2, { height: 2.6, tag: 'stall' });
    shade(x, z, 3.2, 0.3);
    addLight(x, terrain.height(x, z) + 2.4, z, PALETTE.lampGlow, 3.9, 7,
      { flicker: { speed: 4.2, phase: i } });
    interactables.push({
      id: `stall_${i}`, x: x - side * 1.9, z, radius: 2.0, label: '屋台',
      text: [['「新鮮なミズナ草だよ、アストラの好物さ！」'], ['「珍しい鉱石はいらんかね」'],
        ['「焼きたてのパン、ひとついかが？」'], ['「この布、ノヴァ糸で織ってあるんだ」'],
        ['「旅の道具はうちで揃うよ」']][i % 5]
    });
    npcSpawns.push({ x: x - side * 1.5, z, kind: 'vendor', facing: side > 0 ? -Math.PI / 2 : Math.PI / 2, clip: 'work' });
  }
  // 通りの吊りランタン
  for (let i = 0; i < 6; i++) {
    const z = 26 + i * 10;
    place(0, z, 0, (b) => {
      for (const side of [-1, 1]) {
        b.at(side * 5.6, 2.3, 0);
        b.add(cylinder(0.07, 0.06, 4.6, 8, { yOffset: -2.3 }), mats.metalDark,
          { color: [0.3, 0.32, 0.36], ao: (p) => clamp(0.6 + p[1] * 0.1, 0.6, 1) });
        b.pop();
      }
      // 通りを横切る一本の線に、提灯を等間隔で吊るす
      b.at(0, 4.2, 0);
      b.add(box(11.2, 0.05, 0.05), mats.metalDark, { color: [0.4, 0.4, 0.42], ao: 1 });
      for (let k = -2; k <= 2; k++) {
        b.at(k * 2.2, -0.35, 0);
        lantern(b, mats, { color: stallColors[(i + k + 5) % stallColors.length], size: 1.1, chain: 0.35 });
        b.pop();
      }
      b.pop();
    });
    for (const side of [-1, 1]) collision.addCircle(side * 5.6, z, 0.3, { height: 4.6, tag: 'pole' });
    for (let k = -2; k <= 2; k++) {
      addLight(k * 2.2, terrain.height(0, z) + 3.85, z,
        stallColors[(i + k + 5) % stallColors.length].map((v) => v * 0.9), 3.4, 8, {});
    }
  }
  audioZones.push({ id: 'market', x: 0, z: 46, radius: 24, ambience: 'market' });

  /* =============================================== 11 裏路地 */
  place(-22, 48, 0.7, (b) => buildBuilding(b, mats, {
    w: 6, d: 5.5, floors: 2, roof: 'flat', style: 'stone', seed: 41,
    details: { downspout: true, chimney: false }
  }));
  collision.addBox(-22, 48, 6.4, 5.9, 0.7, { height: 10, tag: 'building' });
  shade(-22, 48, 7, 0.6);
  place(-16.5, 45.5, 1.1, (b) => { barrel(b, mats, 0.34, 0.86, [0.42, 0.34, 0.26]); });
  place(-17.6, 46.4, 0.3, (b) => { crate(b, mats, 0.58, [0.5, 0.4, 0.3]); });
  place(-17.7, 46.5, 0.3, (b) => { b.at(0, 0.58, 0, 0.6); crate(b, mats, 0.44, [0.5, 0.4, 0.3]); b.pop(); });
  place(-19, 50.5, 2.1, (b) => Props.leafLitter(b, mats, 1.6, 4));
  place(-26, 50, 1.6, (b) => Props.laundryLine(b, mats, 6.5, { items: 5, height: 3.4 }));
  place(-20, 44, 0, (b) => { b.at(0, 0, 0); vine(b, mats, 3.2, { seed: 3 }); b.pop(); });
  addLight(-19.5, terrain.height(-19.5, 47) + 3.0, 47, [1.0, 0.7, 0.45], 1.6, 8,
    { flicker: { speed: 7.5, phase: 2 } });
  interactables.push({
    id: 'alley_chest', x: -25.4, z: 52.4, radius: 1.8, label: '古い木箱', action: 'chest',
    text: ['埃をかぶった木箱。中にはきれいな青い石が入っていた。']
  });
  place(-25.4, 52.4, 0.9, (b) => {
    b.add(beveledBox(0.8, 0.55, 0.6, 0.03), mats.woodDark, { color: [0.48, 0.34, 0.24], ao: 0.8 });
    b.at(0, 0.34, 0);
    b.add(cylinder(0.3, 0.3, 0.8, 10, { arc: Math.PI, caps: false, yOffset: 0 }), mats.woodDark,
      { color: [0.52, 0.38, 0.26], ao: 0.9 });
    b.pop();
    b.at(0, 0.28, 0.31);
    b.add(box(0.14, 0.18, 0.06), mats.metal, { color: [0.85, 0.72, 0.4], ao: 1 });
    b.pop();
  });
  collision.addBox(-25.4, 52.4, 0.9, 0.7, 0.9, { height: 0.8, tag: 'chest' });
  audioZones.push({ id: 'alley', x: -21, z: 48, radius: 12, ambience: 'alley' });

  /* ================================================ 07 川沿い */
  const bridgeInfo = place(58, 6, Math.atan2(8, 6), (b) => stoneBridge(b, mats, 20, 6.5, 1.8), 2.2);
  for (const l of bridgeInfo.lights) {
    const ang = Math.atan2(8, 6);
    const wx = 58 + l[0] * Math.cos(ang) + l[2] * Math.sin(ang);
    const wz = 6 - l[0] * Math.sin(ang) + l[2] * Math.cos(ang);
    addLight(wx, terrain.height(58, 6) + 2.2 + l[1], wz, PALETTE.lampGlow, 5.2, 10, {});
  }
  // 川沿いの柳とベンチ
  const riverSpots = [[52, -6], [49, 10], [45, 26], [39, 44], [31, 62], [25, 78]];
  riverSpots.forEach((p, i) => {
    treeSpots.push({ x: p[0] - 4, z: p[1], kind: 'willow', s: 0.95 + (i % 3) * 0.1, seed: i * 23 });
    if (i % 2 === 0) {
      place(p[0] - 1.5, p[1] + 2, -1.2, (b) => bench(b, mats, 1.8, { woodColor: [0.6, 0.46, 0.34] }));
      collision.addBox(p[0] - 1.5, p[1] + 2, 1.9, 0.7, -1.2, { height: 0.9, tag: 'bench' });
    }
    if (i % 3 === 1) {
      const info = place(p[0] - 2.6, p[1] - 3, 0, (b) => streetLamp(b, mats, 3.4));
      collision.addCircle(p[0] - 2.6, p[1] - 3, 0.3, { height: 3.6, tag: 'lamp' });
      addLight(p[0] - 2.6, terrain.height(p[0] - 2.6, p[1] - 3) + info.lightY, p[1] - 3,
        PALETTE.lampGlow, 5.2, 11, {});
    }
  });
  // 桟橋
  place(47, 20, 0.35, (b, y) => {
    for (let i = 0; i < 7; i++) {
      b.at(0, -0.05, i * 0.9 - 1);
      b.add(beveledBox(2.4, 0.12, 0.85, 0.02), mats.wood, { color: [0.72, 0.58, 0.42], ao: 0.9 });
      b.pop();
      if (i % 2 === 0) for (const s of [-1, 1]) {
        b.at(s * 1.05, -0.9, i * 0.9 - 1);
        b.add(cylinder(0.09, 0.08, 1.8, 8, { yOffset: -0.9 }), mats.woodDark, { color: [0.44, 0.32, 0.24], ao: 0.6 });
        b.pop();
      }
    }
  }, 0.9);
  interactables.push({
    id: 'river', x: 46, z: 22, radius: 3.2, label: '川べり',
    text: ['水面に光がゆらめいている。', '銀色のアストラが水の中を滑るように泳いでいった。']
  });
  audioZones.push({ id: 'river', x: 48, z: 18, radius: 30, ambience: 'river' });

  /* ============================================= 08 展望の丘 */
  place(40, -68, 0, (b) => observationDeck(b, mats, { radius: 4.6 }));
  collision.addCircle(40, -68, 4.9, { height: 1.6, tag: 'deck' });
  shade(40, -68, 6, 0.3);
  for (const a of [0.6, 2.2, 4.0, 5.4]) {
    const lx = 40 + Math.cos(a) * 6.6, lz = -68 + Math.sin(a) * 6.6;
    const info = place(lx, lz, -a, (b) => streetLamp(b, mats, 3.2));
    collision.addCircle(lx, lz, 0.3, { height: 3.4, tag: 'lamp' });
    addLight(lx, terrain.height(lx, lz) + info.lightY, lz, PALETTE.lampGlow, 4.7, 10, {});
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    treeSpots.push({
      x: 40 + Math.cos(a) * (11 + hash2(i, 1, 3) * 5),
      z: -68 + Math.sin(a) * (11 + hash2(i, 2, 3) * 5),
      kind: i % 2 ? 'pine' : 'oak', s: 0.9 + hash2(i, 3, 3) * 0.35, seed: i * 31
    });
  }
  interactables.push({
    id: 'lookout', x: 40, z: -64, radius: 3.2, label: '展望台',
    text: ['町が一望できる。ノヴァの泉の光が、まるで町の心臓みたいに脈打っている。',
      '遠くの山の向こうに、古い塔のシルエットが見えた。']
  });
  audioZones.push({ id: 'hill', x: 40, z: -68, radius: 26, ambience: 'hill' });

  /* ============================================== 12 小さな社 */
  place(76, 32, -0.6, (b) => smallShrine(b, mats, { scale: 1.05 }));
  collision.addBox(76, 32, 5.4, 5.0, -0.6, { height: 6, tag: 'building' });
  shade(76, 32, 6, 0.4);
  addLight(73.5, terrain.height(73.5, 35) + 1.2, 35, PALETTE.lampGlow, 4.7, 9, {});
  addLight(78.5, terrain.height(78.5, 35) + 1.2, 35, PALETTE.lampGlow, 4.7, 9, {});
  interactables.push({
    id: 'shrine', x: 76, z: 36.5, radius: 3.0, label: '小さな社',
    text: ['人とアストラが初めて手をつないだ日を祀った社だという。',
      '静かに手を合わせると、胸の奥がすこし温かくなった。']
  });
  for (let i = 0; i < 5; i++) {
    const a = 0.6 + i * 0.9;
    treeSpots.push({ x: 76 + Math.cos(a) * 9, z: 32 + Math.sin(a) * 9, kind: 'pine', s: 1.0, seed: 200 + i });
  }
  audioZones.push({ id: 'shrine', x: 76, z: 32, radius: 16, ambience: 'shrine' });

  /* =============================================== 09 森の門 */
  const gateInfo = place(0, 99, 0, (b) => forestGate(b, mats, { width: 10, height: 7.2 }));
  for (const l of gateInfo.lights) {
    addLight(l[0], terrain.height(l[0], 99) + l[1], 99 + l[2], PALETTE.novaGlow, 6.4, 18, { nightOnly: false });
  }
  collision.addBox(-5, 99, 3.4, 3.4, 0, { height: 9, tag: 'building' });
  collision.addBox(5, 99, 3.4, 3.4, 0, { height: 9, tag: 'building' });
  interactables.push({
    id: 'forest_gate', x: 0, z: 97, radius: 3.4, label: '森の門',
    action: 'gate',
    text: ['ここから先はルミナの森。', 'まだ相棒のいない君が、ひとりで入るには早すぎる。']
  });
  // 門の外の森
  for (let i = 0; i < 26; i++) {
    const a = hash2(i, 1, 7) * TAU;
    const r = 14 + hash2(i, 2, 7) * 20;
    const x = Math.sin(a) * r * 1.4;
    const z = 104 + Math.abs(Math.cos(a)) * r * 0.6;
    if (Math.abs(x) < 5 && z < 110) continue;
    treeSpots.push({ x, z, kind: hash2(i, 3, 7) > 0.4 ? 'pine' : 'oak', s: 1.0 + hash2(i, 4, 7) * 0.5, seed: 300 + i });
  }
  audioZones.push({ id: 'forest', x: 0, z: 104, radius: 26, ambience: 'forest' });

  /* ================================================ 木を建てる */
  for (const t of treeSpots) {
    const fn = TREES[t.kind] || oakTree;
    const info = place(t.x, t.z, hash2(t.seed, 9, 3) * TAU, (b) => fn(b, mats, {
      seed: t.seed, scale: t.s, lod: lodScale,
      leafColor: t.kind === 'nova' ? undefined : leafTint(t.seed),
      barkColor: [0.9 + hash2(t.seed, 5, 3) * 0.25, 0.9 + hash2(t.seed, 6, 3) * 0.2, 0.88]
    }));
    collision.addCircle(t.x, t.z, Math.max(0.35, info.trunkRadius * 1.9), { height: info.height, tag: 'tree' });
    shade(t.x, t.z, info.radius * 0.85, 0.4);
    if (t.kind === 'nova') {
      addLight(t.x, terrain.height(t.x, t.z) + info.height * 0.75, t.z, PALETTE.novaGlow, 4.8, 14, { nightOnly: false });
    }
  }

  /* ============================================== 低木と生垣 */
  const bushSpots = [];
  for (let i = 0; i < 60; i++) {
    const a = hash2(i, 11, 5) * TAU;
    const r = 12 + Math.sqrt(hash2(i, 12, 5)) * 82;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (terrain.roadField(x, z).w > 0.3) continue;
    if (collision.isBlocked(x, z, 1.2)) continue;
    if (terrain.riverInfo(x, z).dist < 6) continue;
    if (terrain.slope(x, z) > 0.5) continue;
    bushSpots.push([x, z, i]);
  }
  for (const [x, z, i] of bushSpots) {
    place(x, z, hash2(i, 3, 9) * TAU, (b) => bush(b, mats, {
      radius: 0.7 + hash2(i, 4, 9) * 0.6, seed: i, lod: lodScale, color: leafTint(i)
    }));
    collision.addCircle(x, z, 0.55, { height: 1.2, tag: 'bush' });
  }

  /* ================================================ 見えない壁 */
  const bounds = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    bounds.push([Math.cos(a) * 112, Math.sin(a) * 112]);
  }
  collision.addWallLoop(bounds, 3);

  /* ================================================== 地面と草 */
  const aoField = makeAoField(footprints);
  const groundBatches = buildGround(terrain, mats, aoField);
  const grass = buildGrass(terrain, mats, (x, z, r) => collision.isBlocked(x, z, r), [
    { cx: 0, cz: 0, radius: 30, density: 1.1 },
    { cx: 0, cz: 40, radius: 34, density: 0.9 },
    { cx: -48, cz: 38, radius: 34, density: 1.0 },
    { cx: 40, cz: -66, radius: 30, density: 1.0 },
    { cx: -4, cz: -50, radius: 30, density: 0.9 },
    { cx: 46, cz: 16, radius: 30, density: 1.0 },
    { cx: 30, cz: -20, radius: 24, density: 0.9 },
    { cx: 0, cz: 92, radius: 26, density: 1.1 },
    { cx: 74, cz: 32, radius: 18, density: 0.9 },
  ]);
  const rocks = buildScatterRocks(terrain, mats, (x, z, r) => collision.isBlocked(x, z, r), [
    { cx: 48, cz: 10, radius: 20, count: 22, size: 0.5, seed: 3 },
    { cx: 34, cz: 52, radius: 20, count: 18, size: 0.42, seed: 7 },
    { cx: 40, cz: -66, radius: 22, count: 20, size: 0.6, seed: 11 },
    { cx: 0, cz: 100, radius: 24, count: 14, size: 0.5, seed: 17 },
  ]);

  /* ==================================================== 水 */
  const riverBatches = buildRiver(terrain, mats);
  const poolBatches = buildPool(0, terrain.height(0, 0) + fountain.waterLevel, 0, 4.2, mats, 36);
  for (const basin of fountain.upperBasins) {
    poolBatches.push(...buildPool(0, terrain.height(0, 0) + basin.y + 0.16, 0, basin.r - 0.22, mats, 28));
  }

  /* ================================================= NPC 配置 */
  addNpcSpawns(npcSpawns, terrain);

  return {
    staticBatches: chunks.build(),
    groundBatches,
    grassBatches: grass.batches,
    rockBatches: rocks.batches,
    waterBatches: [...riverBatches, ...poolBatches],
    collision,
    lights,
    interactables,
    npcSpawns,
    audioZones,
    districts: DISTRICTS,
    fountain,
    playerStart: { x: 2.5, z: 12.5, facing: Math.PI },
    stats: {
      triangles: chunks.triangleCount,
      grass: grass.count,
      trees: treeSpots.length,
      lights: lights.length
    }
  };
}

/* ------------------------------------------------------------ 補助 */

/** 葉の色を場所ごとに少し振る。 */
function leafTint(seed) {
  const h = hash2(seed, 3, 11);
  return [1.0 + h * 0.34, 1.1 + h * 0.2, 0.86 + h * 0.26];
}

/** 建物の足元を暗くする環境遮蔽フィールド。 */
function makeAoField(footprints) {
  const CELL = 8;
  const grid = new Map();
  footprints.forEach((f, i) => {
    const x0 = Math.floor((f.x - f.r) / CELL), x1 = Math.floor((f.x + f.r) / CELL);
    const z0 = Math.floor((f.z - f.r) / CELL), z1 = Math.floor((f.z + f.r) / CELL);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const k = `${cx},${cz}`;
      let a = grid.get(k);
      if (!a) { a = []; grid.set(k, a); }
      a.push(f);
    }
  });
  return (x, z) => {
    const arr = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!arr) return 1;
    let occ = 0;
    for (const f of arr) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r) occ = Math.max(occ, (1 - d / f.r) * f.strength);
    }
    return clamp(1 - occ, 0.32, 1);
  };
}

/** 町で暮らす人たちの配置。 */
function addNpcSpawns(spawns, terrain) {
  const list = [
    { x: -6, z: 8, kind: 'elder', clip: 'idle', facing: 0.7, route: 'plaza' },
    { x: 6, z: -6, kind: 'child', clip: 'idle', facing: 3.0, route: 'plazaRun' },
    { x: -2, z: 14, kind: 'citizen', clip: 'talk', facing: 1.2 },
    { x: 1, z: 15.4, kind: 'citizen', clip: 'talk', facing: -1.9 },
    { x: 14, z: 4, kind: 'sweeper', clip: 'sweep', facing: 2.2 },
    { x: -20, z: -2, kind: 'citizen', clip: 'carry', facing: 0.4, route: 'shopToPlaza' },
    { x: 26, z: -18, kind: 'doctor', clip: 'idle', facing: 2.6 },
    { x: -4, z: -40, kind: 'scientist', clip: 'talk', facing: 0.2 },
    { x: 2, z: -39, kind: 'scientist', clip: 'idle', facing: 3.3 },
    { x: -44, z: 34, kind: 'citizen', clip: 'idle', facing: 1.4, route: 'residential' },
    { x: -54, z: 46, kind: 'child', clip: 'idle', facing: 4.2, route: 'residentialRun' },
    { x: 44, z: 22, kind: 'fisher', clip: 'sit', facing: -0.6 },
    { x: 40, z: -63, kind: 'citizen', clip: 'lookAround', facing: 3.4 },
    { x: 0, z: 92, kind: 'guard', clip: 'idle', facing: 0 },
    { x: 21, z: 7, kind: 'citizen', clip: 'sit', facing: 2.4 },
  ];
  for (const n of list) spawns.push(n);
}

/**
 * 遠景。町の外にも世界が続いていると感じさせる。
 * 影は落とさず、フォグで空へ溶かす。
 */
function buildDistantScenery(chunks, mats, terrain, lod) {
  const mb = chunks.at(0, -300);   // 遠景専用のチャンク

  // 山並み（3 列、遠いほど淡く小さく）
  const layers = [
    { dist: 300, count: 16, h: 74, tint: [0.62, 0.68, 0.82] },
    { dist: 420, count: 14, h: 100, tint: [0.72, 0.76, 0.88] },
    { dist: 560, count: 12, h: 130, tint: [0.8, 0.84, 0.92] },
  ];
  for (const layer of layers) {
    for (let i = 0; i < layer.count; i++) {
      const a = (i / layer.count) * TAU + hash2(i, 1, 3) * 0.2;
      const d = layer.dist * (0.85 + hash2(i, 2, 3) * 0.3);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = layer.h * (0.6 + hash2(i, 3, 3) * 0.8);
      const w = h * (1.1 + hash2(i, 4, 3) * 0.9);
      mb.at(x, -20, z, hash2(i, 5, 3) * TAU);
      mb.add(cylinder(w, w * 0.06, h, 6, { caps: false }), mats.stone, {
        color: layer.tint, ao: (p) => clamp(0.7 + p[1] / h * 0.4, 0.7, 1.1)
      });
      // 雪をかぶった頂
      if (h > layer.h * 0.95) {
        mb.at(0, h * 0.72, 0);
        mb.add(cylinder(w * 0.28, w * 0.03, h * 0.3, 6, { caps: false }), mats.plaster, {
          color: [1.25, 1.28, 1.35], ao: 1
        });
        mb.pop();
      }
      mb.pop();
    }
  }

  // 遠くの森（町を囲む帯）
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * TAU + hash2(i, 7, 5) * 0.1;
    const d = 135 + hash2(i, 8, 5) * 70;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 10 + hash2(i, 9, 5) * 12;
    mb.at(x, terrain.height(x, z) - 1, z, hash2(i, 10, 5) * TAU);
    mb.add(cylinder(h * 0.3, h * 0.04, h, 5, { caps: false }), mats.leaves, {
      color: [0.6 + hash2(i, 11, 5) * 0.2, 0.78 + hash2(i, 12, 5) * 0.2, 0.58], ao: 0.9
    });
    mb.pop();
  }

  // 北の古い塔（ノヴァタワー）
  {
    const x = -40, z = -330;
    mb.at(x, 12, z, 0.4);
    mb.add(cylinder(16, 9, 120, 12, { caps: false }), mats.stone, {
      color: [0.72, 0.76, 0.86], ao: (p) => clamp(0.7 + p[1] / 120 * 0.4, 0.7, 1.1)
    });
    mb.at(0, 120, 0);
    mb.add(cylinder(13, 0.5, 30, 12, { caps: false }), mats.stone, { color: [0.66, 0.72, 0.84], ao: 1 });
    mb.at(0, 30, 0);
    mb.add(sphere(6, 12, 9, { yScale: 1.6 }), mats.crystal, { color: PALETTE.novaGlow, ao: 1 });
    mb.pop();
    mb.pop();
    mb.pop();
  }

  // 東の古代遺跡
  for (let i = 0; i < 7; i++) {
    const a = 0.1 + i * 0.12;
    const d = 260;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = 26 + hash2(i, 13, 3) * 30;
    mb.at(x, 0, z, hash2(i, 14, 3) * TAU);
    mb.add(cylinder(5 + hash2(i, 15, 3) * 4, 4, h, 6), mats.stone, {
      color: [0.76, 0.74, 0.7], ao: 0.9
    });
    mb.pop();
  }
}
