// Mobil takvim üst çubuğu: hafta gezinmesi + haftalık doluluk özeti.
// Tasarım kaynağı: Claude Design "Takvim haftalık doluluk" A1 (çubukta
// "18 ders · %72 dolu" satırı + alt kenarda kapasite çizgisi) ve A2 (satıra
// dokununca açılan özet paneli).
//
// Yalnız üst çubuk ve onun açtığı panel buradadır; takvimin ızgarası,
// kaydırması ve blokları MobileCalendar.jsx'te olduğu gibi kalır.
//
// Sayım, Ana sayfadaki "Haftalık doluluk" ile aynı kural (kpi.service.ts
// lesson_counts): ders = planlı + tamamlandı + gelmedi; iptal sayılmaz; plan
// blokları (calendar_events) ders değildir. Doluluk = ders ÷ haftalık kapasite
// (Ayarlar). Veri takvimin zaten çektiği haftalık ders sorgusundan gelir (aynı
// query key, ayrı `select`); ek istek yalnız önceki hafta (fark için) ve ayarlar.

import React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getWeekLessons, getSettings } from '../api';
import { queryKeys } from '../hooks/queryKeys';

// ‹ › / Bugün'e basıldıktan sonra bu süre boyunca özet satırına dokunuş paneli
// AÇMAZ — hızlı hafta değiştirirken parmak satıra kayarsa panel açılmasın.
export const NAV_TAP_GUARD_MS = 700;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function summarizeWeek(lessons) {
  let completed = 0;
  let scheduled = 0;
  let noShow = 0;
  let cancelled = 0;
  for (const l of lessons || []) {
    if (l.status === 'completed') completed += 1;
    else if (l.status === 'scheduled') scheduled += 1;
    else if (l.status === 'no_show') noShow += 1;
    else if (l.status === 'cancelled') cancelled += 1;
  }
  return { completed, scheduled, noShow, cancelled, total: completed + scheduled + noShow };
}

export function occupancyPct(total, capacity) {
  if (!(capacity > 0)) return null;
  return Math.round((total * 100) / capacity);
}

function getIstanbulMonday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const y = Number(parts.find(p => p.type === 'year').value);
  const mo = Number(parts.find(p => p.type === 'month').value) - 1;
  const d = Number(parts.find(p => p.type === 'day').value);
  const today = new Date(y, mo, d, 0, 0, 0, 0);
  const sinceMonday = (today.getDay() + 6) % 7;
  return new Date(y, mo, d - sinceMonday, 0, 0, 0, 0);
}

function formatWeekRange(weekStart) {
  const sunday = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const s = weekStart.getDate();
  const e = sunday.getDate();
  if (weekStart.getMonth() === sunday.getMonth()) {
    return `${s} – ${e} ${sunday.toLocaleDateString('tr-TR', { month: 'short' })}`;
  }
  return `${s} ${weekStart.toLocaleDateString('tr-TR', { month: 'short' })} – ${e} ${sunday.toLocaleDateString('tr-TR', { month: 'short' })}`;
}

