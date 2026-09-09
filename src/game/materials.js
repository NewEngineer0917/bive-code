/**
 * 3D 描画用のマテリアルを手続き生成する。
 *
 * 各マテリアルは「色（アルベド）」と「高さ」を描き、高さから法線マップを作る。
 * 法線マップのアルファには粗さ（ラフネス）を入れて 1 枚にまとめている。
 * 画像ファイルを持たずに、レンガの目地の凹み・金属の傷・コンクリートの
 * ざらつきといった質感を表現するのが狙い。
 */

export const MAT_SIZE = 256;

export const MATERIALS = {
  BRICK: 0,
  PANEL: 1,
  CONCRETE: 2,
  HAZARD: 3,
  FLOOR: 4,
  CEILING: 5,
};

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

/** 値ノイズ（滑らかなムラ）。汚れやざらつきの土台に使う。 */
function valueNoise(size, cells, rnd) {
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(size * size);
  const scale = cells / size;
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const gy = y * scale;
    const y0 = Math.floor(gy);
    const fy = smooth(gy - y0);
    for (let x = 0; x < size; x++) {
      const gx = x * scale;
      const x0 = Math.floor(gx);
      const fx = smooth(gx - x0);
      const i00 = grid[y0 * (cells + 1) + x0];
      const i10 = grid[y0 * (cells + 1) + x0 + 1];
      const i01 = grid[(y0 + 1) * (cells + 1) + x0];
      const i11 = grid[(y0 + 1) * (cells + 1) + x0 + 1];
      out[y * size + x] = (i00 * (1 - fx) + i10 * fx) * (1 - fy) + (i01 * (1 - fx) + i11 * fx) * fy;
    }
  }
  return out;
}

/** 複数周波数のノイズを重ねる（フラクタルノイズ）。 */
function fbm(size, rnd, octaves = 4, base = 4) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base * 2 ** o, rnd);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** 高さマップから法線マップを作り、アルファに粗さを入れる。 */
function normalFromHeight(height, size, strength, roughness, roughVariation) {
  const data = new Uint8ClampedArray(size * size * 4);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel フィルタで傾きを求める
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
      const h = height[y * size + x];
      data[i + 3] = Math.max(0, Math.min(255, (roughness + (h - 0.5) * roughVariation) * 255));
    }
  }
  return new ImageData(data, size, size);
}

function toImageData(canvas) {
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
}

/* ------------------------------- 各マテリアル ------------------------------- */

function brick(size, rnd) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const height = new Float32Array(size * size);
  const grime = fbm(size, rnd, 4, 3);

  g.fillStyle = '#3a3330';
  g.fillRect(0, 0, size, size);

  const rows = 8;
  const bh = size / rows;
  const bw = size / 4;
  const mortar = 5;

  for (let row = 0; row < rows; row++) {
    const offset = (row % 2) * (bw / 2);
    for (let col = -1; col < 5; col++) {
      const x = col * bw + offset;
      const y = row * bh;
      const shade = 0.78 + rnd() * 0.42;
      const r = Math.round(150 * shade);
      const gg = Math.round(72 * shade);
      const b = Math.round(58 * shade);
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, bh - mortar);
      // レンガ上端のハイライト
      g.fillStyle = `rgba(255,225,205,0.10)`;
      g.fillRect(x + mortar / 2, y + mortar / 2, bw - mortar, 2);
    }
  }

  // 汚れとムラを重ねる
  const img = toImageData(c);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = grime[y * size + x];
      const dirt = 0.72 + n * 0.5;
      d[i] *= dirt;
      d[i + 1] *= dirt * 0.98;
      d[i + 2] *= dirt * 0.95;
      // 高さ：目地は凹み、レンガ面はわずかに粗い
      const inMortar = d[i] < 70 && d[i + 1] < 70;
      height[y * size + x] = (inMortar ? 0.18 : 0.85) + n * 0.12;
    }
  }
  g.putImageData(img, 0, 0);
  return { albedo: img, normal: normalFromHeight(height, size, 2.6, 0.82, 0.18) };
}

function panel(size, rnd) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const height = new Float32Array(size * size);
  const wear = fbm(size, rnd, 5, 5);

  g.fillStyle = '#20283c';
  g.fillRect(0, 0, size, size);

  // 大きな金属パネル
  const pad = 10;
  for (let i = 0; i < 2; i++) {
    const y = i * (size / 2);
    const grad = g.createLinearGradient(0, y, 0, y + size / 2);
    grad.addColorStop(0, '#4a5878');
    grad.addColorStop(0.5, '#35415c');
    grad.addColorStop(1, '#2a3348');
    g.fillStyle = grad;
    g.fillRect(pad, y + pad, size - pad * 2, size / 2 - pad * 2);
  }

  // リベット
  for (const [x, y] of [[20, 20], [size - 20, 20], [20, size - 20], [size - 20, size - 20], [size / 2, 20], [size / 2, size - 20]]) {
    const rg = g.createRadialGradient(x - 2, y - 2, 1, x, y, 7);
    rg.addColorStop(0, '#9fb0cc');
    rg.addColorStop(1, '#39435c');
    g.fillStyle = rg;
    g.beginPath();
    g.arc(x, y, 6, 0, TAU);
    g.fill();
  }

  // 発光ライン
  g.fillStyle = '#4be0c0';
  g.fillRect(pad + 8, size / 2 - 5, size - pad * 2 - 16, 4);

  // 傷
  g.strokeStyle = 'rgba(180,200,230,0.16)';
  for (let i = 0; i < 26; i++) {
    g.lineWidth = rnd() * 1.6;
    const x = rnd() * size;
    const y = rnd() * size;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 20);
    g.stroke();
  }

  const img = toImageData(c);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = wear[y * size + x];
      const k = 0.85 + n * 0.3;
      d[i] *= k;
      d[i + 1] *= k;
      d[i + 2] *= k;
      const edge = x < pad || x > size - pad || y % (size / 2) < pad || y % (size / 2) > size / 2 - pad;
      height[y * size + x] = (edge ? 0.25 : 0.8) + n * 0.1;
    }
  }
  g.putImageData(img, 0, 0);
  // 金属なので全体につるっとした反射（粗さ低め）
  return { albedo: img, normal: normalFromHeight(height, size, 2.2, 0.42, 0.22) };
}

