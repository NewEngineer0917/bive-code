/**
 * ASTRA BOND を 1 枚の HTML + 1 本の JS に書き出す。
 *
 * React Router も認証も通さないので、静的ホスティングや Artifact に
 * そのまま置ける。CSS は HTML へ埋め込み、JS だけ外部ファイルにする
 * （インライン化すると 1 ファイルが大きくなりすぎるため）。
 *
 *   npm run build:astra   →  dist/astra.html, dist/astra-app.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });

execFileSync('npx', [
  'esbuild', 'src/astra/standalone-entry.js',
  '--bundle', '--minify', '--format=iife', '--target=es2020',
  '--loader:.js=jsx', '--loader:.css=empty',
  '--define:process.env.NODE_ENV="production"',
  `--outfile=${path.join(outDir, 'astra-app.js')}`,
], { cwd: root, stdio: 'inherit' });

const css = fs.readFileSync(path.join(root, 'src/components/AstraBond.css'), 'utf8');
const template = fs.readFileSync(path.join(__dirname, 'astra-page.html'), 'utf8');
fs.writeFileSync(path.join(outDir, 'astra.html'), template.replace('__ASTRA_CSS__', css));

const size = (f) => (fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0);
console.log(`dist/astra.html ${size('astra.html')}kb  dist/astra-app.js ${size('astra-app.js')}kb`);
