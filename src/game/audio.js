/**
 * サウンドエンジン。
 *
 * 効果音は `scripts/make-audio.js` が生成した WAV アセット（public/audio/）を
 * 読み込んで再生する。実行時は再生と空間表現だけを行う:
 *   ・音源の左右定位（プレイヤーから見た方向）
 *   ・距離による減衰と、遠い音のこもり（ローパス）
 *   ・ピッチと音量のランダム化（同じ音の連続でも単調にならない）
 *   ・街の環境音をループ再生
 */

/** 読み込む音の一覧（ファイル名と用途）。 */
export const SOUND_NAMES = [
  'shot_blaster_a', 'shot_blaster_b', 'shot_scatter_a', 'shot_scatter_b',
  'shot_smg_a', 'shot_smg_b', 'shot_rail',
  'reload_out', 'reload_in', 'weapon_switch', 'empty_click',
  'hit_body', 'hit_shield', 'enemy_die', 'player_hurt', 'enemy_shot',
  'pickup', 'weapon_up', 'wave_start', 'game_over',
  'step_0', 'step_1', 'step_2', 'ambience',
];

const SHOT_VARIANTS = {
  blaster: ['shot_blaster_a', 'shot_blaster_b'],
  scatter: ['shot_scatter_a', 'shot_scatter_b'],
  smg: ['shot_smg_a', 'shot_smg_b'],
  rail: ['shot_rail'],
};

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export class Sfx {
  /**
   * @param {object} opts
   *   opts.data … { 名前: base64 } 形式で埋め込まれた音源（単一HTML版）
   *   opts.baseUrl … 音源ファイルの置き場所（React 版）
   */
  constructor(opts = {}) {
    this.data = opts.data || null;
    this.baseUrl = opts.baseUrl || null;
    this.ctx = null;
    this.master = null;
    this.buffers = new Map();
    this.muted = false;
    this.failed = false;
    this.loading = false;
    this.ambienceNode = null;
    this.wantAmbience = false;
  }

  /** ユーザー操作のタイミングで呼ぶ。AudioContext の生成と音源の読み込みを行う。 */
  resume() {
    if (this.failed) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          this.failed = true;
          return null;
        }
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);
        this._load();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch (e) {
      this.failed = true;
      return null;
    }
  }

  async _load() {
    if (this.loading) return;
    this.loading = true;
    const decode = (arrayBuffer) => new Promise((resolve, reject) => {
      // Safari 互換のためコールバック形式も受けられるようにする
      const p = this.ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });

    await Promise.all(SOUND_NAMES.map(async (name) => {
      try {
        let arrayBuffer;
        if (this.data && this.data[name]) {
          arrayBuffer = base64ToBuffer(this.data[name]);
        } else if (this.baseUrl) {
          const res = await fetch(`${this.baseUrl}${name}.wav`);
          arrayBuffer = await res.arrayBuffer();
        } else {
          return;
        }
        this.buffers.set(name, await decode(arrayBuffer));
      } catch (e) {
        /* 読み込めない音は鳴らさないだけにする */
      }
    }));
    // 読み込み完了後に、待たせていた環境音を鳴らし始める
    if (this.wantAmbience) this.startAmbience();
    this.onReady && this.onReady();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.9;
  }

  /** 互換用（旧 API）。音の質感はアセット側で作り込んでいるので何もしない。 */
  setTier() {}

  /**
   * 音を鳴らす。
   * pan: -1〜1（左右）、dist: プレイヤーからの距離、rate: 再生速度
   */
  play(name, opts = {}) {
    const ctx = this.resume();
    if (!ctx || this.muted) return null;
    const buffer = this.buffers.get(name);
    if (!buffer) return null;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const variance = opts.variance === undefined ? 0.06 : opts.variance;
    src.playbackRate.value = (opts.rate || 1) * (1 + (Math.random() * 2 - 1) * variance);
    if (opts.loop) src.loop = true;

    const gain = ctx.createGain();
    const dist = opts.dist || 0;
    const attenuation = 1 / (1 + dist * dist * 0.035);
    gain.gain.value = (opts.gain === undefined ? 1 : opts.gain) * attenuation
      * (1 + (Math.random() * 2 - 1) * 0.08);

    let node = src;
    // 遠い音はこもらせる（空気による高域の減衰）
    if (dist > 3) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(700, 14000 - dist * 700);
      node.connect(lp);
      node = lp;
    }
    node.connect(gain);

    if (opts.pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(panner).connect(this.master);
    } else {
      gain.connect(this.master);
    }

    src.start(ctx.currentTime + (opts.delay || 0));
    return src;
  }

  /* ------------------------------ ゲーム内の音 ------------------------------ */

  shoot(level = 1, id = 'blaster') {
    const list = SHOT_VARIANTS[id] || SHOT_VARIANTS.blaster;
    const name = list[(Math.random() * list.length) | 0];
    // レベルが上がるほど少し低く・太く鳴らす
    this.play(name, { gain: 0.95, rate: 1.06 - level * 0.015, variance: 0.05 });
  }

  empty() {
    this.play('empty_click', { gain: 0.7 });
  }

  hit(pan = 0, dist = 0) {
    this.play('hit_shield', { gain: 0.55, pan, dist, rate: 1.05 });
  }

  kill(pan = 0, dist = 0) {
    this.play('enemy_die', { gain: 0.9, pan, dist });
  }

  hurt() {
    this.play('player_hurt', { gain: 0.9 });
  }

  enemyShot(pan = 0, dist = 0) {
    this.play('enemy_shot', { gain: 0.6, pan, dist });
  }

  pickup() {
    this.play('pickup', { gain: 0.7 });
  }

  wave() {
    this.play('wave_start', { gain: 0.8 });
  }

  weaponUp() {
    this.play('weapon_up', { gain: 0.8 });
  }

  reloadStart() {
    this.play('reload_out', { gain: 0.75 });
  }

  reloadEnd() {
    this.play('reload_in', { gain: 0.8 });
  }

  weaponSwitch() {
    this.play('weapon_switch', { gain: 0.6 });
  }

  gameOver() {
    this.play('game_over', { gain: 0.9 });
  }

  /** 足音（歩行に合わせてエンジンから呼ばれる）。 */
  step() {
    const name = 'step_' + ((Math.random() * 3) | 0);
    this.play(name, { gain: 0.5, variance: 0.12 });
  }

  /** 街の環境音を流し始める。 */
  startAmbience() {
    this.wantAmbience = true;
    if (this.ambienceNode || !this.buffers.has('ambience')) return;
    this.ambienceNode = this.play('ambience', { gain: 0.5, loop: true, variance: 0 });
  }

  stopAmbience() {
    this.wantAmbience = false;
    if (!this.ambienceNode) return;
    try { this.ambienceNode.stop(); } catch (e) { /* 既に停止済み */ }
    this.ambienceNode = null;
    this.wantAmbience = false;
  }
}
