/**
 * ASTRA BOND のページ。
 *
 * タイトル → 読み込み → ルミナタウン、という流れをここで受け持つ。
 * 実際のゲームは src/astra/game.js。React は画面の外枠と HUD だけを描く。
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import './AstraBond.css';
import { AstraBondGame, detectQuality } from '../astra/game.js';

const QUALITY_LABELS = { low: '軽量', medium: '標準', high: '高品質' };

export default function AstraBond() {
  const canvasRef = useRef(null);
  const gameRef = useRef(null);
  const [phase, setPhase] = useState('title');          // title | loading | playing
  const [progress, setProgress] = useState({ value: 0, label: '' });
  const [hud, setHud] = useState({ district: '', clock: '', timeLabel: '', prompt: null, dialogue: null });
  const [menuOpen, setMenuOpen] = useState(false);
  const [quality, setQuality] = useState(detectQuality());
  const [error, setError] = useState(null);
  const [isTouch, setIsTouch] = useState(false);
  const [stick, setStick] = useState(null);

  useEffect(() => {
    setIsTouch(('ontouchstart' in window) || navigator.maxTouchPoints > 0);
  }, []);

  // 画面サイズに追従
  useEffect(() => {
    const onResize = () => {
      const c = canvasRef.current;
      if (!c) return;
      c.style.width = '100%';
      c.style.height = '100%';
    };
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const start = useCallback(async () => {
    if (gameRef.current) return;
    setPhase('loading');
    try {
      const game = new AstraBondGame(canvasRef.current, {
        quality,
        onProgress: (value, label) => setProgress({ value, label }),
        onState: (s) => setHud(s),
      });
      gameRef.current = game;
      await game.load();
      game.start();
      setPhase('playing');
    } catch (e) {
      console.error(e);
      setError(e.message || String(e));
      setPhase('title');
    }
  }, [quality]);

  useEffect(() => () => { gameRef.current?.stop(); gameRef.current = null; }, []);

  // メニュー開閉で一時停止
  useEffect(() => {
    gameRef.current?.setPaused(menuOpen);
  }, [menuOpen]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Escape' && phase === 'playing') setMenuOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // 仮想スティックの見た目（入力自体は Input が拾う）
  useEffect(() => {
    if (phase !== 'playing' || !isTouch) return undefined;
    let raf;
    const tick = () => {
      const t = gameRef.current?.input?.touch;
      setStick(t && t.active ? { x: t.originX, y: t.originY, kx: t.stickX, ky: t.stickY } : null);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, isTouch]);

  const changeQuality = (q) => {
    setQuality(q);
    gameRef.current?.setQuality(q);
  };

  const dialogue = hud.dialogue;

  return (
    <div className="ab-root">
      <canvas ref={canvasRef} className="ab-canvas" />

      {phase === 'playing' && (
        <div className="ab-hud">
          <div className="ab-district" key={hud.district}>
            <div className="ab-district-name">{hud.district}</div>
            <div className="ab-district-rule" />
          </div>
          <div className="ab-clock">
            <div className="ab-clock-time">{hud.clock}</div>
            <div className="ab-clock-label">{hud.timeLabel}</div>
          </div>
          <div className="ab-menu-btn" onClick={() => setMenuOpen(true)} role="button" aria-label="メニュー">
            <span /><span /><span />
          </div>
          {!dialogue && hud.prompt && (
            <div className="ab-prompt">
              <span className="ab-key">{isTouch ? 'TAP' : 'E'}</span>
              <span>{hud.prompt}</span>
            </div>
          )}
          {dialogue && (
            <div className="ab-dialogue">
              <div className="ab-dialogue-name">{dialogue.speaker}</div>
              <div className="ab-dialogue-body">
                {dialogue.line}
                <div className="ab-dialogue-next">{isTouch ? 'タップで次へ ▼' : 'E / Space で次へ ▼'}</div>
              </div>
            </div>
          )}
          <div className="ab-fps">{hud.fps} FPS · {QUALITY_LABELS[hud.quality] || ''}</div>
        </div>
      )}

      {phase === 'playing' && isTouch && (
        <div className="ab-touch">
          {stick && (
            <div className="ab-stick" style={{ left: stick.x, top: stick.y }}>
              <div className="ab-stick-knob" style={{
                transform: `translate(calc(-50% + ${stick.kx * 30}px), calc(-50% + ${stick.ky * 30}px))`,
              }} />
            </div>
          )}
          <div className="ab-action">調べる</div>
        </div>
      )}

      {menuOpen && (
        <div className="ab-panel" onClick={(e) => { if (e.target === e.currentTarget) setMenuOpen(false); }}>
          <div className="ab-panel-inner">
            <div className="ab-panel-title">システム</div>
            <div className="ab-row">
              <span className="ab-row-label">画質</span>
              <div className="ab-seg">
                {['low', 'medium', 'high'].map((q) => (
                  <button key={q} className={quality === q ? 'on' : ''} onClick={() => changeQuality(q)}>
                    {QUALITY_LABELS[q]}
                  </button>
                ))}
              </div>
            </div>
            <div className="ab-row">
              <span className="ab-row-label">時刻</span>
              <div className="ab-slider">
                <input
                  type="range" min="0" max="24" step="0.25"
                  defaultValue={9.5}
                  onChange={(e) => {
                    const g = gameRef.current;
                    if (g) { g.day.setHour(parseFloat(e.target.value)); g.day.paused = true; }
                  }}
                />
              </div>
            </div>
            <div className="ab-row">
              <span className="ab-row-label">時間の流れ</span>
              <div className="ab-seg">
                <button className={gameRef.current?.day?.paused ? '' : 'on'}
                  onClick={() => { if (gameRef.current) gameRef.current.day.paused = false; setMenuOpen(true); }}>
                  進める
                </button>
                <button className={gameRef.current?.day?.paused ? 'on' : ''}
                  onClick={() => { if (gameRef.current) gameRef.current.day.paused = true; setMenuOpen(true); }}>
                  止める
                </button>
              </div>
            </div>
            <div className="ab-stats">
              描画三角形 {(hud.visibleTriangles || 0).toLocaleString()} / 町全体 {(hud.stats?.triangles || 0).toLocaleString()}<br />
              ドローコール {hud.drawCalls || 0} · 光源 {hud.stats?.lights || 0} · 木 {hud.stats?.trees || 0} · 草 {(hud.stats?.grass || 0).toLocaleString()}<br />
              操作: WASD 移動 / Shift 走る / マウス 視点 / ホイール 寄り引き / E 調べる / T 昼夜 / Esc メニュー
            </div>
            <button className="ab-close" onClick={() => setMenuOpen(false)}>とじる</button>
          </div>
        </div>
      )}

      <div className={`ab-title ${phase === 'playing' ? 'ab-hide' : ''}`}>
        <div className="ab-title-stars" />
        <div className="ab-title-glow" />
        <div className="ab-logo">
          <div className="ab-logo-main">ASTRA BOND</div>
          <div className="ab-logo-rule" />
          <div className="ab-logo-sub">ルミナタウン</div>
        </div>
        {phase === 'title' && (
          <button className="ab-start" onClick={start} disabled={phase !== 'title'}>
            START
          </button>
        )}
        {phase === 'loading' && (
          <div className="ab-loadbar">
            <div className="ab-loadbar-track">
              <div className="ab-loadbar-fill" style={{ width: `${Math.round(progress.value * 100)}%` }} />
            </div>
            <div className="ab-loadbar-label">{progress.label}</div>
          </div>
        )}
        {error && <div className="ab-loadbar-label" style={{ color: '#ff9c9c' }}>読み込みに失敗しました: {error}</div>}
        <div className="ab-title-hint">
          WASD で移動 · マウスで視点 · E で調べる · Esc でメニュー<br />
          スマートフォンは画面左で移動、右で視点
        </div>
      </div>
    </div>
  );
}
