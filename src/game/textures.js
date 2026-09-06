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

function weaponSprite() {
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

  // 本体（レシーバー）
  const body = g.createLinearGradient(0, 74, 0, 152);
  body.addColorStop(0, '#5a6790');
  body.addColorStop(0.5, '#3b4569');
  body.addColorStop(1, '#242b44');
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
  g.fillRect(122, 100, 54, 26);
  g.fillStyle = '#4be0c0';
  g.fillRect(126, 104, 46, 18);
  g.fillStyle = '#a7fff0';
  g.fillRect(126, 104, 16, 18);

  // 上部レール＆サイト
  g.fillStyle = '#2e3752';
  g.fillRect(146, 62, 46, 24);
  g.fillStyle = '#151b2c';
  g.fillRect(160, 54, 16, 12);

  // バレル
  g.fillStyle = '#39425f';
  g.fillRect(152, 10, 32, 58);
  g.fillStyle = '#242c44';
  g.fillRect(152, 10, 10, 58);
  g.fillStyle = '#0f1422';
  g.fillRect(146, 0, 44, 16);
  g.fillStyle = '#4be0c0';
  g.fillRect(150, 4, 36, 5);

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
  for (let i = 0; i < 3; i++) {
    g.fillRect(133 + i * 2, 152 + i * 14, 62, 5);
  }

  g.restore();
  return c;
}

/* --------------------------------- 明暗バリエーション --------------------------------- */

function shadedVariants(src) {
  const out = [];
  for (let i = 0; i < SHADE_LEVELS; i++) {
    const c = canvasOf(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = `rgba(6,8,18,${(i / (SHADE_LEVELS - 1)) * 0.82})`;
    g.fillRect(0, 0, c.width, c.height);
    out.push(c);
  }
  return out;
}

function enemyAsset(draw) {
  return {
    frames: [shadedVariants(draw(0, false)), shadedVariants(draw(1, false))],
    hurt: shadedVariants(draw(0, true)),
  };
}

let cached = null;

/** 全アセットを生成（初回のみ実行し、以降はキャッシュを返す）。 */
export function buildAssets() {
  if (cached) return cached;
  cached = {
    walls: [
      null,
      brickWall('#7c3b3b', '#2a1d22', 11),
      panelWall('#39456b', '#4be0c0', 23),
      rockWall('#4d5566', 37),
      hazardWall(53),
    ],
    enemies: {
      drone: enemyAsset(droneSprite),
      gunner: enemyAsset(gunnerSprite),
      brute: enemyAsset(bruteSprite),
    },
    pickups: {
      ammo: shadedVariants(ammoSprite()),
      health: shadedVariants(healthSprite()),
    },
    orb: shadedVariants(orbSprite('#c46bff')),
    weapon: weaponSprite(),
  };
  return cached;
}
