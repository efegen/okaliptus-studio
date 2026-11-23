// Site ekranı — okaliptusyoga.com'un ziyaret istatistikleri (yalnız owner).
// Menü → "Site" satırından açılır. Tasarım: "Studio Site istatistikleri mobil"
// canvas'ı. Dört bölüm tek sayfada, çiplerle değişir: Özet, Kaynaklar,
// Reklamlar, Yapay zekâ. Yeşil "Şu an sitede" kartı canlı listeyi açar.
//
// Veri: GET /site-stats/overview?period= (dönem değişince) ve
// GET /site-stats/live (ekran açıkken 10 saniyede bir).

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSiteStatsLive, getSiteStatsOverview } from '../../api';
import { queryKeys } from '../../hooks/queryKeys';
import { InqIcon } from '../inquiries/InquiryIcons';
import { SourceLogo } from './SourceLogo';
import {
  AD_URL_PARAMS,
  AI_SOURCES,
  PERIODS,
  SECTIONS,
  changeText,
  dayParts,
  deviceLabel,
  duration,
  funnelFor,
  inquiryKindsText,
  isAdSource,
  num,
  pageLabel,
  percent,
  rangeLabel,
  regionLabel,
  sourceMeta,
} from './siteStatsMeta';
import '../inquiries/inquiries.css';
import './siteStats.css';

const LIVE_REFRESH_MS = 10 * 1000;

/** Şu an sitede olanlar; ekran görünürken kendiliğinden yenilenir. */
export function useSiteLive() {
  return useQuery({
    queryKey: queryKeys.siteStatsLive(),
    queryFn: getSiteStatsLive,
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: 5 * 1000,
  });
}

function Bar({ value, max, muted = false }) {
  return (
    <span className="ss-bar" aria-hidden="true">
      <i className={muted ? 'is-muted' : undefined} style={{ width: `${percent(value, max)}%` }} />
    </span>
  );
}

