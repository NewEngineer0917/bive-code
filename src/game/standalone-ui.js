/* ------------------------- 単一HTML版のUI層（バニラJS） ------------------------- */
(function () {
  const root = document.getElementById('game');
  const canvas = document.getElementById('view');
  const el = (id) => document.getElementById(id);
  const overlays = {
    menu: el('menu'), paused: el('paused'), over: el('over'),
  };

  const coarse = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  const BEST_KEY = 'blasterzone.best';
  const readBest = () => { try { return Number(localStorage.getItem(BEST_KEY) || 0); } catch (e) { return 0; } };
  const writeBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* 保存できない環境は無視 */ } };

  let phase = 'menu';
  let difficulty = 'normal';
  let best = readBest();
  let usingPointerLock = false;

  const game = new Game(canvas, {
    onEvent,
    glCanvas: el('gl'),
    audio: { data: window.__BZ_AUDIO },     // ビルド時に埋め込まれた効果音
    models: { data: window.__BZ_MODELS },   // 同・3Dモデル
  });
  if (window.__BZ) window.__BZ.game = game; // デバッグ・動作確認用

  function setPhase(next) {
    phase = next;
    for (const key of Object.keys(overlays)) overlays[key].hidden = key !== next;
    el('hud').hidden = next !== 'playing';
    el('touch').hidden = next !== 'playing' || !coarse;
  }

  function showBanner(title, sub) {
    const b = el('banner');
    b.innerHTML = '';
    b.appendChild(document.createTextNode(title));
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      b.appendChild(small);
    }
    b.hidden = false;
    b.style.animation = 'none';
    void b.offsetWidth; // アニメーションを再生し直す
    b.style.animation = '';
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(() => { b.hidden = true; }, 2200);
  }

  function onEvent(type, payload) {
    if (type === 'wave') {
      showBanner('WAVE ' + payload.wave);
    } else if (type === 'weaponup') {
      showBanner(payload.name + ' Lv.' + payload.level, payload.perk);
    } else if (type === 'newweapon') {
      showBanner('NEW WEAPON', payload.name + '：' + payload.mode
        + '／装弾 ' + payload.magazine + '（' + payload.slot + ' キーで切替）');
    } else if (type === 'gameover_LEGACY') {
      const b = el('banner');
      b.hidden = false;
    } else if (type === 'gameover') {
      if (payload.score > best) { best = payload.score; writeBest(best); el('over-note').textContent = 'ハイスコア更新！'; }
      else el('over-note').textContent = 'ハイスコア ' + best;
      el('r-score').textContent = payload.score;
      el('r-wave').textContent = payload.wave;
      el('r-kills').textContent = payload.kills;
      setPhase('over');
      if (document.pointerLockElement) document.exitPointerLock();
    } else if (type === 'state' && (payload.state === 'paused' || payload.state === 'playing')) {
      setPhase(payload.state);
    }
  }

  /* --------------------------------- HUD --------------------------------- */
  setInterval(() => {
    if (phase !== 'playing' || !game.player) return;
    const h = game.getHud();
    el('hp-fill').style.width = Math.max(0, (h.hp / h.maxHp) * 100) + '%';
    el('hp-bar').classList.toggle('low', h.hp / h.maxHp < 0.35);
    el('c-hp').textContent = 'HP ' + h.hp;
    el('c-wave').textContent = 'WAVE ' + h.wave;
    el('c-score').textContent = 'SCORE ' + h.score;
    el('c-enemies').textContent = '敵 ' + h.enemies;
    el('ammo').textContent = h.mag;
    el('w-name').firstChild.textContent = h.weapon;
    const mode = el('w-mode');
    mode.textContent = h.weaponMode;
    mode.classList.toggle('semi', h.weaponMode === 'SEMI');
    el('w-perk').textContent = 'Lv.' + h.weaponLevel + '　' + h.weaponPerk;
    el('w-level').textContent = 'Lv.' + h.weaponLevel;
    el('w-fill').style.width = ((h.weaponRatio || 0) * 100) + '%';
    el('reserve').textContent = h.reserve;
    el('ammo-box').classList.toggle('empty', h.mag === 0);

    // リロード表示
    const bar = el('reload-bar');
    bar.hidden = !h.reloading;
    if (h.reloading) bar.firstElementChild.style.width = (h.reloadRatio * 100) + '%';

    // 武器スロット（数が変わったときだけ作り直す）
    const slots = el('slots');
    if (slots.childElementCount !== h.slots.length) {
      slots.innerHTML = '';
      h.slots.forEach((sl, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'slot';
        b.innerHTML = '<span class="num">' + sl.slot + '</span>' + sl.short
          + '<span class="mode">' + sl.mode + '</span><span class="ammo"></span>';
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          game.switchWeapon(i);
        });
        slots.appendChild(b);
      });
    }
    h.slots.forEach((sl, i) => {
      const b = slots.children[i];
      if (!b) return;
      b.classList.toggle('active', i === h.slot);
      b.lastElementChild.textContent = 'Lv.' + sl.level + '  ' + sl.mag + '/' + sl.reserve;
    });
  }, 100);

  /* ------------------------------- キーボード ------------------------------- */
  const keys = new Set();
  const has = (...list) => list.some((k) => keys.has(k));
  function applyKeys() {
    game.input.forward = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
    game.input.strafe = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0);
    game.input.turn = (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0);
    game.input.sprint = has('ShiftLeft', 'ShiftRight');
    game.input.firing = keys.has('Space') && phase === 'playing';
  }
  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === 'Escape') { if (phase === 'playing') game.setPaused(true); return; }
    if (phase === 'playing') {
      if (e.code === 'KeyR') { game.reload(); return; }
      if (e.code === 'KeyQ') { game.cycleWeapon(-1); return; }
      if (e.code === 'KeyE') { game.cycleWeapon(1); return; }
      const digit = /^Digit([1-4])$/.exec(e.code);
      if (digit) { game.switchWeapon(Number(digit[1]) - 1); return; }
    }
    if (e.repeat) return;
    keys.add(e.code);
    applyKeys();
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); applyKeys(); });
  window.addEventListener('blur', () => { keys.clear(); applyKeys(); });

  /* ---------------------- マウス（ポインターロック＋代替操作） ---------------------- */
  document.addEventListener('pointerlockchange', () => {
    usingPointerLock = document.pointerLockElement === canvas;
    if (!usingPointerLock && phase === 'playing') game.setPaused(true);
  });
  document.addEventListener('mousemove', (e) => {
    if (usingPointerLock && phase === 'playing') game.look(e.movementX * 0.0022, e.movementY * 0.0016);
  });
  // ポインターロックの有無にかかわらず、左ボタンで射撃できるようにする。
  // 押した瞬間にも1発撃つので、一瞬のクリックでも取りこぼさない。
  canvas.addEventListener('mousedown', (e) => {
    if (phase !== 'playing' || e.button !== 0) return;
    if (!usingPointerLock) tryPointerLock();
    game.input.firing = true;
    game.fire();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) game.input.firing = false;
  });
  window.addEventListener('blur', () => { game.input.firing = false; });

  function tryPointerLock() {
    if (coarse || !canvas.requestPointerLock) return;
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { /* 埋め込み環境では使えないのでドラッグ操作にフォールバック */ });
  }

  window.addEventListener('wheel', (e) => {
    if (phase !== 'playing') return;
    game.cycleWeapon(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  /* --------------------- タッチ／ドラッグ操作（共通ポインター） --------------------- */
  const touch = { move: null, look: null };
  const knob = el('knob');
  const stick = el('stick');
  const stickRadius = () => {
    const r = root.getBoundingClientRect();
    return Math.max(48, Math.min(72, Math.min(r.width, r.height) * 0.13));
  };

  root.addEventListener('pointerdown', (e) => {
    if (phase !== 'playing') return;
    if (e.pointerType === 'mouse' && usingPointerLock) return; // ロック中は上のハンドラが担当
    if (e.target.closest('.btn-round, .icon-btn, .slot')) return;
    e.preventDefault();
    const r = root.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < r.width * 0.45 && touch.move === null) {
      touch.move = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      stick.style.left = x + 'px';
      stick.style.top = (e.clientY - r.top) + 'px';
      knob.style.transform = 'translate(0px, 0px)';
      stick.hidden = false;
    } else if (touch.look === null) {
      touch.look = {
        id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0,
        t: performance.now(), mouse: e.pointerType === 'mouse',
      };
      // マウスの場合 preventDefault で mousedown が来なくなるため、ここで発砲する
      if (e.pointerType === 'mouse' && e.button === 0) {
        tryPointerLock();
        game.input.firing = true;
        game.fire();
      }
    }
    try { root.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
  }, { passive: false });

  root.addEventListener('pointermove', (e) => {
    if (touch.move && touch.move.id === e.pointerId) {
      e.preventDefault();
      const r = stickRadius();
      let dx = e.clientX - touch.move.ox;
      let dy = e.clientY - touch.move.oy;
      const len = Math.hypot(dx, dy);
      if (len > r) { dx = (dx / len) * r; dy = (dy / len) * r; }
      game.input.forward = -dy / r;
      game.input.strafe = dx / r;
      game.input.sprint = len / r > 0.85;
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    } else if (touch.look && touch.look.id === e.pointerId) {
      e.preventDefault();
      const dx = e.clientX - touch.look.x;
      const dy = e.clientY - touch.look.y;
      touch.look.x = e.clientX;
      touch.look.y = e.clientY;
      touch.look.moved += Math.abs(dx) + Math.abs(dy);
      game.look(dx * 0.0042, dy * 0.0022);
    }
  }, { passive: false });

  function endPointer(e) {
    if (touch.move && touch.move.id === e.pointerId) {
      touch.move = null;
      game.input.forward = 0;
      game.input.strafe = 0;
      game.input.sprint = false;
      stick.hidden = true;
    } else if (touch.look && touch.look.id === e.pointerId) {
      const quick = performance.now() - touch.look.t < 260 && touch.look.moved < 14;
      const wasMouse = touch.look.mouse;
      touch.look = null;
      if (wasMouse) game.input.firing = false;
      // タップで単発射撃（マウスは押した時点で撃っているので除外）
      else if (quick && phase === 'playing') game.fire();
    }
  }
  root.addEventListener('pointerup', endPointer);
  root.addEventListener('pointercancel', endPointer);

  /* ------------------------------- ボタン類 ------------------------------- */
  function holdButton(id, on) {
    const b = el(id);
    if (!b) return;
    const set = (v) => (e) => { e.preventDefault(); e.stopPropagation(); if (phase === 'playing') on(v); };
    b.addEventListener('pointerdown', set(true));
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointercancel', set(false));
    b.addEventListener('pointerleave', set(false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  holdButton('fire-btn', (v) => { game.input.firing = v; });
  holdButton('dash-btn', (v) => { game.input.sprint = v; });
  const reloadBtn = el('reload-btn');
  if (reloadBtn) {
    reloadBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      game.reload();
    });
    reloadBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  el('pause-btn').addEventListener('click', () => game.setPaused(true));
  el('mute-btn').addEventListener('click', function () {
    const muted = !game.sfx.muted;
    game.sfx.setMuted(muted);
    this.textContent = muted ? '🔇' : '🔊';
  });
  el('full-btn').addEventListener('click', () => {
    if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen(); }
    else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
  });

  function startGame(key) {
    el('slots').innerHTML = '';
    const hint = el('hint');
    hint.hidden = false;
    hint.style.animation = 'none';
    void hint.offsetWidth;
    hint.style.animation = '';
    clearTimeout(startGame._t);
    startGame._t = setTimeout(() => { hint.hidden = true; }, 8000);
    difficulty = key || difficulty;
    game.sfx.resume();
    setPhase('playing');
    game.resize();
    game.newGame(difficulty);
    if (coarse && root.requestFullscreen) {
      root.requestFullscreen().then(() => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }, () => {});
    } else {
      tryPointerLock();
    }
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-difficulty]'), (b) => {
    b.addEventListener('click', () => startGame(b.getAttribute('data-difficulty')));
  });
  el('resume-btn').addEventListener('click', () => {
    game.setPaused(false);
    setPhase('playing');
    tryPointerLock();
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-action="restart"]'), (b) => {
    b.addEventListener('click', () => startGame(difficulty));
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-action="title"]'), (b) => {
    b.addEventListener('click', () => {
      game.state = 'menu';
      game.input.firing = false;
      if (document.pointerLockElement) document.exitPointerLock();
      setPhase('menu');
      el('best').textContent = best > 0 ? 'ハイスコア ' + best : '';
    });
  });

  /* -------------------------------- 起動処理 -------------------------------- */
  window.addEventListener('resize', () => game.resize());
  window.addEventListener('orientationchange', () => game.resize());
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.setPaused(true); });

  if (best > 0) el('best').textContent = 'ハイスコア ' + best;
  if (coarse) el('hint-portrait').hidden = window.innerWidth > window.innerHeight;
  setPhase('menu');
  game.start();
})();
