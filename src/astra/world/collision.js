/**
 * 当たり判定。
 *
 * 建物・木・小物は「上から見た形」（回転する箱か円）で持つ。
 * 高さ方向は地形に任せているので、押し出しは 2D で足りる。
 * 広い町でも速いように、格子（ブロードフェーズ）へ登録してから調べる。
 */

const CELL = 6;

export class CollisionWorld {
  constructor(terrain) {
    this.terrain = terrain;
    this.colliders = [];
    this.grid = new Map();
  }

  _key(cx, cz) { return `${cx},${cz}`; }

  _insert(index, minX, minZ, maxX, maxZ) {
    const x0 = Math.floor(minX / CELL), x1 = Math.floor(maxX / CELL);
    const z0 = Math.floor(minZ / CELL), z1 = Math.floor(maxZ / CELL);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = this._key(cx, cz);
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(index);
      }
    }
  }

  /** 回転できる箱。 */
  addBox(x, z, w, d, rot = 0, opts = {}) {
    const c = { type: 'box', x, z, w, d, rot, cos: Math.cos(rot), sin: Math.sin(rot),
      height: opts.height || 4, tag: opts.tag };
    const i = this.colliders.length;
    this.colliders.push(c);
    const r = Math.hypot(w, d) * 0.5 + 0.5;
    this._insert(i, x - r, z - r, x + r, z + r);
    return c;
  }

  /** 円柱（木・樽・人）。 */
  addCircle(x, z, radius, opts = {}) {
    const c = { type: 'circle', x, z, r: radius, height: opts.height || 3, tag: opts.tag };
    const i = this.colliders.length;
    this.colliders.push(c);
    this._insert(i, x - radius, z - radius, x + radius, z + radius);
    return c;
  }

  /** 見えない壁（町の外へ出さない）。 */
  addWallLoop(points, thickness = 1.2) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      this.addBox((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len, thickness,
        Math.atan2(dx, dz), { height: 12, tag: 'boundary' });
    }
  }

  _nearby(x, z, radius, out) {
    out.length = 0;
    const x0 = Math.floor((x - radius) / CELL), x1 = Math.floor((x + radius) / CELL);
    const z0 = Math.floor((z - radius) / CELL), z1 = Math.floor((z + radius) / CELL);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.grid.get(this._key(cx, cz));
        if (!arr) continue;
        for (const i of arr) {
          if (seen.has(i)) continue;
          seen.add(i);
          out.push(this.colliders[i]);
        }
      }
    }
    return out;
  }

  /** その場所が塞がっているか（草や小物を置かない判定に使う）。 */
  isBlocked(x, z, radius = 0.3) {
    const list = this._nearby(x, z, radius + 0.1, this._tmpA || (this._tmpA = []));
    for (const c of list) {
      if (c.tag === 'boundary') continue;
      if (c.type === 'circle') {
        if (Math.hypot(x - c.x, z - c.z) < c.r + radius) return true;
      } else {
        const dx = x - c.x, dz = z - c.z;
        const lx = dx * c.cos - dz * c.sin;
        const lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.w / 2 + radius && Math.abs(lz) < c.d / 2 + radius) return true;
      }
    }
    return false;
  }

  /**
   * 半径 radius の円を (x,z) から押し出す。
   * 返り値は補正後の座標。壁ずりも自然に効く。
   */
  resolve(x, z, radius) {
    const list = this._nearby(x, z, radius + 1.2, this._tmpB || (this._tmpB = []));
    let px = x, pz = z;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of list) {
        if (c.type === 'circle') {
          const dx = px - c.x, dz = pz - c.z;
          const d = Math.hypot(dx, dz);
          const min = c.r + radius;
          if (d < min && d > 1e-5) {
            px = c.x + (dx / d) * min;
            pz = c.z + (dz / d) * min;
            moved = true;
          } else if (d <= 1e-5) {
            px = c.x + min; moved = true;
          }
        } else {
          const dx = px - c.x, dz = pz - c.z;
          const lx = dx * c.cos - dz * c.sin;
          const lz = dx * c.sin + dz * c.cos;
          const hw = c.w / 2 + radius, hd = c.d / 2 + radius;
          if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
            // はみ出しが小さい軸へ押し出す
            const ox = hw - Math.abs(lx);
            const oz = hd - Math.abs(lz);
            let nlx = lx, nlz = lz;
            if (ox < oz) nlx = Math.sign(lx || 1) * hw;
            else nlz = Math.sign(lz || 1) * hd;
            px = c.x + nlx * c.cos + nlz * c.sin;
            pz = c.z - nlx * c.sin + nlz * c.cos;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return [px, pz];
  }

  /**
   * カメラ用の掃引。from から to へ向かって、
   * ぶつかるまでの割合（0..1）を返す。地形にも潜らせない。
   */
  probe(from, to, radius) {
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from[0] + (to[0] - from[0]) * t;
      const y = from[1] + (to[1] - from[1]) * t;
      const z = from[2] + (to[2] - from[2]) * t;
      if (this.terrain && y < this.terrain.height(x, z) + radius + 0.25) return Math.max(0, (i - 1) / steps);
      const list = this._nearby(x, z, radius, this._tmpC || (this._tmpC = []));
      for (const c of list) {
        const top = (this.terrain ? this.terrain.height(c.x, c.z) : 0) + c.height;
        if (y > top) continue;
        if (c.type === 'circle') {
          if (Math.hypot(x - c.x, z - c.z) < c.r + radius) return Math.max(0, (i - 1) / steps);
        } else {
          const dx = x - c.x, dz = z - c.z;
          const lx = dx * c.cos - dz * c.sin;
          const lz = dx * c.sin + dz * c.cos;
          if (Math.abs(lx) < c.w / 2 + radius && Math.abs(lz) < c.d / 2 + radius) {
            return Math.max(0, (i - 1) / steps);
          }
        }
      }
    }
    return 1;
  }
}