function Card({ title, aside, sub, children, className = '' }) {
  return (
    <section className={`ss-card ${className}`.trim()}>
      {(title || aside) && (
        <div className="ss-card-head">
          <div className="ss-card-titles">
            {title && <h2 className="ss-h2">{title}</h2>}
            {sub && <p className="ss-sub">{sub}</p>}
          </div>
          {aside && <span className="ss-sub ss-num">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

function Empty({ children }) {
  return <p className="ss-empty">{children}</p>;
}

// ─── Şu an sitede ────────────────────────────────────────────────────────────
function LiveCard({ live, onOpen }) {
  const data = live.data;
  const count = data?.count ?? 0;
  const fromAds = (data?.visitors ?? []).filter((v) => isAdSource(v.source)).length;
  return (
    <button type="button" className="ss-live" onClick={onOpen} aria-label={`Şu an sitede ${count} kişi. Listeyi aç`}>
      <span className="ss-live-blob" aria-hidden="true" />
      <span className="ss-live-top">
        <span className="ss-live-main">
          <span className="ss-live-label">
            <span className={`ss-pulse${count > 0 ? ' is-on' : ''}`} aria-hidden="true" />
            Şu an sitede
          </span>
          <span className="ss-live-count">
            <span className="ss-num">{live.isLoading ? '–' : num(count)}</span>
            <small>kişi</small>
          </span>
        </span>
        <InqIcon.ChevronR size={18} />
      </span>
      {count > 0 ? (
        <span className="ss-live-pages">
          {data.pages.slice(0, 3).map((p) => (
            <span key={p.path} className="ss-live-page">
              <span>{pageLabel(p)}</span>
              <span className="ss-num">{num(p.count)}</span>
            </span>
          ))}
        </span>
      ) : (
        <span className="ss-live-note">{live.isError ? 'Canlı liste alınamadı.' : 'Şu an kimse yok.'}</span>
      )}
      {fromAds > 0 && <span className="ss-live-note">{num(fromAds)} kişi reklamdan geldi</span>}
    </button>
  );
}

// ─── Özet ────────────────────────────────────────────────────────────────────
function Kpi({ label, value, note, tone }) {
  return (
    <div className="ss-kpi">
      <p className="ss-kpi-label">{label}</p>
      <div className="ss-kpi-value ss-num">{value}</div>
      {note && <p className={`ss-kpi-note${tone ? ` is-${tone}` : ''}`}>{note}</p>}
    </div>
  );
}

function DailyChart({ series, today }) {
  const max = Math.max(1, ...series.map((d) => d.visitors));
  const dense = series.length > 10;
  const label = series.map((d) => `${dayParts(d.day).day} ${dayParts(d.day).month} ${d.visitors}`).join(', ');
  return (
    <div className={`ss-chart${dense ? ' is-dense' : ''}`} role="img" aria-label={`Günlük ziyaretçi: ${label}`}>
      {series.map((d, i) => {
        const parts = dayParts(d.day);
        const isToday = d.day === today;
        const showLabel = !dense || isToday || (series.length - 1 - i) % 5 === 0;
        return (
          <div key={d.day} className={`ss-chart-col${isToday ? ' is-today' : ''}`}>
            {!dense && <span className="ss-chart-value ss-num">{num(d.visitors)}</span>}
            <span className="ss-chart-area">
              <span className="ss-chart-bar" style={{ height: `${Math.max(d.visitors > 0 ? 4 : 2, Math.round((d.visitors / max) * 100))}%` }} />
            </span>
            <span className="ss-chart-label">{showLabel ? (dense ? parts.day : isToday ? 'Bugün' : parts.name) : ''}</span>
          </div>
        );
      })}
    </div>
  );
}

function Funnel({ funnel }) {
  const max = Math.max(1, funnel.steps[0].value);
  return (
    <Card title={funnel.title} sub={`${funnel.page} sayfasını açanlar formu gönderene kadar nerede kaldı?`}>
      <ol className="ss-funnel">
        {funnel.steps.map((step, i) => {
          const width = percent(step.value, max);
          const inside = width >= 45;
          return (
            <li key={step.label} className={step.final ? 'is-final' : undefined}>
              <span className="ss-funnel-track">
                <span className={`ss-funnel-fill tone-${Math.min(i, 3)}`} style={{ width: `${Math.max(width, 3)}%` }}>
                  {inside && <span>{step.label}</span>}
                </span>
                {!inside && <span className="ss-funnel-out">{step.label}</span>}
              </span>
              <span className="ss-funnel-value ss-num">{num(step.value)}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function Summary({ data, period, live, onOpenLive }) {
  const t = data.totals;
  const change = changeText(t.visitors, t.previousVisitors, period);
  const kinds = inquiryKindsText(t.inquiriesByKind);
  const pages = data.pages.slice(0, 6);
  const maxViews = Math.max(1, ...pages.map((p) => p.views));
  const known = data.regions.filter((r) => r.region);
  const topRegions = known.slice(0, 5);
  const otherRegions = known.slice(5).reduce((sum, r) => sum + r.visitors, 0);
  const unknownRegion = data.regions.find((r) => !r.region)?.visitors ?? 0;
  const maxRegion = Math.max(1, ...known.map((r) => r.visitors), otherRegions, unknownRegion);
  const deviceTotal = data.devices.reduce((sum, d) => sum + d.visitors, 0);
  const funnels = ['camp', 'lesson'].map((k) => funnelFor(data, k)).filter(Boolean);
  const phoneSpeed = data.speed.find((s) => s.device === 'phone') ?? data.speed[0];
  const seriesDays = period === '30d' ? 30 : 7;
  const series = data.series.slice(-seriesDays);

  return (
    <>
      <LiveCard live={live} onOpen={onOpenLive} />

      <div className="ss-kpis">
        <Kpi label="Ziyaretçi" value={num(t.visitors)} note={change?.text} tone={change?.tone} />
        <Kpi
          label="Sayfa görüntüleme"
          value={num(t.pageviews)}
          note={t.visitors > 0 ? `Kişi başı ${(t.pageviews / t.visitors).toFixed(1).replace('.', ',')} sayfa` : null}
        />
        <Kpi label="Sitede ortalama süre" value={duration(t.avgVisitMs)} note="Sekme öndeyken sayılır" />
        <Kpi label="Gelen form" value={num(t.inquiries)} note={kinds || 'Bu dönemde form yok'} />
      </div>

      <Card title="Günlük ziyaretçi" aside={series.length ? rangeLabel(series[0].day, series[series.length - 1].day) : null}>
        <DailyChart series={series} today={data.range.to} />
      </Card>

      <Card title="Sayfalar" aside="Görüntüleme">
        {pages.length === 0 ? <Empty>Bu dönemde açılan sayfa yok.</Empty> : (
          <div className="ss-rows">
            {pages.map((p) => {
              const price = p.sections?.giris;
              return (
                <div key={p.path} className="ss-row">
                  <div className="ss-row-top"><span>{pageLabel(p)}</span><strong className="ss-num">{num(p.views)}</strong></div>
                  <Bar value={p.views} max={maxViews} />
                  <span className="ss-sub">
                    Ortalama {duration(p.avgActiveMs)}
                    {price ? `, yüzde ${percent(price, p.visits)}'i fiyat bölümüne indi` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="İller" aside="Ziyaretçi">
        {data.regions.length === 0 ? <Empty>Bu dönemde ziyaretçi yok.</Empty> : (
          <>
            <div className="ss-grid-rows">
              {topRegions.map((r) => (
                <div key={r.region} className="ss-grid-row">
                  <span>{r.region}</span><Bar value={r.visitors} max={maxRegion} /><strong className="ss-num">{num(r.visitors)}</strong>
                </div>
              ))}
              {otherRegions > 0 && (
                <div className="ss-grid-row is-muted">
                  <span>Diğer iller</span><Bar value={otherRegions} max={maxRegion} muted /><strong className="ss-num">{num(otherRegions)}</strong>
                </div>
              )}
              {unknownRegion > 0 && (
                <div className="ss-grid-row is-muted">
                  <span>{regionLabel(null)}</span><Bar value={unknownRegion} max={maxRegion} muted /><strong className="ss-num">{num(unknownRegion)}</strong>
                </div>
              )}
            </div>
            <p className="ss-sub">İl, bağlantı adresinden tahmin edilir. Mobil internette yanlış çıkabilir.</p>
          </>
        )}
      </Card>

      {deviceTotal > 0 && (
        <Card title="Cihaz">
          <div
            className="ss-split"
            role="img"
            aria-label={data.devices.map((d) => `${deviceLabel(d.device)} yüzde ${percent(d.visitors, deviceTotal)}`).join(', ')}
          >
            {data.devices.map((d) => (
              <span key={d.device} className={`d-${d.device}`} style={{ flexGrow: Math.max(d.visitors, deviceTotal * 0.02) }} />
            ))}
          </div>
          <div className="ss-legend">
            {data.devices.map((d) => (
              <span key={d.device}>
                <i className={`d-${d.device}`} aria-hidden="true" />{deviceLabel(d.device)} <b className="ss-num">%{percent(d.visitors, deviceTotal)}</b>
              </span>
            ))}
          </div>
        </Card>
      )}

      {funnels.map((f) => <Funnel key={f.kind} funnel={f} />)}

      {phoneSpeed && phoneSpeed.samples > 0 && (
        <section className="ss-card ss-inline">
          <span className="ss-tile" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          </span>
          <div className="ss-inline-text">
            <strong>
              Sayfalar {phoneSpeed.device === 'phone' ? 'telefonda' : deviceLabel(phoneSpeed.device).toLocaleLowerCase('tr-TR') + 'da'}{' '}
              {(phoneSpeed.lcpMs / 1000).toFixed(1).replace('.', ',')} saniyede açılıyor
            </strong>
            <span className="ss-sub">Gerçek ziyaretçilerde ölçülen orta değer, {num(phoneSpeed.samples)} ölçüm</span>
          </div>
        </section>
      )}
    </>
  );
}

// ─── Kaynaklar ───────────────────────────────────────────────────────────────
function Sources({ data }) {
  const sources = data.sources;
  const max = Math.max(1, ...sources.map((s) => s.visitors));
  const best = [...sources].sort((a, b) => b.inquiries - a.inquiries)[0];
  const links = data.links.filter((l) => l.source === 'instagram');
  const linkTotal = links.reduce((sum, l) => sum + l.visitors, 0);
  const maxLink = Math.max(1, ...links.map((l) => l.visitors));

  if (sources.length === 0) return <Card><Empty>Bu dönemde ziyaretçi yok.</Empty></Card>;
  return (
    <>
      {best && best.inquiries > 0 && (
        <section className="ss-card ss-inline is-accent">
          <SourceLogo source={best.source} size={38} plain />
          <div className="ss-inline-text">
            <strong>En çok form buradan geldi: {sourceMeta(best.source).label}</strong>
            <span>{num(data.totals.inquiries)} formun {num(best.inquiries)}'i</span>
          </div>
        </section>
      )}

      <Card title="Ziyaretçiler nereden geldi?" aside={`${num(data.totals.visitors)} kişi`}>
        <div className="ss-srcs">
          {sources.map((s) => (
            <div key={s.source} className="ss-src">
              <SourceLogo source={s.source} size={38} />
              <div className="ss-row">
                <div className="ss-row-top"><span>{sourceMeta(s.source).label}</span><strong className="ss-num">{num(s.visitors)}</strong></div>
                <Bar value={s.visitors} max={max} />
                <span className="ss-sub">
                  Ortalama {duration(s.avgVisitMs)}
                  {s.inquiries > 0 ? `, ${num(s.inquiries)} form` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {links.length > 0 && (
        <Card title="Instagram'da hangi bağlantı?" sub={`Reklam dışındaki ${num(linkTotal)} ziyaretçi`}>
          <div className="ss-grid-rows is-wide">
            {links.map((l, i) => (
              <div key={`${l.label}-${l.clickMark}-${i}`} className="ss-grid-row">
                <span>{l.label || 'Etiketsiz bağlantı'}</span><Bar value={l.visitors} max={maxLink} /><strong className="ss-num">{num(l.visitors)}</strong>
              </div>
            ))}
          </div>
          <p className="ss-sub">Paylaştığınız bağlantıya etiket eklerseniz her biri ayrı sayılır.</p>
        </Card>
      )}
    </>
  );
}

// ─── Reklamlar ───────────────────────────────────────────────────────────────
function AdCard({ ad }) {
  const priceSeen = ad.sections?.giris;
  const formSeen = ad.sections?.form;
  const cells = [];
  if (priceSeen !== undefined) cells.push({ value: priceSeen, label: 'fiyatı gördü' });
  else if (formSeen !== undefined) cells.push({ value: formSeen, label: 'forma indi' });
  if (ad.formOpen > 0 || priceSeen !== undefined) cells.push({ value: ad.formOpen, label: 'formu açtı' });
  else cells.push({ value: ad.formStart, label: 'yazmaya başladı' });
  cells.push({ value: ad.inquiries, label: 'form gönderdi', final: true });
  const regions = ad.regions.filter((r) => r.region).slice(0, 3);
  const rest = ad.visitors - regions.reduce((sum, r) => sum + r.visitors, 0);

  return (
    <section className="ss-card">
      <div className="ss-ad-head">
        <div className="ss-card-titles">
          <span className="ss-sub">{[sourceMeta(ad.source).label, ad.campaign].filter(Boolean).join(', ')}</span>
          <h2 className="ss-ad-name">{ad.content || 'Adsız reklam'}</h2>
        </div>
        <div className="ss-ad-count"><strong className="ss-num">{num(ad.visitors)}</strong><span className="ss-sub">ziyaretçi</span></div>
      </div>
      <div className="ss-cells" style={{ '--ss-cols': cells.length }}>
        {cells.map((c) => (
          <div key={c.label} className={c.final && c.value > 0 ? 'is-final' : undefined}>
            <b className="ss-num">{num(c.value)}</b><span>{c.label}</span>
          </div>
        ))}
      </div>
      <div className="ss-ad-notes">
        <span>Sitede ortalama <b className="ss-num">{duration(ad.avgVisitMs)}</b> kaldılar</span>
        {regions.length > 0 && (
          <span>
            {regions.map((r) => `${r.region} ${num(r.visitors)}`).join(', ')}
            {rest > 0 ? `, diğer ${num(rest)}` : ''}
          </span>
        )}
      </div>
    </section>
  );
}

function Ads({ data }) {
  const [copied, setCopied] = React.useState(false);
  const ads = data.ads;
  const visitors = ads.reduce((sum, a) => sum + a.visitors, 0);
  const inquiries = ads.reduce((sum, a) => sum + a.inquiries, 0);
  const untagged = data.links.filter((l) => l.source === 'instagram' && l.clickMark && !l.label).reduce((sum, l) => sum + l.visitors, 0);

  async function copyParams() {
    try {
      await navigator.clipboard.writeText(AD_URL_PARAMS);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      {ads.length > 0 && (
        <section className="ss-hero">
          <div className="ss-hero-head">
            <SourceLogo source="instagram_ad" size={38} plain />
            <span>Reklamlardan gelenler</span>
          </div>
          <div className="ss-hero-nums">
            <div><strong className="ss-num">{num(visitors)}</strong><span>ziyaretçi</span></div>
            <div><strong className="ss-num">{num(inquiries)}</strong><span>form</span></div>
          </div>
          <span className="ss-hero-note">
            {inquiries > 0
              ? `Her ${num(Math.max(1, Math.round(visitors / inquiries)))} ziyaretçiden biri form bıraktı.`
              : 'Bu dönemde reklamdan gelenlerden form bırakan olmadı.'}
          </span>
        </section>
      )}

      {ads.map((ad) => <AdCard key={`${ad.source}|${ad.campaign}|${ad.content}`} ad={ad} />)}

      {untagged > 0 && (
        <div className="ss-dashed">
          <span className="ss-dashed-icon" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z" /><path d="M7 7h.01" /></svg>
          </span>
          <span className="ss-dashed-text">
            <strong>{num(untagged)} etiketsiz Instagram tıklaması</strong>
            <span>Instagram'dan geldikleri belli; reklamdan mı profilden mi, belli değil. Bağlantıda etiket yok.</span>
          </span>
        </div>
      )}

      <Card
        title={ads.length === 0 ? 'Bu dönemde reklamdan gelen yok' : 'Yeni reklam verirken'}
        sub="Bir reklamın burada görünmesi için, Meta'da reklamın “URL parametreleri” alanına şu satır yazılmalı:"
      >
        <code className="ss-code">{AD_URL_PARAMS}</code>
        <button type="button" className="ss-btn" onClick={copyParams}>{copied ? 'Kopyalandı' : 'Satırı kopyala'}</button>
      </Card>

      <p className="ss-foot">Harcama ve gösterim sayıları burada yok; onlar Meta Reklam Yöneticisi'nde. Burası reklama tıklayan kişinin sitede ne yaptığını gösterir.</p>
    </>
  );
}

// ─── Yapay zekâ ──────────────────────────────────────────────────────────────
function Ai({ data }) {
  const bySource = new Map(data.sources.map((s) => [s.source, s]));
  const rows = AI_SOURCES
    .map((id) => bySource.get(id) ?? { source: id, visitors: 0, topTitle: null, topPath: null })
    // Copilot'u yalnız gelen olduysa göster (logosu yok).
    .filter((r) => r.source !== 'copilot' || r.visitors > 0);
  const total = rows.reduce((sum, r) => sum + r.visitors, 0);
  const crawlers = data.crawlers;

  return (
    <>
      <div className="ss-kpis">
        <Kpi label="Yapay zekâdan gelen" value={`${num(total)} kişi`} note="Cevaptaki bağlantıya tıkladılar" />
        <Kpi
          label="Tüm ziyaretçiler içinde"
          value={`%${percent(total, data.totals.visitors)}`}
          note={`${num(data.totals.visitors)} ziyaretçiden`}
        />
      </div>

      <Card title="Yapay zekâdan gelen ziyaretçiler" sub="Biri soru sordu, cevapta sitemiz çıktı ve tıkladı.">
        <div className="ss-ai">
          {rows.map((r) => (
            <div key={r.source} className="ss-ai-row">
              <SourceLogo source={r.source} size={40} />
              <div className="ss-ai-text">
                <strong>{sourceMeta(r.source).label}</strong>
                <span className="ss-sub">
                  {r.visitors > 0 ? `En çok açılan: ${r.topTitle || r.topPath || 'sayfa'}` : 'Bu dönemde gelen olmadı'}
                </span>
              </div>
              <div className="ss-ai-count">
                <b className={`ss-num${r.visitors > 0 ? '' : ' is-zero'}`}>{num(r.visitors)}</b><span className="ss-sub">kişi</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {Array.isArray(crawlers) && crawlers.length > 0 && (
        <Card title="Siteyi okuyan yapay zekâlar" sub="Sitemizi ne kadar sık okurlarsa bizi o kadar iyi tanırlar.">
          <div className="ss-ai">
            {crawlers.map((c) => (
              <div key={c.source} className="ss-ai-row">
                <SourceLogo source={c.source} size={40} />
                <div className="ss-ai-text"><strong>{sourceMeta(c.source).label}</strong></div>
                <div className="ss-ai-count"><b className="ss-num">{num(c.reads)}</b><span className="ss-sub">okuma</span></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="ss-dashed">
        <span className="ss-dashed-icon" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>
        </span>
        <span className="ss-dashed-text">
          <strong>Neyi göremeyiz?</strong>
          <span>
            İnsanların yapay zekâya ne sorduğunu ve cevapta adımızın geçip geçmediğini. Gördüğümüz, cevaptan tıklayıp gelenler.
            {!crawlers && ' Yapay zekâların sitemizi ne sıklıkla okuduğu henüz burada gösterilmiyor.'}
          </span>
        </span>
      </div>
    </>
  );
}

// ─── Sayfa ───────────────────────────────────────────────────────────────────
export function MobileSiteStats({ period = '7d', section = 'ozet', onChangePeriod, onChangeSection, onBack, onOpenLive }) {
  const live = useSiteLive();
  const overview = useQuery({
    queryKey: queryKeys.siteStatsOverview(period),
    queryFn: () => getSiteStatsOverview(period),
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });
  const data = overview.data;

  return (
    <div className="inq-page ss-page">
      <div className="inq-top">
        <header className="inq-head">
          <button type="button" className="inq-iconbtn" onClick={onBack} aria-label="Geri">
            <InqIcon.ChevronL size={22} />
          </button>
          <div className="inq-head-text">
            <h1 className="inq-title">Site</h1>
            <span className="inq-subtitle">okaliptusyoga.com</span>
          </div>
        </header>
        <div className="inq-controls">
          <div className="inq-seg" role="group" aria-label="Dönem">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={period === p.id}
                className={`inq-seg-btn${period === p.id ? ' is-on' : ''}`}
                onClick={() => onChangePeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="inq-chips" role="tablist" aria-label="Bölümler">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={section === s.id}
                className={`inq-chip${section === s.id ? ' is-on' : ''}`}
                onClick={() => onChangeSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={`ss-body${overview.isPlaceholderData ? ' is-stale' : ''}`}>
        {overview.isLoading ? (
          <p className="inq-state">Yükleniyor…</p>
        ) : overview.isError || !data ? (
          <div className="inq-state">
            <p style={{ margin: 0 }}>İstatistikler alınamadı.</p>
            <button type="button" className="inq-more" onClick={() => overview.refetch()}>Tekrar dene</button>
          </div>
        ) : (
          <>
            {section === 'ozet' && <Summary data={data} period={period} live={live} onOpenLive={onOpenLive} />}
            {section === 'kaynaklar' && <Sources data={data} />}
            {section === 'reklamlar' && <Ads data={data} />}
            {section === 'yapay-zeka' && <Ai data={data} />}
            {data.geo?.attribution && section === 'ozet' && (
              <p className="ss-foot">İl tahmini: <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">{data.geo.attribution}</a></p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
