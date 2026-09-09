/**
 * 武器システム。
 *
 * ・複数の武器を持ち歩き、スロットで切り替える
 * ・使い込むほど武器ごとに XP が貯まり、Lv.4 まで成長する
 *   （威力・装弾数・連射・リロード速度が上がり、見た目も派手になる）
 * ・弾倉（マガジン）と予備弾を持ち、リロード動作が入る
 */

/** 武器の並び順＝スロット順。 */
export const WEAPON_IDS = ['blaster', 'scatter', 'smg', 'rail'];

export const WEAPONS = {
  blaster: {
    id: 'blaster',
    name: 'パルスブラスター',
    short: 'BLASTER',
    slot: 1,
    unlockWave: 1,
    auto: true,
    magazine: 14,
    reserveMax: 140,
    reserveStart: 70,
    damage: 34,
    interval: 0.16,
    pellets: 1,
    spread: 0.02,
    pierce: 0,
    reload: 1.05,
    recoil: 1,
    kick: 0.9,
    accent: [0.35, 0.95, 0.85],
    levels: [
      { xp: 0, perk: '標準装備' },
      { xp: 14, perk: '威力＋・装弾数＋', damage: 6, magazine: 4, reload: -0.1 },
      { xp: 38, perk: '連射速度＋・反動減', damage: 8, interval: -0.03, magazine: 4, reload: -0.1 },
      { xp: 76, perk: '貫通弾になる', damage: 10, pierce: 1, magazine: 6, interval: -0.02, reload: -0.15 },
    ],
  },
  scatter: {
    id: 'scatter',
    name: 'スキャッターガン',
    short: 'SCATTER',
    slot: 2,
    unlockWave: 2,
    auto: false,
    magazine: 6,
    reserveMax: 72,
    reserveStart: 30,
    damage: 17,
    interval: 0.62,
    pellets: 7,
    spread: 0.15,
    pierce: 0,
    reload: 1.7,
    recoil: 2.4,
    kick: 2.2,
    accent: [1, 0.62, 0.28],
    levels: [
      { xp: 0, perk: '近距離で高威力' },
      { xp: 12, perk: '弾数＋・威力＋', damage: 3, magazine: 2, reload: -0.2 },
      { xp: 34, perk: '散弾数＋2・拡散抑制', pellets: 2, spread: -0.02, damage: 3 },
      { xp: 70, perk: '連射速度＋・貫通', pellets: 2, interval: -0.14, pierce: 1, damage: 4, reload: -0.25 },
    ],
  },
  smg: {
    id: 'smg',
    name: 'パルスSMG',
    short: 'SMG',
    slot: 3,
    unlockWave: 3,
    auto: true,
    magazine: 34,
    reserveMax: 320,
    reserveStart: 140,
    damage: 14,
    interval: 0.075,
    pellets: 1,
    spread: 0.055,
    pierce: 0,
    reload: 1.45,
    recoil: 0.7,
    kick: 0.5,
    accent: [0.55, 0.8, 1],
    levels: [
      { xp: 0, perk: '高速連射' },
      { xp: 18, perk: '装弾数＋・集弾性＋', magazine: 8, spread: -0.012, damage: 2 },
      { xp: 44, perk: '連射速度＋', interval: -0.012, damage: 3, magazine: 8 },
      { xp: 88, perk: '2連バレル化（同時2発）', pellets: 1, damage: 3, spread: -0.008, reload: -0.25 },
    ],
  },
  rail: {
    id: 'rail',
    name: 'レールランス',
    short: 'RAIL',
    slot: 4,
    unlockWave: 5,
    auto: false,
    magazine: 4,
    reserveMax: 40,
    reserveStart: 16,
    damage: 130,
    interval: 0.85,
    pellets: 1,
    spread: 0.004,
    pierce: 3,
    reload: 2.1,
    recoil: 3,
    kick: 2.8,
    accent: [0.8, 0.45, 1],
    levels: [
      { xp: 0, perk: '一直線に貫く高威力弾' },
      { xp: 10, perk: '威力＋・装填速度＋', damage: 30, reload: -0.3 },
      { xp: 28, perk: '装弾数＋・貫通＋', magazine: 2, pierce: 1 },
      { xp: 60, perk: '最大出力（貫通6体）', damage: 60, pierce: 2, interval: -0.15, reload: -0.3 },
    ],
  },
};

/** 累計XPから武器レベル（1〜4）を求める。 */
export function levelForXp(def, xp) {
  let level = 1;
  def.levels.forEach((l, i) => {
    if (xp >= l.xp) level = i + 1;
  });
  return level;
}

/** レベルまでの強化を積み上げた実際の性能値を返す。 */
export function statsFor(def, level) {
  const stats = {
    damage: def.damage,
    interval: def.interval,
    pellets: def.pellets,
    spread: def.spread,
    pierce: def.pierce,
    magazine: def.magazine,
    reload: def.reload,
  };
  for (let i = 1; i < level; i++) {
    const up = def.levels[i];
    if (!up) break;
    stats.damage += up.damage || 0;
    stats.interval = Math.max(0.05, stats.interval + (up.interval || 0));
    stats.pellets += up.pellets || 0;
    stats.spread = Math.max(0.002, stats.spread + (up.spread || 0));
    stats.pierce += up.pierce || 0;
    stats.magazine += up.magazine || 0;
    stats.reload = Math.max(0.5, stats.reload + (up.reload || 0));
  }
  return stats;
}

/** 次のレベルまでの進捗（0〜1）。最大レベルなら 1。 */
export function levelProgress(def, xp) {
  const level = levelForXp(def, xp);
  const next = def.levels[level];
  if (!next) return 1;
  const prev = def.levels[level - 1].xp;
  return Math.max(0, Math.min(1, (xp - prev) / (next.xp - prev)));
}

/** 所持武器の初期状態を作る。 */
export function createWeaponState(id) {
  const def = WEAPONS[id];
  const stats = statsFor(def, 1);
  return {
    id,
    xp: 0,
    level: 1,
    mag: stats.magazine,
    reserve: def.reserveStart,
  };
}
