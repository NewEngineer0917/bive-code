/**
 * 街のマテリアルを手続き生成する。
 *
 * 各マテリアルは「色（アルベド）」と「高さ」を描き、高さから法線マップを作る。
 * アルベドのアルファは「自発光マスク」として使い、夜のビルの窓を光らせる。
 * 法線マップのアルファには粗さ（ラフネス）を入れている。
 */

export const MAT_SIZE = 256;

export const MATERIALS = {
  FACADE_CONCRETE: 0,
  FACADE_GLASS: 1,
  FACADE_BRICK: 2,
  ROAD: 3,
  SIDEWALK: 4,
  ROOF: 5,
  SHUTTER: 6,
  CONCRETE: 7,
};

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
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = -dy * strength;
      const len = Math.hypot(nx, ny, 1) || 1;
      nx /= len;
      ny /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      const h = height[y * size + x];
      data[i + 3] = Math.max(0, Math.min(255, (roughness + (h - 0.5) * roughVariation) * 255));
    }
  }
  return new ImageData(data, size, size);
}

/** キャンバスから ImageData を取り出し、アルファ（自発光マスク）を差し替える。 */
function toImageData(canvas, emissiveCanvas) {
  const size = canvas.width;
  const img = canvas.getContext('2d').getImageData(0, 0, size, size);
  const mask = emissiveCanvas
    ? emissiveCanvas.getContext('2d').getImageData(0, 0, size, size)
    : null;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // マスクの明るさを自発光量としてアルファに入れる（無い場合は 0）
    d[i + 3] = mask ? mask.data[i] : 0;
  }
  return img;
}

/* ------------------------------ ビルの外壁 ------------------------------ */

/**
 * 窓の並んだビル外壁を作る。
 * cols × rows の窓を描き、一部だけ明かりが点いている状態にする。
 */
function facade(size, rnd, opts) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const emissive = canvasOf(size, size);
  const eg = emissive.getContext('2d');
  const height = new Float32Array(size * size);
  const grime = fbm(size, rnd, 4, 3);

  eg.fillStyle = '#000';
  eg.fillRect(0, 0, size, size);

  // 壁面のベース
  g.fillStyle = opts.wall;
  g.fillRect(0, 0, size, size);
  if (opts.bands) {
    g.fillStyle = opts.band;
    for (let r = 0; r < opts.rows; r++) {
      const y = (r / opts.rows) * size;
      g.fillRect(0, y + size / opts.rows - 10, size, 10);   // 階の帯（スラブ）
    }
  }

  const cw = size / opts.cols;
  const ch = size / opts.rows;
  for (let r = 0; r < opts.rows; r++) {
    for (let col = 0; col < opts.cols; col++) {
      const x = col * cw + cw * opts.inset;
      const y = r * ch + ch * opts.inset;
      const w = cw * (1 - opts.inset * 2);
      const h = ch * (1 - opts.inset * 2) * opts.aspect;

      const lit = rnd() < opts.litRatio;
      if (lit) {
        const warm = rnd() < 0.7;
        const cr = warm ? 255 : 190;
        const cg = warm ? 224 : 226;
        const cb = warm ? 168 : 255;
        g.fillStyle = `rgb(${cr},${cg},${cb})`;
        g.fillRect(x, y, w, h);
        // 明かりの強さにばらつきを付ける
        const level = 150 + ((rnd() * 105) | 0);
        eg.fillStyle = `rgb(${level},${level},${level})`;
        eg.fillRect(x, y, w, h);
      } else {
        g.fillStyle = opts.glass;
        g.fillRect(x, y, w, h);
        // 消えている窓にも空の映り込みを少し
        g.fillStyle = 'rgba(120,150,190,0.18)';
        g.fillRect(x, y, w, h * 0.35);
      }
      // 窓枠
      g.strokeStyle = opts.frame;
      g.lineWidth = 2;
      g.strokeRect(x, y, w, h);

      for (let yy = Math.floor(y); yy < y + h; yy++) {
        for (let xx = Math.floor(x); xx < x + w; xx++) {
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          height[yy * size + xx] = 0.25; // 窓は少し奥まっている
        }
      }
    }
  }

  const img = toImageData(c, emissive);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = grime[y * size + x];
      const dirt = 0.82 + n * 0.3;
      // 窓（自発光あり）は汚さない
      if (d[i + 3] < 30) {
        d[i] *= dirt;
        d[i + 1] *= dirt;
        d[i + 2] *= dirt;
        if (!height[y * size + x]) height[y * size + x] = 0.72 + n * 0.2;
      }
    }
  }
  return { albedo: img, normal: normalFromHeight(height, size, opts.relief, opts.rough, 0.15) };
}

/* -------------------------------- 路面など -------------------------------- */

function road(size, rnd) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const grain = fbm(size, rnd, 5, 9);
  const patch = fbm(size, rnd, 3, 2);
  const height = new Float32Array(size * size);

  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = grain[y * size + x];
      const p = patch[y * size + x];
      const base = 36 + n * 28 + p * 10;
      d[i] = base;
      d[i + 1] = base * 1.02;
      d[i + 2] = base * 1.08;
      d[i + 3] = 255;
      height[y * size + x] = 0.5 + (n - 0.5) * 0.8;
    }
  }
  g.putImageData(img, 0, 0);

  // 白線（破線）とひび割れ
  g.fillStyle = 'rgba(226,226,214,0.85)';
  g.fillRect(size / 2 - 4, 20, 8, size * 0.28);
  g.fillRect(size / 2 - 4, size * 0.58, 8, size * 0.28);
  g.strokeStyle = 'rgba(18,18,22,0.7)';
  for (let i = 0; i < 4; i++) {
    let x = rnd() * size;
    let y = rnd() * size;
    g.lineWidth = 1 + rnd();
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 10; k++) {
      x += (rnd() - 0.5) * 30;
      y += (rnd() - 0.5) * 30;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return { albedo: toImageData(c), normal: normalFromHeight(height, size, 1.6, 0.78, 0.2) };
}

