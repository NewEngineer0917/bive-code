/**
 * ASTRA BOND — 数学ライブラリ。
 *
 * 列優先 4x4 行列（WebGL の uniformMatrix4fv と互換）、3次元ベクトル、
 * クォータニオン、そしてカリング用の視錐台を扱う。
 * 外部ライブラリを使わない方針なので、ゲームに必要な分だけを自前で持つ。
 */

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 時間差に依存しない指数補間（フレームレートが変わっても同じ速さで近づく）。 */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
/** -PI..PI に畳んだ角度差。 */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function dampAngle(a, b, lambda, dt) {
  return a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
}

/* ---------------------------------------------------------------- vec3 */

export const v3 = (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]);
export function v3set(o, x, y, z) { o[0] = x; o[1] = y; o[2] = z; return o; }
export function v3copy(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; }
export function v3add(o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; }
export function v3sub(o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; }
export function v3scale(o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; }
export function v3lerp(o, a, b, t) {
  o[0] = a[0] + (b[0] - a[0]) * t;
  o[1] = a[1] + (b[1] - a[1]) * t;
  o[2] = a[2] + (b[2] - a[2]) * t;
  return o;
}
export const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3len = (a) => Math.hypot(a[0], a[1], a[2]);
export function v3norm(o, a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l;
  return o;
}
export function v3cross(o, a, b) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  o[0] = x; o[1] = y; o[2] = z;
  return o;
}
export const v3dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ---------------------------------------------------------------- mat4 */

export const mat4 = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function m4identity(o) {
  o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
  o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
  return o;
}

export function m4mul(out, a, b) {
  const o = (out === a || out === b) ? new Float32Array(16) : out;
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  if (o !== out) out.set(o);
  return out;
}

export function m4perspective(o, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  o.fill(0);
  o[0] = f / aspect; o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

export function m4ortho(o, l, r, b, t, n, f) {
  o.fill(0);
  o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
  o[12] = -(r + l) / (r - l);
  o[13] = -(t + b) / (t - b);
  o[14] = -(f + n) / (f - n);
  o[15] = 1;
  return o;
}

export function m4lookAt(o, eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let l = Math.hypot(zx, zy, zz) || 1;
  zx /= l; zy /= l; zz /= l;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz);
  if (l < 1e-6) { xx = 1; xy = 0; xz = 0; } else { xx /= l; xy /= l; xz /= l; }
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  o[15] = 1;
  return o;
}

/** 平行移動・Y回転・一様/非一様スケールから行列を作る（最もよく使う組み合わせ）。 */
export function m4compose(o, px, py, pz, ry, sx = 1, sy = sx, sz = sx) {
  const c = Math.cos(ry), s = Math.sin(ry);
  o[0] = c * sx; o[1] = 0; o[2] = -s * sx; o[3] = 0;
  o[4] = 0; o[5] = sy; o[6] = 0; o[7] = 0;
  o[8] = s * sz; o[9] = 0; o[10] = c * sz; o[11] = 0;
  o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
  return o;
}

/** オイラー角（YXZ 順）とスケールから行列を作る。 */
export function m4trs(o, px, py, pz, rx, ry, rz, sx = 1, sy = sx, sz = sx) {
  const cx = Math.cos(rx), sxa = Math.sin(rx);
  const cy = Math.cos(ry), sya = Math.sin(ry);
  const cz = Math.cos(rz), sza = Math.sin(rz);
  // R = Ry * Rx * Rz
  const m00 = cy * cz + sya * sxa * sza;
  const m01 = cx * sza;
  const m02 = -sya * cz + cy * sxa * sza;
  const m10 = -cy * sza + sya * sxa * cz;
  const m11 = cx * cz;
  const m12 = sya * sza + cy * sxa * cz;
  const m20 = sya * cx;
  const m21 = -sxa;
  const m22 = cy * cx;
  o[0] = m00 * sx; o[1] = m01 * sx; o[2] = m02 * sx; o[3] = 0;
  o[4] = m10 * sy; o[5] = m11 * sy; o[6] = m12 * sy; o[7] = 0;
  o[8] = m20 * sz; o[9] = m21 * sz; o[10] = m22 * sz; o[11] = 0;
  o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
  return o;
}

export function m4invert(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return m4identity(out);
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/** 法線変換用の 3x3（逆転置）を mat3 配列（9要素・列優先）で返す。 */
export function m4normalMatrix(out9, m) {
  const inv = m4invert(new Float32Array(16), m);
  out9[0] = inv[0]; out9[1] = inv[4]; out9[2] = inv[8];
  out9[3] = inv[1]; out9[4] = inv[5]; out9[5] = inv[9];
  out9[6] = inv[2]; out9[7] = inv[6]; out9[8] = inv[10];
  return out9;
}

export function m4transformPoint(out, m, p) {
  const x = p[0], y = p[1], z = p[2];
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

export function m4transformDir(out, m, p) {
  const x = p[0], y = p[1], z = p[2];
  out[0] = m[0] * x + m[4] * y + m[8] * z;
  out[1] = m[1] * x + m[5] * y + m[9] * z;
  out[2] = m[2] * x + m[6] * y + m[10] * z;
  return out;
}

/** ワールド座標をスクリーン座標（px）へ。画面外なら null。 */
export function projectToScreen(out, viewProj, p, width, height) {
  const x = p[0], y = p[1], z = p[2];
  const cx = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
  const cy = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
  const cw = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  if (cw <= 0.0001) return null;
  out[0] = (cx / cw * 0.5 + 0.5) * width;
  out[1] = (1 - (cy / cw * 0.5 + 0.5)) * height;
  out[2] = cw;
  return out;
}

/* ------------------------------------------------------------- frustum */

/** ビュー射影行列から 6 平面を取り出す（Gribb/Hartmann 法）。 */
export function extractFrustum(planes, m) {
  const set = (i, a, b, c, d) => {
    const l = Math.hypot(a, b, c) || 1;
    planes[i * 4] = a / l; planes[i * 4 + 1] = b / l;
    planes[i * 4 + 2] = c / l; planes[i * 4 + 3] = d / l;
  };
  set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
  set(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  set(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
  set(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  set(4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
  set(5, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
  return planes;
}

/** 境界球が視錐台に少しでも入っていれば true。 */
export function sphereInFrustum(planes, cx, cy, cz, r) {
  for (let i = 0; i < 6; i++) {
    const d = planes[i * 4] * cx + planes[i * 4 + 1] * cy + planes[i * 4 + 2] * cz + planes[i * 4 + 3];
    if (d < -r) return false;
  }
  return true;
}
