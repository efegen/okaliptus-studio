import React from 'react';
import { useWeekLessons } from '../shared/useWeekLessons';
import { MobileWeekCalendar } from '../MobileWeekCalendar';

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

function getWeekStart(date) {
  const dow = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - dow, 0, 0, 0, 0);
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function MobileWeekStrip({ selectedISO, onSelect }) {
  const today = React.useMemo(getIstanbulToday, []);
  const weekStart = React.useMemo(() => getWeekStart(today), [today]);
  const { sessions } = useWeekLessons(weekStart);

  const dotsByISO = React.useMemo(() => {
    if (!sessions) return null;
    const counts = {};
    for (const s of sessions) {
      if (s.lessonState === 'cancelled') continue;
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + s.day);
      const iso = toISODate(d);
      counts[iso] = (counts[iso] || 0) + 1;
    }
    return counts;
  }, [sessions, weekStart]);

  return (
    <section className="mobile-week-strip">
      <MobileWeekCalendar
        selectedISO={selectedISO}
        onSelect={onSelect}
        dotsByISO={dotsByISO}
      />
    </section>
  );
}
