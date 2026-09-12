/**
 * GLSL（WebGL2 / GLSL ES 3.00）。
 *
 * 方針:
 *  - 物理ベース（GGX + Smith + Schlick）で、Stylized に寄せた色作り。
 *  - 太陽 1 灯 + シャドウマップ + 点光源（街灯・窓・Nova クリスタル）。
 *  - 環境光は空／地面の 2 色による半球ライティングで、事前計算 AO を掛ける。
 *  - 風は共通パラメータ 1 組で、草・木・旗・布・水面がすべて同じ風に揺れる。
 *  - HDR で描いてから ACES トーンマッピングとカラーグレードを通す。
 */

export const MAX_MATERIALS = 40;
export const MAX_BONES = 40;
export const MAX_LIGHTS = 24;

/** 全シェーダ共通の前置き（ライティング関数など）。 */
const COMMON = /* glsl */`
precision highp float;
precision highp sampler2DArray;
precision highp sampler2DShadow;

const float PI = 3.14159265359;

float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 saturate3(vec3 x) { return clamp(x, 0.0, 1.0); }

// GGX 法線分布
float distributionGGX(float NdotH, float rough) {
  float a = rough * rough;
  float a2 = a * a;
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-5);
}
// Smith の幾何減衰（Schlick-GGX）
float geometrySmith(float NdotV, float NdotL, float rough) {
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float gv = NdotV / (NdotV * (1.0 - k) + k);
  float gl = NdotL / (NdotL * (1.0 - k) + k);
  return gv * gl;
}
vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}
`;

const SKINNING = /* glsl */`
// ----- スキニング（1 頂点 1 骨の剛体変形）
// 関節は球で覆うので、剛体でも折れ目が見えない。
// 骨を持たないメッシュは uSkinned = 0 で素通しする。
uniform int uSkinned;
uniform mat4 uBones[${MAX_BONES}];
void skin(inout vec3 pos, inout vec3 nrm, float boneIndex) {
  if (uSkinned == 0) return;
  mat4 B = uBones[int(boneIndex + 0.5)];
  pos = (B * vec4(pos, 1.0)).xyz;
  nrm = mat3(B) * nrm;
}
`;

/** 風による頂点変位。草・葉・布で共通。 */
const WIND = /* glsl */`
uniform vec4 uWind;      // xy: 風向, z: 強さ, w: 時間
// 揺れは「大きくゆっくりした波」+「細かい葉ずれ」の 2 層で作る
vec3 windOffset(vec3 worldPos, float weight) {
  if (weight <= 0.0001) return vec3(0.0);
  float t = uWind.w;
  float phase = worldPos.x * 0.22 + worldPos.z * 0.31;
  float gust = sin(t * 0.55 + phase) * 0.6 + sin(t * 0.23 + phase * 0.4) * 0.4;
  gust = gust * 0.5 + 0.5;
  float sway = sin(t * 1.9 + phase * 2.7) * 0.5 + sin(t * 3.4 + phase * 5.1) * 0.25;
  float amp = uWind.z * weight * (0.45 + gust * 0.9);
  vec3 dir = vec3(uWind.x, 0.0, uWind.y);
  vec3 side = vec3(-uWind.y, 0.0, uWind.x);
  return dir * amp * (0.6 + sway * 0.5) + side * amp * sway * 0.35
       + vec3(0.0, -amp * abs(sway) * 0.18, 0.0);
}
`;

/* ==================================================== 影（深度）パス */

export const SHADOW_VS = /* glsl */`#version 300 es
${COMMON}
layout(location = 0) in vec3 aPos;
layout(location = 5) in float aWind;
layout(location = 6) in float aMat;
layout(location = 9) in float aBone;
${SKINNING}
${WIND}
uniform mat4 uLightViewProj;
uniform mat4 uModel;
out vec2 vUV;
flat out float vMat;
layout(location = 2) in vec2 aUV;
void main() {
  vec3 local = aPos;
  vec3 dummy = vec3(0.0, 1.0, 0.0);
  skin(local, dummy, aBone);
  vec3 world = (uModel * vec4(local, 1.0)).xyz;
  world += windOffset(world, aWind);
  vUV = aUV;
  vMat = aMat;
  gl_Position = uLightViewProj * vec4(world, 1.0);
}
`;

