import React from 'react';
import { MobileGreetingHeader } from './MobileGreetingHeader';
import { MobileHeroLessonCard } from './home/MobileHeroLessonCard';
import { MobileFinanceSummary } from './home/MobileFinanceSummary';
import { MobileWeekStrip } from './home/MobileWeekStrip';
import { MobileDayLessons } from './MobileDayLessons';

function getIstanbulTodayISO() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

export function MobileHome({ user, onLogout }) {
  const [selectedISO, setSelectedISO] = React.useState(getIstanbulTodayISO);

  return (
    <div className="mobile-home">
      <MobileGreetingHeader user={user} onLogout={onLogout} />
      <MobileHeroLessonCard />
      <MobileFinanceSummary />
      <MobileWeekStrip selectedISO={selectedISO} onSelect={setSelectedISO} />
      <MobileDayLessons selectedISO={selectedISO} />
    </div>
  );
}
