import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Game, DIFFICULTIES } from '../game/engine';
import './FpsGame.css';

const MOUSE_SENS_X = 0.0022;
const MOUSE_SENS_Y = 0.0016;
const TOUCH_SENS_X = 0.0042;
const TOUCH_SENS_Y = 0.0022;
const BEST_KEY = 'fps.bestScore';

function readBest() {
  try {
    return Number(window.localStorage.getItem(BEST_KEY) || 0);
  } catch (e) {
    return 0;
  }
}

function writeBest(score) {
  try {
    window.localStorage.setItem(BEST_KEY, String(score));
  } catch (e) {
    /* localStorage が使えない環境では記録を諦める */
  }
}

const isCoarsePointer = () =>
  typeof window !== 'undefined' &&
  ((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window);

export default function FpsGame() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const glCanvasRef = useRef(null);
  const gameRef = useRef(null);
  const phaseRef = useRef('menu');
  const touchRef = useRef({ move: null, look: null });
  const knobRef = useRef(null);

  const [phase, setPhaseState] = useState('menu'); // menu | playing | paused | over
  const [hud, setHud] = useState({
    hp: 100, maxHp: 100, score: 0, wave: 0, enemies: 0,
    weapon: 'パルスブラスター', weaponLevel: 1, weaponRatio: 0,
    mag: 0, magSize: 0, reserve: 0, reloading: false, reloadRatio: 1,
    slot: 0, slots: [],
  });
  const [result, setResult] = useState(null);
  const [banner, setBanner] = useState(null);
  const [stick, setStick] = useState(null);
  const [muted, setMuted] = useState(false);
  const [touch, setTouch] = useState(false);
  const [portrait, setPortrait] = useState(false);
  const [best, setBest] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [difficulty, setDifficulty] = useState('normal');

  const setPhase = useCallback((next) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  /* ------------------------------ エンジンの初期化 ------------------------------ */

  useEffect(() => {
    setTouch(isCoarsePointer());
    setBest(readBest());

    const game = new Game(canvasRef.current, {
      glCanvas: glCanvasRef.current,
      onEvent: (type, payload) => {
        if (type === 'wave') {
          setBanner({ text: `WAVE ${payload.wave}`, id: Date.now() });
        } else if (type === 'weaponup') {
          setBanner({ text: `${payload.name} Lv.${payload.level}`, sub: payload.perk, id: Date.now() });
        } else if (type === 'newweapon') {
          setBanner({
            text: 'NEW WEAPON',
            sub: `${payload.name}：${payload.mode}／装弾 ${payload.magazine}（${payload.slot} キーで切替）`,
            id: Date.now(),
          });
        } else if (type === 'gameover') {
          setResult(payload);
          setPhase('over');
          setBest((prev) => {
            if (payload.score > prev) {
              writeBest(payload.score);
              return payload.score;
            }
            return prev;
          });
        } else if (type === 'state') {
          if (payload.state === 'paused' || payload.state === 'playing') setPhase(payload.state);
        }
      },
    });
    gameRef.current = game;
    game.start();

    const onResize = () => game.resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(wrapRef.current);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    const onOrientation = () => setPortrait(window.innerHeight > window.innerWidth);
    onOrientation();
    window.addEventListener('resize', onOrientation);

    const onVisibility = () => {
      if (document.hidden) game.setPaused(true);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      game.destroy();
      if (ro) ro.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('resize', onOrientation);
      document.removeEventListener('visibilitychange', onVisibility);
      gameRef.current = null;
    };
  }, [setPhase]);

  /* -------------------------------- HUD の更新 -------------------------------- */

  useEffect(() => {
    const id = setInterval(() => {
      const game = gameRef.current;
      if (!game || !game.player) return;
      setHud(game.getHud());
    }, 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!banner) return undefined;
    const id = setTimeout(() => setBanner(null), 1800);
    return () => clearTimeout(id);
  }, [banner]);

  /* --------------------------------- キーボード -------------------------------- */

  useEffect(() => {
    const game = () => gameRef.current;
    const keys = new Set();

    const apply = () => {
      const g = game();
      if (!g) return;
      const has = (...list) => list.some((k) => keys.has(k));
      g.input.forward = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
      g.input.strafe = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0);
      g.input.turn = (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0);
      g.input.sprint = has('ShiftLeft', 'ShiftRight');
      g.input.firing = keys.has('Space') && phaseRef.current === 'playing';
    };

    const onKeyDown = (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      if (e.code === 'Escape') {
        const g = game();
        if (g && phaseRef.current === 'playing') g.setPaused(true);
        return;
      }
      const g = game();
      if (g && phaseRef.current === 'playing') {
        if (e.code === 'KeyR') { g.reload(); return; }
        if (e.code === 'KeyQ') { g.cycleWeapon(-1); return; }
        if (e.code === 'KeyE') { g.cycleWeapon(1); return; }
        const digit = /^Digit([1-4])$/.exec(e.code);
        if (digit) { g.switchWeapon(Number(digit[1]) - 1); return; }
      }
      if (e.repeat) return;
      keys.add(e.code);
      apply();
    };
    const onKeyUp = (e) => {
      keys.delete(e.code);
      apply();
    };
    const onBlur = () => {
      keys.clear();
      apply();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  /* ------------------------- マウス（ポインターロック） ------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;

    const onMouseMove = (e) => {
      const g = gameRef.current;
      if (!g || document.pointerLockElement !== canvas) return;
      g.look(e.movementX * MOUSE_SENS_X, e.movementY * MOUSE_SENS_Y);
    };
    // ポインターロックが使えない環境（埋め込み iframe など）でも
    // 左ボタンで射撃できるようにする。押した瞬間にも1発撃つ。
    const onMouseDown = (e) => {
      const g = gameRef.current;
      if (!g || e.button !== 0 || phaseRef.current !== 'playing') return;
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
      g.input.firing = true;
      g.fire();
    };
    const onMouseUp = (e) => {
      const g = gameRef.current;
      if (g && (!e || e.button === 0)) g.input.firing = false;
    };
    const onLockChange = () => {
      const g = gameRef.current;
      if (!g) return;
      if (document.pointerLockElement !== canvas && phaseRef.current === 'playing') {
        g.setPaused(true);
      }
    };

    const onWheel = (e) => {
      const g = gameRef.current;
      if (g && phaseRef.current === 'playing') g.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('pointerlockchange', onLockChange);
    };
  }, []);

  /* ---------------------------------- タッチ ---------------------------------- */

  useEffect(() => {
    const wrap = wrapRef.current;
    const state = touchRef.current;

    const stickRadius = () => {
      const rect = wrap.getBoundingClientRect();
      return Math.max(48, Math.min(72, Math.min(rect.width, rect.height) * 0.13));
    };

    const onDown = (e) => {
      if (e.pointerType === 'mouse' || phaseRef.current !== 'playing') return;
      const g = gameRef.current;
      if (!g) return;
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      e.preventDefault();

      if (x < rect.width * 0.45 && state.move === null) {
        state.move = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
        setStick({ x, y: e.clientY - rect.top, dx: 0, dy: 0 });
      } else if (state.look === null) {
        state.look = {
          id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0,
          t: performance.now(), mouse: e.pointerType === 'mouse',
        };
        // マウスは preventDefault で mousedown が来なくなるため、ここで発砲する
        if (e.pointerType === 'mouse' && e.button === 0) {
          if (document.pointerLockElement !== canvasRef.current) {
            canvasRef.current.requestPointerLock?.();
          }
          g.input.firing = true;
          g.fire();
        }
      }
      if (wrap.setPointerCapture) {
        try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
      }
    };

    const onMove = (e) => {
      const g = gameRef.current;
      if (!g) return;
      if (state.move && state.move.id === e.pointerId) {
        e.preventDefault();
        const r = stickRadius();
        let dx = e.clientX - state.move.ox;
        let dy = e.clientY - state.move.oy;
        const len = Math.hypot(dx, dy);
        if (len > r) {
          dx = (dx / len) * r;
          dy = (dy / len) * r;
        }
        g.input.forward = -dy / r;
        g.input.strafe = dx / r;
        g.input.sprint = len / r > 0.85;
        // 60fps で state を更新すると重いので、ノブだけ直接動かす
        if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (state.look && state.look.id === e.pointerId) {
        e.preventDefault();
        const dx = e.clientX - state.look.x;
        const dy = e.clientY - state.look.y;
        state.look.x = e.clientX;
        state.look.y = e.clientY;
        state.look.moved += Math.abs(dx) + Math.abs(dy);
        g.look(dx * TOUCH_SENS_X, dy * TOUCH_SENS_Y);
      }
    };

    const onUp = (e) => {
      const g = gameRef.current;
      if (state.move && state.move.id === e.pointerId) {
        state.move = null;
        if (g) {
          g.input.forward = 0;
          g.input.strafe = 0;
          g.input.sprint = false;
        }
        setStick(null);
      } else if (state.look && state.look.id === e.pointerId) {
        const quick = performance.now() - state.look.t < 260 && state.look.moved < 14;
        const wasMouse = state.look.mouse;
        state.look = null;
        if (wasMouse) { if (g) g.input.firing = false; }
        // タップで単発射撃（マウスは押した時点で撃っている）
        else if (quick && g && phaseRef.current === 'playing') g.fire();
      }
    };

    wrap.addEventListener('pointerdown', onDown, { passive: false });
    wrap.addEventListener('pointermove', onMove, { passive: false });
    wrap.addEventListener('pointerup', onUp);
    wrap.addEventListener('pointercancel', onUp);
    return () => {
      wrap.removeEventListener('pointerdown', onDown);
      wrap.removeEventListener('pointermove', onMove);
      wrap.removeEventListener('pointerup', onUp);
      wrap.removeEventListener('pointercancel', onUp);
    };
  }, []);

  /* ---------------------------------- 操作系 ---------------------------------- */

  const startGame = useCallback((key) => {
    const game = gameRef.current;
    if (!game) return;
    setDifficulty(key);
    setResult(null);
    game.sfx.resume();
    game.resize();
    game.newGame(key);
    setPhase('playing');
    setShowHint(true);
    clearTimeout(startGame.hintTimer);
    startGame.hintTimer = setTimeout(() => setShowHint(false), 8000);

    if (isCoarsePointer()) {
      const el = wrapRef.current;
      if (el && el.requestFullscreen) {
        el.requestFullscreen().then(
          () => {
            const lock = window.screen && window.screen.orientation && window.screen.orientation.lock;
            if (lock) window.screen.orientation.lock('landscape').catch(() => {});
          },
          () => {},
        );
      }
    } else {
      canvasRef.current.requestPointerLock?.();
    }
  }, [setPhase]);

  const resume = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    game.setPaused(false);
    setPhase('playing');
    if (!isCoarsePointer()) canvasRef.current.requestPointerLock?.();
  }, [setPhase]);

  const quitToMenu = useCallback(() => {
    const game = gameRef.current;
    if (game) {
      game.state = 'menu';
      game.input.firing = false;
    }
    if (document.pointerLockElement) document.exitPointerLock?.();
    setPhase('menu');
  }, [setPhase]);

  const toggleMute = useCallback(() => {
    const game = gameRef.current;
    setMuted((prev) => {
      const next = !prev;
      if (game) game.sfx.setMuted(next);
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.().catch(() => {});
  }, []);

  const holdFire = useCallback((on) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const game = gameRef.current;
    if (game && phaseRef.current === 'playing') game.input.firing = on;
  }, []);

  const holdSprint = useCallback((on) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const game = gameRef.current;
    if (game) game.input.sprint = on;
  }, []);

  /* ---------------------------------- 画面 ---------------------------------- */

  const hpRatio = hud.maxHp ? hud.hp / hud.maxHp : 0;
  const playing = phase === 'playing';

  return (
    <div className="fps-root" ref={wrapRef}>
      <canvas ref={glCanvasRef} className="fps-canvas fps-gl" />
      <canvas ref={canvasRef} className="fps-canvas" />

      <div className="fps-layer">
        {playing && (
          <>
            <div className="fps-hud">
              <div className={`fps-hpbar${hpRatio < 0.35 ? ' low' : ''}`}>
                <i style={{ width: `${Math.max(0, hpRatio) * 100}%` }} />
              </div>
              <div className="fps-chips">
                <span className="fps-chip hp">HP {hud.hp}</span>
                <span className="fps-chip">WAVE {hud.wave}</span>
                <span className="fps-chip">SCORE {hud.score}</span>
                <span className="fps-chip">敵 {hud.enemies}</span>
              </div>
              <div className="fps-weapon">
                <span className="fps-weapon-name">
                  {hud.weapon}
                  <b className={`fps-mode${hud.weaponMode === 'SEMI' ? ' semi' : ''}`}>{hud.weaponMode}</b>
                </span>
                <span className="fps-weapon-perk">Lv.{hud.weaponLevel}　{hud.weaponPerk}</span>
                <div className="fps-xpbar">
                  <i style={{ width: `${(hud.weaponMax ? 1 : hud.weaponRatio || 0) * 100}%` }} />
                </div>
              </div>
            </div>

            <div className={`fps-ammo${hud.mag === 0 ? ' empty' : ''}`}>
              <b>{hud.mag}</b>
              <span>/ {hud.reserve}</span>
              <em>Lv.{hud.weaponLevel}</em>
            </div>

            {hud.reloading && (
              <div className="fps-reload">
                <i style={{ width: `${hud.reloadRatio * 100}%` }} />
                <span>RELOADING</span>
              </div>
            )}

            {showHint && (
              <div className="fps-hint">
                <b>1〜4</b> 武器切替　<b>R</b> リロード　<b>押しっぱなし</b>で連射（SEMI表示の武器は単発）
              </div>
            )}

            <div className="fps-slots">
              {hud.slots.map((sl, i) => (
                <button
                  key={sl.id}
                  type="button"
                  className={`fps-slot${i === hud.slot ? ' active' : ''}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    gameRef.current.switchWeapon(i);
                  }}
                >
                  <span className="num">{sl.slot}</span>{sl.short}
                  <span className="mode">{sl.mode}</span>
                  <span className="ammo">Lv.{sl.level}  {sl.mag}/{sl.reserve}</span>
                </button>
              ))}
            </div>

            <div className="fps-tools">
              <button type="button" className="fps-icon-btn" onClick={() => gameRef.current.setPaused(true)} aria-label="ポーズ">❚❚</button>
              <button type="button" className="fps-icon-btn" onClick={toggleMute} aria-label="音量">{muted ? '🔇' : '🔊'}</button>
              <button type="button" className="fps-icon-btn" onClick={toggleFullscreen} aria-label="全画面">⛶</button>
            </div>

            {touch && (
              <>
                <button
                  type="button"
                  className="fps-fire"
                  onPointerDown={holdFire(true)}
                  onPointerUp={holdFire(false)}
                  onPointerCancel={holdFire(false)}
                  onPointerLeave={holdFire(false)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  FIRE
                </button>
                <button
                  type="button"
                  className="fps-jump"
                  onPointerDown={holdSprint(true)}
                  onPointerUp={holdSprint(false)}
                  onPointerCancel={holdSprint(false)}
                  onPointerLeave={holdSprint(false)}
                >
                  DASH
                </button>
                <button
                  type="button"
                  className="fps-reload-btn"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    gameRef.current.reload();
                  }}
                >
                  RELOAD
                </button>
              </>
            )}

            {stick && (
              <div className="fps-stick" style={{ left: stick.x, top: stick.y }}>
                <i ref={knobRef} />
              </div>
            )}
          </>
        )}

        {banner && (
          <div className="fps-banner" key={banner.id}>
            {banner.text}
            {banner.sub && <small>{banner.sub}</small>}
          </div>
        )}
      </div>

      {phase === 'menu' && (
        <div className="fps-overlay">
          <div className="fps-panel">
            <h1 className="fps-title">BLASTER ZONE</h1>
            <p className="fps-sub">迷宮に湧き出る敵をひたすら撃ち倒すブラウザFPS</p>
            {Object.values(DIFFICULTIES).map((d) => (
              <button
                key={d.key}
                type="button"
                className={`fps-btn${d.key === 'normal' ? ' primary' : ''}`}
                onClick={() => startGame(d.key)}
              >
                {d.label}ではじめる
              </button>
            ))}
            {best > 0 && <p className="fps-note">ハイスコア: {best}</p>}
            {portrait && touch && <p className="fps-note">📱 横向き（ランドスケープ）だと遊びやすいです</p>}
            <table className="fps-arsenal">
              <tbody>
                <tr><th>武器</th><th>射撃</th><th>装弾</th><th>特徴</th></tr>
                <tr><td>1 パルスブラスター</td><td className="auto">連射</td><td>14</td><td>標準。扱いやすい</td></tr>
                <tr><td>2 スキャッターガン</td><td className="semi">単発</td><td>6</td><td>近距離で高威力の散弾</td></tr>
                <tr><td>3 パルスSMG</td><td className="auto">連射</td><td>34</td><td>高速連射・低威力</td></tr>
                <tr><td>4 レールランス</td><td className="semi">単発</td><td>4</td><td>貫通する高威力の一撃</td></tr>
              </tbody>
            </table>
            <div className="fps-help">
              <b>PC:</b> WASD / 矢印 = 移動、マウス = 視点、クリック or スペース = 射撃、Shift = ダッシュ、Esc = ポーズ<br />
              <b>武器:</b> 1〜4 キー / ホイール / Q・E で切替、R でリロード（弾切れは自動装填）<br />
              <b>スマホ:</b> 画面左側をドラッグ = 移動（大きく倒すとダッシュ）、右側をドラッグ = 視点、右側タップ or FIRE = 射撃、RELOAD と下部スロットで武器操作<br />
              <b>目標:</b> ウェーブごとに増える敵を全滅させる。弾薬箱・救急箱・強化コアを拾って生き延びよう。<br />
              <b>武器の成長:</b> 使うほど XP が貯まり Lv.4 まで成長。威力・装弾数・連射速度・リロード時間・
              貫通数が上がり、銃の形そのものが変化する。<b>連射</b>＝押しっぱなしで撃ち続ける。<b>単発</b>＝押すたびに1発。
              撃ち切ると自動でリロードする。
            </div>
            <Link to="/" className="fps-back">← アプリに戻る</Link>
          </div>
        </div>
      )}

      {phase === 'paused' && (
        <div className="fps-overlay">
          <div className="fps-panel">
            <h1 className="fps-title">PAUSED</h1>
            <p className="fps-sub">WAVE {hud.wave} / SCORE {hud.score}</p>
            <button type="button" className="fps-btn primary" onClick={resume}>ゲームを再開</button>
            <button type="button" className="fps-btn" onClick={() => startGame(difficulty)}>最初からやり直す</button>
            <button type="button" className="fps-btn ghost" onClick={quitToMenu}>タイトルへ戻る</button>
          </div>
        </div>
      )}

      {phase === 'over' && result && (
        <div className="fps-overlay">
          <div className="fps-panel">
            <h1 className="fps-title">GAME OVER</h1>
            <p className="fps-sub">
              {result.score >= best && result.score > 0 ? 'ハイスコア更新！' : `ハイスコア: ${best}`}
            </p>
            <div className="fps-stats">
              <div className="fps-stat"><b>{result.score}</b><span>SCORE</span></div>
              <div className="fps-stat"><b>{result.wave}</b><span>WAVE</span></div>
              <div className="fps-stat"><b>{result.kills}</b><span>KILLS</span></div>
            </div>
            <button type="button" className="fps-btn primary" onClick={() => startGame(difficulty)}>もう一度プレイ</button>
            <button type="button" className="fps-btn ghost" onClick={quitToMenu}>タイトルへ戻る</button>
            <Link to="/" className="fps-back">← アプリに戻る</Link>
          </div>
        </div>
      )}
    </div>
  );
}
