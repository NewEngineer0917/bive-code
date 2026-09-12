/**
 * 町で暮らすアストラ。
 *
 * 人間と同じ空間にいて、それぞれ別の生き方をしている。
 *   屋根の上を旋回する飛行種、川を泳ぐ水棲種、老人と歩く小型種、
 *   荷を運ぶ大型種、診療所で眠る種。
 * 「人とアストラが共に暮らす世界」を、説明ではなく動きで見せる。
 */

import { Skeleton } from '../core/skeleton.js';
import { CreatureAnimator } from '../creatures/anim.js';
import { TOWN_SPECIES, SPECIES_INFO } from '../creatures/species.js';
import { m4trs, clamp, damp, dampAngle, TAU, lerp } from '../core/math.js';
import { hash2 } from '../gfx/noise.js';
import { KIND } from '../gfx/particles.js';

/** 町に置くアストラの配置表。 */
export const TOWN_ASTRA = [
  // 屋根の上を旋回する
  { species: 'lumiwing', behavior: 'circle', x: 6, z: -14, radius: 16, height: 9.5, speed: 3.4, scale: 0.95 },
  { species: 'lumiwing', behavior: 'circle', x: -28, z: 30, radius: 20, height: 11, speed: 3.0, scale: 0.85,
    color: [1.05, 0.86, 0.72], accent: [1.0, 0.72, 0.4] },
  { species: 'lumiwing', behavior: 'perch', x: -3.7, z: 18.6, height: 2.55, scale: 0.8 },
  // 川を泳ぐ
  { species: 'nagira', behavior: 'swim', pathIndex: 0, speed: 1.5, scale: 1.15 },
  { species: 'nagira', behavior: 'swim', pathIndex: 0.55, speed: 1.2, scale: 0.9,
    color: [0.62, 0.82, 1.05] },
  // 老人と散歩する
  { species: 'koponi', behavior: 'follow', followNpc: 0, scale: 1.0 },
  { species: 'koponi', behavior: 'wander', x: -46, z: 40, radius: 7, scale: 0.85,
    color: [1.1, 0.92, 1.05], accent: [0.85, 0.6, 0.95] },
  // 荷運び
  { species: 'baggal', behavior: 'route', route: [[6, 22], [4, 40], [6, 58], [10, 40], [8, 24]], speed: 1.1, scale: 1.0 },
  // 診療所で眠る
  { species: 'dozuri', behavior: 'sleep', x: 26.6, z: -24.2, scale: 1.1 },
  { species: 'dozuri', behavior: 'wander', x: 25, z: -22, radius: 2.4, scale: 0.9,
    color: [0.9, 0.95, 0.72], accent: [1.1, 0.95, 0.6] },
];

class AstraEntity {
  constructor(renderer, mats, terrain, collision, spec, index) {
    const build = TOWN_SPECIES[spec.species];
    const info = SPECIES_INFO[spec.species];
    this.spec = spec;
    this.info = info;
    this.scale = (spec.scale || 1) * (info.size || 1);
    const built = build(mats, { color: spec.color, accent: spec.accent });
    this.object = renderer.createObject(built.batches, {
      boneCount: built.boneCount, radius: 1.6 * this.scale,
    });
    this.skeleton = new Skeleton(built.bones);
    this.anim = new CreatureAnimator(this.skeleton, { strideLength: 0.8 * this.scale });
    this.object.bones = this.skeleton.skinData;
    this.sockets = built.sockets || {};

    this.terrain = terrain;
    this.collision = collision;
    this.x = spec.x || 0;
    this.z = spec.z || 0;
    this.y = terrain.height(this.x, this.z);
    this.facing = 0;
    this.phase = hash2(index, 1, 7) * TAU;
    this.timer = hash2(index, 2, 7) * 5;
    this.speed = 0;
    this.state = 'idle';
    this.routeIndex = 0;
    this.bob = 0;
    this.emitTimer = 0;
    if (spec.behavior === 'circle' || spec.behavior === 'perch') this.flying = true;
    if (spec.behavior === 'swim') this.swimming = true;
    if (spec.behavior !== 'circle' && spec.behavior !== 'swim') {
      this.collider = collision.addCircle(this.x, this.z, 0.3 * this.scale + 0.1,
        { height: 1.4 * this.scale, tag: 'astra' });
    }
  }

