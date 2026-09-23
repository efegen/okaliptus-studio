import React from 'react';
import { createPortal } from 'react-dom';

// Tam ekran fotoğraf görüntüleyici — WhatsApp/Telegram/iOS Fotoğraflar ve
// PhotoSwipe'taki yerleşik kalıplar:
// - body'ye portal: sayfa başlığı, alt sekme çubuğu, "Not yaz" gibi yüzen
//   butonlar üstüne binmez (kart içindeki fixed katman bir üst stacking
//   context'e hapsoluyordu).
// - Siyah zemin: fotoğrafın sınırları net görünür.
// - Kapatma: sol üstte 44px "×", Escape, telefonun geri tuşu (history
//   girdisi), yakınlaştırılmamışken aşağı (ya da yukarı) sürükleyip bırakma.
// - Yakınlaştırma: iki parmakla sıkıştırma, çift dokunma (dokunulan noktaya
//   2.5× / geri 1×), yakınken tek parmakla kaydırma (kenarlara sınırlı),
//   masaüstünde tekerlek.
// - Tek dokunma üst çubuğu gizler/gösterir (yakınken de çubuk kalır).

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DISTANCE = 90;
const TAP_SLOP = 8;
const DOUBLE_TAP_MS = 280;
const CLOSE_MS = 180;

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function reducedMotion() {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; } catch { return false; }
}

