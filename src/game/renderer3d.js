/**
 * WebGL2 による 3D レンダラ。
 *
 * ゲーム後半のティアで、2D のレイキャスティングからこちらに切り替わる。
 * ・迷路を実際のジオメトリ（壁・床・天井のポリゴン）として構築する
 * ・法線マップで凹凸を、GGX 近似で金属やコンクリートの反射を表現する
 * ・光源（ヘッドライト・銃口の閃光・敵弾）ごとにグリッドをレイマーチして影を落とす
 * ・HDR で描いてから ACES トーンマッピング、ブルーム、粒状ノイズ等を掛ける
 *
 * 外部ライブラリもモデルデータも使わず、形状はコードで組み立てている。
 */

import { buildMaterials, MAT_SIZE, MATERIALS } from './materials';
import { WEAPONS } from './weapons';
import { mat4, multiply, perspective, lookAt, compose } from './glmath';

const EYE_H = 1.6;    // 視点の高さ
const MAX_LIGHTS = 12;

/** ゲーム内の角度（XZ 平面）を、メッシュの Y 軸回転に変換する。 */
const yawFor = (a) => Math.PI / 2 - a;

/* --------------------------------- シェーダ -------------------------------- */

const WORLD_VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aTangent;
in vec2 aUv;
in float aLayer;
in float aAo;

uniform mat4 uViewProj;

out vec3 vPos;
out vec3 vNormal;
out vec3 vTangent;
out vec2 vUv;
out float vLayer;
out float vAo;

void main() {
  vPos = aPos;
  vNormal = aNormal;
  vTangent = aTangent;
  vUv = aUv;
  vLayer = aLayer;
  vAo = aAo;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

/* 影・ライティング・霧は world と object で共通なので文字列を使い回す */
const LIGHT_COMMON = `
uniform vec3 uCamPos;
uniform vec3 uCamDir;
uniform int uLightCount;
uniform vec3 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
uniform float uLightRange[${MAX_LIGHTS}];
uniform sampler2D uMap;      // 迷路（R > 0.5 が壁）
uniform float uMapSize;
uniform float uShadows;      // 0 = 影なし
uniform float uHeadlight;
uniform vec3 uAmbientSky;
uniform vec3 uAmbientGround;
uniform float uFogDensity;
uniform vec3 uFogColor;

bool solidAt(vec2 p) {
  vec2 uv = (floor(p) + 0.5) / uMapSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return true;
  return texture(uMap, uv).r > 0.5;
}

// 光源までグリッドを辿って遮蔽を調べる（壁は天井まで届く柱として扱う）
float shadowFactor(vec3 P, vec3 L, float dist) {
  if (uShadows < 0.5) return 1.0;
  vec2 p = P.xz;
  vec2 d = normalize(L.xz - P.xz);
  float travelled = 0.25;
  for (int i = 0; i < 28; i++) {
    if (travelled >= dist) break;
    vec2 s = p + d * travelled;
    if (solidAt(s)) return 0.15;
    travelled += 0.32;
  }
  return 1.0;
}

vec3 ggx(vec3 N, vec3 V, vec3 L, vec3 albedo, float rough, float metal, vec3 radiance) {
  vec3 H = normalize(V + L);
  float NdotL = max(dot(N, L), 0.0);
  float NdotV = max(dot(N, V), 0.0001);
  float NdotH = max(dot(N, H), 0.0);
  float VdotH = max(dot(V, H), 0.0);

  float a = max(rough * rough, 0.002);
  float a2 = a * a;
  float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159265 * denom * denom);

  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (NdotV / (NdotV * (1.0 - k) + k)) * (NdotL / (NdotL * (1.0 - k) + k));

  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);

  vec3 spec = (D * G) * F / (4.0 * NdotV * max(NdotL, 0.0001));
  vec3 kd = (1.0 - F) * (1.0 - metal);
  return (kd * albedo / 3.14159265 + spec) * radiance * NdotL;
}

vec3 lighting(vec3 P, vec3 N, vec3 albedo, float rough, float metal, float ao) {
  vec3 V = normalize(uCamPos - P);
  vec3 color = vec3(0.0);

  // ヘッドライト（プレイヤーの持つ光）
  vec3 toCam = uCamPos - P;
  float camDist = length(toCam);
  vec3 Lc = toCam / max(camDist, 0.0001);
  float cone = smoothstep(0.35, 0.72, dot(normalize(-Lc), normalize(uCamDir)));
  float att = uHeadlight / (1.0 + camDist * camDist * 0.09);
  if (att > 0.002) {
    vec3 radiance = vec3(1.0, 0.94, 0.86) * att * mix(0.25, 1.0, cone) * shadowFactor(P, uCamPos, camDist);
    color += ggx(N, V, Lc, albedo, rough, metal, radiance);
  }

  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 toL = uLightPos[i] - P;
    float d = length(toL);
    if (d > uLightRange[i]) continue;
    vec3 L = toL / max(d, 0.0001);
    float falloff = pow(max(0.0, 1.0 - d / uLightRange[i]), 2.0);
    vec3 radiance = uLightColor[i] * falloff * shadowFactor(P, uLightPos[i], d);
    color += ggx(N, V, L, albedo, rough, metal, radiance);
  }

  // 環境光（上からの空気の色と床の照り返し）
  float up = N.y * 0.5 + 0.5;
  vec3 ambient = mix(uAmbientGround, uAmbientSky, up) * albedo * ao;
  return color + ambient;
}

vec3 applyFog(vec3 color, vec3 P) {
  float d = length(P - uCamPos);
  float f = 1.0 - exp(-uFogDensity * d * d);
  return mix(color, uFogColor, clamp(f, 0.0, 1.0));
}`;

const WORLD_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec3 vPos;
in vec3 vNormal;
in vec3 vTangent;
in vec2 vUv;
in float vLayer;
in float vAo;

uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormal;
uniform float uNormalMaps;

${LIGHT_COMMON}

out vec4 fragColor;

void main() {
  vec4 alb = texture(uAlbedo, vec3(vUv, vLayer));
  vec3 albedo = alb.rgb;
  float emissiveMask = alb.a;         // 夜のビルの窓
  vec4 nrm = texture(uNormal, vec3(vUv, vLayer));
  float rough = mix(0.85, nrm.a, uNormalMaps);
  float metal = vLayer < 1.5 && vLayer > 0.5 ? 0.55 : 0.05;  // ガラス張りのビルだけ金属寄り // 金属パネルだけ金属寄り

  vec3 N = normalize(vNormal);
  if (uNormalMaps > 0.5) {
    vec3 T = normalize(vTangent);
    vec3 B = cross(N, T);
    vec3 tn = nrm.rgb * 2.0 - 1.0;
    N = normalize(T * tn.x + B * tn.y + N * tn.z);
  }

  vec3 color = lighting(vPos, N, albedo, rough, metal, vAo);
  color += albedo * emissiveMask * 2.2;   // 窓の明かり
  fragColor = vec4(applyFog(color, vPos), 1.0);
}`;

const OBJECT_VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;

out vec3 vPos;
out vec3 vNormal;

void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vPos = world.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  gl_Position = uViewProj * world;
}`;

const OBJECT_FS = `#version 300 es
precision highp float;

in vec3 vPos;
in vec3 vNormal;

uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uRough;
uniform float uMetal;
uniform float uAmbientBoost;   // 手に持った武器を見やすくする補助光

${LIGHT_COMMON}

out vec4 fragColor;

void main() {
  vec3 N = normalize(vNormal);
  vec3 color = lighting(vPos, N, uColor, uRough, uMetal, 1.0) + uEmissive
    + uColor * uAmbientBoost * (0.45 + 0.55 * max(dot(N, normalize(uCamPos - vPos)), 0.0));
  fragColor = vec4(applyFog(color, vPos), 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;

uniform vec3 uCamDir;
uniform float uAspect;
uniform float uFovScale;

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // 画面座標から視線の高さを求め、地平線からの角度で色を決める
  float ndcY = vUv.y * 2.0 - 1.0;
  float elevation = clamp(uCamDir.y + ndcY * uFovScale, -1.0, 1.0);

  vec3 horizon = vec3(0.16, 0.13, 0.19);   // 街明かりで少し明るい地平線
  vec3 zenith = vec3(0.015, 0.02, 0.045);
  vec3 col = mix(horizon, zenith, clamp(elevation * 1.6, 0.0, 1.0));

  // 星（地平線より上だけ）
  if (elevation > 0.05) {
    vec2 cell = floor(vUv * vec2(uAspect * 220.0, 220.0));
    float star = hash(cell);
    if (star > 0.9975) {
      col += vec3(0.8, 0.85, 1.0) * (star - 0.9975) * 380.0 * smoothstep(0.05, 0.4, elevation);
    }
  }
  fragColor = vec4(col, 1.0);
}`;

const QUAD_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
out vec4 fragColor;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(0.0, lum - uThreshold) / max(lum, 0.0001);
  fragColor = vec4(c * k, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;      // (1/w, 0) または (0, 1/h)
out vec4 fragColor;
void main() {
  float w[5];
  w[0] = 0.227027; w[1] = 0.194594; w[2] = 0.121621; w[3] = 0.054054; w[4] = 0.016216;
  vec3 sum = texture(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = uDir * float(i) * 1.35;
    sum += texture(uTex, vUv + off).rgb * w[i];
    sum += texture(uTex, vUv - off).rgb * w[i];
  }
  fragColor = vec4(sum, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform float uGrain;
uniform float uAberration;
uniform float uVignette;
uniform float uTime;

out vec4 fragColor;

// ACES フィルミックトーンマッピング
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  vec2 fromCenter = uv - 0.5;

  // 色収差（レンズの色ズレ）
  vec3 color;
  if (uAberration > 0.0) {
    vec2 off = fromCenter * uAberration * 0.004;
    color.r = texture(uScene, uv + off).r;
    color.g = texture(uScene, uv).g;
    color.b = texture(uScene, uv - off).b;
  } else {
    color = texture(uScene, uv).rgb;
  }

  if (uBloomStrength > 0.0) color += texture(uBloom, uv).rgb * uBloomStrength;

  color = aces(color * uExposure);

  // 周辺減光
  float vig = 1.0 - uVignette * dot(fromCenter, fromCenter) * 1.9;
  color *= clamp(vig, 0.0, 1.0);

  // フィルムグレイン
  if (uGrain > 0.0) {
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float n = hash(uv * 900.0 + uTime) - 0.5;
    color += n * uGrain * smoothstep(0.02, 0.35, lum);
  }

  fragColor = vec4(pow(max(color, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;

/* --------------------------------- 補助関数 -------------------------------- */

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader compile failed: ' + log);
  }
  return sh;
}

function program(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program link failed: ' + gl.getProgramInfoLog(p));
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  const attribs = {};
  const acount = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < acount; i++) {
    const info = gl.getActiveAttrib(p, i);
    attribs[info.name] = gl.getAttribLocation(p, info.name);
  }
  return { p, uniforms, attribs };
}

/** 単位立方体（法線付き）。敵や武器はこれを組み合わせて作る。 */
function boxMesh() {
  const pos = [];
  const nrm = [];
  const faces = [
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]],
    [[1, 0, 0], [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]],
  ];
  for (const [n, quad] of faces) {
    const [a, b, c, d] = quad;
    for (const v of [a, b, c, a, c, d]) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(n[0], n[1], n[2]);
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm) };
}

/** 単位球（緯度経度分割）。 */
function sphereMesh(seg = 14, ring = 10) {
  const pos = [];
  const nrm = [];
  const p = (i, j) => {
    const u = (i / seg) * Math.PI * 2;
    const v = (j / ring) * Math.PI;
    return [Math.sin(v) * Math.cos(u) * 0.5, Math.cos(v) * 0.5, Math.sin(v) * Math.sin(u) * 0.5];
  };
  for (let j = 0; j < ring; j++) {
    for (let i = 0; i < seg; i++) {
      const a = p(i, j);
      const b = p(i + 1, j);
      const c = p(i + 1, j + 1);
      const d = p(i, j + 1);
      for (const v of [a, b, c, a, c, d]) {
        pos.push(v[0], v[1], v[2]);
        const len = Math.hypot(v[0], v[1], v[2]) || 1;
        nrm.push(v[0] / len, v[1] / len, v[2] / len);
      }
    }
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm) };
}

