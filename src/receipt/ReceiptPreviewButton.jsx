import React from 'react';
import { ReceiptPreviewModal } from './ReceiptPreviewModal.jsx';

// Profil satırlarında kullanılan "Makbuz" düğmesi. Eskiden doğrudan paylaşıma
// gidiyordu (ReceiptShareButton); artık önce makbuzun önizlemesini açar, paylaş
// butonu önizlemenin altındadır. Hayalet pill görünümü (.rcpt-share-row /
// .rcpt-share-mobile-row) korunur.

function ReceiptIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9 8.5h6M9 12.5h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function ReceiptPreviewButton({ model, variant = 'row', label = 'Makbuz', className }) {
  const [open, setOpen] = React.useState(false);
  if (!model) return null;

  const cls =
    'rcpt-share-btn rcpt-share-' + variant + (className ? ' ' + className : '');

  return (
    <>
      <button type="button" className={cls} onClick={() => setOpen(true)}>
        <ReceiptIcon />
        <span>{label}</span>
      </button>
      {open && (
        <ReceiptPreviewModal model={model} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