export function PhotoViewer({ src, alt = '', title, subtitle, onClose }) {
  const stageRef = React.useRef(null);
  const imgRef = React.useRef(null);
  const closeBtnRef = React.useRef(null);
  const [view, setView] = React.useState({ s: 1, x: 0, y: 0 });
  const [dragY, setDragY] = React.useState(0);
  const [animating, setAnimating] = React.useState(false);
  const [chrome, setChrome] = React.useState(true);
  const [closing, setClosing] = React.useState(false);
  const viewRef = React.useRef(view);
  viewRef.current = view;
  const pointers = React.useRef(new Map());
  const gesture = React.useRef(null);
  const lastTap = React.useRef(null);
  const tapTimer = React.useRef(null);
  const closedRef = React.useRef(false);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  const finish = React.useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    setClosing(true);
    setTimeout(() => onCloseRef.current?.(), reducedMotion() ? 0 : CLOSE_MS);
  }, []);

  // Geri tuşu görüntüleyiciyi kapatsın diye açılışta bir history girdisi
  // eklenir; diğer yollarla kapatınca o girdi geri alınır.
  const close = React.useCallback(() => {
    if (window.history.state?.photoViewer) window.history.back();
    else finish();
  }, [finish]);

  React.useEffect(() => {
    window.history.pushState({ ...(window.history.state || {}), photoViewer: true }, '');
    const onPop = () => finish();
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(tapTimer.current);
      // Başka bir nedenle kaldırıldıysa (ör. not silindi) history girdisi kalmasın.
      if (!closedRef.current && window.history.state?.photoViewer) window.history.back();
    };
  }, [close, finish]);

  // Görüntü kenarları ekranı geçmeyecek şekilde kaydırmayı sınırla.
  function bounded(next) {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img || next.s <= 1) return { s: Math.max(1, next.s), x: 0, y: 0 };
    const maxX = Math.max(0, (img.offsetWidth * next.s - stage.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * next.s - stage.clientHeight) / 2);
    return { s: next.s, x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  }

  // Ekran koordinatını sahnenin merkezine göre ifade et.
  function local(pt) {
    const r = stageRef.current.getBoundingClientRect();
    return { x: pt.x - (r.left + r.width / 2), y: pt.y - (r.top + r.height / 2) };
  }

  function animateTo(next) {
    setAnimating(true);
    setView(bounded(next));
  }

  function startGesture() {
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = {
        type: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
        view: v,
      };
    } else if (pts.length === 1) {
      gesture.current = {
        type: v.s > 1 ? 'pan' : 'drag',
        start: pts[0],
        view: v,
        t0: performance.now(),
        moved: false,
      };
    } else {
      gesture.current = null;
    }
  }

  function onPointerDown(e) {
    if (e.target.closest('button')) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAnimating(false);
    startGesture();
  }

  function onPointerMove(e) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const s = clamp(g.view.s * (dist / g.dist), 0.8, MAX_SCALE);
      // Parmakların arasındaki nokta görüntüde aynı yerde kalsın.
      const imgX = (g.mid.x - g.view.x) / g.view.s;
      const imgY = (g.mid.y - g.view.y) / g.view.s;
      setView({ s, x: mid.x - s * imgX, y: mid.y - s * imgY });
      return;
    }
    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    if (Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP) g.moved = true;
    if (g.type === 'pan') {
      setView({ s: g.view.s, x: g.view.x + dx, y: g.view.y + dy });
    } else if (g.moved) {
      setDragY(dy);
    }
  }

  function handleTap(pt) {
    const now = performance.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(pt.x - prev.x, pt.y - prev.y) < 30) {
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      const v = viewRef.current;
      if (v.s > 1) {
        animateTo({ s: 1, x: 0, y: 0 });
      } else {
        const p = local(pt);
        animateTo({ s: DOUBLE_TAP_SCALE, x: p.x * (1 - DOUBLE_TAP_SCALE), y: p.y * (1 - DOUBLE_TAP_SCALE) });
      }
      return;
    }
    lastTap.current = { t: now, x: pt.x, y: pt.y };
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setChrome((c) => !c), DOUBLE_TAP_MS);
  }

  function onPointerUp(e) {
    if (!pointers.current.has(e.pointerId)) return;
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // Sıkıştırmadan bir parmak kalktı: kalan parmakla kaydırmaya devam.
      startGesture();
      return;
    }
    gesture.current = null;
    if (!g) return;
    if (g.type === 'pinch') {
      animateTo(viewRef.current.s < 1 ? { s: 1, x: 0, y: 0 } : viewRef.current);
      return;
    }
    if (!g.moved && performance.now() - g.t0 < 350) {
      handleTap({ x: e.clientX, y: e.clientY });
      return;
    }
    if (g.type === 'pan') {
      animateTo(viewRef.current);
    } else if (Math.abs(dragY) > DISMISS_DISTANCE) {
      close();
    } else {
      setAnimating(true);
      setDragY(0);
    }
  }

  function onPointerCancel(e) {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    setAnimating(true);
    setDragY(0);
    setView((v) => bounded(v));
  }

  function onWheel(e) {
    e.preventDefault();
    const v = viewRef.current;
    const s = clamp(v.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 1, MAX_SCALE);
    const p = local({ x: e.clientX, y: e.clientY });
    const imgX = (p.x - v.x) / v.s;
    const imgY = (p.y - v.y) / v.s;
    setAnimating(false);
    setView(bounded({ s, x: p.x - s * imgX, y: p.y - s * imgY }));
  }

  // React onWheel pasif — preventDefault için yerel dinleyici.
  React.useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const dismissProgress = Math.min(1, Math.abs(dragY) / 300);
  const backdropOpacity = closing ? 0 : 1 - dismissProgress * 0.7;
  const imgTransform = `translate3d(${view.x}px, ${view.y + dragY}px, 0) scale(${view.s * (1 - dismissProgress * 0.15)})`;
  const showChrome = chrome && !closing && dragY === 0;

  return createPortal(
    <div
      className={`pv-root${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title ? `${title} — fotoğraf` : 'Fotoğraf'}
    >
      <div className="pv-backdrop" style={{ opacity: backdropOpacity }} />
      <div
        ref={stageRef}
        className="pv-stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <img
          ref={imgRef}
          className="pv-img"
          src={src}
          alt={alt}
          draggable={false}
          style={{
            transform: imgTransform,
            transition: animating ? 'transform .25s cubic-bezier(.2,.8,.2,1)' : 'none',
          }}
          onTransitionEnd={() => setAnimating(false)}
        />
      </div>
      <div className={`pv-bar${showChrome ? '' : ' is-hidden'}`}>
        <button ref={closeBtnRef} type="button" className="pv-close" onClick={close} aria-label="Kapat">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {(title || subtitle) && (
          <div className="pv-caption">
            {title && <span className="pv-title">{title}</span>}
            {subtitle && <span className="pv-sub">{subtitle}</span>}
          </div>
        )}
      </div>
      {showChrome && view.s === 1 && (
        <p className="pv-hint" aria-hidden="true">Yakınlaştırmak için iki kez dokunun</p>
      )}
    </div>,
    document.body,
  );
}
