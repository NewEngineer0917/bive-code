/**
 * 時間帯と空模様。
 *
 * 太陽の高さから、日光・空・環境光・霧・露出をまとめて決める。
 * 朝焼け → 昼 → 夕焼け → 夜 が連続して変わり、
 * 夜になると窓・街灯・ノヴァクリスタルの自発光が立ち上がる。
 */

import { smoothstep, lerp } from './math.js';

const KEYS = [
  // hour, sunColor, zenith, horizon, ambientSky, ambientGround, fog, exposure, night
  { h: 0.0, sun: [0.243, 0.324, 0.702], zen: [0.02, 0.035, 0.09], hor: [0.07, 0.1, 0.2],
    sky: [0.07, 0.1, 0.2], gnd: [0.02, 0.025, 0.045], fog: [0.06, 0.09, 0.17], exp: 0.93, night: 1 },
  { h: 5.0, sun: [0.945, 0.648, 0.81], zen: [0.08, 0.12, 0.26], hor: [0.38, 0.3, 0.34],
    sky: [0.18, 0.2, 0.3], gnd: [0.06, 0.055, 0.06], fog: [0.32, 0.28, 0.32], exp: 0.837, night: 0.75 },
  { h: 6.6, sun: [4.19, 2.32, 1.35], zen: [0.2, 0.34, 0.62], hor: [1.0, 0.68, 0.5],
    sky: [0.5, 0.45, 0.48], gnd: [0.16, 0.13, 0.11], fog: [0.86, 0.66, 0.56], exp: 0.651, night: 0.22 },
  { h: 9.0, sun: [3.83, 3.29, 2.65], zen: [0.2, 0.42, 0.8], hor: [0.7, 0.8, 0.9],
    sky: [0.42, 0.52, 0.7], gnd: [0.22, 0.2, 0.16], fog: [0.68, 0.77, 0.86], exp: 0.608, night: 0 },
  { h: 13.0, sun: [4.05, 3.83, 3.4], zen: [0.16, 0.4, 0.85], hor: [0.66, 0.79, 0.93],
    sky: [0.44, 0.56, 0.76], gnd: [0.26, 0.24, 0.2], fog: [0.7, 0.8, 0.9], exp: 0.57, night: 0 },
  { h: 17.0, sun: [4.05, 3.38, 2.48], zen: [0.18, 0.4, 0.78], hor: [0.82, 0.78, 0.78],
    sky: [0.44, 0.5, 0.66], gnd: [0.26, 0.22, 0.17], fog: [0.78, 0.78, 0.84], exp: 0.589, night: 0 },
  { h: 18.8, sun: [4.59, 1.89, 0.918], zen: [0.14, 0.24, 0.52], hor: [1.05, 0.55, 0.36],
    sky: [0.46, 0.36, 0.36], gnd: [0.2, 0.14, 0.12], fog: [0.9, 0.56, 0.42], exp: 0.651, night: 0.3 },
  { h: 20.2, sun: [1.35, 0.864, 1.13], zen: [0.05, 0.08, 0.2], hor: [0.3, 0.22, 0.3],
    sky: [0.2, 0.2, 0.3], gnd: [0.07, 0.06, 0.07], fog: [0.26, 0.22, 0.3], exp: 0.806, night: 0.8 },
  { h: 24.0, sun: [0.243, 0.324, 0.702], zen: [0.02, 0.035, 0.09], hor: [0.07, 0.1, 0.2],
    sky: [0.07, 0.1, 0.2], gnd: [0.02, 0.025, 0.045], fog: [0.06, 0.09, 0.17], exp: 0.93, night: 1 },
];

function mixColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export class DayCycle {
  constructor(hour = 10, dayLength = 720) {
    this.hour = hour;
    this.dayLength = dayLength;   // 実時間（秒）での 1 日の長さ
    this.paused = false;
    this.speed = 1;
  }

  update(dt) {
    if (!this.paused) this.hour = (this.hour + (24 / this.dayLength) * dt * this.speed) % 24;
  }

  setHour(h) { this.hour = ((h % 24) + 24) % 24; }

  /** レンダラの env へ流し込む値を作る。 */
  apply(env, grade) {
    const h = this.hour;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smoothstep(a.h, b.h, h);

    // 太陽の向き：東から昇って西へ沈む。少し傾けて影を斜めに。
    const dayAngle = ((h - 6) / 12) * Math.PI;
    const elev = Math.sin(dayAngle);
    const sunY = elev;
    const sunX = -Math.cos(dayAngle) * 0.86;
    const sunZ = 0.34 + Math.cos(dayAngle) * 0.2;
    // 夜は月を光源にする（弱く青い）
    const night = lerp(a.night, b.night, t);
    const dir = night > 0.5
      ? [-sunX, Math.max(0.28, -sunY), -sunZ]
      : [sunX, Math.max(0.06, sunY), sunZ];
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    env.sunDir[0] = dir[0] / len; env.sunDir[1] = dir[1] / len; env.sunDir[2] = dir[2] / len;

    const set = (target, c) => { target[0] = c[0]; target[1] = c[1]; target[2] = c[2]; };
    set(env.sunColor, mixColor(a.sun, b.sun, t));
    set(env.zenith, mixColor(a.zen, b.zen, t));
    set(env.horizon, mixColor(a.hor, b.hor, t));
    set(env.skyColor, mixColor(a.sky, b.sky, t));
    set(env.groundColor, mixColor(a.gnd, b.gnd, t));
    set(env.fogColor, mixColor(a.fog, b.fog, t));
    env.nightFactor = night;
    env.exposure = lerp(a.exp, b.exp, t);
    // 夜は霧を濃くして、街灯の光芒を出す
    env.fogDensity = lerp(0.0022, 0.0042, night);
    env.fogStart = lerp(44, 26, night);
    env.ambientScale = lerp(0.42, 0.58, night);
    // 水の色も時間で変える
    const dayShallow = [0.26, 0.5, 0.5], nightShallow = [0.06, 0.14, 0.2];
    const dayDeep = [0.05, 0.18, 0.28], nightDeep = [0.02, 0.05, 0.1];
    set(env.shallowWater, mixColor(dayShallow, nightShallow, night));
    set(env.deepWater, mixColor(dayDeep, nightDeep, night));

    if (grade) {
      // 昼は少し青寄りのコントラスト、夜は藍色を持ち上げる
      grade.lift = [lerp(0.008, 0.018, night), lerp(0.012, 0.026, night), lerp(0.024, 0.055, night)];
      grade.gain = [lerp(1.03, 0.9, night), lerp(1.0, 0.95, night), lerp(0.97, 1.08, night)];
      grade.saturation = lerp(1.16, 1.0, night);
      grade.contrast = lerp(1.1, 1.04, night);
      grade.bloomAmount = lerp(0.5, 0.85, night);
      grade.bloomThreshold = lerp(1.05, 0.72, night);
      grade.vignette = lerp(0.3, 0.4, night);
    }
    return env;
  }

  get label() {
    const h = this.hour;
    if (h < 4.5) return '深夜';
    if (h < 6.5) return '夜明け';
    if (h < 10) return '朝';
    if (h < 15) return '昼';
    if (h < 17.5) return '午後';
    if (h < 19.5) return '夕暮れ';
    if (h < 21.5) return '宵';
    return '夜';
  }

  get clock() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
