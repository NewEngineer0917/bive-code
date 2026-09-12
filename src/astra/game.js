/**
 * ASTRA BOND — ゲーム本体。
 *
 * 読み込み → 町の構築 → 毎フレームの更新（入力・プレイヤー・NPC・環境・粒子）
 * → 描画、までをまとめる。React 側はこのクラスを生成して HUD の状態を受け取るだけ。
 */

import { Renderer } from './gfx/renderer.js';
import { buildMaterialLibrary } from './gfx/materials.js';
import { ParticleSystem, KIND } from './gfx/particles.js';
import { Terrain } from './world/terrain.js';
import { buildTown, DISTRICTS } from './world/town.js';
import { NpcManager } from './world/npc.js';
import { TownAstraManager } from './world/townAstra.js';
import { RIVER_PATH } from './world/terrain.js';
import { buildHuman, HUMAN_BONES } from './world/characters.js';
import { HumanAnimator } from './world/humanAnim.js';
import { Skeleton } from './core/skeleton.js';
import { PlayerController } from './world/player.js';
import { OrbitCamera } from './core/camera.js';
import { Input } from './core/input.js';
import { DayCycle } from './core/daycycle.js';
import { m4compose, clamp, TAU, lerp } from './core/math.js';

const PLAYER_LOOK = {
  seed: 1,
  skin: [1.06, 0.68, 0.5],
  hair: [0.22, 0.2, 0.26],
  hairStyle: 0,
  top: [0.28, 0.42, 0.62],
  bottom: [0.26, 0.28, 0.34],
  eye: [0.3, 0.6, 0.72],
  sleeves: 'short',
  belt: true,
  build: 1.0,
  shoe: [0.7, 0.5, 0.3]
};