/** 単位円筒（Z 軸方向、長さ1・直径1）。銃身やコイルに使う。 */
function cylinderMesh(seg = 14) {
  const pos = [];
  const nrm = [];
  const ring = (i) => {
    const a = (i / seg) * Math.PI * 2;
    return [Math.cos(a) * 0.5, Math.sin(a) * 0.5];
  };
  for (let i = 0; i < seg; i++) {
    const [x0, y0] = ring(i);
    const [x1, y1] = ring(i + 1);
    // 側面
    const quad = [
      [x0, y0, -0.5], [x1, y1, -0.5], [x1, y1, 0.5],
      [x0, y0, -0.5], [x1, y1, 0.5], [x0, y0, 0.5],
    ];
    const n0 = [x0 * 2, y0 * 2, 0];
    const n1 = [x1 * 2, y1 * 2, 0];
    const ns = [n0, n1, n1, n0, n1, n0];
    quad.forEach((v, k) => {
      pos.push(v[0], v[1], v[2]);
      nrm.push(ns[k][0], ns[k][1], 0);
    });
    // 前後のふた
    pos.push(0, 0, 0.5, x0, y0, 0.5, x1, y1, 0.5);
    nrm.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    pos.push(0, 0, -0.5, x1, y1, -0.5, x0, y0, -0.5);
    nrm.push(0, 0, -1, 0, 0, -1, 0, 0, -1);
  }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm) };
}

