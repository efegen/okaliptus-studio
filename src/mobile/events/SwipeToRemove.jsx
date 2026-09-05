import React from 'react';
import { Icon } from '../../layout';

const ACTION_WIDTH = 88;
const DIRECTION_THRESHOLD = 8;

// Kısa kaydırma aksiyonu açar; uzun kaydırma kaldırma onayını başlatır.
// pan-y, dikey liste kaydırmasını tarayıcıya bırakır.
export function SwipeToRemove({ children, label, open, onOpenChange, onOpen, onRemove, busy }) {
  const rootRef = React.useRef(null);
  const gesture = React.useRef(null);
  const suppressClick = React.useRef(false);
  const [dragOffset, setDragOffset] = React.useState(null);
  const hintId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    function dismissOutside(e) {
      if (!rootRef.current?.contains(e.target)) onOpenChange(false);
    }
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [open, onOpenChange]);

  function start(e) {
    if (busy || e.isPrimary === false || e.button !== 0 || gesture.current) return;
    suppressClick.current = false;
    const startOffset = open ? -ACTION_WIDTH : 0;
    gesture.current = {
      id: e.pointerId, x: e.clientX, y: e.clientY, axis: null,
      startOffset, offset: startOffset, width: e.currentTarget.getBoundingClientRect().width,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function move(e) {
    const current = gesture.current;
    if (!current || current.id !== e.pointerId) return;
    const dx = e.clientX - current.x;
    const dy = e.clientY - current.y;
    if (!current.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < DIRECTION_THRESHOLD) return;
      current.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      suppressClick.current = true;
    }
    if (current.axis !== 'x') return;
    current.offset = Math.max(-current.width, Math.min(0, current.startOffset + dx));
    setDragOffset(current.offset);
  }

  function finish(e, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== e.pointerId) return;
    gesture.current = null;
    setDragOffset(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (cancelled || current.axis !== 'x') return;
    if (-current.offset >= Math.max(120, current.width * 0.65)) {
      onOpenChange(false);
      onRemove();
    } else {
      onOpenChange(-current.offset >= ACTION_WIDTH / 2);
    }
  }

  function activate() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (open) onOpenChange(false);
    else onOpen();
  }

  function keyboard(e) {
    suppressClick.current = false;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onOpenChange(true); }
    if (e.key === 'ArrowRight' || e.key === 'Escape') { e.preventDefault(); onOpenChange(false); }
    if (e.key === 'Delete') { e.preventDefault(); onOpenChange(false); onRemove(); }
  }

  const offset = dragOffset ?? (open ? -ACTION_WIDTH : 0);
  return (
    <div className={`evx-swipe${dragOffset !== null ? ' is-dragging' : ''}`} ref={rootRef}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onOpenChange(false); }}
      style={{ '--swipe-offset': `${offset}px`, '--swipe-reveal': `${Math.max(ACTION_WIDTH, -offset)}px` }}>
      <button type="button" className="evx-row evx-swipe-content" disabled={busy}
        aria-label={`${label} detayını aç`} aria-describedby={hintId} aria-busy={busy}
        onClick={activate} onKeyDown={keyboard}
        onPointerDown={start} onPointerMove={move}
        onPointerUp={finish} onPointerCancel={(e) => finish(e, true)}
        onLostPointerCapture={(e) => finish(e, true)}>
        {children}
      </button>
      <button type="button" className="evx-swipe-remove" disabled={busy || !open}
        tabIndex={open ? 0 : -1} aria-hidden={!open} aria-label={`${label} etkinlikten kaldır`}
        onClick={() => { onOpenChange(false); onRemove(); }}>
        <Icon.Trash width="19" height="19" aria-hidden="true" />
        <span>Kaldır</span>
      </button>
      <span id={hintId} className="evx-swipe-hint">Etkinlikten kaldırmak için sola kaydırın veya Delete tuşuna basın.</span>
    </div>
  );
}
