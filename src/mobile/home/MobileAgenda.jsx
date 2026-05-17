import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWeekLessons } from '../shared/useWeekLessons';
import { MobileLessonSheet } from '../MobileLessonSheet';
import { MobileToast } from '../MobileToast';
import { queryKeys } from '../../hooks/queryKeys';
import { fmtTL } from '../../data';

const STATE_LABEL = {
  planned: 'Planlandı',
  paid: 'Ödendi',
  partial: 'Kısmi ödendi',
  unpaid: 'Tahsil edilmedi',
};

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

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 0, 0, 0, 0);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatPeekWhen(startsAtIso, today) {
  const lesson = new Date(startsAtIso);
  const lessonDay = new Date(lesson.getFullYear(), lesson.getMonth(), lesson.getDate());
  const diff = Math.round((lessonDay.getTime() - today.getTime()) / 86400000);
  if (diff < 7) {
    const wd = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      weekday: 'long',
    }).format(lesson);
    return wd.charAt(0).toLocaleUpperCase('tr-TR') + wd.slice(1);
  }
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
  }).format(lesson);
}

function LessonRow({ session, onOpen }) {
  const remaining = session.price - session.paid;
  const showRemaining = session.lessonState === 'partial' && remaining > 0;
  const showOwed = session.lessonState === 'unpaid' && session.price > 0;
  return (
    <li>
      <button
        type="button"
        className={`mobile-day-row mobile-day-row-${session.lessonState}`}
        onClick={() => onOpen(session)}
      >
        <span className="mobile-day-row-time">{session.time}</span>
        <span className="mobile-day-row-rail" aria-hidden />
        <span className="mobile-day-row-body">
          <span className="mobile-day-row-name-line">
            <span className="mobile-day-row-name">
              {session.studentNickname || session.studentName}
            </span>
            {session.mode === 'online' && (
              <span className="mobile-day-row-tag" aria-label="Online">Online</span>
            )}
          </span>
          <span className="mobile-day-row-meta">
            <span className="mobile-day-row-state">
              {STATE_LABEL[session.lessonState]}
            </span>
            {showRemaining && (
              <>
                <span className="mobile-day-row-sep" aria-hidden>·</span>
                <span className="mobile-day-row-amount">{fmtTL(remaining)} kaldı</span>
              </>
            )}
            {showOwed && (
              <>
                <span className="mobile-day-row-sep" aria-hidden>·</span>
                <span className="mobile-day-row-amount">{fmtTL(session.price)}</span>
              </>
            )}
          </span>
        </span>
        <span className="mobile-day-row-chev" aria-hidden>›</span>
      </button>
    </li>
  );
}

function AgendaGroup({ title, count, sessions, onOpen, emptyText }) {
  return (
    <section className="mobile-agenda-group" aria-label={title}>
      <header className="mobile-agenda-group-head">
        <h2 className="mobile-agenda-group-title">{title}</h2>
        <span className="mobile-agenda-group-count">
          {count === 0 ? 'ders yok' : `${count} ders`}
        </span>
      </header>
      {sessions.length === 0 ? (
        <div className="mobile-agenda-group-empty">{emptyText}</div>
      ) : (
        <ul className="mobile-agenda-list">
          {sessions.map(s => <LessonRow key={s.id} session={s} onOpen={onOpen} />)}
        </ul>
      )}
    </section>
  );
}

