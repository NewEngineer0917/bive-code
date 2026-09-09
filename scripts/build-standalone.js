/**
 * 単一HTML版のゲームをビルドする。
 *
 *   node scripts/build-standalone.js   →   dist-standalone/index.html
 *
 * src/game/*.js（React版と同じゲームロジック）と src/game/standalone-ui.js
 * （React を使わない UI 層）を 1 枚の HTML に連結する。サーバーもビルド環境も
 * 不要で、生成された HTML をブラウザで開くだけで動く。
 *
 * モジュールごとにスコープを分け、共有名前空間 __BZ 経由で受け渡すことで、
 * 各ファイルが持つ内部定数（TAU など）の衝突を避けている。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GAME = path.join(ROOT, 'src', 'game');
const OUT_DIR = path.join(ROOT, 'dist-standalone');

const MODULES = [
  { file: 'textures.js', exports: ['TEX_SIZE', 'SHADE_LEVELS', 'getAssetSet', 'getFloorTextures'], imports: [] },
  { file: 'mapGen.js', exports: ['MAP_SIZE', 'createRng', 'generateMap'], imports: [] },
  { file: 'cityGen.js', exports: ['CITY_SIZE', 'MAT', 'generateCity'], imports: [] },
  { file: 'audio.js', exports: ['Sfx'], imports: [] },
  { file: 'fidelity.js', exports: ['GL_QUALITY', 'RENDER_2D'], imports: [] },
  {
    file: 'weapons.js',
    exports: [
      'WEAPON_IDS', 'WEAPONS', 'levelForXp', 'statsFor', 'levelProgress', 'createWeaponState',
    ],
    imports: [],
  },
  { file: 'materials.js', exports: ['MAT_SIZE', 'MATERIALS', 'buildMaterials'], imports: [] },
  {
    file: 'glmath.js',
    exports: ['mat4', 'identity', 'multiply', 'perspective', 'lookAt', 'compose'],
    imports: [],
  },
  {
    file: 'renderer3d.js',
    exports: ['Renderer3D'],
    imports: [
      'buildMaterials', 'MAT_SIZE', 'MATERIALS', 'WEAPONS',
      'mat4', 'multiply', 'perspective', 'lookAt', 'compose',
    ],
  },
  {
    file: 'engine.js',
    exports: ['DIFFICULTIES', 'Game'],
    imports: [
      'getAssetSet', 'getFloorTextures', 'createRng', 'generateCity', 'Sfx',
      'GL_QUALITY', 'RENDER_2D', 'Renderer3D',
      'WEAPONS', 'WEAPON_IDS', 'createWeaponState', 'levelForXp', 'levelProgress', 'statsFor',
    ],
  },
];

const indent = (text) => text.split('\n').map((l) => (l ? '  ' + l : l)).join('\n');

const stripModuleSyntax = (file) => {
  const lines = fs.readFileSync(path.join(GAME, file), 'utf8').split('\n');
  const out = [];
  let inImport = false;
  for (const line of lines) {
    if (inImport) {
      if (/;\s*$/.test(line)) inImport = false;
      continue;
    }
    if (/^import\s/.test(line)) {
      if (!/;\s*$/.test(line)) inImport = true; // 複数行の import
      continue;
    }
    out.push(line.replace(/^export\s+(?=(const|let|function|class))/, ''));
  }
  return out.join('\n').trim();
};

const wrap = (m) => {
  const head = m.imports.length ? `  const { ${m.imports.join(', ')} } = __BZ;\n` : '';
  return `/* ---------- src/game/${m.file} ---------- */\n(function () {\n${head}${indent(stripModuleSyntax(m.file))}\n  Object.assign(__BZ, { ${m.exports.join(', ')} });\n})();`;
};

const engine = MODULES.map(wrap).join('\n\n');
const ui = fs.readFileSync(path.join(GAME, 'standalone-ui.js'), 'utf8').trim();
const shell = fs.readFileSync(path.join(__dirname, 'standalone-shell.html'), 'utf8');

const fragment = process.argv.includes('--fragment');

const documentHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="description" content="ブラウザで遊べるレスポンシブ対応のFPSゲーム。外部ライブラリなし、単一HTMLで動作します。">
<meta name="theme-color" content="#070a12">
${shell.trim().replace('<div id="game">', '</head>\n<body>\n<div id="game">')}
<script>
/* =========================================================================
   BLASTER ZONE — ゲームエンジン（外部ライブラリなし）
   src/game/{textures,mapGen,audio,engine}.js を連結したもの
   ========================================================================= */
window.__BZ = {};
${engine}
</script>
<script>
(function () {
  const { Game } = window.__BZ;
${indent(ui)}
})();
</script>
</body>
</html>
`;

// 断片モード: Artifact などに埋め込む用に doctype/html/head/body を付けない
const fragmentHtml = documentHtml
  .replace(/^[\s\S]*?(?=<title>)/, '')
  .replace('</head>\n<body>\n', '')
  .replace(/<\/body>\n<\/html>\n?$/, '');

const html = fragment ? fragmentHtml : documentHtml;
const name = fragment ? 'artifact.html' : 'index.html';
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, name), html);
console.log(`dist-standalone/${name} を生成しました (${(html.length / 1024).toFixed(1)} KB)`);
