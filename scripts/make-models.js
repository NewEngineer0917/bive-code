/**
 * 3D モデルアセット（glTF バイナリ = .glb）を生成するビルドスクリプト。
 *
 *   node scripts/make-models.js   →   public/models/*.glb
 *
 * ここで作るのは「差し替え可能な実ファイル」であることが重要で、
 * Blender などで作った .glb を同じ場所に置けばそのまま読み込まれる。
 * モデルはパーツ（ノード）に分かれており、名前で歩行アニメーションなどを付ける。
 *   leg_l / leg_r / arm_l / arm_r / head / torso …
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'models');

/* ------------------------------ 形状のもと ------------------------------ */

/** 直方体。中心と大きさから 6 面を作る。 */
function box(cx, cy, cz, sx, sy, sz) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const pos = [];
  const nrm = [];
  const faces = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];
  for (const f of faces) {
    const [a, b, c, d] = f.v;
    for (const v of [a, b, c, a, c, d]) {
      pos.push(cx + v[0] * hx, cy + v[1] * hy, cz + v[2] * hz);
      nrm.push(f.n[0], f.n[1], f.n[2]);
    }
  }
  return { pos, nrm };
}

/** 上面と下面の大きさが違う四角錐台（肩や脚のテーパーに使う）。 */
function taper(cx, cy, cz, bottom, top, height, depthBottom, depthTop) {
  const hb = bottom / 2;
  const ht = top / 2;
  const db = (depthBottom || bottom) / 2;
  const dt = (depthTop || top) / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  const pos = [];
  const nrm = [];
  const quad = (a, b, c, d) => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [a, b, c, a, c, d]) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(nx, ny, nz);
    }
  };
  const b00 = [cx - hb, y0, cz - db];
  const b10 = [cx + hb, y0, cz - db];
  const b11 = [cx + hb, y0, cz + db];
  const b01 = [cx - hb, y0, cz + db];
  const t00 = [cx - ht, y1, cz - dt];
  const t10 = [cx + ht, y1, cz - dt];
  const t11 = [cx + ht, y1, cz + dt];
  const t01 = [cx - ht, y1, cz + dt];
  quad(b01, b11, t11, t01);
  quad(b10, b00, t00, t10);
  quad(b11, b10, t10, t11);
  quad(b00, b01, t01, t00);
  quad(t01, t11, t10, t00);
  quad(b00, b10, b11, b01);
  return { pos, nrm };
}

/** 円柱（Y 軸方向）。 */
function cylinder(cx, cy, cz, radius, height, seg = 14, radiusTop) {
  const rt = radiusTop === undefined ? radius : radiusTop;
  const pos = [];
  const nrm = [];
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const p = [
      [cx + c0 * radius, y0, cz + s0 * radius],
      [cx + c1 * radius, y0, cz + s1 * radius],
      [cx + c1 * rt, y1, cz + s1 * rt],
      [cx + c0 * rt, y1, cz + s0 * rt],
    ];
    for (const [v, n] of [[p[0], [c0, 0, s0]], [p[1], [c1, 0, s1]], [p[2], [c1, 0, s1]],
      [p[0], [c0, 0, s0]], [p[2], [c1, 0, s1]], [p[3], [c0, 0, s0]]]) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(n[0], n[1], n[2]);
    }
    // ふた
    pos.push(cx, y1, cz, p[3][0], y1, p[3][2], p[2][0], y1, p[2][2]);
    nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    pos.push(cx, y0, cz, p[1][0], y0, p[1][2], p[0][0], y0, p[0][2]);
    nrm.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
  }
  return { pos, nrm };
}

/** 球（緯度経度）。 */
function sphere(cx, cy, cz, radius, seg = 14, ring = 9, squashY = 1) {
  const pos = [];
  const nrm = [];
  const at = (i, j) => {
    const u = (i / seg) * Math.PI * 2;
    const v = (j / ring) * Math.PI;
    return [Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u)];
  };
  for (let j = 0; j < ring; j++) {
    for (let i = 0; i < seg; i++) {
      const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      for (const v of [q[0], q[1], q[2], q[0], q[2], q[3]]) {
        pos.push(cx + v[0] * radius, cy + v[1] * radius * squashY, cz + v[2] * radius);
        nrm.push(v[0], v[1] / squashY, v[2]);
      }
    }
  }
  return { pos, nrm };
}

