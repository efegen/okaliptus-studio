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

export const ATTENDANCE_TONE_CLASS = {
  high: 'mobile-students-att-high',
  medium: 'mobile-students-att-medium',
  low: 'mobile-students-att-low',
  absent: 'mobile-students-att-absent',
  inactive: 'mobile-students-att-inactive',
  new: 'mobile-students-att-new',
};

export const FINANCIAL_TONE_CLASS = {
  debt: 'mobile-students-fin-debt',
  clear: 'mobile-students-fin-clear',
};

export function formatLastLessonRelative(iso) {
  if (!iso) return 'Henüz ders almadı';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Henüz ders almadı';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'Son ders: bugün';
  if (days === 1) return 'Son ders: dün';
  if (days < 7) return `Son ders: ${days} gün önce`;
  if (days < 14) return 'Son ders: 1 hafta önce';
  if (days < 30) return `Son ders: ${Math.floor(days / 7)} hafta önce`;
  const months = Math.floor(days / 30);
  return `Son ders: ${months} ay önce`;
}
