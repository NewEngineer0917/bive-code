/**
 * テクスチャ合成用のノイズ。
 * 決定的（シード固定で毎回同じ絵）なので、見た目の調整が再現できる。
 */

/** 32bit の整数ハッシュ。 */
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

export function hash3(x, y, z, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + z * 1103515245 + seed * 97) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** タイル状に繋がる値ノイズ（period でループする）。 */
export function valueNoise(x, y, period, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const wrap = (v) => ((v % period) + period) % period;
  const x0 = wrap(xi), x1 = wrap(xi + 1);
  const y0 = wrap(yi), y1 = wrap(yi + 1);
  const u = fade(xf), v = fade(yf);
  const n00 = hash2(x0, y0, seed), n10 = hash2(x1, y0, seed);
  const n01 = hash2(x0, y1, seed), n11 = hash2(x1, y1, seed);
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}

/** 多重周波数の値ノイズ。 */
export function fbm(x, y, octaves, period, seed = 0, gain = 0.5, lacunarity = 2) {
  let sum = 0, amp = 1, norm = 0, p = period, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, p, seed + i * 17) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
    p *= lacunarity;
  }
  return sum / norm;
}

/** 稜線ノイズ。岩や雲の筋に使う。 */
export function ridged(x, y, octaves, period, seed = 0) {
  let sum = 0, amp = 1, norm = 0, freq = 1, p = period;
  for (let i = 0; i < octaves; i++) {
    const n = Math.abs(valueNoise(x * freq, y * freq, p, seed + i * 31) * 2 - 1);
    sum += (1 - n) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2; p *= 2;
  }
  return sum / norm;
}

/** セル（ボロノイ）ノイズ。石畳・鱗・結晶に使う。 */
export function worley(x, y, period, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 9, second = 9;
  let bx = 0, by = 0;
  const wrap = (v) => ((v % period) + period) % period;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const px = cx + hash2(wrap(cx), wrap(cy), seed);
      const py = cy + hash2(wrap(cx), wrap(cy), seed + 991);
      const d = Math.hypot(px - x, py - y);
      if (d < best) { second = best; best = d; bx = wrap(cx); by = wrap(cy); }
      else if (d < second) second = d;
    }
  }
  return { d1: best, d2: second, edge: second - best, cellX: bx, cellY: by };
}

/** 0..1 を返すユーティリティ。 */
export const sat = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => {
  const t = sat((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