function concrete(size, rnd) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const grain = fbm(size, rnd, 5, 8);
  const stains = fbm(size, rnd, 3, 2);
  const height = new Float32Array(size * size);

  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = grain[y * size + x];
      const s = stains[y * size + x];
      const base = 108 + n * 60 - s * 34;
      d[i] = base * 1.0;
      d[i + 1] = base * 1.02;
      d[i + 2] = base * 1.08;
      d[i + 3] = 255;
      height[y * size + x] = 0.5 + (n - 0.5) * 0.7;
    }
  }
  g.putImageData(img, 0, 0);

  // ひび割れ
  g.strokeStyle = 'rgba(30,32,40,0.55)';
  for (let i = 0; i < 5; i++) {
    let x = rnd() * size;
    let y = rnd() * size;
    g.lineWidth = 1 + rnd() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 14; k++) {
      x += (rnd() - 0.5) * 34;
      y += (rnd() - 0.5) * 34;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  const out = toImageData(c);
  return { albedo: out, normal: normalFromHeight(height, size, 1.8, 0.9, 0.12) };
}

function hazard(size, rnd) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const height = new Float32Array(size * size);
  const wear = fbm(size, rnd, 4, 6);

  g.fillStyle = '#1b1d26';
  g.fillRect(0, 0, size, size);
  g.save();
  g.beginPath();
  g.rect(0, 0, size, size);
  g.clip();
  g.strokeStyle = '#d6ad2e';
  g.lineWidth = 26;
  for (let i = -size; i < size * 2; i += 64) {
    g.beginPath();
    g.moveTo(i, -10);
    g.lineTo(i + size, size + 10);
    g.stroke();
  }
  g.restore();

  g.fillStyle = '#141720';
  g.fillRect(0, size * 0.42, size, size * 0.16);
  g.fillStyle = '#4be0c0';
  g.fillRect(6, size * 0.47, size - 12, size * 0.05);

  const img = toImageData(c);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = wear[y * size + x];
      const k = 0.7 + n * 0.5;
      d[i] *= k;
      d[i + 1] *= k;
      d[i + 2] *= k;
      height[y * size + x] = 0.5 + (n - 0.5) * 0.5;
    }
  }
  g.putImageData(img, 0, 0);
  return { albedo: img, normal: normalFromHeight(height, size, 1.6, 0.5, 0.3) };
}

function floorMat(size, rnd) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const grain = fbm(size, rnd, 5, 10);
  const patch = fbm(size, rnd, 3, 3);
  const height = new Float32Array(size * size);

  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = grain[y * size + x];
      const p = patch[y * size + x];
      const base = 58 + n * 46 + p * 16;
      d[i] = base;
      d[i + 1] = base * 1.03;
      d[i + 2] = base * 1.12;
      d[i + 3] = 255;
      height[y * size + x] = 0.5 + (n - 0.5) * 0.9;
    }
  }
  g.putImageData(img, 0, 0);

  // 目地（タイルの継ぎ目）
  g.strokeStyle = 'rgba(16,18,26,0.75)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, size / 2);
  g.lineTo(size, size / 2);
  g.moveTo(size / 2, 0);
  g.lineTo(size / 2, size);
  g.stroke();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const near = Math.abs(x - size / 2) < 2 || Math.abs(y - size / 2) < 2;
      if (near) height[y * size + x] = 0.15;
    }
  }

  const out = toImageData(c);
  // 濡れたような弱い反射
  return { albedo: out, normal: normalFromHeight(height, size, 2, 0.62, 0.25) };
}

function ceilingMat(size, rnd) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const grain = fbm(size, rnd, 4, 6);
  const height = new Float32Array(size * size);

  g.fillStyle = '#1a1f2c';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#232a3a';
  g.fillRect(0, 0, size, 26);
  g.fillRect(0, size - 26, size, 26);
  g.fillStyle = '#2c3446';
  for (let i = 0; i < 4; i++) g.fillRect(i * (size / 4) + 8, 30, size / 4 - 16, size - 60);

  const img = toImageData(c);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = grain[y * size + x];
      const k = 0.8 + n * 0.35;
      d[i] *= k;
      d[i + 1] *= k;
      d[i + 2] *= k;
      height[y * size + x] = (y < 28 || y > size - 28 ? 0.8 : 0.4) + n * 0.15;
    }
  }
  g.putImageData(img, 0, 0);
  return { albedo: img, normal: normalFromHeight(height, size, 2, 0.8, 0.15) };
}

let cache = null;

/** 全マテリアルを生成（初回のみ）。順序は MATERIALS の値に対応する。 */
export function buildMaterials(size = MAT_SIZE) {
  if (cache) return cache;
  const rnd = rngFrom(20260909);
  cache = [
    brick(size, rnd),
    panel(size, rnd),
    concrete(size, rnd),
    hazard(size, rnd),
    floorMat(size, rnd),
    ceilingMat(size, rnd),
  ];
  return cache;
}
