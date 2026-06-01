export {
  fmtDate,
  fmtShortDate,
  parseMoney,
  todayIso,
  formatPhoneTr,
  previewInitials,
  getAttendanceStatus,
  getStudentFinancialState,
  buildOpenDebtItems,
} from '../../students';

export { fmtTL } from '../../data';

// Triyaj listesinde satır kuyruğu/pasif alt satırı için kısa (önek-siz) etiket:
// "Bugün", "Dün", "4 gün önce" gibi.
export function formatLastLessonShort(iso) {
  if (!iso) return 'Henüz ders almadı';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Henüz ders almadı';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'Bugün';
  if (days === 1) return 'Dün';
  if (days < 7) return `${days} gün önce`;
  if (days < 14) return '1 hafta önce';
  if (days < 30) return `${Math.floor(days / 7)} hafta önce`;
  return `${Math.floor(days / 30)} ay önce`;
}