function merge(...parts) {
  const pos = [];
  const nrm = [];
  for (const p of parts) {
    pos.push(...p.pos);
    nrm.push(...p.nrm);
  }
  return { pos, nrm };
}

/* ------------------------------ glTF 書き出し ----------------------------- */

/**
 * ノード（パーツ）の配列から .glb を作る。
 * node = { name, origin:[x,y,z], geometry, material:{color, metallic, roughness, emissive} }
 */
function writeGlb(name, nodes) {
  const bin = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];
  const meshes = [];
  const materials = [];
  const gltfNodes = [];

  const pushView = (data, target) => {
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const padded = buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]) : buf;
    bin.push(padded);
    const view = { buffer: 0, byteOffset: offset, byteLength: buf.length };
    if (target) view.target = target;
    bufferViews.push(view);
    offset += padded.length;
    return bufferViews.length - 1;
  };

  nodes.forEach((node) => {
    const g = node.geometry;
    const count = g.pos.length / 3;
    const positions = new Float32Array(g.pos);
    const normals = new Float32Array(g.nrm);

    // 位置の最小・最大（glTF の必須項目）
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], positions[i * 3 + k]);
        max[k] = Math.max(max[k], positions[i * 3 + k]);
      }
    }

    const posView = pushView(positions, 34962);
    accessors.push({
      bufferView: posView, componentType: 5126, count, type: 'VEC3', min, max,
    });
    const posAcc = accessors.length - 1;

    const nrmView = pushView(normals, 34962);
    accessors.push({ bufferView: nrmView, componentType: 5126, count, type: 'VEC3' });
    const nrmAcc = accessors.length - 1;

    const m = node.material || {};
    materials.push({
      name: node.name + '_mat',
      pbrMetallicRoughness: {
        baseColorFactor: [...(m.color || [0.6, 0.6, 0.6]), 1],
        metallicFactor: m.metallic === undefined ? 0.2 : m.metallic,
        roughnessFactor: m.roughness === undefined ? 0.7 : m.roughness,
      },
      emissiveFactor: m.emissive || [0, 0, 0],
    });

    meshes.push({
      name: node.name,
      primitives: [{
        attributes: { POSITION: posAcc, NORMAL: nrmAcc },
        material: materials.length - 1,
      }],
    });

    gltfNodes.push({
      name: node.name,
      mesh: meshes.length - 1,
      translation: node.origin || [0, 0, 0],
    });
  });

  const binBuffer = Buffer.concat(bin);
  const gltf = {
    asset: { version: '2.0', generator: 'blaster-zone make-models.js' },
    scene: 0,
    scenes: [{ nodes: gltfNodes.map((_, i) => i) }],
    nodes: gltfNodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binBuffer.length }],
  };

  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);

  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binBuffer.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.write('JSON', 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuffer.length, 0);
  binHeader.write('BIN\0', 4);

  const glb = Buffer.concat([header, jsonHeader, json, binHeader, binBuffer]);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name + '.glb'), glb);
  return glb.length;
}

/* -------------------------------- モデル -------------------------------- */

const METAL_DARK = { color: [0.09, 0.095, 0.115], metallic: 0.75, roughness: 0.42 };
const METAL_MID = { color: [0.17, 0.18, 0.21], metallic: 0.7, roughness: 0.45 };
const RUBBER = { color: [0.035, 0.035, 0.04], metallic: 0.05, roughness: 0.95 };
const GLASS = { color: [0.05, 0.09, 0.14], metallic: 0.6, roughness: 0.15 };

