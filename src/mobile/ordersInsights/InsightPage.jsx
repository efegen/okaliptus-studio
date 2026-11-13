// Trendyol özeti detay ekranları (Siparişler ekranı içinde tam ekran katman).
// view: 'kalan' (nereye gitti) · 'cok' (en çok satanlar) · 'satis' (gün gün) · 'odeme'
// Tasarım: "Siparişler mini dashboard" tuvalindeki Kalan / CokSatan / Satis / Odemeler.

import React from 'react';
import { ProductThumb, SegmentBar } from './InsightsStrip';
import {
  SEGMENT_COLORS, approxTL, breakdownRows, dayKeyToMs, dayNumber, deltaLong, fmtDayMonth,
  fmtPct, fmtTL, fmtWeekdayDate, isEstimated, periodLabel, rangeLabel,
} from './insightsFormat';

const TITLES = {
  kalan: 'Sana kalan',
  cok: 'En çok satanlar',
  satis: 'Satış',
  odeme: 'Ödemeler',
};

const chevDown = (open) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={'moi-chev' + (open ? ' open' : '')}><path d="m6 9 6 6 6-6" /></svg>
);

// ── Sana kalan: nereye gitti? ────────────────────────────────────────────────
const ROW_SUB = {
  komisyon: (b) => (b.avgCommissionRate != null ? `Ortalama ${fmtPct(b.avgCommissionRate)}` : 'Satırdaki orandan'),
  kargo: (b) => (b.cargoPackages > 0
    ? `${b.cargoPackages} paket${b.avgCargo != null ? `, paket başı ${fmtTL(b.avgCargo)}` : ''}`
    : 'Paket yok'),
  kdv: () => 'Devlete ödenecek',
  diger: () => 'Trendyol faturaları',
  stopaj: () => 'Vergiden düşülür',
};

const ROW_DETAIL = {
  komisyon: (b) => `Komisyon ürün kategorisine göre değişiyor. Teslim edilen ${b.settledOrders} siparişte Trendyol'un ekstreye yazdığı tutar, kalan ${b.estimatedOrders} siparişte sipariş anındaki orandan tahmin.`,
  kargo: () => 'Trendyol\'un kestiği kargo faturasından, paket paket. Faturası henüz kesilmemiş paketler için bilinen paketlerin ortalaması kullanılır.',
  kdv: (b) => `Satışlardaki KDV ${fmtTL(b.vat.sales)}. Komisyon, kargo ve hizmet faturalarındaki ${fmtTL(b.vat.deductible)} KDV'yi bundan düşebilirsin. Trendyol bunu kesmez: hesabına yatan paranın içindedir, beyannamede ödenir.`,
  diger: () => 'Bu dönemde kesilen platform hizmet bedeli, reklam gibi kargo dışı Trendyol faturaları.',
  stopaj: () => 'E-ticaret stopajı (KDV hariç tutarın %1\'i). Trendyol ödemeden keser; yıllık gelir vergisinden mahsup edilir.',
};

