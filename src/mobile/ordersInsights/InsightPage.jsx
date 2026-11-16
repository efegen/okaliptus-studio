// Pazaryeri özeti detay ekranları (Siparişler ekranı içinde tam ekran katman).
// view: 'kalan' (nereye gitti) · 'cok' (en çok satanlar) · 'satis' (gün gün) · 'odeme'
// Tasarım: "Siparişler mini dashboard" tuvalindeki Kalan / CokSatan / Satis / Odemeler.
// channels: özetteki kanallar (Trendyol, Hepsiburada ya da ikisi). İkisi birlikteyse
// byChannel kanal başına özetleri taşır (kanallara göre döküm).

import React from 'react';
import { ChannelTag, ProductThumb, SegmentBar } from './InsightsStrip';
import {
  CHANNEL_NAMES, SEGMENT_COLORS, approxTL, breakdownRows, channelList, dayKeyToMs, dayNumber, deltaLong,
  fmtDayMonth, fmtPct, fmtTL, fmtWeekdayDate, isEstimated, periodLabel, rangeLabel, scopeLabel,
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

// Tek kanal → 'trendyol' | 'hepsiburada'; birden çok → null.
function onlyChannel(channels) {
  return channels?.length === 1 ? channels[0] : null;
}

// Kanal adı (tek kanal) ya da genel "Pazaryeri".
function sellerName(channels) {
  const ch = onlyChannel(channels);
  return ch ? CHANNEL_NAMES[ch] : 'Pazaryeri';
}

// ── Sana kalan: nereye gitti? ────────────────────────────────────────────────
function rowSub(key, b, channels) {
  const ch = onlyChannel(channels);
  switch (key) {
    case 'komisyon':
      if (!ch) return 'Kanal ve kategori oranlarına göre';
      if (b.avgCommissionRate == null) return 'Satırdaki orandan';
      return `Ortalama ${fmtPct(b.avgCommissionRate)}${b.commissionVatAdded ? ' + KDV' : ''}`;
    case 'kargo':
      return b.cargoPackages > 0
        ? `${b.cargoPackages} paket${b.avgCargo != null ? `, paket başı ${fmtTL(b.avgCargo)}` : ''}`
        : 'Paket yok';
    case 'kdv': return 'Devlete ödenecek';
    case 'diger':
      return ch === 'hepsiburada' ? 'İşlem ve ödeme hizmet bedeli' : `${sellerName(channels)} faturaları`;
    case 'stopaj': return 'Vergiden düşülür';
    default: return '';
  }
}

function rowDetail(key, b, channels) {
  const ch = onlyChannel(channels);
  const seller = sellerName(channels);
  switch (key) {
    case 'komisyon':
      if (ch === 'trendyol') {
        return `Komisyon ürün kategorisine göre değişiyor. Teslim edilen ${b.settledOrders} siparişte Trendyol'un ekstreye yazdığı tutar, kalan ${b.estimatedOrders} siparişte sipariş anındaki orandan tahmin.`;
      }
      if (ch === 'hepsiburada') {
        return `Komisyon ürün kategorisine göre değişiyor; oran KDV hariç, Hepsiburada faturaya KDV ekler. Kaydı gelen ${b.settledOrders} siparişte Hepsiburada'nın yazdığı tutar, kalan ${b.estimatedOrders} siparişte satırdaki orandan tahmin.`;
      }
      return `Komisyon kanala ve ürün kategorisine göre değişiyor. Kesinleşen ${b.settledOrders} siparişte pazaryerinin yazdığı tutar, kalan ${b.estimatedOrders} siparişte sipariş anındaki orandan tahmin.`;
    case 'kargo':
      if (ch === 'trendyol') {
        return 'Trendyol\'un kestiği kargo faturasından, paket paket. Faturası henüz kesilmemiş paketler için bilinen paketlerin ortalaması kullanılır.';
      }
      if (ch === 'hepsiburada') {
        return 'Hepsiburada\'nın kestiği kargo katılım payından, sipariş sipariş. Henüz kesilmemiş olanlar için bilinen siparişlerin ortalaması kullanılır.';
      }
      return 'Pazaryerlerinin kestiği kargo bedelinden, paket paket. Henüz kesilmemiş olanlar için bilinen paketlerin ortalaması kullanılır.';
    case 'kdv':
      return `Satışlardaki KDV ${fmtTL(b.vat.sales)}. Komisyon, kargo ve hizmet faturalarındaki ${fmtTL(b.vat.deductible)} KDV'yi bundan düşebilirsin. ${seller} bunu kesmez: hesabına yatan paranın içindedir, beyannamede ödenir.`;
    case 'diger':
      if (ch === 'trendyol') return 'Bu dönemde kesilen platform hizmet bedeli, reklam gibi kargo dışı Trendyol faturaları.';
      if (ch === 'hepsiburada') {
        return 'Sipariş başına kesilen işlem bedeli ve ödeme hizmet bedeli, ayrıca bu dönemde kesilen siparişe bağlı olmayan Hepsiburada faturaları.';
      }
      return 'Trendyol\'un hizmet bedeli, reklam gibi kargo dışı faturaları ile Hepsiburada\'nın işlem ve ödeme hizmet bedelleri.';
    case 'stopaj':
      return `E-ticaret stopajı (KDV hariç tutarın %1'i). ${seller} ödemeden keser; yıllık gelir vergisinden mahsup edilir.`;
    default:
      return '';
  }
}

function FinanceNotes({ b }) {
  const missing = b.financeMissing ?? [];
  if (missing.length > 0 || !b.financeAvailable) {
    const who = missing.length > 0 ? channelList(missing) : 'Pazaryeri';
    return (
      <section className="moi-note moi-note-warn" role="status">
        <b>{who} kesinti kayıtları şu an alınamadı.</b> Komisyon satırdaki orandan tahmin; kargo ve diğer kesintiler eksik olabilir.
      </section>
    );
  }
  if (b.estimatedOrders > 0) {
    return (
      <section className="moi-note" role="status">
        <b>{b.estimatedOrders} siparişin kesintileri henüz kesinleşmedi.</b> Pazaryeri komisyonu ve kargoyu teslimattan sonra yazıyor; şimdilik tahmin. Teslim edildikçe rakam kesinleşir.
      </section>
    );
  }
  return null;
}

function ByChannel({ byChannel, channels }) {
  const rows = channels.map(ch => ({ ch, d: byChannel?.[ch] })).filter(r => r.d);
  if (rows.length < 2) return null;
  return (
    <section className="moi-sect moi-list">
      <h2 className="moi-h2">Kanallara göre</h2>
      {rows.map(({ ch, d }) => (
        <div key={ch} className="moi-kv">
          <span className="moi-kv-main">
            <ChannelTag channel={ch} />
            <span className="moi-xrow-sub">{fmtTL(d.breakdown.sales)} satış · {d.sales.orders} sipariş</span>
          </span>
          <span className="moi-xrow-amt">
            <span className="moi-green">{approxTL(d.breakdown.remaining, isEstimated(d))}</span>
            <span className="moi-xrow-sub">{fmtPct(d.breakdown.remainingPct)}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

function KalanView({ data, channels, byChannel }) {
  const [open, setOpen] = React.useState(null);
  const b = data.breakdown;
  const estimated = isEstimated(data);
  const rows = breakdownRows(b, channels);
  const per100 = b.remainingPct != null ? b.remainingPct : null;
  return (
    <>
      <section className="moi-sect moi-hero">
        <div className="moi-hero-label">{fmtTL(b.sales)} satıştan sana kalan</div>
        <div className="moi-hero-value moi-green">{approxTL(b.remaining, estimated)}</div>
        {per100 != null && <div className="moi-hero-sub">Her 100 ₺'lik satışın {per100} ₺'si</div>}
        <SegmentBar breakdown={b} className="moi-bar-lg" />
      </section>

      <FinanceNotes b={b} />

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
                  <span className="moi-xrow-sub">{rowSub(r.key, b, channels)}</span>
                </span>
                <span className="moi-xrow-amt">
                  <span>{r.amount > 0 ? `−${fmtTL(r.amount)}` : fmtTL(0)}</span>
                  <span className="moi-xrow-sub">{fmtPct(r.pct)}</span>
                </span>
                {chevDown(isOpen)}
              </button>
              {isOpen && <p className="moi-xrow-detail">{rowDetail(r.key, b, channels)}</p>}
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

      <ByChannel byChannel={byChannel} channels={channels} />

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
function SatisView({ data, period, channels, byChannel }) {
  const daily = data.sales.daily ?? [];
  const lastKey = daily.length > 0 ? daily[daily.length - 1].date : null;
  const [sel, setSel] = React.useState(lastKey);
  const selDay = daily.find(d => d.date === sel) ?? daily[daily.length - 1];
  const max = Math.max(1, ...daily.map(d => d.total));
  const s = data.sales;
  const todayIsLast = !data.range.complete;
  const dense = daily.length > 16;
  const perChannel = channels.map(ch => ({ ch, d: byChannel?.[ch] })).filter(r => r.d);
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
        {perChannel.length > 1 && perChannel.map(({ ch, d }) => (
          <div key={ch} className="moi-kv">
            <ChannelTag channel={ch} />
            <span><b>{fmtTL(d.sales.total)}</b> · {d.sales.orders} sipariş</span>
          </div>
        ))}
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
const PAY_FOOT = {
  trendyol: 'Trendyol genelde çarşamba öder. Sıradaki ödeme, teslim edilmiş siparişlerin hakedişinden bilinen kargo bedeli düşülerek hesaplanır. KDV Trendyol\'dan kesilmez: yatan paranın içindedir, beyannamede ödenir.',
  hepsiburada: 'Hepsiburada her salı öder: vadesi gelen satışlardan komisyon, kargo, işlem bedeli ve stopaj düşülür; toplam eksiye düşerse ödeme sonraki salıya kalır. KDV kesilmez: yatan paranın içindedir, beyannamede ödenir.',
  all: 'Trendyol genelde çarşamba, Hepsiburada salı öder. Tutarlar teslim edilmiş siparişlerin hakedişinden bilinen kesintiler düşülerek hesaplanır. KDV kesilmez: yatan paranın içindedir, beyannamede ödenir.',
};

function QueueRow({ item, multi }) {
  const name = CHANNEL_NAMES[item.channel] ?? 'Pazaryeri';
  const label = item.kind === 'later'
    ? (multi ? `${name}, sonraki ödeme günleri` : 'Sonraki ödeme günleri')
    : `${name} ödemesi`;
  const when = item.kind === 'later' ? `${fmtDayMonth(item.date)} ve sonrası` : fmtWeekdayDate(item.date);
  return (
    <div className="moi-kv">
      <span className="moi-kv-main"><span>{label}</span><span className="moi-xrow-sub">{item.orders} sipariş · {when}</span></span>
      <b>{approxTL(item.amount, true)}</b>
    </div>
  );
}

function OdemeView({ data, channels }) {
  const p = data.payments;
  const [open, setOpen] = React.useState(p.past[0] ? `${p.past[0].channel ?? ''}:${p.past[0].id}` : null);
  const multi = channels.length > 1;
  const missing = data.breakdown.financeMissing ?? [];
  if (!p.available) {
    return (
      <section className="moi-note moi-note-warn" role="status">
        <b>{multi ? 'Ödeme kayıtları' : `${sellerName(channels)} ödeme kayıtları`} şu an alınamadı.</b> Ödemeler pazaryerinin hesap kayıtlarından okunuyor; biraz sonra tekrar dene.
      </section>
    );
  }
  const queue = p.queue ?? [p.next && { ...p.next, kind: 'next' }, p.later && { ...p.later, kind: 'later' }].filter(Boolean);
  const waiting = queue.slice(1);
  return (
    <>
      <section className="moi-sect moi-hero">
        <div className="moi-hero-label">Sıradaki ödeme</div>
        {p.next ? (
          <>
            <div className="moi-hero-value">{approxTL(p.next.amount, true)}</div>
            <div className="moi-hero-sub">{fmtWeekdayDate(p.next.date)} · {p.next.orders} sipariş</div>
            {multi && p.next.channel && <div className="moi-hero-sub"><ChannelTag channel={p.next.channel} /></div>}
          </>
        ) : (
          <>
            <div className="moi-hero-value">—</div>
            <div className="moi-hero-sub">Ödeme günü bekleyen teslim edilmiş sipariş yok</div>
          </>
        )}
      </section>

      {missing.length > 0 && (
        <section className="moi-note moi-note-warn" role="status">
          <b>{channelList(missing)} ödeme kayıtları şu an alınamadı.</b> Aşağıdaki liste eksik olabilir.
        </section>
      )}

      <section className="moi-sect moi-list">
        <h2 className="moi-h2">Sırada bekleyen</h2>
        {waiting.map(item => <QueueRow key={`${item.channel}:${item.kind}:${item.date}`} item={item} multi={multi} />)}
        <div className="moi-kv">
          <span className="moi-kv-main"><span>Henüz ödemeye yansımadı</span><span className="moi-xrow-sub">{p.notDelivered.orders} sipariş · tutar tahmini</span></span>
          <b>{approxTL(p.notDelivered.amount, true)}</b>
        </div>
      </section>

      <section className="moi-sect">
        <h2 className="moi-h2">Hesaba yatanlar</h2>
        {p.past.length === 0 && <p className="moi-xrow-sub">Son iki ayda ödeme kaydı yok.</p>}
        {p.past.map(x => {
          const key = `${x.channel ?? ''}:${x.id}`;
          const isOpen = open === key;
          const hasBreakdown = x.sales != null;
          const sub = [multi ? CHANNEL_NAMES[x.channel] : null, x.orders != null ? `${x.orders} sipariş` : null].filter(Boolean).join(' · ');
          return (
            <div key={key || x.date} className="moi-xrow">
              <button
                type="button"
                className="moi-xrow-btn"
                aria-expanded={hasBreakdown ? isOpen : undefined}
                onClick={() => hasBreakdown && setOpen(isOpen ? null : key)}
              >
                <span className="moi-paid-ic" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>
                </span>
                <span className="moi-xrow-main">
                  <span className="moi-xrow-label">{fmtWeekdayDate(x.date)}</span>
                  {sub && <span className="moi-xrow-sub">{sub}</span>}
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

      <p className="moi-foot">{PAY_FOOT[onlyChannel(channels) ?? 'all']}</p>
    </>
  );
}

export function InsightPage({ view, period, data, channels = [], byChannel = null, onBack }) {
  const range = data ? rangeLabel(period, data.range) : '';
  return (
    <div className="moi-page" role="dialog" aria-modal="true" aria-label={TITLES[view]}>
      <header className="mo-top">
        <button type="button" className="mo-top-back" aria-label="Siparişlere dön" onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <div className="mo-top-title">
          <h1>{TITLES[view]}</h1>
          <p>{scopeLabel(channels)} · {view === 'odeme' ? 'Hesaba yatan' : `${periodLabel(period)}${range ? `, ${range}` : ''}`}</p>
        </div>
      </header>
      <div className="moi-page-scroll">
        {!data ? (
          <p className="moi-foot">Yükleniyor…</p>
        ) : view === 'kalan' ? <KalanView data={data} channels={channels} byChannel={byChannel} />
          : view === 'cok' ? <CokView data={data} />
            : view === 'satis' ? <SatisView data={data} period={period} channels={channels} byChannel={byChannel} />
              : <OdemeView data={data} channels={channels} />}
      </div>
    </div>
  );
}
