/**
 * glTF バイナリ（.glb）の読み込み。
 *
 * ゲームが必要とするのは「パーツ（ノード）ごとの頂点・法線・材質」だけなので、
 * 仕様の全機能ではなくその部分だけを読む軽量な実装にしている。
 * Blender などから書き出した .glb も、位置・法線を持つメッシュであれば読める。
 */

const COMPONENT = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
  5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readAccessor(gltf, bin, index) {
  if (index === undefined) return null;
  const acc = gltf.accessors[index];
  const view = gltf.bufferViews[acc.bufferView];
  const Type = COMPONENT[acc.componentType];
  const comps = NUM_COMPONENTS[acc.type];
  const offset = (view.byteOffset || 0) + (acc.byteOffset || 0);
  // byteStride がある場合は 1 要素ずつ拾う
  if (view.byteStride && view.byteStride !== comps * Type.BYTES_PER_ELEMENT) {
    const out = new Type(acc.count * comps);
    for (let i = 0; i < acc.count; i++) {
      const src = new Type(bin, offset + i * view.byteStride, comps);
      out.set(src, i * comps);
    }
    return out;
  }
  return new Type(bin, offset, acc.count * comps);
}

/** TRS からモデル行列（列優先）を作る。 */
function trsMatrix(node) {
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x; const y2 = y + y; const z2 = z + z;
  const xx = x * x2; const xy = x * y2; const xz = x * z2;
  const yy = y * y2; const yz = y * z2; const zz = z * z2;
  const wx = w * x2; const wy = w * y2; const wz = w * z2;
  return new Float32Array([
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ]);
}

/**
 * .glb を解析して、描画に必要な形へ変換する。
 * 返り値: { parts: [{ name, translation, matrix, positions, normals, indices, material }] }
 */
export function parseGlb(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glb file');

  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < dv.byteLength) {
    const length = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, start, length)));
    } else if (type === 0x004e4942) {
      bin = arrayBuffer.slice(start, start + length);
    }
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json || !bin) throw new Error('glb chunks missing');

  const parts = [];
  const nodes = json.nodes || [];
  for (const node of nodes) {
    if (node.mesh === undefined) continue;
    const mesh = json.meshes[node.mesh];
    for (const prim of mesh.primitives) {
      const positions = readAccessor(json, bin, prim.attributes.POSITION);
      if (!positions) continue;
      const normals = readAccessor(json, bin, prim.attributes.NORMAL);
      const indices = readAccessor(json, bin, prim.indices);
      const mat = prim.material !== undefined ? json.materials[prim.material] : null;
      const pbr = (mat && mat.pbrMetallicRoughness) || {};
      const base = pbr.baseColorFactor || [0.6, 0.6, 0.6, 1];
      parts.push({
        name: node.name || mesh.name || 'part',
        translation: node.translation || [0, 0, 0],
        matrix: trsMatrix(node),
        positions,
        normals,
        indices,
        material: {
          color: [base[0], base[1], base[2]],
          metallic: pbr.metallicFactor === undefined ? 0.2 : pbr.metallicFactor,
          roughness: pbr.roughnessFactor === undefined ? 0.7 : pbr.roughnessFactor,
          emissive: (mat && mat.emissiveFactor) || [0, 0, 0],
        },
      });
    }
  }
  return { parts };
}

/** base64 文字列を ArrayBuffer にする（単一HTML版で使う）。 */
export function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
