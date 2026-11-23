// Kaynağın logosu (Instagram, Google, ChatGPT ...) beyaz bir karoda; logosu
// olmayan kaynaklar için çizgi ikon. Süs sayılır: yanındaki metin kaynağı
// zaten yazar, bu yüzden aria-hidden.

import React from 'react';
import { SOURCE_LOGOS } from './sourceLogos';
import { sourceMeta } from './siteStatsMeta';

const STROKE = {
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
};

export function SourceLogo({ source, size = 40, plain = false }) {
  const meta = sourceMeta(source);
  const logo = meta.logo ? SOURCE_LOGOS[meta.logo] : null;
  const inner = Math.round(size * 0.52);
  return (
    <span
      className={`ss-logo${plain ? ' is-plain' : ''}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
      aria-hidden="true"
    >
      {logo ? (
        <svg width={inner} height={inner} viewBox="0 0 24 24" fill={logo.color}>
          <path d={logo.d} />
        </svg>
      ) : (
        <svg
          width={inner}
          height={inner}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {STROKE[meta.icon] ?? STROKE.globe}
        </svg>
      )}
    </span>
  );
}