export class Renderer3D {
  static isSupported() {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch (e) {
      return false;
    }
  }

  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true });
    if (!gl) throw new Error('webgl2 unavailable');
    this.canvas = canvas;
    this.gl = gl;
    this.floatBuffers = !!gl.getExtension('EXT_color_buffer_float');

    this.progWorld = program(gl, WORLD_VS, WORLD_FS);
    this.progObject = program(gl, OBJECT_VS, OBJECT_FS);
    this.progBright = program(gl, QUAD_VS, BRIGHT_FS);
    this.progBlur = program(gl, QUAD_VS, BLUR_FS);
    this.progComposite = program(gl, QUAD_VS, COMPOSITE_FS);
    this.progSky = program(gl, QUAD_VS, SKY_FS);

    this.quadVao = this._makeQuad();
    this.box = this._makeObjectMesh(boxMesh());
    this.sphere = this._makeObjectMesh(sphereMesh());
    this.cyl = this._makeObjectMesh(cylinderMesh());

    this._initTextures();

    this.viewProj = mat4();
    this.view = mat4();
    this.proj = mat4();
    this.model = mat4();
    this.normalMat = new Float32Array(9);

    this.quality = {
      scale: 1, normalMaps: true, shadows: true, bloom: 0.6,
      grain: 0.03, aberration: 1, vignette: 0.5, exposure: 1.1,
    };
    this.mapMesh = null;
    this.time = 0;
    this.width = 0;
    this.height = 0;
  }

  _makeQuad() {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  _makeObjectMesh(mesh) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.progObject.attribs.aPos);
    gl.vertexAttribPointer(this.progObject.attribs.aPos, 3, gl.FLOAT, false, 0, 0);
    const nrmBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.nrm, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.progObject.attribs.aNormal);
    gl.vertexAttribPointer(this.progObject.attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return { vao, count: mesh.pos.length / 3 };
  }

  _initTextures() {
    const gl = this.gl;
    const mats = buildMaterials(MAT_SIZE);

    const makeArray = (pick) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texImage3D(
        gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, MAT_SIZE, MAT_SIZE, mats.length, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, null,
      );
      mats.forEach((m, i) => {
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, MAT_SIZE, MAT_SIZE, 1,
          gl.RGBA, gl.UNSIGNED_BYTE, pick(m).data,
        );
      });
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return tex;
    };

    this.albedoTex = makeArray((m) => m.albedo);
    this.normalTex = makeArray((m) => m.normal);
    this.mapTex = gl.createTexture();
  }

  /**
   * 街のジオメトリと、影計算用のグリッドテクスチャを作る。
   *
   * ・建物はタイルごとに高さが違う「柱」として立てる
   * ・見えない面（隣も同じ高さの建物）は作らない
   * ・車道／歩道／広場で床のマテリアルを変え、歩道には段差（縁石）を付ける
   * ・歩道沿いに街灯を置き、実際の光源として登録する
   */
  buildMap(map) {
    const gl = this.gl;
    const { size, tiles, heights, kind } = map;
    const solid = (x, y) => (x < 0 || y < 0 || x >= size || y >= size ? 1 : (tiles[y * size + x] ? 1 : 0));
    const heightAt = (x, y) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return 18;
      return tiles[y * size + x] ? (heights ? heights[y * size + x] : 3) : 0;
    };
    const layerOf = (x, y) => Math.max(0, (tiles[y * size + x] || 1) - 1);
    const kindAt = (x, y) => (kind && x >= 0 && y >= 0 && x < size && y < size ? kind[y * size + x] : 0);

    const pos = [];
    const nrm = [];
    const tan = [];
    const uv = [];
    const layer = [];
    const ao = [];

    const pushTri = (v, n, t, u, layerIdx, aoV) => {
      pos.push(v[0], v[1], v[2]);
      nrm.push(n[0], n[1], n[2]);
      tan.push(t[0], t[1], t[2]);
      uv.push(u[0], u[1]);
      layer.push(layerIdx);
      ao.push(aoV);
    };

    // 4頂点の面を追加（法線と巻き順を一致させる）
    const pushQuad = (verts, n, t, uvs, layerIdx, aos) => {
      for (const i of [0, 2, 1, 0, 3, 2]) pushTri(verts[i], n, t, uvs[i], layerIdx, aos[i]);
    };

    const UV_WALL = 2.6;   // 壁テクスチャ1枚あたりのワールド幅
    const UV_WALL_V = 3.2; // 同・高さ
    const UV_GROUND = 2.4;

    // --- 建物 ---
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const h = heightAt(x, y);
        if (h <= 0) continue;
        const mat = layerOf(x, y);

        const sides = [
          { d: [0, -1], n: [0, 0, -1], t: [1, 0, 0] },
          { d: [0, 1], n: [0, 0, 1], t: [-1, 0, 0] },
          { d: [-1, 0], n: [-1, 0, 0], t: [0, 0, -1] },
          { d: [1, 0], n: [1, 0, 0], t: [0, 0, 1] },
        ];
        for (const { d, n, t } of sides) {
          const nh = heightAt(x + d[0], y + d[1]);
          if (nh >= h) continue;              // 隣がもっと高ければこの面は見えない
          const bottom = nh;                  // 低い隣家の屋上から上だけ作る
          const cx = x + 0.5 + n[0] * 0.5;
          const cz = y + 0.5 + n[2] * 0.5;
          const hx = t[0] * 0.5;
          const hz = t[2] * 0.5;
          const v0 = [cx - hx, bottom, cz - hz];
          const v1 = [cx + hx, bottom, cz + hz];
          const v2 = [cx + hx, h, cz + hz];
          const v3 = [cx - hx, h, cz - hz];
          // UV はワールド座標基準にして、隣のタイルと窓の並びを揃える
          const uAxis = (v) => (Math.abs(n[2]) > 0.5 ? v[0] : v[2]) / UV_WALL;
          const vTop = 0;
          const vBottom = (h - bottom) / UV_WALL_V;
          const uvs = [
            [uAxis(v0), vBottom], [uAxis(v1), vBottom], [uAxis(v1), vTop], [uAxis(v0), vTop],
          ];
          const groundAo = bottom === 0 ? 0.62 : 0.9;
          pushQuad([v0, v1, v2, v3], n, t, uvs, mat, [groundAo, groundAo, 1, 1]);
        }

        // 屋上
        pushQuad(
          [[x, h, y], [x + 1, h, y], [x + 1, h, y + 1], [x, h, y + 1]],
          [0, 1, 0], [1, 0, 0],
          [[x / UV_GROUND, y / UV_GROUND], [(x + 1) / UV_GROUND, y / UV_GROUND],
            [(x + 1) / UV_GROUND, (y + 1) / UV_GROUND], [x / UV_GROUND, (y + 1) / UV_GROUND]],
          MATERIALS.ROOF, [1, 1, 1, 1],
        );
      }
    }

    // --- 地面（車道・歩道・広場） ---
    const CURB = 0.14;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (tiles[y * size + x]) continue;
        const k = kindAt(x, y);
        const mat = k === 0 ? MATERIALS.ROAD : k === 1 ? MATERIALS.SIDEWALK : MATERIALS.CONCRETE;
        const gy = k === 0 ? 0 : CURB;      // 歩道と広場は一段高い

        // 建物際は暗くする
        const near = solid(x - 1, y) + solid(x + 1, y) + solid(x, y - 1) + solid(x, y + 1);
        const aoV = 1 - Math.min(0.4, near * 0.12);
        pushQuad(
          [[x, gy, y], [x + 1, gy, y], [x + 1, gy, y + 1], [x, gy, y + 1]],
          [0, 1, 0], [1, 0, 0],
          [[x / UV_GROUND, y / UV_GROUND], [(x + 1) / UV_GROUND, y / UV_GROUND],
            [(x + 1) / UV_GROUND, (y + 1) / UV_GROUND], [x / UV_GROUND, (y + 1) / UV_GROUND]],
          mat, [aoV, aoV, aoV, aoV],
        );

        // 縁石（車道に面した側）
        if (gy > 0) {
          const curbSides = [
            { d: [0, -1], n: [0, 0, -1], t: [1, 0, 0] },
            { d: [0, 1], n: [0, 0, 1], t: [-1, 0, 0] },
            { d: [-1, 0], n: [-1, 0, 0], t: [0, 0, -1] },
            { d: [1, 0], n: [1, 0, 0], t: [0, 0, 1] },
          ];
          for (const { d, n, t } of curbSides) {
            const nx = x + d[0];
            const ny = y + d[1];
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            if (tiles[ny * size + nx] || kindAt(nx, ny) !== 0) continue;
            const cx = x + 0.5 + n[0] * 0.5;
            const cz = y + 0.5 + n[2] * 0.5;
            const hx = t[0] * 0.5;
            const hz = t[2] * 0.5;
            pushQuad(
              [[cx - hx, 0, cz - hz], [cx + hx, 0, cz + hz], [cx + hx, CURB, cz + hz], [cx - hx, CURB, cz - hz]],
              n, t,
              [[0, 0.06], [0.42, 0.06], [0.42, 0], [0, 0]],
              MATERIALS.CONCRETE, [0.7, 0.7, 1, 1],
            );
          }
        }
      }
    }

    // --- 街灯（ポールは静的ジオメトリ、明かりは点光源） ---
    this.mapLights = [];
    this.lampHeads = [];
    const pushBox = (cx, cy, cz, sx, sy, sz, layerIdx, aoV) => {
      const faces = [
        { n: [0, 0, -1], t: [1, 0, 0], hw: sx / 2, hh: sy / 2, c: [cx, cy, cz - sz / 2] },
        { n: [0, 0, 1], t: [-1, 0, 0], hw: sx / 2, hh: sy / 2, c: [cx, cy, cz + sz / 2] },
        { n: [-1, 0, 0], t: [0, 0, -1], hw: sz / 2, hh: sy / 2, c: [cx - sx / 2, cy, cz] },
        { n: [1, 0, 0], t: [0, 0, 1], hw: sz / 2, hh: sy / 2, c: [cx + sx / 2, cy, cz] },
      ];
      for (const f of faces) {
        const e = [0, 1, 0];
        const v = (a, b) => [
          f.c[0] + f.t[0] * f.hw * a + e[0] * f.hh * b,
          f.c[1] + f.t[1] * f.hw * a + e[1] * f.hh * b,
          f.c[2] + f.t[2] * f.hw * a + e[2] * f.hh * b,
        ];
        pushQuad([v(-1, -1), v(1, -1), v(1, 1), v(-1, 1)], f.n, f.t,
          [[0, 0.3], [0.3, 0.3], [0.3, 0], [0, 0]], layerIdx, [aoV, aoV, aoV, aoV]);
      }
    };

    for (let y = 2; y < size - 2; y++) {
      for (let x = 2; x < size - 2; x++) {
        if (tiles[y * size + x] || kindAt(x, y) !== 1) continue;
        if ((x * 7 + y * 13) % 9 !== 0) continue;
        // 車道に面した歩道にだけ置く
        const roadSide = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .find(([dx, dy]) => !tiles[(y + dy) * size + (x + dx)] && kindAt(x + dx, y + dy) === 0);
        if (!roadSide) continue;
        const px = x + 0.5;
        const pz = y + 0.5;
        pushBox(px, CURB + 1.8, pz, 0.1, 3.6, 0.1, MATERIALS.CONCRETE, 0.9);
        pushBox(px + roadSide[0] * 0.35, CURB + 3.5, pz + roadSide[1] * 0.35, 0.7, 0.1, 0.7, MATERIALS.CONCRETE, 1);
        const hx = px + roadSide[0] * 0.55;
        const hz = pz + roadSide[1] * 0.55;
        this.lampHeads.push([hx, CURB + 3.35, hz]);
        this.mapLights.push({
          x: hx, y: CURB + 3.3, z: hz,
          r: 5.5, g: 4.6, b: 3.0, range: 11,
        });
      }
    }

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const bind = (name, data, comps) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      const loc = this.progWorld.attribs[name];
      if (loc === undefined || loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, comps, gl.FLOAT, false, 0, 0);
    };
    bind('aPos', pos, 3);
    bind('aNormal', nrm, 3);
    bind('aTangent', tan, 3);
    bind('aUv', uv, 2);
    bind('aLayer', layer, 1);
    bind('aAo', ao, 1);
    gl.bindVertexArray(null);

    if (this.mapMesh) gl.deleteVertexArray(this.mapMesh.vao);
    this.mapMesh = { vao, count: pos.length / 3 };
    this.mapSize = size;

    // 影用のグリッドテクスチャ
    const data = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) data[i] = tiles[i] ? 255 : 0;
    gl.bindTexture(gl.TEXTURE_2D, this.mapTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  setQuality(q) {
    this.quality = { ...this.quality, ...q };
    this.resize(this.cssW, this.cssH, true);
  }

  resize(cssW, cssH, force = false) {
    if (!cssW || !cssH) return;
    this.cssW = cssW;
    this.cssH = cssH;
    const w = Math.max(2, Math.round(cssW * this.quality.scale));
    const h = Math.max(2, Math.round(cssH * this.quality.scale));
    if (!force && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this._initFramebuffers(w, h);
  }

  _initFramebuffers(w, h) {
    const gl = this.gl;
    const makeTarget = (width, height, float) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const internal = float && this.floatBuffers ? gl.RGBA16F : gl.RGBA8;
      const type = float && this.floatBuffers ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo, width, height };
    };

    // 既存を破棄
    for (const t of [this.sceneTarget, this.bloomA, this.bloomB]) {
      if (t) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
    }
    if (this.depthBuf) gl.deleteRenderbuffer(this.depthBuf);

    this.sceneTarget = makeTarget(w, h, true);
    this.depthBuf = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuf);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.fbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuf);

    const bw = Math.max(2, w >> 2);
    const bh = Math.max(2, h >> 2);
    this.bloomA = makeTarget(bw, bh, true);
    this.bloomB = makeTarget(bw, bh, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** ライティング関連の uniform をまとめて設定する。 */
  _setLightUniforms(prog, game, camPos, camDir) {
    const gl = this.gl;
    const u = prog.uniforms;
    const q = this.quality;
    gl.uniform3fv(u.uCamPos, camPos);
    gl.uniform3fv(u.uCamDir, camDir);
    gl.uniform1f(u.uHeadlight, 0.55);
    gl.uniform1f(u.uShadows, q.shadows ? 1 : 0);
    gl.uniform1f(u.uMapSize, this.mapSize);
    gl.uniform3f(u.uAmbientSky, 0.07, 0.075, 0.115);
    gl.uniform3f(u.uAmbientGround, 0.028, 0.028, 0.036);
    gl.uniform1f(u.uFogDensity, 0.0016);
    gl.uniform3f(u.uFogColor, 0.13, 0.11, 0.16);

    const lights = this._gatherLights(game);
    gl.uniform1i(u.uLightCount, lights.count);
    if (lights.count) {
      gl.uniform3fv(u.uLightPos, lights.pos);
      gl.uniform3fv(u.uLightColor, lights.color);
      gl.uniform1fv(u.uLightRange, lights.range);
    }

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.mapTex);
    gl.uniform1i(u.uMap, 2);
  }

  _gatherLights(game) {
    const pos = new Float32Array(MAX_LIGHTS * 3);
    const color = new Float32Array(MAX_LIGHTS * 3);
    const range = new Float32Array(MAX_LIGHTS);
    let n = 0;
    const add = (x, y, z, r, g, b, rad) => {
      if (n >= MAX_LIGHTS) return;
      pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
      color[n * 3] = r; color[n * 3 + 1] = g; color[n * 3 + 2] = b;
      range[n] = rad;
      n++;
    };

    const p = game.player;
    if (p.flash > 0) {
      const k = (p.flash / 0.09) * 6.5;
      add(p.x, EYE_H, p.y, k, k * 0.84, k * 0.55, 7);
    }
    for (const b of game.projectiles) add(b.x, 1.1, b.y, 1.6, 0.5, 2.6, 4.0);
    // マップに置かれた照明のうち、近いものを採用する
    if (this.mapLights) {
      const near = this.mapLights
        .map((L) => ({ L, d: (L.x - p.x) ** 2 + (L.z - p.y) ** 2 }))
        .filter((e) => e.d < 200)
        .sort((a, b) => a.d - b.d)
        .slice(0, 5);
      for (const { L } of near) add(L.x, L.y, L.z, L.r, L.g, L.b, L.range);
    }

    for (const it of game.pickups) {
      if (n >= MAX_LIGHTS - 1) break;
      if (it.kind === 'core') add(it.x, 0.5, it.y, 0.5, 1.5, 2.0, 3.0);
      else if (it.kind === 'health') add(it.x, 0.4, it.y, 1.3, 0.3, 0.45, 2.2);
      else if (it.kind === 'ammo') add(it.x, 0.4, it.y, 1.2, 1.0, 0.25, 2.0);
    }
    return { count: n, pos, color, range };
  }

  _drawMesh(mesh, model, color, emissive, rough, metal) {
    const gl = this.gl;
    const u = this.progObject.uniforms;
    gl.uniformMatrix4fv(u.uModel, false, model);
    // 法線行列（等方スケールを前提に回転部分をそのまま使う）
    const m = model;
    const nm = this.normalMat;
    const sx = 1 / (Math.hypot(m[0], m[1], m[2]) || 1);
    const sy = 1 / (Math.hypot(m[4], m[5], m[6]) || 1);
    const sz = 1 / (Math.hypot(m[8], m[9], m[10]) || 1);
    nm[0] = m[0] * sx; nm[1] = m[1] * sx; nm[2] = m[2] * sx;
    nm[3] = m[4] * sy; nm[4] = m[5] * sy; nm[5] = m[6] * sy;
    nm[6] = m[8] * sz; nm[7] = m[9] * sz; nm[8] = m[10] * sz;
    gl.uniformMatrix3fv(u.uNormalMat, false, nm);
    gl.uniform3fv(u.uColor, color);
    gl.uniform3fv(u.uEmissive, emissive);
    gl.uniform1f(u.uRough, rough);
    gl.uniform1f(u.uMetal, metal);
    gl.uniform1f(u.uAmbientBoost, this.ambientBoost || 0);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  render(game, dt) {
    const gl = this.gl;
    const q = this.quality;
    this.time += dt || 0.016;
    if (!this.mapMesh) return;

    const p = game.player;
    const camPos = [p.x, EYE_H + Math.sin(game.bob) * 0.02, p.y];
    const dirX = Math.cos(p.angle);
    const dirZ = Math.sin(p.angle);
    const pitch = game.pitch * 2.2; // 割合 → ラジアン相当
    const camDir = [dirX, pitch, dirZ];
    const target = [camPos[0] + camDir[0], camPos[1] + camDir[1], camPos[2] + camDir[2]];

    const aspect = this.width / this.height;
    const fov = aspect >= 1.4 ? 1.15 : aspect >= 1 ? 1.25 : 1.5;
    perspective(this.proj, fov, aspect, 0.08, 45);
    lookAt(this.view, camPos, target, [0, 1, 0]);
    multiply(this.viewProj, this.proj, this.view);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.02, 0.025, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // --- 夜空（奥行きなしで先に敷く）---
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.progSky.p);
    gl.uniform3fv(this.progSky.uniforms.uCamDir, camDir);
    gl.uniform1f(this.progSky.uniforms.uAspect, aspect);
    gl.uniform1f(this.progSky.uniforms.uFovScale, Math.tan(fov / 2));
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    // --- 迷路 ---
    gl.useProgram(this.progWorld.p);
    gl.uniformMatrix4fv(this.progWorld.uniforms.uViewProj, false, this.viewProj);
    gl.uniform1f(this.progWorld.uniforms.uNormalMaps, q.normalMaps ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.albedoTex);
    gl.uniform1i(this.progWorld.uniforms.uAlbedo, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.normalTex);
    gl.uniform1i(this.progWorld.uniforms.uNormal, 1);
    this._setLightUniforms(this.progWorld, game, camPos, camDir);
    gl.bindVertexArray(this.mapMesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.mapMesh.count);

    // --- 敵・アイテム・弾・武器 ---
    gl.useProgram(this.progObject.p);
    gl.uniformMatrix4fv(this.progObject.uniforms.uViewProj, false, this.viewProj);
    this._setLightUniforms(this.progObject, game, camPos, camDir);
    this._drawLamps(camPos);
    this._drawEntities(game);

    // 手に持った武器は世界とは別レイヤー扱いにして、壁にめり込ませない
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this._drawWeapon(game, camPos, p.angle, pitch);

    // --- 後処理 ---
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    this._postProcess();
  }

  /** 近くの街灯の発光部を描く。 */
  _drawLamps(camPos) {
    if (!this.lampHeads) return;
    for (const [x, y, z] of this.lampHeads) {
      const d2 = (x - camPos[0]) ** 2 + (z - camPos[2]) ** 2;
      if (d2 > 900) continue;
      compose(this.model, [x, y, z], 0, 0, [0.34, 0.12, 0.34]);
      this._drawMesh(this.box, this.model, [1, 0.94, 0.8], [3.2, 2.7, 1.7], 0.3, 0.2);
    }
  }

  _drawEntities(game) {
    const m = this.model;
    for (const e of game.enemies) {
      const t = e.anim;
      const dying = e.dying ? Math.max(0, 1 - e.dying * 2.2) : 1;
      if (dying <= 0.02) continue;
      const hurt = e.hurtT > 0 ? 1 : 0;
      const facing = Math.atan2(game.player.y - e.y, game.player.x - e.x);
      const fall = e.dying ? e.dying * 1.6 : 0;

      if (e.type === 'drone') {
        const hover = 1.15 + Math.sin(t * 2.4) * 0.08 - fall;
        compose(m, [e.x, hover, e.y], yawFor(facing) + Math.sin(t * 3) * 0.1, 0, [0.62, 0.5, 0.62]);
        this._drawMesh(this.sphere, m, [0.26 + hurt * 0.4, 0.05, 0.07], [0.03, 0.0, 0.0], 0.5, 0.25);
        compose(m, [e.x, hover, e.y], yawFor(facing), 0, [0.95, 0.06, 0.16]);
        this._drawMesh(this.box, m, [0.14, 0.15, 0.2], [0, 0, 0], 0.6, 0.6);
        const eye = [e.x + Math.cos(facing) * 0.22, hover, e.y + Math.sin(facing) * 0.22];
        compose(m, eye, yawFor(facing), 0, [0.16, 0.16, 0.16]);
        this._drawMesh(this.sphere, m, [1, 0.3, 0.2], [2.2, 0.5, 0.2], 0.3, 0);
      } else if (e.type === 'gunner') {
        const swing = Math.sin(t * 6) * 0.12;
        compose(m, [e.x, 0.95 - fall, e.y], yawFor(facing), 0, [0.5, 0.75, 0.36]);
        this._drawMesh(this.box, m, [0.16 + hurt * 0.45, 0.13, 0.3], [0, 0, 0], 0.6, 0.2);
        compose(m, [e.x, 1.5 - fall, e.y], yawFor(facing), 0, [0.3, 0.3, 0.3]);
        this._drawMesh(this.sphere, m, [0.13, 0.11, 0.22], [0.02, 0.0, 0.03], 0.45, 0.4);
        const armX = e.x + Math.cos(facing + 1.3) * 0.32;
        const armZ = e.y + Math.sin(facing + 1.3) * 0.32;
        compose(m, [armX, 1.15 - fall, armZ], yawFor(facing), 0, [0.6, 0.16, 0.16]);
        this._drawMesh(this.box, m, [0.18, 0.18, 0.24], [0.4, 1.2, 0.9], 0.35, 0.6);
        for (const side of [-1, 1]) {
          const lx = e.x + Math.cos(facing + Math.PI / 2) * 0.16 * side;
          const lz = e.y + Math.sin(facing + Math.PI / 2) * 0.16 * side;
          compose(m, [lx, 0.32 - fall, lz], yawFor(facing) + swing * side, 0, [0.16, 0.62, 0.16]);
          this._drawMesh(this.box, m, [0.09, 0.08, 0.14], [0, 0, 0], 0.72, 0.18);
        }
      } else {
        const swing = Math.sin(t * 4) * 0.16;
        compose(m, [e.x, 1.25 - fall, e.y], yawFor(facing), 0, [1.0, 1.1, 0.7]);
        this._drawMesh(this.box, m, [0.09 + hurt * 0.5, 0.19, 0.11], [0, 0, 0], 0.7, 0.15);
        compose(m, [e.x, 2.0 - fall, e.y], yawFor(facing), 0, [0.42, 0.3, 0.4]);
        this._drawMesh(this.box, m, [0.16, 0.18, 0.16], [0.25, 0.2, 0.02], 0.5, 0.3);
        for (const side of [-1, 1]) {
          const ax = e.x + Math.cos(facing + Math.PI / 2) * 0.62 * side;
          const az = e.y + Math.sin(facing + Math.PI / 2) * 0.62 * side;
          compose(m, [ax, 1.3 - fall, az], yawFor(facing) + swing * side, 0, [0.28, 0.85, 0.28]);
          this._drawMesh(this.box, m, [0.08, 0.15, 0.09], [0, 0, 0], 0.72, 0.2);
          const lx = e.x + Math.cos(facing + Math.PI / 2) * 0.28 * side;
          const lz = e.y + Math.sin(facing + Math.PI / 2) * 0.28 * side;
          compose(m, [lx, 0.38 - fall, lz], yawFor(facing) - swing * side, 0, [0.26, 0.76, 0.26]);
          this._drawMesh(this.box, m, [0.07, 0.11, 0.07], [0, 0, 0], 0.78, 0.12);
        }
      }
    }

    for (const it of game.pickups) {
      const bob = 0.45 + Math.sin(it.anim * 3) * 0.06;
      const spin = it.anim * 1.6;
      if (it.kind === 'ammo') {
        compose(this.model, [it.x, bob, it.y], spin, 0, [0.34, 0.26, 0.34]);
        this._drawMesh(this.box, this.model, [0.16, 0.36, 0.2], [0.15, 0.5, 0.1], 0.55, 0.3);
      } else if (it.kind === 'health') {
        compose(this.model, [it.x, bob, it.y], spin, 0, [0.32, 0.3, 0.32]);
        this._drawMesh(this.box, this.model, [0.85, 0.85, 0.88], [0.6, 0.05, 0.12], 0.4, 0.1);
      } else {
        compose(this.model, [it.x, bob + 0.1, it.y], spin, spin * 0.7, [0.3, 0.3, 0.3]);
        this._drawMesh(this.box, this.model, [0.3, 0.8, 1.0], [0.4, 1.8, 2.4], 0.25, 0.4);
      }
    }

    for (const b of game.projectiles) {
      compose(this.model, [b.x, 1.1, b.y], 0, 0, [0.28, 0.28, 0.28]);
      this._drawMesh(this.sphere, this.model, [0.8, 0.4, 1], [2.4, 0.8, 3.4], 0.2, 0);
    }
  }

  /**
   * 武器のパーツ構成。
   *
   * r=右 / u=上 / f=前 のオフセット（メートル）と、箱か円筒かを指定する。
   * レベルが上がるごとにパーツが増えて形が変わる：
   *   Lv1 素の状態 → Lv2 レール・フォアグリップ → Lv3 スコープや銃身の延長
   *   → Lv4 エネルギーコイルと発光コア
   */
  static weaponParts(id, level, accent) {
    const steel = [0.13, 0.135, 0.16];
    const steelLight = [0.2, 0.21, 0.25];
    const gunmetal = [0.08, 0.085, 0.105];
    const grip = [0.07, 0.065, 0.075];
    const glowMul = 0.3 + level * 0.16;
    const glow = accent.map((c) => c * glowMul);
    const parts = [];
    const box = (r, u, f, sx, sy, sz, color, emissive, rough, metal, role) =>
      parts.push({ mesh: 'box', r, u, f, sx, sy, sz, color, emissive: emissive || [0, 0, 0], rough, metal, role });
    const cyl = (r, u, f, dia, len, color, emissive, rough, metal, role) =>
      parts.push({ mesh: 'cyl', r, u, f, sx: dia, sy: dia, sz: len, color, emissive: emissive || [0, 0, 0], rough, metal, role });

    if (id === 'scatter') {
      // 上下二連の太いショットガン
      box(0, -0.005, 0.0, 0.062, 0.06, 0.2, steel, null, 0.4, 0.75);            // 機関部
      box(0, 0.028, -0.04, 0.05, 0.022, 0.12, steelLight, null, 0.35, 0.8);      // 上部レシーバー
      box(0.0, -0.062, -0.055, 0.045, 0.08, 0.06, grip, null, 0.62, 0.15);       // グリップ
      box(0, -0.02, -0.14, 0.05, 0.062, 0.13, [0.1, 0.075, 0.06], null, 0.68, 0.1); // ストック
      const bl = 0.19 + level * 0.022;
      cyl(0, 0.016, 0.1 + bl / 2, 0.034, bl, gunmetal, null, 0.3, 0.9, 'muzzle');  // 上銃身
      cyl(0, -0.02, 0.1 + bl / 2, 0.034, bl, gunmetal, null, 0.3, 0.9);            // 下銃身
      if (level >= 2) {
        cyl(0, -0.002, 0.14, 0.075, 0.1, steel, null, 0.45, 0.7);                  // ヒートシールド
        box(0, -0.055, 0.09, 0.05, 0.032, 0.1, gunmetal, null, 0.5, 0.5, 'pump');  // ポンプ
      } else {
        box(0, -0.055, 0.07, 0.045, 0.03, 0.09, gunmetal, null, 0.5, 0.5, 'pump');
      }
      if (level >= 3) {
        cyl(0, 0.016, 0.13 + bl, 0.046, 0.05, steelLight, null, 0.35, 0.85);       // マズルチョーク
        cyl(0, -0.02, 0.13 + bl, 0.046, 0.05, steelLight, null, 0.35, 0.85);
        for (let i = 0; i < 3; i++) box(0.05, -0.03 + i * 0.018, -0.02, 0.012, 0.014, 0.05, [0.35, 0.2, 0.08], null, 0.5, 0.4);
      }
      box(0, 0.045, 0.02, 0.026, 0.012, 0.08, accent, glow, 0.2, 0.1);             // 発光ライン
      if (level >= 4) {
        for (let i = 0; i < 3; i++) cyl(0, -0.002, 0.14 + i * 0.06, 0.088, 0.016, accent, glow, 0.25, 0.3);
        box(0, -0.038, 0.0, 0.03, 0.02, 0.05, accent, glow.map((c) => c * 1.4), 0.2, 0.1);
      }
      return parts;
    }

    if (id === 'smg') {
      // 小型で縦に長い弾倉を持つ短機関銃
      box(0, 0, 0.02, 0.044, 0.052, 0.17, steel, null, 0.4, 0.78);
      box(0, 0.032, 0.0, 0.036, 0.014, 0.15, steelLight, null, 0.35, 0.82);        // 上部レール
      box(0, -0.055, -0.03, 0.038, 0.075, 0.05, grip, null, 0.6, 0.15);            // グリップ
      box(0, -0.062, 0.06, 0.03, 0.1, 0.042, gunmetal, null, 0.5, 0.45, 'mag');    // 弾倉
      const bl = 0.1 + level * 0.014;
      cyl(0, 0.008, 0.12 + bl / 2, 0.022, bl, gunmetal, null, 0.28, 0.92, 'muzzle');
      if (level >= 2) {
        box(0, 0.05, 0.05, 0.018, 0.02, 0.03, gunmetal, null, 0.4, 0.6);           // ドットサイト
        box(0, 0.058, 0.05, 0.016, 0.006, 0.024, accent, glow, 0.2, 0.1);
        box(0, -0.04, 0.13, 0.03, 0.035, 0.05, gunmetal, null, 0.55, 0.4);         // フォアグリップ
      }
      if (level >= 3) cyl(0, 0.008, 0.14 + bl, 0.042, 0.09, steel, null, 0.42, 0.8); // サプレッサー
      if (level >= 4) {
        cyl(0.024, 0.008, 0.12 + bl / 2, 0.018, bl, gunmetal, null, 0.28, 0.92, 'muzzle');
        for (let i = 0; i < 4; i++) box(0.026, 0.01, 0.0 + i * 0.03, 0.006, 0.02, 0.016, accent, glow, 0.2, 0.2);
      }
      box(0, -0.012, 0.05, 0.03, 0.024, 0.05, accent, glow, 0.2, 0.1);             // エネルギーセル
      return parts;
    }

    if (id === 'rail') {
      // 長身のレールライフル
      box(0, 0, 0.02, 0.05, 0.058, 0.3, steel, null, 0.35, 0.82);
      box(0, -0.062, -0.06, 0.042, 0.08, 0.055, grip, null, 0.6, 0.15);
      box(0, -0.02, -0.16, 0.046, 0.07, 0.1, [0.09, 0.09, 0.11], null, 0.6, 0.3);   // ストック
      cyl(0, 0.052, 0.02, 0.04, 0.13, gunmetal, null, 0.3, 0.85);                   // スコープ
      cyl(0, 0.052, 0.088, 0.032, 0.012, accent, glow.map((c) => c * 1.6), 0.15, 0.1); // レンズ
      const bl = 0.24 + level * 0.03;
      cyl(0, 0.004, 0.17 + bl / 2, 0.022, bl, gunmetal, null, 0.24, 0.94, 'muzzle');
      for (const side of [-1, 1]) {  // 加速レール（発光）
        box(side * 0.03, 0.004, 0.17 + bl / 2, 0.008, 0.03, bl * 0.9, accent, glow, 0.2, 0.25);
      }
      box(0, -0.05, 0.06, 0.055, 0.05, 0.08, gunmetal, null, 0.45, 0.55, 'mag');    // キャパシタ
      if (level >= 2) {
        for (let i = 0; i < 3; i++) cyl(0, 0.004, 0.2 + i * 0.09, 0.062, 0.018, steelLight, glow.map((c) => c * 0.25), 0.3, 0.7);
      }
      if (level >= 3) {
        for (const side of [-1, 1]) cyl(side * 0.02, -0.05, 0.24, 0.014, 0.1, steel, null, 0.4, 0.8);  // バイポッド
      }
      if (level >= 4) {
        for (const side of [-1, 1]) box(side * 0.026, 0.004, 0.2 + bl, 0.012, 0.05, 0.06, steelLight, glow, 0.25, 0.6);
        box(0, 0.03, -0.05, 0.03, 0.016, 0.06, accent, glow.map((c) => c * 1.5), 0.2, 0.1);
      }
      return parts;
    }

    // blaster: エネルギーハンドガン
    box(0, 0, 0.02, 0.044, 0.05, 0.16, steel, null, 0.38, 0.8);                     // スライド
    box(0, -0.055, -0.02, 0.038, 0.075, 0.048, grip, null, 0.6, 0.15);              // グリップ
    box(0, -0.052, 0.03, 0.03, 0.06, 0.038, gunmetal, null, 0.5, 0.45, 'mag');      // 弾倉
    const bl = 0.09 + level * 0.018;
    cyl(0, 0.006, 0.11 + bl / 2, 0.024, bl, gunmetal, null, 0.28, 0.92, 'muzzle');  // 銃身
    box(0, -0.006, 0.05, 0.03, 0.026, 0.05, accent, glow, 0.2, 0.1);                // エネルギーセル
    if (level >= 2) {
      box(0, 0.032, 0.04, 0.022, 0.012, 0.1, steelLight, null, 0.35, 0.82);         // トップレール
      box(0, 0.046, 0.0, 0.016, 0.016, 0.024, gunmetal, null, 0.4, 0.6);            // リアサイト
    }
    if (level >= 3) {
      for (const side of [-1, 1]) cyl(side * 0.032, 0.0, 0.09, 0.02, 0.08, steel, glow.map((c) => c * 0.3), 0.32, 0.75); // サイドポッド
      box(0, -0.03, 0.02, 0.024, 0.014, 0.03, accent, glow.map((c) => c * 1.3), 0.2, 0.1); // 弾数表示
    }
    if (level >= 4) {
      for (let i = 0; i < 3; i++) cyl(0, 0.006, 0.1 + i * 0.045, 0.046, 0.014, accent, glow, 0.22, 0.3); // 加速コイル
      cyl(0, 0.006, 0.13 + bl, 0.038, 0.045, steelLight, glow.map((c) => c * 0.5), 0.3, 0.8);            // マズルブレーキ
    }
    return parts;
  }

  /**
   * 武器を一人称視点で描く。
   *
   * カメラの右・上・前ベクトルを基準に配置するので、見上げ・見下ろしでも
   * 手元の見え方が破綻しない。反動・リロード・持ち替えはこの基準に対する
   * オフセットと回転で表現する。
   */
  _drawWeapon(game, camPos, angle, pitch) {
    const p = game.player;
    const w = game.currentWeapon ? game.currentWeapon() : null;
    if (!w) return;
    const def = WEAPONS[w.id];

    // --- アニメーション状態 ---
    const recoil = p.recoil || 0;
    const reloading = p.reloadT > 0;
    const reloadT = p.reloadTotal ? 1 - p.reloadT / p.reloadTotal : 1;
    const switchRatio = p.switchTotal ? p.switchT / p.switchTotal : 0;
    const lower = p.switchT > 0 ? 1 - Math.abs(switchRatio - 0.5) * 2 : 0;

    let animF = -recoil * 0.05 * def.kick;
    let animU = -recoil * 0.014 * def.kick;
    let animPitch = recoil * 0.2 * def.kick;
    let magDrop = 0;
    let pumpSlide = 0;

    if (reloading) {
      const dip = Math.sin(reloadT * Math.PI);
      animU -= dip * 0.12;
      animF -= dip * 0.04;
      animPitch -= dip * 0.9;
      magDrop = reloadT < 0.5 ? (reloadT / 0.5) * 0.14 : (1 - (reloadT - 0.5) / 0.5) * 0.14;
      pumpSlide = Math.sin(reloadT * Math.PI * 2) * 0.05;
    } else if (recoil > 0 && def.id === 'scatter') {
      pumpSlide = recoil * 0.06;
    }

    animU -= lower * 0.42;
    animPitch -= lower * 1.3;

    const bobR = Math.sin(game.bob) * 0.011;
    const bobU = Math.abs(Math.cos(game.bob)) * 0.009;
    const sway = Math.sin(game.elapsed * 1.2) * 0.003;

    // --- カメラ基準の直交基底 ---
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const fwd = [Math.cos(angle) * cp, sp, Math.sin(angle) * cp];
    const right = [Math.cos(angle + Math.PI / 2), 0, Math.sin(angle + Math.PI / 2)];
    const up = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ];

    const baseR = 0.105 + bobR + sway;
    const baseU = -0.135 + bobU + animU;
    const baseF = 0.42 + animF;   // 少し前に構えると画面占有が減り歪みも小さい
    const gunScale = 0.9;
    const cosA = Math.cos(animPitch);
    const sinA = Math.sin(animPitch);

    const parts = Renderer3D.weaponParts(w.id, w.level, def.accent);
    this.ambientBoost = 0.45; // 手元は常に見えるようにする

    const placePart = (part, extraScale) => {
      let u = part.u;
      let f = part.f;
      if (part.role === 'mag') u -= magDrop;
      if (part.role === 'pump') f -= pumpSlide;
      const ru = u * cosA - f * sinA;
      const rf = u * sinA + f * cosA;
      const offR = baseR + part.r * gunScale;
      const offU = baseU + ru * gunScale;
      const offF = baseF + rf * gunScale;
      const x = camPos[0] + right[0] * offR + up[0] * offU + fwd[0] * offF;
      const y = camPos[1] + right[1] * offR + up[1] * offU + fwd[1] * offF;
      const z = camPos[2] + right[2] * offR + up[2] * offU + fwd[2] * offF;
      const k = (extraScale || 1) * gunScale;
      compose(this.model, [x, y, z], yawFor(angle), pitch + animPitch,
        [part.sx * k, part.sy * k, part.sz * k]);
      const mesh = part.mesh === 'cyl' ? this.cyl : this.box;
      this._drawMesh(mesh, this.model, part.color, part.emissive, part.rough, part.metal);
    };

    for (const part of parts) placePart(part);
    this.ambientBoost = 0;

    // 銃口の閃光
    if (p.flash > 0) {
      const muzzle = parts.filter((x) => x.role === 'muzzle').pop() || parts[0];
      const size = 0.05 + p.flash * (def.id === 'scatter' ? 1.2 : 0.7);
      const glow = p.flash * (def.id === 'rail' ? 24 : 15);
      placePart({
        mesh: 'box',
        r: muzzle.r, u: muzzle.u, f: muzzle.f + muzzle.sz * 0.5 + size * 0.4,
        sx: size, sy: size, sz: size * 1.4,
        color: [1, 0.93, 0.8], emissive: [glow, glow * 0.8, glow * 0.5],
        rough: 0.1, metal: 0,
      });
    }
  }

  _postProcess() {
    const gl = this.gl;
    const q = this.quality;
    gl.bindVertexArray(this.quadVao);

    let bloomTex = this.sceneTarget.tex;
    if (q.bloom > 0) {
      // 明るい部分を抽出
      gl.useProgram(this.progBright.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
      gl.viewport(0, 0, this.bloomA.width, this.bloomA.height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.tex);
      gl.uniform1i(this.progBright.uniforms.uTex, 0);
      gl.uniform1f(this.progBright.uniforms.uThreshold, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 横 → 縦のガウスぼかし
      gl.useProgram(this.progBlur.p);
      for (let pass = 0; pass < 2; pass++) {
        const src = pass === 0 ? this.bloomA : this.bloomB;
        const dst = pass === 0 ? this.bloomB : this.bloomA;
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
        gl.viewport(0, 0, dst.width, dst.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(this.progBlur.uniforms.uTex, 0);
        gl.uniform2f(
          this.progBlur.uniforms.uDir,
          pass === 0 ? 1 / dst.width : 0,
          pass === 0 ? 0 : 1 / dst.height,
        );
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      bloomTex = this.bloomA.tex;
    }

    // 合成（トーンマッピング・周辺減光・粒状ノイズ・色収差）
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.progComposite.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTarget.tex);
    gl.uniform1i(this.progComposite.uniforms.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomTex);
    gl.uniform1i(this.progComposite.uniforms.uBloom, 1);
    gl.uniform1f(this.progComposite.uniforms.uBloomStrength, q.bloom);
    gl.uniform1f(this.progComposite.uniforms.uExposure, q.exposure);
    gl.uniform1f(this.progComposite.uniforms.uGrain, q.grain);
    gl.uniform1f(this.progComposite.uniforms.uAberration, q.aberration);
    gl.uniform1f(this.progComposite.uniforms.uVignette, q.vignette);
    gl.uniform1f(this.progComposite.uniforms.uTime, this.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  }
}
