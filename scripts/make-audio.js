/**
 * 効果音アセット（WAV）を生成するビルドスクリプト。
 *
 *   node scripts/make-audio.js   →   public/audio/*.wav
 *
 * ブラウザの単純な発振器では出せない「厚み」を作るため、ここでは
 * ノイズ／トランジェント／低音の胴鳴り／残響を層で重ね、
 * 共振フィルタとサチュレーションを通してからファイルに焼き込む。
 * 実行時はこの音源を鳴らすだけなので、音質が安定し負荷も軽い。
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'audio');

/* ------------------------------- 基本の道具 ------------------------------- */

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 双二次フィルタ（ローパス／ハイパス／バンドパス）。 */
function biquad(type, freq, q, rate) {
  const w0 = (2 * Math.PI * freq) / rate;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  let b0; let b1; let b2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  if (type === 'lp') {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
  } else if (type === 'hp') {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
  } else {
    b0 = alpha; b1 = 0; b2 = -alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** 時間変化するカットオフでフィルタを掛ける。 */
function filterSweep(buf, type, fromHz, toHz, q, rate) {
  const out = new Float32Array(buf.length);
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const t = i / buf.length;
    const f = clamp(fromHz * (toHz / fromHz) ** t, 20, rate * 0.45);
    const c = biquad(type, f, q, rate);
    const x = buf[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

function noise(len, rnd) {
  const b = new Float32Array(len);
  for (let i = 0; i < len; i++) b[i] = rnd() * 2 - 1;
  return b;
}

/** 指数エンベロープ。 */
function envelope(buf, attack, decay, rate, curve = 2.5) {
  const a = Math.max(1, attack * rate);
  for (let i = 0; i < buf.length; i++) {
    const at = i < a ? i / a : 1;
    const t = Math.max(0, (i - a) / (decay * rate));
    buf[i] *= at * Math.exp(-t * curve);
  }
  return buf;
}

function osc(len, rate, f0, f1, type, rnd) {
  const b = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const f = f0 * (f1 / f0) ** t;
    phase += (2 * Math.PI * f) / rate;
    if (type === 'sine') b[i] = Math.sin(phase);
    else if (type === 'saw') b[i] = ((phase / Math.PI) % 2) - 1;
    else if (type === 'square') b[i] = Math.sin(phase) > 0 ? 1 : -1;
    else b[i] = Math.sin(phase) + (rnd() - 0.5) * 0.2;
  }
  return b;
}

/** サチュレーション（軽い歪みで音を太くする）。 */
function saturate(buf, amount) {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * amount) / Math.tanh(amount);
  return buf;
}

/** シュレーダー型の簡易リバーブ（空間の響き）。 */
function reverb(buf, rate, mix, size) {
  const out = Float32Array.from(buf);
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.round(d * size * rate));
  const gains = [0.78, 0.74, 0.72, 0.7];
  const acc = new Float32Array(buf.length);
  combs.forEach((delay, k) => {
    const line = new Float32Array(buf.length + delay);
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i] + line[i] * gains[k];
      line[i + delay] = v;
      acc[i] += v * 0.25;
    }
  });
  // オールパスで拡散させる
  let ap = acc;
  for (const d of [0.005, 0.0017]) {
    const delay = Math.round(d * rate);
    const line = new Float32Array(ap.length + delay);
    const res = new Float32Array(ap.length);
    for (let i = 0; i < ap.length; i++) {
      const v = ap[i] + line[i] * 0.7;
      line[i + delay] = v;
      res[i] = line[i] - 0.7 * v;
    }
    ap = res;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i] * (1 - mix) + ap[i] * mix;
  return out;
}

function mix(...layers) {
  const len = Math.max(...layers.map((l) => l.buf.length));
  const out = new Float32Array(len);
  for (const { buf, gain, offset } of layers) {
    const off = Math.round((offset || 0) * (layers.rate || 1));
    for (let i = 0; i < buf.length; i++) {
      const j = i + off;
      if (j < len) out[j] += buf[i] * gain;
    }
  }
  return out;
}

function normalize(buf, peak = 0.92) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] / max) * peak;
  return buf;
}

/** 16bit PCM の WAV として書き出す。 */
function writeWav(name, buf, rate) {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(buf[i] * 32767))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(OUT, name + '.wav'), Buffer.concat([header, data]));
  return data.length + 44;
}