function KalanView({ data }) {
  const [open, setOpen] = React.useState(null);
  const b = data.breakdown;
  const estimated = isEstimated(data);
  const rows = breakdownRows(b);
  const per100 = b.remainingPct != null ? b.remainingPct : null;
  return (
    <>
      <section className="moi-sect moi-hero">
        <div className="moi-hero-label">{fmtTL(b.sales)} satıştan sana kalan</div>
        <div className="moi-hero-value moi-green">{approxTL(b.remaining, estimated)}</div>
        {per100 != null && <div className="moi-hero-sub">Her 100 ₺'lik satışın {per100} ₺'si</div>}
        <SegmentBar breakdown={b} className="moi-bar-lg" />
      </section>

      {!b.financeAvailable ? (
        <section className="moi-note moi-note-warn" role="status">
          <b>Trendyol cari hesap ekstresi şu an alınamadı.</b> Komisyon satırdaki orandan tahmin; kargo ve diğer kesintiler eksik olabilir.
        </section>
      ) : b.estimatedOrders > 0 ? (
        <section className="moi-note" role="status">
          <b>{b.estimatedOrders} sipariş henüz teslim edilmedi.</b> Trendyol bunların komisyonunu ve kargosunu teslimattan sonra yazıyor; şimdilik tahmin. Teslim edildikçe rakam kesinleşir.
        </section>
      ) : null}

      <section className="moi-sect">
        <h2 className="moi-h2">Nereye gitti?</h2>
        {rows.map(r => {
          const isOpen = open === r.key;
          return (
            <div key={r.key} className="moi-xrow">
              <button type="button" className="moi-xrow-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.key)}>
                <span className="moi-dot" style={{ background: SEGMENT_COLORS[r.key] }} />
                <span className="moi-xrow-main">
                  <span className="moi-xrow-label">{r.label}</span>
                  <span className="moi-xrow-sub">{ROW_SUB[r.key](b)}</span>
                </span>
                <span className="moi-xrow-amt">
                  <span>{r.amount > 0 ? `−${fmtTL(r.amount)}` : fmtTL(0)}</span>
                  <span className="moi-xrow-sub">{fmtPct(r.pct)}</span>
                </span>
                {chevDown(isOpen)}
              </button>
              {isOpen && <p className="moi-xrow-detail">{ROW_DETAIL[r.key](b)}</p>}
            </div>
          );
        })}
        <div className="moi-total">
          <span className="moi-dot" style={{ background: SEGMENT_COLORS.kalan }} />
          <span className="moi-total-label">Sana kalan</span>
          <span className="moi-xrow-amt">
            <span className="moi-green">{approxTL(b.remaining, estimated)}</span>
            <span className="moi-xrow-sub">{fmtPct(b.remainingPct)}</span>
          </span>
        </div>
      </section>

      <p className="moi-foot">Ürünlerin alış maliyeti bu hesapta yok; bu tutar kâr değil, satıştan sonra elinde kalan.</p>
    </>
  );
}

