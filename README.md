# Blaster Zone / Todo App

このリポジトリには Todo アプリと、ブラウザだけで遊べる 3D FPS ゲーム **BLASTER ZONE** が入っています。

## 🎮 FPS ゲーム（`/fps`）

`npm start` で起動し、<http://localhost:3000/fps> を開くとすぐに遊べます（ログイン不要）。
Todo アプリのヘッダーやログイン画面のリンクからも入れます。

- **外部ライブラリなし**: Canvas 2D のレイキャスティングで自前描画。テクスチャ・敵・武器・効果音はすべてコード生成なので画像／音声ファイルは不要です。
- **レスポンシブ**: 画面サイズと向き（縦／横）に合わせて解像度・画角・UI が自動調整されます。端末性能に応じてレンダリング解像度も落とします。
- **スマホ対応**: 画面左のドラッグで移動する仮想スティック、右のドラッグで視点、タップ or FIRE ボタンで射撃。開始時に全画面＆横向きを試みます。

### 操作方法

| | PC | スマホ／タブレット |
| --- | --- | --- |
| 移動 | `W` `A` `S` `D` / 矢印キー | 画面左側をドラッグ（仮想スティック） |
| 視点 | マウス（クリックでポインターロック） | 画面右側をドラッグ |
| 射撃 | 左クリック / `Space` | 右側をタップ or `FIRE` ボタン長押し |
| ダッシュ | `Shift` | スティックを大きく倒す or `DASH` ボタン |
| ポーズ | `Esc` | 右上の ❚❚ ボタン |

### ゲーム内容

- 自動生成された迷宮で、ウェーブごとに増える敵を全滅させるアリーナ型 FPS。
- 敵は 3 種類（ドローン／ガンナー／ブルート）。幅優先探索の経路マップで迷路を辿って追ってきます。
- 弾薬箱・救急箱を拾って生き延び、ハイスコア（`localStorage` に保存）を更新しましょう。
- 難易度は かんたん／ふつう／むずかしい の 3 段階。

### 実装ファイル

| ファイル | 役割 |
| --- | --- |
| `src/components/FpsGame.js` | React コンポーネント。HUD、タッチ／キーボード／マウス入力、各種オーバーレイ |
| `src/components/FpsGame.css` | ゲーム UI のスタイル（セーフエリア対応） |
| `src/game/engine.js` | レイキャスティング描画、敵 AI、当たり判定、ウェーブ進行 |
| `src/game/mapGen.js` | 迷路の自動生成（到達不能マスを埋めて必ず全域が繋がるようにする） |
| `src/game/textures.js` | 壁テクスチャ・スプライト・武器の手続き的生成 |
| `src/game/audio.js` | WebAudio による効果音合成 |

---

# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
