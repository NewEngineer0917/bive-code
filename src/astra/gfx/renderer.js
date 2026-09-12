/**
 * ASTRA BOND のレンダラ。
 *
 * 描画の流れ:
 *   1. 影パス      … 太陽から見た深度をシャドウマップへ
 *   2. 本描画      … HDR バッファへ 不透明 → 空 → 切り抜き → 水 → 半透明 → 粒子
 *   3. 後処理      … 明部抽出 → ぼかし → ACES + グレード + ビネット + 粒状
 *
 * 静的なメッシュはチャンク単位で視錐台カリングし、材質はテクスチャ配列 +
 * 頂点の材質番号で 1 ドローにまとめている。
 */

import {
  createContext, createProgram, createVao, deleteVao, createTextureArray,
  createFramebuffer, createShadowMap, createFullscreenTriangle
} from './gl.js';
import {
  SHADOW_VS, SHADOW_FS, SCENE_VS, SCENE_FS, SKY_VS, SKY_FS,
  WATER_VS, WATER_FS, PARTICLE_VS, PARTICLE_FS,
  POST_VS, BRIGHT_FS, BLUR_FS, COMPOSITE_FS, MAX_LIGHTS, MAX_BONES
} from './shaders.js';
import { VERTEX_FLOATS } from './builder.js';
import {
  mat4, m4identity, m4mul, m4perspective, m4lookAt, m4ortho, m4invert, m4normalMatrix,
  extractFrustum, sphereInFrustum, v3,
} from '../core/math.js';

const ATTRIBS = [
  { loc: 0, size: 3, offset: 0 },   // position
  { loc: 1, size: 3, offset: 3 },   // normal
  { loc: 2, size: 2, offset: 6 },   // uv
  { loc: 3, size: 3, offset: 8 },   // color
  { loc: 4, size: 1, offset: 11 },  // ao
  { loc: 5, size: 1, offset: 12 },  // wind
  { loc: 6, size: 1, offset: 13 },  // material id
  { loc: 7, size: 1, offset: 14 },  // secondary material id
  { loc: 8, size: 1, offset: 15 },  // blend weight
  { loc: 9, size: 1, offset: 16 },  // bone index (skinning)
];

export const QUALITY_PRESETS = {
  high: { shadowSize: 2048, bloom: true, renderScale: 1.0, normalStrength: 1.0, shadowDistance: 46 },
  medium: { shadowSize: 1536, bloom: true, renderScale: 0.85, normalStrength: 0.85, shadowDistance: 38 },
  low: { shadowSize: 1024, bloom: false, renderScale: 0.7, normalStrength: 0.5, shadowDistance: 44 }
};

export class Renderer {
  constructor(canvas, materialLib, opts = {}) {
    this.canvas = canvas;
    this.lib = materialLib;
    this.quality = { ...QUALITY_PRESETS[opts.quality || 'high'] };
    this.gl = createContext(canvas);
    if (!this.gl) throw new Error('WebGL2 に対応していません');

    this.staticChunks = [];   // { pass, gpu, bounds }
    this.objects = [];        // 動くもの（プレイヤー・NPC・アストラ）
    this.waterMeshes = [];
    this.lights = [];
    this.activeLights = [];

    this.env = {
      sunDir: v3(0.42, 0.78, 0.46),
      sunColor: v3(1.0, 0.95, 0.86),
      skyColor: v3(0.45, 0.56, 0.72),
      groundColor: v3(0.26, 0.24, 0.2),
      zenith: v3(0.22, 0.42, 0.78),
      horizon: v3(0.72, 0.79, 0.86),
      fogColor: v3(0.68, 0.76, 0.84),
      fogDensity: 0.0026,
      fogHeight: 0.012,
      fogStart: 42,
      aerial: 0.75,
      ambientScale: 0.42,
      nightFactor: 0,
      exposure: 1.0,
      shallowWater: v3(0.22, 0.48, 0.5),
      deepWater: v3(0.04, 0.16, 0.26)
    };

    this.grade = {
      lift: [0.012, 0.018, 0.03],
      gain: [1.02, 1.0, 0.98],
      saturation: 1.1,
      contrast: 1.06,
      vignette: 0.32,
      grain: 0.012,
      aberration: 0.35,
      bloomAmount: 0.55,
      bloomThreshold: 1.0
    };

    this.flash = 0;
    this.flashColor = [1, 1, 1];
    this.time = 0;
    this.wind = { dirX: 0.82, dirZ: 0.57, strength: 0.55 };
    this.stats = { drawCalls: 0, triangles: 0, chunksVisible: 0 };

    this._initGL();
  }

