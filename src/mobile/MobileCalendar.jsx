import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWeekLessons } from './shared/useWeekLessons';
import { queryKeys } from '../hooks/queryKeys';
import { MobileLessonSheet } from './MobileLessonSheet';
import { MobileCreateLessonSheet } from './MobileCreateLessonSheet';
import { MobileToast } from './MobileToast';
import { fmtTL } from '../data';

const HOURS = Array.from({ length: 16 }, (_, i) => i + 8); // 08..23
const DAYS_TR_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const HOUR_PX = 48;
const DAY_BODY_PX = HOURS.length * HOUR_PX; // 768

function getIstanbulToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find(p => p.type === 'year').value);
  const mo = Number(parts.find(p => p.type === 'month').value) - 1;
  const d = Number(parts.find(p => p.type === 'day').value);
  return new Date(y, mo, d, 0, 0, 0, 0);
}

function getCurrentMonday() {
  const today = getIstanbulToday();
  const daysSinceMonday = (today.getDay() + 6) % 7;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday, 0, 0, 0, 0);
}

function addWeeks(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n * 7, 0, 0, 0, 0);
}

function getWeekDayNumbers(weekStart) {
  return Array.from({ length: 7 }, (_, i) =>
    new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i).getDate()
  );
}

function getTodayColumnIndex(weekStart) {
  const today = getIstanbulToday();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    if (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    ) {
      return i;
    }
  }
  return -1;
}

function formatWeekRange(weekStart) {
  const sunday = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const s = weekStart.getDate();
  const e = sunday.getDate();
  if (weekStart.getMonth() === sunday.getMonth()) {
    return `${s} – ${e} ${sunday.toLocaleDateString('tr-TR', { month: 'short' })}`;
  }
  return `${s} ${weekStart.toLocaleDateString('tr-TR', { month: 'short' })} – ${e} ${sunday.toLocaleDateString('tr-TR', { month: 'short' })}`;
}

function ShoppingBagIcon({ size = 10 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.5 5.5h9l-0.7 8.2a1 1 0 0 1-1 0.9H5.2a1 1 0 0 1-1-0.9L3.5 5.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 5.5V4a2.5 2.5 0 1 1 5 0v1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WeekNavBar({ weekStart, onPrev, onNext, onToday }) {
  return (
    <div className="mobile-cal-weeknav">
      <button
        type="button"
        className="mobile-cal-weeknav-btn"
        onClick={onPrev}
        aria-label="Önceki hafta"
      >
        ‹
      </button>
      <span className="mobile-cal-weeknav-label">{formatWeekRange(weekStart)}</span>
      <button
        type="button"
        className="mobile-cal-weeknav-btn"
        onClick={onNext}
        aria-label="Sonraki hafta"
      >
        ›
      </button>
      <button
        type="button"
        className="mobile-cal-weeknav-today"
        onClick={onToday}
      >
        Bugün
      </button>
    </div>
  );
}

function LessonBlock({ session, onSelect }) {
  const startMinutes = (session.hour - 8) * 60 + session.minute;
  if (startMinutes < 0) return null;
  const top = (startMinutes / 60) * HOUR_PX;
  const height = (session.durationMinutes / 60) * HOUR_PX;
  const hasSale = Array.isArray(session.productSales) && session.productSales.length > 0;
  const remaining = session.price - session.paid;
  const showRemaining = session.lessonState === 'partial' && remaining > 0;

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(session);
    }
  }

  return (
    <div
      className={`mobile-cal-block mobile-cal-block-${session.lessonState}`}
      style={{ top, minHeight: HOUR_PX - 3, maxHeight: HOUR_PX, height: 'auto' }}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(session)}
      onKeyDown={handleKeyDown}
    >
      <div className="mobile-cal-block-top">
        <span className="mobile-cal-block-time">{session.time}</span>
        {hasSale && (
          <span className="mobile-cal-block-sale" aria-label="Ürün satışı">
            <ShoppingBagIcon size={10} />
          </span>
        )}
        {session.mode === 'online' && (
          <span className="mobile-cal-block-mode" aria-label="Online ders">🌐</span>
        )}
      </div>
      <div className="mobile-cal-block-name-row">
        <span className="mobile-cal-block-name">
          {session.studentNickname || session.studentName}
        </span>
        {showRemaining && (
          <span className="mobile-cal-block-remain">-{fmtTL(remaining)}</span>
        )}
      </div>
    </div>
  );
}

