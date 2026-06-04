import { fmtTL } from '../../data';

export const PAYMENT_METHOD_LABELS = {
  cash: 'Nakit',
  bank_transfer: 'IBAN',
  card: 'Kart',
  mixed: 'Karışık',
};

// Bir ders en erken başlangıcından şu kadar dakika sonra "tamamlandı"
// işaretlenebilir — geleceğin dersini yanlışlıkla tamamlamayı engeller.
// Backend lessons.service.ts aynı eşiği uygular (MIN_MINUTES_AFTER_START_TO_COMPLETE).
export const COMPLETE_AVAILABLE_AFTER_MINUTES = 20;

export function getCompleteAvailableAt(startsAt) {
  if (!startsAt) return null;
  const ms = new Date(startsAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + COMPLETE_AVAILABLE_AFTER_MINUTES * 60 * 1000);
}

export function canCompleteLessonAt(startsAt, nowMs = Date.now()) {
  const target = getCompleteAvailableAt(startsAt);
  if (!target) return true;
  return nowMs >= target.getTime();
}

export function formatIstanbulTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

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
      // Net 0 ders: ödeme beklenmediği için "Ödendi" yanıltıcı olur.
      if (!(s.price > 0)) return { label: 'Tamamlandı', summary: null };
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
