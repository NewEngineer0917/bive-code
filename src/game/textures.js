/**
 * ゲームで使うテクスチャ・スプライトをすべてコードで生成する。
 * 画像ファイルを持たないので、追加のアセット読み込みなしで動作する。
 */

export const TEX_SIZE = 64;
export const SHADE_LEVELS = 6;

const TAU = Math.PI * 2;

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function noise(ctx, size, rnd, amount) {
  for (let i = 0; i < size * size * 0.35; i++) {
    const x = (rnd() * size) | 0;
    const y = (rnd() * size) | 0;
    ctx.fillStyle = `rgba(0,0,0,${rnd() * amount})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

/* ---------------------------------- 壁 ---------------------------------- */

function brickWall(base, mortar, seed) {
  const c = canvasOf(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  const rnd = rngFrom(seed);
  g.fillStyle = mortar;
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  const bh = 8;
  for (let row = 0; row < TEX_SIZE / bh; row++) {
    const offset = (row % 2) * 16;
    for (let col = -1; col < 5; col++) {
      const x = col * 32 + offset + 1;
      const y = row * bh + 1;
      g.fillStyle = shade(base, 0.82 + rnd() * 0.38);
      g.fillRect(x, y, 30, bh - 2);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x, y, 30, 1);
    }
  }
  noise(g, TEX_SIZE, rnd, 0.25);
  return c;
}

function panelWall(base, accent, seed) {
  const c = canvasOf(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  const rnd = rngFrom(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  g.fillStyle = shade(base, 1.18);
  g.fillRect(2, 2, 60, 26);
  g.fillRect(2, 34, 60, 28);
  g.strokeStyle = shade(base, 0.5);
  g.lineWidth = 2;
  g.strokeRect(2, 2, 60, 26);
  g.strokeRect(2, 34, 60, 28);
  g.fillStyle = accent;
  g.fillRect(6, 40, 34, 4);
  g.fillStyle = shade(accent, 1.4);
  g.fillRect(6, 40, 12, 4);
  for (const [x, y] of [[7, 7], [56, 7], [7, 55], [56, 55]]) {
    g.fillStyle = shade(base, 1.5);
    g.beginPath();
    g.arc(x, y, 2, 0, TAU);
    g.fill();
  }
  noise(g, TEX_SIZE, rnd, 0.22);
  return c;
}

function rockWall(base, seed) {
  const c = canvasOf(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  const rnd = rngFrom(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  for (let i = 0; i < 46; i++) {
    const x = rnd() * TEX_SIZE;
    const y = rnd() * TEX_SIZE;
    const r = 3 + rnd() * 9;
    g.fillStyle = shade(base, 0.75 + rnd() * 0.5);
    g.beginPath();
    g.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * TAU, 0, TAU);
    g.fill();
  }
  noise(g, TEX_SIZE, rnd, 0.35);
  return c;
}

function hazardWall(seed) {
  const c = canvasOf(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  const rnd = rngFrom(seed);
  g.fillStyle = '#1a1c26';
  g.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  g.save();
  g.beginPath();
  g.rect(0, 0, TEX_SIZE, TEX_SIZE);
  g.clip();
  g.strokeStyle = '#e0b431';
  g.lineWidth = 8;
  for (let i = -TEX_SIZE; i < TEX_SIZE * 2; i += 18) {
    g.beginPath();
    g.moveTo(i, -4);
    g.lineTo(i + TEX_SIZE, TEX_SIZE + 4);
    g.stroke();
  }
  g.restore();
  g.fillStyle = '#0e1018';
  g.fillRect(0, 26, TEX_SIZE, 12);
  g.fillStyle = '#4be0c0';
  g.fillRect(4, 30, TEX_SIZE - 8, 4);
  noise(g, TEX_SIZE, rnd, 0.3);
  return c;
}

/* -------------------------------- 敵スプライト -------------------------------- */

function droneSprite(frame, hurt) {
  const c = canvasOf(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  const body = hurt ? '#ffb2b2' : '#b83a4a';
  const wob = frame ? 2 : -2;

  g.fillStyle = 'rgba(255,120,90,0.25)';
  g.beginPath();
  g.ellipse(32, 54, 10, 5, 0, 0, TAU);
  g.fill();

  g.fillStyle = '#2a2e44';
  g.beginPath();
  g.ellipse(12, 32 + wob, 12, 4.5, 0, 0, TAU);
  g.fill();
  g.beginPath();
  g.ellipse(52, 32 - wob, 12, 4.5, 0, 0, TAU);
  g.fill();

  const grad = g.createRadialGradient(26, 24, 3, 32, 32, 20);
  grad.addColorStop(0, hurt ? '#ffffff' : '#e0616f');
  grad.addColorStop(1, body);
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(32, 31, 17, 15, 0, 0, TAU);
  g.fill();

  g.fillStyle = '#161a2b';
  g.beginPath();
  g.ellipse(32, 30, 9, 7, 0, 0, TAU);
  g.fill();
  g.fillStyle = frame ? '#ff5b4a' : '#ffd25b';
  g.beginPath();
  g.ellipse(32, 30, 4.5, 3.5, 0, 0, TAU);
  g.fill();

  g.fillStyle = 'rgba(120,200,255,0.75)';
  g.beginPath();
  g.ellipse(32, 47, 5, 3 + (frame ? 2 : 0), 0, 0, TAU);
  g.fill();
  return c;
}

function gunnerSprite(frame, hurt) {
  const c = canvasOf(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  const body = hurt ? '#d9c4ff' : '#5b4b96';
  const legSwing = frame ? 3 : -3;

  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.beginPath();
  g.ellipse(32, 61, 13, 3.5, 0, 0, TAU);
  g.fill();

  g.fillStyle = shade('#2f2a4a', hurt ? 1.8 : 1);
  g.fillRect(24 - legSwing, 42, 7, 18);
  g.fillRect(33 + legSwing, 42, 7, 18);

  g.fillStyle = body;
  g.fillRect(22, 20, 20, 24);
  g.fillStyle = shade(body, 1.25);
  g.fillRect(22, 20, 20, 5);

  g.fillStyle = '#79ffd0';
  g.fillRect(28, 30, 8, 4);

  g.fillStyle = shade(body, 0.8);
  g.beginPath();
  g.arc(32, 15, 8, 0, TAU);
  g.fill();
  g.fillStyle = hurt ? '#ffffff' : '#ff6a4d';
  g.fillRect(27, 13, 10, 3);

  // キャノン腕
  g.fillStyle = shade(body, 0.7);
  g.fillRect(40, 24, 16, 8);
  g.fillStyle = frame ? '#ffe07a' : '#9ad7ff';
  g.beginPath();
  g.arc(56, 28, 4, 0, TAU);
  g.fill();
  g.fillStyle = shade(body, 0.7);
  g.fillRect(10, 24, 12, 7);
  return c;
}

function bruteSprite(frame, hurt) {
  const c = canvasOf(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  const body = hurt ? '#ffe0b2' : '#3f6b4a';
  const arm = frame ? 4 : -4;

  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(32, 62, 17, 4, 0, 0, TAU);
  g.fill();

  g.fillStyle = shade('#26402c', hurt ? 2 : 1);
  g.fillRect(20, 46, 10, 15);
  g.fillRect(34, 46, 10, 15);

  g.fillStyle = body;
  g.fillRect(16, 16, 32, 32);
  g.fillStyle = shade(body, 1.3);
  g.fillRect(16, 16, 32, 6);
  g.fillStyle = shade(body, 0.65);
  g.fillRect(16, 40, 32, 8);

  g.fillStyle = shade(body, 0.85);
  g.fillRect(6, 20 + arm, 12, 22);
  g.fillRect(46, 20 - arm, 12, 22);
  g.fillStyle = '#c9d6cf';
  g.fillRect(6, 40 + arm, 12, 5);
  g.fillRect(46, 40 - arm, 12, 5);

  g.fillStyle = shade(body, 0.7);
  g.fillRect(25, 6, 14, 12);
  g.fillStyle = hurt ? '#ffffff' : '#ffd447';
  g.fillRect(27, 10, 4, 4);
  g.fillRect(34, 10, 4, 4);
  return c;
}

/* -------------------------------- その他スプライト ------------------------------- */

function ammoSprite() {
  const c = canvasOf(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(32, 52, 15, 4, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#2f6f4a';
  g.fillRect(16, 24, 32, 26);
  g.fillStyle = '#3f9464';
  g.fillRect(16, 24, 32, 7);
  g.fillStyle = '#12331f';
  g.fillRect(16, 36, 32, 3);
  g.fillStyle = '#ffd447';
  for (let i = 0; i < 3; i++) g.fillRect(21 + i * 8, 41, 5, 7);
  g.strokeStyle = '#0d2216';
  g.lineWidth = 2;
  g.strokeRect(16, 24, 32, 26);
  return c;
}

function healthSprite() {
  const c = canvasOf(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(32, 52, 15, 4, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#e8eef5';
  g.fillRect(17, 25, 30, 25);
  g.fillStyle = '#c3ccd8';
  g.fillRect(17, 25, 30, 5);
  g.fillStyle = '#e8384f';
  g.fillRect(29, 31, 6, 16);
  g.fillRect(24, 36, 16, 6);
  g.strokeStyle = '#7d8794';
  g.lineWidth = 2;
  g.strokeRect(17, 25, 30, 25);
  return c;
}

function orbSprite(color) {
  const size = 32;
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(16, 16, 16, 0, TAU);
  g.fill();
  return c;
}

/**
 * 武器スプライト。レベルが上がるほど大きく、砲身が増え、発光部が派手になる。
 */
const WEAPON_STYLES = [
  { body: '#3b4569', trim: '#5a6790', cell: '#4be0c0', barrels: 1, barrelLen: 58, cellW: 46, wing: 0 },
  { body: '#3d4a74', trim: '#63719c', cell: '#63f0d0', barrels: 1, barrelLen: 66, cellW: 52, wing: 6 },
  { body: '#3f4a7e', trim: '#6c7cae', cell: '#7ce8ff', barrels: 2, barrelLen: 70, cellW: 56, wing: 10 },
  { body: '#46407e', trim: '#7a72b6', cell: '#9d8bff', barrels: 2, barrelLen: 82, cellW: 60, wing: 14 },
  { body: '#4d3a76', trim: '#8b6fc0', cell: '#c46bff', barrels: 3, barrelLen: 88, cellW: 64, wing: 18 },
  { body: '#5c4426', trim: '#c9973f', cell: '#ffe27a', barrels: 3, barrelLen: 96, cellW: 68, wing: 24 },
];

function weaponSprite(level) {
  const st = WEAPON_STYLES[Math.max(0, Math.min(WEAPON_STYLES.length - 1, level - 1))];
  const c = canvasOf(340, 240);
  const g = c.getContext('2d');

  g.save();
  g.translate(170, 130);
  g.rotate(-0.13);
  g.translate(-170, -130);

  // 前腕（画面右下から伸びる）
  g.fillStyle = '#2b3252';
  g.beginPath();
  g.moveTo(150, 240);
  g.lineTo(140, 196);
  g.lineTo(222, 188);
  g.lineTo(246, 240);
  g.closePath();
  g.fill();
  g.fillStyle = '#3c4674';
  g.beginPath();
  g.moveTo(146, 218);
  g.lineTo(233, 210);
  g.lineTo(238, 224);
  g.lineTo(149, 232);
  g.closePath();
  g.fill();

  // グリップ
  g.fillStyle = '#1d2333';
  g.beginPath();
  g.moveTo(136, 148);
  g.lineTo(186, 148);
  g.lineTo(204, 214);
  g.lineTo(154, 214);
  g.closePath();
  g.fill();

  // トリガーガード
  g.strokeStyle = '#232a3d';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(160, 158, 22, 0.15, Math.PI * 0.85);
  g.stroke();

  // side wings（レベルが上がると横に張り出す）
  if (st.wing > 0) {
    g.fillStyle = shade(st.body, 0.75);
    g.fillRect(112 - st.wing, 92, st.wing + 8, 44);
    g.fillRect(220, 88, st.wing + 8, 48);
    g.fillStyle = st.cell;
    g.fillRect(112 - st.wing + 3, 104, Math.max(3, st.wing - 4), 18);
    g.fillRect(223, 100, Math.max(3, st.wing - 4), 22);
  }

  // 本体（レシーバー）
  const body = g.createLinearGradient(0, 74, 0, 152);
  body.addColorStop(0, st.trim);
  body.addColorStop(0.5, st.body);
  body.addColorStop(1, shade(st.body, 0.6));
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(112, 84);
  g.lineTo(228, 78);
  g.lineTo(232, 146);
  g.lineTo(116, 152);
  g.closePath();
  g.fill();

  // 排熱スリット
  g.fillStyle = '#141a2b';
  for (let i = 0; i < 3; i++) g.fillRect(196, 96 + i * 14, 26, 7);

  // エネルギーセル
  g.fillStyle = '#101627';
  g.fillRect(122, 100, st.cellW + 8, 26);
  g.fillStyle = st.cell;
  g.fillRect(126, 104, st.cellW, 18);
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.55;
  g.fillRect(126, 104, Math.round(st.cellW * 0.3), 18);
  g.globalAlpha = 1;

  // 上部レール＆サイト
  g.fillStyle = shade(st.body, 0.8);
  g.fillRect(146, 62, 46, 24);
  g.fillStyle = '#151b2c';
  g.fillRect(160, 54, 16, 12);

  // バレル（本数がレベルで増える）
  const top = 68 - st.barrelLen;
  const gap = st.barrels > 1 ? 36 / st.barrels : 0;
  for (let i = 0; i < st.barrels; i++) {
    const offset = (i - (st.barrels - 1) / 2) * (gap + 14);
    const bx = 152 + offset;
    g.fillStyle = shade(st.body, 0.95);
    g.fillRect(bx, top, 30, st.barrelLen);
    g.fillStyle = shade(st.body, 0.62);
    g.fillRect(bx, top, 9, st.barrelLen);
    g.fillStyle = '#0f1422';
    g.fillRect(bx - 5, top - 10, 40, 16);
    g.fillStyle = st.cell;
    g.fillRect(bx - 1, top - 6, 32, 5);
  }

  // ハンド（グリップを握る手）
  g.fillStyle = '#39415f';
  g.beginPath();
  g.moveTo(128, 146);
  g.lineTo(192, 143);
  g.lineTo(208, 196);
  g.lineTo(142, 200);
  g.closePath();
  g.fill();
  g.fillStyle = '#2c3350';
  for (let i = 0; i < 3; i++) g.fillRect(133 + i * 2, 152 + i * 14, 62, 5);

  g.restore();
  return c;
}

/** 武器強化コア（拾うと武器XPが増えるアイテム）。 */
function coreSprite() {
  const c = canvasOf(TEX_SIZE, TEX_SIZE);
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(32, 52, 13, 4, 0, 0, TAU);
  g.fill();
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 18);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.4, '#7ce8ff');
  grad.addColorStop(1, 'rgba(60,120,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 18, 0, TAU);
  g.fill();
  g.strokeStyle = '#dff6ff';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(32, 16);
  g.lineTo(45, 32);
  g.lineTo(32, 48);
  g.lineTo(19, 32);
  g.closePath();
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.moveTo(32, 23);
  g.lineTo(39, 32);
  g.lineTo(32, 41);
  g.lineTo(25, 32);
  g.closePath();
  g.fill();
  return c;
}

/* ------------------------- 解像度ティア別のアセット生成 ------------------------- */

/**
 * 画像を res × res 相当のドット絵に粗くする（出力サイズは元のまま）。
 * 8bit / 16bit 時代の見た目を、同じ描画コードのまま再現するための処理。
 */
function pixelate(src, res) {
  if (res >= src.width) return src;
  const small = canvasOf(res, Math.round((res * src.height) / src.width));
  const sg = small.getContext('2d');
  sg.imageSmoothingEnabled = true;
  sg.drawImage(src, 0, 0, small.width, small.height);

  const out = canvasOf(src.width, src.height);
  const og = out.getContext('2d');
  og.imageSmoothingEnabled = false;
  og.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

function shadedVariants(src, levels) {
  const out = [];
  for (let i = 0; i < levels; i++) {
    const c = canvasOf(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(6,8,18,${(i / (levels - 1)) * 0.82})`;
    g.fillRect(0, 0, c.width, c.height);
    out.push(c);
  }
  return out;
}

