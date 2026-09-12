/**
 * 町の人。
 *
 * 立っているだけにしない。持ち場で働き、決まった道を歩き、
 * 向かい合って話し、ベンチに座る。時間帯で行動が変わる簡易スケジュールつき。
 */

import { Skeleton } from '../core/skeleton.js';
import { HumanAnimator } from './humanAnim.js';
import { buildHuman, randomLook, HUMAN_BONES } from './characters.js';
import { m4compose, mat4, damp, dampAngle } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';

/** 役割ごとの見た目と台詞。 */
const ROLES = {
  citizen: {
    lines: [
      ['「おはよう。今日はいい風だね」', '「泉の光、昨日より明るい気がする」'],
      ['「マーケット通りのパン、焼きたてが出てるよ」'],
      ['「森の門には近づかない方がいい。……まだね」'],
      ['「アストラって不思議だよね。こっちの気持ち、ぜんぶ分かってるみたい」'],
    ]
  },
  elder: {
    look: { hair: [0.82, 0.82, 0.85], hairStyle: 0, top: [0.42, 0.38, 0.34], build: 0.92 },
    lines: [['「わしの相棒はもう歳でな。日向で寝てばかりじゃ」',
      '「じゃがな、わしが転びそうになると、今でも真っ先に飛んでくるんじゃ」']]
  },
  child: {
    look: { heightScale: 0.7, build: 0.85, hairStyle: 3 },
    lines: [['「ねえねえ！ ぼくもいつかアストラと旅に出るんだ！」'],
      ['「研究所のおねえさん、すっごく頭いいんだよ」']],
    speed: 3.4
  },
  vendor: {
    look: { apron: true, hat: 'cap', sleeves: 'short' },
    lines: [['「いらっしゃい！ 今日のおすすめは……ぜんぶだ！」'],
      ['「旅に出るなら、まずは丈夫な靴からだよ」']]
  },
  sweeper: {
    look: { apron: true, hat: 'straw' },
    lines: [['「広場はいつもきれいにしておきたくてね」',
      '「この町の朝は、掃除の音から始まるのさ」']]
  },
  doctor: {
    look: { top: [0.95, 0.96, 0.94], bottom: [0.75, 0.85, 0.82], hairStyle: 2, sleeves: 'long' },
    lines: [['「アストラも人と同じ。無理をすれば疲れる」',
      '「診療所はいつでも開いてる。相棒を連れておいで」']]
  },
  scientist: {
    look: { top: [0.92, 0.94, 0.98], bottom: [0.3, 0.36, 0.48], sleeves: 'long', hairStyle: 1 },
    lines: [['「ノヴァ粒子の濃度が、この一ヶ月で 12% 上がっている」',
      '「原因はまだ分からない。でも、悪いことばかりじゃないはずよ」']]
  },
  fisher: {
    look: { hat: 'straw', top: [0.4, 0.5, 0.42] },
    lines: [['「この川にはミズネって子がいてね。糸を垂らすと遊びに来るんだ」']]
  },
  guard: {
    look: { top: [0.28, 0.34, 0.46], bottom: [0.24, 0.28, 0.36], belt: true, sleeves: 'long', build: 1.15 },
    lines: [['「森へ行くのか？ 相棒がいないなら止めておけ」',
      '「……その目は、行く気だな。せめて研究所で話を聞いてからにしろ」']]
  }
};

/** よく使う巡回ルート。 */
const ROUTES = {
  plaza: [[-6, 8], [4, 10], [10, 2], [2, -8], [-8, -4]],
  plazaRun: [[6, -6], [12, 4], [2, 12], [-8, 6], [-6, -8]],
  shopToPlaza: [[-20, -2], [-12, 2], [-2, 6], [-10, 10], [-20, 2]],
  residential: [[-44, 34], [-52, 30], [-58, 38], [-50, 46], [-42, 42]],
  residentialRun: [[-54, 46], [-46, 52], [-38, 48], [-44, 38]]
};

