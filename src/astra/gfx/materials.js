/**
 * 材質テーブル。
 *
 * テクスチャ配列の 1 レイヤ + PBR パラメータ + 描画パスをまとめたもの。
 * MeshBuilder には材質オブジェクトをそのまま渡す。レイヤ番号が頂点属性に
 * 入るので、石も木も屋根も混ざった 1 個のバッファを 1 回で描ける。
 *
 * pass:
 *   opaque       … 不透明（大半）
 *   cutout       … アルファテスト（葉・草・花）。両面描画。
 *   transparent  … 半透明（ガラス・水・光る膜）。奥から手前へ並べて描く。
 */

import { generateTextureSet } from './textures.js';

/** 材質の定義。tex は textures.js の生成関数名。 */
const DEFS = [
  // 石材・舗装
  { name: 'stone', tex: 'stone', roughness: 1.0, metallic: 0.0 },
  { name: 'cobble', tex: 'cobble', roughness: 1.0, metallic: 0.0 },
  { name: 'dirt', tex: 'dirt', roughness: 1.0, metallic: 0.0 },
  { name: 'ground', tex: 'grassGround', roughness: 1.0, metallic: 0.0 },
  { name: 'marble', tex: 'marble', roughness: 0.85, metallic: 0.02, specular: 0.6 },
  // 木部
  { name: 'wood', tex: 'wood', roughness: 1.0, metallic: 0.0 },
  { name: 'woodDark', tex: 'woodDark', roughness: 1.0, metallic: 0.0 },
  { name: 'bark', tex: 'bark', roughness: 1.0, metallic: 0.0 },
  // 屋根
  { name: 'roofTile', tex: 'roofTile', roughness: 0.95, metallic: 0.0 },
  { name: 'roofSlate', tex: 'roofSlate', roughness: 0.85, metallic: 0.0 },
  // 仕上げ
  { name: 'plaster', tex: 'plaster', roughness: 1.0, metallic: 0.0 },
  { name: 'metal', tex: 'metal', roughness: 0.8, metallic: 0.85 },
  { name: 'metalDark', tex: 'metalDark', roughness: 0.9, metallic: 0.7 },
  { name: 'awning', tex: 'awning', roughness: 1.0, metallic: 0.0 },
  { name: 'fabric', tex: 'fabric', roughness: 1.0, metallic: 0.0 },
  { name: 'sign', tex: 'sign', roughness: 0.95, metallic: 0.0 },
  { name: 'moss', tex: 'moss', roughness: 1.0, metallic: 0.0 },

  // 発光する建材：夜になると窓と Nova ラインが灯る
  // 昼は空を映して明るく、夜は室内の灯りで光る
  { name: 'window', tex: 'glass', roughness: 0.12, metallic: 0.35, specular: 1.0,
    emissive: [1.0, 0.84, 0.58], emissiveStrength: 3.4, nightOnly: 1 },
  { name: 'techPanel', tex: 'techPanel', roughness: 0.7, metallic: 0.25,
    emissive: [0.35, 0.92, 1.0], emissiveStrength: 2.6, nightOnly: 0.55 },
  { name: 'crystal', tex: 'crystal', roughness: 0.2, metallic: 0.0, specular: 1.0,
    emissive: [0.42, 0.95, 1.0], emissiveStrength: 3.2, nightOnly: 0.35 },
  { name: 'lampGlow', tex: 'crystal', roughness: 0.3, metallic: 0.0,
    emissive: [1.0, 0.78, 0.45], emissiveStrength: 4.2, nightOnly: 0.8 },

  // 切り抜き（両面）
  { name: 'leaves', tex: 'leaves', pass: 'cutout', roughness: 1.0, metallic: 0.0,
    doubleSided: true, alphaCutoff: 0.45, translucency: 0.55 },
  { name: 'grassBlade', tex: 'grassBlade', pass: 'cutout', roughness: 1.0, metallic: 0.0,
    doubleSided: true, alphaCutoff: 0.4, translucency: 0.6 },
  { name: 'flowers', tex: 'flowers', pass: 'cutout', roughness: 1.0, metallic: 0.0,
    doubleSided: true, alphaCutoff: 0.4, translucency: 0.4 },

  // 半透明
  { name: 'glass', tex: 'glass', pass: 'transparent', roughness: 0.06, metallic: 0.0,
    specular: 1.0, opacity: 0.3 },

  // 生き物
  { name: 'skin', tex: 'skin', roughness: 0.62, metallic: 0.0, specular: 0.4 },
  { name: 'fur', tex: 'fur', roughness: 0.95, metallic: 0.0 },
  { name: 'obsidian', tex: 'obsidian', roughness: 0.35, metallic: 0.1, specular: 0.9,
    emissive: [1.0, 0.38, 0.1], emissiveStrength: 2.6, nightOnly: 0 },
  { name: 'scales', tex: 'scales', roughness: 0.4, metallic: 0.15, specular: 0.8 },
];