/* 解像度ティアごとの設定: アートの粗さと明暗段階数 */
const ASSET_SETS = [
  { texRes: 16, spriteRes: 20, shades: 4 },   // 0: ドット絵時代
  { texRes: 32, spriteRes: 40, shades: 6 },   // 1: 中間
  { texRes: 64, spriteRes: 64, shades: 10 },  // 2: 高精細（元データそのまま）
];

const baseCache = { walls: null, enemies: null, pickups: null, orb: null, weapons: null };
const setCache = [];

function baseArt() {
  if (!baseCache.walls) {
    baseCache.walls = [
      null,
      brickWall('#7c3b3b', '#2a1d22', 11),
      panelWall('#39456b', '#4be0c0', 23),
      rockWall('#4d5566', 37),
      hazardWall(53),
    ];
    baseCache.enemies = {
      drone: [droneSprite(0, false), droneSprite(1, false), droneSprite(0, true)],
      gunner: [gunnerSprite(0, false), gunnerSprite(1, false), gunnerSprite(0, true)],
      brute: [bruteSprite(0, false), bruteSprite(1, false), bruteSprite(0, true)],
    };
    baseCache.pickups = { ammo: ammoSprite(), health: healthSprite(), core: coreSprite() };
    baseCache.orb = orbSprite('#c46bff');
    baseCache.weapons = WEAPON_STYLES.map((_, i) => weaponSprite(i + 1));
  }
  return baseCache;
}