function useWeekOccupancy(weekStart) {
  const weekStartMs = weekStart.getTime();
  const prevStart = React.useMemo(
    () => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7, 0, 0, 0, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekStartMs],
  );

  // useWeekLessons ile aynı key + queryFn → önbellek paylaşılır, ek istek yok.
  // placeholderData yalnız BU gözlemciyi etkiler (takvimin sorgusu değişmez):
  // hafta değişirken yeni sayılar gelene dek eskisi soluk görünür, satır
  // zıplamaz.
  const current = useQuery({
    queryKey: queryKeys.weekLessons(weekStartMs),
    queryFn: () => getWeekLessons(weekStart),
    select: summarizeWeek,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
  const previous = useQuery({
    queryKey: queryKeys.weekLessons(prevStart.getTime()),
    queryFn: () => getWeekLessons(prevStart),
    select: summarizeWeek,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: getSettings,
    staleTime: 5 * 60 * 1000,
  });

  const cap = Number(settings.data?.weeklyCapacity);
  const capacity = Number.isFinite(cap) && cap > 0 ? cap : null;
  const week = current.data || null;
  const pct = week ? occupancyPct(week.total, capacity) : null;
  const prevPct = previous.data ? occupancyPct(previous.data.total, capacity) : null;
  const delta = pct != null && prevPct != null ? pct - prevPct : null;
  const offset = Math.round((weekStartMs - getIstanbulMonday().getTime()) / WEEK_MS);

  const stale = current.isPlaceholderData || previous.isPlaceholderData;

  return { week, capacity, pct, prevPct, delta, offset, stale };
}

// Kapasite çubuğu: tamamlandı · planlı · gelmedi dilimleri, zemin = kapasite.
// Kapasite aşılırsa (ders > kapasite) dilimler toplam derse göre ölçeklenir.
function CapacityBar({ week, capacity, className }) {
  const denom = Math.max(capacity || 0, week.total, 1);
  const w = (n) => `${(n * 100) / denom}%`;
  const label = `${capacity ? `${capacity} derslik kapasite: ` : ''}${week.completed} tamamlandı, ${week.scheduled} planlı`
    + (week.noShow ? `, ${week.noShow} gelmedi` : '');
  return (
    <div className={className} role="img" aria-label={label}>
      {week.completed > 0 && <span className="is-done" style={{ width: w(week.completed) }} />}
      {week.scheduled > 0 && <span className="is-plan" style={{ width: w(week.scheduled) }} />}
      {week.noShow > 0 && <span className="is-noshow" style={{ width: w(week.noShow) }} />}
    </div>
  );
}

const ChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const TrendIcon = ({ down }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {down ? (
      <>
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
        <polyline points="17 18 23 18 23 12" />
      </>
    ) : (
      <>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </>
    )}
  </svg>
);

function eyebrowFor(offset) {
  if (offset === 0) return 'Bu hafta doluluk';
  if (offset === -1) return 'Geçen hafta doluluk';
  if (offset === 1) return 'Gelecek hafta doluluk';
  return 'Haftalık doluluk';
}

function Tile({ kind, label, value }) {
  return (
    <div className={`mobile-cal-occ-tile is-${kind}`}>
      <span className="mobile-cal-occ-tile-k">
        {kind !== 'cancel' && <i className="mobile-cal-occ-key" aria-hidden="true" />}
        {label}
      </span>
      <span className="mobile-cal-occ-tile-v">{value}</span>
    </div>
  );
}

function OccupancyPanel({ occ, top, onClose }) {
  const { week, capacity, pct, prevPct, delta, offset } = occ;
  return (
    <>
      <button
        type="button"
        className="mobile-cal-occ-scrim"
        style={{ top }}
        aria-label="Özeti kapat"
        onClick={onClose}
      />
      <section
        id="mobile-cal-occ-panel"
        className={'mobile-cal-occ-panel' + (occ.stale ? ' is-stale' : '')}
        style={{ top }}
        aria-label="Haftanın doluluk özeti"
      >
        <div className="mobile-cal-occ-head">
          <div className="mobile-cal-occ-headl">
            <span className="mobile-cal-occ-eyebrow">{eyebrowFor(offset)}</span>
            <div className="mobile-cal-occ-hero">
              <span className="mobile-cal-occ-pct">{pct != null ? `%${pct}` : week.total}</span>
              <span className="mobile-cal-occ-of">
                {capacity ? `${week.total} / ${capacity} ders` : 'ders'}
              </span>
            </div>
          </div>
          {delta != null && (
            <div className="mobile-cal-occ-cmp">
              <span className={'mobile-cal-occ-delta' + (delta < 0 ? ' is-down' : delta === 0 ? ' is-flat' : '')}>
                {delta !== 0 && <TrendIcon down={delta < 0} />}
                {delta > 0 ? '+' : ''}{delta} puan
              </span>
              <span className="mobile-cal-occ-prev">
                {offset === 0 ? 'geçen hafta' : 'önceki hafta'} %{prevPct}
              </span>
            </div>
          )}
        </div>

        <CapacityBar week={week} capacity={capacity} className="mobile-cal-occ-bar" />

        <div className={'mobile-cal-occ-tiles' + (week.noShow > 0 ? ' is-four' : '')}>
          <Tile kind="done" label="Tamamlandı" value={week.completed} />
          <Tile kind="plan" label="Planlı" value={week.scheduled} />
          {week.noShow > 0 && <Tile kind="noshow" label="Gelmedi" value={week.noShow} />}
          <Tile kind="cancel" label="İptal" value={week.cancelled} />
        </div>
      </section>
    </>
  );
}

export function WeekNavBar({ weekStart, onPrev, onNext, onToday }) {
  const [open, setOpen] = React.useState(false);
  const [panelTop, setPanelTop] = React.useState(0);
  const barRef = React.useRef(null);
  const lastNavAtRef = React.useRef(0);
  const occ = useWeekOccupancy(weekStart);
  const { week, pct } = occ;

  // Panel üst çubuğun hemen altından açılır; çubuk yüksekliği (safe-area
  // dahil) açılış anında ölçülür.
  React.useLayoutEffect(() => {
    if (open && barRef.current) setPanelTop(barRef.current.offsetHeight);
  }, [open]);

  const nav = (fn) => () => {
    lastNavAtRef.current = Date.now();
    fn();
  };

  function handleSummaryClick() {
    if (open) {
      setOpen(false);
      return;
    }
    if (!week) return;
    if (Date.now() - lastNavAtRef.current < NAV_TAP_GUARD_MS) return;
    setOpen(true);
  }

  return (
    <>
      <div className="mobile-cal-weeknav mobile-cal-weeknav-occ" ref={barRef}>
        <button
          type="button"
          className="mobile-cal-weeknav-btn"
          onClick={nav(onPrev)}
          aria-label="Önceki hafta"
        >
          ‹
        </button>
        <div className="mobile-cal-weeknav-mid">
          <button
            type="button"
            className={'mobile-cal-weeknav-sum' + (open ? ' is-open' : '')}
            onClick={handleSummaryClick}
            aria-expanded={open}
            aria-controls="mobile-cal-occ-panel"
            aria-label={week
              ? `${formatWeekRange(weekStart)}, ${week.total} ders${pct != null ? `, yüzde ${pct} dolu` : ''}. Haftanın özeti`
              : formatWeekRange(weekStart)}
          >
            <span className="mobile-cal-weeknav-range">{formatWeekRange(weekStart)}</span>
            <span className={'mobile-cal-weeknav-occline' + (occ.stale ? ' is-stale' : '')} aria-hidden="true">
              {week ? (
                <>
                  <b>{week.total} ders</b>
                  {pct != null && (
                    <>
                      <span className="mobile-cal-weeknav-dot">·</span>
                      <span>%{pct} dolu</span>
                    </>
                  )}
                  <ChevronDown />
                </>
              ) : (
                <span className="mobile-cal-weeknav-wait">…</span>
              )}
            </span>
          </button>
        </div>
        <button
          type="button"
          className="mobile-cal-weeknav-btn"
          onClick={nav(onNext)}
          aria-label="Sonraki hafta"
        >
          ›
        </button>
        <button
          type="button"
          className="mobile-cal-weeknav-today"
          onClick={nav(onToday)}
        >
          Bugün
        </button>
        {week && occ.capacity && (
          <CapacityBar week={week} capacity={occ.capacity} className="mobile-cal-weeknav-cap" />
        )}
      </div>

      {open && week && (
        <OccupancyPanel occ={occ} top={panelTop} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
