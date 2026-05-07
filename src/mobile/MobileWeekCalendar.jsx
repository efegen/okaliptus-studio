import React, { useMemo, useState } from 'react';

const WEEKDAY_LABELS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

function getIstanbulToday() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const y = Number(parts.find(p => p.type === 'year').value);
  const mo = Number(parts.find(p => p.type === 'month').value) - 1;
  const d = Number(parts.find(p => p.type === 'day').value);
  return new Date(y, mo, d, 0, 0, 0, 0);
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekStart(date) {
  // Monday-based week. JS getDay(): 0=Sun .. 6=Sat. Convert to Mon=0..Sun=6.
  const dow = (date.getDay() + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - dow);
  return monday;
}

export function MobileWeekCalendar({ selectedISO: controlledISO, onSelect }) {
  const today = useMemo(getIstanbulToday, []);
  const todayISO = toISODate(today);

  const days = useMemo(() => {
    const start = getWeekStart(today);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return {
        iso: toISODate(d),
        dayNum: d.getDate(),
        label: WEEKDAY_LABELS[i],
      };
    });
  }, [today]);

  const [internalISO, setInternalISO] = useState(todayISO);
  const selectedISO = controlledISO ?? internalISO;
  const handleSelect = onSelect ?? setInternalISO;

  return (
    <section className="mobile-week-calendar" aria-label="Haftalık takvim">
      {days.map((day) => {
        const isSelected = day.iso === selectedISO;
        const isToday = day.iso === todayISO;
        return (
          <button
            key={day.iso}
            type="button"
            className={`mobile-week-day${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}`}
            onClick={() => handleSelect(day.iso)}
            aria-pressed={isSelected}
          >
            <span className="mobile-week-day-label">{day.label}</span>
            <span className="mobile-week-day-num">{day.dayNum}</span>
          </button>
        );
      })}
    </section>
  );
}