/* -------------------------------- 効果音 -------------------------------- */

const RATE = 22050;
const secs = (t) => Math.round(t * RATE);

/** 銃声：トランジェント＋胴鳴り＋クラック＋残響の4層で作る。 */
function gunshot(rnd, opt) {
  const len = secs(opt.dur);
  // 1) 発射のアタック（高域ノイズを急峻に減衰）
  const crack = envelope(
    filterSweep(noise(len, rnd), 'hp', opt.crackFrom, opt.crackTo, 0.9, RATE),
    0.0004, opt.crackDecay, RATE, 6,
  );
  // 2) 胴鳴り（低域の押し出し）
  const body = envelope(osc(len, RATE, opt.bodyFrom, opt.bodyTo, 'sine', rnd), 0.001, opt.bodyDecay, RATE, 4);
  // 3) 機構音・金属の鳴り
  const mech = envelope(
    filterSweep(noise(len, rnd), 'bp', opt.mechFrom, opt.mechTo, 3.5, RATE),
    0.002, opt.mechDecay, RATE, 5,
  );
  // 4) エネルギー成分（この世界の武器なので少しだけ電子的に）
  const zap = envelope(osc(len, RATE, opt.zapFrom, opt.zapTo, 'saw', rnd), 0.0008, opt.zapDecay, RATE, 7);

  let out = mix(
    { buf: crack, gain: opt.crackGain },
    { buf: body, gain: opt.bodyGain },
    { buf: mech, gain: opt.mechGain },
    { buf: zap, gain: opt.zapGain },
  );
  out = saturate(out, opt.drive);
  out = reverb(out, RATE, opt.space, opt.roomSize);
  return normalize(out, 0.95);
}

/** 機械音（リロードなど）：短いクリックの重ね合わせ。 */
function mechanical(rnd, clicks, dur, tone) {
  const len = secs(dur);
  const layers = [];
  for (const c of clicks) {
    const l = secs(c.dur);
    const click = envelope(
      filterSweep(noise(l, rnd), 'bp', c.from, c.to, c.q || 4, RATE),
      0.0004, c.decay, RATE, 7,
    );
    const pad = new Float32Array(len);
    const off = secs(c.at);
    for (let i = 0; i < l && i + off < len; i++) pad[i + off] = click[i];
    layers.push({ buf: pad, gain: c.gain });

    if (c.thump) {
      const th = envelope(osc(l, RATE, c.thump, c.thump * 0.4, 'sine', rnd), 0.001, c.decay * 1.6, RATE, 4);
      const padT = new Float32Array(len);
      for (let i = 0; i < l && i + off < len; i++) padT[i + off] = th[i];
      layers.push({ buf: padT, gain: c.gain * 0.7 });
    }
  }
  if (tone) {
    const t = envelope(osc(len, RATE, tone.from, tone.to, 'sine', rnd), 0.002, tone.decay, RATE, 4);
    layers.push({ buf: t, gain: tone.gain });
  }
  let out = mix(...layers);
  out = saturate(out, 1.6);
  out = reverb(out, RATE, 0.16, 0.7);
  return normalize(out, 0.8);
}

const SOUNDS = {};

const rnd = rng(20260911);

