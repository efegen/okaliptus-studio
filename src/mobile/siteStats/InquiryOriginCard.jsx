// Talep detayındaki "Siteye nereden geldi?" kartı: formu gönderen ziyaretin
// özeti (backend `site_inquiries.origin`, bkz. site-stats.service.ts →
// InquiryOrigin). Ziyaret bulunamadıysa (ölçüm kapalı ya da engellenmiş) kart
// hiç çizilmez.

import React from 'react';
import { SourceLogo } from './SourceLogo';
import { deviceLabel, duration, isAdSource, pageLabel, sourceMeta } from './siteStatsMeta';
import './siteStats.css';

export function InquiryOriginCard({ origin }) {
  if (!origin || typeof origin !== 'object' || !origin.source) return null;
  const meta = sourceMeta(origin.source);
  const tags = [origin.campaign, origin.content].filter(Boolean).join(', ');
  const detail = tags
    || (origin.source === 'other' && origin.referrerHost)
    || (origin.source === 'instagram' && origin.clickMark ? 'Etiketsiz bağlantı' : '');
  const pages = Array.isArray(origin.pages) ? origin.pages : [];

  return (
    <section className="inq-card ss-origin">
      <h2 className="inq-card-title">Siteye nereden geldi?</h2>
      <div className={`ss-origin-source${isAdSource(origin.source) ? ' is-ad' : ''}`}>
        <SourceLogo source={origin.source} size={40} plain />
        <div>
          <strong>{meta.short ?? meta.label}</strong>
          {detail && <span>{detail}</span>}
        </div>
      </div>
      <dl className="inq-dl">
        {origin.region && (
          <div><dt>İl (tahmini)</dt><dd><strong>{origin.region}</strong></dd></div>
        )}
        <div><dt>Cihaz</dt><dd><strong>{deviceLabel(origin.device)}</strong></dd></div>
        <div><dt>Sitede geçen süre</dt><dd><strong>{duration(origin.durationMs)}</strong></dd></div>
      </dl>
      {pages.length > 0 && (
        <div className="ss-origin-pages">
          <span className="ss-sub">Gezdiği sayfalar</span>
          <ol>
            {pages.map((p, i) => (
              <li key={`${p.path}-${i}`}>
                <span>{i + 1}. {pageLabel(p)}</span>
                <span className="ss-num">{duration(p.activeMs)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
