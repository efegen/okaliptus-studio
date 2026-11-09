// Ekran dışında kalan PLANLI dersler için kenar çipi (Tasarım A, Claude Design
// "Takvim gizli ders işareti"). Takvim açılınca en alta kaydığından sabah
// dersleri yukarıda kalıp gözden kaçabiliyor; gizli planlı dersi olan günün
// tepesinde "↑ 2 ders" (aşağıda kalanlar için altta "↓") çipi çıkar, dokununca
// takvim o günün ilk gizli dersine kayar.
//
// Takvimin ızgarasına, kaydırmasına ve sayfalama koduna DOKUNMAZ: çipler
// kaydırma alanının DIŞINDA, onun üstüne bindirilmiş ayrı bir katmandadır
// (böylece iOS'ta kaydırırken titremez). Yatay sayfalama MobileCalendar'da
// `.mobile-cal-bodies`'e doğrudan yazılan transform ile yapılır; katmanın izi o
// transform'u MutationObserver ile aynen kopyalar.
//
// Yalnız planlı (scheduled) dersler sayılır; tamamlanmış (ödendi / ödenmedi /
// kısmi) dersler, iptaller ve plan blokları sayılmaz.

import React from 'react';

// MobileCalendar ile aynı ölçüler: 08:00'den başlayan saat başına 48 px ızgara,
// 36 px yapışkan gün başlığı.
const FIRST_HOUR = 8;
const HOUR_PX = 48;
const HEAD_PX = 36;
// Bir dersin bundan azı görünüyorsa gizli sayılır (biraz görünen ders zaten
// fark edilir).
export const VISIBLE_TOL_PX = 12;
// Çipe dokununca ders kenara yapışmasın diye bırakılan pay.
const SCROLL_MARGIN_PX = 8;

const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

// Bir günün planlı derslerinin ızgaradaki dikey aralıkları (px, gün gövdesinin
// tepesine göre), başlangıca göre sıralı. LessonBlock ile aynı konum hesabı;
// 08:00'den önce başlayan (çizilmeyen) dersler atlanır.
export function plannedSpans(sessions) {
  const spans = [];
  for (const s of sessions || []) {
    if (s.lessonState !== 'planned') continue;
    const startMinutes = (s.hour - FIRST_HOUR) * 60 + s.minute;
    if (startMinutes < 0) continue;
    const top = (startMinutes / 60) * HOUR_PX;
    const bottom = top + ((Number(s.durationMinutes) || 60) / 60) * HOUR_PX;
    spans.push({ top, bottom, time: s.time });
  }
  spans.sort((a, b) => a.top - b.top);
  return spans;
}

// viewTop / viewBottom: gün gövdesinde şu an görünen aralık (px).
export function hiddenSplit(spans, viewTop, viewBottom) {
  const above = spans.filter((s) => s.bottom <= viewTop + VISIBLE_TOL_PX);
  const below = spans.filter((s) => s.top >= viewBottom - VISIBLE_TOL_PX);
  return { above, below };
}

// iOS'ta sınırın ötesine çekip bırakınca (esneme / bounce) scrollTop bir an
// 0'ın altına ya da en alt değerin üstüne çıkar; ham değerle hesaplanırsa
// kenardaki ders bir an "gizli" sayılıp çip yanıp söner. Bu yüzden konum
// gerçek kaydırma aralığına sıkıştırılır: esneme sırasında sonuç, takvimin
// durduğu kenardaki sonuçla aynı kalır.
function viewOf(el) {
  const maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
  const viewTop = Math.min(maxTop, Math.max(0, el.scrollTop));
  const viewHeight = el.clientHeight - HEAD_PX;
  return { viewTop, viewBottom: viewTop + viewHeight, viewHeight };
}

const ArrowUp = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
const ArrowDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);

const EMPTY = Array.from({ length: 7 }, () => ({ above: 0, below: 0 }));

export function OffscreenLessonChips({ scrollRef, bodiesRef, sessionsByDay }) {
  const trackRef = React.useRef(null);
  const spansByDay = React.useMemo(
    () => Array.from({ length: 7 }, (_, d) => plannedSpans(sessionsByDay?.[d])),
    [sessionsByDay],
  );
  const spansRef = React.useRef(spansByDay);
  spansRef.current = spansByDay;

  const [counts, setCounts] = React.useState(EMPTY);
  const sigRef = React.useRef('');

  // Kaydırma her karede çağrılır ama durum yalnız sayılar değişince güncellenir.
  const measure = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { viewTop, viewBottom } = viewOf(el);
    const next = spansRef.current.map((spans) => {
      const { above, below } = hiddenSplit(spans, viewTop, viewBottom);
      return { above: above.length, below: below.length };
    });
    const sig = next.map((c) => `${c.above}/${c.below}`).join(',');
    if (sig !== sigRef.current) {
      sigRef.current = sig;
      setCounts(next);
    }
  }, [scrollRef]);

  React.useEffect(() => { measure(); }, [spansByDay, measure]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [scrollRef, measure]);

  // Yatay sayfalama: takvimin gövdelerine yazdığı transform + transition'ı
  // aynen kopyala (sürükleme sırasında da aynı karede).
  React.useLayoutEffect(() => {
    const src = bodiesRef.current;
    const dst = trackRef.current;
    if (!src || !dst || typeof MutationObserver === 'undefined') return undefined;
    const copy = () => {
      dst.style.transition = src.style.transition;
      dst.style.transform = src.style.transform;
    };
    copy();
    const mo = new MutationObserver(copy);
    mo.observe(src, { attributes: true, attributeFilter: ['style'] });
    return () => mo.disconnect();
  }, [bodiesRef]);

  function goAbove(d) {
    const el = scrollRef.current;
    if (!el) return;
    const { viewTop, viewBottom } = viewOf(el);
    const first = hiddenSplit(spansRef.current[d], viewTop, viewBottom).above[0];
    if (first) el.scrollTo({ top: Math.max(0, first.top - SCROLL_MARGIN_PX), behavior: 'smooth' });
  }

  function goBelow(d) {
    const el = scrollRef.current;
    if (!el) return;
    const { viewTop, viewBottom, viewHeight } = viewOf(el);
    const first = hiddenSplit(spansRef.current[d], viewTop, viewBottom).below[0];
    if (first) el.scrollTo({ top: Math.max(0, first.bottom + SCROLL_MARGIN_PX - viewHeight), behavior: 'smooth' });
  }

  return (
    <div className="mobile-cal-offscreen">
      <div className="mobile-cal-offscreen-track" ref={trackRef}>
        {counts.map((c, d) => (
          <div key={d} className="mobile-cal-offscreen-col">
            {c.above > 0 && (
              <button
                type="button"
                className="mobile-cal-offscreen-chip is-up"
                onClick={() => goAbove(d)}
                aria-label={`${DAY_NAMES[d]}: yukarıda ${c.above} planlı ders, ilkine git`}
              >
                <span className="mobile-cal-offscreen-pill"><ArrowUp />{c.above} ders</span>
              </button>
            )}
            {c.below > 0 && (
              <button
                type="button"
                className="mobile-cal-offscreen-chip is-down"
                onClick={() => goBelow(d)}
                aria-label={`${DAY_NAMES[d]}: aşağıda ${c.below} planlı ders, ilkine git`}
              >
                <span className="mobile-cal-offscreen-pill"><ArrowDown />{c.below} ders</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