  _initGL() {
    const gl = this.gl;
    this.progShadow = createProgram(gl, SHADOW_VS, SHADOW_FS, 'shadow');
    this.progScene = createProgram(gl, SCENE_VS, SCENE_FS, 'scene');
    this.progSky = createProgram(gl, SKY_VS, SKY_FS, 'sky');
    this.progWater = createProgram(gl, WATER_VS, WATER_FS, 'water');
    this.progParticle = createProgram(gl, PARTICLE_VS, PARTICLE_FS, 'particle');
    this.progBright = createProgram(gl, POST_VS, BRIGHT_FS, 'bright');
    this.progBlur = createProgram(gl, POST_VS, BLUR_FS, 'blur');
    this.progComposite = createProgram(gl, POST_VS, COMPOSITE_FS, 'composite');

    const set = this.lib.texSet;
    this.texAlbedo = createTextureArray(gl, set.albedo, set.size, { srgb: true });
    this.texNormal = createTextureArray(gl, set.normal, set.size, { srgb: false });

    this.shadow = createShadowMap(gl, this.quality.shadowSize);
    this.fsTri = createFullscreenTriangle(gl);

    // 行列の作業領域
    this.mView = mat4();
    this.mProj = mat4();
    this.mViewProj = mat4();
    this.mInvViewProj = mat4();
    this.mLightViewProj = mat4();
    this.mIdentity = m4identity(mat4());
    this.normalMat3 = new Float32Array(9);
    this.frustum = new Float32Array(24);
    this.lightFrustum = new Float32Array(24);

    this.lightPosBuf = new Float32Array(MAX_LIGHTS * 4);
    this.lightColorBuf = new Float32Array(MAX_LIGHTS * 4);

    this._resize();
  }

