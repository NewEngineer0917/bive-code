/**
 * 街（ステージ）の自動生成。
 *
 * 迷路ではなく「碁盤の目の街区」を作る:
 *   ・幅の広い道路が縦横に走り、その間がビルの街区になる
 *   ・街区の外周は歩道、内部はビル（高さがバラバラ）や路地、広場
 *   ・ウェーブが進むごとに再生成され、街並みが毎回変わる
 *
 * tiles: 0 = 通行可、1以上 = 建物（値-1 がマテリアル番号）
 * kind:  0 = 車道、1 = 歩道、2 = 広場（通行可タイルの床の種類）
 */

export const CITY_SIZE = 64;

/* マテリアル番号（materials.js の並びと一致させる） */
export const MAT = {
  FACADE_CONCRETE: 0,
  FACADE_GLASS: 1,
  FACADE_BRICK: 2,
  ROAD: 3,
  SIDEWALK: 4,
  ROOF: 5,
  SHUTTER: 6,
  CONCRETE: 7,
};

const FACADES = [MAT.FACADE_CONCRETE, MAT.FACADE_GLASS, MAT.FACADE_BRICK];

export function generateCity(rnd = Math.random, wave = 1) {
  const size = CITY_SIZE;
  const tiles = new Uint8Array(size * size);
  const heights = new Float32Array(size * size);
  const kind = new Uint8Array(size * size);
  const at = (x, y) => y * size + x;

  // --- 通りの位置を決める（幅3〜4の道路） ---
  // 車道は 6〜8 タイル幅（2車線ぶん）。街区は 9〜14 タイル
  const streets = (limit) => {
    const list = [];
    let pos = 3 + ((rnd() * 3) | 0);
    while (pos < limit - 10) {
      const width = 6 + ((rnd() * 3) | 0);
      list.push({ pos, width });
      pos += width + 9 + ((rnd() * 6) | 0);
    }
    return list;
  };
  const vStreets = streets(size);
  const hStreets = streets(size);

  const isStreet = (list, v) => list.some((s) => v >= s.pos && v < s.pos + s.width);

  // --- 街区を埋める ---
  const center = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const onStreet = isStreet(vStreets, x) || isStreet(hStreets, y);
      if (onStreet) {
        kind[at(x, y)] = 0; // 車道
        continue;
      }
      // 道路に隣接するタイルは歩道にする
      const nearStreet = isStreet(vStreets, x - 1) || isStreet(vStreets, x + 1)
        || isStreet(hStreets, y - 1) || isStreet(hStreets, y + 1);
      if (nearStreet) {
        kind[at(x, y)] = 1; // 歩道
        continue;
      }
      tiles[at(x, y)] = 1; // ひとまず建物候補
    }
  }

  // --- 街区ごとにビル・路地・広場へ振り分ける ---
  const visited = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!tiles[at(x, y)] || visited[at(x, y)]) continue;

      // 連結した建物候補（＝ひとつの街区）を取り出す
      const cells = [];
      const stack = [[x, y]];
      visited[at(x, y)] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (!tiles[at(nx, ny)] || visited[at(nx, ny)]) continue;
          visited[at(nx, ny)] = 1;
          stack.push([nx, ny]);
        }
      }

      const roll = rnd();
      if (roll < 0.16 || cells.length <= 2) {
        // 広場・駐車場（開けた空間）
        for (const [cx, cy] of cells) {
          tiles[at(cx, cy)] = 0;
          kind[at(cx, cy)] = 2;
        }
        continue;
      }

      // 街区の範囲
      let minX = size;
      let maxX = 0;
      let minY = size;
      let maxY = 0;
      for (const [cx, cy] of cells) {
        minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
      }

      // 大きい街区は路地で分割する
      const alleyX = maxX - minX >= 5 && rnd() < 0.65
        ? minX + 2 + ((rnd() * (maxX - minX - 3)) | 0) : -1;
      const alleyY = maxY - minY >= 5 && rnd() < 0.5
        ? minY + 2 + ((rnd() * (maxY - minY - 3)) | 0) : -1;

      // 街区内をいくつかのビルに分け、それぞれ高さと外装を決める
      const facade = FACADES[(rnd() * FACADES.length) | 0];
      const partH = new Map();
      for (const [cx, cy] of cells) {
        if (cx === alleyX || cy === alleyY) {
          tiles[at(cx, cy)] = 0;
          kind[at(cx, cy)] = 2; // 路地
          continue;
        }
        const partX = alleyX >= 0 && cx > alleyX ? 1 : 0;
        const partY = alleyY >= 0 && cy > alleyY ? 1 : 0;
        const key = partX + partY * 2;
        if (!partH.has(key)) {
          // 中心に近いほど高層になる
          const d = Math.hypot(cx - center, cy - center) / center;
          const tall = Math.max(0, 1 - d) ** 1.4;
          const base = 4 + tall * (10 + wave * 0.6);
          partH.set(key, base + rnd() * 4);
        }
        tiles[at(cx, cy)] = facade + 1;
        heights[at(cx, cy)] = partH.get(key);
      }
    }
  }

  // --- 外周は必ず高い壁（街の外へ出られないように） ---
  for (let i = 0; i < size; i++) {
    for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]]) {
      tiles[at(x, y)] = MAT.CONCRETE + 1;
      heights[at(x, y)] = 16;
    }
  }

  // --- 通行可能なマスの一覧と、到達できない場所の除去 ---
  const reach = new Uint8Array(size * size);
  let start = -1;
  for (let y = 2; y < size - 2 && start < 0; y++) {
    for (let x = 2; x < size - 2; x++) if (!tiles[at(x, y)]) { start = at(x, y); break; }
  }
  const queue = [start];
  reach[start] = 1;
  for (let h = 0; h < queue.length; h++) {
    const cur = queue[h];
    const cx = cur % size;
    const cy = (cur / size) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = at(nx, ny);
      if (tiles[ni] || reach[ni]) continue;
      reach[ni] = 1;
      queue.push(ni);
    }
  }

  const open = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = at(x, y);
      if (tiles[i]) continue;
      if (!reach[i]) {           // 孤立空間は建物で埋める
        tiles[i] = MAT.CONCRETE + 1;
        heights[i] = 6;
        continue;
      }
      open.push([x + 0.5, y + 0.5]);
    }
  }

  // 開始地点は街の中心に近い車道
  let spawn = open[0];
  let bestScore = Infinity;
  for (const cell of open) {
    const x = cell[0] | 0;
    const y = cell[1] | 0;
    if (kind[at(x, y)] !== 0) continue;
    const d = Math.hypot(x - center, y - center);
    if (d < bestScore) { bestScore = d; spawn = cell; }
  }

  return { size, tiles, heights, kind, open, spawn };
}
