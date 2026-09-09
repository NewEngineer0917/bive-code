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
| 武器切替 | `1`〜`4` / ホイール / `Q`・`E` | 画面下部のスロットをタップ |
| リロード | `R` | RELOAD ボタン |
| ポーズ | `Esc` | 右上の ❚❚ ボタン |

### ゲーム内容

- 自動生成された迷宮で、ウェーブごとに増える敵を全滅させるアリーナ型 FPS。
- 敵は 3 種類（ドローン／ガンナー／ブルート）。幅優先探索の経路マップで迷路を辿って追ってきます。
- 弾薬箱・救急箱・強化コアを拾って生き延び、ハイスコア（`localStorage` に保存）を更新しましょう。
- 難易度は かんたん／ふつう／むずかしい の 3 段階。

### ステージ：夜の街（ウェーブごとに再生成）

迷路ではなく**碁盤の目の街**を自動生成します（`src/game/cityGen.js`）。

- 幅3〜4タイルの**車道**が縦横に走り、その間が街区になります
- 街区の外周は**歩道**（縁石で一段高い）、内部は高さの違う**ビル**、路地、広場
- ビルは中心部ほど高層になり、外周は市外へ出られない高い壁
- **ウェーブが変わるたびに街を作り直します**（新しいエリアへ移動する演出つき）

### 描画（WebGL2・夜景）

外部ライブラリもモデルデータも使わず、すべてコードで組み立てています
（`src/game/renderer3d.js`）。

- **ジオメトリ**: タイルごとの高さでビルを立て、隣より高い部分だけ壁面を作る。
  屋上・歩道の縁石・街灯のポールも生成する
- **マテリアル**: `materials.js` がビル外壁（窓つき）・アスファルト・歩道・屋上などを
  生成。アルベドのアルファを**自発光マスク**として使い、夜のビルの窓が光る
- **ライティング**: GGX 近似の物理ベースシェーディング。主光源は**街灯**（実際の点光源）で、
  銃口の閃光・敵弾・アイテムも周囲を照らす
- **影**: 光源へ向かって街のグリッドをシェーダ内でレイマーチし、遮蔽を判定する
- **空**: 視線の高さから夜空のグラデーションと星を描く
- **後処理**: HDR → 明部抽出 → ガウスぼかし → ACES トーンマッピング、周辺減光、色収差、粒状ノイズ

WebGL2 が使えない環境では、自動的に 2D のレイキャスティング描画に切り替わります。
フレーム時間を監視して解像度を自動で上下させるため、非力な端末でも動きます。

### 武器システム

4 種類の武器を持ち歩き、スロットで切り替えて戦います（`src/game/weapons.js`）。
新しい武器はウェーブが進むと武器ケースとして出現します。

| スロット | 武器 | 特徴 | 装弾数 |
| --- | --- | --- | --- |
| 1 | パルスブラスター | 標準。連射でき扱いやすい | 14 |
| 2 | スキャッターガン | 近距離で高威力の散弾。ポンプアクション | 6 |
| 3 | パルスSMG | 高速連射・低威力 | 34 |
| 4 | レールランス | 貫通する高威力の一撃 | 4 |

**成長**: 使い込むほど武器ごとに XP が貯まり Lv.4 まで成長します。威力・装弾数・
連射速度・リロード時間・貫通数が伸び、**3D モデルの見た目そのものが変化**します
（銃身が伸びる、サイドポッドやサプレッサーが増える、発光が強くなる）。

**リロード**: 弾倉と予備弾を持ち、`R` キー（スマホは RELOAD ボタン）で装填します。
撃ち切ると自動で装填が始まります。リロード中と持ち替え中は撃てません。

**見た目の変化**: 銃は箱と円筒を組み合わせた 3D モデルで、レベルが上がるごとに
パーツが増えます（Lv2 でレールやフォアグリップ、Lv3 でスコープ・サプレッサー・
サイドポッド・銃身延長、Lv4 で加速コイルとマズルブレーキ、発光が強くなる）。

**射撃モード**: 連射（押しっぱなしで撃ち続ける）と単発（押すたびに1発）があり、
HUD とメニューに `AUTO` / `SEMI` として表示されます。

**アニメーション**: 反動で銃口が跳ね上がり、リロードでは銃を引き下げて傾け、弾倉が
抜き差しされます（ショットガンはポンプが前後にスライド）。持ち替えでは一度画面下へ
下ろしてから構え直します。歩行に合わせた揺れも入ります。武器は深度を分けて描くので
壁にめり込みません。

### 実装ファイル

| ファイル | 役割 |
| --- | --- |
| `src/components/FpsGame.js` | React コンポーネント。HUD、タッチ／キーボード／マウス入力、各種オーバーレイ |
| `src/components/FpsGame.css` | ゲーム UI のスタイル（セーフエリア対応） |
| `src/game/engine.js` | レイキャスティング描画、敵 AI、当たり判定、ウェーブ進行、武器レベル |
| `src/game/fidelity.js` | 描画品質の設定 |
| `src/game/weapons.js` | 武器の定義・成長・性能計算 |
| `src/game/renderer3d.js` | WebGL2 の 3D レンダラ（後半ティア用） |
| `src/game/materials.js` | 3D 用マテリアル（アルベド＋法線マップ）の生成 |
| `src/game/glmath.js` | 行列演算 |
| `src/game/cityGen.js` | 街の自動生成（道路・歩道・ビル・広場） |
| `src/game/mapGen.js` | 迷路生成（2D フォールバック用に残置） |
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
