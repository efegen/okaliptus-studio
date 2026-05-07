import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWeekLessons } from './shared/useWeekLessons';
import { MobileLessonSheet } from './MobileLessonSheet';
import { MobileToast } from './MobileToast';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';

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

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekStart(date) {
  const dow = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - dow, 0, 0, 0, 0);
}

function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function relativeDayLabel(selectedISO, todayISO) {
  if (selectedISO === todayISO) return 'Bugün';
  const sel = parseISODate(selectedISO);
  const today = parseISODate(todayISO);
  const diff = Math.round((sel.getTime() - today.getTime()) / 86400000);
  if (diff === 1) return 'Yarın';
  if (diff === -1) return 'Dün';
  const weekday = sel.toLocaleDateString('tr-TR', { weekday: 'long' });
  return weekday.charAt(0).toLocaleUpperCase('tr-TR') + weekday.slice(1);
}

const STATE_LABEL = {
  planned: 'Planlandı',
  paid: 'Ödendi',
  partial: 'Kısmi ödendi',
  unpaid: 'Tahsil edilmedi',
};

export function MobileDayLessons({ selectedISO }) {
  const queryClient = useQueryClient();
  const today = React.useMemo(getIstanbulToday, []);
  const todayISO = toISODate(today);

  const selDate = React.useMemo(() => parseISODate(selectedISO), [selectedISO]);
  const weekStart = React.useMemo(() => getWeekStart(selDate), [selDate]);
  const { sessions, isLoading } = useWeekLessons(weekStart);

  const [selectedSession, setSelectedSession] = React.useState(null);
  const [toast, setToast] = React.useState(null);

  const dayLessons = React.useMemo(() => {
    if (!sessions) return [];
    const dayIndex = (selDate.getDay() + 6) % 7;
    return sessions
      .filter(s => s.day === dayIndex)
      .sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
  }, [sessions, selDate]);

  const heading = relativeDayLabel(selectedISO, todayISO);
  const isPast = selectedISO < todayISO;
  const count = dayLessons.length;

  return (
    <section className="mobile-day-lessons" aria-label={`${heading} dersleri`}>
      <header className="mobile-day-lessons-head">
        <h2 className="mobile-day-lessons-title">{heading}</h2>
        <span className="mobile-day-lessons-count" aria-live="polite">
          {isLoading ? '—' : count === 0 ? 'ders yok' : `${count} ders`}
        </span>
      </header>

      {!isLoading && count === 0 && (
        <div className="mobile-day-lessons-empty">
          <span className="mobile-day-lessons-empty-icon" aria-hidden>○</span>
          <span>{isPast ? 'Bu gün için ders yok.' : 'Planlanmış ders yok.'}</span>
        </div>
      )}

      {isLoading && (
        <div className="mobile-day-lessons-skeleton" aria-hidden>
          <div className="mobile-day-lessons-skel-row" />
          <div className="mobile-day-lessons-skel-row" />
        </div>
      )}

      {count > 0 && (
        <ul className="mobile-day-lessons-list">
          {dayLessons.map(s => {
            const remaining = s.price - s.paid;
            const showRemaining = s.lessonState === 'partial' && remaining > 0;
            const showOwed = s.lessonState === 'unpaid' && s.price > 0;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`mobile-day-row mobile-day-row-${s.lessonState}`}
                  onClick={() => setSelectedSession(s)}
                >
                  <span className="mobile-day-row-time">{s.time}</span>
                  <span className="mobile-day-row-rail" aria-hidden />
                  <span className="mobile-day-row-body">
                    <span className="mobile-day-row-name-line">
                      <span className="mobile-day-row-name">
                        {s.studentNickname || s.studentName}
                      </span>
                      {s.mode === 'online' && (
                        <span className="mobile-day-row-tag" aria-label="Online">
                          Online
                        </span>
                      )}
                    </span>
                    <span className="mobile-day-row-meta">
                      <span className="mobile-day-row-state">
                        {STATE_LABEL[s.lessonState]}
                      </span>
                      {showRemaining && (
                        <>
                          <span className="mobile-day-row-sep" aria-hidden>·</span>
                          <span className="mobile-day-row-amount">
                            {fmtTL(remaining)} kaldı
                          </span>
                        </>
                      )}
                      {showOwed && (
                        <>
                          <span className="mobile-day-row-sep" aria-hidden>·</span>
                          <span className="mobile-day-row-amount">{fmtTL(s.price)}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span className="mobile-day-row-chev" aria-hidden>›</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedSession && (
        <MobileLessonSheet
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onUpdated={(message) => {
            setSelectedSession(null);
            queryClient.invalidateQueries({ queryKey: queryKeys.weekLessons() });
            queryClient.invalidateQueries({ queryKey: queryKeys.weeklyKpi() });
            if (message) setToast(message);
          }}
        />
      )}

      <MobileToast message={toast} onDismiss={() => setToast(null)} />
    </section>
  );
}
