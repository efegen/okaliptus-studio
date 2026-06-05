import React from 'react';
import { renderReceiptToPng } from './renderReceiptToPng.js';
import { shareReceipt, receiptFilename } from './shareReceipt.js';

// Makbuzu üretip paylaşan tek düğme. Hem satış-sonu ekranlarında (eager: arkada
// önceden üretir, dokununca anında paylaşır) hem profil satırlarında (dokununca
// üretir) kullanılır. `variant` yüzeye göre stil seçer (receipt.css).
//
// Not: çağıran `model`'i useMemo ile sabit kimlikte vermeli; aksi halde her
// render üretim önbelleği sıfırlanır.

function ShareIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 7l4-4 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ReceiptShareButton({ model, eager = false, label = 'Makbuzu paylaş', variant = 'web', className }) {
  const [status, setStatus] = React.useState('idle'); // idle | working | error
  const genRef = React.useRef(null); // önbelleğe alınmış/uçuştaki blob promise
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // model değişince üretim önbelleğini sıfırla
  React.useEffect(() => { genRef.current = null; }, [model]);

  const ensureBlob = React.useCallback(() => {
    if (!genRef.current) genRef.current = renderReceiptToPng(model);
    return genRef.current;
  }, [model]);

  // eager: ekran açılınca PNG'yi arkada önceden hazırla
  React.useEffect(() => {
    if (!eager || !model) return;
    let alive = true;
    setStatus('working');
    ensureBlob()
      .then(() => { if (alive && mountedRef.current) setStatus('idle'); })
      .catch(() => { genRef.current = null; if (alive && mountedRef.current) setStatus('idle'); });
    return () => { alive = false; };
  }, [eager, model, ensureBlob]);

  async function handleClick() {
    setStatus('working');
    try {
      const blob = await ensureBlob();
      await shareReceipt(blob, receiptFilename(model), {
        title: 'Okaliptus Yoga — Teşekkür Makbuzu',
        text: `${model.customerName} · ${model.totalText}`,
      });
      if (mountedRef.current) setStatus('idle');
    } catch {
      genRef.current = null; // tekrar denemeye izin ver
      if (mountedRef.current) setStatus('error');
    }
  }

  const busy = status === 'working';
  const text = busy ? 'Hazırlanıyor…' : status === 'error' ? 'Tekrar dene' : label;
  const cls =
    'rcpt-share-btn rcpt-share-' + variant +
    (status === 'error' ? ' rcpt-share-error' : '') +
    (className ? ' ' + className : '');

  return (
    <button type="button" className={cls} onClick={handleClick} disabled={busy} aria-busy={busy}>
      {busy ? null : <ShareIcon />}
      <span>{text}</span>
    </button>
  );
}