export const SHADOW_FS = /* glsl */`#version 300 es
${COMMON}
uniform sampler2DArray uAlbedo;
uniform vec4 uMatParams[${MAX_MATERIALS}];
uniform vec4 uMatExtra[${MAX_MATERIALS}];
in vec2 vUV;
flat in float vMat;
void main() {
  int mi = int(vMat + 0.5);
  float cutoff = uMatExtra[mi].x;
  if (cutoff > 0.01) {
    float a = texture(uAlbedo, vec3(vUV, uMatParams[mi].w)).a;
    if (a < cutoff) discard;
  }
}
`;

/* ========================================================= 本描画パス */

export const SCENE_VS = /* glsl */`#version 300 es
${COMMON}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec3 aColor;
layout(location = 4) in float aAO;
layout(location = 5) in float aWind;
layout(location = 6) in float aMat;
layout(location = 7) in float aMat2;
layout(location = 8) in float aBlend;
layout(location = 9) in float aBone;
${SKINNING}
${WIND}

uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform vec3 uCameraPos;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec3 vColor;
out float vAO;
flat out float vMat;
flat out float vMat2;
out float vBlend;
out float vViewDist;

void main() {
  vec3 local = aPos;
  vec3 localN = aNormal;
  skin(local, localN, aBone);
  vec3 world = (uModel * vec4(local, 1.0)).xyz;
  world += windOffset(world, aWind);
  vWorld = world;
  vNormal = normalize(uNormalMat * localN);
  vUV = aUV;
  vColor = aColor;
  vAO = aAO;
  vMat = aMat;
  vMat2 = aMat2;
  vBlend = aBlend;
  vViewDist = distance(world, uCameraPos);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const SCENE_FS = /* glsl */`#version 300 es
${COMMON}

in vec3 vWorld;
in vec3 vNormal;
in vec2 vUV;
in vec3 vColor;
in float vAO;
flat in float vMat;
flat in float vMat2;
in float vBlend;
in float vViewDist;

uniform sampler2DArray uAlbedo;
uniform sampler2DArray uNormalTex;
uniform sampler2DShadow uShadowMap;

uniform vec4 uMatParams[${MAX_MATERIALS}];    // x:rough y:metal z:spec w:texLayer
uniform vec4 uMatEmissive[${MAX_MATERIALS}];  // rgb:emissive w:nightOnly
uniform vec4 uMatExtra[${MAX_MATERIALS}];     // x:cutoff y:translucency z:opacity

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform vec3 uCameraPos;
uniform float uNightFactor;
uniform mat4 uLightViewProj;
uniform vec2 uShadowTexel;
uniform float uShadowStrength;

uniform int uLightCount;
uniform vec4 uLightPos[${MAX_LIGHTS}];    // xyz + radius
uniform vec4 uLightColor[${MAX_LIGHTS}];  // rgb + intensity

uniform vec3 uFogColor;
uniform vec4 uFogParams;   // x:density y:heightFalloff z:startDist w:aerialAmount
uniform float uNormalStrength;
uniform float uAmbientScale;   // 太陽との明暗差を作るための環境光の強さ

layout(location = 0) out vec4 fragColor;

// 接空間を画面微分から作る（接線属性を持たない代わり）
mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p);
  vec3 dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-8);
  return mat3(T * invmax, B * invmax, N);
}

float sampleShadow(vec3 world, vec3 N, float NdotL) {
  vec4 lp = uLightViewProj * vec4(world + N * (0.09 + (1.0 - NdotL) * 0.3), 1.0);
  vec3 proj = lp.xyz / lp.w * 0.5 + 0.5;
  if (proj.z > 1.0 || proj.x < 0.002 || proj.x > 0.998 || proj.y < 0.002 || proj.y > 0.998) return 1.0;
  float bias = 0.0022 + (1.0 - NdotL) * 0.006;
  float sum = 0.0;
  // 5 タップの回転気味 PCF。境界を柔らかくしつつコストを抑える
  sum += texture(uShadowMap, vec3(proj.xy, proj.z - bias));
  sum += texture(uShadowMap, vec3(proj.xy + vec2( 1.3,  0.4) * uShadowTexel, proj.z - bias));
  sum += texture(uShadowMap, vec3(proj.xy + vec2(-1.1,  0.9) * uShadowTexel, proj.z - bias));
  sum += texture(uShadowMap, vec3(proj.xy + vec2( 0.4, -1.3) * uShadowTexel, proj.z - bias));
  sum += texture(uShadowMap, vec3(proj.xy + vec2(-0.6, -1.0) * uShadowTexel, proj.z - bias));
  float s = sum / 5.0;
  // 影マップの端で急に明るくならないようフェード
  vec2 d = abs(proj.xy - 0.5) * 2.0;
  float fade = 1.0 - smoothstep(0.82, 1.0, max(d.x, d.y));
  return mix(1.0, s, fade);
}