/** 人型の敵（ガンナー）。歩行させるため脚と腕を別ノードにする。 */
function gunnerModel() {
  const suit = { color: [0.13, 0.11, 0.2], metallic: 0.35, roughness: 0.6 };
  const armor = { color: [0.2, 0.19, 0.28], metallic: 0.6, roughness: 0.42 };
  return [
    {
      name: 'torso',
      origin: [0, 1.02, 0],
      geometry: merge(
        taper(0, 0.12, 0, 0.42, 0.5, 0.46, 0.26, 0.3),       // 胴
        box(0, -0.16, 0, 0.36, 0.2, 0.22),                    // 腰
        taper(0, 0.34, 0, 0.5, 0.34, 0.12, 0.3, 0.24),        // 肩
      ),
      material: suit,
    },
    {
      name: 'head',
      origin: [0, 1.52, 0],
      geometry: merge(
        sphere(0, 0, 0, 0.13, 12, 8, 1.15),
        box(0, 0.02, 0.11, 0.16, 0.06, 0.04),
      ),
      material: armor,
    },
    {
      name: 'visor',
      origin: [0, 1.53, 0.11],
      geometry: box(0, 0, 0, 0.14, 0.035, 0.03),
      material: { color: [1, 0.35, 0.25], metallic: 0.1, roughness: 0.2, emissive: [1.6, 0.35, 0.2] },
    },
    {
      name: 'arm_l',
      origin: [-0.29, 1.18, 0],
      geometry: merge(cylinder(0, -0.16, 0, 0.07, 0.34, 10, 0.06), sphere(0, 0.02, 0, 0.09, 10, 7)),
      material: armor,
    },
    {
      name: 'arm_r',
      origin: [0.29, 1.18, 0],
      geometry: merge(
        cylinder(0, -0.16, 0, 0.07, 0.34, 10, 0.06),
        sphere(0, 0.02, 0, 0.09, 10, 7),
        box(0, -0.3, 0.16, 0.1, 0.1, 0.34),                   // 腕に付いた砲
      ),
      material: armor,
    },
    {
      name: 'muzzle',
      origin: [0.29, 0.9, 0.34],
      geometry: cylinder(0, 0, 0, 0.045, 0.06, 10),
      material: { color: [0.6, 0.9, 1], metallic: 0.1, roughness: 0.2, emissive: [0.5, 1.4, 1.8] },
    },
    {
      name: 'leg_l',
      origin: [-0.12, 0.42, 0],
      geometry: merge(
        taper(0, 0, 0, 0.16, 0.13, 0.42, 0.18, 0.15),
        box(0, -0.24, 0.04, 0.15, 0.08, 0.26),                // 足
      ),
      material: suit,
    },
    {
      name: 'leg_r',
      origin: [0.12, 0.42, 0],
      geometry: merge(
        taper(0, 0, 0, 0.16, 0.13, 0.42, 0.18, 0.15),
        box(0, -0.24, 0.04, 0.15, 0.08, 0.26),
      ),
      material: suit,
    },
  ];
}

/** 重装型の敵（ブルート）。 */
function bruteModel() {
  const plate = { color: [0.1, 0.16, 0.11], metallic: 0.55, roughness: 0.5 };
  const trim = { color: [0.22, 0.3, 0.22], metallic: 0.65, roughness: 0.4 };
  return [
    {
      name: 'torso',
      origin: [0, 1.42, 0],
      geometry: merge(
        taper(0, 0, 0, 0.78, 0.9, 0.72, 0.5, 0.56),
        box(0, -0.46, 0, 0.6, 0.3, 0.42),
        taper(0, 0.44, 0, 0.9, 0.6, 0.2, 0.56, 0.4),
      ),
      material: plate,
    },
    {
      name: 'head',
      origin: [0, 2.0, 0.02],
      geometry: merge(box(0, 0, 0, 0.3, 0.24, 0.3), box(0, 0.14, 0, 0.34, 0.06, 0.34)),
      material: trim,
    },
    {
      name: 'visor',
      origin: [0, 2.0, 0.16],
      geometry: box(0, 0, 0, 0.22, 0.05, 0.03),
      material: { color: [1, 0.8, 0.2], metallic: 0.1, roughness: 0.2, emissive: [2, 1.3, 0.2] },
    },
    {
      name: 'arm_l',
      origin: [-0.56, 1.5, 0],
      geometry: merge(cylinder(0, -0.2, 0, 0.13, 0.5, 10, 0.11), sphere(0, 0.08, 0, 0.17, 10, 7)),
      material: trim,
    },
    {
      name: 'arm_r',
      origin: [0.56, 1.5, 0],
      geometry: merge(cylinder(0, -0.2, 0, 0.13, 0.5, 10, 0.11), sphere(0, 0.08, 0, 0.17, 10, 7)),
      material: trim,
    },
    {
      name: 'leg_l',
      origin: [-0.22, 0.55, 0],
      geometry: merge(taper(0, 0, 0, 0.26, 0.22, 0.6, 0.28, 0.24), box(0, -0.34, 0.06, 0.26, 0.12, 0.36)),
      material: plate,
    },
    {
      name: 'leg_r',
      origin: [0.22, 0.55, 0],
      geometry: merge(taper(0, 0, 0, 0.26, 0.22, 0.6, 0.28, 0.24), box(0, -0.34, 0.06, 0.26, 0.12, 0.36)),
      material: plate,
    },
  ];
}

