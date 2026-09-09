/**
 * WebAudio で効果音を合成する（音声ファイル不要）。
 *
 * 描画と同じく「時代」が進むほど音もリッチになる:
 *   8bit  … 矩形波のみ・ビットクラッシュあり・モノラル
 *   中盤  … フィルタとステレオ定位、軽いリバーブ
 *   最新  … 波形の重ね合わせ、サブベース、深いリバーブ
 *
 * 端末によっては AudioContext が使えないので、その場合は黙って無効化する。
 */

const DEFAULT_TIER = { crush: 5, reverb: 0, pan: false, layers: 1, sub: 0, filter: false };

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.chainIn = null;
    this.dry = null;
    this.wet = null;
    this.convolver = null;
    this.crusher = null;
    this.muted = false;
    this.failed = false;
    this.noiseBuffer = null;
    this.tier = DEFAULT_TIER;
  }

  /** ユーザー操作のタイミングで呼ぶ。AudioContext の生成・再開を行う。 */
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
        this._buildChain();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch (e) {
      this.failed = true;
      return null;
    }
  }

  _buildChain() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.35;
    this.master.connect(ctx.destination);

    // 入力 → ビットクラッシャー → ドライ/ウェット（リバーブ）→ マスター
    this.chainIn = ctx.createGain();
    this.crusher = ctx.createWaveShaper();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this._impulse(1.6, 2.4);

    this.chainIn.connect(this.crusher);
    this.crusher.connect(this.dry);
    this.dry.connect(this.master);
    this.crusher.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);

    this._applyTier();
  }

  /** ノイズから残響のインパルス応答を作る。 */
  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
      }
    }
    return buf;
  }

  /** 段階的にビット数を落とすカーブ（8bit機の粗い音を再現する）。 */
  _crushCurve(bits) {
    const steps = 2 ** bits;
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
  }

  _applyTier() {
    if (!this.ctx) return;
    const t = this.tier;
    this.crusher.curve = t.crush ? this._crushCurve(t.crush) : null;
    this.wet.gain.value = t.reverb;
    this.dry.gain.value = 1 - t.reverb * 0.35;
  }

  /** 描画ティアに合わせて音の質感を切り替える。 */
  setTier(audioTier) {
    this.tier = { ...DEFAULT_TIER, ...(audioTier || {}) };
    this._applyTier();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.35;
  }

  _noise() {
    if (!this.noiseBuffer) {
      const len = this.ctx.sampleRate * 0.5;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.noiseBuffer;
  }

  /** 音源の出力先（ティアに応じてステレオ定位を挟む）。pan: -1〜1 */
  _out(pan) {
    const ctx = this.ctx;
    if (!this.tier.pan || !ctx.createStereoPanner || !pan) return this.chainIn;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.chainIn);
    return p;
  }

  tone({ freq = 440, to = freq, dur = 0.15, type = 'square', gain = 0.4, delay = 0, pan = 0 }) {
    const ctx = this.resume();
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = this.tier.layers > 1 ? type : (type === 'sine' ? 'square' : type);
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this._out(pan));
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  burst({ dur = 0.2, gain = 0.35, freq = 1200, q = 1, delay = 0, pan = 0 }) {
    const ctx = this.resume();
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this._noise();
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let node = src;
    if (this.tier.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.35), t + dur);
      filter.Q.value = q;
      src.connect(filter);
      node = filter;
    }
    node.connect(g).connect(this._out(pan));
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** 低音の芯（高ティアのみ）。 */
  _sub(freq, dur, gain) {
    if (!this.tier.sub) return;
    this.tone({ freq, to: freq * 0.4, dur, type: 'sine', gain: gain * this.tier.sub });
  }

  /* --------------------------------- 効果音 --------------------------------- */

  /** 武器ごとに音色を変える。level が上がるほど厚みが増す。 */
  shoot(level = 1, id = 'blaster') {
    const t = this.tier;
    const thick = t.layers >= 2;

    if (id === 'scatter') {
      this.burst({ dur: 0.22, gain: 0.32, freq: 1500, q: 0.6 });
      this.tone({ freq: 260, to: 60, dur: 0.26, type: 'sawtooth', gain: 0.24 });
      if (thick) this.burst({ dur: 0.5, gain: 0.12, freq: 400, q: 0.5, delay: 0.03 });
      this._sub(58, 0.35, 0.55);
      return;
    }
    if (id === 'smg') {
      this.tone({ freq: 1150 + level * 30, to: 320, dur: 0.055, type: 'square', gain: 0.16 });
      this.burst({ dur: 0.05, gain: 0.12, freq: 3200 });
      this._sub(120, 0.08, 0.2);
      return;
    }
    if (id === 'rail') {
      this.tone({ freq: 220, to: 2200, dur: 0.12, type: 'sawtooth', gain: 0.2 });
      this.tone({ freq: 2400, to: 180, dur: 0.42, type: 'sine', gain: 0.22, delay: 0.1 });
      this.burst({ dur: 0.45, gain: 0.14, freq: 900, q: 0.8, delay: 0.08 });
      this._sub(45, 0.6, 0.8);
      return;
    }

    const base = 900 + level * 60;
    this.tone({ freq: base, to: 160, dur: 0.1, type: 'square', gain: 0.2 });
    this.burst({ dur: 0.09, gain: 0.16, freq: 2400 });
    if (thick) this.tone({ freq: base * 0.5, to: 120, dur: 0.16, type: 'sawtooth', gain: 0.12 });
    if (t.layers >= 3) this.burst({ dur: 0.28, gain: 0.08, freq: 700, q: 0.7, delay: 0.02 });
    this._sub(110, 0.18, 0.3);
  }

  /** 弾倉を抜く音（リロード開始）。 */
  reloadStart() {
    this.burst({ dur: 0.06, gain: 0.16, freq: 1800, q: 3 });
    this.tone({ freq: 300, to: 180, dur: 0.08, type: 'square', gain: 0.1, delay: 0.02 });
  }

  /** 弾倉を叩き込む音（リロード完了）。 */
  reloadEnd() {
    this.burst({ dur: 0.09, gain: 0.22, freq: 900, q: 2.5 });
    this.tone({ freq: 200, to: 120, dur: 0.12, type: 'square', gain: 0.14, delay: 0.02 });
    this._sub(80, 0.16, 0.3);
  }

  /** 武器の持ち替え。 */
  weaponSwitch() {
    this.burst({ dur: 0.05, gain: 0.12, freq: 2600, q: 2 });
    this.tone({ freq: 520, to: 760, dur: 0.1, type: 'triangle', gain: 0.12, delay: 0.04 });
  }

  empty() {
    this.tone({ freq: 220, to: 140, dur: 0.06, type: 'triangle', gain: 0.15 });
  }

  hit(pan = 0) {
    this.burst({ dur: 0.08, gain: 0.2, freq: 900, q: 2, pan });
    if (this.tier.layers >= 2) this.tone({ freq: 520, to: 300, dur: 0.07, type: 'triangle', gain: 0.1, pan });
  }

  kill(pan = 0) {
    this.tone({ freq: 320, to: 60, dur: 0.4, type: 'sawtooth', gain: 0.24, pan });
    this.burst({ dur: 0.35, gain: 0.2, freq: 500, pan });
    if (this.tier.layers >= 2) this.burst({ dur: 0.6, gain: 0.1, freq: 220, q: 0.6, delay: 0.04, pan });
    this._sub(70, 0.5, 0.45);
  }

  hurt() {
    this.tone({ freq: 180, to: 70, dur: 0.28, type: 'sawtooth', gain: 0.3 });
    if (this.tier.layers >= 2) this.burst({ dur: 0.3, gain: 0.12, freq: 300, q: 0.8 });
    this._sub(55, 0.4, 0.4);
  }

  enemyShot(pan = 0) {
    this.tone({ freq: 420, to: 900, dur: 0.16, type: 'sine', gain: 0.13, pan });
  }

  pickup() {
    this.tone({ freq: 620, to: 1180, dur: 0.14, type: 'triangle', gain: 0.22 });
    if (this.tier.layers >= 2) this.tone({ freq: 1240, to: 1860, dur: 0.12, type: 'sine', gain: 0.1, delay: 0.06 });
  }

  wave() {
    this.tone({ freq: 400, to: 400, dur: 0.18, type: 'square', gain: 0.18 });
    this.tone({ freq: 600, to: 600, dur: 0.22, type: 'square', gain: 0.18, delay: 0.16 });
    this.tone({ freq: 800, to: 800, dur: 0.3, type: 'square', gain: 0.2, delay: 0.34 });
  }

  /** 武器レベルアップ音（上昇アルペジオ） */
  weaponUp() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => {
      this.tone({ freq: f, to: f, dur: 0.22, type: 'triangle', gain: 0.2, delay: i * 0.09 });
      if (this.tier.layers >= 2) {
        this.tone({ freq: f * 2, to: f * 2, dur: 0.16, type: 'sine', gain: 0.09, delay: i * 0.09 + 0.02 });
      }
    });
    this._sub(90, 0.5, 0.4);
  }

  /** 描画ティアが上がったときのファンファーレ */
  tierUp() {
    this.tone({ freq: 300, to: 900, dur: 0.5, type: 'sawtooth', gain: 0.16 });
    this.tone({ freq: 900, to: 1400, dur: 0.4, type: 'sine', gain: 0.12, delay: 0.2 });
    this._sub(60, 0.7, 0.5);
  }

  gameOver() {
    this.tone({ freq: 400, to: 60, dur: 1.1, type: 'sawtooth', gain: 0.3 });
    this._sub(45, 1.2, 0.6);
  }
}