// ── En çok satanlar ──────────────────────────────────────────────────────────
function CokView({ data }) {
  const [mode, setMode] = React.useState('adet');
  const list = React.useMemo(() => {
    const items = [...(data.products?.top ?? [])];
    items.sort((a, b) => (mode === 'adet' ? b.quantity - a.quantity || b.total - a.total : b.total - a.total || b.quantity - a.quantity));
    return items;
  }, [data, mode]);
  const max = Math.max(1, ...list.map(p => (mode === 'adet' ? p.quantity : p.total)));
  return (
    <>
      <div className="moi-seg" role="group" aria-label="Sıralama">
        {[['adet', 'Adete göre'], ['tutar', 'Tutara göre']].map(([k, l]) => (
          <button key={k} type="button" className={'moi-seg-btn' + (mode === k ? ' on' : '')} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="moi-foot">Bu dönemde satış yok.</p>
      ) : (
        <ol className="moi-rank">
          {list.map((p, i) => {
            const v = mode === 'adet' ? p.quantity : p.total;
            return (
              <li key={p.key} className="moi-rank-row">
                <span className="moi-rank-no">{i + 1}</span>
                <ProductThumb src={p.imageUrl} alt={p.name} className="moi-rank-thumb" />
                <span className="moi-rank-main">
                  <span className="moi-row">
                    <span className="moi-ellipsis moi-rank-name">{p.name}</span>
                    <b className="moi-rank-val">{mode === 'adet' ? `${p.quantity} adet` : fmtTL(p.total)}</b>
                  </span>
                  <span className="moi-rank-track" aria-hidden="true"><span style={{ width: `${(v / max) * 100}%` }} /></span>
                  <span className="moi-xrow-sub">{mode === 'adet' ? fmtTL(p.total) : `${p.quantity} adet`}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {list.length > 0 && (
        <p className="moi-foot">
          {data.products.count} üründen {data.sales.units} adet satıldı{data.products.count > list.length ? ` (ilk ${list.length} ürün listelendi)` : ''}. İptal edilen siparişler sayılmaz.
        </p>
      )}
    </>
  );
}

// ── Satış: gün gün ───────────────────────────────────────────────────────────
function SatisView({ data, period }) {
  const daily = data.sales.daily ?? [];
  const lastKey = daily.length > 0 ? daily[daily.length - 1].date : null;
  const [sel, setSel] = React.useState(lastKey);
  const selDay = daily.find(d => d.date === sel) ?? daily[daily.length - 1];
  const max = Math.max(1, ...daily.map(d => d.total));
  const s = data.sales;
  const todayIsLast = !data.range.complete;
  const dense = daily.length > 16;
  return (
    <>
      <section className="moi-sect moi-hero">
        <div className="moi-hero-label">{periodLabel(period)} satış</div>
        <div className="moi-hero-value">{fmtTL(s.total)}</div>
        <div className="moi-hero-sub">{s.orders} sipariş, {s.units} ürün</div>
        {s.deltaPct != null && (
          <span className={'moi-pill ' + (s.deltaPct >= 0 ? 'moi-pill-up' : 'moi-pill-down')}>{deltaLong(s.deltaPct, period)}</span>
        )}
      </section>

      {daily.length > 0 && selDay && (
        <section className="moi-sect">
          <div className="moi-row moi-baseline">
            <h2 className="moi-h2">Gün gün</h2>
            <span className="moi-xrow-sub">Bir güne dokun</span>
          </div>
          <div className="moi-daysel">
            <span>{todayIsLast && selDay.date === lastKey ? `Bugün, ${fmtWeekdayDate(dayKeyToMs(selDay.date))}` : fmtWeekdayDate(dayKeyToMs(selDay.date))}</span>
            <span><b>{fmtTL(selDay.total)}</b> · {selDay.orders} sipariş</span>
          </div>
          <div className={'moi-days' + (dense ? ' dense' : '')}>
            {daily.map(d => {
              const on = d.date === selDay.date;
              const n = dayNumber(d.date);
              return (
                <button
                  key={d.date}
                  type="button"
                  className={'moi-day' + (on ? ' on' : '')}
                  aria-pressed={on}
                  aria-label={`${fmtDayMonth(dayKeyToMs(d.date))}, ${fmtTL(d.total)}`}
                  onClick={() => setSel(d.date)}
                >
                  <span className="moi-day-bar" style={{ height: `${Math.max(3, (d.total / max) * 100)}%` }} />
                  <span className="moi-day-no">{!dense || on || n === 1 || n % 5 === 0 ? n : ''}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="moi-sect moi-list">
        <div className="moi-kv"><span>Ortalama sipariş</span><b>{fmtTL(s.avgOrder)}</b></div>
        <div className="moi-kv"><span>Satılan ürün</span><b>{s.units} adet</b></div>
        <div className="moi-kv"><span>İptal edilen</span><span>{s.cancelled.orders} sipariş{s.cancelled.orders > 0 && <> · <b className="moi-down">{fmtTL(s.cancelled.total)}</b></>}</span></div>
        <div className="moi-kv"><span>İade edilen</span><span>{s.returned.orders} sipariş{s.returned.orders > 0 && <> · <b className="moi-down">{fmtTL(s.returned.total)}</b></>}</span></div>
      </section>

      <p className="moi-foot">Satış, müşterinin ödediği tutardır (KDV dahil). İptal ve iadeler düşülmüştür; ödeme onayı bekleyen siparişler sayılmaz.</p>
    </>
  );
}

// ── Ödemeler ─────────────────────────────────────────────────────────────────
function OdemeView({ data }) {
  const p = data.payments;
  const [open, setOpen] = React.useState(p.past[0]?.id ?? null);
  if (!p.available) {
    return (
      <section className="moi-note moi-note-warn" role="status">
        <b>Trendyol cari hesap ekstresi şu an alınamadı.</b> Ödemeler ekstreden okunuyor; biraz sonra tekrar dene.
      </section>
    );
  }
  return (
    <>
      <section className="moi-sect moi-hero">
        <div className="moi-hero-label">Sıradaki ödeme</div>
        {p.next ? (
          <>
            <div className="moi-hero-value">{approxTL(p.next.amount, true)}</div>
            <div className="moi-hero-sub">{fmtWeekdayDate(p.next.date)} · {p.next.orders} sipariş</div>
          </>
        ) : (
          <>
            <div className="moi-hero-value">—</div>
            <div className="moi-hero-sub">Ödeme günü bekleyen teslim edilmiş sipariş yok</div>
          </>
        )}
      </section>

      <section className="moi-sect moi-list">
        <h2 className="moi-h2">Sırada bekleyen</h2>
        {p.later && (
          <div className="moi-kv">
            <span className="moi-kv-main"><span>Sonraki ödeme günleri</span><span className="moi-xrow-sub">{p.later.orders} sipariş · {fmtDayMonth(p.later.date)} ve sonrası</span></span>
            <b>{approxTL(p.later.amount, true)}</b>
          </div>
        )}
        <div className="moi-kv">
          <span className="moi-kv-main"><span>Henüz teslim edilmedi</span><span className="moi-xrow-sub">{p.notDelivered.orders} sipariş · tutar tahmini</span></span>
          <b>{approxTL(p.notDelivered.amount, true)}</b>
        </div>
      </section>

      <section className="moi-sect">
        <h2 className="moi-h2">Hesaba yatanlar</h2>
        {p.past.length === 0 && <p className="moi-xrow-sub">Son iki ayda ödeme kaydı yok.</p>}
        {p.past.map(x => {
          const isOpen = open === x.id;
          const hasBreakdown = x.sales != null;
          return (
            <div key={x.id || x.date} className="moi-xrow">
              <button
                type="button"
                className="moi-xrow-btn"
                aria-expanded={hasBreakdown ? isOpen : undefined}
                onClick={() => hasBreakdown && setOpen(isOpen ? null : x.id)}
              >
                <span className="moi-paid-ic" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>
                </span>
                <span className="moi-xrow-main">
                  <span className="moi-xrow-label">{fmtWeekdayDate(x.date)}</span>
                  {x.orders != null && <span className="moi-xrow-sub">{x.orders} sipariş</span>}
                </span>
                <span className="moi-xrow-amt"><span>{fmtTL(x.amount)}</span></span>
                {hasBreakdown ? chevDown(isOpen) : <span className="moi-chev-space" />}
              </button>
              {isOpen && hasBreakdown && (
                <div className="moi-paid-detail">
                  <div className="moi-kv-sm"><span>Satış</span><span>{fmtTL(x.sales)}</span></div>
                  <div className="moi-kv-sm"><span>Komisyon</span><span>−{fmtTL(x.commission)}</span></div>
                  <div className="moi-kv-sm"><span>Kargo ve diğer kesintiler</span><span>−{fmtTL(x.deductions)}</span></div>
                  <div className="moi-kv-sm moi-kv-total"><span>Hesaba yatan</span><span>{fmtTL(x.amount)}</span></div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <p className="moi-foot">Trendyol genelde çarşamba öder. Sıradaki ödeme, teslim edilmiş siparişlerin hakedişinden bilinen kargo bedeli düşülerek hesaplanır. KDV Trendyol'dan kesilmez: yatan paranın içindedir, beyannamede ödenir.</p>
    </>
  );
}

export function InsightPage({ view, period, data, onBack }) {
  const range = data ? rangeLabel(period, data.range) : '';
  return (
    <div className="moi-page" role="dialog" aria-modal="true" aria-label={TITLES[view]}>
      <header className="mo-top">
        <button type="button" className="mo-top-back" aria-label="Siparişlere dön" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <div className="mo-top-title">
          <h1>{TITLES[view]}</h1>
          <p>Trendyol · {view === 'odeme' ? 'Hesaba yatan' : `${periodLabel(period)}${range ? `, ${range}` : ''}`}</p>
        </div>
      </header>
      <div className="moi-page-scroll">
        {!data ? (
          <p className="moi-foot">Yükleniyor…</p>
        ) : view === 'kalan' ? <KalanView data={data} />
          : view === 'cok' ? <CokView data={data} />
            : view === 'satis' ? <SatisView data={data} period={period} />
              : <OdemeView data={data} />}
      </div>
    </div>
  );
}
