/**
 * 描画設定。
 *
 * 3D（WebGL2）で描くのが標準で、WebGL が使えない環境だけ
 * 2D のレイキャスティングにフォールバックする。どちらも最初から
 * 最高品質で、ゲームの進行によって画質が変わることはない。
 * 重い端末では負荷に応じて解像度だけ自動で下げる。
 */

/** 3D レンダラの品質設定。 */
export const GL_QUALITY = {
  scale: 1,
  normalMaps: true,
  shadows: true,
  bloom: 0.55,
  grain: 0.01,
  aberration: 0.3,
  vignette: 0.45,
  exposure: 0.95,
};

/** WebGL が使えないときの 2D 描画設定（こちらも最高設定）。 */
export const RENDER_2D = {
  label: '2D',
  scale: 0.95,
  maxWidth: 900,
  smoothing: true,
  assetSet: 2,
  shadeLevels: 12,
  palette: null,
  colorLevels: 0,
  floor: 'textured',
  lights: true,
  scanline: 0,
  bloom: 0.2,
  ao: true,
  audio: { crush: 0, reverb: 0.32, pan: true, layers: 3, sub: 0.7, filter: true },
};