export function MobileCalendar() {
  const [weekStart, setWeekStart] = React.useState(() => getCurrentMonday());
  const [selectedSession, setSelectedSession] = React.useState(null);
  const [slotInfo, setSlotInfo] = React.useState(null);
  const [toast, setToast] = React.useState(null);
  const queryClient = useQueryClient();
  const { sessions, error, isLoading } = useWeekLessons(weekStart);

  const dayNumbers = getWeekDayNumbers(weekStart);
  const todayIndex = getTodayColumnIndex(weekStart);
  const scrollRef = React.useRef(null);
  const headsRef = React.useRef(null);
  const bodiesRef = React.useRef(null);
  const pageOffsetRef = React.useRef(0);

  // Horizontal pagination uses CSS transform on TWO synced tracks (heads +
  // bodies) inside a vertical-only scroll container. Why two tracks?
  //   1) `scrollLeft` on a 2-axis `overflow: auto` container with sticky
  //      descendants is buggy on iOS Safari (resets to 0 on cross-axis
  //      scroll), so we cannot use horizontal scrolling at all.
  //   2) `position: sticky` inside a transformed ancestor breaks in WebKit:
  //      the sticky element loses its scrollport and stops sticking. So the
  //      day-heads cannot live inside the transformed bodies grid.
  // Solution: bodies grid is transformed for horizontal pagination; the heads
  // row is sticky-top OUTSIDE any transformed ancestor, with its own inner
  // track that mirrors the bodies' transform.
  const getDayWidth = () => {
    const el = scrollRef.current;
    if (!el) return 100;
    const styles = getComputedStyle(el);
    const dayWStr = styles.getPropertyValue('--day-w').trim();
    return parseFloat(dayWStr) || (el.clientWidth - 56) / 3;
  };

  const getMaxOffset = () => {
    const bodies = bodiesRef.current;
    const wrap = bodies?.parentElement;
    const dayW = getDayWidth();
    if (!bodies || !wrap || dayW <= 0) return 0;
    const overflow = bodies.offsetWidth - wrap.clientWidth;
    return Math.max(0, Math.round(overflow / dayW));
  };

  const applyTransform = React.useCallback((offset, withTransition) => {
    const heads = headsRef.current;
    const bodies = bodiesRef.current;
    if (!heads && !bodies) return;
    const dayW = getDayWidth();
    const tf = `translateX(${-offset * dayW}px)`;
    const transition = withTransition ? '' : 'none';
    if (heads) {
      heads.style.transition = transition;
      heads.style.transform = tf;
    }
    if (bodies) {
      bodies.style.transition = transition;
      bodies.style.transform = tf;
    }
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let startX = 0, startY = 0, axis = null, baseOffset = 0, lastDx = 0;

    const setDragTransform = (px) => {
      const heads = headsRef.current;
      const bodies = bodiesRef.current;
      const tf = `translateX(${px}px)`;
      if (heads) {
        heads.style.transition = 'none';
        heads.style.transform = tf;
      }
      if (bodies) {
        bodies.style.transition = 'none';
        bodies.style.transform = tf;
      }
    };

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      axis = null;
      baseOffset = pageOffsetRef.current;
      lastDx = 0;
    };
    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!axis) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (axis === 'x') {
        lastDx = dx;
        const dayW = getDayWidth();
        const maxOffset = getMaxOffset();
        const px = Math.max(-maxOffset * dayW, Math.min(0, -baseOffset * dayW + dx));
        setDragTransform(px);
      }
    };
    const onTouchEnd = () => {
      if (axis === 'x') {
        const dayW = getDayWidth();
        const maxOffset = getMaxOffset();
        let delta = 0;
        if (Math.abs(lastDx) > dayW / 4) {
          delta = -Math.sign(lastDx) * Math.max(1, Math.round(Math.abs(lastDx) / dayW));
        }
        const newOffset = Math.max(0, Math.min(maxOffset, baseOffset + delta));
        pageOffsetRef.current = newOffset;
        applyTransform(newOffset, true);
      }
      axis = null;
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [applyTransform]);

  React.useEffect(() => {
    const onResize = () => applyTransform(pageOffsetRef.current, false);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [applyTransform]);

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const maxOffset = getMaxOffset();
    const initial = Math.max(0, Math.min(maxOffset, todayIndex >= 0 ? todayIndex - 1 : 0));
    pageOffsetRef.current = initial;
    applyTransform(initial, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart.getTime()]);

  function handlePrev() { setWeekStart(addWeeks(weekStart, -1)); }
  function handleNext() { setWeekStart(addWeeks(weekStart, 1)); }
  function handleToday() { setWeekStart(getCurrentMonday()); }
  function handleSlotClick(d, h) { setSlotInfo({ dayIndex: d, hour: h }); }
  function handleCreated() {
    setSlotInfo(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.weekLessons() });
  }

  const sessionsByDay = React.useMemo(() => {
    const map = Array.from({ length: 7 }, () => []);
    if (Array.isArray(sessions)) {
      for (const s of sessions) {
        if (s.day >= 0 && s.day <= 6) map[s.day].push(s);
      }
    }
    return map;
  }, [sessions]);

  return (
    <div className="mobile-calendar-page">
      <WeekNavBar
        weekStart={weekStart}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
      />

      <div className="mobile-cal-scroll" ref={scrollRef}>
        <div className="mobile-cal-frame">
          <aside className="mobile-cal-time-col">
            <div className="mobile-cal-time-col-head" />
            {HOURS.map(h => (
              <div key={h} className="mobile-cal-hour-label">
                {String(h).padStart(2, '0')}
              </div>
            ))}
          </aside>

          <div className="mobile-cal-day-area">
            <div className="mobile-cal-heads-row">
              <div className="mobile-cal-heads-track" ref={headsRef}>
                {Array.from({ length: 7 }, (_, d) => {
                  const isToday = d === todayIndex;
                  return (
                    <header
                      key={d}
                      className={'mobile-cal-day-head' + (isToday ? ' today' : '')}
                    >
                      <span className="mobile-cal-day-name">{DAYS_TR_SHORT[d]}</span>
                      <span className="mobile-cal-day-num">{dayNumbers[d]}</span>
                    </header>
                  );
                })}
              </div>
            </div>

            <div className="mobile-cal-bodies-wrap">
              <div className="mobile-cal-bodies" ref={bodiesRef}>
                {Array.from({ length: 7 }, (_, d) => {
                  const isToday = d === todayIndex;
                  return (
                    <div
                      key={d}
                      className={'mobile-cal-day-body' + (isToday ? ' today' : '')}
                    >
                      {HOURS.map(h => (
                        <div
                          key={h}
                          className="mobile-cal-hour-cell"
                          role="button"
                          aria-label={`${DAYS_TR_SHORT[d]} ${String(h).padStart(2, '0')}:00 boş slot`}
                          onClick={() => handleSlotClick(d, h)}
                        />
                      ))}
                      {sessionsByDay[d].map(s => (
                        <LessonBlock key={s.id} session={s} onSelect={setSelectedSession} />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mobile-cal-error" role="alert">
            {error}
          </div>
        )}
        {isLoading && (
          <div className="mobile-cal-skeleton" aria-hidden="true">
            Yükleniyor…
          </div>
        )}
      </div>

      {selectedSession && (
        <MobileLessonSheet
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onUpdated={(message) => {
            setSelectedSession(null);
            queryClient.invalidateQueries({ queryKey: queryKeys.weekLessons() });
            if (message) setToast(message);
          }}
        />
      )}

      {slotInfo && (
        <MobileCreateLessonSheet
          slotInfo={slotInfo}
          weekStart={weekStart}
          onClose={() => setSlotInfo(null)}
          onCreated={() => {
            handleCreated();
            setToast('Ders eklendi');
          }}
        />
      )}

      <MobileToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