/** 浮遊型の敵（ドローン）。 */
function droneModel() {
  const shell = { color: [0.28, 0.06, 0.08], metallic: 0.5, roughness: 0.35 };
  return [
    {
      name: 'body',
      origin: [0, 0, 0],
      geometry: merge(sphere(0, 0, 0, 0.3, 16, 10, 0.72), cylinder(0, -0.16, 0, 0.16, 0.1, 12)),
      material: shell,
    },
    {
      name: 'ring',
      origin: [0, 0, 0],
      geometry: merge(
        box(-0.36, 0.02, 0, 0.3, 0.05, 0.12),
        box(0.36, 0.02, 0, 0.3, 0.05, 0.12),
        box(0, 0.02, -0.36, 0.12, 0.05, 0.3),
        box(0, 0.02, 0.36, 0.12, 0.05, 0.3),
      ),
      material: METAL_DARK,
    },
    {
      name: 'eye',
      origin: [0, 0, 0.26],
      geometry: sphere(0, 0, 0, 0.1, 12, 8),
      material: { color: [1, 0.3, 0.2], metallic: 0.1, roughness: 0.2, emissive: [2.4, 0.5, 0.25] },
    },
    {
      name: 'thruster',
      origin: [0, -0.22, 0],
      geometry: cylinder(0, 0, 0, 0.1, 0.06, 10),
      material: { color: [0.5, 0.8, 1], metallic: 0, roughness: 0.3, emissive: [0.6, 1.4, 2.2] },
    },
  ];
}

/** 路上に停まっている車。 */
function carModel(color, kind) {
  const body = { color, metallic: 0.55, roughness: 0.32 };
  const isVan = kind === 'van';
  const len = isVan ? 4.6 : 4.2;
  const height = isVan ? 1.1 : 0.62;
  const roofLen = isVan ? 3.0 : 2.0;
  return [
    {
      name: 'body',
      origin: [0, 0.62, 0],
      geometry: merge(
        taper(0, 0, 0, 1.8, 1.72, height, len, len - 0.3),
        box(0, -height / 2 - 0.08, 0, 1.7, 0.16, len - 0.5),
      ),
      material: body,
    },
    {
      name: 'cabin',
      origin: [0, 0.62 + height / 2 + (isVan ? 0.5 : 0.34), isVan ? -0.2 : -0.15],
      geometry: taper(0, 0, 0, 1.66, isVan ? 1.6 : 1.3, isVan ? 1.0 : 0.68, roofLen, roofLen - 0.6),
      material: GLASS,
    },
    {
      name: 'roof',
      origin: [0, 0.62 + height / 2 + (isVan ? 1.0 : 0.7), isVan ? -0.2 : -0.15],
      geometry: box(0, 0, 0, 1.6, 0.08, roofLen - 0.5),
      material: body,
    },
    {
      name: 'lights',
      origin: [0, 0.62, len / 2 - 0.05],
      geometry: merge(box(-0.62, 0, 0, 0.34, 0.16, 0.08), box(0.62, 0, 0, 0.34, 0.16, 0.08)),
      material: { color: [1, 0.95, 0.85], metallic: 0.1, roughness: 0.2, emissive: [1.2, 1.1, 0.9] },
    },
    {
      name: 'tail',
      origin: [0, 0.62, -len / 2 + 0.05],
      geometry: merge(box(-0.6, 0, 0, 0.3, 0.14, 0.08), box(0.6, 0, 0, 0.3, 0.14, 0.08)),
      material: { color: [0.8, 0.1, 0.1], metallic: 0.1, roughness: 0.3, emissive: [0.9, 0.05, 0.05] },
    },
    {
      name: 'wheels',
      origin: [0, 0.34, 0],
      geometry: merge(
        cylinder(-0.9, 0, len / 2 - 1.1, 0.34, 0.26, 12),
        cylinder(0.9, 0, len / 2 - 1.1, 0.34, 0.26, 12),
        cylinder(-0.9, 0, -len / 2 + 1.1, 0.34, 0.26, 12),
        cylinder(0.9, 0, -len / 2 + 1.1, 0.34, 0.26, 12),
      ),
      material: RUBBER,
    },
  ];
}

