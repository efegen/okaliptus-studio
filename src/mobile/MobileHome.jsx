import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MobileHomeView } from './home/MobileHomeView';
import { MobileAgenda } from './home/MobileAgenda';
import { useWeeklyKpi, parseNumericValue } from './shared/useWeeklyKpi';
import { useWeekLessons } from './shared/useWeekLessons';
import { getSettings } from '../api';
import { queryKeys } from '../hooks/queryKeys';

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

function formatDateLabel(date) {
  const weekday = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', weekday: 'long',
  }).format(date);
  const rest = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
  const wd = weekday.charAt(0).toLocaleUpperCase('tr-TR') + weekday.slice(1);
  return `${wd}, ${rest}`;
}

export function MobileHome({ user, onLogout }) {
  const { data: kpi, isLoading: kpiLoading } = useWeeklyKpi();
  const { data: studioSettings } = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: getSettings,
    staleTime: 5 * 60 * 1000,
  });

  const today = React.useMemo(getIstanbulToday, []);
  const thisMonday = React.useMemo(() => getWeekStart(today), [today]);
  const { sessions } = useWeekLessons(thisMonday);

  const todayIndex = (today.getDay() + 6) % 7;
  const todayCount = React.useMemo(() => {
    if (!sessions) return 0;
    return sessions.filter(s => s.day === todayIndex).length;
  }, [sessions, todayIndex]);

  const collected = parseNumericValue(kpi?.monthlyCashInflow?.total, 0);
  const revenue = parseNumericValue(kpi?.monthlyRevenue?.total, 0);
  const collectionRate = revenue > 0 ? Math.round((collected / revenue) * 100) : 0;

  const receivable = parseNumericValue(kpi?.receivable, 0);
  const debtorCount = parseNumericValue(kpi?.debtorStudentCount, 0);

  const occupancyRatio = parseNumericValue(kpi?.occupancyRatio, null);
  const plannedLessons = parseNumericValue(kpi?.lessonCounts?.planned, 0);
  const capacity = parseNumericValue(studioSettings?.weeklyCapacity, null);
  const occupancy = occupancyRatio !== null
    ? Math.round(occupancyRatio * 100)
    : (capacity ? Math.round((plannedLessons / capacity) * 100) : 0);

  const dateLabel = React.useMemo(() => formatDateLabel(today), [today]);
  const headline = `Bugün ${todayCount} ders var`;

  return (
    <>
      <MobileHomeView
        dateLabel={dateLabel}
        headline={headline}
        user={user}
        onLogout={onLogout}
        collected={collected}
        revenue={revenue}
        collectionRate={collectionRate}
        receivable={receivable}
        debtorCount={debtorCount}
        occupancy={occupancy}
        plannedLessons={plannedLessons}
        capacity={capacity}
        kpiLoading={kpiLoading}
      />
      <MobileAgenda />
    </>
  );
}
