// "Şu an sitede" — o an sitede olan ziyaretçiler (tam ekran, Site ekranındaki
// yeşil karttan açılır). Kişilerin kim olduğu bilinmez: yalnız geldikleri
// kaynak, tahmini il, cihaz, baktıkları sayfa ve sitede geçen süre.

import React from 'react';
import { InqIcon } from '../inquiries/InquiryIcons';
import { SourceLogo } from './SourceLogo';
import { useSiteLive } from './MobileSiteStats';
import { deviceLabel, duration, formOpenText, num, pageLabel, sourceLine } from './siteStatsMeta';
import '../inquiries/inquiries.css';
import './siteStats.css';

function Visitor({ v }) {
  const where = [v.region, deviceLabel(v.device).toLocaleLowerCase('tr-TR')].filter(Boolean).join(', ');
  const before = v.trail.map((t) => pageLabel(t)).join(', ');
  return (
    <li className="ss-visitor">
      <SourceLogo source={v.source} size={40} />
      <div className="ss-visitor-body">
        <div className="ss-visitor-top">
          <strong>{pageLabel(v)}</strong>
          <span className="ss-visitor-time ss-num">{duration(v.durationMs)}</span>
        </div>
        <span className="ss-visitor-where">{where.charAt(0).toLocaleUpperCase('tr-TR') + where.slice(1)}</span>
        <span className="ss-visitor-line">
          {sourceLine(v)}
          {before ? `. Önce: ${before}` : ''}
        </span>
        {v.formOpen && <span className="ss-visitor-flag">{formOpenText(v.formOpen)}</span>}
      </div>
    </li>
  );
}

export function MobileSiteLive({ onBack }) {
  const live = useSiteLive();
  const data = live.data;
  const count = data?.count ?? 0;

  return (
    <div className="inq-page ss-page">
      <div className="inq-top">
        <header className="inq-head">
          <button type="button" className="inq-iconbtn" onClick={onBack} aria-label="Geri">
            <InqIcon.ChevronL size={22} />
          </button>
          <div className="inq-head-text">
            <h1 className="inq-title">Şu an sitede</h1>
            <span className="inq-subtitle">Kendiliğinden yenilenir</span>
          </div>
          <span className="ss-live-pill" aria-live="polite">
            <span className={`ss-pulse is-dark${count > 0 ? ' is-on' : ''}`} aria-hidden="true" />
            <span className="ss-num">{num(count)} kişi</span>
          </span>
        </header>
      </div>

      <div className="ss-body">
        {live.isLoading ? (
          <p className="inq-state">Yükleniyor…</p>
        ) : live.isError ? (
          <div className="inq-state">
            <p style={{ margin: 0 }}>Canlı liste alınamadı.</p>
            <button type="button" className="inq-more" onClick={() => live.refetch()}>Tekrar dene</button>
          </div>
        ) : count === 0 ? (
          <div className="inq-empty">
            <span className="inq-empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" /></svg>
            </span>
            <p className="inq-empty-title">Şu an sitede kimse yok</p>
            <p className="inq-empty-text">Biri siteyi açınca burada görünür.</p>
          </div>
        ) : (
          <ul className="ss-visitors">
            {data.visitors.map((v, i) => <Visitor key={`${v.startedAt}-${v.path}-${i}`} v={v} />)}
          </ul>
        )}
        <p className="ss-foot">Kişilerin kim olduğu bilinmez. Form gönderen olursa Talepler'e düşer.</p>
      </div>
    </div>
  );
}
