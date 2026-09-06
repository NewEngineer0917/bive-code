/**
 * レイキャスティング方式の 3D FPS エンジン（Canvas 2D のみ / 外部ライブラリなし）。
 *
 * - 壁は DDA レイキャストで 1 列ずつテクスチャを描画する
 * - 敵・弾・アイテムはスプライトとして Z バッファ付きで描画する
 * - 入力（キーボード / マウス / タッチ）は React 側から setInput 経由で受け取る
 */

import { buildAssets, SHADE_LEVELS } from './textures';
import { generateMap, createRng } from './mapGen';
import { Sfx } from './audio';

const TAU = Math.PI * 2;
const PLAYER_RADIUS = 0.22;
const WALK_SPEED = 3.1;
const SPRINT_SPEED = 4.5;
const KEY_TURN_SPEED = 2.6;
const MAX_AMMO = 99;
const FIRE_INTERVAL = 0.14;
const BULLET_DAMAGE = 34;
const FOG_DISTANCE = 13;

export const DIFFICULTIES = {
  easy: { key: 'easy', label: 'かんたん', hp: 140, ammo: 64, dmg: 0.65, spd: 0.9, count: 0.8 },
  normal: { key: 'normal', label: 'ふつう', hp: 100, ammo: 48, dmg: 1, spd: 1, count: 1 },
  hard: { key: 'hard', label: 'むずかしい', hp: 80, ammo: 40, dmg: 1.45, spd: 1.15, count: 1.25 },
};