void main() {
  int mi = int(vMat + 0.5);
  vec4 params = uMatParams[mi];
  vec4 emissiveParams = uMatEmissive[mi];
  vec4 extra = uMatExtra[mi];
  float layer = params.w;

  vec4 tex = texture(uAlbedo, vec3(vUV, layer));
  vec4 nrmTex = texture(uNormalTex, vec3(vUV, layer));
  float roughness0 = params.x;

  // 地面などは 2 つ目の材質へ滑らかに混ぜる（石畳 → 芝 の境目を作らない）
  float blend = vBlend;
  if (blend > 0.003) {
    int mi2 = int(vMat2 + 0.5);
    vec4 params2 = uMatParams[mi2];
    vec4 tex2 = texture(uAlbedo, vec3(vUV, params2.w));
    vec4 nrm2 = texture(uNormalTex, vec3(vUV, params2.w));
    // 高さ（ノーマルの Z 成分の弱さ＝凹凸の強さ）を使ったハードミックスで
    // 単純な線形補間よりも自然な境界にする
    float w1 = (1.0 - blend) * (0.55 + nrmTex.a * 0.45);
    float w2 = blend * (0.55 + nrm2.a * 0.45);
    float k = w2 / max(w1 + w2, 1e-4);
    k = smoothstep(0.25, 0.75, k);
    tex = mix(tex, tex2, k);
    nrmTex = mix(nrmTex, nrm2, k);
    roughness0 = mix(params.x, params2.x, k);
  }

  if (extra.x > 0.01 && tex.a < extra.x) discard;

  vec3 albedo = tex.rgb * vColor;
  float roughness = clamp(nrmTex.a * roughness0, 0.045, 1.0);
  float metallic = params.y;
  float specular = params.z;

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCameraPos - vWorld);
  if (!gl_FrontFacing) N = -N;

  // 法線マップ（遠景では平らに戻してちらつきを防ぐ）
  float nrmFade = 1.0 - smoothstep(22.0, 60.0, vViewDist);
  if (nrmFade > 0.01) {
    vec3 tn = nrmTex.xyz * 2.0 - 1.0;
    tn.xy *= uNormalStrength * nrmFade;
    N = normalize(cotangentFrame(N, -V, vUV) * normalize(tn));
  }

  float NdotV = max(dot(N, V), 1e-4);
  vec3 F0 = mix(vec3(0.04 * specular * 2.0), albedo, metallic);

  // ---- 太陽
  vec3 L = normalize(uSunDir);
  float NdotL = dot(N, L);
  vec3 direct = vec3(0.0);
  float shadow = 1.0;
  if (NdotL > 0.0) {
    shadow = mix(1.0, sampleShadow(vWorld, N, NdotL), uShadowStrength);
    vec3 H = normalize(L + V);
    float NdotH = max(dot(N, H), 0.0);
    float D = distributionGGX(NdotH, roughness);
    float G = geometrySmith(NdotV, NdotL, roughness);
    vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);
    vec3 spec = (D * G * F) / max(4.0 * NdotV * NdotL, 1e-4);
    vec3 kd = (1.0 - F) * (1.0 - metallic);
    direct = (kd * albedo / PI + spec) * uSunColor * NdotL * shadow;
  }

  // ---- 葉の透過光（逆光で葉が光る）
  float translucency = extra.y;
  if (translucency > 0.0) {
    float back = pow(saturate(dot(-V, L)), 2.5) * 0.7 + saturate(-dot(N, L)) * 0.3;
    direct += albedo * uSunColor * back * translucency * mix(0.35, 1.0, shadow);
  }

  // ---- 環境光（半球）+ 事前計算 AO
  // 太陽 1 に対して環境光を 0.3 前後に抑えないと、影が浅く「のっぺり」する。
  float hemi = N.y * 0.5 + 0.5;
  float ao = vAO * mix(0.62, 1.0, hemi);   // 下向きの面ほど暗く
  vec3 ambient = mix(uGroundColor, uSkyColor, hemi) * albedo * ao * uAmbientScale;
  // 太陽の当たる側からの弱い反射光（バウンス）。影の中を真っ黒にしない。
  float bounce = saturate(dot(N, normalize(vec3(-uSunDir.x, 0.15, -uSunDir.z))));
  ambient += uSunColor * albedo * bounce * 0.055 * vAO;
  // 空からの弱い鏡面（濡れた石や金属の立体感）
  float fres = pow(1.0 - NdotV, 4.0);
  ambient += uSkyColor * F0 * fres * (1.0 - roughness) * 1.2 * vAO * uAmbientScale;

  // ---- 点光源
  vec3 pointSum = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 lp = uLightPos[i].xyz;
    float radius = uLightPos[i].w;
    vec3 dl = lp - vWorld;
    float dist2 = dot(dl, dl);
    if (dist2 > radius * radius) continue;
    float dist = sqrt(dist2);
    vec3 Ld = dl / max(dist, 1e-4);
    float ndl = dot(N, Ld);
    // 減衰は逆二乗 + 半径でのウィンドウ関数
    // 逆二乗に近い減衰。分母を弱めにして、街灯の足元に光だまりを作る
    float win = saturate(1.0 - pow(dist / radius, 4.0));
    float atten = win * win / (0.7 + dist2 * 0.42);
    if (atten < 0.0006) continue;
    vec3 lc = uLightColor[i].rgb * uLightColor[i].w;
    // 面の裏側も少しだけ拾って「明かりに包まれる」感じを出す
    float wrap = saturate((ndl + 0.35) / 1.35);
    vec3 H = normalize(Ld + V);
    float NdotH = max(dot(N, H), 0.0);
    float D = distributionGGX(NdotH, max(roughness, 0.14));
    vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);
    vec3 spec = F * D * 0.25;
    pointSum += (albedo * wrap * (1.0 - metallic) + spec * max(ndl, 0.0)) * lc * atten;
  }

  // ---- 自発光（夜だけ灯るものは uNightFactor で制御）
  float nightMix = mix(1.0, uNightFactor, emissiveParams.w);
  vec3 emissive = emissiveParams.rgb * tex.a * nightMix;

  vec3 color = direct + ambient + pointSum + emissive;

  // ---- 高度つき指数フォグ（遠景の空気感）
  float heightFactor = exp(-max(vWorld.y - 0.5, 0.0) * uFogParams.y);
  float dist = max(vViewDist - uFogParams.z, 0.0);
  float fog = 1.0 - exp(-dist * uFogParams.x * heightFactor);
  // 太陽方向を向いたときだけフォグを暖色へ寄せる（空気遠近）
  float sunAmount = pow(saturate(dot(-V, L)), 6.0);
  vec3 fogCol = mix(uFogColor, uSunColor * 0.8 + uFogColor * 0.4, sunAmount * uFogParams.w);
  color = mix(color, fogCol, saturate(fog));

  fragColor = vec4(color, extra.z);
}
`;

/* ================================================================ 空 */

export const SKY_VS = /* glsl */`#version 300 es
${COMMON}
layout(location = 0) in vec2 aPos;
uniform mat4 uInvViewProj;
out vec3 vRay;
void main() {
  vec4 far = uInvViewProj * vec4(aPos, 1.0, 1.0);
  vec4 near = uInvViewProj * vec4(aPos, -1.0, 1.0);
  vRay = far.xyz / far.w - near.xyz / near.w;
  gl_Position = vec4(aPos, 1.0, 1.0);
}
`;

export const SKY_FS = /* glsl */`#version 300 es
${COMMON}
in vec3 vRay;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGroundColor;
uniform float uNightFactor;
uniform float uTime;
uniform vec2 uCloudOffset;
layout(location = 0) out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += vnoise(p) * a; p *= 2.04; a *= 0.5; }
  return s;
}

