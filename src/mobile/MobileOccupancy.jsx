// Doluluk · Yoklama (B2 · D2) — mobil. Ana sayfadaki "Haftalık doluluk"
// kartına dokununca açılır. Para değil ÖĞRENCİ/DERS dili: % doluluk + haftalık
// sütun grafiği (tavan = haftalık kapasite), KPI çifti (ders cirosu · öğrenci
// iptali) ve "Temposu düşenler" yoklama tablosu.
// Tasarım kaynağı: Claude Design "Mobil Doluluk B2 - D2 Yoklama Tablosu
// (Geliştirilmiş)" (OccDd2). fax dilini (MobileFinance ile ortak) kullanır.
// Veri: GET /kpi/occupancy-flow. Backend yalnız sayı döner; Türkçe metin/etiket
// burada (istemcide) kurulur. Hero + KPI'lar, Finans ekranındaki gibi SEÇİLİ
// bara göre güncellenir (deriveView); kart rozeti hangi döneme ait olduğunu
// gösterir.

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getOccupancyFlow } from '../api';
import { queryKeys } from '../hooks/queryKeys';
import { fmtTL } from '../data';

const MONTH_LONG = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];
const MONTH_SHORT = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
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

// Hafta barı etiketleri: kısa "20N" / tam "20–26 Nis" (ay aşan haftalarda
// "27 Nis – 3 May"); içinde bulunulan hafta "BU" / "Bu hafta". (MobileFinance
// ile aynı biçim.)
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

// Backend dönem nesnesi → grafik serisi (etiketli sayılar). pct/planned/...
// zaten backend'de hesaplanır; burada yalnız etiket + Number() eklenir.
function derivePeriod(data, period) {
  const isWeek = period === 'hafta';
  const raw = isWeek ? data.week : data.month;
  const series = raw.series.map((pt) => {
    const labels = isWeek ? weekBarLabels(pt.start, pt.current) : monthBarLabels(pt.start);
    return {
      id: pt.start,
      ...labels,
      pct: num(pt.pct),
      planned: num(pt.planned),
      completed: num(pt.completed),
      cancelled: num(pt.cancelled),
      revenue: num(pt.revenue),
      current: !!pt.current,
    };
  });
  return { isWeek, series };
}

// Seçili bara (idx) göre tüm hero/KPI/başlık metinleri — Finans ekranındaki
// deriveView ile aynı mantık. tagLabel KPI rozetinde hangi dönem olduğunu
// belirtir; delta seçili bar ile bir önceki bar arasındaki puan farkıdır.
function deriveView(p, idx, capacity, today) {
  const { isWeek, series } = p;
  const it = series[idx] || series[series.length - 1];
  const offset = (series.length - 1) - idx; // 0 = cari dönem
  const isCurrent = !!it.current;
  const start = parseYMD(it.id);

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

  // Başlık alt satırı — seçili dönemin tarih aralığı.
  let sub;
  if (isWeek) sub = `${weekRangeLabel(it.id)} · ${isoWeekNo(start)}. hafta`;
  else if (isCurrent) sub = `1–${parseYMD(today).getDate()} ${MONTH_LONG[start.getMonth()]} · devam ediyor`;
  else sub = `${MONTH_LONG[start.getMonth()]} ${start.getFullYear()}`;

  // Hero alt satırı — doluluğun ders karşılığı.
  let heroSub;
  if (isWeek) heroSub = capacity ? `${it.planned}/${capacity} ders dolu` : `${it.planned} ders planlı`;
  else heroSub = `haftalık ortalama · ${it.completed} ders işlendi`;

  // Grafik-detay satırı — seçili dönemin boş slot dökümü.
  let bos;
  if (!capacity) bos = `${it.planned} ders`;
  else if (isWeek) bos = `${it.planned} ders · ${Math.max(0, capacity - it.planned)} boş slot`;
  else bos = `${it.planned} ders · ort. ${Math.max(0, Math.round((capacity * (100 - it.pct)) / 100))} boş/hafta`;

  // Trend rozeti: seçili bar ile bir önceki bar arasındaki puan farkı.
  const prevBar = series[idx - 1];
  const deltaPuan = prevBar ? it.pct - prevBar.pct : null;

  return {
    full: it.full,
    pct: it.pct,
    planned: it.planned,
    completed: it.completed,
    cancelled: it.cancelled,
    revenue: it.revenue,
    eyebrow: `${periodLabel} doluluk`,
    tagLabel,
    sub,
    heroSub,
    bos,
    deltaPuan,
    deltaDown: deltaPuan != null && deltaPuan < 0,
  };
}

