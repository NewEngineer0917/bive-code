/**
 * 迷路型のステージを自動生成する。
 * 穴掘り法（再帰的バックトラック）で必ず全域が繋がった迷路を作り、
 * そのあと壁を少し壊してループと広間を作り、FPS向けの動きやすい地形にする。
 */

export const MAP_SIZE = 25; // 奇数であること

export function createRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function generateMap(rnd = Math.random) {
  const size = MAP_SIZE;
  const solid = new Uint8Array(size * size).fill(1);
  const at = (x, y) => y * size + x;

  // 穴掘り法
  solid[at(1, 1)] = 0;
  const stack = [[1, 1]];
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const dirs = shuffle([[2, 0], [-2, 0], [0, 2], [0, -2]], rnd);
    let moved = false;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx > 0 && ny > 0 && nx < size - 1 && ny < size - 1 && solid[at(nx, ny)] === 1) {
        solid[at(cx + dx / 2, cy + dy / 2)] = 0;
        solid[at(nx, ny)] = 0;
        stack.push([nx, ny]);
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }

  // 行き止まりを減らしてループを作る
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (solid[at(x, y)] === 1 && rnd() < 0.17) solid[at(x, y)] = 0;
    }
  }

  // 広間をいくつか掘る（撃ち合いのスペース）
  for (let i = 0; i < 5; i++) {
    const w = 3 + ((rnd() * 3) | 0);
    const h = 3 + ((rnd() * 3) | 0);
    const rx = 1 + ((rnd() * (size - w - 2)) | 0);
    const ry = 1 + ((rnd() * (size - h - 2)) | 0);
    for (let y = ry; y < ry + h; y++) {
      for (let x = rx; x < rx + w; x++) solid[at(x, y)] = 0;
    }
  }

  // 外周は必ず壁
  for (let i = 0; i < size; i++) {
    solid[at(i, 0)] = 1;
    solid[at(i, size - 1)] = 1;
    solid[at(0, i)] = 1;
    solid[at(size - 1, i)] = 1;
  }

  // 壁の種類（テクスチャ番号）を割り当てる
  const tiles = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!solid[at(x, y)]) continue;
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      if (edge) {
        tiles[at(x, y)] = 3;
      } else {
        const zone = (x < size / 2 ? 0 : 1) + (y < size / 2 ? 0 : 2);
        const r = rnd();
        if (r < 0.08) tiles[at(x, y)] = 4;
        else tiles[at(x, y)] = [1, 2, 3, 1][zone];
      }
    }
  }

  // 壁をランダムに壊した結果できた「四方を囲まれた孤立マス」を塞ぐ。
  // 放置すると到達できない場所に敵やアイテムが湧いてゲームが進まなくなる。
  const reachable = new Uint8Array(size * size);
  const queue = [at(1, 1)];
  reachable[at(1, 1)] = 1;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const cx = cur % size;
    const cy = (cur / size) | 0;
    const push = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) return;
      const ni = at(nx, ny);
      if (tiles[ni] || reachable[ni]) return;
      reachable[ni] = 1;
      queue.push(ni);
    };
    push(cx - 1, cy);
    push(cx + 1, cy);
    push(cx, cy - 1);
    push(cx, cy + 1);
  }

  const open = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = at(x, y);
      if (tiles[i]) continue;
      if (!reachable[i]) {
        tiles[i] = 3; // 到達できない空間は壁で埋める
        continue;
      }
      open.push([x + 0.5, y + 0.5]);
    }
  }

  return { size, tiles, open };
}