void main() {
  vec3 dir = normalize(vRay);
  float h = dir.y;

  // 空のグラデーション。地平線側を明るく、天頂を濃く
  float t = saturate(h * 1.15 + 0.08);
  vec3 sky = mix(uHorizon, uZenith, pow(t, 0.65));
  // 地平線下は地面の色へ落とす（遠景の山より下に空が見えないように）
  sky = mix(sky, uGroundColor * 0.65, saturate(-h * 4.0));

  // 太陽（と夜は月）
  float sunDot = dot(dir, normalize(uSunDir));
  float disc = smoothstep(0.9986, 0.9995, sunDot);
  float halo = pow(saturate(sunDot), 220.0) * 0.55 + pow(saturate(sunDot), 14.0) * 0.12;
  sky += uSunColor * (disc * 12.0 + halo);

  // 雲（2 層の fbm を歪ませて厚みを出す）
  if (h > -0.02) {
    vec2 cuv = dir.xz / max(h + 0.12, 0.06) * 0.55 + uCloudOffset;
    float base = fbm2(cuv * 0.7);
    float detail = fbm2(cuv * 2.6 + vec2(base * 1.4));
    float cloud = saturate((base * 0.72 + detail * 0.38 - 0.45) * 2.5);
    cloud *= smoothstep(-0.02, 0.16, h);
    // 太陽側の縁が光る
    float rim = saturate(sunDot * 0.5 + 0.5);
    vec3 cloudLit = mix(vec3(0.62, 0.66, 0.74), vec3(1.06, 1.0, 0.94), rim);
    cloudLit = mix(cloudLit * 0.45, cloudLit, saturate(detail * 1.6));
    cloudLit = mix(cloudLit * vec3(0.3, 0.36, 0.5), cloudLit, 1.0 - uNightFactor * 0.75);
    cloudLit += uSunColor * pow(rim, 8.0) * 0.5 * (1.0 - uNightFactor);
    sky = mix(sky, cloudLit, cloud * 0.92);
  }

  // 星（夜のみ）
  if (uNightFactor > 0.01 && h > 0.0) {
    vec2 suv = dir.xz / max(h + 0.25, 0.1) * 8.0;
    float star = hash(floor(suv * 30.0));
    float twinkle = 0.7 + 0.3 * sin(uTime * 2.2 + star * 40.0);
    float s = smoothstep(0.9955, 0.9995, star) * twinkle;
    sky += vec3(0.85, 0.9, 1.0) * s * uNightFactor * saturate(h * 3.0) * 2.4;
  }

  fragColor = vec4(sky, 1.0);
}
`;

/* =============================================================== 水面 */

export const WATER_VS = /* glsl */`#version 300 es
${COMMON}
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec3 aColor;
layout(location = 4) in float aAO;
layout(location = 5) in float aWind;   // 流れの強さ
layout(location = 6) in float aMat;
uniform mat4 uViewProj;
uniform float uTime;
uniform vec3 uCameraPos;
out vec3 vWorld;
out vec2 vUV;
out float vFlow;
out float vShore;
out float vViewDist;
void main() {
  vec3 p = aPos;
  // ゆるいうねり。岸に近いほど小さく
  float shore = aAO;
  float w = sin(p.x * 1.7 + uTime * 1.6) * 0.5 + sin(p.z * 2.3 - uTime * 1.1) * 0.5;
  p.y += w * 0.022 * shore;
  vWorld = p;
  vUV = aUV;
  vFlow = aWind;
  vShore = shore;
  vViewDist = distance(p, uCameraPos);
  gl_Position = uViewProj * vec4(p, 1.0);
}
`;

export const WATER_FS = /* glsl */`#version 300 es
${COMMON}
in vec3 vWorld;
in vec2 vUV;
in float vFlow;
in float vShore;
in float vViewDist;
uniform sampler2DArray uNormalTex;
uniform float uWaterLayer;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uHorizon;
uniform vec3 uCameraPos;
uniform vec3 uFogColor;
uniform vec4 uFogParams;
uniform vec3 uShallowColor;
uniform vec3 uDeepColor;
uniform float uNightFactor;
uniform int uLightCount;
uniform vec4 uLightPos[${MAX_LIGHTS}];
uniform vec4 uLightColor[${MAX_LIGHTS}];
layout(location = 0) out vec4 fragColor;

