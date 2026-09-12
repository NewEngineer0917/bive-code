/**
 * 粒子システム。
 *
 * 使い回し（プーリング）前提で、確保済み配列の中だけで生き死にさせる。
 * 描画はインスタンス化したビルボード 1 枚で、加算合成と通常合成を
 * それぞれ 1 ドローにまとめる。
 *
 * 町では埃・花粉・蝶・落ち葉・噴水のしぶき・Nova の光に、
 * 戦闘では炎・水・雷・衝撃波に使う。
 */

export const KIND = {
  GLOW: 0,     // 柔らかい光の玉
  SMOKE: 1,    // 煙・塵
  EMBER: 2,    // 火の粉（芯が強い）
  PETAL: 3,    // 花びら・葉
  RING: 4,     // 輪・衝撃波
};

const INSTANCE_FLOATS = 12;   // posSize(4) + color(4) + params(4)

export class ParticleSystem {
  constructor(gl, max = 3000) {
    this.max = max;
    this.count = 0;
    // Structure of Arrays にして GC を避ける
    this.px = new Float32Array(max); this.py = new Float32Array(max); this.pz = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max); this.vz = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max); this.sizeEnd = new Float32Array(max);
    this.r = new Float32Array(max); this.g = new Float32Array(max); this.b = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.kind = new Float32Array(max);
    this.spin = new Float32Array(max); this.rot = new Float32Array(max);
    this.gravity = new Float32Array(max); this.drag = new Float32Array(max);
    this.glow = new Float32Array(max);
    this.windWeight = new Float32Array(max);
    this.additive = new Uint8Array(max);
    this.fadeIn = new Float32Array(max);

    this.addData = new Float32Array(max * INSTANCE_FLOATS);
    this.alphaData = new Float32Array(max * INSTANCE_FLOATS);
    this.addCount = 0;
    this.alphaCount = 0;
    this.wind = { x: 0.8, z: 0.6, strength: 0.5 };

    if (gl) this._initGL(gl);
  }

  _initGL(gl) {
    const quad = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
    const make = () => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const qbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, qbo);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ARRAY_BUFFER, this.max * INSTANCE_FLOATS * 4, gl.DYNAMIC_DRAW);
      const stride = INSTANCE_FLOATS * 4;
      for (const [loc, off] of [[1, 0], [2, 16], [3, 32]]) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, off);
        gl.vertexAttribDivisor(loc, 1);
      }
      gl.bindVertexArray(null);
      return { vao, qbo, ibo };
    };
    this.glAdd = make();
    this.glAlpha = make();
  }

  /** 1 個生成。あふれたら一番寿命が短いものを置き換える。 */
  spawn(o) {
    let i;
    if (this.count < this.max) {
      i = this.count++;
    } else {
      i = 0;
      let worst = Infinity;
      for (let k = 0; k < this.max; k += 7) {
        if (this.life[k] < worst) { worst = this.life[k]; i = k; }
      }
    }
    this.px[i] = o.x; this.py[i] = o.y; this.pz[i] = o.z;
    this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0; this.vz[i] = o.vz || 0;
    const life = o.life === undefined ? 1 : o.life;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = o.size === undefined ? 0.2 : o.size;
    this.sizeEnd[i] = o.sizeEnd === undefined ? this.size[i] : o.sizeEnd;
    const c = o.color || [1, 1, 1];
    this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2];
    this.alpha[i] = o.alpha === undefined ? 1 : o.alpha;
    this.kind[i] = o.kind === undefined ? KIND.GLOW : o.kind;
    this.spin[i] = o.spin || 0;
    this.rot[i] = o.rot || Math.random() * Math.PI * 2;
    this.gravity[i] = o.gravity === undefined ? 0 : o.gravity;
    this.drag[i] = o.drag === undefined ? 0.6 : o.drag;
    this.glow[i] = o.glow === undefined ? 0 : o.glow;
    this.windWeight[i] = o.wind === undefined ? 0 : o.wind;
    this.additive[i] = o.additive === false ? 0 : 1;
    this.fadeIn[i] = o.fadeIn === undefined ? 0.1 : o.fadeIn;
    return i;
  }

  /** 円錐状にまとめて撒く（爆発・噴出）。 */
  burst(o) {
    const n = o.count || 12;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const spread = o.spread === undefined ? 1 : o.spread;
      const up = (o.dir ? o.dir : [0, 1, 0]);
      const s = Math.random() * spread;
      const speed = (o.speed || 2) * (0.5 + Math.random() * 0.9);
      // 方向ベクトルの周りに散らす簡易版
      const tx = Math.cos(a) * s, tz = Math.sin(a) * s;
      const vx = up[0] * speed + tx * speed;
      const vy = up[1] * speed + (Math.random() - 0.3) * speed * spread * 0.7;
      const vz = up[2] * speed + tz * speed;
      const jitter = o.jitter || 0;
      this.spawn({
        ...o,
        x: o.x + (Math.random() - 0.5) * jitter,
        y: o.y + (Math.random() - 0.5) * jitter,
        z: o.z + (Math.random() - 0.5) * jitter,
        vx, vy, vz,
        size: (o.size || 0.2) * (0.6 + Math.random() * 0.8),
        life: (o.life || 1) * (0.6 + Math.random() * 0.7),
        rot: Math.random() * Math.PI * 2,
      });
    }
  }

  update(dt, time = 0) {
    const w = this.wind;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      let l = this.life[i] - dt;
      if (l <= 0) {
        // 末尾と入れ替えて詰める
        n--;
        if (i !== n) this._copy(n, i);
        this.count = n;
        i--;
        continue;
      }
      this.life[i] = l;
      const drag = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= drag; this.vy[i] *= drag; this.vz[i] *= drag;
      this.vy[i] += this.gravity[i] * dt;
      const ww = this.windWeight[i];
      if (ww > 0) {
        const gust = 0.6 + 0.4 * Math.sin(time * 0.7 + this.px[i] * 0.2 + this.pz[i] * 0.15);
        this.vx[i] += w.x * w.strength * ww * gust * dt * 2.2;
        this.vz[i] += w.z * w.strength * ww * gust * dt * 2.2;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
  }

  _copy(from, to) {
    const fields = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 'size', 'sizeEnd',
      'r', 'g', 'b', 'alpha', 'kind', 'spin', 'rot', 'gravity', 'drag', 'glow',
      'windWeight', 'additive', 'fadeIn'];
    for (const f of fields) this[f][to] = this[f][from];
  }

  /** GPU へ書き込み、描画数を返す。 */
  upload(gl) {
    let a = 0, b = 0;
    for (let i = 0; i < this.count; i++) {
      const t = 1 - this.life[i] / this.maxLife[i];   // 0=生成直後 1=消滅
      let alpha = this.alpha[i];
      // 出はじめのフェードインと、終わりのフェードアウト
      const fi = this.fadeIn[i];
      if (fi > 0 && t < fi) alpha *= t / fi;
      alpha *= 1 - t * t;
      if (alpha <= 0.004) continue;
      const size = this.size[i] + (this.sizeEnd[i] - this.size[i]) * t;
      const dst = this.additive[i] ? this.addData : this.alphaData;
      const idx = (this.additive[i] ? a++ : b++) * INSTANCE_FLOATS;
      dst[idx] = this.px[i]; dst[idx + 1] = this.py[i]; dst[idx + 2] = this.pz[i]; dst[idx + 3] = size;
      dst[idx + 4] = this.r[i]; dst[idx + 5] = this.g[i]; dst[idx + 6] = this.b[i]; dst[idx + 7] = alpha;
      dst[idx + 8] = this.rot[i]; dst[idx + 9] = this.kind[i]; dst[idx + 10] = this.glow[i]; dst[idx + 11] = 0;
    }
    this.addCount = a;
    this.alphaCount = b;
    if (a) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.glAdd.ibo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.addData, 0, a * INSTANCE_FLOATS);
    }
    if (b) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.glAlpha.ibo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.alphaData, 0, b * INSTANCE_FLOATS);
    }
    return a + b;
  }

  draw(gl) {
    if (this.alphaCount) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.glAlpha.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.alphaCount);
    }
    if (this.addCount) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindVertexArray(this.glAdd.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.addCount);
    }
    gl.bindVertexArray(null);
  }

  clear() { this.count = 0; }
}