/**
 * テクスチャを合成し、材質テーブルを組み立てる。
 * 返り値の materials は名前引き、layers はシェーダへ渡すパラメータ配列。
 */
export function buildMaterialLibrary(texSize) {
  const texSet = generateTextureSet(texSize);
  const materials = {};
  const list = [];
  DEFS.forEach((def, i) => {
    const layerIndexInTextures = texSet.index[def.tex];
    const mat = {
      name: def.name,
      layer: layerIndexInTextures,
      pass: def.pass || 'opaque',
      roughness: def.roughness === undefined ? 1 : def.roughness,
      metallic: def.metallic || 0,
      specular: def.specular === undefined ? 0.5 : def.specular,
      emissive: def.emissive || [0, 0, 0],
      emissiveStrength: def.emissiveStrength || 0,
      nightOnly: def.nightOnly === undefined ? 0 : def.nightOnly,
      // アルファテストは切り抜き材質だけ。不透明材質のアルファは
      // 「自発光マスク」なので、ここに 0 以外を入れると全部消えてしまう。
      alphaCutoff: def.pass === 'cutout' ? (def.alphaCutoff === undefined ? 0.45 : def.alphaCutoff) : 0,
      doubleSided: !!def.doubleSided,
      translucency: def.translucency || 0,
      opacity: def.opacity === undefined ? 1 : def.opacity,
    };
    materials[def.name] = mat;
    list.push(mat);
  });

  // 同じテクスチャを別パラメータで使う材質があるため、
  // シェーダ側のパラメータ配列はテクスチャレイヤではなく「材質番号」で引く。
  // 頂点には材質番号を入れ、材質番号 → テクスチャレイヤも配列で渡す。
  list.forEach((m, i) => { m.id = i; });
  const params = new Float32Array(list.length * 4);
  const emissiveParams = new Float32Array(list.length * 4);
  const extraParams = new Float32Array(list.length * 4);
  list.forEach((m, i) => {
    params[i * 4] = m.roughness;
    params[i * 4 + 1] = m.metallic;
    params[i * 4 + 2] = m.specular;
    params[i * 4 + 3] = m.layer;              // テクスチャ配列の添字
    emissiveParams[i * 4] = m.emissive[0] * m.emissiveStrength;
    emissiveParams[i * 4 + 1] = m.emissive[1] * m.emissiveStrength;
    emissiveParams[i * 4 + 2] = m.emissive[2] * m.emissiveStrength;
    emissiveParams[i * 4 + 3] = m.nightOnly;
    extraParams[i * 4] = m.alphaCutoff;
    extraParams[i * 4 + 1] = m.translucency;
    extraParams[i * 4 + 2] = m.opacity;
    extraParams[i * 4 + 3] = 0;
  });

  // MeshBuilder は material.layer を頂点へ書くので、材質番号を入れ直す
  list.forEach((m) => { m.texLayer = m.layer; m.layer = m.id; });

  return { materials, list, params, emissiveParams, extraParams, texSet, count: list.length };
}