export class AstraBondGame {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.quality = opts.quality || detectQuality();
    this.onState = opts.onState || (() => {});
    this.onProgress = opts.onProgress || (() => {});
    this.running = false;
    this.paused = false;
    this.hud = {
      district: '中央広場',
      prompt: null,
      dialogue: null,
      clock: '',
      timeLabel: '',
      fps: 0,
      stats: null,
      quality: this.quality
    };
    this._acc = 0;
    this._fpsSamples = [];
    this._lastTime = 0;
    this._frame = 0;
  }

  /** 重い構築を段階的に行い、進捗を返す。 */
  async load() {
    const steps = [
      ['素材を合成しています', () => { this.lib = buildMaterialLibrary(this.quality === 'low' ? 128 : 256); }],
      ['描画エンジンを起動しています', () => {
        this.renderer = new Renderer(this.canvas, this.lib, { quality: this.quality });
        this.particles = new ParticleSystem(this.renderer.gl, 2600);
      }],
      ['ルミナタウンの地形を作っています', () => { this.terrain = new Terrain(7); }],
      ['町を建てています', () => { this.town = buildTown(this.lib.materials, this.terrain, { quality: this.quality }); }],
      ['町を描画用に送っています', () => {
        this.renderer.addStatic(this.town.staticBatches);
        this.renderer.addStatic(this.town.groundBatches);
        this.renderer.addStatic(this.town.rockBatches);
        this.renderer.addStatic(this.town.grassBatches, { cullDistance: this.quality === 'low' ? 32 : 52 });
        this.renderer.addWater(this.town.waterBatches);
        this.renderer.setLights(this.town.lights);
      }],
      ['住人を呼んでいます', () => { this._createCharacters(); }],
      ['アストラたちを迎えています', () => {
        this.astra = new TownAstraManager(this.renderer, this.lib.materials, this.terrain,
          this.town.collision, RIVER_PATH);
      }],
      ['最後の仕上げ', () => { this._setupWorld(); }],
    ];
    for (let i = 0; i < steps.length; i++) {
      const [label, fn] = steps[i];
      this.onProgress(i / steps.length, label);
      // 画面を更新させてから重い処理を走らせる
      await new Promise((r) => setTimeout(r, 16));
      fn();
    }
    this.onProgress(1, '準備完了');
  }

  _createCharacters() {
    const mats = this.lib.materials;
    const built = buildHuman(mats, PLAYER_LOOK);
    this.playerObject = this.renderer.createObject(built.batches, { boneCount: built.boneCount, radius: 1.2 });
    this.playerSkeleton = new Skeleton(HUMAN_BONES);
    this.playerAnim = new HumanAnimator(this.playerSkeleton, { strideLength: 1.55 });
    this.playerObject.bones = this.playerSkeleton.skinData;
    this.npcs = new NpcManager(this.renderer, mats, this.terrain, this.town.collision, this.town.npcSpawns);
  }

  _setupWorld() {
    const start = this.town.playerStart;
    this.player = new PlayerController(this.terrain, this.town.collision, {
      x: start.x, z: start.z, facing: start.facing
    });
    this.camera = new OrbitCamera({ distance: 6.4, height: 1.35, fov: 54 });
    this.camera.yaw = start.facing + Math.PI;
    this.input = new Input(this.canvas);
    this.day = new DayCycle(9.5, 900);
    this.wind = this.renderer.wind;
    this.particles.wind = { x: this.wind.dirX, z: this.wind.dirZ, strength: this.wind.strength };
    this.time = 0;
    this.ambientTimers = { dust: 0, pollen: 0, butterfly: 0, leaf: 0, fountain: 0, nova: 0 };
    this.dialogue = null;
    this.currentDistrict = null;
    this.hud.stats = {
      triangles: this.town.stats.triangles,
      grass: this.town.stats.grass,
      trees: this.town.stats.trees,
      lights: this.town.lights.length
    };
  }

  start() {
    if (this.running) return;
    // 開発時に外から触れるようにしておく（撮影・検証用）
    if (typeof window !== 'undefined') window.__astra = this;
    this.running = true;
    this._lastTime = performance.now();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    if (this.input) this.input.dispose();
    if (this.renderer) this.renderer.dispose();
  }

  setQuality(q) {
    this.quality = q;
    this.hud.quality = q;
    this.renderer.setQuality(q);
    this._emit();
  }

  setPaused(v) {
    this.paused = v;
    if (this.input) this.input.enabled = !v;
  }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);
    let dt = (now - this._lastTime) / 1000;
    this._lastTime = now;
    if (dt > 0.1) dt = 0.1;     // タブ復帰時に飛ばない
    if (this.paused) dt = 0;

    this._fpsSamples.push(dt);
    if (this._fpsSamples.length > 30) this._fpsSamples.shift();

    this.update(dt);
    this.renderer.render(this.camera, dt, this.particles);

    this._frame++;
    if (this._frame % 15 === 0) this._emit();
  }

  update(dt) {
    this.time += dt;
    const input = this.input;
    input.beginFrame();

    // ---- カメラ
    this.camera.applyLook(input.look.x, input.look.y);
    if (input.zoomDelta) this.camera.zoom(input.zoomDelta);

    // ---- プレイヤー
    const move = this.player.update(dt, input, this.camera);
    const p = this.player;
    this.playerAnim.setClip(this.dialogue ? 'idle' : move.running ? 'run' : move.moving ? 'walk' : 'idle');
    const footstep = this.playerAnim.update(dt, {
      speed: move.speed, lean: clamp(move.speed / this.player.runSpeed, 0, 1) * 0.5
    });
    m4compose(this.playerObject.matrix, p.x, p.y, p.z, p.facing, 1, 1, 1);
    this.playerObject.bones = this.playerSkeleton.skinData;
    if (footstep) this._onFootstep(p.x, p.y, p.z, move.running);

    this.camera.update(dt, [p.x, p.y, p.z], (from, to, r) => this.town.collision.probe(from, to, r));

    // ---- 住人とアストラ
    this.npcs.update(dt, this.time, [p.x, p.y, p.z], null);
    this.astra.update(dt, this.time, this.npcs.npcs, this.particles, [p.x, p.y, p.z]);

    // ---- 時間と空
    this.day.update(dt);
    this.day.apply(this.renderer.env, this.renderer.grade);
    // 風は時間とともにゆっくり向きを変える
    const wa = Math.sin(this.time * 0.037) * 0.8 + 1.1;
    this.wind.dirX = Math.cos(wa);
    this.wind.dirZ = Math.sin(wa);
    this.wind.strength = 0.34 + Math.sin(this.time * 0.09) * 0.12 + Math.sin(this.time * 0.021) * 0.1;
    this.particles.wind.x = this.wind.dirX;
    this.particles.wind.z = this.wind.dirZ;
    this.particles.wind.strength = this.wind.strength;

    // ---- 雰囲気の粒子
    this._updateAmbient(dt);
    this.particles.update(dt, this.time);

    // ---- 調べる・話す
    this._updateInteraction(input);

    // ---- 区画の表示
    const district = this._districtAt(p.x, p.z);
    if (district && district.name !== this.hud.district) {
      this.hud.district = district.name;
      this.hud.districtChangedAt = this.time;
      this._emit();
    }

    // ---- デバッグ操作
    if (input.wasPressed('KeyT')) { this.day.setHour(this.day.hour < 12 ? 20.5 : 9.5); }
    if (input.wasPressed('KeyP')) { this.day.paused = !this.day.paused; }

    input.endFrame();
  }

  _districtAt(x, z) {
    let best = null, bestScore = Infinity;
    for (const d of DISTRICTS) {
      const dist = Math.hypot(x - d.x, z - d.z);
      if (dist < d.r && dist < bestScore) { bestScore = dist; best = d; }
    }
    return best;
  }

  /** 足音のフック（音響システムが後から繋がる）。 */
  _onFootstep(x, y, z, running) {
    const surf = this.terrain.roadField(x, z);
    this.onFootstepHook?.(surf.stone > 0.4 ? 'stone' : surf.dirt > 0.3 ? 'dirt' : 'grass', running);
    // 砂埃
    if (running) {
      this.particles.spawn({
        x, y: y + 0.05, z, vx: (Math.random() - 0.5) * 0.4, vy: 0.3, vz: (Math.random() - 0.5) * 0.4,
        size: 0.16, sizeEnd: 0.42, life: 0.5, color: [0.72, 0.66, 0.56], alpha: 0.3,
        kind: KIND.SMOKE, additive: false, drag: 2.4, gravity: 0.3
      });
    }
  }

  /** 埃・花粉・蝶・落ち葉・噴水のしぶき・ノヴァの光。 */
  _updateAmbient(dt) {
    const p = this.player;
    const t = this.ambientTimers;
    const night = this.renderer.env.nightFactor;
    const rnd = (a, b) => a + Math.random() * (b - a);

    // 太陽の光に舞う埃（昼）
    t.dust += dt;
    if (t.dust > 0.06) {
      t.dust = 0;
      const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 16;
      this.particles.spawn({
        x: p.x + Math.cos(a) * r, y: p.y + rnd(0.3, 4.5), z: p.z + Math.sin(a) * r,
        vx: rnd(-0.1, 0.1), vy: rnd(-0.02, 0.08), vz: rnd(-0.1, 0.1),
        size: rnd(0.012, 0.03), life: rnd(3, 7),
        color: night > 0.5 ? [0.5, 0.65, 0.95] : [1.0, 0.95, 0.8],
        alpha: lerp(0.5, 0.35, night), kind: KIND.GLOW, glow: 0.4, drag: 0.15, wind: 0.35
      });
    }
    // 花粉（昼のみ・ゆっくり漂う）
    if (night < 0.5) {
      t.pollen += dt;
      if (t.pollen > 0.22) {
        t.pollen = 0;
        const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 14;
        this.particles.spawn({
          x: p.x + Math.cos(a) * r, y: p.y + rnd(0.2, 2.6), z: p.z + Math.sin(a) * r,
          vx: rnd(-0.05, 0.05), vy: rnd(0.02, 0.12), vz: rnd(-0.05, 0.05),
          size: rnd(0.03, 0.06), life: rnd(5, 9), color: [1.0, 0.96, 0.72], alpha: 0.6,
          kind: KIND.GLOW, glow: 0.8, drag: 0.1, wind: 0.5
        });
      }
    }
    // 落ち葉（風が強いとき）
    t.leaf += dt;
    if (t.leaf > 0.5 && this.wind.strength > 0.36) {
      t.leaf = 0;
      const a = Math.random() * TAU, r = 6 + Math.random() * 14;
      this.particles.spawn({
        x: p.x + Math.cos(a) * r, y: p.y + rnd(1.5, 5), z: p.z + Math.sin(a) * r,
        vx: this.wind.dirX * 1.4, vy: rnd(-0.3, 0.1), vz: this.wind.dirZ * 1.4,
        size: rnd(0.07, 0.13), life: rnd(4, 7),
        color: [0.75, 0.85, 0.45], alpha: 0.85, kind: KIND.PETAL,
        additive: false, drag: 0.9, gravity: -0.5, spin: rnd(-4, 4), wind: 1.0
      });
    }
    // 蝶（昼・広場と住宅街に多い）
    if (night < 0.4) {
      t.butterfly += dt;
      if (t.butterfly > 1.4) {
        t.butterfly = 0;
        const a = Math.random() * TAU, r = 3 + Math.random() * 12;
        const bx = p.x + Math.cos(a) * r, bz = p.z + Math.sin(a) * r;
        this.particles.spawn({
          x: bx, y: this.terrain.height(bx, bz) + rnd(0.4, 1.6), z: bz,
          vx: rnd(-0.5, 0.5), vy: rnd(0.1, 0.5), vz: rnd(-0.5, 0.5),
          size: 0.1, life: rnd(4, 8), color: [1.2, 0.95, 0.6], alpha: 0.95,
          kind: KIND.PETAL, additive: false, drag: 0.5, gravity: 0.25, spin: rnd(-8, 8), wind: 0.3
        });
      }
    }
    // 噴水のしぶき
    const fdist = Math.hypot(p.x, p.z);
    if (fdist < 34) {
      t.fountain += dt;
      const rate = fdist < 14 ? 0.02 : 0.06;
      if (t.fountain > rate) {
        t.fountain = 0;
        const fy = this.terrain.height(0, 0);
        // 上段から落ちる水
        for (const basin of this.town.fountain.upperBasins) {
          const a = Math.random() * TAU;
          this.particles.spawn({
            x: Math.cos(a) * basin.r * 0.96, y: fy + basin.y, z: Math.sin(a) * basin.r * 0.96,
            vx: 0, vy: -0.4, vz: 0, size: rnd(0.03, 0.06), life: 0.75,
            color: [0.75, 0.92, 1.0], alpha: 0.7, kind: KIND.GLOW, glow: 0.5,
            drag: 0.05, gravity: -6
          });
        }
        // 獣像の口から出る水
        for (const s of this.town.fountain.spouts) {
          if (Math.random() > 0.4) continue;
          const dir = Math.atan2(s[2], s[0]);
          this.particles.spawn({
            x: s[0], y: fy + s[1], z: s[2],
            vx: Math.cos(dir) * 1.4, vy: 1.1, vz: Math.sin(dir) * 1.4,
            size: rnd(0.03, 0.055), life: 0.9, color: [0.8, 0.95, 1.0], alpha: 0.65,
            kind: KIND.GLOW, glow: 0.6, drag: 0.1, gravity: -6.5
          });
        }
      }
      // クリスタルから立ちのぼるノヴァ粒子
      t.nova += dt;
      if (t.nova > 0.1) {
        t.nova = 0;
        const c = this.town.fountain.crystal;
        const fy = this.terrain.height(0, 0);
        const a = Math.random() * TAU;
        this.particles.spawn({
          x: c[0] + Math.cos(a) * rnd(0.2, 1.4), y: fy + c[1] + rnd(-0.6, 0.8),
          z: c[2] + Math.sin(a) * rnd(0.2, 1.4),
          vx: Math.cos(a) * 0.1, vy: rnd(0.3, 0.8), vz: Math.sin(a) * 0.1,
          size: rnd(0.04, 0.1), sizeEnd: 0.01, life: rnd(1.6, 3.2),
          color: [0.5, 0.95, 1.0], alpha: 0.9, kind: KIND.GLOW, glow: 1.6, drag: 0.5
        });
      }
    }
  }

  _updateInteraction(input) {
    const p = this.player;
    if (this.dialogue) {
      if (input.interactPressed) {
        this.dialogue.index++;
        if (this.dialogue.index >= this.dialogue.lines.length) {
          this._endDialogue();
        } else {
          this.hud.dialogue = { ...this.dialogue, line: this.dialogue.lines[this.dialogue.index] };
          this._emit();
        }
      }
      return;
    }

    // 一番近い相手（NPC か調べられる物）
    const npc = this.npcs.nearest(p.x, p.z, 2.8);
    const pet = this.astra.nearest(p.x, p.z, 2.4);
    let target = null;
    if (npc) {
      target = { type: 'npc', label: '話す', npc };
    } else if (pet) {
      target = { type: 'astra', label: 'なでる', astra: pet };
    } else {
      let bestD = Infinity;
      for (const it of this.town.interactables) {
        const d = Math.hypot(it.x - p.x, it.z - p.z);
        if (d < it.radius && d < bestD) { bestD = d; target = { type: 'thing', thing: it, label: it.label }; }
      }
    }
    const promptText = !target ? null
      : target.type === 'npc' ? '話しかける'
        : target.type === 'astra' ? `${target.astra.info.name}をなでる`
          : target.thing.action === 'enter' ? `${target.thing.label}に入る`
            : `${target.thing.label}を調べる`;
    if (promptText !== this.hud.prompt) {
      this.hud.prompt = promptText;
      this._emit();
    }
    this._target = target;

    if (target && input.interactPressed) this._beginInteraction(target);
  }

  _beginInteraction(target) {
    if (target.type === 'astra') {
      const a = target.astra;
      a.anim.setClip('happy');
      a.happyTimer = 2.4;
      this.particles.burst({
        x: a.x, y: a.y + 0.5 * a.scale, z: a.z, count: 14, speed: 1.1, spread: 1.0,
        size: 0.06, life: 0.9, color: [1.0, 0.85, 0.95], alpha: 0.9, kind: KIND.GLOW,
        glow: 1.2, drag: 1.6, gravity: 0.6,
      });
      this.dialogue = {
        speaker: a.info.name,
        lines: [`${a.info.name}は気持ちよさそうに目を細めた。`],
        index: 0,
      };
    } else if (target.type === 'npc') {
      const n = target.npc;
      n.talking = true;
      this.dialogue = {
        speaker: nameFor(n.kind), lines: n.lines, index: 0, npc: n
      };
    } else {
      const t = target.thing;
      if (t.action === 'enter') {
        this.dialogue = {
          speaker: t.label,
          lines: ['（扉に手をかけた。……中に入るのは、もう少し準備をしてからにしよう）'],
          index: 0
        };
      } else if (t.action === 'sit') {
        this.dialogue = { speaker: 'ベンチ', lines: ['ひと休みした。風が気持ちいい。'], index: 0 };
      } else {
        this.dialogue = { speaker: t.label, lines: t.text || ['……'], index: 0 };
      }
    }
    this.player.setLocked(true);
    this.hud.dialogue = { ...this.dialogue, line: this.dialogue.lines[0] };
    this.hud.prompt = null;
    this._emit();
  }

  _endDialogue() {
    if (this.dialogue?.npc) this.dialogue.npc.talking = false;
    this.dialogue = null;
    this.hud.dialogue = null;
    this.player.setLocked(false);
    this._emit();
  }

  _emit() {
    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this._fpsSamples.length);
    this.hud.fps = Math.round(1 / Math.max(avg, 0.0001));
    this.hud.clock = this.day.clock;
    this.hud.timeLabel = this.day.label;
    this.hud.drawCalls = this.renderer.stats.drawCalls;
    this.hud.visibleTriangles = this.renderer.stats.triangles;
    this.onState({ ...this.hud });
  }
}

function nameFor(kind) {
  return {
    citizen: '町の人', elder: '老人', child: '子ども', vendor: '店主', sweeper: '掃除人',
    doctor: '診療所の医師', scientist: '研究員', fisher: '釣り人', guard: '門番'
  }[kind] || '町の人';
}

/** 端末の性能をざっくり見て初期品質を決める。 */
export function detectQuality() {
  if (typeof navigator === 'undefined') return 'high';
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (mobile && (cores <= 4 || mem <= 3)) return 'low';
  if (mobile) return 'medium';
  if (cores <= 4 || mem <= 4) return 'medium';
  return 'high';
}