  update(dt, time, ctx) {
    const s = this.spec;
    let clip = 'idle';
    let targetX = this.x, targetZ = this.z, targetY = this.y;
    this.speed = damp(this.speed, 0, 6, dt);

    switch (s.behavior) {
      case 'circle': {
        // 屋根の上を旋回する。少し上下しながら大きく回る
        this.phase += (s.speed / Math.max(1, s.radius)) * dt;
        targetX = s.x + Math.cos(this.phase) * s.radius;
        targetZ = s.z + Math.sin(this.phase) * s.radius;
        targetY = this.terrain.height(targetX, targetZ) + s.height
          + Math.sin(time * 0.7 + this.phase * 2) * 0.8;
        this.facing = dampAngle(this.facing, this.phase + Math.PI / 2 + Math.PI, 6, dt);
        clip = 'fly';
        this.speed = s.speed;
        break;
      }
      case 'perch': {
        targetY = this.terrain.height(this.x, this.z) + s.height;
        // ときどき羽づくろいのように身じろぎする
        this.timer -= dt;
        if (this.timer <= 0) { this.timer = 3 + Math.random() * 6; this.perchAlert = !this.perchAlert; }
        clip = this.perchAlert ? 'idleAlert' : 'idle';
        this.facing = dampAngle(this.facing, Math.sin(time * 0.3) * 1.4, 2, dt);
        break;
      }
      case 'swim': {
        // 川の流れに沿って下る
        const path = ctx.riverPath;
        this.phase += (s.speed / 90) * dt;
        const t = (s.pathIndex + this.phase) % 1;
        const p = samplePath(path, t);
        const ahead = samplePath(path, (t + 0.02) % 1);
        targetX = p[0] + Math.sin(time * 0.8 + this.phase * 9) * 1.4;
        targetZ = p[1] + Math.cos(time * 0.7 + this.phase * 9) * 1.4;
        targetY = this.terrain.waterHeightAt(targetX, targetZ) - 0.08
          + Math.sin(time * 1.3 + this.phase * 12) * 0.06;
        this.facing = dampAngle(this.facing, Math.atan2(ahead[0] - p[0], ahead[1] - p[1]), 3, dt);
        clip = 'swim';
        this.speed = s.speed;
        break;
      }
      case 'follow': {
        const npc = ctx.npcs[s.followNpc];
        if (npc) {
          const dx = npc.x - this.x, dz = npc.z - this.z;
          const d = Math.hypot(dx, dz);
          if (d > 1.6) {
            const k = Math.min(1, (d - 1.2) / 2);
            this.speed = lerp(0, npc.currentSpeed + 0.8, k) + 0.2;
            targetX = this.x + (dx / d) * this.speed * dt;
            targetZ = this.z + (dz / d) * this.speed * dt;
            this.facing = dampAngle(this.facing, Math.atan2(dx, dz), 7, dt);
            clip = this.speed > 1.9 ? 'run' : 'walk';
          } else {
            this.facing = dampAngle(this.facing, Math.atan2(dx, dz), 4, dt);
            clip = npc.currentSpeed < 0.1 ? (hash2(0, Math.floor(time / 6), 3) > 0.6 ? 'idleAlert' : 'idle') : 'idle';
          }
        }
        targetY = this.terrain.height(targetX, targetZ);
        break;
      }
      case 'wander': {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.timer = 3 + Math.random() * 6;
          const a = Math.random() * TAU;
          const r = Math.random() * s.radius;
          this.wantX = s.x + Math.cos(a) * r;
          this.wantZ = s.z + Math.sin(a) * r;
          this.state = Math.random() > 0.35 ? 'walk' : 'graze';
        }
        if (this.state === 'walk' && this.wantX !== undefined) {
          const dx = this.wantX - this.x, dz = this.wantZ - this.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.35) {
            this.speed = 0.85;
            targetX = this.x + (dx / d) * this.speed * dt;
            targetZ = this.z + (dz / d) * this.speed * dt;
            this.facing = dampAngle(this.facing, Math.atan2(dx, dz), 6, dt);
            clip = 'walk';
          } else { this.state = 'graze'; }
        } else {
          clip = this.state === 'graze' ? 'eat' : 'idle';
        }
        targetY = this.terrain.height(targetX, targetZ);
        break;
      }
      case 'route': {
        const route = s.route;
        const t = route[this.routeIndex % route.length];
        const dx = t[0] - this.x, dz = t[1] - this.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.0) { this.routeIndex++; }
        else {
          this.speed = s.speed;
          targetX = this.x + (dx / d) * this.speed * dt;
          targetZ = this.z + (dz / d) * this.speed * dt;
          this.facing = dampAngle(this.facing, Math.atan2(dx, dz), 3.5, dt);
          clip = 'walk';
        }
        targetY = this.terrain.height(targetX, targetZ);
        break;
      }
      case 'sleep':
      default: {
        clip = 'sleep';
        targetY = this.terrain.height(this.x, this.z);
        break;
      }
    }

    if (s.behavior === 'circle' || s.behavior === 'swim') {
      this.x = targetX; this.z = targetZ;
      this.y = damp(this.y, targetY, 6, dt);
    } else {
      this.x = targetX; this.z = targetZ;
      this.y = damp(this.y, targetY, 12, dt);
      if (this.collider) { this.collider.x = this.x; this.collider.z = this.z; }
    }

    this.anim.setClip(clip);
    const step = this.anim.update(dt, { speed: this.speed });
    const tilt = s.behavior === 'circle' ? -0.35 : 0;
    m4trs(this.object.matrix, this.x, this.y, this.z, 0, this.facing, tilt,
      this.scale, this.scale, this.scale);
    this.object.bones = this.skeleton.skinData;

    // 元素の粒（飛行種は光、水棲種は水しぶき）
    this.emitTimer -= dt;
    if (this.emitTimer <= 0 && ctx.particles && ctx.nearPlayer < 46) {
      this.emitTimer = 0.12 + Math.random() * 0.1;
      if (s.species === 'lumiwing') {
        ctx.particles.spawn({
          x: this.x + (Math.random() - 0.5) * 0.5, y: this.y + 0.3, z: this.z + (Math.random() - 0.5) * 0.5,
          vx: 0, vy: -0.25, vz: 0, size: 0.035, sizeEnd: 0.005, life: 1.1,
          color: [0.6, 0.95, 1.0], alpha: 0.8, kind: KIND.GLOW, glow: 1.4, drag: 0.6,
        });
      } else if (s.species === 'nagira') {
        ctx.particles.spawn({
          x: this.x + (Math.random() - 0.5) * 0.6, y: this.y + 0.15, z: this.z + (Math.random() - 0.5) * 0.6,
          vx: (Math.random() - 0.5) * 0.3, vy: 0.4, vz: (Math.random() - 0.5) * 0.3,
          size: 0.04, life: 0.7, color: [0.75, 0.95, 1.0], alpha: 0.7,
          kind: KIND.GLOW, glow: 0.7, gravity: -3.4, drag: 0.4,
        });
      }
    }
    return step;
  }
}