const ENEMY_TYPES = {
  drone: {
    name: 'ドローン', hp: 55, speed: 2.0, damage: 9, score: 100, radius: 0.3,
    scale: 0.62, hover: 0.32, range: 1.05, cooldown: 0.9, ranged: false,
  },
  gunner: {
    name: 'ガンナー', hp: 75, speed: 1.35, damage: 11, score: 150, radius: 0.32,
    scale: 0.85, hover: 0, range: 8.5, cooldown: 1.7, ranged: true,
  },
  brute: {
    name: 'ブルート', hp: 185, speed: 1.05, damage: 19, score: 300, radius: 0.42,
    scale: 1.1, hover: 0, range: 1.35, cooldown: 1.5, ranged: false,
  },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function normAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export class Game {
  constructor(canvas, { onEvent } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.assets = buildAssets();
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
  };

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
    this.ctx.imageSmoothingEnabled = false;
    this.W = this.canvas.width;
    this.H = this.canvas.height;

    // 1 本のレイが担当する横幅（端末性能に応じて解像度を落とす）
    const targetRays = coarse ? 300 : 460;
    this.colW = Math.max(2, Math.ceil(this.W / targetRays));
    this.rays = Math.ceil(this.W / this.colW);
    this.zbuf = new Float32Array(this.rays);

    // 画角：横長なら広く、縦長では狭くして歪みを防ぐ
    const aspect = this.W / this.H;
    const hFovDeg = aspect >= 1.5 ? 78 : aspect >= 1 ? 72 : 56;
    this.planeLen = Math.tan((hFovDeg * Math.PI) / 360);
    // 正方形ピクセルを保つ投影係数（1 単位の壁が距離 1 で占める画面高の割合）
    this.proj = clamp(this.W / 2 / (this.planeLen * this.H), 0.4, 1.25);
    this.uiScale = clamp(Math.min(this.W, this.H) / 720, 0.6, 2.4);

    const g1 = this.ctx.createLinearGradient(0, 0, 0, this.H * 0.5);
    g1.addColorStop(0, '#05060d');
    g1.addColorStop(1, '#1b2138');
    this.ceilGrad = g1;
    const g2 = this.ctx.createLinearGradient(0, this.H * 0.5, 0, this.H);
    g2.addColorStop(0, '#171a24');
    g2.addColorStop(1, '#3a3f52');
    this.floorGrad = g2;
  }

  /* --------------------------------- ゲーム進行 -------------------------------- */

  newGame(difficultyKey = 'normal') {
    const d = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;
    this.difficulty = d;
    const rnd = createRng((Math.random() * 0xffffffff) >>> 0);
    this.rnd = rnd;
    this.map = generateMap(rnd);
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

    this.player = {
      x: 1.5, y: 1.5, angle: 0.7,
      hp: d.hp, maxHp: d.hp,
      ammo: d.ammo, score: 0,
      fireCd: 0, recoil: 0, flash: 0, hurtT: 0,
    };
    // 開けている方向を向いて開始する
    if (!this.isWall(2.5, 1.5)) this.player.angle = 0;
    else if (!this.isWall(1.5, 2.5)) this.player.angle = Math.PI / 2;

    this.state = 'playing';
    this.sfx.resume();
    this.startWave();
    this.emitState();
  }

  startWave() {
    this.wave++;
    const d = this.difficulty;
    const count = Math.max(3, Math.min(16, Math.round((3 + this.wave * 1.6) * d.count)));
    this.spawnQueue = [];
    for (let i = 0; i < count; i++) {
      this.spawnQueue.push({ type: this.pickEnemyType(), t: 0.25 + i * 0.35 });
    }
    // 各ウェーブでアイテムを補充
    this.spawnPickup('ammo');
    this.spawnPickup('ammo');
    if (this.wave % 2 === 0) this.spawnPickup('health');
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

  spawnPickup(kind) {
    if (this.pickups.length > 8) return;
    const cell = this.findSpawnCell(4);
    this.pickups.push({ kind, x: cell[0], y: cell[1], anim: this.rnd() * 6 });
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
    return {
      hp: Math.max(0, Math.ceil(p.hp)),
      maxHp: p.maxHp,
      ammo: p.ammo,
      score: p.score,
      wave: this.wave,
      enemies: this.enemies.filter((e) => !e.dying).length + this.spawnQueue.length,
      hurt: clamp(p.hurtT / 0.5, 0, 1),
      kills: this.kills,
      time: this.elapsed,
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

    this.updatePlayer(dt);
    if (this.input.firing) this.fire();

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
        p.ammo = Math.min(MAX_AMMO, p.ammo + 12);
        this.onEvent('waveclear', { wave: this.wave });
      } else {
        this.waveBreak -= dt;
        if (this.waveBreak <= 0) this.startWave();
      }
    }

    this.aimHot = !!this.aimTarget(0).enemy;
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
        if (p.ammo >= MAX_AMMO) continue;
        p.ammo = Math.min(MAX_AMMO, p.ammo + 16);
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

  /** 画面中央（照準）にいる敵を返す。 */
  aimTarget(spread = 0) {
    const p = this.player;
    if (!p) return { enemy: null };
    const angle = p.angle + spread;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const wall = this.castRay(p.x, p.y, dirX, dirY).dist;

    let best = null;
    let bestDist = Infinity;
    for (const e of this.enemies) {
      if (e.dying) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.05 || dist > wall || dist >= bestDist) continue;
      const da = normAngle(Math.atan2(dy, dx) - angle);
      if (Math.abs(da) > Math.atan2(e.radius, dist)) continue;
      // 上下方向：ピッチを考慮して当たり判定する
      const h = (this.proj * this.H * e.scale) / dist;
      const vWorld = 0.5 - e.scale / 2 - (e.def.hover || 0);
      const offsetY = this.pitch + (vWorld * this.proj * this.H) / dist;
      if (Math.abs(offsetY) > h / 2 + this.H * 0.02) continue;
      best = e;
      bestDist = dist;
    }
    return { enemy: best, dist: bestDist };
  }

  fire() {
    if (this.state !== 'playing') return;
    const p = this.player;
    if (p.fireCd > 0) return;
    if (p.ammo <= 0) {
      p.fireCd = 0.4;
      this.sfx.empty();
      return;
    }
    p.ammo--;
    p.fireCd = FIRE_INTERVAL;
    p.recoil = 1;
    p.flash = 0.06;
    this.shake = Math.min(1, this.shake + 0.12);
    this.sfx.shoot();

    const spread = (Math.random() - 0.5) * 0.028;
    const { enemy } = this.aimTarget(spread);
    if (!enemy) return;
    enemy.hp -= BULLET_DAMAGE;
    enemy.hurtT = 0.12;
    enemy.awake = true;
    if (enemy.hp <= 0) {
      enemy.dying = 0.001;
      this.kills++;
      p.score += enemy.def.score;
      this.sfx.kill();
      const roll = Math.random();
      const drop = roll < 0.28 ? 'ammo' : roll < 0.4 ? 'health' : null;
      if (drop) {
        if (this.pickups.length >= 14) this.pickups.shift(); // 拾われずに溜まり続けるのを防ぐ
        this.pickups.push({ kind: drop, x: enemy.x, y: enemy.y, anim: 0 });
      }
    } else {
      this.sfx.hit();
    }
  }

  /* ---------------------------- 入力（React から呼ぶ） ---------------------------- */

  look(dx, dy) {
    const p = this.player;
    if (!p || this.state !== 'playing') return;
    p.angle = normAngle(p.angle + dx);
    this.pitch = clamp(this.pitch - dy * this.H, -this.H * 0.32, this.H * 0.32);
  }

  /* ---------------------------------- 描画 ---------------------------------- */

  render(dt) {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    if (!this.map || !this.player) {
      ctx.fillStyle = '#05060d';
      ctx.fillRect(0, 0, W, H);
      return;
    }

    const shakeAmp = this.shake * this.uiScale * 9;
    const sx = (Math.random() - 0.5) * shakeAmp;
    const sy = (Math.random() - 0.5) * shakeAmp;

    ctx.save();
    ctx.translate(sx, sy);
    this.renderWorld(dt);
    ctx.restore();

    this.drawWeapon();
    this.drawOverlays();
    this.drawMinimap();
    this.drawCrosshair();
  }

  renderWorld(dt) {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    const p = this.player;
    const horizon = Math.round(H / 2 + this.pitch);
    const pad = 24;

    ctx.fillStyle = this.ceilGrad;
    ctx.fillRect(-pad, -pad, W + pad * 2, horizon + pad);
    ctx.fillStyle = this.floorGrad;
    ctx.fillRect(-pad, horizon, W + pad * 2, H - horizon + pad);

    const dirX = Math.cos(p.angle);
    const dirY = Math.sin(p.angle);
    const planeX = -dirY * this.planeLen;
    const planeY = dirX * this.planeLen;
    const projH = this.proj * H;
    const colW = this.colW;
    const walls = this.assets.walls;

    for (let i = 0; i < this.rays; i++) {
      const cameraX = (2 * i) / this.rays - 1;
      const rdx = dirX + planeX * cameraX;
      const rdy = dirY + planeY * cameraX;
      const hit = this.castRay(p.x, p.y, rdx, rdy);
      const dist = hit.dist;
      this.zbuf[i] = dist;

      const lineH = projH / dist;
      const top = horizon - lineH / 2;
      const tex = walls[hit.tile] || walls[3];

      let wallX = hit.side === 0 ? p.y + dist * rdy : p.x + dist * rdx;
      wallX -= Math.floor(wallX);
      let texX = (wallX * tex.width) | 0;
      if ((hit.side === 0 && rdx > 0) || (hit.side === 1 && rdy < 0)) {
        texX = tex.width - texX - 1;
      }

      const x = i * colW;
      ctx.drawImage(tex, texX, 0, 1, tex.height, x, top, colW + 1, lineH);

      let fog = dist / FOG_DISTANCE;
      if (hit.side === 1) fog += 0.16;
      const q = Math.min(24, (fog * 24) | 0);
      if (q > 0) {
        ctx.fillStyle = this._shades[q];
        ctx.fillRect(x, top, colW + 1, lineH);
      }
    }

    this.renderSprites(horizon, dirX, dirY, planeX, planeY, projH);
  }

  renderSprites(horizon, dirX, dirY, planeX, planeY, projH) {
    const ctx = this.ctx;
    const p = this.player;
    const list = [];

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
      const imgs = this.assets.pickups[it.kind];
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
      const w = h;
      const wRays = w / colW;
      const screenXRay = (this.rays / 2) * (1 + tX / tY);
      const startRay = screenXRay - wRays / 2;
      const top = horizon - h / 2 + (s.vWorld * projH) / tY;

      const first = Math.max(0, Math.ceil(startRay));
      const last = Math.min(this.rays - 1, Math.floor(startRay + wRays));
      if (last < first) continue;

      const img = s.imgs[Math.min(SHADE_LEVELS - 1, (Math.sqrt(s.d2) / 2.6) | 0)];
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
    const ctx = this.ctx;
    const p = this.player;
    const weapon = this.assets.weapon;
    const H = this.H;
    const W = this.W;
    // 画面の縦横どちらにも収まるサイズにする（縦持ちで巨大化しないように）
    const scale = Math.min(W * 0.62, H * 0.65) / weapon.width;
    const w = weapon.width * scale;
    const h = weapon.height * scale;
    const bobX = Math.sin(this.bob) * H * 0.012;
    const bobY = Math.abs(Math.cos(this.bob)) * H * 0.016;
    const x = W / 2 - w / 2 + Math.min(W * 0.13, w * 0.55) + bobX;
    const y = H - h * 0.94 + bobY + p.recoil * H * 0.07;

    if (p.flash > 0) {
      const fx = x + weapon.width * 0.47 * scale;
      const fy = y + weapon.height * 0.04 * scale;
      const r = H * 0.16;
      const grad = ctx.createRadialGradient(fx, fy, 1, fx, fy, r);
      grad.addColorStop(0, 'rgba(255,244,200,0.95)');
      grad.addColorStop(0.4, 'rgba(255,180,80,0.5)');
      grad.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(fx, fy, r, 0, TAU);
      ctx.fill();
    }
    ctx.drawImage(weapon, x, y, w, h);
  }

  drawOverlays() {
    const ctx = this.ctx;
    const p = this.player;
    const W = this.W;
    const H = this.H;

    if (p.flash > 0) {
      ctx.fillStyle = `rgba(255,226,170,${p.flash * 0.6})`;
      ctx.fillRect(0, 0, W, H);
    }
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
    const radius = 8.5; // 表示するタイル半径
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
      ctx.fillStyle = it.kind === 'ammo' ? '#ffd447' : '#ff5f7a';
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
