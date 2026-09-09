/**
 * 描画・音・武器の「時代進化」を定義するティア表。
 *
 * ウェーブが進むごとにティアが 1 段上がり、8bit のドット絵から
 * 高解像度の 3D 描画へ、チープな電子音から厚みのある効果音へと変化する。
 */

/* DawnBringer 16: ドット絵時代を強く感じさせる定番の16色パレット */
const PALETTE_16 = [
  '#140c1c', '#442434', '#30346d', '#4e4a4e', '#854c30', '#346524', '#d04648', '#757161',
  '#597dce', '#d27d2c', '#8595a1', '#6daa2c', '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6',
];

/* 16色を補間して増やした32色（16bit機の色数感） */
const PALETTE_32 = (() => {
  const out = PALETTE_16.slice();
  for (let i = 0; i < 16; i += 1) {
    const a = PALETTE_16[i];
    const b = PALETTE_16[(i + 5) % 16];
    const mix = (x, y) => Math.round((parseInt(x, 16) + parseInt(y, 16)) / 2);
    const r = mix(a.slice(1, 3), b.slice(1, 3));
    const g = mix(a.slice(3, 5), b.slice(3, 5));
    const bl = mix(a.slice(5, 7), b.slice(5, 7));
    out.push(`#${[r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  }
  return out;
})();

/**
 * assetSet: 0 = 低解像度アート, 1 = 中解像度, 2 = 高解像度（元データ）
 * palette:  固定パレットに丸める場合はその配列
 * colorLevels: パレットを使わない場合のチャンネルあたり階調数（0 = 丸めない）
 */
export const TIERS = [
  {
    id: 0,
    label: '8-BIT',
    note: 'ドット絵・16色・低解像度',
    scale: 0.20, maxWidth: 260, smoothing: false,
    assetSet: 0, shadeLevels: 3,
    palette: PALETTE_16, colorLevels: 0,
    floor: 'flat', lights: false, scanline: 0.5, bloom: 0, ao: false,
    audio: { crush: 5, reverb: 0, pan: false, layers: 1, sub: 0, filter: false },
  },
  {
    id: 1,
    label: '16-BIT',
    note: '色数と解像度が向上',
    scale: 0.30, maxWidth: 380, smoothing: false,
    assetSet: 0, shadeLevels: 4,
    palette: PALETTE_32, colorLevels: 0,
    floor: 'flat', lights: false, scanline: 0.34, bloom: 0, ao: false,
    audio: { crush: 7, reverb: 0.05, pan: false, layers: 1, sub: 0, filter: true },
  },
  {
    id: 2,
    label: 'VGA',
    note: 'テクスチャ精細化・階調表現',
    scale: 0.44, maxWidth: 520, smoothing: false,
    assetSet: 1, shadeLevels: 6,
    palette: null, colorLevels: 6,
    floor: 'gradient', lights: false, scanline: 0.16, bloom: 0, ao: false,
    audio: { crush: 0, reverb: 0.12, pan: true, layers: 2, sub: 0, filter: true },
  },
  {
    id: 3,
    label: 'SVGA',
    note: '床の描画と動的ライティング',
    scale: 0.62, maxWidth: 680, smoothing: true,
    assetSet: 1, shadeLevels: 8,
    palette: null, colorLevels: 0,
    floor: 'textured', lights: true, scanline: 0.06, bloom: 0.10, ao: true,
    audio: { crush: 0, reverb: 0.2, pan: true, layers: 2, sub: 0.3, filter: true },
  },
  {
    id: 4,
    label: 'HD',
    note: '高解像度・柔らかな陰影',
    scale: 0.84, maxWidth: 780, smoothing: true,
    assetSet: 2, shadeLevels: 10,
    palette: null, colorLevels: 0,
    floor: 'textured', lights: true, scanline: 0, bloom: 0.16, ao: true,
    audio: { crush: 0, reverb: 0.28, pan: true, layers: 3, sub: 0.55, filter: true },
  },
  {
    id: 5,
    label: 'ULTRA',
    note: '最高精細・ブルームと環境光',
    scale: 0.95, maxWidth: 900, smoothing: true,
    assetSet: 2, shadeLevels: 12,
    palette: null, colorLevels: 0,
    floor: 'textured', lights: true, scanline: 0, bloom: 0.24, ao: true,
    audio: { crush: 0, reverb: 0.36, pan: true, layers: 3, sub: 0.85, filter: true },
  },
];

/** ウェーブ数から描画ティアを決める（1ウェーブごとに1段進化する）。 */
export function tierForWave(wave) {
  return TIERS[Math.max(0, Math.min(TIERS.length - 1, wave - 1))];
}

/**
 * 武器のレベル定義。撃破で貯まる XP でランクアップする。
 * xp は「そのレベルになるまでに必要な累計 XP」。
 */
export const WEAPON_LEVELS = [
  {
    level: 1, name: 'ブラスター Mk.I', xp: 0,
    damage: 34, interval: 0.14, pellets: 1, spread: 0.028, magazine: 99,
    perk: '標準装備',
  },
  {
    level: 2, name: 'ブラスター Mk.II', xp: 8,
    damage: 42, interval: 0.125, pellets: 1, spread: 0.024, magazine: 110,
    perk: '威力と連射速度が向上',
  },
  {
    level: 3, name: 'デュアルボルト Mk.III', xp: 22,
    damage: 46, interval: 0.115, pellets: 2, spread: 0.05, magazine: 120,
    perk: '2連射（拡散）',
  },
  {
    level: 4, name: 'パルスランス Mk.IV', xp: 44,
    damage: 58, interval: 0.1, pellets: 2, spread: 0.042, magazine: 130,
    perk: '貫通弾：敵を1体まで貫く',
    pierce: 1,
  },
  {
    level: 5, name: 'ヴォイドレイ Mk.V', xp: 76,
    damage: 68, interval: 0.09, pellets: 3, spread: 0.06, magazine: 140,
    perk: '3連射・貫通強化',
    pierce: 2,
  },
  {
    level: 6, name: 'アニヒレーター Mk.VI', xp: 120,
    damage: 86, interval: 0.075, pellets: 3, spread: 0.05, magazine: 160,
    perk: '最大出力・貫通3体',
    pierce: 3,
  },
];

/** 累計XPから武器レベル定義を引く。 */
export function weaponForXp(xp) {
  let found = WEAPON_LEVELS[0];
  for (const def of WEAPON_LEVELS) if (xp >= def.xp) found = def;
  return found;
}

/** 次のレベルまでの進捗（0〜1）と次の定義。最大レベルなら next は null。 */
export function weaponProgress(xp) {
  const current = weaponForXp(xp);
  const next = WEAPON_LEVELS[current.level] || null;
  if (!next) return { current, next: null, ratio: 1 };
  const span = next.xp - current.xp;
  return { current, next, ratio: Math.max(0, Math.min(1, (xp - current.xp) / span)) };
}
