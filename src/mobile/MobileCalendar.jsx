import React from 'react';
import { useWeekLessons } from './shared/useWeekLessons';
import { MobileLessonSheet } from './MobileLessonSheet';
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
  const { sessions, error, isLoading } = useWeekLessons(weekStart);

  const dayNumbers = getWeekDayNumbers(weekStart);
  const todayIndex = getTodayColumnIndex(weekStart);
  const vScrollRef = React.useRef(null);
  const hScrollRef = React.useRef(null);

  React.useLayoutEffect(() => {
    if (vScrollRef.current) vScrollRef.current.scrollTop = 0;
    const hEl = hScrollRef.current;
    if (!hEl) return;
    if (todayIndex >= 0) {
      const styles = getComputedStyle(hEl);
      const dayWStr = styles.getPropertyValue('--day-w').trim();
      const dayW = parseFloat(dayWStr) || (hEl.clientWidth - 56) / 3;
      hEl.scrollLeft = Math.max(0, (todayIndex - 1)) * dayW;
    } else {
      hEl.scrollLeft = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart.getTime()]);

  function handlePrev() { setWeekStart(addWeeks(weekStart, -1)); }
  function handleNext() { setWeekStart(addWeeks(weekStart, 1)); }
  function handleToday() { setWeekStart(getCurrentMonday()); }

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

      <div className="mobile-cal-scroll" ref={vScrollRef}>
        <div className="mobile-cal-hscroll" ref={hScrollRef}>
        <div className="mobile-cal-frame">
          <aside className="mobile-cal-time-col">
            <div className="mobile-cal-time-col-head" />
            {HOURS.map(h => (
              <div key={h} className="mobile-cal-hour-label">
                {String(h).padStart(2, '0')}
              </div>
            ))}
          </aside>

          <div className="mobile-cal-grid">
            {Array.from({ length: 7 }, (_, d) => {
              const isToday = d === todayIndex;
              return (
                <section
                  key={d}
                  className={'mobile-cal-day-col' + (isToday ? ' today' : '')}
                >
                  <header className={'mobile-cal-day-head' + (isToday ? ' today' : '')}>
                    <span className="mobile-cal-day-name">{DAYS_TR_SHORT[d]}</span>
                    <span className="mobile-cal-day-num">{dayNumbers[d]}</span>
                  </header>
                  <div className="mobile-cal-day-body">
                    {HOURS.map(h => (
                      <div key={h} className="mobile-cal-hour-cell" />
                    ))}
                    {sessionsByDay[d].map(s => (
                      <LessonBlock key={s.id} session={s} onSelect={setSelectedSession} />
                    ))}
                  </div>
                </section>
              );
            })}
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

      <MobileLessonSheet
        session={selectedSession}
        onClose={() => setSelectedSession(null)}
      />
    </div>
  );
}