export class Npc {
  constructor(renderer, mats, terrain, collision, spawn, index) {
    const role = ROLES[spawn.kind] || ROLES.citizen;
    const look = { ...randomLook(index * 37 + 5), ...(role.look || {}) };
    this.look = look;
    this.kind = spawn.kind;
    this.name = spawn.name || '';
    this.heightScale = look.heightScale || 1;
    const built = buildHuman(mats, look);
    this.object = renderer.createObject(built.batches, { boneCount: built.boneCount, radius: 1.2 });
    this.skeleton = new Skeleton(HUMAN_BONES);
    this.animator = new HumanAnimator(this.skeleton, { strideLength: 1.45 * this.heightScale });
    this.object.bones = this.skeleton.skinData;

    this.terrain = terrain;
    this.collision = collision;
    this.x = spawn.x;
    this.z = spawn.z;
    this.y = terrain.height(spawn.x, spawn.z);
    this.facing = spawn.facing || 0;
    this.homeX = spawn.x;
    this.homeZ = spawn.z;
    this.baseClip = spawn.clip || 'idle';
    this.route = ROUTES[spawn.route] || null;
    this.routeIndex = Math.floor(hash2(index, 1, 5) * 4);
    this.speed = role.speed || (1.05 + hash2(index, 2, 5) * 0.5);
    this.state = this.route ? 'wait' : 'post';
    this.timer = hash2(index, 3, 5) * 6;
    this.vx = 0; this.vz = 0;
    this.currentSpeed = 0;
    this.lines = role.lines ? role.lines[index % role.lines.length] : ['「……」'];
    this.talking = false;
    this.attention = null;
    this.matrix = mat4();
    this.radius = 0.34;
    this.collider = collision.addCircle(this.x, this.z, 0.32, { height: 1.8, tag: 'npc' });
    this.footstep = 0;
  }

  /** プレイヤーが近づいたらそちらを向く。 */
  setAttention(target) { this.attention = target; }

  update(dt, time) {
    let clip = this.baseClip;
    let moving = false;

    if (this.talking) {
      clip = 'talk';
      this.currentSpeed = damp(this.currentSpeed, 0, 10, dt);
    } else if (this.route) {
      this.timer -= dt;
      if (this.state === 'wait') {
        clip = this.baseClip === 'walk' ? 'idle' : this.baseClip;
        if (this.timer <= 0) {
          this.state = 'walk';
          this.timer = 6 + Math.random() * 8;
        }
      }
      if (this.state === 'walk') {
        const t = this.route[this.routeIndex % this.route.length];
        const dx = t[0] - this.x, dz = t[1] - this.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.7) {
          this.routeIndex++;
          this.state = 'wait';
          this.timer = 2.5 + Math.random() * 6;
        } else {
          const nx = dx / d, nz = dz / d;
          this.vx = damp(this.vx, nx * this.speed, 6, dt);
          this.vz = damp(this.vz, nz * this.speed, 6, dt);
          moving = true;
          clip = this.speed > 2.6 ? 'run' : 'walk';
        }
      }
    }

    if (!moving) {
      this.vx = damp(this.vx, 0, 9, dt);
      this.vz = damp(this.vz, 0, 9, dt);
    }
    const nx = this.x + this.vx * dt;
    const nz = this.z + this.vz * dt;
    // NPC 同士・建物との押し出し（自分の当たり判定は一時的に外す）
    this.collider.r = 0;
    const [rx, rz] = this.collision.resolve(nx, nz, this.radius);
    this.collider.r = 0.32;
    this.x = rx; this.z = rz;
    this.collider.x = rx; this.collider.z = rz;
    this.y = damp(this.y, this.terrain.height(this.x, this.z), 12, dt);
    this.currentSpeed = Math.hypot(this.vx, this.vz);

    // 向き：歩いていれば進行方向、話しかけられていればプレイヤー
    let wantFacing = this.facing;
    if (this.attention) {
      wantFacing = Math.atan2(this.attention[0] - this.x, this.attention[2] - this.z);
    } else if (this.currentSpeed > 0.2) {
      wantFacing = Math.atan2(this.vx, this.vz);
    }
    this.facing = dampAngle(this.facing, wantFacing, 7, dt);

    this.animator.setClip(clip);
    this.footstep = this.animator.update(dt, { speed: this.currentSpeed, lean: 0 });

    const s = this.heightScale;
    m4compose(this.object.matrix, this.x, this.y, this.z, this.facing, s, s, s);
    this.object.bones = this.skeleton.skinData;
    return this.footstep;
  }
}

/** 町ぶんの NPC をまとめて管理する。 */
export class NpcManager {
  constructor(renderer, mats, terrain, collision, spawns) {
    this.npcs = spawns.map((s, i) => new Npc(renderer, mats, terrain, collision, s, i));
    this.talkTarget = null;
  }

  /** プレイヤーに一番近い、話しかけられる NPC。 */
  nearest(x, z, maxDist = 2.6) {
    let best = null, bestD = maxDist;
    for (const n of this.npcs) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  update(dt, time, playerPos, onFootstep) {
    for (const n of this.npcs) {
      const d = Math.hypot(n.x - playerPos[0], n.z - playerPos[2]);
      n.setAttention(d < 4.2 ? playerPos : null);
      // 遠い NPC は更新頻度を落とす（見た目には分からない）
      if (d > 55) {
        n.slowTick = (n.slowTick || 0) + dt;
        if (n.slowTick < 0.2) continue;
        n.update(n.slowTick, time);
        n.slowTick = 0;
        continue;
      }
      const step = n.update(dt, time);
      if (step && onFootstep && d < 18) onFootstep(n.x, n.y, n.z, d);
    }
  }
}
