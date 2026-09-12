/**
 * 入力。PC（キーボード＋マウス）とスマホ（仮想スティック＋ドラッグ）の両対応。
 *
 * 画面左半分のドラッグ＝移動、右半分のドラッグ＝視点。
 * ポインタロックは任意で、ロックしていなくても右ドラッグで視点を回せる。
 */

import { clamp } from './math.js';

export class Input {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.keys = new Set();
    this.move = { x: 0, y: 0 };        // -1..1（前後左右）
    this.look = { x: 0, y: 0 };        // このフレームの視点移動量
    this.zoomDelta = 0;
    this.run = false;
    this.pressed = new Set();          // このフレームに押された
    this.released = new Set();
    this.pointerLocked = false;
    this.touch = { active: false, stickX: 0, stickY: 0, originX: 0, originY: 0, id: -1 };
    this.lookTouchId = -1;
    this.sensitivity = opts.sensitivity || 0.0022;
    this.touchSensitivity = opts.touchSensitivity || 0.006;
    this.enabled = true;
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      const k = e.code;
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(k)) e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    };
    this._onMouseMove = (e) => {
      if (!this.enabled) return;
      if (this.pointerLocked) {
        this.look.x += e.movementX * this.sensitivity;
        this.look.y += e.movementY * this.sensitivity;
      } else if (this.dragging) {
        this.look.x += e.movementX * this.sensitivity * 1.3;
        this.look.y += e.movementY * this.sensitivity * 1.3;
      }
    };
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.dragging = true;
      this.pressed.add(e.button === 2 ? 'Mouse2' : 'Mouse0');
    };
    this._onMouseUp = (e) => {
      this.dragging = false;
      this.released.add(e.button === 2 ? 'Mouse2' : 'Mouse0');
    };
    this._onWheel = (e) => {
      if (!this.enabled) return;
      this.zoomDelta += Math.sign(e.deltaY) * 0.55;
      e.preventDefault();
    };
    this._onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === c;
    };
    this._onContext = (e) => e.preventDefault();

    const touchPos = (t) => {
      const r = c.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top, w: r.width, h: r.height };
    };
    this._onTouchStart = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const p = touchPos(t);
        if (p.x < p.w * 0.45 && this.touch.id === -1) {
          this.touch.active = true;
          this.touch.id = t.identifier;
          this.touch.originX = p.x;
          this.touch.originY = p.y;
          this.touch.stickX = 0;
          this.touch.stickY = 0;
        } else if (this.lookTouchId === -1) {
          this.lookTouchId = t.identifier;
          this._lastLook = p;
          this._lookStart = { x: p.x, y: p.y, t: performance.now() };
        }
      }
      e.preventDefault();
    };
    this._onTouchMove = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const p = touchPos(t);
        if (t.identifier === this.touch.id) {
          const dx = p.x - this.touch.originX;
          const dy = p.y - this.touch.originY;
          const max = Math.min(p.w, p.h) * 0.12;
          const len = Math.hypot(dx, dy);
          const k = len > max ? max / len : 1;
          this.touch.stickX = clamp((dx * k) / max, -1, 1);
          this.touch.stickY = clamp((dy * k) / max, -1, 1);
        } else if (t.identifier === this.lookTouchId) {
          this.look.x += (p.x - this._lastLook.x) * this.touchSensitivity;
          this.look.y += (p.y - this._lastLook.y) * this.touchSensitivity;
          this._lastLook = p;
        }
      }
      e.preventDefault();
    };
    this._onTouchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.id) {
          this.touch.active = false;
          this.touch.id = -1;
          this.touch.stickX = 0;
          this.touch.stickY = 0;
        } else if (t.identifier === this.lookTouchId) {
          // ほぼ動かさずに離したらタップ＝決定
          const p = touchPos(t);
          if (this._lookStart) {
            const moved = Math.hypot(p.x - this._lookStart.x, p.y - this._lookStart.y);
            const held = performance.now() - this._lookStart.t;
            if (moved < 12 && held < 350) this.pressed.add('Tap');
          }
          this.lookTouchId = -1;
        }
      }
      e.preventDefault();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    c.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    c.addEventListener('wheel', this._onWheel, { passive: false });
    c.addEventListener('contextmenu', this._onContext);
    document.addEventListener('pointerlockchange', this._onLockChange);
    c.addEventListener('touchstart', this._onTouchStart, { passive: false });
    c.addEventListener('touchmove', this._onTouchMove, { passive: false });
    c.addEventListener('touchend', this._onTouchEnd, { passive: false });
    c.addEventListener('touchcancel', this._onTouchEnd, { passive: false });
  }

  requestPointerLock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }

  exitPointerLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  /** 毎フレームの先頭で呼ぶ。 */
  beginFrame() {
    const k = this.keys;
    let mx = 0, my = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) my += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (this.touch.active) {
      mx += this.touch.stickX;
      my -= this.touch.stickY;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx;
    this.move.y = my;
    this.run = k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(this.touch.stickX, this.touch.stickY) > 0.85;
  }

  /** 毎フレームの最後で呼ぶ。 */
  endFrame() {
    this.look.x = 0;
    this.look.y = 0;
    this.zoomDelta = 0;
    this.pressed.clear();
    this.released.clear();
  }

  wasPressed(code) { return this.pressed.has(code); }

  /** 決定／調べる。 */
  get interactPressed() {
    return this.pressed.has('KeyE') || this.pressed.has('Space')
      || this.pressed.has('Enter') || this.pressed.has('Tap') || this.pressed.has('Mouse0');
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    const c = this.canvas;
    c.removeEventListener('mousedown', this._onMouseDown);
    c.removeEventListener('wheel', this._onWheel);
    c.removeEventListener('contextmenu', this._onContext);
    c.removeEventListener('touchstart', this._onTouchStart);
    c.removeEventListener('touchmove', this._onTouchMove);
    c.removeEventListener('touchend', this._onTouchEnd);
    c.removeEventListener('touchcancel', this._onTouchEnd);
  }
}
