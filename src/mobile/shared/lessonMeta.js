import { fmtTL } from '../../data';

export const PAYMENT_METHOD_LABELS = {
  cash: 'Nakit',
  bank_transfer: 'IBAN',
  card: 'Kart',
  mixed: 'Karışık',
};

export function debtStateFor(paid, total) {
  if (total <= 0) return 'empty';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

export const LESSON_STATE_META = {
  planned: { label: 'Planlandı',             cls: 'mobile-lsheet-pill-planned' },
  unpaid:  { label: 'Tamamlandı · Ödenmedi', cls: 'mobile-lsheet-pill-unpaid' },
  partial: { label: 'Kısmi ödendi',          cls: 'mobile-lsheet-pill-partial' },
  paid:    { label: 'Ödendi',                cls: 'mobile-lsheet-pill-paid' },
};

export function getLessonStateInfo(s) {
  switch (s.lessonState) {
    case 'planned':
      return { label: 'Planlandı', summary: null };
    case 'unpaid':
      return {
        label: 'Tamamlandı · Ödenmedi',
        summary: s.price > 0 ? fmtTL(s.price) : null,
      };
    case 'partial': {
      const summary = s.price > 0 ? `${fmtTL(s.paid)} / ${fmtTL(s.price)}` : null;
      return { label: 'Kısmi ödendi', summary };
    }
    case 'paid': {
      const methodLabel = s.paymentMethod
        ? (PAYMENT_METHOD_LABELS[s.paymentMethod] || s.paymentMethod)
        : null;
      const label = methodLabel ? `Ödendi · ${methodLabel}` : 'Ödendi';
      const summary = s.price > 0 ? `${fmtTL(s.paid)} / ${fmtTL(s.price)}` : null;
      return { label, summary };
    }
    case 'cancelled':
      return { label: 'İptal', summary: null };
    default:
      return { label: '', summary: null };
  }
}
