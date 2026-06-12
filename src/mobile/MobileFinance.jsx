// Finans · Akış (A1-K2) — mobil. Menü → Finans veya ana sayfadaki "Son 30
// günde tahsil edilen" kartından açılır. Hafta/Ay anahtarı; hero kazanç
// grafiği (ders + ürün yığılmış barlar, dokunulabilir), KPI çifti (kasaya
// giren · tamamlanan ders), kompakt kaynak dökümü ve son hareketler.
// Veri: GET /kpi/finance-flow (+ son hareketler için GET /movements). Türkçe
// metin/etiketler burada (istemcide) kurulur; backend yalnız sayı döner.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getFinanceFlow, getMovements } from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL, initials } from '../data';

const MONTH_LONG = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];
const MONTH_SHORT = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
];

const SOURCE_META = [
  { key: 'single', k: 'Ders', color: 'oklch(0.5 0.08 145)' },
  { key: 'product', k: 'Ürün satışı', color: 'oklch(0.62 0.12 70)' },
];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// 'YYYY-MM-DD' → yerel Date (UTC kaymasını önlemek için elle parçalanır).
function parseYMD(s) {
  if (!s) return new Date();
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// ISO 8601 hafta numarası (Pazartesi başlangıçlı).
function isoWeekNo(date) {
  const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  return 1 + Math.round((t - firstThu) / (7 * 86400000));
}

function relDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sod = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const diff = Math.round((sod(now) - sod(d)) / 86400000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Dün';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

function fmtHM(iso) {
  return new Date(iso)
    .toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    .replace(':', '.');
}

// Hafta barı etiketleri: kısa "20N" / tam "20–26 Nis" (ay aşan haftalarda
// "27 Nis – 3 May"); içinde bulunulan hafta "BU" / "Bu hafta".
function weekBarLabels(startYMD, current) {
  const s = parseYMD(startYMD);
  const e = new Date(s); e.setDate(s.getDate() + 6);
  const lbl = current
    ? 'BU'
    : `${s.getDate()}${MONTH_LONG[s.getMonth()].charAt(0).toLocaleUpperCase('tr-TR')}`;
  let full;
  if (current) full = 'Bu hafta';
  else if (s.getMonth() === e.getMonth()) full = `${s.getDate()}–${e.getDate()} ${MONTH_SHORT[s.getMonth()]}`;
  else full = `${s.getDate()} ${MONTH_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTH_SHORT[e.getMonth()]}`;
  return { lbl, full };
}

function monthBarLabels(startYMD) {
  const s = parseYMD(startYMD);
  return { lbl: MONTH_SHORT[s.getMonth()], full: MONTH_LONG[s.getMonth()] };
}

function weekRangeLabel(startYMD) {
  const s = parseYMD(startYMD);
  const e = new Date(s); e.setDate(s.getDate() + 6);
  if (s.getMonth() === e.getMonth()) return `${s.getDate()}–${e.getDate()} ${MONTH_LONG[s.getMonth()]}`;
  return `${s.getDate()} ${MONTH_SHORT[s.getMonth()]} – ${e.getDate()} ${MONTH_SHORT[e.getMonth()]}`;
}

// Backend dönem nesnesi → grafik serisi + dönem geneli alanlar. Kart metinleri
// seçili bara göre `deriveView` içinde kurulur (dönem geneli değil).
function derivePeriod(data, period) {
  const isWeek = period === 'hafta';
  const raw = isWeek ? data.week : data.month;
  const today = parseYMD(data.today);

  const series = raw.series.map((pt) => {
    const ders = num(pt.lesson);
    const urun = num(pt.product);
    const labels = isWeek ? weekBarLabels(pt.start, pt.current) : monthBarLabels(pt.start);
    return {
      id: pt.start,
      ...labels,
      total: ders + urun,
      ders,
      urun,
      dersN: num(pt.completedLessons),
      current: !!pt.current,
      cash: { total: num(pt.cashTotal), cash: num(pt.cashCash), iban: num(pt.cashIban) },
      outstanding: num(pt.outstanding),
    };
  });

  return {
    isWeek,
    series,
    prevEarnings: num(raw.prevEarnings),
    scheduledRemaining: num(raw.scheduledRemaining),
    today,
  };
}

// Seçili bara (idx) göre tüm kart/başlık metinleri. Cari (kısmi) dönem seçiliyse
// karşılaştırma "aynı günlere kadar" (prevEarnings) ve planlı ders kalanı
// gösterilir; geçmiş bir dönem seçiliyse karşılaştırma bir önceki tam barla
// yapılır. periodLabel her kartta hangi döneme ait olduğunu belirtir.
function deriveView(p, idx) {
  const { isWeek, series, prevEarnings, scheduledRemaining, today } = p;
  const it = series[idx] || series[series.length - 1];
  const offset = (series.length - 1) - idx; // 0 = cari dönem
  const isCurrent = !!it.current;
  const start = parseYMD(it.id);

  // periodLabel — eyebrow + kaynak notunda (uzun biçim). tagLabel — dar KPI
  // kartı rozetinde (geçmiş haftalarda kısa ay biçimi, taşmayı önler).
  let periodLabel;
  let tagLabel;
  if (isWeek) {
    if (offset === 0) { periodLabel = 'Bu hafta'; tagLabel = 'Bu hafta'; }
    else if (offset === 1) { periodLabel = 'Geçen hafta'; tagLabel = 'Geçen hafta'; }
    else { periodLabel = weekRangeLabel(it.id); tagLabel = weekBarLabels(it.id, false).full; }
  } else {
    periodLabel = MONTH_LONG[start.getMonth()];
    tagLabel = periodLabel;
  }

  // Başlık alt satırı (header) — seçili dönemin tarih aralığı.
  let sub;
  if (isWeek) {
    sub = `${weekRangeLabel(it.id)} · ${isoWeekNo(start)}. hafta`;
  } else if (isCurrent) {
    sub = `1–${today.getDate()} ${MONTH_LONG[start.getMonth()]} · devam ediyor`;
  } else {
    sub = `${MONTH_LONG[start.getMonth()]} ${start.getFullYear()}`;
  }

  // Trend rozeti (sayının yanındaki ▲/▼ %): cari dönem → önceki dönemle "aynı
  // günlere kadar"; geçmiş dönem → bir önceki tam bar.
  let deltaPct = null;
  if (isCurrent) {
    if (prevEarnings > 0) deltaPct = Math.round(((it.total - prevEarnings) / prevEarnings) * 100);
  } else {
    const prevBar = series[idx - 1];
    if (prevBar && prevBar.total > 0) deltaPct = Math.round(((it.total - prevBar.total) / prevBar.total) * 100);
  }

  // Hak edişin tahsilat durumu: hak ediş − bekleyen alacak = tahsil edilen.
  // (paket dersleri peşin sayılır, bekleyene girmez.) Hero alt satırında gösterilir.
  const outstanding = Math.max(0, it.outstanding);
  const collected = Math.max(0, it.total - outstanding);
  let collectSub = '';
  if (it.total > 0.005) {
    collectSub = outstanding <= 0.005
      ? `Tamamı tahsil edildi · ${fmtTL(collected)}`
      : `${fmtTL(collected)} tahsil edildi · ${fmtTL(outstanding)} bekliyor`;
  }

  // Tamamlanan ders alt satırı — cari dönemde planlı kalan; geçmişte özet.
  let dersSub;
  if (isCurrent) {
    const rem = scheduledRemaining;
    dersSub = isWeek
      ? (rem > 0 ? `${rem} planlı ders kaldı` : 'planlı ders kalmadı')
      : (rem > 0 ? `ay sonuna ${rem} planlı` : 'ay sonuna planlı ders yok');
  } else {
    dersSub = it.dersN > 0 ? 'tamamlandı' : 'ders yok';
  }

  const sources = [
    { ...SOURCE_META[0], v: it.ders },
    { ...SOURCE_META[1], v: it.urun },
  ];

  return {
    periodLabel,
    tagLabel,
    eyebrow: `${periodLabel} hak ediş`,
    sub,
    kazanc: it.total,
    deltaPct,
    collectSub,
    tahsilat: it.cash.total,
    tahsilatSub: `Nakit ${fmtTL(it.cash.cash)} · IBAN ${fmtTL(it.cash.iban)}`,
    ders: it.dersN,
    dersSub,
    sources,
  };
}

function movementView(row) {
  const d = row.details || {};
  if (row.kind === 'payment') {
    const src = d.source === 'iban' ? 'IBAN' : 'Nakit';
    return { tone: 'tahsilat', isIn: true, amount: num(d.amount), sub: `${relDay(row.occurred_at)} · ${src} tahsilatı` };
  }
  if (row.kind === 'product_sale') {
    return { tone: 'urun', isIn: false, amount: num(d.total_amount), sub: `${relDay(row.occurred_at)} · Ürün satışı` };
  }
  if (row.kind === 'lesson_completed' && d.prepaid_package_id == null) {
    const t = d.starts_at ? `${fmtHM(d.starts_at)} dersi` : 'Ders';
    return { tone: 'ders', isIn: false, amount: num(d.net_amount), sub: `${relDay(row.occurred_at)} · ${t}` };
  }
  return null; // paket kredili ders / iptal / gelmedi — finans akışında para hareketi yok
}

const BackIc = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const ChevIc = ({ s = 12 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const TrendIc = ({ down = false }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
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

function RecentMovements({ onOpenAll }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['movements', 'finance-recent'],
    queryFn: () => getMovements({ limit: 12 }),
    staleTime: 60 * 1000,
  });

  const rows = React.useMemo(() => {
    const src = data?.data ?? [];
    const out = [];
    for (const row of src) {
      const v = movementView(row);
      if (v) out.push({ row, v });
      if (out.length >= 6) break;
    }
    return out;
  }, [data]);

  return (
    <section className="fax-card">
      <div className="fax-card-head">
        <h2 className="fax-card-title">Son hareketler</h2>
        <button className="fax-link" onClick={onOpenAll} type="button">Tümü <ChevIc s={12} /></button>
      </div>
      {isLoading ? (
        <div className="fax-mv-empty">Yükleniyor…</div>
      ) : isError ? (
        <div className="fax-mv-empty">Hareketler yüklenemedi.</div>
      ) : rows.length === 0 ? (
        <div className="fax-mv-empty">Henüz hareket yok.</div>
      ) : (
        <ul className="fk2-mv-list">
          {rows.map(({ row, v }) => (
            <li key={row.id} className="fk2-mv-row">
              <span className={'fk2-mv-av is-' + v.tone}>{initials(row.student_name)}</span>
              <span className="fk2-mv-main">
                <span className="fk2-mv-name">{row.student_name}</span>
                <span className="fk2-mv-sub">{v.sub}</span>
              </span>
              <span className={'fk2-mv-amt' + (v.isIn ? ' is-in' : '')}>
                {v.isIn ? '+' : ''}{fmtTL(v.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function MobileFinance({ onBack, onOpenMovements }) {
  const [period, setPeriod] = React.useState('hafta');
  const [sel, setSel] = React.useState(null);

  React.useEffect(() => { setSel(null); }, [period]);

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.financeFlow(),
    queryFn: getFinanceFlow,
    staleTime: 2 * 60 * 1000,
  });

  const p = React.useMemo(() => (data ? derivePeriod(data, period) : null), [data, period]);

  const max = p ? Math.max(1, ...p.series.map((s) => s.total)) : 1;
  // Dönem değişince `sel` bir sonraki render'a kadar eski (olası sınır dışı)
  // indeksi tutar — yeni serinin son barına kıstır ki selItem asla undefined olmasın.
  const selIndex = p ? Math.min(sel ?? p.series.length - 1, p.series.length - 1) : 0;
  const selItem = p ? p.series[selIndex] : null;
  const view = React.useMemo(() => (p ? deriveView(p, selIndex) : null), [p, selIndex]);
  const srcTotal = view ? Math.max(1, view.sources.reduce((a, s) => a + s.v, 0)) : 1;
  const hasDelta = view && view.deltaPct != null;
  const deltaDown = hasDelta && view.deltaPct < 0;

  return (
    <div className="fin fax fa1" data-screen-label="finance">
      <header className="fax-head">
        <button className="fax-back" aria-label="Geri" onClick={onBack} type="button"><BackIc /></button>
        <div className="fax-head-mid">
          <h1 className="fax-title">Finans</h1>
          <span className="fax-sub">{view ? view.sub : ' '}</span>
        </div>
        <div className="fax-seg" role="tablist">
          {[['hafta', 'Hafta'], ['ay', 'Ay']].map(([id, lbl]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={period === id}
              className={'fax-seg-btn' + (period === id ? ' is-on' : '')}
              onClick={() => setPeriod(id)}
            >
              {lbl}
            </button>
          ))}
        </div>
      </header>

      {isError ? (
        <section className="fax-card"><div className="fax-mv-empty">Finans verisi yüklenemedi.</div></section>
      ) : isLoading || !p ? (
        <FinanceSkeleton />
      ) : (
        <>
          {/* Hero grafik */}
          <section className="fax-card fa1-hero">
            <span className="fax-eyebrow">{view.eyebrow}</span>
            <div className="fax-hero-row">
              <span key={period + '-' + selIndex} className="fax-hero-val fax-anim">{fmtTL(view.kazanc)}</span>
              {hasDelta && (
                <span className={'fax-delta' + (deltaDown ? ' is-down' : '')}>
                  <TrendIc down={deltaDown} /> %{Math.abs(view.deltaPct)}
                </span>
              )}
            </div>
            {view.collectSub && <span className="fax-hero-sub">{view.collectSub}</span>}
            <div key={period + '-chart'} className="fax-chart fax-anim-soft">
              {p.series.map((it, i) => (
                <button
                  key={it.id}
                  type="button"
                  className={'fax-bar-col' + (selIndex === i ? ' is-sel' : '') + (it.current ? ' is-cur' : '')}
                  onClick={() => setSel(i)}
                  aria-label={it.full + ' ' + fmtTL(it.total)}
                >
                  <span className="fa3-stack" style={{ height: Math.round((it.total / max) * 100) + '%' }}>
                    <span
                      className="fa3-stack-urun"
                      style={{ height: (it.total > 0 ? Math.round((it.urun / it.total) * 100) : 0) + '%' }}
                    />
                    <span className="fa3-stack-ders" />
                  </span>
                  <span className="fax-bar-lbl">{it.lbl}</span>
                </button>
              ))}
            </div>
            <div className="fa3-legend">
              <span className="fa3-leg"><i className="fa3-leg-sw is-ders" />Ders</span>
              <span className="fa3-leg"><i className="fa3-leg-sw is-urun" />Ürün</span>
            </div>
            <div className="fax-chart-detail">
              <span className="fax-chart-week">{selItem.full}</span>
              <span className="fax-chart-meta">Ders {fmtTL(selItem.ders)} · Ürün {fmtTL(selItem.urun)}</span>
              <span className="fax-chart-val">{fmtTL(selItem.total)}</span>
            </div>
          </section>

          {/* KPI çifti */}
          <section className="fax-pair">
            <div className="fax-mini">
              <div className="fax-mini-top">
                <span className="fax-mini-k">Kasaya giren</span>
                <span className="fax-mini-tag">{view.tagLabel}</span>
              </div>
              <span key={period + '-t-' + selIndex} className="fax-mini-v fax-anim">{fmtTL(view.tahsilat)}</span>
              <span className="fax-mini-s">{view.tahsilatSub}</span>
            </div>
            <div className="fax-mini fax-mini-blue">
              <div className="fax-mini-top">
                <span className="fax-mini-k">Tamamlanan ders</span>
                <span className="fax-mini-tag">{view.tagLabel}</span>
              </div>
              <span key={period + '-d-' + selIndex} className="fax-mini-v fax-anim">{view.ders}</span>
              <span className="fax-mini-s">{view.dersSub}</span>
            </div>
          </section>

          {/* Kompakt kaynak */}
          <section className="fax-card">
            <div className="fax-card-head">
              <h2 className="fax-card-title">Hak ediş nereden geldi</h2>
              <span className="fax-card-note">{view.periodLabel.toLocaleLowerCase('tr-TR')}</span>
            </div>
            <div key={period + '-srcbar-' + selIndex} className="fk2-srcbar fax-anim-soft">
              {view.sources.map((s) => (
                <i key={s.key} style={{ width: (s.v / srcTotal) * 100 + '%', background: s.color }} />
              ))}
            </div>
            <div className="fk2-srclegend">
              {view.sources.map((s) => (
                <span key={s.key} className="fk2-srcleg">
                  <i className="fax-src-dot" style={{ background: s.color }} />
                  <span className="fk2-srcleg-k">{s.k}</span>
                  <span key={period + s.key + selIndex} className="fk2-srcleg-v fax-anim">{fmtTL(s.v)}</span>
                </span>
              ))}
            </div>
          </section>

          {/* Son hareketler */}
          <RecentMovements onOpenAll={onOpenMovements} />
        </>
      )}
    </div>
  );
}

function FinanceSkeleton() {
  return (
    <div className="fax-sk" aria-hidden="true">
      <div className="fax-card fax-sk-hero" />
      <div className="fax-pair">
        <div className="fax-mini fax-sk-box" />
        <div className="fax-mini fax-sk-box" />
      </div>
      <div className="fax-card fax-sk-card" />
    </div>
  );
}