// --- 銃声 ---
SOUNDS.shot_blaster_a = gunshot(rnd, {
  dur: 0.42, crackFrom: 5200, crackTo: 900, crackDecay: 0.05, crackGain: 0.85,
  bodyFrom: 170, bodyTo: 55, bodyDecay: 0.09, bodyGain: 0.9,
  mechFrom: 2400, mechTo: 700, mechDecay: 0.07, mechGain: 0.35,
  zapFrom: 1500, zapTo: 240, zapDecay: 0.05, zapGain: 0.45,
  drive: 2.4, space: 0.3, roomSize: 0.9,
});
SOUNDS.shot_blaster_b = gunshot(rnd, {
  dur: 0.42, crackFrom: 4800, crackTo: 820, crackDecay: 0.055, crackGain: 0.85,
  bodyFrom: 160, bodyTo: 50, bodyDecay: 0.095, bodyGain: 0.92,
  mechFrom: 2600, mechTo: 760, mechDecay: 0.065, mechGain: 0.32,
  zapFrom: 1620, zapTo: 220, zapDecay: 0.045, zapGain: 0.42,
  drive: 2.5, space: 0.3, roomSize: 0.95,
});
SOUNDS.shot_scatter_a = gunshot(rnd, {
  dur: 0.85, crackFrom: 3800, crackTo: 420, crackDecay: 0.12, crackGain: 1,
  bodyFrom: 120, bodyTo: 38, bodyDecay: 0.2, bodyGain: 1.1,
  mechFrom: 1500, mechTo: 380, mechDecay: 0.16, mechGain: 0.45,
  zapFrom: 700, zapTo: 120, zapDecay: 0.09, zapGain: 0.3,
  drive: 3.2, space: 0.42, roomSize: 1.3,
});
SOUNDS.shot_scatter_b = gunshot(rnd, {
  dur: 0.85, crackFrom: 3500, crackTo: 400, crackDecay: 0.13, crackGain: 1,
  bodyFrom: 110, bodyTo: 34, bodyDecay: 0.22, bodyGain: 1.15,
  mechFrom: 1400, mechTo: 350, mechDecay: 0.17, mechGain: 0.42,
  zapFrom: 660, zapTo: 110, zapDecay: 0.1, zapGain: 0.28,
  drive: 3.4, space: 0.44, roomSize: 1.35,
});
SOUNDS.shot_smg_a = gunshot(rnd, {
  dur: 0.26, crackFrom: 6200, crackTo: 1400, crackDecay: 0.028, crackGain: 0.8,
  bodyFrom: 210, bodyTo: 80, bodyDecay: 0.045, bodyGain: 0.6,
  mechFrom: 3200, mechTo: 1100, mechDecay: 0.035, mechGain: 0.4,
  zapFrom: 2000, zapTo: 420, zapDecay: 0.025, zapGain: 0.32,
  drive: 2.2, space: 0.22, roomSize: 0.8,
});
SOUNDS.shot_smg_b = gunshot(rnd, {
  dur: 0.26, crackFrom: 5800, crackTo: 1300, crackDecay: 0.03, crackGain: 0.8,
  bodyFrom: 200, bodyTo: 76, bodyDecay: 0.048, bodyGain: 0.62,
  mechFrom: 3000, mechTo: 1050, mechDecay: 0.036, mechGain: 0.38,
  zapFrom: 2100, zapTo: 400, zapDecay: 0.026, zapGain: 0.3,
  drive: 2.2, space: 0.22, roomSize: 0.82,
});
SOUNDS.shot_rail = (() => {
  const len = secs(1.1);
  // 充填の唸り → 放電 → 金属的な余韻
  const charge = envelope(osc(len, RATE, 180, 1800, 'saw', rnd), 0.12, 0.2, RATE, 1.2);
  const discharge = gunshot(rnd, {
    dur: 0.9, crackFrom: 7000, crackTo: 500, crackDecay: 0.09, crackGain: 1,
    bodyFrom: 90, bodyTo: 30, bodyDecay: 0.26, bodyGain: 1.2,
    mechFrom: 2200, mechTo: 300, mechDecay: 0.2, mechGain: 0.5,
    zapFrom: 3200, zapTo: 160, zapDecay: 0.12, zapGain: 0.6,
    drive: 3.6, space: 0.5, roomSize: 1.6,
  });
  const pad = new Float32Array(len);
  const off = secs(0.16);
  for (let i = 0; i < discharge.length && i + off < len; i++) pad[i + off] = discharge[i];
  return normalize(mix({ buf: charge, gain: 0.35 }, { buf: pad, gain: 1 }), 0.96);
})();

