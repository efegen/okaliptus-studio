import React from 'react';
import { Icon } from '../../layout';

const ACTION_WIDTH = 88;
const DIRECTION_THRESHOLD = 8;

// Sola kaydırma kaldırmayı, sağa kaydırma arama kaydını açar. Kısa
// hareket aksiyon düğmesini gösterir; uzun hareket formu doğrudan başlatır.
// pan-y, dikey liste kaydırmasını tarayıcıya bırakır.
export function SwipeToRemove({ children, label, openSide, onOpenSideChange, onOpen, onRemove, onContact, busy }) {
  const rootRef = React.useRef(null);
  const gesture = React.useRef(null);
  const suppressClick = React.useRef(false);
  const [dragOffset, setDragOffset] = React.useState(null);
  const hintId = React.useId();

  React.useEffect(() => {
    if (!openSide) return;
    function dismissOutside(e) {
      if (!rootRef.current?.contains(e.target)) onOpenSideChange(null);
    }
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [openSide, onOpenSideChange]);

  function start(e) {
    if (busy || e.isPrimary === false || e.button !== 0 || gesture.current) return;
    suppressClick.current = false;
    const startOffset = openSide === 'remove' ? -ACTION_WIDTH : openSide === 'contact' ? ACTION_WIDTH : 0;
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
    current.offset = Math.max(-current.width, Math.min(current.width, current.startOffset + dx));
    setDragOffset(current.offset);
  }

  function finish(e, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== e.pointerId) return;
    gesture.current = null;
    setDragOffset(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (cancelled || current.axis !== 'x') return;
    if (Math.abs(current.offset) >= Math.max(120, current.width * 0.65)) {
      onOpenSideChange(null);
      if (current.offset < 0) onRemove();
      else onContact();
    } else if (current.offset <= -ACTION_WIDTH / 2) {
      onOpenSideChange('remove');
    } else if (current.offset >= ACTION_WIDTH / 2) {
      onOpenSideChange('contact');
    } else {
      onOpenSideChange(null);
    }
  }

  function activate() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (openSide) onOpenSideChange(null);
    else onOpen();
  }

  function keyboard(e) {
    suppressClick.current = false;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onOpenSideChange('remove'); }
    if (e.key === 'ArrowRight') { e.preventDefault(); onOpenSideChange('contact'); }
    if (e.key === 'Escape') { e.preventDefault(); onOpenSideChange(null); }
    if (e.key === 'Delete') { e.preventDefault(); onOpenSideChange(null); onRemove(); }
  }

  const offset = dragOffset ?? (openSide === 'remove' ? -ACTION_WIDTH : openSide === 'contact' ? ACTION_WIDTH : 0);
  return (
    <div className={`evx-swipe${dragOffset !== null ? ' is-dragging' : ''}`} ref={rootRef}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onOpenSideChange(null); }}
      style={{
        '--swipe-offset': `${offset}px`,
        '--swipe-remove-reveal': `${Math.max(ACTION_WIDTH, -offset)}px`,
        '--swipe-contact-reveal': `${Math.max(ACTION_WIDTH, offset)}px`,
      }}>
      <button type="button" className="evx-swipe-contact" disabled={busy || openSide !== 'contact'}
        tabIndex={openSide === 'contact' ? 0 : -1} aria-hidden={openSide !== 'contact'} aria-label={`${label} arandı olarak işaretle`}
        onClick={() => { onOpenSideChange(null); onContact(); }}>
        <Icon.Phone width="19" height="19" aria-hidden="true" />
        <span>Arandı</span>
      </button>
      <button type="button" className="evx-row evx-swipe-content" disabled={busy}
        aria-label={`${label} detayını aç`} aria-describedby={hintId} aria-busy={busy}
        onClick={activate} onKeyDown={keyboard}
        onPointerDown={start} onPointerMove={move}
        onPointerUp={finish} onPointerCancel={(e) => finish(e, true)}
        onLostPointerCapture={(e) => finish(e, true)}>
        {children}
      </button>
      <button type="button" className="evx-swipe-remove" disabled={busy || openSide !== 'remove'}
        tabIndex={openSide === 'remove' ? 0 : -1} aria-hidden={openSide !== 'remove'} aria-label={`${label} etkinlikten kaldır`}
        onClick={() => { onOpenSideChange(null); onRemove(); }}>
        <Icon.Trash width="19" height="19" aria-hidden="true" />
        <span>Kaldır</span>
      </button>
      <span id={hintId} className="evx-swipe-hint">Kaldırmak için sola, arandı olarak işaretlemek için sağa kaydırın.</span>
    </div>
  );
}
