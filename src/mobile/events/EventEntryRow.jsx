import React from 'react';
import { Icon } from '../../layout';

// Etkinlik günü kapı ekranı (MobileEventDay) ve Kahvaltı listesi
// (MobileEventDayBreakfast) aynı satır etkileşimini paylaşır: tikleme ayrı
// bir düğme değil, satırı (öğrenci ismini) sağa çekmektir. Kısa hareketler
// yoksayılır, eşik aşılınca onToggle tetiklenir ve satır geri yaylanır. Sağ
// ok tuşu klavye eşdeğeridir. Durum, satırın sağında düz metin olarak yazar.
const CHECK_SWIPE_MAX = 96;
const CHECK_SWIPE_COMMIT = 64;
const CHECK_SWIPE_AXIS_LOCK = 8;

function initialsOf(name) {
  return (name || '?').split(' ').filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

export function EventEntryRow({ entry, titleExtra, subtitle, onOpen, onToggle, tickBusy }) {
  const checked = Boolean(entry.checked_at);

  const gesture = React.useRef(null);
  const suppressClick = React.useRef(false);
  const [dragOffset, setDragOffset] = React.useState(null);
  const hintId = React.useId();

  function start(e) {
    if (tickBusy || e.isPrimary === false || e.button !== 0 || gesture.current) return;
    suppressClick.current = false;
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function move(e) {
    const current = gesture.current;
    if (!current || current.id !== e.pointerId) return;
    const dx = e.clientX - current.x;
    const dy = e.clientY - current.y;
    if (!current.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < CHECK_SWIPE_AXIS_LOCK) return;
      current.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      suppressClick.current = true;
    }
    if (current.axis !== 'x') return;
    setDragOffset(Math.max(0, Math.min(CHECK_SWIPE_MAX, dx)));
  }

  function finish(e, cancelled = false) {
    const current = gesture.current;
    if (!current || current.id !== e.pointerId) return;
    gesture.current = null;
    const offset = dragOffset;
    setDragOffset(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (cancelled || current.axis !== 'x') return;
    if ((offset ?? 0) >= CHECK_SWIPE_COMMIT) onToggle(entry);
  }

  function activate() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onOpen(entry);
  }

  function keyboard(e) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onToggle(entry);
    }
  }

  return (
    <li className={`evd-entry${checked ? ' is-checked' : ''}${dragOffset !== null ? ' is-dragging' : ''}`}>
      <div className="evd-swipe" style={{ '--swipe-offset': `${dragOffset ?? 0}px`, '--swipe-reveal': `${dragOffset ?? 0}px` }}>
        <div className="evd-swipe-check" aria-hidden="true">
          <Icon.Check width="16" height="16" />
          <span>{checked ? 'Kaldır' : 'Kontrol et'}</span>
        </div>
        <button
          type="button"
          className="evd-entry-main"
          disabled={tickBusy}
          aria-describedby={hintId}
          onClick={activate}
          onKeyDown={keyboard}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={(e) => finish(e, true)}
          onLostPointerCapture={(e) => finish(e, true)}
        >
          <span className="evx-avatar">{initialsOf(entry.full_name)}</span>
          <span className="evx-row-body">
            <span className="evd-row-title">
              <span className="evx-row-name">{entry.full_name}</span>
              {titleExtra}
            </span>
            <span className="evx-row-sub">{subtitle}</span>
            {entry.note && <span className="evd-entry-note">{entry.note}</span>}
          </span>
          <span className={`evd-status${checked ? ' is-on' : ''}`}>{checked ? 'Kontrol edildi' : 'Bekliyor'}</span>
        </button>
      </div>
      <span id={hintId} className="evx-swipe-hint">
        Kontrol durumunu değiştirmek için sağa kaydırın ya da odaklanıp sağ ok tuşuna basın.
      </span>
    </li>
  );
}
