/**
 * WebGL2 の薄いラッパ。
 *
 * シェーダのコンパイル、VAO の構築、フレームバッファ、テクスチャ生成など
 * 「毎回同じように書く部分」だけをまとめる。描画の方針そのものは
 * renderer.js が持つ。
 */

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false,          // 後処理で解決するので MSAA は使わない
    alpha: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  gl.__aniso = aniso;
  gl.__maxAniso = aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
  return gl;
}

function compile(gl, type, source, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = source.split('\n').map((l, i) => `${String(i + 1).padStart(4)}| ${l}`).join('\n');
    console.error(`[astra] shader compile failed (${label})\n${log}\n${numbered}`);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${label}: ${log}`);
  }
  return sh;
}

/**
 * 頂点／フラグメントシェーダから Program を作る。
 * 返り値の `u` は uniform 位置を名前で引ける辞書（存在しない名前は null）。
 */
export function createProgram(gl, vsSource, fsSource, label = 'program') {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource, `${label}.vert`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource, `${label}.frag`);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    throw new Error(`program link failed: ${label}: ${log}`);
  }
  const u = new Proxy({}, {
    get(cache, name) {
      if (!(name in cache)) cache[name] = gl.getUniformLocation(prog, name);
      return cache[name];
    },
  });
  return { prog, u, label };
}

/**
 * インターリーブ頂点バッファ + インデックスから VAO を作る。
 * attribs: [{ loc, size, offset }]（すべて float、stride は共通）
 */
export function createVao(gl, { data, indices, stride, attribs, instanced }) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (const a of attribs) {
    gl.enableVertexAttribArray(a.loc);
    gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, stride * 4, a.offset * 4);
  }
  let ibo = null;
  let count = 0;
  let indexType = gl.UNSIGNED_INT;
  if (indices) {
    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    count = indices.length;
    indexType = indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
  } else {
    count = data.length / stride;
  }
  let instanceVbo = null;
  if (instanced) {
    instanceVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, instanced.data, instanced.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    for (const a of instanced.attribs) {
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, instanced.stride * 4, a.offset * 4);
      gl.vertexAttribDivisor(a.loc, 1);
    }
  }
  gl.bindVertexArray(null);
  return { vao, vbo, ibo, instanceVbo, count, indexType, instanceCount: instanced ? instanced.count : 0 };
}

export function deleteVao(gl, v) {
  if (!v) return;
  gl.deleteVertexArray(v.vao);
  gl.deleteBuffer(v.vbo);
  if (v.ibo) gl.deleteBuffer(v.ibo);
  if (v.instanceVbo) gl.deleteBuffer(v.instanceVbo);
}

/** RGBA8 の 2D テクスチャを ImageData / TypedArray から作る。 */
export function createTexture2D(gl, source, opts = {}) {
  const {
    wrap = gl.REPEAT, mipmap = true, srgb = false,
    filter = gl.LINEAR, anisotropy = true, width, height,
  } = opts;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const internal = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
  if (source instanceof Uint8Array || source instanceof Uint8ClampedArray) {
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      source instanceof Uint8ClampedArray ? new Uint8Array(source.buffer) : source);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  if (mipmap) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (anisotropy && gl.__aniso) {
      gl.texParameterf(gl.TEXTURE_2D, gl.__aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.__maxAniso));
    }
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

/** 2D テクスチャ配列（材質ごとのアルベドをまとめて 1 バインドで扱う）。 */
export function createTextureArray(gl, layers, size, opts = {}) {
  const { srgb = false, mipmap = true } = opts;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  const levels = mipmap ? Math.floor(Math.log2(size)) + 1 : 1;
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, size, size, layers.length);
  layers.forEach((data, i) => {
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE,
      data instanceof Uint8ClampedArray ? new Uint8Array(data.buffer) : data);
  });
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (mipmap) {
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (gl.__aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, gl.__aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.__maxAniso));
  } else {
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return tex;
}

/** 色（+深度）を持つオフスクリーン。HDR には half float を使う。 */
export function createFramebuffer(gl, width, height, opts = {}) {
  const { float = false, depth = false, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE } = opts;
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const color = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, color);
  gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, width, height, 0, gl.RGBA,
    float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
  let depthTex = null;
  if (depth) {
    depthTex = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthTex);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthTex);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, color, depth: depthTex, width, height };
}

/** 影用の深度専用フレームバッファ（比較サンプラで PCF する）。 */
export function createShadowMap(gl, size) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, size };
}

/** 画面全体を覆う三角形（後処理用）。 */
export function createFullscreenTriangle(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, vbo, count: 3 };
}
