import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MobileHomeView } from './home/MobileHomeView';
import { MobileAgenda } from './home/MobileAgenda';
import { useWeeklyKpi, parseNumericValue } from './shared/useWeeklyKpi';
import { useWeekLessons } from './shared/useWeekLessons';
import { getSettings, getTrendyolOrdersList } from '../api';
import { queryKeys } from '../hooks/queryKeys';

const ORDERS_WINDOW_DAYS = 90;

function isUrgent(ms) {
  if (!ms) return false;
  const diff = ms - Date.now();
  return diff > 0 && diff < 24 * 60 * 60 * 1000;
}

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

export function MobileHome({ user, onLogout, onOpenFinance, onOpenOccupancy, onOpenOrders }) {
  const { data: kpi, isLoading: kpiLoading } = useWeeklyKpi();
  const { data: studioSettings } = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: getSettings,
    staleTime: 5 * 60 * 1000,
  });

  // Sipariş sorgusu — MobileOrders ile aynı query key → önbellek paylaşılır.
  const { data: ordersData } = useQuery({
    queryKey: ['trendyolOrders', null, null, ORDERS_WINDOW_DAYS],
    queryFn: () => getTrendyolOrdersList({ windowDays: ORDERS_WINDOW_DAYS }),
    staleTime: 30 * 1000,
  });
  const tabCounts = ordersData?.tabCounts ?? {};
  const ordersPending = (tabCounts.yeni ?? 0) + (tabCounts.isleme ?? 0);
  const ordersUrgent = React.useMemo(() => {
    if (!ordersData?.orders) return 0;
    return ordersData.orders.filter(
      o => (o.tab === 'yeni' || o.tab === 'isleme') && isUrgent(o.agreedDeliveryDate),
    ).length;
  }, [ordersData]);

  const today = React.useMemo(getIstanbulToday, []);
  const thisMonday = React.useMemo(() => getWeekStart(today), [today]);
  const { sessions } = useWeekLessons(thisMonday);

  const todayIndex = (today.getDay() + 6) % 7;
  const todayCount = React.useMemo(() => {
    if (!sessions) return 0;
    return sessions.filter(s => s.day === todayIndex).length;
  }, [sessions, todayIndex]);

  const collected = parseNumericValue(kpi?.last30CashInflow?.total, 0);
  const revenue = parseNumericValue(kpi?.last30Revenue?.total, 0);
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
  const headline = todayCount === 0 ? 'Bugün ders yok' : `Bugün ${todayCount} ders var`;

  return (
    <>
      <MobileHomeView
        dateLabel={dateLabel}
        headline={headline}
        user={user}
        onLogout={onLogout}
        onOpenFinance={onOpenFinance}
        onOpenOccupancy={onOpenOccupancy}
        onOpenOrders={onOpenOrders}
        collected={collected}
        revenue={revenue}
        collectionRate={collectionRate}
        receivable={receivable}
        debtorCount={debtorCount}
        occupancy={occupancy}
        plannedLessons={plannedLessons}
        capacity={capacity}
        kpiLoading={kpiLoading}
        ordersPending={ordersPending}
        ordersUrgent={ordersUrgent}
      />
      <MobileAgenda />
    </>
  );
}
