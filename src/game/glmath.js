/** 4x4 行列と最低限のベクトル演算（列優先、WebGL の uniformMatrix4fv 互換）。 */

export function mat4() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function identity(out) {
  out.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return out;
}

export function multiply(out, a, b) {
  const o = out === a || out === b ? new Float32Array(16) : out;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4]
        + a[4 + r] * b[c * 4 + 1]
        + a[8 + r] * b[c * 4 + 2]
        + a[12 + r] * b[c * 4 + 3];
    }
  }
  if (o !== out) out.set(o);
  return out;
}

export function perspective(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  out.set([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, (2 * far * near) / (near - far), 0,
  ]);
  return out;
}

export function lookAt(out, eye, center, up) {
  const z0 = eye[0] - center[0];
  const z1 = eye[1] - center[1];
  const z2 = eye[2] - center[2];
  let len = Math.hypot(z0, z1, z2) || 1;
  const zx = z0 / len;
  const zy = z1 / len;
  const zz = z2 / len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out.set([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
  return out;
}

/** 平行移動・回転(Y,X)・スケールから模型行列を作る。 */
export function compose(out, pos, rotY, rotX, scale) {
  const cy = Math.cos(rotY);
  const sy = Math.sin(rotY);
  const cx = Math.cos(rotX || 0);
  const sx = Math.sin(rotX || 0);
  const sX = scale[0];
  const sY = scale[1];
  const sZ = scale[2];

  // R = Ry * Rx
  out[0] = cy * sX;
  out[1] = 0 * sX;
  out[2] = -sy * sX;
  out[3] = 0;

  out[4] = sy * sx * sY;
  out[5] = cx * sY;
  out[6] = cy * sx * sY;
  out[7] = 0;

  out[8] = sy * cx * sZ;
  out[9] = -sx * sZ;
  out[10] = cy * cx * sZ;
  out[11] = 0;

  out[12] = pos[0];
  out[13] = pos[1];
  out[14] = pos[2];
  out[15] = 1;
  return out;
}
