import React from 'react';
import { InqIcon } from './InquiryIcons';
import './inquiries.css';

// Ana sayfanın sağ üstü: profil harfinin yerinde talepler (gelen kutusu)
// düğmesi; kırmızı rozet yeni talep sayısı (şüpheliler sayılmaz). Çıkış zaten
// Menü'de olduğu için profil menüsü burada yok.
export function InquiryInboxButton({ count = 0, onClick }) {
  const n = Number(count) || 0;
  const text = n > 99 ? '99+' : String(n);
  return (
    <button
      type="button"
      className="inq-inbox-btn"
      onClick={onClick}
      aria-label={n > 0 ? `Talepler, ${text} yeni` : 'Talepler'}
    >
      <InqIcon.Inbox size={22} />
      {n > 0 && <span className="inq-inbox-badge" aria-hidden="true">{text}</span>}
    </button>
  );
}