// --- 機構音 ---
SOUNDS.reload_out = mechanical(rnd, [
  { at: 0, dur: 0.09, from: 2600, to: 900, decay: 0.03, gain: 0.9, thump: 220 },
  { at: 0.11, dur: 0.12, from: 1400, to: 400, decay: 0.05, gain: 0.7, thump: 150 },
], 0.34);
SOUNDS.reload_in = mechanical(rnd, [
  { at: 0, dur: 0.08, from: 1800, to: 700, decay: 0.03, gain: 0.7 },
  { at: 0.1, dur: 0.16, from: 900, to: 260, decay: 0.07, gain: 1, thump: 110 },
  { at: 0.27, dur: 0.1, from: 3200, to: 1200, decay: 0.03, gain: 0.6 },
], 0.45);
SOUNDS.weapon_switch = mechanical(rnd, [
  { at: 0, dur: 0.07, from: 3000, to: 1200, decay: 0.025, gain: 0.7 },
  { at: 0.09, dur: 0.1, from: 1600, to: 600, decay: 0.04, gain: 0.6, thump: 180 },
], 0.28);
SOUNDS.empty_click = mechanical(rnd, [
  { at: 0, dur: 0.05, from: 3400, to: 1400, decay: 0.018, gain: 0.8 },
], 0.12);

// --- 戦闘 ---
SOUNDS.hit_body = (() => {
  const len = secs(0.3);
  const thud = envelope(osc(len, RATE, 260, 70, 'sine', rnd), 0.001, 0.06, RATE, 5);
  const splat = envelope(filterSweep(noise(len, rnd), 'bp', 1800, 400, 2, RATE), 0.001, 0.05, RATE, 6);
  return normalize(saturate(mix({ buf: thud, gain: 0.8 }, { buf: splat, gain: 0.6 }), 2), 0.75);
})();
SOUNDS.hit_shield = (() => {
  const len = secs(0.34);
  const ring = envelope(osc(len, RATE, 2200, 1400, 'sine', rnd), 0.0006, 0.12, RATE, 4);
  const tick = envelope(filterSweep(noise(len, rnd), 'hp', 6000, 2500, 1.2, RATE), 0.0004, 0.03, RATE, 8);
  return normalize(reverb(mix({ buf: ring, gain: 0.5 }, { buf: tick, gain: 0.7 }), RATE, 0.25, 0.8), 0.72);
})();
SOUNDS.enemy_die = (() => {
  const len = secs(1.0);
  const blast = envelope(filterSweep(noise(len, rnd), 'lp', 4000, 200, 0.8, RATE), 0.002, 0.35, RATE, 3);
  const sub = envelope(osc(len, RATE, 120, 28, 'sine', rnd), 0.004, 0.4, RATE, 3);
  const debris = envelope(filterSweep(noise(len, rnd), 'bp', 3000, 900, 5, RATE), 0.05, 0.5, RATE, 2.4);
  return normalize(reverb(saturate(mix(
    { buf: blast, gain: 0.9 }, { buf: sub, gain: 1 }, { buf: debris, gain: 0.35 },
  ), 2.6), RATE, 0.38, 1.2), 0.95);
})();
SOUNDS.player_hurt = (() => {
  const len = secs(0.6);
  const impact = envelope(osc(len, RATE, 150, 45, 'sine', rnd), 0.001, 0.18, RATE, 3);
  const noiseHit = envelope(filterSweep(noise(len, rnd), 'lp', 1600, 250, 1, RATE), 0.001, 0.1, RATE, 4);
  return normalize(saturate(mix({ buf: impact, gain: 1 }, { buf: noiseHit, gain: 0.6 }), 2.2), 0.85);
})();
SOUNDS.enemy_shot = (() => {
  const len = secs(0.4);
  const zap = envelope(osc(len, RATE, 900, 180, 'saw', rnd), 0.001, 0.09, RATE, 5);
  const air = envelope(filterSweep(noise(len, rnd), 'bp', 2600, 800, 2.5, RATE), 0.002, 0.08, RATE, 5);
  return normalize(reverb(saturate(mix({ buf: zap, gain: 0.7 }, { buf: air, gain: 0.5 }), 2), RATE, 0.3, 1), 0.7);
})();