void main() {
  // 2 枚のノーマルを別速度でスクロールして「同じ模様の繰り返し」を消す
  vec2 flowDir = vec2(1.0, 0.35);
  vec2 uv1 = vUV * 0.6 + flowDir * uTime * 0.035 * (0.3 + vFlow);
  vec2 uv2 = vUV * 1.35 - flowDir.yx * uTime * 0.055 * (0.3 + vFlow);
  vec3 n1 = texture(uNormalTex, vec3(uv1, uWaterLayer)).xyz * 2.0 - 1.0;
  vec3 n2 = texture(uNormalTex, vec3(uv2, uWaterLayer)).xyz * 2.0 - 1.0;
  vec3 tn = normalize(n1 + n2 * 0.7);
  float ripple = mix(0.25, 1.0, vShore);
  vec3 N = normalize(vec3(tn.x * 0.55 * ripple, 1.0, tn.y * 0.55 * ripple));

  vec3 V = normalize(uCameraPos - vWorld);
  vec3 L = normalize(uSunDir);
  float NdotV = max(dot(N, V), 1e-3);

  // フレネルで「浅瀬は透け、遠くは空を映す」
  float fres = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
  vec3 reflectDir = reflect(-V, N);
  vec3 skyRef = mix(uHorizon, uSkyColor, saturate(reflectDir.y * 1.4 + 0.1));

  float depthFade = saturate(vShore);
  vec3 body = mix(uShallowColor, uDeepColor, depthFade);

  vec3 color = mix(body, skyRef, fres);

  // 太陽のきらめき
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 420.0) * 2.6 + pow(max(dot(N, H), 0.0), 48.0) * 0.28;
  color += uSunColor * spec;

  // 街灯や Nova の映り込み
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 dl = uLightPos[i].xyz - vWorld;
    float d2 = dot(dl, dl);
    float radius = uLightPos[i].w;
    if (d2 > radius * radius) continue;
    vec3 Ld = normalize(dl);
    vec3 Hp = normalize(Ld + V);
    float sp = pow(max(dot(N, Hp), 0.0), 190.0);
    float atten = saturate(1.0 - sqrt(d2) / radius);
    color += uLightColor[i].rgb * uLightColor[i].w * sp * atten * atten * 1.6;
  }

  // 岸際の泡
  float foamEdge = 1.0 - smoothstep(0.0, 0.35, vShore);
  float foamNoise = texture(uNormalTex, vec3(vUV * 3.0 + vec2(uTime * 0.06, 0.0), uWaterLayer)).z;
  float foam = saturate(foamEdge * (0.45 + foamNoise * 0.9) * 1.4);
  color = mix(color, vec3(0.92, 0.96, 1.0) * (0.6 + 0.4 * (1.0 - uNightFactor)), foam * 0.7);

  float dist = max(vViewDist - uFogParams.z, 0.0);
  float fog = 1.0 - exp(-dist * uFogParams.x);
  color = mix(color, uFogColor, saturate(fog));

  float alpha = mix(0.72, 0.95, fres) + foam * 0.3;
  fragColor = vec4(color, saturate(alpha));
}
`;

/* =============================================================== 粒子 */

export const PARTICLE_VS = /* glsl */`#version 300 es
${COMMON}
layout(location = 0) in vec2 aCorner;      // -1..1 の四隅
layout(location = 1) in vec4 aPosSize;     // xyz 位置 + w 大きさ
layout(location = 2) in vec4 aColor;       // rgb + alpha
layout(location = 3) in vec4 aParams;      // x:回転 y:種類 z:輝度 w:予備
uniform mat4 uViewProj;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
out vec2 vUV;
out vec4 vColor;
flat out float vKind;
out float vGlow;
void main() {
  float c = cos(aParams.x), s = sin(aParams.x);
  vec2 r = vec2(aCorner.x * c - aCorner.y * s, aCorner.x * s + aCorner.y * c);
  vec3 world = aPosSize.xyz + (uCameraRight * r.x + uCameraUp * r.y) * aPosSize.w;
  vUV = aCorner * 0.5 + 0.5;
  vColor = aColor;
  vKind = aParams.y;
  vGlow = aParams.z;
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const PARTICLE_FS = /* glsl */`#version 300 es
${COMMON}
in vec2 vUV;
in vec4 vColor;
flat in float vKind;
in float vGlow;
layout(location = 0) out vec4 fragColor;
void main() {
  vec2 p = vUV * 2.0 - 1.0;
  float r = length(p);
  float a = 0.0;
  int kind = int(vKind + 0.5);
  if (kind == 0) {            // 柔らかい光の粒
    a = pow(saturate(1.0 - r), 2.2);
  } else if (kind == 1) {     // 煙／塵
    float n = 0.5 + 0.5 * sin(p.x * 8.0) * sin(p.y * 7.0);
    a = saturate(1.0 - r) * (0.55 + n * 0.45);
    a = pow(a, 1.6);
  } else if (kind == 2) {     // 火の粉（芯が強い）
    a = pow(saturate(1.0 - r), 4.5) + pow(saturate(1.0 - r * 2.6), 8.0) * 1.4;
  } else if (kind == 3) {     // 花びら／葉
    float d = abs(p.y) * 1.6 + abs(p.x) * 0.7;
    a = smoothstep(1.0, 0.35, d);
  } else {                    // リング
    a = smoothstep(1.0, 0.86, r) * smoothstep(0.55, 0.8, r);
  }
  if (a < 0.004) discard;
  fragColor = vec4(vColor.rgb * (1.0 + vGlow), a * vColor.a);
}
`;

/* ============================================================= 後処理 */

export const POST_VS = /* glsl */`#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const BRIGHT_FS = /* glsl */`#version 300 es
${COMMON}
in vec2 vUV;
uniform sampler2D uTex;
uniform float uThreshold;
layout(location = 0) out vec4 fragColor;
void main() {
  vec3 c = texture(uTex, vUV).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThreshold, uThreshold + 0.6, lum);
  fragColor = vec4(c * k, 1.0);
}
`;

export const BLUR_FS = /* glsl */`#version 300 es
${COMMON}
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;
layout(location = 0) out vec4 fragColor;
void main() {
  // 9 タップのガウス（線形補間を使って 5 回のフェッチに畳む）
  vec3 sum = texture(uTex, vUV).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  sum += (texture(uTex, vUV + o1).rgb + texture(uTex, vUV - o1).rgb) * 0.3162162162;
  sum += (texture(uTex, vUV + o2).rgb + texture(uTex, vUV - o2).rgb) * 0.0702702703;
  fragColor = vec4(sum, 1.0);
}
`;

export const COMPOSITE_FS = /* glsl */`#version 300 es
${COMMON}
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomAmount;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;
uniform float uTime;
uniform vec3 uLift;        // 影の色
uniform vec3 uGain;        // ハイライトの色
uniform float uSaturation;
uniform float uContrast;
uniform float uFlash;
uniform vec3 uFlashColor;
layout(location = 0) out vec4 fragColor;

