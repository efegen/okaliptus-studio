import React from 'react';
import { createPortal } from 'react-dom';
import { ReceiptCard } from './ReceiptCard.jsx';
import { ReceiptShareButton } from './ReceiptShareButton.jsx';

// Makbuz önizleme modalı: profil satırından açılır. Gerçek ReceiptCard'ı (1080×1350)
// ekrana sığacak ölçekte gösterir, altında tam genişlik "Makbuzu paylaş" butonu olur.
// Paylaşma artık tek dokunuşla değil; önce önizleme görülür, sonra paylaşılır.
//
// Portal hedefi: mobilde `mobile-palette-root`, web'de `.app` — ikisi de palette/
// density CSS değişkenlerini taşır, böylece var(--accent) doğru çözülür.

const CARD_W = 1080;
const CARD_H = 1350;

function getPortalRoot() {
  if (typeof document === 'undefined') return null;
  return (
    document.getElementById('mobile-palette-root') ||
    document.querySelector('.app') ||
    document.body
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function ReceiptPreviewModal({
  model,
  onClose,
  shareVariant = 'mobile',
  shareLabel = 'Makbuzu paylaş',
}) {
  const container = React.useMemo(getPortalRoot, []);
  const [vp, setVp] = React.useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 393,
    h: typeof window !== 'undefined' ? window.innerHeight : 760,
  }));

  React.useEffect(() => {
    function onResize() { setVp({ w: window.innerWidth, h: window.innerHeight }); }
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (!model) return null;

  // Kartı hem genişliğe (≤460, masaüstünde devasa olmasın) hem yüksekliğe sığdır;
  // altta paylaş butonu + boşluklar için ~120px yer bırak.
  const maxW = Math.min(vp.w - 40, 460);
  const maxH = vp.h - 120;
  const scale = Math.max(0.05, Math.min(maxW / CARD_W, maxH / CARD_H));
  const w = Math.round(CARD_W * scale);
  const h = Math.round(CARD_H * scale);

  const node = (
    <div
      className="rcpt-modal"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Makbuz önizleme"
    >
      <button type="button" className="rcpt-modal-close" onClick={onClose} aria-label="Kapat">
        <CloseIcon />
      </button>

      <div className="rcpt-modal-inner" style={{ width: w }} onClick={(e) => e.stopPropagation()}>
        <div className="rcpt-modal-card" style={{ width: w, height: h }}>
          <div className="rcpt-modal-card-scale" style={{ transform: `scale(${scale})` }}>
            <ReceiptCard model={model} />
          </div>
        </div>
        <ReceiptShareButton variant={shareVariant} eager label={shareLabel} model={model} />
      </div>
    </div>
  );

  return container ? createPortal(node, container) : node;
}
