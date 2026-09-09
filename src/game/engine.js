/**
 * レイキャスティング方式の 3D FPS エンジン（Canvas 2D のみ / 外部ライブラリなし）。
 *
 * - 壁は DDA レイキャストで 1 列ずつテクスチャを描画する
 * - 敵・弾・アイテムはスプライトとして Z バッファ付きで描画する
 * - 入力（キーボード / マウス / タッチ）は React 側から setInput 経由で受け取る
 */

import { getAssetSet, getFloorTextures } from './textures';
import { createRng } from './mapGen';
import { generateCity } from './cityGen';
import { Sfx } from './audio';
import { GL_QUALITY, RENDER_2D } from './fidelity';
import { Renderer3D } from './renderer3d';
import {
  WEAPONS, WEAPON_IDS, createWeaponState, levelForXp, levelProgress, statsFor,
} from './weapons';

const TAU = Math.PI * 2;
const PLAYER_RADIUS = 0.22;
const WALK_SPEED = 3.1;
const SPRINT_SPEED = 4.5;
const KEY_TURN_SPEED = 2.6;
const FOG_DISTANCE = 13;

/* 撃破で得られる武器XP（使っていた武器に入る） */
const XP_BY_TYPE = { drone: 1, gunner: 2, brute: 4 };

export const DIFFICULTIES = {
  easy: { key: 'easy', label: 'かんたん', hp: 140, ammo: 64, dmg: 0.65, spd: 0.9, count: 0.8 },
  normal: { key: 'normal', label: 'ふつう', hp: 100, ammo: 48, dmg: 1, spd: 1, count: 1 },
  hard: { key: 'hard', label: 'むずかしい', hp: 80, ammo: 40, dmg: 1.45, spd: 1.15, count: 1.25 },
};

const ENEMY_TYPES = {
  drone: {
    name: 'ドローン', hp: 55, speed: 2.0, damage: 9, score: 100, radius: 0.3,
    scale: 0.62, hover: 0.32, range: 1.05, cooldown: 0.9, ranged: false,
    center3d: 1.15, height3d: 0.8,
  },
  gunner: {
    name: 'ガンナー', hp: 75, speed: 1.35, damage: 11, score: 150, radius: 0.32,
    scale: 0.85, hover: 0, range: 8.5, cooldown: 1.7, ranged: true,
    center3d: 1.1, height3d: 1.7,
  },
  brute: {
    name: 'ブルート', hp: 185, speed: 1.05, damage: 19, score: 300, radius: 0.42,
    scale: 1.1, hover: 0, range: 1.35, cooldown: 1.5, ranged: false,
    center3d: 1.3, height3d: 2.3,
  },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * 固定パレットへの最近色変換テーブル（5bit RGB → パレット色）。
 * ドット絵ティアで画面全体を 16 色などに丸めるために使う。
 */
const lutCache = new Map();

function paletteLut(palette) {
  const key = palette.join('');
  if (lutCache.has(key)) return lutCache.get(key);

  const colors = palette.map((hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]);
  const lut = new Uint8Array(32 * 32 * 32 * 3);
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const R = r * 8;
        const G = g * 8;
        const B = b * 8;
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < colors.length; i++) {
          const c = colors[i];
          const d = (c[0] - R) ** 2 + (c[1] - G) ** 2 + (c[2] - B) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
        const idx = ((r << 10) | (g << 5) | b) * 3;
        lut[idx] = colors[best][0];
        lut[idx + 1] = colors[best][1];
        lut[idx + 2] = colors[best][2];
      }
    }
  }
  lutCache.set(key, lut);
  return lut;
}

/** 階調を n 段に丸めるルックアップテーブル。 */
function quantizeLut(n) {
  const lut = new Uint8Array(256);
  const step = 255 / (n - 1);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(Math.round(i / step) * step);
  return lut;
}

function normAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export class Game {
  constructor(canvas, { onEvent, glCanvas } = {}) {
    this.canvas = canvas;
    // 3D モードでは HUD だけをこのキャンバスに描くので透過が必要
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.glCanvas = glCanvas || null;
    this.gl3d = null;
    this.mode3d = false;
    this.sfx = new Sfx();
    this.onEvent = onEvent || (() => {});

    this.input = { forward: 0, strafe: 0, turn: 0, sprint: false, firing: false };
    this.state = 'menu'; // menu | playing | paused | over
    this.difficulty = DIFFICULTIES.normal;

    this.map = null;
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.spawnQueue = [];
    this.wave = 0;
    this.waveBreak = 0;
    this.kills = 0;
    this.elapsed = 0;

    this.pitch = 0;
    this.bob = 0;
    this.shake = 0;
    this.aimHot = false;

    this.player = null;
    this._raf = null;
    this._last = 0;
    this._shades = [];
    for (let i = 0; i <= 24; i++) this._shades.push(`rgba(6,8,18,${(i / 24).toFixed(3)})`);

    // 描画は一度オフスクリーンに描いてから画面へ引き伸ばす。
    // このバッファの解像度と後処理がティアごとの「時代」を作る。
    this.buf = document.createElement('canvas');
    this.bctx = this.buf.getContext('2d', { alpha: false });
    this.bloomBuf = document.createElement('canvas');
    this.lights = [];

    this.tier = RENDER_2D;
    this.assets = getAssetSet(this.tier.assetSet);
    this.paletteLut = null;

    // 描画負荷に応じて解像度を自動調整する（弱い端末でも 60fps を保つため）
    this.quality = 1;
    this._frameAvg = 16;
    this._qualityTimer = 0;

    this.resize();
  }

  /* ------------------------------- ライフサイクル ------------------------------- */

  start() {
    if (this._raf != null) return;
    this._last = performance.now() / 1000;
    this._raf = requestAnimationFrame(this._loop);
  }

  destroy() {
    if (this._raf != null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _loop = (ts) => {
    this._raf = requestAnimationFrame(this._loop);
    const now = ts / 1000;
    let dt = now - this._last;
    this._last = now;
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 0.05);
    if (this.state === 'playing') this.update(dt);
    this.render(dt);
    this.autoQuality(dt);
  };

  /**
   * 直近のフレーム時間から解像度を上下させる。
   * 重ければ落として滑らかさを優先し、余裕があれば徐々に戻す。
   */
  autoQuality(dt) {
    this._frameAvg += (dt * 1000 - this._frameAvg) * 0.05;
    this._qualityTimer += dt;
    if (this._qualityTimer < 1.5 || this.state !== 'playing') return;
    this._qualityTimer = 0;

    let next = this.quality;
    if (this._frameAvg > 26 && this.quality > 0.55) next = Math.max(0.55, this.quality - 0.15);
    else if (this._frameAvg < 14 && this.quality < 1) next = Math.min(1, this.quality + 0.1);
    if (next !== this.quality) {
      this.quality = next;
      this.applyTier(this.tier, true);
      this._frameAvg = 16;
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const coarse = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(pointer: coarse)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
    const cssW = Math.max(1, Math.round(rect.width || window.innerWidth));
    const cssH = Math.max(1, Math.round(rect.height || window.innerHeight));

    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.W = this.canvas.width;
    this.H = this.canvas.height;
    this.coarse = coarse;

    // 画角：横長なら広く、縦長では狭くして歪みを防ぐ
    const aspect = this.W / this.H;
    const hFovDeg = aspect >= 1.5 ? 78 : aspect >= 1 ? 72 : 56;
    this.planeLen = Math.tan((hFovDeg * Math.PI) / 360);
    this.uiScale = clamp(Math.min(this.W, this.H) / 720, 0.6, 2.4);

    this.applyTier(this.tier, true);
    if (this.mode3d && this.gl3d) this.gl3d.resize(this.W, this.H, true);
  }

  /**
   * ティアに応じて 2D（レイキャスティング）と 3D（WebGL）を切り替える。
   * WebGL が使えない環境では 2D のまま動き続ける。
   */
  setupRenderMode() {
    const want3d = this.glCanvas && Renderer3D.isSupported();
    if (want3d && !this.gl3d) {
      try {
        this.gl3d = new Renderer3D(this.glCanvas);
        if (this.map) this.gl3d.buildMap(this.map);
      } catch (e) {
        this.gl3d = null;
        this.onEvent('renderer', { mode: '2d', reason: String(e && e.message) });
      }
    }
    this.mode3d = !!(want3d && this.gl3d);
    if (this.glCanvas) this.glCanvas.style.display = this.mode3d ? 'block' : 'none';
    if (this.mode3d) {
      this.gl3d.setQuality({
        ...GL_QUALITY,
        scale: GL_QUALITY.scale * this.quality * (this.coarse ? 0.8 : 1),
      });
      this.gl3d.resize(this.W, this.H, true);
    }
  }

  /**
   * 描画ティアを適用する。
   * オフスクリーンバッファの解像度、アセットの粗さ、後処理、音の質感が
   * すべてここで切り替わる。
   */
  applyTier(tier, force = false) {
    if (!force && this.tier === tier) return;
    this.tier = tier;
    this.assets = getAssetSet(tier.assetSet);
    this.sfx.setTier(tier.audio);
    this.setupRenderMode();

    // バッファ解像度（モバイルでは上限を下げる）
    const cap = Math.round(tier.maxWidth * (this.coarse ? 0.72 : 1) * this.quality);
    const bw = Math.max(160, Math.min(cap, Math.round(this.W * tier.scale * this.quality)));
    const bh = Math.max(90, Math.round((bw * this.H) / this.W));
    this.buf.width = bw;
    this.buf.height = bh;
    this.bufW = bw;
    this.bufH = bh;
    this.bloomBuf.width = Math.max(32, Math.round(bw / 3));
    this.bloomBuf.height = Math.max(18, Math.round(bh / 3));

    // 解像度が高いティアは 1 レイ＝2px にして壁のループ回数を抑える
    this.colW = bw >= 700 ? 2 : 1;
    this.rays = Math.ceil(bw / this.colW);
    this.zbuf = new Float32Array(this.rays);
    this.hitX = new Float32Array(this.rays);
    this.hitY = new Float32Array(this.rays);

    // 減色用のルックアップテーブル（毎フレームの除算を避ける）
    this.levelLut = tier.colorLevels ? quantizeLut(tier.colorLevels) : null;

    // 床テクスチャ描画用のバッファ（読み戻しを避けるため毎フレーム全上書きする）
    this.floorBand = null;

    // 正方形ピクセルを保つ投影係数（1 単位の壁が距離 1 で占める画面高の割合）
    this.proj = clamp(bw / 2 / (this.planeLen * bh), 0.4, 1.25);

    this.bctx.imageSmoothingEnabled = false;

    const g1 = this.bctx.createLinearGradient(0, 0, 0, bh * 0.5);
    g1.addColorStop(0, '#05060d');
    g1.addColorStop(1, '#1b2138');
    this.ceilGrad = g1;
    const g2 = this.bctx.createLinearGradient(0, bh * 0.5, 0, bh);
    g2.addColorStop(0, '#171a24');
    g2.addColorStop(1, '#3a3f52');
    this.floorGrad = g2;

    this.paletteLut = tier.palette ? paletteLut(tier.palette) : null;
    this.floorTex = tier.floor === 'textured' ? getFloorTextures() : null;
  }

  /* --------------------------------- ゲーム進行 -------------------------------- */

  newGame(difficultyKey = 'normal') {
    const d = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
    this.difficulty = d;
    const rnd = createRng((Math.random() * 0xffffffff) >>> 0);
    this.rnd = rnd;
    this.map = generateCity(rnd, 1);
    if (this.gl3d) this.gl3d.buildMap(this.map);
    this.flow = new Int16Array(this.map.size * this.map.size);
    this.flowQueue = new Int32Array(this.map.size * this.map.size);
    this.flowTimer = 0;
    this.flowCell = -1;

    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.spawnQueue = [];
    this.wave = 0;
    this.waveBreak = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.pitch = 0;
    this.shake = 0;
    this.bob = 0;

    // 各ティアのアセットを先に作っておき、進化のたびに固まらないようにする
    for (let i = 0; i < 3; i++) getAssetSet(i);

    const first = createWeaponState('blaster');
    first.stats = statsFor(WEAPONS.blaster, 1);
    first.reserve = Math.round(first.reserve * (d.ammo / 48));
    const spawn = this.map.spawn || [1.5, 1.5];
    this.player = {
      x: spawn[0], y: spawn[1], angle: 0.7,
      hp: d.hp, maxHp: d.hp,
      score: 0,
      fireCd: 0, recoil: 0, flash: 0, hurtT: 0,
      weapons: [first],
      slot: 0,
      triggerHeld: false,
      reloadT: 0, reloadTotal: 0,
      switchT: 0, switchTotal: 0, pendingSlot: -1,
    };
    this.applyTier(RENDER_2D, true);
    this.faceOpenDirection();

    this.state = 'playing';
    this.sfx.resume();
    this.startWave();
    this.emitState();
  }

  /** 一番開けている方向を向く。 */
  faceOpenDirection() {
    const p = this.player;
    let best = p.angle;
    let bestDist = 0;
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      const d = this.castRay(p.x, p.y, Math.cos(a), Math.sin(a)).dist;
      if (d > bestDist) { bestDist = d; best = a; }
    }
    p.angle = best;
  }

  /** 次のエリア（新しい街並み）へ移動する。 */
  changeArea() {
    this.map = generateCity(this.rnd, this.wave);
    if (this.gl3d) this.gl3d.buildMap(this.map);
    const cells = this.map.size * this.map.size;
    this.flow = new Int16Array(cells);
    this.flowQueue = new Int32Array(cells);
    this.flowCell = -1;

    const spawn = this.map.spawn || [1.5, 1.5];
    this.player.x = spawn[0];
    this.player.y = spawn[1];
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.pickups.length = 0;
    this.faceOpenDirection();
    this.computeFlowField();
    this.onEvent('newarea', { wave: this.wave });
  }

  startWave() {
    this.wave++;
    const d = this.difficulty;
    // ウェーブごとに街並みが変わる
    if (this.wave > 1) this.changeArea();

    // 新しい武器が解放されるウェーブなら、武器ケースを配置する
    for (const id of WEAPON_IDS) {
      const def = WEAPONS[id];
      if (this.wave >= def.unlockWave && !this.player.weapons.some((w) => w.id === id)) {
        this.spawnPickup('weapon', id);
        break;
      }
    }
    const count = Math.max(4, Math.min(20, Math.round((4 + this.wave * 1.8) * d.count)));
    this.spawnQueue = [];
    for (let i = 0; i < count; i++) {
      this.spawnQueue.push({ type: this.pickEnemyType(), t: 0.25 + i * 0.35 });
    }
    // 各ウェーブでアイテムを補充
    this.spawnPickup('ammo');
    this.spawnPickup('ammo');
    if (this.wave % 2 === 0) this.spawnPickup('health');
    if (this.wave >= 2) this.spawnPickup('core'); // 武器強化コア
    this.sfx.wave();
    this.onEvent('wave', { wave: this.wave });
  }

  pickEnemyType() {
    const r = this.rnd();
    if (this.wave >= 4 && r < 0.18) return 'brute';
    if (this.wave >= 2 && r < 0.5) return 'gunner';
    return 'drone';
  }

  findSpawnCell(minDist) {
    const p = this.player;
    const open = this.map.open;
    for (let attempt = 0; attempt < 80; attempt++) {
      const cell = open[(this.rnd() * open.length) | 0];
      if (Math.hypot(cell[0] - p.x, cell[1] - p.y) >= minDist) return cell;
    }
    return open[(this.rnd() * open.length) | 0];
  }

  spawnEnemy(type) {
    const def = ENEMY_TYPES[type];
    const cell = this.findSpawnCell(7);
    const hpScale = 1 + (this.wave - 1) * 0.08;
    this.enemies.push({
      type, def,
      x: cell[0], y: cell[1],
      hp: def.hp * hpScale,
      maxHp: def.hp * hpScale,
      radius: def.radius,
      scale: def.scale,
      cd: this.rnd() * 0.6,
      anim: this.rnd() * 10,
      hurtT: 0,
      awake: false,
      wakeT: 0.4 + this.rnd() * 1.4,
      dying: 0,
      detour: 0,
      detourT: 0,
      seed: this.rnd() * 100,
      lastX: cell[0], lastY: cell[1],
      stuckT: 0,
    });
  }

  spawnPickup(kind, weaponId) {
    if (this.pickups.length > 8) return;
    const cell = this.findSpawnCell(4);
    this.pickups.push({ kind, weaponId, x: cell[0], y: cell[1], anim: this.rnd() * 6 });
  }

  emitState() {
    this.onEvent('state', { state: this.state });
  }

  setPaused(paused) {
    if (paused && this.state === 'playing') {
      this.state = 'paused';
      this.input.firing = false;
      this.input.forward = 0;
      this.input.strafe = 0;
      this.emitState();
    } else if (!paused && this.state === 'paused') {
      this.state = 'playing';
      this._last = performance.now() / 1000;
      this.emitState();
    }
  }

  getHud() {
    const p = this.player;
    if (!p) return { hp: 0, maxHp: 100, ammo: 0, score: 0, wave: 0, enemies: 0, hurt: 0 };
    const w = this.currentWeapon();
    const def = w ? WEAPONS[w.id] : null;
    const stats = w ? this.statsOf(w) : null;
    return {
      hp: Math.max(0, Math.ceil(p.hp)),
      maxHp: p.maxHp,
      score: p.score,
      wave: this.wave,
      enemies: this.enemies.filter((e) => !e.dying).length + this.spawnQueue.length,
      hurt: clamp(p.hurtT / 0.5, 0, 1),
      kills: this.kills,
      time: this.elapsed,
      // 武器まわり
      weapon: def ? def.name : '',
      weaponMode: def ? (def.auto ? 'AUTO' : 'SEMI') : '',
      weaponPerk: def && w ? def.levels[w.level - 1].perk : '',
      weaponLevel: w ? w.level : 1,
      weaponMaxLevel: def ? def.levels.length : 4,
      weaponRatio: w ? levelProgress(def, w.xp) : 0,
      mag: w ? w.mag : 0,
      magSize: stats ? stats.magazine : 0,
      reserve: w ? w.reserve : 0,
      reloading: p.reloadT > 0,
      reloadRatio: p.reloadTotal ? 1 - p.reloadT / p.reloadTotal : 1,
      switching: p.switchT > 0,
      slot: p.slot,
      slots: p.weapons.map((x) => ({
        id: x.id,
        short: WEAPONS[x.id].short,
        mode: WEAPONS[x.id].auto ? 'AUTO' : 'SEMI',
        level: x.level,
        mag: x.mag,
        reserve: x.reserve,
        slot: WEAPONS[x.id].slot,
      })),
      renderer: this.mode3d ? '3D' : '2D',
    };
  }

  /* --------------------------------- 地形判定 --------------------------------- */

  tileAt(x, y) {
    const { size, tiles } = this.map;
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= size || iy >= size) return 3;
    return tiles[iy * size + ix];
  }

  isWall(x, y) {
    return this.tileAt(x, y) !== 0;
  }

  collides(x, y, r) {
    return (
      this.isWall(x - r, y - r) || this.isWall(x + r, y - r) ||
      this.isWall(x - r, y + r) || this.isWall(x + r, y + r)
    );
  }

  /** 軸ごとに分けて移動し、壁ずりを実現する。移動できたら true。 */
  tryMove(ent, dx, dy, r) {
    let moved = false;
    if (!this.collides(ent.x + dx, ent.y, r)) {
      ent.x += dx;
      moved = moved || Math.abs(dx) > 1e-4;
    }
    if (!this.collides(ent.x, ent.y + dy, r)) {
      ent.y += dy;
      moved = moved || Math.abs(dy) > 1e-4;
    }
    return moved;
  }

  /** DDA による壁までの距離計算。 */
  castRay(ox, oy, rdx, rdy) {
    let mapX = ox | 0;
    let mapY = oy | 0;
    const deltaX = Math.abs(1 / (rdx || 1e-9));
    const deltaY = Math.abs(1 / (rdy || 1e-9));
    let stepX, stepY, sideX, sideY;

    if (rdx < 0) { stepX = -1; sideX = (ox - mapX) * deltaX; }
    else { stepX = 1; sideX = (mapX + 1 - ox) * deltaX; }
    if (rdy < 0) { stepY = -1; sideY = (oy - mapY) * deltaY; }
    else { stepY = 1; sideY = (mapY + 1 - oy) * deltaY; }

    let side = 0;
    let tile = 0;
    for (let guard = 0; guard < 128; guard++) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
      else { sideY += deltaY; mapY += stepY; side = 1; }
      tile = this.tileAt(mapX, mapY);
      if (tile !== 0) break;
    }
    const dist = side === 0
      ? (mapX - ox + (1 - stepX) / 2) / (rdx || 1e-9)
      : (mapY - oy + (1 - stepY) / 2) / (rdy || 1e-9);
    return { dist: Math.max(0.02, dist), side, tile, mapX, mapY };
  }

  hasLOS(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / 0.2);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isWall(x0 + dx * t, y0 + dy * t)) return false;
    }
    return true;
  }

  /**
   * プレイヤー位置からの幅優先探索で「そこから何歩で辿り着けるか」の地図を作る。
   * 敵はこの値が小さくなる方向へ進むので、壁越しでも迷路を正しく辿って追ってくる。
   */
  computeFlowField() {
    const { size, tiles } = this.map;
    const flow = this.flow;
    const queue = this.flowQueue;
    flow.fill(-1);

    const px = clamp(this.player.x | 0, 0, size - 1);
    const py = clamp(this.player.y | 0, 0, size - 1);
    const start = py * size + px;
    if (tiles[start]) return;

    let head = 0;
    let tail = 0;
    flow[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const cur = queue[head++];
      const d = flow[cur] + 1;
      const cx = cur % size;
      const cy = (cur / size) | 0;
      if (cx > 0) { const n = cur - 1; if (!tiles[n] && flow[n] < 0) { flow[n] = d; queue[tail++] = n; } }
      if (cx < size - 1) { const n = cur + 1; if (!tiles[n] && flow[n] < 0) { flow[n] = d; queue[tail++] = n; } }
      if (cy > 0) { const n = cur - size; if (!tiles[n] && flow[n] < 0) { flow[n] = d; queue[tail++] = n; } }
      if (cy < size - 1) { const n = cur + size; if (!tiles[n] && flow[n] < 0) { flow[n] = d; queue[tail++] = n; } }
    }
  }

  /** 敵がプレイヤーへ向かうべき方向（見えていれば直線、見えなければ経路に沿う）。 */
  chaseDir(e, los, dirX, dirY) {
    if (los) return [dirX, dirY];
    const { size } = this.map;
    const cx = clamp(e.x | 0, 0, size - 1);
    const cy = clamp(e.y | 0, 0, size - 1);
    const here = this.flow[cy * size + cx];
    if (here < 0) return [dirX, dirY];

    let bestD = here;
    let bx = -1;
    let by = -1;
    const check = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) return;
      const v = this.flow[ny * size + nx];
      if (v >= 0 && v < bestD) { bestD = v; bx = nx; by = ny; }
    };
    check(cx - 1, cy);
    check(cx + 1, cy);
    check(cx, cy - 1);
    check(cx, cy + 1);
    if (bx < 0) return [dirX, dirY];

    const tx = bx + 0.5 - e.x;
    const ty = by + 0.5 - e.y;
    const len = Math.hypot(tx, ty) || 1;
    return [tx / len, ty / len];
  }

  /* ---------------------------------- 更新 ---------------------------------- */

  update(dt) {
    const p = this.player;
    this.elapsed += dt;
    p.fireCd -= dt;
    p.recoil = Math.max(0, p.recoil - dt * 6);
    p.flash = Math.max(0, p.flash - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);

    this.pitchBuf = this.pitch * this.bufH;
    this.updateWeapon(dt);
    this.updatePlayer(dt);
    if (this.input.firing) this.fire();
    else p.triggerHeld = false;

    // 経路マップはプレイヤーがマスをまたいだとき、または一定間隔で更新する
    const cell = (p.y | 0) * this.map.size + (p.x | 0);
    this.flowTimer -= dt;
    if (cell !== this.flowCell || this.flowTimer <= 0) {
      this.flowCell = cell;
      this.flowTimer = 0.3;
      this.computeFlowField();
    }

    // 出現待ちの敵
    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      const s = this.spawnQueue[i];
      s.t -= dt;
      if (s.t <= 0) {
        this.spawnEnemy(s.type);
        this.spawnQueue.splice(i, 1);
      }
    }

    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);

    // ウェーブ進行
    if (this.state === 'playing' && !this.spawnQueue.length && !this.enemies.length) {
      if (this.waveBreak <= 0) {
        this.waveBreak = 2.6;
        p.score += 200 * this.wave;
        p.hp = Math.min(p.maxHp, p.hp + 15);
        for (const w of p.weapons) {
          const def = WEAPONS[w.id];
          w.reserve = Math.min(def.reserveMax, w.reserve + Math.round(def.reserveMax * 0.15));
        }
        this.addWeaponXp(3);
        this.onEvent('waveclear', { wave: this.wave });
      } else {
        this.waveBreak -= dt;
        if (this.waveBreak <= 0) this.startWave();
      }
    }

    this.aimHot = !!this.aimTarget(0).enemy;
  }

  /** リロードと持ち替えの進行。 */
  updateWeapon(dt) {
    const p = this.player;
    if (p.switchT > 0) {
      const prev = p.switchT;
      p.switchT = Math.max(0, p.switchT - dt);
      // 構え替えの中間で実際に持ち替える
      if (p.pendingSlot >= 0 && prev > p.switchTotal / 2 && p.switchT <= p.switchTotal / 2) {
        p.slot = p.pendingSlot;
        p.pendingSlot = -1;
      }
    }
    if (p.reloadT > 0) {
      p.reloadT = Math.max(0, p.reloadT - dt);
      if (p.reloadT === 0) {
        const w = this.currentWeapon();
        if (w) {
          const stats = this.statsOf(w);
          const need = stats.magazine - w.mag;
          const take = Math.min(need, w.reserve);
          w.mag += take;
          w.reserve -= take;
          this.sfx.reloadEnd();
        }
      }
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    p.angle = normAngle(p.angle + this.input.turn * KEY_TURN_SPEED * dt);

    let f = clamp(this.input.forward, -1, 1);
    let s = clamp(this.input.strafe, -1, 1);
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }

    const speed = (this.input.sprint ? SPRINT_SPEED : WALK_SPEED) * dt;
    const dirX = Math.cos(p.angle);
    const dirY = Math.sin(p.angle);
    // dir を右に 90 度回した向きが「右ストレイフ」
    const dx = (dirX * f - dirY * s) * speed;
    const dy = (dirY * f + dirX * s) * speed;
    if (dx || dy) {
      this.tryMove(p, dx, dy, PLAYER_RADIUS);
      this.bob += Math.hypot(dx, dy) * 7.5;
    } else {
      this.bob += dt * 1.2;
    }
  }

  updateEnemies(dt) {
    const p = this.player;
    const dmgScale = this.difficulty.dmg;
    const spdScale = this.difficulty.spd;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dying > 0) {
        e.dying += dt;
        if (e.dying > 0.45) this.enemies.splice(i, 1);
        continue;
      }
      e.anim += dt;
      e.hurtT = Math.max(0, e.hurtT - dt);
      e.cd -= dt;

      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1e-6;
      const los = this.hasLOS(e.x, e.y, p.x, p.y);

      // 出現直後だけ少し待ってから追跡を始める（全員が同時に殺到しないように）
      if (!e.awake) {
        e.wakeT -= dt;
        if (e.wakeT > 0 && !los && dist > 6) continue;
        e.awake = true;
      }

      const def = e.def;
      const speed = def.speed * spdScale * dt;
      let want = 0; // 1:接近 -1:後退 0:横移動
      if (def.ranged) {
        if (los && dist < def.range) {
          if (e.cd <= 0) {
            this.spawnProjectile(e, def.damage * dmgScale);
            e.cd = def.cooldown;
          }
          want = dist > 4.5 ? 1 : dist < 2.4 ? -1 : 0;
        } else {
          want = 1;
        }
      } else if (dist <= def.range) {
        want = 0;
        if (e.cd <= 0) {
          this.damagePlayer(def.damage * dmgScale);
          e.cd = def.cooldown;
        }
      } else {
        want = 1;
      }

      const nx = dx / dist;
      const ny = dy / dist;
      let mx = 0;
      let my = 0;
      if (want > 0) {
        // 見えていなければ経路マップに沿って迷路を辿る
        const [cx, cy] = this.chaseDir(e, los || dist < 1.6, nx, ny);
        mx = cx * speed;
        my = cy * speed;
      } else if (want < 0) {
        mx = -nx * speed;
        my = -ny * speed;
      } else {
        // 横に回り込む
        const sway = Math.sin(this.elapsed * 1.4 + e.seed);
        mx = -ny * speed * sway;
        my = nx * speed * sway;
      }

      // 壁で詰まったら迂回方向を決めて一定時間そちらへ進む
      if (e.detourT > 0) {
        e.detourT -= dt;
        mx += -ny * speed * e.detour * 0.9;
        my += nx * speed * e.detour * 0.9;
      }

      // 敵同士が重ならないよう軽く反発させる
      for (const o of this.enemies) {
        if (o === e || o.dying) continue;
        const ox = e.x - o.x;
        const oy = e.y - o.y;
        const d2 = ox * ox + oy * oy;
        const minD = e.radius + o.radius;
        if (d2 > 1e-6 && d2 < minD * minD) {
          const d = Math.sqrt(d2);
          mx += (ox / d) * speed * 0.55;
          my += (oy / d) * speed * 0.55;
        }
      }

      this.tryMove(e, mx, my, e.radius * 0.8);

      const travelled = Math.hypot(e.x - e.lastX, e.y - e.lastY);
      if (travelled < speed * 0.35 && want !== 0) {
        e.stuckT += dt;
        if (e.stuckT > 0.25 && e.detourT <= 0) {
          e.detour = this.rnd() < 0.5 ? -1 : 1;
          e.detourT = 0.6 + this.rnd() * 0.5;
          e.stuckT = 0;
        }
      } else {
        e.stuckT = 0;
      }
      e.lastX = e.x;
      e.lastY = e.y;
    }
  }

  spawnProjectile(e, damage) {
    const p = this.player;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const spread = 0.09;
    const a = Math.atan2(dy, dx) + (this.rnd() - 0.5) * spread;
    this.projectiles.push({
      x: e.x + (dx / d) * 0.35,
      y: e.y + (dy / d) * 0.35,
      vx: Math.cos(a) * 4.4,
      vy: Math.sin(a) * 4.4,
      damage,
      life: 4,
    });
    this.sfx.enemyShot();
  }

  updateProjectiles(dt) {
    const p = this.player;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const b = this.projectiles[i];
      const steps = 3;
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;
        if (this.isWall(b.x, b.y)) dead = true;
        else if (Math.hypot(b.x - p.x, b.y - p.y) < 0.35) {
          this.damagePlayer(b.damage);
          dead = true;
        }
      }
      b.life -= dt;
      if (dead || b.life <= 0) this.projectiles.splice(i, 1);
    }
  }

  updatePickups(dt) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const it = this.pickups[i];
      it.anim += dt;
      if (Math.hypot(it.x - p.x, it.y - p.y) > 0.55) continue;
      if (it.kind === 'ammo') {
        // 予備弾を全武器に配る（構えている武器を多めに）
        let gained = false;
        for (const w of p.weapons) {
          const def = WEAPONS[w.id];
          const share = w === this.currentWeapon() ? 0.28 : 0.12;
          const add = Math.ceil(def.reserveMax * share);
          if (w.reserve >= def.reserveMax) continue;
          w.reserve = Math.min(def.reserveMax, w.reserve + add);
          gained = true;
        }
        if (!gained) continue;
      } else if (it.kind === 'core') {
        this.addWeaponXp(8);
      } else if (it.kind === 'weapon') {
        this.giveWeapon(it.weaponId);
      } else {
        if (p.hp >= p.maxHp) continue;
        p.hp = Math.min(p.maxHp, p.hp + 28);
      }
      p.score += 25;
      this.pickups.splice(i, 1);
      this.sfx.pickup();
    }
  }

  damagePlayer(amount) {
    const p = this.player;
    if (this.state !== 'playing') return;
    p.hp -= amount;
    p.hurtT = 0.5;
    this.shake = Math.min(1, this.shake + 0.45);
    this.sfx.hurt();
    if (p.hp <= 0) {
      p.hp = 0;
      this.state = 'over';
      this.input.firing = false;
      this.sfx.gameOver();
      this.onEvent('gameover', { score: p.score, wave: this.wave, kills: this.kills });
    }
  }

  /* ---------------------------------- 射撃 ---------------------------------- */

  /**
   * 指定角度の射線上にいる敵を、近い順に最大 max 体返す。
   * 貫通武器はここで複数体を拾う。
   */
  aimTargets(spread = 0, max = 1) {
    const p = this.player;
    if (!p) return [];
    const angle = p.angle + spread;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const wall = this.castRay(p.x, p.y, dirX, dirY).dist;

    const hits = [];
    for (const e of this.enemies) {
      if (e.dying) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.05 || dist > wall) continue;
      const da = normAngle(Math.atan2(dy, dx) - angle);
      if (Math.abs(da) > Math.atan2(e.radius, dist)) continue;
      // 上下方向：ピッチを考慮して当たり判定する
      if (this.mode3d) {
        const viewAngle = this.pitch * 2.2;
        const targetAngle = Math.atan2(e.def.center3d - 1.6, dist);
        const halfAngle = Math.atan2(e.def.height3d / 2, dist);
        if (Math.abs(targetAngle - viewAngle) > halfAngle) continue;
      } else {
        const h = (this.proj * this.bufH * e.scale) / dist;
        const vWorld = 0.5 - e.scale / 2 - (e.def.hover || 0);
        const offsetY = this.pitchBuf + (vWorld * this.proj * this.bufH) / dist;
        if (Math.abs(offsetY) > h / 2 + this.bufH * 0.02) continue;
      }
      hits.push({ enemy: e, dist });
    }
    hits.sort((a, b) => a.dist - b.dist);
    return hits.slice(0, max);
  }

  /** 照準に敵が入っているか（クロスヘアの色に使う）。 */
  aimTarget(spread = 0) {
    const hit = this.aimTargets(spread, 1)[0];
    return { enemy: hit ? hit.enemy : null, dist: hit ? hit.dist : Infinity };
  }

  /** いま構えている武器の状態。 */
  currentWeapon() {
    const p = this.player;
    return p && p.weapons.length ? p.weapons[p.slot] : null;
  }

  /** 武器の性能値（レベル込み）。 */
  statsOf(w) {
    if (!w.stats) w.stats = statsFor(WEAPONS[w.id], w.level);
    return w.stats;
  }

  /** 弾倉に弾を詰める。予備弾がなければ何もしない。 */
  reload() {
    const p = this.player;
    const w = this.currentWeapon();
    if (!w || this.state !== 'playing') return;
    if (p.reloadT > 0 || p.switchT > 0) return;
    const stats = this.statsOf(w);
    if (w.mag >= stats.magazine || w.reserve <= 0) return;
    p.reloadTotal = stats.reload;
    p.reloadT = stats.reload;
    this.sfx.reloadStart();
    this.onEvent('reload', { name: WEAPONS[w.id].name, time: stats.reload });
  }

  /** 武器を持ち替える（構え直しの時間が入る）。 */
  switchWeapon(index) {
    const p = this.player;
    if (!p || this.state !== 'playing') return;
    if (index < 0 || index >= p.weapons.length || index === p.slot) return;
    if (p.switchT > 0) return;
    p.pendingSlot = index;
    p.switchTotal = 0.42;
    p.switchT = 0.42;
    p.reloadT = 0; // リロードは中断される
    this.sfx.weaponSwitch();
  }

  /** 次／前の武器へ。 */
  cycleWeapon(dir) {
    const p = this.player;
    if (!p || !p.weapons.length) return;
    const n = p.weapons.length;
    this.switchWeapon(((p.slot + dir) % n + n) % n);
  }

  /** 武器を手に入れる（すでに持っていれば XP に変える）。 */
  giveWeapon(id) {
    const p = this.player;
    if (!p) return false;
    if (p.weapons.some((w) => w.id === id)) {
      this.addWeaponXp(6);
      return false;
    }
    const w = createWeaponState(id);
    w.stats = statsFor(WEAPONS[id], 1);
    p.weapons.push(w);
    p.weapons.sort((a, b) => WEAPONS[a.id].slot - WEAPONS[b.id].slot);
    const index = p.weapons.findIndex((x) => x.id === id);
    p.slot = index;
    p.switchT = 0.42;
    p.switchTotal = 0.42;
    p.pendingSlot = -1;
    this.sfx.weaponUp();
    this.onEvent('newweapon', {
      name: WEAPONS[id].name,
      slot: WEAPONS[id].slot,
      mode: WEAPONS[id].auto ? '押しっぱなしで連射' : '1発ずつ（押すたびに発射）',
      magazine: statsFor(WEAPONS[id], 1).magazine,
    });
    return true;
  }

  /** 武器XPを加算し、レベルが上がったら通知する。 */
  addWeaponXp(amount, target) {
    const w = target || this.currentWeapon();
    if (!w) return;
    const def = WEAPONS[w.id];
    w.xp += amount;
    const level = levelForXp(def, w.xp);
    if (level !== w.level) {
      w.level = level;
      w.stats = statsFor(def, level);
      w.mag = Math.min(w.stats.magazine, w.mag + 4);
      w.reserve = Math.min(def.reserveMax, w.reserve + Math.round(def.reserveMax * 0.15));
      this.sfx.weaponUp();
      this.onEvent('weaponup', {
        name: def.name, level, perk: def.levels[level - 1].perk,
      });
    }
  }

  /** 敵を倒したときの処理（スコア・XP・ドロップ）。 */
  killEnemy(enemy) {
    const p = this.player;
    enemy.dying = 0.001;
    this.kills++;
    p.score += enemy.def.score;
    this.addWeaponXp(XP_BY_TYPE[enemy.type] || 1); // 使っていた武器が成長する
    this.sfx.kill(this.panOf(enemy));

    const roll = Math.random();
    const drop = roll < 0.26 ? 'ammo' : roll < 0.38 ? 'health' : roll < 0.44 ? 'core' : null;
    if (drop) {
      if (this.pickups.length >= 14) this.pickups.shift(); // 拾われずに溜まり続けるのを防ぐ
      this.pickups.push({ kind: drop, x: enemy.x, y: enemy.y, anim: 0 });
    }
  }

  /** 音のステレオ定位（プレイヤーから見て左右どちらにいるか）。 */
  panOf(entity) {
    const p = this.player;
    if (!p) return 0;
    const da = normAngle(Math.atan2(entity.y - p.y, entity.x - p.x) - p.angle);
    return clamp(da / (Math.PI / 2), -1, 1);
  }

  fire() {
    if (this.state !== 'playing') return;
    const p = this.player;
    const w = this.currentWeapon();
    if (!w) return;
    const def = WEAPONS[w.id];
    const stats = this.statsOf(w);

    // リロード中・持ち替え中は撃てない
    if (p.reloadT > 0 || p.switchT > 0) return;
    if (p.fireCd > 0) return;
    // 単発武器は引き金を引き直す必要がある
    if (!def.auto && p.triggerHeld) return;

    if (w.mag <= 0) {
      p.triggerHeld = true;
      if (w.reserve > 0) this.reload();
      else {
        p.fireCd = 0.4;
        this.sfx.empty();
      }
      return;
    }

    w.mag--;
    p.triggerHeld = true;
    p.fireCd = stats.interval;
    p.recoil = 1;
    p.flash = 0.05 + def.kick * 0.012;
    this.shake = Math.min(1, this.shake + 0.05 * def.recoil);
    this.sfx.shoot(w.level, def.id);

    const pierce = 1 + (stats.pierce || 0);
    for (let i = 0; i < stats.pellets; i++) {
      const offset = stats.pellets === 1
        ? 0
        : (i / (stats.pellets - 1) - 0.5) * stats.spread * 2;
      const spread = offset + (Math.random() - 0.5) * stats.spread;
      for (const { enemy } of this.aimTargets(spread, pierce)) {
        enemy.hp -= stats.damage;
        enemy.hurtT = 0.12;
        enemy.awake = true;
        if (enemy.hp <= 0) this.killEnemy(enemy);
        else this.sfx.hit(this.panOf(enemy));
      }
    }

    if (w.mag <= 0 && w.reserve > 0) this.reload(); // 撃ち切ったら自動で装填
  }

  /* ---------------------------- 入力（React から呼ぶ） ---------------------------- */

  look(dx, dy) {
    const p = this.player;
    if (!p || this.state !== 'playing') return;
    p.angle = normAngle(p.angle + dx);
    // pitch は画面高に対する割合で保持する（解像度が変わっても見た目が変わらない）
    this.pitch = clamp(this.pitch - dy, -0.32, 0.32);
    this.pitchBuf = this.pitch * this.bufH;
  }

  /* ---------------------------------- 描画 ---------------------------------- */

  render(dt) {
    const ctx = this.ctx;
    if (!this.map || !this.player) {
      ctx.clearRect(0, 0, this.W, this.H);
      ctx.fillStyle = '#05060d';
      ctx.fillRect(0, 0, this.W, this.H);
      return;
    }

    // 3D モード：WebGL が世界を描き、2D キャンバスには HUD だけを重ねる
    if (this.mode3d && this.gl3d) {
      this.gl3d.render(this, dt || 0.016);
      ctx.clearRect(0, 0, this.W, this.H);
      this.drawOverlays();
      this.drawMinimap();
      this.drawCrosshair();
      return;
    }

    const shakeAmp = this.shake * (this.bufH / 90);
    const sx = (Math.random() - 0.5) * shakeAmp;
    const sy = (Math.random() - 0.5) * shakeAmp;

    // 1) 世界をオフスクリーンバッファへ描く（解像度＝時代）
    const b = this.bctx;
    b.save();
    b.translate(sx, sy);
    this.renderWorld();
    b.restore();
    this.drawWeapon();

    // 2) 時代ごとの後処理（減色・走査線）
    this.postProcess();

    // 3) 画面へ引き伸ばす
    ctx.imageSmoothingEnabled = this.tier.smoothing;
    ctx.drawImage(this.buf, 0, 0, this.W, this.H);
    if (this.tier.bloom > 0) this.drawBloom();

    // 4) HUD は常に高解像度で描く（読みやすさ優先）
    this.drawOverlays();
    this.drawMinimap();
    this.drawCrosshair();
  }

  /** 動的ライト（銃口の閃光・敵弾・強化コア）を集める。高ティアのみ使用。 */
  collectLights() {
    const lights = this.lights;
    lights.length = 0;
    if (!this.tier.lights) return lights;
    const p = this.player;
    if (p.flash > 0) lights.push({ x: p.x, y: p.y, r: 6, i: 1.5 * (p.flash / 0.09), c: [255, 220, 150] });
    for (const b of this.projectiles) lights.push({ x: b.x, y: b.y, r: 3.4, i: 0.85, c: [196, 107, 255] });
    for (const it of this.pickups) {
      if (it.kind === 'core') lights.push({ x: it.x, y: it.y, r: 2.6, i: 0.5, c: [124, 232, 255] });
    }
    return lights;
  }

  renderWorld() {
    const ctx = this.bctx;
    const W = this.bufW;
    const H = this.bufH;
    const p = this.player;
    const horizon = Math.round(H / 2 + this.pitchBuf);
    const pad = Math.ceil(H / 12);

    const dirX = Math.cos(p.angle);
    const dirY = Math.sin(p.angle);
    const planeX = -dirY * this.planeLen;
    const planeY = dirX * this.planeLen;
    const projH = this.proj * H;

    // --- 床と天井 ---
    if (this.tier.floor === 'textured') {
      this.castFloor(horizon, dirX, dirY, planeX, planeY, projH);
    } else if (this.tier.floor === 'gradient') {
      ctx.fillStyle = this.ceilGrad;
      ctx.fillRect(-pad, -pad, W + pad * 2, horizon + pad);
      ctx.fillStyle = this.floorGrad;
      ctx.fillRect(-pad, horizon, W + pad * 2, H - horizon + pad);
    } else {
      ctx.fillStyle = '#0b0e1a';
      ctx.fillRect(-pad, -pad, W + pad * 2, horizon + pad);
      ctx.fillStyle = '#2b3040';
      ctx.fillRect(-pad, horizon, W + pad * 2, H - horizon + pad);
    }

    // --- 壁 ---
    const walls = this.assets.walls;
    const colW = this.colW;
    const lights = this.collectLights();
    const fogSteps = Math.max(3, this.tier.shadeLevels * 2);

    for (let i = 0; i < this.rays; i++) {
      const cameraX = (2 * i) / this.rays - 1;
      const rdx = dirX + planeX * cameraX;
      const rdy = dirY + planeY * cameraX;
      const hit = this.castRay(p.x, p.y, rdx, rdy);
      const dist = hit.dist;
      this.zbuf[i] = dist;
      const hx = p.x + rdx * dist;
      const hy = p.y + rdy * dist;
      this.hitX[i] = hx;
      this.hitY[i] = hy;

      const lineH = projH / dist;
      const top = horizon - lineH / 2;
      const tex = walls[hit.tile] || walls[3];

      let wallX = hit.side === 0 ? p.y + dist * rdy : p.x + dist * rdx;
      wallX -= Math.floor(wallX);
      let texX = (wallX * tex.width) | 0;
      if ((hit.side === 0 && rdx > 0) || (hit.side === 1 && rdy < 0)) {
        texX = tex.width - texX - 1;
      }

      const px = i * colW;
      ctx.drawImage(tex, texX, 0, 1, tex.height, px, top, colW + 0.02, lineH);

      // 距離による減光（低ティアほど段階が粗い＝バンディングが出る）
      let fog = dist / FOG_DISTANCE;
      if (hit.side === 1) fog += 0.16;
      const q = Math.min(24, Math.round((Math.min(1, fog) * fogSteps) / fogSteps * 24));
      if (q > 0) {
        ctx.fillStyle = this._shades[q];
        ctx.fillRect(px, top, colW + 0.02, lineH);
      }

      // 動的ライト（加算合成）
      if (lights.length) {
        let lr = 0;
        let lg = 0;
        let lb = 0;
        for (const L of lights) {
          const d2 = (L.x - hx) ** 2 + (L.y - hy) ** 2;
          if (d2 > L.r * L.r) continue;
          const a = L.i * (1 - Math.sqrt(d2) / L.r) ** 2;
          lr += L.c[0] * a;
          lg += L.c[1] * a;
          lb += L.c[2] * a;
        }
        if (lr + lg + lb > 6) {
          const scale = Math.min(1, Math.max(lr, lg, lb) / 255);
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(${Math.min(255, lr | 0)},${Math.min(255, lg | 0)},${Math.min(255, lb | 0)},${(scale * 0.55).toFixed(3)})`;
          ctx.fillRect(px, top, colW + 0.02, lineH);
          ctx.globalCompositeOperation = 'source-over';
        }
      }

      // 接地影（壁と床の境目を締める）
      if (this.tier.ao) {
        const aoH = Math.max(1, lineH * 0.12);
        ctx.fillStyle = 'rgba(4,6,14,0.35)';
        ctx.fillRect(px, top + lineH - aoH, colW + 0.02, aoH);
      }
    }

    this.renderSprites(horizon, dirX, dirY, planeX, planeY, projH);
  }

  /**
   * 床をテクスチャで描く（フロアキャスティング）。高ティアのみ。
   *
   * 画面の読み戻し（getImageData）は重いので行わず、手前の帯だけを
   * 専用バッファに毎フレーム書き切って putImageData する。
   * 解像度が高いときは縦横 2px 単位で塗って計算量を抑える。
   */
  castFloor(horizon, dirX, dirY, planeX, planeY, projH) {
    const ctx = this.bctx;
    const W = this.bufW;
    const H = this.bufH;

    // 遠景はグラデーションで済ませる
    ctx.fillStyle = this.ceilGrad;
    ctx.fillRect(0, 0, W, Math.max(0, horizon));
    ctx.fillStyle = this.floorGrad;
    ctx.fillRect(0, Math.max(0, horizon), W, H - Math.max(0, horizon));

    const tex = this.floorTex;
    if (!tex) return;

    const maxDist = 7.5;
    const bandTop = Math.max(horizon + 1, Math.ceil(horizon + (0.5 * projH) / maxDist));
    const bandH = H - bandTop;
    if (bandH <= 0) return;

    if (!this.floorBand || this.floorBand.width !== W || this.floorBand.height !== bandH) {
      this.floorBand = ctx.createImageData(W, bandH);
      const d = this.floorBand.data;
      for (let i = 3; i < d.length; i += 4) d[i] = 255; // 不透明で固定
    }
    const out = this.floorBand.data;

    const rayX0 = dirX - planeX;
    const rayY0 = dirY - planeY;
    const rayX1 = dirX + planeX;
    const rayY1 = dirY + planeY;
    const hstep = W > 620 ? 2 : 1;
    const vstep = W > 620 ? 2 : 1;

    const texData = tex.floor.data;
    const tsize = tex.floor.size;
    const px = this.player.x;
    const py = this.player.y;

    for (let y = 0; y < bandH; y += vstep) {
      const screenY = bandTop + y;
      const rowDistance = (0.5 * projH) / (screenY - horizon);
      const stepX = (rowDistance * (rayX1 - rayX0)) / W;
      const stepY = (rowDistance * (rayY1 - rayY0)) / W;
      let fx = px + rowDistance * rayX0;
      let fy = py + rowDistance * rayY0;

      const light = 1 - Math.min(1, rowDistance / FOG_DISTANCE) * 0.85;
      const rowOff = y * W * 4;

      for (let x = 0; x < W; x += hstep) {
        const tx = ((fx * tsize) | 0) & (tsize - 1);
        const ty = ((fy * tsize) | 0) & (tsize - 1);
        const ti = (ty * tsize + tx) * 4;
        const r = texData[ti] * light;
        const g = texData[ti + 1] * light;
        const b = texData[ti + 2] * light;
        for (let k = 0; k < hstep && x + k < W; k++) {
          const o = rowOff + (x + k) * 4;
          out[o] = r;
          out[o + 1] = g;
          out[o + 2] = b;
        }
        fx += stepX * hstep;
        fy += stepY * hstep;
      }

      // 間引いた行は直前の行をコピーして埋める
      for (let k = 1; k < vstep && y + k < bandH; k++) {
        out.copyWithin((y + k) * W * 4, rowOff, rowOff + W * 4);
      }
    }
    ctx.putImageData(this.floorBand, 0, bandTop);
  }

  renderSprites(horizon, dirX, dirY, planeX, planeY, projH) {
    const ctx = this.bctx;
    const p = this.player;
    const list = [];
    const shades = this.assets.shades;

    for (const e of this.enemies) {
      const a = this.assets.enemies[e.type];
      const frameIdx = (e.anim * 5) % 2 < 1 ? 0 : 1;
      const img = e.hurtT > 0 ? a.hurt : a.frames[frameIdx];
      const hover = e.def.hover ? e.def.hover + Math.sin(e.anim * 2.2) * 0.06 : 0;
      list.push({
        x: e.x, y: e.y, imgs: img,
        scale: e.scale * (e.dying ? Math.max(0.15, 1 - e.dying * 2) : 1),
        vWorld: 0.5 - e.scale / 2 - hover + (e.dying ? e.dying * 0.6 : 0),
        alpha: e.dying ? Math.max(0, 1 - e.dying * 2.2) : 1,
      });
    }
    for (const it of this.pickups) {
      const imgs = this.assets.pickups[it.kind] || this.assets.pickups.ammo;
      const bobY = Math.sin(it.anim * 3) * 0.05;
      list.push({
        x: it.x, y: it.y, imgs,
        scale: 0.42, vWorld: 0.5 - 0.21 - bobY, alpha: 1,
      });
    }
    for (const b of this.projectiles) {
      list.push({ x: b.x, y: b.y, imgs: this.assets.orb, scale: 0.3, vWorld: 0, alpha: 1 });
    }

    for (const s of list) {
      s.dx = s.x - p.x;
      s.dy = s.y - p.y;
      s.d2 = s.dx * s.dx + s.dy * s.dy;
    }
    list.sort((a, b) => b.d2 - a.d2);

    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const colW = this.colW;

    for (const s of list) {
      const tX = invDet * (dirY * s.dx - dirX * s.dy);
      const tY = invDet * (-planeY * s.dx + planeX * s.dy);
      if (tY < 0.18) continue;

      const h = (projH * s.scale) / tY;
      const wRays = h / colW;
      const screenXRay = (this.rays / 2) * (1 + tX / tY);
      const startRay = screenXRay - wRays / 2;
      const top = horizon - h / 2 + (s.vWorld * projH) / tY;

      const first = Math.max(0, Math.ceil(startRay));
      const last = Math.min(this.rays - 1, Math.floor(startRay + wRays));
      if (last < first) continue;

      const fog = Math.min(1, Math.sqrt(s.d2) / FOG_DISTANCE);
      const img = s.imgs[Math.min(shades - 1, Math.round(fog * (shades - 1)))];
      if (s.alpha < 1) ctx.globalAlpha = s.alpha;

      // Z バッファで隠れていない連続区間だけをまとめて描く
      let runStart = -1;
      for (let i = first; i <= last + 1; i++) {
        const visible = i <= last && this.zbuf[i] > tY;
        if (visible && runStart < 0) runStart = i;
        if (!visible && runStart >= 0) {
          const u0 = ((runStart - startRay) / wRays) * img.width;
          const u1 = ((i - startRay) / wRays) * img.width;
          ctx.drawImage(
            img, u0, 0, Math.max(0.5, u1 - u0), img.height,
            runStart * colW, top, (i - runStart) * colW, h,
          );
          runStart = -1;
        }
      }
      if (s.alpha < 1) ctx.globalAlpha = 1;
    }
  }

  drawWeapon() {
    const ctx = this.bctx;
    const p = this.player;
    const held = this.currentWeapon();
    const spriteIdx = held
      ? Math.min(this.assets.weapons.length - 1, (WEAPONS[held.id].slot - 1) + held.level - 1)
      : 0;
    const weapon = this.assets.weapons[spriteIdx];
    const H = this.bufH;
    const W = this.bufW;
    const scale = Math.min(W * 0.62, H * 0.65) / weapon.width;
    const gunW = weapon.width * scale;
    const h = weapon.height * scale;
    const bobX = Math.sin(this.bob) * H * 0.012;
    const bobY = Math.abs(Math.cos(this.bob)) * H * 0.016;
    const x = W / 2 - gunW / 2 + Math.min(W * 0.13, gunW * 0.55) + bobX;
    // リロード中は画面下へ引き下げる
    const reloadDip = p.reloadTotal && p.reloadT > 0
      ? Math.sin((1 - p.reloadT / p.reloadTotal) * Math.PI) * H * 0.28 : 0;
    const switchDip = p.switchTotal && p.switchT > 0
      ? (1 - Math.abs(p.switchT / p.switchTotal - 0.5) * 2) * H * 0.45 : 0;
    const y = H - h * 0.94 + bobY + p.recoil * H * 0.07 + reloadDip + switchDip;

    if (p.flash > 0) {
      const fx = x + weapon.width * 0.47 * scale;
      const fy = y + weapon.height * 0.04 * scale;
      const r = H * (0.16 + (held ? held.level : 1) * 0.012);
      const grad = ctx.createRadialGradient(fx, fy, 1, fx, fy, r);
      grad.addColorStop(0, 'rgba(255,244,200,0.95)');
      grad.addColorStop(0.4, 'rgba(255,180,80,0.5)');
      grad.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, TAU);
      ctx.fill();
    }
    ctx.drawImage(weapon, x, y, gunW, h);

    if (p.flash > 0) {
      ctx.fillStyle = `rgba(255,226,170,${p.flash * 0.32})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /** 減色・走査線など「時代」を作る後処理。低ティアほど強くかかる。 */
  postProcess() {
    const ctx = this.bctx;
    const W = this.bufW;
    const H = this.bufH;
    const tier = this.tier;

    if (tier.palette || tier.colorLevels) {
      const img = ctx.getImageData(0, 0, W, H);
      const d = img.data;
      if (tier.palette) {
        const lut = this.paletteLut;
        for (let i = 0; i < d.length; i += 4) {
          const idx = (((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)) * 3;
          d[i] = lut[idx];
          d[i + 1] = lut[idx + 1];
          d[i + 2] = lut[idx + 2];
        }
      } else {
        const lut = this.levelLut;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = lut[d[i]];
          d[i + 1] = lut[d[i + 1]];
          d[i + 2] = lut[d[i + 2]];
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    if (tier.scanline > 0) {
      ctx.fillStyle = `rgba(0,0,0,${tier.scanline * 0.5})`;
      for (let y = 1; y < H; y += 2) ctx.fillRect(0, y, W, 1);
    }
  }

  /** 明るい部分をにじませる簡易ブルーム（高ティアのみ）。 */
  drawBloom() {
    const ctx = this.ctx;
    const bc = this.bloomBuf.getContext('2d');
    bc.clearRect(0, 0, this.bloomBuf.width, this.bloomBuf.height);
    bc.filter = 'brightness(1.08) contrast(3.4) saturate(1.15)';
    bc.drawImage(this.buf, 0, 0, this.bloomBuf.width, this.bloomBuf.height);
    bc.filter = 'none';

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = this.tier.bloom;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bloomBuf, 0, 0, this.W, this.H);
    ctx.restore();
  }

  drawOverlays() {
    const ctx = this.ctx;
    const p = this.player;
    const W = this.W;
    const H = this.H;

    const lowHp = p.hp / p.maxHp < 0.35 ? 1 - p.hp / p.maxHp / 0.35 : 0;
    const vig = Math.max(p.hurtT / 0.5, lowHp * 0.55);
    if (vig > 0.01) {
      const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.65);
      grad.addColorStop(0, 'rgba(180,20,30,0)');
      grad.addColorStop(1, `rgba(180,20,30,${clamp(vig, 0, 1) * 0.75})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawCrosshair() {
    const ctx = this.ctx;
    const cx = this.W / 2;
    const cy = this.H / 2;
    const s = 11 * this.uiScale;
    const gap = 5 * this.uiScale;
    ctx.strokeStyle = this.aimHot ? 'rgba(255,90,80,0.95)' : 'rgba(230,245,255,0.8)';
    ctx.lineWidth = Math.max(1.5, 2.4 * this.uiScale);
    ctx.beginPath();
    ctx.moveTo(cx - gap - s, cy); ctx.lineTo(cx - gap, cy);
    ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + s, cy);
    ctx.moveTo(cx, cy - gap - s); ctx.lineTo(cx, cy - gap);
    ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + s);
    ctx.stroke();
    ctx.fillStyle = this.aimHot ? 'rgba(255,90,80,0.95)' : 'rgba(230,245,255,0.65)';
    ctx.fillRect(cx - 1 * this.uiScale, cy - 1 * this.uiScale, 2 * this.uiScale, 2 * this.uiScale);
  }

  drawMinimap() {
    const ctx = this.ctx;
    const p = this.player;
    const size = Math.min(this.W, this.H) * 0.22;
    const pad = 12 * this.uiScale;
    const x0 = this.W - size - pad;
    const y0 = pad;
    const radius = 15; // 表示するタイル半径（街が広いので広め）
    const cell = size / (radius * 2);

    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = '#070a14';
    ctx.fillRect(x0, y0, size, size);
    ctx.strokeStyle = 'rgba(120,220,255,0.5)';
    ctx.lineWidth = Math.max(1, 1.5 * this.uiScale);
    ctx.strokeRect(x0, y0, size, size);

    ctx.beginPath();
    ctx.rect(x0, y0, size, size);
    ctx.clip();

    const cx = x0 + size / 2;
    const cy = y0 + size / 2;
    const minX = Math.floor(p.x - radius);
    const maxX = Math.ceil(p.x + radius);
    const minY = Math.floor(p.y - radius);
    const maxY = Math.ceil(p.y + radius);

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (!this.tileAt(tx, ty)) continue;
        ctx.fillStyle = '#2f3d63';
        ctx.fillRect(cx + (tx - p.x) * cell, cy + (ty - p.y) * cell, cell + 1, cell + 1);
      }
    }

    for (const it of this.pickups) {
      ctx.fillStyle = it.kind === 'ammo' ? '#ffd447' : it.kind === 'core' ? '#7ce8ff' : '#ff5f7a';
      ctx.fillRect(cx + (it.x - p.x) * cell - cell * 0.2, cy + (it.y - p.y) * cell - cell * 0.2, cell * 0.45, cell * 0.45);
    }
    for (const e of this.enemies) {
      if (e.dying) continue;
      ctx.fillStyle = e.awake ? '#ff4d4d' : '#ff9d4d';
      ctx.beginPath();
      ctx.arc(cx + (e.x - p.x) * cell, cy + (e.y - p.y) * cell, cell * 0.3, 0, TAU);
      ctx.fill();
    }

    ctx.translate(cx, cy);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#4be0c0';
    ctx.beginPath();
    ctx.moveTo(cell * 0.55, 0);
    ctx.lineTo(-cell * 0.35, -cell * 0.4);
    ctx.lineTo(-cell * 0.35, cell * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