export function MobileAgenda() {
  const queryClient = useQueryClient();
  const today = React.useMemo(getIstanbulToday, []);
  const tomorrow = React.useMemo(() => addDays(today, 1), [today]);

  const thisMonday = React.useMemo(() => getWeekStart(today), [today]);
  const nextMonday = React.useMemo(() => addDays(thisMonday, 7), [thisMonday]);

  const tomorrowInNextWeek = !sameDay(getWeekStart(tomorrow), thisMonday);

  const thisWeek = useWeekLessons(thisMonday);
  const nextWeek = useWeekLessons(nextMonday, { enabled: tomorrowInNextWeek });

  const todayIndex = (today.getDay() + 6) % 7;
  const tomorrowIndex = (tomorrow.getDay() + 6) % 7;

  const todaySessions = React.useMemo(() => {
    if (!thisWeek.sessions) return [];
    return thisWeek.sessions
      .filter(s => s.day === todayIndex)
      .sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
  }, [thisWeek.sessions, todayIndex]);

  const tomorrowSessions = React.useMemo(() => {
    const source = tomorrowInNextWeek ? nextWeek.sessions : thisWeek.sessions;
    if (!source) return [];
    return source
      .filter(s => s.day === tomorrowIndex)
      .sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
  }, [thisWeek.sessions, nextWeek.sessions, tomorrowIndex, tomorrowInNextWeek]);

  const showPeek = todaySessions.length === 0 && tomorrowSessions.length === 0;

  const peekLesson = React.useMemo(() => {
    if (!showPeek) return null;
    const dayAfterTomorrow = addDays(today, 2);
    const candidates = [
      ...(thisWeek.sessions ?? []),
      ...(nextWeek.sessions ?? []),
    ];
    const future = candidates
      .filter(s => s.lessonState === 'planned' && new Date(s.startsAt).getTime() >= dayAfterTomorrow.getTime())
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    return future[0] || null;
  }, [showPeek, thisWeek.sessions, nextWeek.sessions, today]);

  const [selectedSession, setSelectedSession] = React.useState(null);
  const [toast, setToast] = React.useState(null);

  function handleUpdated(message) {
    setSelectedSession(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.weekLessons() });
    queryClient.invalidateQueries({ queryKey: queryKeys.weeklyKpi() });
    if (message) setToast(message);
  }

  const isLoading = thisWeek.isLoading || (tomorrowInNextWeek && nextWeek.isLoading);

  if (isLoading) {
    return (
      <section className="mobile-agenda" aria-label="Ajanda">
        <div className="mobile-agenda-skeleton" aria-hidden>
          <div className="mobile-agenda-skel-head" />
          <div className="mobile-agenda-skel-row" />
          <div className="mobile-agenda-skel-row" />
        </div>
      </section>
    );
  }

  return (
    <section className="mobile-agenda" aria-label="Ajanda">
      <AgendaGroup
        title="Bugün"
        count={todaySessions.length}
        sessions={todaySessions}
        onOpen={setSelectedSession}
        emptyText="Bugün için planlanmış ders yok."
      />
      {tomorrowSessions.length > 0 && (
        <AgendaGroup
          title="Yarın"
          count={tomorrowSessions.length}
          sessions={tomorrowSessions}
          onOpen={setSelectedSession}
          emptyText="Yarın için planlanmış ders yok."
        />
      )}
      {peekLesson && (
        <button
          type="button"
          className="mobile-agenda-peek"
          onClick={() => setSelectedSession(peekLesson)}
        >
          <span className="mobile-agenda-peek-label">Sıradaki ders</span>
          <span className="mobile-agenda-peek-body">
            <span className="mobile-agenda-peek-when">
              {formatPeekWhen(peekLesson.startsAt, today)}
            </span>
            <span className="mobile-agenda-peek-sep" aria-hidden>·</span>
            <span className="mobile-agenda-peek-time">{peekLesson.time}</span>
            <span className="mobile-agenda-peek-sep" aria-hidden>·</span>
            <span className="mobile-agenda-peek-name">
              {peekLesson.studentNickname || peekLesson.studentName}
            </span>
          </span>
          <span className="mobile-agenda-peek-chev" aria-hidden>›</span>
        </button>
      )}

      {selectedSession && (
        <MobileLessonSheet
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
          onUpdated={handleUpdated}
        />
      )}
      <MobileToast message={toast} onDismiss={() => setToast(null)} />
    </section>
  );
}