const OCC_CELL_CLS = ['is-miss', 'is-ok', 'is-plan', 'is-off'];
const OCC_CELL_LBL = ['kaçırdı', 'geldi', 'planlı', 'ders yok'];

const BackIc = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
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

// Yoklama hücresi ikonu: geldi (✓) · kaçırdı (✕) · planlı (takvim) · ders yok (–).
function CellIcon({ s }) {
  if (s === 1) {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (s === 0) {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    );
  }
  if (s === 2) {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="3" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="16" y1="2" x2="16" y2="6" />
      </svg>
    );
  }
  return <i className="dd2-dash" />;
}

export function MobileOccupancy({ onBack }) {
  const [period, setPeriod] = React.useState('hafta');
  const [sel, setSel] = React.useState(null);

  // Dönem değişince seçimi sıfırla (varsayılan = son/cari bar).
  React.useEffect(() => { setSel(null); }, [period]);

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.occupancyFlow(),
    queryFn: getOccupancyFlow,
    staleTime: 2 * 60 * 1000,
  });

  const capacity = data ? num(data.capacity) : 0;
  const p = React.useMemo(() => (data ? derivePeriod(data, period) : null), [data, period]);

  // Dönem değişince `sel` bir sonraki render'a kadar eski (olası sınır dışı)
  // indeksi tutar — hafta serisi 8, ay serisi 6 barlı. Yeni serinin son barına
  // kıstır ki seçili bar asla undefined olmasın (aksi halde "Ay"a basınca boş ekran).
  const selIndex = p ? Math.min(sel ?? p.series.length - 1, p.series.length - 1) : 0;
  const view = React.useMemo(
    () => (p && data ? deriveView(p, selIndex, capacity, data.today) : null),
    [p, data, selIndex, capacity],
  );

  // Yoklama tablosu başlık etiketleri — son 6 haftanın kısa etiketi (dönemden
  // bağımsız; roster her zaman haftalıktır).
  const weekCols = React.useMemo(() => {
    if (!data) return [];
    return data.week.series.slice(-6).map((b) => weekBarLabels(b.start, b.current).lbl);
  }, [data]);
  const roster = data?.roster ?? [];

  return (
    <div className="fin fax occ" data-screen-label="occupancy">
      <header className="fax-head">
        <button className="fax-back" aria-label="Geri" onClick={onBack} type="button"><BackIc /></button>
        <div className="fax-head-mid">
          <h1 className="fax-title">Doluluk</h1>
          <span className="fax-sub">{view ? view.sub : ' '}</span>
        </div>
        <div className="fax-seg" role="tablist" aria-label="Dönem seçimi">
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
        <section className="fax-card"><div className="fax-mv-empty">Doluluk verisi yüklenemedi.</div></section>
      ) : isLoading || !p || !view ? (
        <OccupancySkeleton />
      ) : (
        <>
          {/* Hero — seçili dönemin % doluluğu + haftalık % sütun grafiği */}
          <section className="fax-card fa1-hero">
            <span className="fax-eyebrow">{view.eyebrow}</span>
            <div className="fax-hero-row">
              <span key={period + '-' + selIndex} className="fax-hero-val fax-anim">%{view.pct}</span>
              {view.deltaPuan != null && (
                <span className={'fax-delta' + (view.deltaDown ? ' is-down' : '')}>
                  <TrendIc down={view.deltaDown} /> {view.deltaPuan > 0 ? '+' : ''}{view.deltaPuan} puan
                </span>
              )}
            </div>
            <span className="fax-hero-sub">{view.heroSub}</span>

            <div key={period + '-chart'} className="osx-chart fax-anim-soft">
              {p.series.map((it, i) => (
                <button
                  key={it.id}
                  type="button"
                  className={'osx-col' + (selIndex === i ? ' is-sel' : '') + (it.current ? ' is-cur' : '')}
                  onClick={() => setSel(i)}
                  aria-label={it.full + ' yüzde ' + it.pct + ' dolu · ' + it.planned + ' ders'}
                >
                  <span className="osx-pct">{it.pct}</span>
                  <span className="osx-track"><i style={{ height: it.pct + '%' }} /></span>
                  <span className="fax-bar-lbl">{it.lbl}</span>
                </button>
              ))}
            </div>
            <div className="osx-cap-note">
              {p.isWeek ? `son 8 hafta · tavan %100 = ${capacity || '—'} ders` : 'son 6 ay · haftalık ortalama %'}
            </div>

            <div className="fax-chart-detail">
              <span className="fax-chart-week">{view.full}</span>
              <span className="fax-chart-meta">{view.bos}</span>
              <span className="fax-chart-val">%{view.pct}</span>
            </div>
          </section>

          {/* KPI çifti — seçili döneme göre; rozet hangi dönem olduğunu söyler */}
          <section className="fax-pair">
            <div className="fax-mini fax-mini-blue">
              <div className="fax-mini-top">
                <span className="fax-mini-k">Ders cirosu</span>
                <span className="fax-mini-tag">{view.tagLabel}</span>
              </div>
              <span key={period + '-k1-' + selIndex} className="fax-mini-v fax-anim">{fmtTL(view.revenue)}</span>
              <span className="fax-mini-s">{view.completed}/{view.planned} ders işlendi</span>
            </div>
            <div className="fax-mini fax-mini-amber">
              <div className="fax-mini-top">
                <span className="fax-mini-k">Öğrenci iptali</span>
                <span className="fax-mini-tag">{view.tagLabel}</span>
              </div>
              <span key={period + '-k2-' + selIndex} className="fax-mini-v fax-anim">{view.cancelled}</span>
              {/* Talep gereği bu kartta alt açıklama (fax-mini-s) gösterilmez. */}
            </div>
          </section>

          {/* Temposu düşenler — haftalık yoklama tablosu (dönemden bağımsız) */}
          <section className="fax-card">
            <div className="fax-card-head">
              <h2 className="fax-card-title">Temposu düşenler</h2>
              <span className="fax-card-note">son 6 hafta · yoklama</span>
            </div>
            {roster.length === 0 ? (
              <div className="fax-mv-empty">Şu an temposu düşen öğrenci yok.</div>
            ) : (
              <>
                <div className="dd2-grid" role="table" aria-label="Haftalık yoklama">
                  <div className="dd2-hrow" role="row">
                    <span className="dd2-hname">Öğrenci</span>
                    {weekCols.map((w, i) => <span key={i} className="dd2-hcell">{w}</span>)}
                  </div>
                  {roster.map((o) => (
                    <div key={o.name} className="dd2-row" role="row">
                      <span className="dd2-name">
                        <span className="dd2-nm">{o.name}</span>
                        <span className="dd2-slot">{o.slot}</span>
                      </span>
                      {o.att.map((s, i) => (
                        <span key={i} className={'dd2-cell ' + (OCC_CELL_CLS[s] || 'is-off')} aria-label={(weekCols[i] || '') + ' ' + (OCC_CELL_LBL[s] || '')}>
                          <CellIcon s={s} />
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="dd2-legend">
                  <span className="dd2-legend-it"><span className="dd2-key is-ok" /> geldi</span>
                  <span className="dd2-legend-it"><span className="dd2-key is-miss" /> kaçırdı</span>
                  <span className="dd2-legend-it"><span className="dd2-key is-plan" /> planlı</span>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function OccupancySkeleton() {
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