/** 折れ線のパラメータ位置をサンプルする（0..1）。 */
function samplePath(path, t) {
  const n = path.length - 1;
  const f = clamp(t, 0, 0.9999) * n;
  const i = Math.floor(f);
  const k = f - i;
  const a = path[i], b = path[Math.min(n, i + 1)];
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
}

export class TownAstraManager {
  constructor(renderer, mats, terrain, collision, riverPath, list = TOWN_ASTRA) {
    this.entities = list.map((s, i) => new AstraEntity(renderer, mats, terrain, collision, s, i));
    this.riverPath = riverPath;
  }

  update(dt, time, npcs, particles, playerPos) {
    for (const e of this.entities) {
      const d = Math.hypot(e.x - playerPos[0], e.z - playerPos[2]);
      if (d > 70) { e.slow = (e.slow || 0) + dt; if (e.slow < 0.25) continue; }
      const step = e.slow ? e.slow : dt;
      e.slow = 0;
      e.update(step, time, { npcs, particles, riverPath: this.riverPath, nearPlayer: d });
    }
  }

  /** 一番近いアストラ（話しかけ／なでる対象）。 */
  nearest(x, z, maxDist = 3) {
    let best = null, bestD = maxDist;
    for (const e of this.entities) {
      if (e.spec.behavior === 'circle') continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }
}
