// Siparişler ekranının üstündeki Trendyol özeti (tasarım: "Siparişler mini dashboard"
// tuvali, C6). Dönem düğmeleri + yatay kaydırılan 4 kart:
//   Sana kalan · En çok satanlar (ürün fotoğrafları) · Sipariş · Sıradaki ödeme
// Kartlar ilgili detay ekranını açar (onOpen('kalan' | 'cok' | 'satis' | 'odeme')).
// Veri: GET /trendyol/insights (MobileOrders sorgular, buraya prop olarak verir).

import React from 'react';
import {
  PERIODS, approxTL, barSegments, deltaShort, fmtTL, fmtWeekdayDate, isEstimated,
} from './insightsFormat';

const chevR = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
);

export function ProductThumb({ src, alt, className = '' }) {
  const [broken, setBroken] = React.useState(false);
  return (
    <span className={'moi-thumb ' + className}>
      {src && !broken
        ? <img src={src} alt={alt || ''} loading="lazy" onError={() => setBroken(true)} />
        : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
          </svg>
        )}
    </span>
  );
}

export function SegmentBar({ breakdown, className = '' }) {
  const segs = barSegments(breakdown);
  return (
    <span className={'moi-bar ' + className} aria-hidden="true">
      {segs.map(s => <span key={s.key} style={{ width: `${s.pct}%`, background: s.color }} />)}
    </span>
  );
}

function Card({ label, onClick, className = '', children }) {
  return (
    <button type="button" className={'moi-card ' + className} onClick={onClick}>
      <span className="moi-card-label">{label}{chevR}</span>
      {children}
    </button>
  );
}

function MiniBars({ daily }) {
  const max = Math.max(1, ...daily.map(d => d.total));
  return (
    <span className="moi-minibars" aria-hidden="true" style={{ gap: daily.length > 20 ? 1 : daily.length > 8 ? 3 : 6 }}>
      {daily.map(d => <span key={d.date} style={{ height: `${Math.max(4, (d.total / max) * 100)}%` }} />)}
    </span>
  );
}

function SkeletonCards() {
  return (
    <>
      {[196, 200, 150, 150].map((w, i) => (
        <span key={i} className="moi-card moi-card-skel" style={{ flexBasis: w }} aria-hidden="true" />
      ))}
    </>
  );
}

export function InsightsStrip({ period, onPeriodChange, data, isLoading, isError, onRetry, onOpen }) {
  const estimated = isEstimated(data);
  const b = data?.breakdown;
  const sales = data?.sales;
  const top = data?.products?.top ?? [];
  const pay = data?.payments;

  return (
    <section className="moi-strip" aria-label="Trendyol özeti">
      <div className="moi-periods" role="group" aria-label="Dönem">
        {PERIODS.map(p => (
          <button
            key={p.key}
            type="button"
            className={'moi-period' + (period === p.key ? ' on' : '')}
            aria-pressed={period === p.key}
            onClick={() => onPeriodChange(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="moi-cards">
        {isLoading && !data ? <SkeletonCards /> : isError && !data ? (
          <div className="moi-card moi-card-error" role="status">
            <span>Trendyol özeti alınamadı.</span>
            <button type="button" className="moi-linkbtn" onClick={onRetry}>Tekrar dene</button>
          </div>
        ) : (
          <>
            <Card label="Sana kalan" className="moi-card-kalan" onClick={() => onOpen('kalan')}>
              <span className="moi-card-value moi-green">{approxTL(b?.remaining, estimated)}</span>
              <span className="moi-card-foot">
                <SegmentBar breakdown={b} />
                <span className="moi-card-sub moi-row">
                  <span>{fmtTL(sales?.total)} satıştan</span>
                  {sales?.deltaPct != null && (
                    <b className={sales.deltaPct >= 0 ? 'moi-up' : 'moi-down'}>{deltaShort(sales.deltaPct)}</b>
                  )}
                </span>
              </span>
            </Card>

            <Card label="En çok satanlar" className="moi-card-top" onClick={() => onOpen('cok')}>
              {top.length === 0 ? (
                <span className="moi-card-sub moi-empty-note">Bu dönemde satış yok</span>
              ) : (
                <>
                  <span className="moi-stack">
                    {top.slice(0, 3).map((t, i) => (
                      <ProductThumb key={t.key} src={t.imageUrl} alt={t.name} className={'moi-stack-item' + (i > 0 ? ' overlap' : '')} />
                    ))}
                    {data.products.count > 3 && <span className="moi-card-sub moi-more">+{data.products.count - 3} ürün</span>}
                  </span>
                  <span className="moi-card-name">
                    <span className="moi-ellipsis">{top[0].name}</span>
                    <span className="moi-card-sub">{top[0].quantity} adet ile ilk sırada</span>
                  </span>
                </>
              )}
            </Card>

            <Card label="Sipariş" className="moi-card-sm" onClick={() => onOpen('satis')}>
              <span className="moi-row moi-baseline">
                <span className="moi-card-value">{sales?.orders ?? 0}</span>
                {sales?.avgOrder != null && <span className="moi-card-sub">ort. {fmtTL(sales.avgOrder)}</span>}
              </span>
              <MiniBars daily={sales?.daily ?? []} />
            </Card>

            <Card label="Sıradaki ödeme" className="moi-card-sm" onClick={() => onOpen('odeme')}>
              {pay?.next ? (
                <>
                  <span className="moi-card-value">{approxTL(pay.next.amount, true)}</span>
                  <span className="moi-card-sub">{fmtWeekdayDate(pay.next.date)}</span>
                </>
              ) : (
                <>
                  <span className="moi-card-value">—</span>
                  <span className="moi-card-sub">{pay?.available === false ? 'Ekstre alınamadı' : 'Bekleyen ödeme yok'}</span>
                </>
              )}
            </Card>
          </>
        )}
      </div>
    </section>
  );
}

// Şerit kaydırılıp gidince sekmelerin üstünde kalan tek satır.
export function InsightsMiniBar({ period, data, onExpand }) {
  const estimated = isEstimated(data);
  return (
    <div className="moi-mini">
      <span className="moi-mini-period">{PERIODS.find(p => p.key === period)?.label}</span>
      <span className="moi-mini-val moi-green">{approxTL(data?.breakdown?.remaining, estimated)} <span>sana kaldı</span></span>
      <span className="moi-mini-val">{data?.sales?.orders ?? 0} <span>sipariş</span></span>
      <button type="button" className="moi-mini-btn" onClick={onExpand}>
        Özet
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
    </div>
  );
}