/**
 * 指定ティアのアセット一式を返す（必要になった時点で生成してキャッシュする）。
 * setIndex: 0 = 低解像度, 1 = 中, 2 = 高
 */
export function getAssetSet(setIndex) {
  const idx = Math.max(0, Math.min(ASSET_SETS.length - 1, setIndex));
  if (setCache[idx]) return setCache[idx];

  const conf = ASSET_SETS[idx];
  const base = baseArt();
  const sprite = (src) => shadedVariants(pixelate(src, conf.spriteRes), conf.shades);

  const enemies = {};
  for (const [type, imgs] of Object.entries(base.enemies)) {
    enemies[type] = {
      frames: [sprite(imgs[0]), sprite(imgs[1])],
      hurt: sprite(imgs[2]),
    };
  }

  setCache[idx] = {
    walls: base.walls.map((w) => (w ? pixelate(w, conf.texRes) : null)),
    enemies,
    pickups: {
      ammo: sprite(base.pickups.ammo),
      health: sprite(base.pickups.health),
      core: sprite(base.pickups.core),
    },
    orb: sprite(base.orb),
    weapons: base.weapons.map((w) => pixelate(w, conf.spriteRes === 64 ? 340 : conf.spriteRes * 5)),
    shades: conf.shades,
  };
  return setCache[idx];
}

/** 床のテクスチャ（フロアキャスティング用に生の画素配列で持つ）。 */
let floorTexCache = null;

export function getFloorTextures() {
  if (floorTexCache) return floorTexCache;
  const make = (canvas) => {
    const g = canvas.getContext('2d');
    const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
    return { data, size: canvas.width };
  };
  floorTexCache = { floor: make(rockWall('#3b4152', 71)) };
  return floorTexCache;
}