  _resize() {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(this.canvas.clientWidth * dpr * this.quality.renderScale));
    const h = Math.max(2, Math.floor(this.canvas.clientHeight * dpr * this.quality.renderScale));
    if (this.canvas.width === w && this.canvas.height === h && this.sceneFbo) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
    for (const fb of [this.sceneFbo, this.bloomA, this.bloomB]) {
      if (fb) { gl.deleteFramebuffer(fb.fbo); gl.deleteTexture(fb.color); if (fb.depth) gl.deleteRenderbuffer(fb.depth); }
    }
    this.sceneFbo = createFramebuffer(gl, w, h, { float: true, depth: true });
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.bloomA = createFramebuffer(gl, bw, bh, { float: true });
    this.bloomB = createFramebuffer(gl, bw, bh, { float: true });
  }

  setQuality(name) {
    const preset = QUALITY_PRESETS[name];
    if (!preset) return;
    const gl = this.gl;
    const changedShadow = preset.shadowSize !== this.quality.shadowSize;
    this.quality = { ...preset };
    if (changedShadow) {
      gl.deleteFramebuffer(this.shadow.fbo);
      gl.deleteTexture(this.shadow.tex);
      this.shadow = createShadowMap(gl, this.quality.shadowSize);
    }
    this.sceneFbo = null;
    this._resize();
  }

  /* ------------------------------------------------------------ メッシュ */

  /** MeshBuilder.build() の結果を GPU へ載せる。 */
  uploadBatches(batches) {
    const gl = this.gl;
    return batches.map((b) => ({
      pass: b.pass,
      bounds: b.bounds,
      gpu: createVao(gl, { data: b.data, indices: b.indices, stride: VERTEX_FLOATS, attribs: ATTRIBS }),
      triangles: b.indices.length / 3
    }));
  }

  /** 町のような動かない大物を登録する。 */
  addStatic(batches, opts = {}) {
    const parts = this.uploadBatches(batches);
    if (opts.cullDistance) for (const p of parts) p.cullDistance = opts.cullDistance;
    this.staticChunks.push(...parts);
    return parts;
  }

  clearStatic() {
    for (const c of this.staticChunks) deleteVao(this.gl, c.gpu);
    this.staticChunks.length = 0;
  }

  /** 水面メッシュ（専用シェーダで描く）。 */
  addWater(batches) {
    const parts = this.uploadBatches(batches);
    this.waterMeshes.push(...parts);
    return parts;
  }

  clearWater() {
    for (const c of this.waterMeshes) deleteVao(this.gl, c.gpu);
    this.waterMeshes.length = 0;
  }

  /**
   * 動くオブジェクト。matrix を毎フレーム書き換えて動かす。
   * radius はカリング用の境界球半径（モデル空間）。
   */
  createObject(batches, opts = {}) {
    const parts = this.uploadBatches(batches);
    let r = 0;
    for (const p of parts) r = Math.max(r, Math.hypot(p.bounds.cx, p.bounds.cy, p.bounds.cz) + p.bounds.r);
    const obj = {
      parts,
      // 骨を持つとスキニングで動く（キャラクターと生き物）
      bones: opts.boneCount ? new Float32Array(Math.min(opts.boneCount, MAX_BONES) * 16) : null,
      boneCount: opts.boneCount || 0,
      matrix: m4identity(mat4()),
      normalMat: new Float32Array(9),
      radius: opts.radius || r || 1,
      visible: true,
      castShadow: opts.castShadow !== false,
      dirty: true
    };
    this.objects.push(obj);
    return obj;
  }

  removeObject(obj) {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
    for (const p of obj.parts) deleteVao(this.gl, p.gpu);
  }

  /* ------------------------------------------------------------ ライト */

  setLights(lights) {
    this.lights = lights;
  }

  /** カメラに近い順に MAX_LIGHTS 個だけ選ぶ。 */
  _selectLights(camPos) {
    const scored = [];
    for (const l of this.lights) {
      if (l.enabled === false) continue;
      const intensity = l.intensity * (l.nightOnly ? this.env.nightFactor : 1);
      if (intensity < 0.02) continue;
      const d = Math.hypot(l.pos[0] - camPos[0], l.pos[1] - camPos[1], l.pos[2] - camPos[2]);
      if (d > l.radius + 60) continue;
      // 近く・明るいものを優先
      scored.push({ l, score: d - intensity * 4 - l.radius * 0.3, intensity });
    }
    scored.sort((a, b) => a.score - b.score);
    const n = Math.min(scored.length, MAX_LIGHTS);
    for (let i = 0; i < n; i++) {
      const { l, intensity } = scored[i];
      this.lightPosBuf[i * 4] = l.pos[0];
      this.lightPosBuf[i * 4 + 1] = l.pos[1];
      this.lightPosBuf[i * 4 + 2] = l.pos[2];
      this.lightPosBuf[i * 4 + 3] = l.radius;
      const flicker = l.flicker ? (0.92 + Math.sin(this.time * l.flicker.speed + l.flicker.phase) * 0.05
        + Math.sin(this.time * l.flicker.speed * 2.7 + l.flicker.phase) * 0.03) : 1;
      this.lightColorBuf[i * 4] = l.color[0];
      this.lightColorBuf[i * 4 + 1] = l.color[1];
      this.lightColorBuf[i * 4 + 2] = l.color[2];
      this.lightColorBuf[i * 4 + 3] = intensity * flicker;
    }
    this.activeLightCount = n;
  }

  /* ------------------------------------------------------------- 描画 */

  _uploadMaterialUniforms(prog) {
    const gl = this.gl;
    gl.uniform4fv(prog.u.uMatParams, this.lib.params);
    gl.uniform4fv(prog.u.uMatEmissive, this.lib.emissiveParams);
    gl.uniform4fv(prog.u.uMatExtra, this.lib.extraParams);
  }

  _drawPass(prog, pass, frustum, { shadowPass = false } = {}) {
    const gl = this.gl;
    gl.uniform1i(prog.u.uSkinned, 0);
    this._skinOn = false;
    const cam = this._camPos;
    for (const c of this.staticChunks) {
      if (c.pass !== pass) continue;
      const b = c.bounds;
      // 草のように「近くだけ描けば十分」なものは距離で切る
      if (c.cullDistance && cam) {
        const d = Math.hypot(b.cx - cam[0], b.cz - cam[2]) - b.r;
        if (d > c.cullDistance) continue;
      }
      if (frustum && !sphereInFrustum(frustum, b.cx, b.cy, b.cz, b.r)) continue;
      gl.bindVertexArray(c.gpu.vao);
      gl.drawElements(gl.TRIANGLES, c.gpu.count, c.gpu.indexType, 0);
      this.stats.drawCalls++;
      this.stats.triangles += c.triangles;
    }
    for (const o of this.objects) {
      if (!o.visible) continue;
      if (shadowPass && !o.castShadow) continue;
      const x = o.matrix[12], y = o.matrix[13], z = o.matrix[14];
      const scale = Math.hypot(o.matrix[0], o.matrix[1], o.matrix[2]) || 1;
      if (frustum && !sphereInFrustum(frustum, x, y, z, o.radius * scale)) continue;
      let bound = false;
      for (const p of o.parts) {
        if (p.pass !== pass) continue;
        if (!bound) {
          gl.uniformMatrix4fv(prog.u.uModel, false, o.matrix);
          if (!shadowPass) {
            m4normalMatrix(o.normalMat, o.matrix);
            gl.uniformMatrix3fv(prog.u.uNormalMat, false, o.normalMat);
          }
          if (o.bones) {
            gl.uniform1i(prog.u.uSkinned, 1);
            gl.uniformMatrix4fv(prog.u.uBones, false, o.bones);
          } else if (this._skinOn) {
            gl.uniform1i(prog.u.uSkinned, 0);
          }
          this._skinOn = !!o.bones;
          bound = true;
        }
        gl.bindVertexArray(p.gpu.vao);
        gl.drawElements(gl.TRIANGLES, p.gpu.count, p.gpu.indexType, 0);
        this.stats.drawCalls++;
        this.stats.triangles += p.triangles;
      }
    }
    gl.uniformMatrix4fv(prog.u.uModel, false, this.mIdentity);
    if (!shadowPass) gl.uniformMatrix3fv(prog.u.uNormalMat, false, IDENTITY3);
    if (this._skinOn) { gl.uniform1i(prog.u.uSkinned, 0); this._skinOn = false; }
  }

  /** 太陽の視点でシャドウマップを描く。 */
  _renderShadow(camera) {
    const gl = this.gl;
    const s = this.shadow;
    const dist = this.quality.shadowDistance;
    // プレイヤーの少し前を中心に、テクセル単位でスナップして揺れを止める
    const fx = camera.position[0] + camera.forward[0] * dist * 0.32;
    const fz = camera.position[2] + camera.forward[2] * dist * 0.32;
    const texelSize = (dist * 2) / s.size;
    const cx = Math.round(fx / texelSize) * texelSize;
    const cz = Math.round(fz / texelSize) * texelSize;
    const cy = camera.position[1];
    const d = this.env.sunDir;
    const eye = [cx + d[0] * 90, cy + d[1] * 90, cz + d[2] * 90];
    m4lookAt(this.mView, eye, [cx, cy, cz], [0, 1, 0]);
    m4ortho(this.mProj, -dist, dist, -dist, dist, 1, 200);
    m4mul(this.mLightViewProj, this.mProj, this.mView);
    extractFrustum(this.lightFrustum, this.mLightViewProj);

    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
    gl.viewport(0, 0, s.size, s.size);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    // 影のピーターパン化を抑えるため裏面を描き、さらに深度を押し下げて
    // 細い手足に出る自己遮蔽（黒い斑点）を消す
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2.5, 4.0);

    const p = this.progShadow;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uLightViewProj, false, this.mLightViewProj);
    gl.uniformMatrix4fv(p.u.uModel, false, this.mIdentity);
    gl.uniform4f(p.u.uWind, this.wind.dirX, this.wind.dirZ, this.wind.strength, this.time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texAlbedo);
    gl.uniform1i(p.u.uAlbedo, 0);
    this._uploadMaterialUniforms(p);

    this._drawPass(p, 'opaque', this.lightFrustum, { shadowPass: true });
    gl.disable(gl.CULL_FACE);
    this._drawPass(p, 'cutout', this.lightFrustum, { shadowPass: true });
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  _bindSceneUniforms(p, camera) {
    const gl = this.gl;
    const e = this.env;
    gl.uniformMatrix4fv(p.u.uViewProj, false, this.mViewProj);
    gl.uniformMatrix4fv(p.u.uModel, false, this.mIdentity);
    gl.uniformMatrix3fv(p.u.uNormalMat, false, IDENTITY3);
    gl.uniformMatrix4fv(p.u.uLightViewProj, false, this.mLightViewProj);
    gl.uniform3fv(p.u.uCameraPos, camera.position);
    gl.uniform3fv(p.u.uSunDir, e.sunDir);
    gl.uniform3fv(p.u.uSunColor, e.sunColor);
    gl.uniform3fv(p.u.uSkyColor, e.skyColor);
    gl.uniform3fv(p.u.uGroundColor, e.groundColor);
    gl.uniform1f(p.u.uNightFactor, e.nightFactor);
    gl.uniform3fv(p.u.uFogColor, e.fogColor);
    gl.uniform4f(p.u.uFogParams, e.fogDensity, e.fogHeight, e.fogStart, e.aerial);
    gl.uniform2f(p.u.uShadowTexel, 1 / this.shadow.size, 1 / this.shadow.size);
    gl.uniform1f(p.u.uShadowStrength, 1.0);
    gl.uniform1f(p.u.uNormalStrength, this.quality.normalStrength);
    gl.uniform1f(p.u.uAmbientScale, e.ambientScale);
    gl.uniform4f(p.u.uWind, this.wind.dirX, this.wind.dirZ, this.wind.strength, this.time);
    gl.uniform1i(p.u.uLightCount, this.activeLightCount);
    if (this.activeLightCount > 0) {
      gl.uniform4fv(p.u.uLightPos, this.lightPosBuf);
      gl.uniform4fv(p.u.uLightColor, this.lightColorBuf);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texAlbedo);
    gl.uniform1i(p.u.uAlbedo, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texNormal);
    gl.uniform1i(p.u.uNormalTex, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.shadow.tex);
    gl.uniform1i(p.u.uShadowMap, 2);
    this._uploadMaterialUniforms(p);
  }

  /**
   * 1 フレーム描く。
   * camera: { position, forward, fov, near, far, viewMatrix? }
   */
  render(camera, dt, particles) {
    const gl = this.gl;
    this.time += dt;
    this._resize();

    const aspect = this.width / this.height;
    m4perspective(this.mProj, camera.fov, aspect, camera.near, camera.far);
    if (camera.viewMatrix) this.mView.set(camera.viewMatrix);
    else {
      const target = [
        camera.position[0] + camera.forward[0],
        camera.position[1] + camera.forward[1],
        camera.position[2] + camera.forward[2],
      ];
      m4lookAt(this.mView, camera.position, target, [0, 1, 0]);
    }
    m4mul(this.mViewProj, this.mProj, this.mView);
    m4invert(this.mInvViewProj, this.mViewProj);
    extractFrustum(this.frustum, this.mViewProj);

    this.stats.drawCalls = 0;
    this.stats.triangles = 0;
    this._camPos = camera.position;
    this._selectLights(camera.position);

    this._renderShadow(camera);

    // ---- 本描画
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const p = this.progScene;
    gl.useProgram(p.prog);
    this._bindSceneUniforms(p, camera);
    this._drawPass(p, 'opaque', this.frustum);

    // 空（不透明の後ろだけ埋める）
    this._renderSky(camera);

    // 切り抜き（葉・草）は両面
    gl.useProgram(p.prog);
    gl.disable(gl.CULL_FACE);
    this._drawPass(p, 'cutout', this.frustum);
    gl.enable(gl.CULL_FACE);

    // 水
    this._renderWater(camera);

    // 半透明
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(p.prog);
    this._bindSceneUniforms(p, camera);
    this._drawPass(p, 'transparent', this.frustum);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // 粒子
    if (particles) this._renderParticles(camera, particles);

    // ---- 後処理
    this._postProcess(dt);
  }

  _renderSky(camera) {
    const gl = this.gl;
    const p = this.progSky;
    gl.useProgram(p.prog);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(p.u.uInvViewProj, false, this.mInvViewProj);
    gl.uniform3fv(p.u.uSunDir, this.env.sunDir);
    gl.uniform3fv(p.u.uSunColor, this.env.sunColor);
    gl.uniform3fv(p.u.uZenith, this.env.zenith);
    gl.uniform3fv(p.u.uHorizon, this.env.horizon);
    gl.uniform3fv(p.u.uGroundColor, this.env.groundColor);
    gl.uniform1f(p.u.uNightFactor, this.env.nightFactor);
    gl.uniform1f(p.u.uTime, this.time);
    gl.uniform2f(p.u.uCloudOffset, this.time * 0.0042 * this.wind.dirX, this.time * 0.0042 * this.wind.dirZ);
    gl.bindVertexArray(this.fsTri.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.drawCalls++;
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
  }

  _renderWater(camera) {
    if (!this.waterMeshes.length) return;
    const gl = this.gl;
    const p = this.progWater;
    const e = this.env;
    gl.useProgram(p.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(p.u.uViewProj, false, this.mViewProj);
    gl.uniform1f(p.u.uTime, this.time);
    gl.uniform3fv(p.u.uCameraPos, camera.position);
    gl.uniform3fv(p.u.uSunDir, e.sunDir);
    gl.uniform3fv(p.u.uSunColor, e.sunColor);
    gl.uniform3fv(p.u.uSkyColor, e.skyColor);
    gl.uniform3fv(p.u.uHorizon, e.horizon);
    gl.uniform3fv(p.u.uFogColor, e.fogColor);
    gl.uniform4f(p.u.uFogParams, e.fogDensity, e.fogHeight, e.fogStart, e.aerial);
    gl.uniform3fv(p.u.uShallowColor, e.shallowWater);
    gl.uniform3fv(p.u.uDeepColor, e.deepWater);
    gl.uniform1f(p.u.uNightFactor, e.nightFactor);
    gl.uniform1i(p.u.uLightCount, this.activeLightCount);
    if (this.activeLightCount > 0) {
      gl.uniform4fv(p.u.uLightPos, this.lightPosBuf);
      gl.uniform4fv(p.u.uLightColor, this.lightColorBuf);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.texNormal);
    gl.uniform1i(p.u.uNormalTex, 1);
    gl.uniform1f(p.u.uWaterLayer, this.lib.texSet.index.water);
    for (const w of this.waterMeshes) {
      const b = w.bounds;
      if (!sphereInFrustum(this.frustum, b.cx, b.cy, b.cz, b.r)) continue;
      gl.bindVertexArray(w.gpu.vao);
      gl.drawElements(gl.TRIANGLES, w.gpu.count, w.gpu.indexType, 0);
      this.stats.drawCalls++;
      this.stats.triangles += w.triangles;
    }
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  _renderParticles(camera, particles) {
    const gl = this.gl;
    const count = particles.upload(gl);
    if (!count) return;
    const p = this.progParticle;
    gl.useProgram(p.prog);
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(p.u.uViewProj, false, this.mViewProj);
    // ビュー行列から画面右／上のベクトルを取り出してビルボードにする
    gl.uniform3f(p.u.uCameraRight, this.mView[0], this.mView[4], this.mView[8]);
    gl.uniform3f(p.u.uCameraUp, this.mView[1], this.mView[5], this.mView[9]);
    particles.draw(gl);
    this.stats.drawCalls += 2;
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
  }

  _postProcess(dt) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.fsTri.vao);

    let bloomTex = this.bloomB.color;
    if (this.quality.bloom) {
      // 明部抽出
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA.fbo);
      gl.viewport(0, 0, this.bloomA.width, this.bloomA.height);
      gl.useProgram(this.progBright.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneFbo.color);
      gl.uniform1i(this.progBright.u.uTex, 0);
      gl.uniform1f(this.progBright.u.uThreshold, this.grade.bloomThreshold);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 横 → 縦 を 2 往復
      gl.useProgram(this.progBlur.prog);
      gl.uniform1i(this.progBlur.u.uTex, 0);
      let src = this.bloomA, dst = this.bloomB;
      for (let i = 0; i < 2; i++) {
        for (const dir of [[1, 0], [0, 1]]) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
          gl.viewport(0, 0, dst.width, dst.height);
          gl.bindTexture(gl.TEXTURE_2D, src.color);
          gl.uniform2f(this.progBlur.u.uDir, dir[0] / dst.width * (1 + i), dir[1] / dst.height * (1 + i));
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const t = src; src = dst; dst = t;
        }
      }
      bloomTex = src.color;
    }

    // 合成
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    const c = this.progComposite;
    gl.useProgram(c.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFbo.color);
    gl.uniform1i(c.u.uScene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomTex);
    gl.uniform1i(c.u.uBloom, 1);
    const g = this.grade;
    gl.uniform1f(c.u.uBloomAmount, this.quality.bloom ? g.bloomAmount : 0);
    gl.uniform1f(c.u.uExposure, this.env.exposure);
    gl.uniform1f(c.u.uVignette, g.vignette);
    gl.uniform1f(c.u.uGrain, g.grain);
    gl.uniform1f(c.u.uAberration, g.aberration);
    gl.uniform1f(c.u.uTime, this.time);
    gl.uniform3fv(c.u.uLift, g.lift);
    gl.uniform3fv(c.u.uGain, g.gain);
    gl.uniform1f(c.u.uSaturation, g.saturation);
    gl.uniform1f(c.u.uContrast, g.contrast);
    gl.uniform1f(c.u.uFlash, this.flash);
    gl.uniform3fv(c.u.uFlashColor, this.flashColor);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    this.flash = Math.max(0, this.flash - dt * 3.2);
    gl.enable(gl.DEPTH_TEST);
  }

  /** 画面を一瞬光らせる（被弾・進化・カットイン）。 */
  triggerFlash(amount, color = [1, 1, 1]) {
    this.flash = Math.max(this.flash, amount);
    this.flashColor = color;
  }

  dispose() {
    const gl = this.gl;
    this.clearStatic();
    this.clearWater();
    for (const o of [...this.objects]) this.removeObject(o);
    gl.deleteTexture(this.texAlbedo);
    gl.deleteTexture(this.texNormal);
  }
}

const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