/** 信号機。 */
function trafficLightModel() {
  return [
    { name: 'pole', origin: [0, 1.9, 0], geometry: cylinder(0, 0, 0, 0.07, 3.8, 10), material: METAL_MID },
    { name: 'arm', origin: [0, 3.7, 0], geometry: box(0.5, 0, 0, 1.1, 0.1, 0.1), material: METAL_MID },
    { name: 'housing', origin: [1.0, 3.35, 0], geometry: box(0, 0, 0, 0.24, 0.66, 0.22), material: METAL_DARK },
    {
      name: 'lamp_red',
      origin: [1.0, 3.55, 0.12],
      geometry: cylinder(0, 0, 0, 0.07, 0.04, 10),
      material: { color: [1, 0.2, 0.15], metallic: 0, roughness: 0.3, emissive: [2.6, 0.25, 0.15] },
    },
    {
      name: 'lamp_green',
      origin: [1.0, 3.15, 0.12],
      geometry: cylinder(0, 0, 0, 0.07, 0.04, 10),
      material: { color: [0.2, 1, 0.4], metallic: 0, roughness: 0.3, emissive: [0.2, 2.2, 0.6] },
    },
  ];
}

/** ゴミ箱・ベンチなどの小物。 */
function propsModels() {
  return {
    prop_trashcan: [{
      name: 'body',
      origin: [0, 0.45, 0],
      geometry: merge(cylinder(0, 0, 0, 0.28, 0.9, 12, 0.3), cylinder(0, 0.48, 0, 0.31, 0.06, 12)),
      material: { color: [0.12, 0.14, 0.13], metallic: 0.5, roughness: 0.6 },
    }],
    prop_bench: [
      {
        name: 'seat',
        origin: [0, 0.45, 0],
        geometry: merge(box(0, 0, 0, 1.8, 0.09, 0.5), box(0, 0.3, -0.22, 1.8, 0.5, 0.08)),
        material: { color: [0.25, 0.16, 0.1], metallic: 0.05, roughness: 0.8 },
      },
      {
        name: 'legs',
        origin: [0, 0.2, 0],
        geometry: merge(box(-0.75, 0, 0, 0.1, 0.4, 0.44), box(0.75, 0, 0, 0.1, 0.4, 0.44)),
        material: METAL_DARK,
      },
    ],
    prop_hydrant: [{
      name: 'body',
      origin: [0, 0.35, 0],
      geometry: merge(
        cylinder(0, 0, 0, 0.16, 0.7, 10, 0.14),
        sphere(0, 0.36, 0, 0.15, 10, 7, 0.8),
        cylinder(-0.2, 0.1, 0, 0.06, 0.12, 8),
      ),
      material: { color: [0.55, 0.06, 0.06], metallic: 0.3, roughness: 0.55 },
    }],
  };
}

/* --------------------------------- 出力 --------------------------------- */

const models = {
  enemy_gunner: gunnerModel(),
  enemy_brute: bruteModel(),
  enemy_drone: droneModel(),
  car_sedan: carModel([0.35, 0.06, 0.08], 'sedan'),
  car_taxi: carModel([0.75, 0.55, 0.05], 'sedan'),
  car_van: carModel([0.16, 0.18, 0.24], 'van'),
  prop_traffic_light: trafficLightModel(),
  ...propsModels(),
};

let total = 0;
for (const [name, nodes] of Object.entries(models)) total += writeGlb(name, nodes);
console.log(`3Dモデル ${Object.keys(models).length} 個を public/models に生成しました（合計 ${(total / 1024).toFixed(0)} KB）`);
