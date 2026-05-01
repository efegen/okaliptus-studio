import React from 'react';
import { Avatar } from '../layout';
import { getWeekLessons } from '../api';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Günaydın';
  if (hour >= 12 && hour < 18) return 'Merhaba';
  if (hour >= 18 && hour < 22) return 'İyi akşamlar';
  return 'İyi geceler';
}

function getIstanbulYmd(dateOrIso) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = formatter.formatToParts(
    dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso)
  );
  const y = parts.find(p => p.type === 'year').value;
  const mo = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${mo}-${d}`;
}

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

function getCurrentMonday() {
  const today = getIstanbulToday();
  const daysSinceMonday = (today.getDay() + 6) % 7;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday, 0, 0, 0, 0);
}

function isCompletedStatus(status) {
  return status === 'completed' || status === 'geçti';
}

function useTodayLessons() {
  const [state, setState] = React.useState({ lessons: null, error: null });
  React.useEffect(() => {
    let cancelled = false;
    const monday = getCurrentMonday();
    const todayYmd = getIstanbulYmd(new Date());
    getWeekLessons(monday)
      .then(weekLessons => {
        if (cancelled) return;
        const today = (weekLessons || []).filter(
          l => getIstanbulYmd(l.starts_at) === todayYmd
        );
        setState({ lessons: today, error: null });
      })
      .catch(err => {
        if (cancelled) return;
        setState({ lessons: null, error: err });
      });
    return () => { cancelled = true; };
  }, []);
  return state;
}

function formatLessonsLine(lessons) {
  if (!lessons) return 'Bugün...';
  const total = lessons.length;
  if (total === 0) return 'Bugün ders yok 🌿';
  const completed = lessons.filter(l => isCompletedStatus(l.status)).length;
  if (completed === 0) return `Bugün ${total} dersin var`;
  if (completed === total) return `Bugün tamamlandı · ${total}/${total}`;
  return `Bugün ${total} dersin var · ${completed} tamamlandı`;
}

export function MobileGreetingHeader({ user }) {
  const { lessons, error } = useTodayLessons();
  const displayName = user?.displayName || '';
  const greeting = displayName ? `${getGreeting()}, ${displayName}` : getGreeting();
  const lessonsLine = error ? null : formatLessonsLine(lessons);

  return (
    <div className="mobile-greeting-header">
      <div className="mobile-greeting-text">
        <h1 className="mobile-greeting-line1">{greeting}</h1>
        {lessonsLine && (
          <p className="mobile-greeting-line2">{lessonsLine}</p>
        )}
      </div>
      {displayName && (
        <div className="mobile-greeting-avatar">
          <Avatar name={displayName} size="md" />
        </div>
      )}
    </div>
  );
}
