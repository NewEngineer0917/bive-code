/**
 * WebAudio で効果音を合成する簡易サウンドエンジン（音声ファイル不要）。
 * 端末によっては AudioContext が使えないので、その場合は黙って無効化する。
 */
export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.noiseBuffer = null;
    this.failed = false;
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
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.35;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    } catch (e) {
      this.failed = true;
      return null;
    }
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

  tone({ freq = 440, to = freq, dur = 0.15, type = 'square', gain = 0.4, delay = 0 }) {
    const ctx = this.resume();
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  burst({ dur = 0.2, gain = 0.35, freq = 1200, q = 1, delay = 0 }) {
    const ctx = this.resume();
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this._noise();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, t);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  shoot() {
    this.tone({ freq: 900, to: 160, dur: 0.1, type: 'square', gain: 0.22 });
    this.burst({ dur: 0.09, gain: 0.16, freq: 2400 });
  }

  empty() {
    this.tone({ freq: 220, to: 140, dur: 0.06, type: 'triangle', gain: 0.15 });
  }

  hit() {
    this.burst({ dur: 0.08, gain: 0.2, freq: 900, q: 2 });
  }

  kill() {
    this.tone({ freq: 320, to: 60, dur: 0.4, type: 'sawtooth', gain: 0.25 });
    this.burst({ dur: 0.35, gain: 0.2, freq: 500 });
  }

  hurt() {
    this.tone({ freq: 180, to: 70, dur: 0.28, type: 'sawtooth', gain: 0.3 });
  }

  enemyShot() {
    this.tone({ freq: 420, to: 900, dur: 0.16, type: 'sine', gain: 0.14 });
  }

  pickup() {
    this.tone({ freq: 620, to: 1180, dur: 0.14, type: 'triangle', gain: 0.22 });
  }

  wave() {
    this.tone({ freq: 400, to: 400, dur: 0.18, type: 'square', gain: 0.18 });
    this.tone({ freq: 600, to: 600, dur: 0.22, type: 'square', gain: 0.18, delay: 0.16 });
    this.tone({ freq: 800, to: 800, dur: 0.3, type: 'square', gain: 0.2, delay: 0.34 });
  }

  gameOver() {
    this.tone({ freq: 400, to: 60, dur: 1.1, type: 'sawtooth', gain: 0.3 });
  }
}