// ACES フィルミックトーンマッピング（近似）
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = vUV;
  vec2 center = uv - 0.5;
  float r2 = dot(center, center);

  // 画面端だけ色収差
  vec3 color;
  if (uAberration > 0.001) {
    vec2 off = center * r2 * uAberration * 0.03;
    color.r = texture(uScene, uv + off).r;
    color.g = texture(uScene, uv).g;
    color.b = texture(uScene, uv - off).b;
  } else {
    color = texture(uScene, uv).rgb;
  }

  color += texture(uBloom, uv).rgb * uBloomAmount;
  color *= uExposure;
  color = aces(color);

  // カラーグレード：リフト／ゲイン → 彩度 → コントラスト
  color = color * uGain + uLift * (1.0 - color);
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(lum), color, uSaturation);
  color = saturate3((color - 0.5) * uContrast + 0.5);

  // 周辺減光
  float vig = 1.0 - uVignette * smoothstep(0.18, 0.85, r2);
  color *= vig;

  // フラッシュ（被弾・進化・カットイン）
  color = mix(color, uFlashColor, saturate(uFlash));

  // 粒状ノイズ
  if (uGrain > 0.0001) {
    float n = fract(sin(dot(uv * vec2(1271.3, 913.7) + uTime, vec2(12.9898, 78.233))) * 43758.5453);
    color += (n - 0.5) * uGrain;
  }

  // sRGB へ
  color = pow(saturate3(color), vec3(1.0 / 2.2));
  fragColor = vec4(color, 1.0);
}
`;