// --- UI・進行 ---
SOUNDS.pickup = (() => {
  const len = secs(0.35);
  const a = envelope(osc(len, RATE, 700, 1500, 'sine', rnd), 0.002, 0.1, RATE, 4);
  const b = envelope(osc(len, RATE, 1400, 2600, 'sine', rnd), 0.004, 0.08, RATE, 5);
  return normalize(reverb(mix({ buf: a, gain: 0.7 }, { buf: b, gain: 0.4 }), RATE, 0.25, 0.9), 0.6);
})();
SOUNDS.weapon_up = (() => {
  const len = secs(1.0);
  const layers = [];
  [523, 659, 784, 1046].forEach((f, i) => {
    const l = secs(0.5);
    const t = envelope(osc(l, RATE, f, f, 'sine', rnd), 0.004, 0.22, RATE, 3.5);
    const pad = new Float32Array(len);
    const off = secs(i * 0.085);
    for (let k = 0; k < l && k + off < len; k++) pad[k + off] = t[k];
    layers.push({ buf: pad, gain: 0.5 });
  });
  const sub = envelope(osc(len, RATE, 110, 55, 'sine', rnd), 0.01, 0.5, RATE, 2.5);
  layers.push({ buf: sub, gain: 0.5 });
  return normalize(reverb(mix(...layers), RATE, 0.3, 1.1), 0.7);
})();
SOUNDS.wave_start = (() => {
  const len = secs(1.6);
  const layers = [];
  [220, 330, 440].forEach((f, i) => {
    const l = secs(0.9);
    const t = envelope(osc(l, RATE, f, f * 1.01, 'saw', rnd), 0.02, 0.4, RATE, 2.2);
    const pad = new Float32Array(len);
    const off = secs(i * 0.18);
    for (let k = 0; k < l && k + off < len; k++) pad[k + off] = t[k];
    layers.push({ buf: pad, gain: 0.35 });
  });
  const boom = envelope(osc(len, RATE, 90, 40, 'sine', rnd), 0.01, 0.7, RATE, 2);
  layers.push({ buf: boom, gain: 0.6 });
  return normalize(reverb(saturate(mix(...layers), 1.8), RATE, 0.4, 1.4), 0.8);
})();
SOUNDS.game_over = (() => {
  const len = secs(2.2);
  const fall = envelope(osc(len, RATE, 320, 45, 'saw', rnd), 0.02, 1.1, RATE, 1.6);
  const sub = envelope(osc(len, RATE, 70, 28, 'sine', rnd), 0.05, 1.3, RATE, 1.4);
  const air = envelope(filterSweep(noise(len, rnd), 'lp', 2000, 200, 0.8, RATE), 0.1, 1.2, RATE, 1.5);
  return normalize(reverb(saturate(mix(
    { buf: fall, gain: 0.6 }, { buf: sub, gain: 0.8 }, { buf: air, gain: 0.3 },
  ), 2), RATE, 0.45, 1.8), 0.85);
})();

// --- 足音 ---
for (let i = 0; i < 3; i++) {
  const len = secs(0.22);
  const scuff = envelope(filterSweep(noise(len, rnd), 'bp', 1200 + i * 260, 300, 1.6, RATE), 0.002, 0.05, RATE, 6);
  const thud = envelope(osc(len, RATE, 120 + i * 12, 55, 'sine', rnd), 0.001, 0.05, RATE, 5);
  SOUNDS['step_' + i] = normalize(mix({ buf: scuff, gain: 0.5 }, { buf: thud, gain: 0.7 }), 0.35);
}

// --- 街の環境音（ループ） ---
SOUNDS.ambience = (() => {
  const len = secs(6);
  const rumble = filterSweep(noise(len, rnd), 'lp', 220, 180, 0.7, RATE);
  const air = filterSweep(noise(len, rnd), 'bp', 900, 700, 0.6, RATE);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    // 端をなめらかに繋いでループさせる
    const fade = Math.min(1, Math.min(i, len - i) / (RATE * 0.5));
    const slow = 0.7 + 0.3 * Math.sin((i / RATE) * 0.7);
    out[i] = (rumble[i] * 0.8 + air[i] * 0.25) * fade * slow;
  }
  return normalize(out, 0.32);
})();

/* --------------------------------- 書き出し -------------------------------- */

/** 低域しか含まない音は間引いて容量を減らす。 */
function decimate(buf, factor) {
  const out = new Float32Array(Math.floor(buf.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += buf[i * factor + k] || 0;
    out[i] = sum / factor;
  }
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
const names = [];
for (const [name, buf] of Object.entries(SOUNDS)) {
  const lowBand = name === 'ambience';
  total += lowBand
    ? writeWav(name, decimate(buf, 2), RATE / 2)
    : writeWav(name, buf, RATE);
  names.push(name);
}
console.log(`効果音 ${names.length} 個を public/audio に生成しました（合計 ${(total / 1024).toFixed(0)} KB）`);