function sidewalk(size, rnd) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const grain = fbm(size, rnd, 4, 8);
  const height = new Float32Array(size * size);

  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = grain[y * size + x];
      const base = 96 + n * 46;
      d[i] = base;
      d[i + 1] = base * 0.99;
      d[i + 2] = base * 0.96;
      d[i + 3] = 255;
      height[y * size + x] = 0.62 + (n - 0.5) * 0.4;
    }
  }
  g.putImageData(img, 0, 0);

  // 敷石の目地
  g.strokeStyle = 'rgba(40,40,44,0.6)';
  g.lineWidth = 3;
  for (let i = 1; i < 4; i++) {
    g.beginPath();
    g.moveTo((i * size) / 4, 0);
    g.lineTo((i * size) / 4, size);
    g.moveTo(0, (i * size) / 4);
    g.lineTo(size, (i * size) / 4);
    g.stroke();
    for (let k = 0; k < size; k++) {
      const p = Math.round((i * size) / 4);
      for (let o = -1; o <= 1; o++) {
        height[k * size + Math.min(size - 1, Math.max(0, p + o))] = 0.2;
        height[Math.min(size - 1, Math.max(0, p + o)) * size + k] = 0.2;
      }
    }
  }
  return { albedo: toImageData(c), normal: normalFromHeight(height, size, 2, 0.85, 0.15) };
}

function roof(size, rnd) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const grain = fbm(size, rnd, 5, 12);
  const height = new Float32Array(size * size);
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = grain[y * size + x];
      const base = 52 + n * 40;
      d[i] = base;
      d[i + 1] = base;
      d[i + 2] = base * 1.05;
      d[i + 3] = 255;
      height[y * size + x] = 0.5 + (n - 0.5) * 1;
    }
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#3a3f4a';
  g.fillRect(40, 40, 70, 50);   // 空調機
  g.fillStyle = '#4a505c';
  g.fillRect(46, 46, 58, 12);
  g.fillStyle = '#2e323c';
  g.fillRect(160, 150, 46, 46);
  return { albedo: toImageData(c), normal: normalFromHeight(height, size, 2.2, 0.9, 0.1) };
}

function shutter(size, rnd) {
  const c = canvasOf(size, size);
  const g = c.getContext('2d');
  const height = new Float32Array(size * size);
  g.fillStyle = '#2b2f38';
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 12) {
    g.fillStyle = y % 24 === 0 ? '#3a404c' : '#333844';
    g.fillRect(0, y, size, 10);
    for (let k = 0; k < size; k++) {
      for (let o = 0; o < 10; o++) height[Math.min(size - 1, y + o) * size + k] = o < 5 ? 0.7 : 0.35;
    }
  }
  const grain = fbm(size, rnd, 3, 6);
  const img = toImageData(c);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = 0.85 + grain[i / 4] * 0.3;
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
  }
  return { albedo: img, normal: normalFromHeight(height, size, 2.4, 0.5, 0.2) };
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
      const base = 88 + n * 54 - s * 30;
      d[i] = base;
      d[i + 1] = base * 1.01;
      d[i + 2] = base * 1.06;
      d[i + 3] = 255;
      height[y * size + x] = 0.5 + (n - 0.5) * 0.7;
    }
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(30,32,40,0.5)';
  for (let i = 0; i < 4; i++) {
    let x = rnd() * size;
    let y = rnd() * size;
    g.lineWidth = 1 + rnd() * 1.4;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 12; k++) {
      x += (rnd() - 0.5) * 32;
      y += (rnd() - 0.5) * 32;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  return { albedo: toImageData(c), normal: normalFromHeight(height, size, 1.8, 0.9, 0.12) };
}

let cache = null;

/** 全マテリアルを生成（初回のみ）。順序は MATERIALS の値に対応する。 */
export function buildMaterials(size = MAT_SIZE) {
  if (cache) return cache;
  const rnd = rngFrom(20260910);
  cache = [
    facade(size, rnd, {
      wall: '#3c3f47', band: '#4a4e58', bands: true, glass: '#171c26', frame: '#2a2e36',
      cols: 4, rows: 4, inset: 0.16, aspect: 0.72, litRatio: 0.45, relief: 2.4, rough: 0.82,
    }),
    facade(size, rnd, {
      wall: '#1e2836', band: '#2b3849', bands: false, glass: '#101821', frame: '#28323f',
      cols: 5, rows: 5, inset: 0.08, aspect: 0.88, litRatio: 0.5, relief: 1.6, rough: 0.35,
    }),
    facade(size, rnd, {
      wall: '#5a3a30', band: '#6b473a', bands: true, glass: '#141821', frame: '#3a2820',
      cols: 3, rows: 4, inset: 0.2, aspect: 0.7, litRatio: 0.38, relief: 2.8, rough: 0.88,
    }),
    road(size, rnd),
    sidewalk(size, rnd),
    roof(size, rnd),
    shutter(size, rnd),
    concrete(size, rnd),
  ];
  return cache;
}
