import React from 'react';
import { getWeekLessons } from '../../api';

function extractIstanbulParts(isoString) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date(isoString));
  const get = type => Number(parts.find(p => p.type === type).value);
  return {
    year: get('year'),
    month: get('month') - 1,
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

function deriveLessonState(status, paid, price) {
  if (status === 'cancelled' || status === 'no_show') return 'cancelled';
  const isCompleted = status === 'completed' || status === 'geçti';
  if (!isCompleted) return 'planned';
  const paidNum = Number(paid) || 0;
  const priceNum = Number(price) || 0;
  if (priceNum === 0) return 'unpaid';
  if (paidNum >= priceNum) return 'paid';
  if (paidNum > 0) return 'partial';
  return 'unpaid';
}

function normalizeLesson(l) {
  const { year, month, day, hour, minute } = extractIstanbulParts(l.starts_at);
  const localDate = new Date(year, month, day);
  const dayIndex = (localDate.getDay() + 6) % 7;
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  const paid = Number(l.paid_amount) || 0;
  const gross = Number(l.price_snapshot) || 0;
  const discount = Number(l.discount_amount) || 0;
  const price = Number(l.net_amount ?? (gross - discount)) || 0;
  const productSales = Array.isArray(l.product_sales)
    ? l.product_sales.map(sale => ({
        id: String(sale.id),
        totalAmount: Number(sale.total_amount) || 0,
        paidAmount: Number(sale.paid_amount) || 0,
        remaining: Number(sale.remaining) || 0,
        note: sale.note || null,
      }))
    : [];
  return {
    id: l.id,
    studentName: l.student_name,
    studentNickname: l.student_nickname || null,
    day: dayIndex,
    hour,
    minute,
    time: `${hh}:${mm}`,
    startsAt: l.starts_at,
    durationMinutes: Number(l.duration_minutes) || 60,
    mode: l.mode,
    paid,
    price,
    grossPrice: gross,
    discountAmount: discount,
    paymentMethod: l.payment_source || null,
    note: l.note || null,
    lessonState: deriveLessonState(l.status, paid, price),
    productSales,
  };
}

export function useWeekLessons(weekStart) {
  const [state, setState] = React.useState({
    sessions: null,
    error: null,
    isLoading: true,
  });

  const weekStartKey = weekStart.getTime();

  React.useEffect(() => {
    let cancelled = false;
    setState({ sessions: null, error: null, isLoading: true });

    async function load() {
      try {
        const data = await getWeekLessons(weekStart);
        if (cancelled) return;
        const sessions = (data || [])
          .map(normalizeLesson)
          .filter(s => s.lessonState !== 'cancelled');
        setState({ sessions, error: null, isLoading: false });
      } catch (error) {
        if (cancelled) return;
        console.error('[useWeekLessons] fetch basarisiz:', error);
        setState({
          sessions: null,
          error: error instanceof Error ? error.message : 'Haftalik ders verisi alinamadi.',
          isLoading: false,
        });
      }
    }

    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartKey]);

  return state;
}
