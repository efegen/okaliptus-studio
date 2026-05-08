import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWeekLessons } from '../shared/useWeekLessons';
import { MobileLessonSheet } from '../MobileLessonSheet';
import { queryKeys } from '../../hooks/queryKeys';

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

function istanbulISO(dateOrIsoString) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const d = dateOrIsoString instanceof Date ? dateOrIsoString : new Date(dateOrIsoString);
  return fmt.format(d);
}

function formatWhen(startsAtIso, today) {
  const lessonISO = istanbulISO(startsAtIso);
  const todayISO = istanbulISO(today);
  if (lessonISO === todayISO) return 'Bugün';
  const [ly, lm, ld] = lessonISO.split('-').map(Number);
  const [ty, tm, td] = todayISO.split('-').map(Number);
  const lDate = new Date(ly, lm - 1, ld);
  const tDate = new Date(ty, tm - 1, td);
  const diff = Math.round((lDate.getTime() - tDate.getTime()) / 86400000);
  if (diff === 1) return 'Yarın';
  if (diff > 1 && diff < 7) {
    const wd = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      weekday: 'long',
    }).format(new Date(startsAtIso));
    return wd.charAt(0).toLocaleUpperCase('tr-TR') + wd.slice(1);
  }
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
  }).format(new Date(startsAtIso));
}

export function MobileHeroLessonCard() {
  const queryClient = useQueryClient();
  const today = React.useMemo(getIstanbulToday, []);
  const todayDayIndex = (today.getDay() + 6) % 7;

  const thisMonday = React.useMemo(() => getWeekStart(today), [today]);
  const nextMonday = React.useMemo(() => {
    const d = new Date(thisMonday);
    d.setDate(thisMonday.getDate() + 7);
    return d;
  }, [thisMonday]);

  const thisWeek = useWeekLessons(thisMonday);

  const todayLessons = React.useMemo(() => {
    if (!thisWeek.sessions) return null;
    return thisWeek.sessions
      .filter(s => s.day === todayDayIndex)
      .sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
  }, [thisWeek.sessions, todayDayIndex]);

  const nextThisWeek = React.useMemo(() => {
    if (!thisWeek.sessions) return null;
    const nowMs = Date.now();
    return thisWeek.sessions
      .filter(s => s.lessonState === 'planned' && new Date(s.startsAt).getTime() > nowMs)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] || null;
  }, [thisWeek.sessions]);

  const needsNextWeek = !thisWeek.isLoading
    && (todayLessons !== null && todayLessons.length === 0)
    && !nextThisWeek;

  const nextWeek = useWeekLessons(nextMonday, { enabled: needsNextWeek });

  const nextWeekFirst = React.useMemo(() => {
    if (!nextWeek.sessions) return null;
    return nextWeek.sessions
      .filter(s => s.lessonState === 'planned')
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] || null;
  }, [nextWeek.sessions]);

  const upcomingLesson = nextThisWeek || nextWeekFirst;

  const [selectedSession, setSelectedSession] = React.useState(null);

  function handleUpdated() {
    setSelectedSession(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.weekLessons() });
    queryClient.invalidateQueries({ queryKey: queryKeys.weeklyKpi() });
  }

  if (thisWeek.isLoading) {
    return (
      <section className="mobile-hero-lesson" aria-label="Sıradaki ders">
        <div className="mobile-hero-lesson-skeleton" aria-hidden />
      </section>
    );
  }

  // Bugün ders varsa hero render etme — Day Lessons listesi zaten gösteriyor.
  if (todayLessons && todayLessons.length > 0) {
    return null;
  }

  if (upcomingLesson) {
    const when = formatWhen(upcomingLesson.startsAt, today);
    const isOnline = upcomingLesson.mode === 'online';
    return (
      <section className="mobile-hero-lesson" aria-label="Sıradaki ders">
        <button
          type="button"
          className="mobile-hero-lesson-card"
          onClick={() => setSelectedSession(upcomingLesson)}
        >
          <div className="mobile-hero-lesson-eyebrow">Sıradaki ders</div>
          <div className="mobile-hero-lesson-next">
            <span className="mobile-hero-lesson-when">{when}</span>
            <span className="mobile-hero-lesson-time">{upcomingLesson.time}</span>
          </div>
          <p className="mobile-hero-lesson-name">
            {upcomingLesson.studentNickname || upcomingLesson.studentName}
          </p>
          {isOnline && <p className="mobile-hero-lesson-meta">Online</p>}
        </button>
        {selectedSession && (
          <MobileLessonSheet
            session={selectedSession}
            onClose={() => setSelectedSession(null)}
            onUpdated={handleUpdated}
          />
        )}
      </section>
    );
  }

  return null;
}
