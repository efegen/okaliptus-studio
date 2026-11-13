// Siparişler özeti (Trendyol insights) — ortak biçimlendiriciler ve türetilmiş değerler.
// Tarihler Europe/Istanbul'a (UTC+3, yaz saati yok) göre biçimlenir; backend de aynı
// sabit ofsetle gün/hafta/ay sınırlarını hesaplar.

const TR_OFFSET = 3 * 3_600_000;

export const PERIODS = [
  { key: 'hafta', label: 'Bu hafta' },
  { key: 'ay', label: 'Bu ay' },
  { key: 'gecen', label: 'Geçen ay' },
];

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const WEEKDAYS_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

function tr(ms) {
  return new Date(ms + TR_OFFSET);
}

// ₺18.449 (kuruşsuz). null/geçersiz → '—'. Negatifte eksi işareti başta.
export function fmtTL(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  const v = Math.round(Number(n));
  return `${v < 0 ? '−' : ''}₺${Math.abs(v).toLocaleString('tr-TR')}`;
}

// Kesinleşmemiş tutarların önüne '≈'.
export function approxTL(n, estimated) {
  const s = fmtTL(n);
  return estimated && s !== '—' ? `≈ ${s}` : s;
}

export function fmtDayMonth(ms) {
  const d = tr(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtWeekdayDate(ms) {
  const d = tr(ms);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtShortDay(ms) {
  const d = tr(ms);
  return `${WEEKDAYS_SHORT[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

// 'YYYY-MM-DD' (İstanbul günü) → o günün 00:00'ı (ms).
export function dayKeyToMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - TR_OFFSET;
}

export function dayNumber(key) {
  return Number(key.slice(8, 10));
}

// "9–13 Kasım" · "28 Eki – 2 Kas" · "Ekim" (tamamlanmış ay)
export function rangeLabel(period, range) {
  if (!range) return '';
  const s = tr(range.start);
  if (period === 'gecen') return MONTHS[s.getUTCMonth()];
  const e = tr(Math.max(range.start, range.end - 1));
  if (s.getUTCMonth() === e.getUTCMonth()) {
    return s.getUTCDate() === e.getUTCDate()
      ? `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`
      : `${s.getUTCDate()}–${e.getUTCDate()} ${MONTHS[s.getUTCMonth()]}`;
  }
  return `${s.getUTCDate()} ${MONTHS_SHORT[s.getUTCMonth()]} – ${e.getUTCDate()} ${MONTHS_SHORT[e.getUTCMonth()]}`;
}

export function periodLabel(period) {
  return PERIODS.find(p => p.key === period)?.label ?? '';
}

// "↑ %12" / "↓ %6" (null → '')
export function deltaShort(pct) {
  if (pct === null || pct === undefined) return '';
  return `${pct >= 0 ? '↑' : '↓'} %${Math.abs(pct)}`;
}

const COMPARE_WORD = { hafta: 'geçen haftaya göre', ay: 'geçen aya göre', gecen: 'önceki aya göre' };

export function deltaLong(pct, period) {
  if (pct === null || pct === undefined) return '';
  return `${deltaShort(pct)} ${COMPARE_WORD[period] ?? ''}`.trim();
}

// Ekstrede henüz kesinleşmemiş kalem var mı (komisyon/kargo tahmini)?
export function isEstimated(insights) {
  const b = insights?.breakdown;
  if (!b) return false;
  return !b.financeAvailable || b.estimatedOrders > 0;
}

// "Sana kalan" çubuğu ve döküm satırları. Yüzdeler satışa göre (0–100).
export const SEGMENT_COLORS = {
  komisyon: 'var(--moi-kom)',
  kargo: 'var(--moi-kargo)',
  kdv: 'var(--moi-kdv)',
  diger: 'var(--moi-diger)',
  stopaj: 'var(--moi-diger)',
  kalan: 'var(--moi-kalan)',
};

export function breakdownRows(b) {
  if (!b) return [];
  const sales = b.sales > 0 ? b.sales : 0;
  const pct = (v) => (sales > 0 ? (Math.max(0, v) / sales) * 100 : 0);
  return [
    { key: 'komisyon', label: 'Trendyol komisyonu', amount: b.commission, pct: pct(b.commission) },
    { key: 'kargo', label: 'Kargo', amount: b.cargo, pct: pct(b.cargo) },
    { key: 'kdv', label: 'KDV', amount: b.vat?.net ?? 0, pct: pct(b.vat?.net ?? 0) },
    { key: 'diger', label: 'Hizmet bedeli ve diğer', amount: b.otherFees, pct: pct(b.otherFees) },
    { key: 'stopaj', label: 'Stopaj', amount: b.stoppage, pct: pct(b.stoppage) },
  ];
}

// Çubuk parçaları: kesintiler + kalan (kalan negatifse çubukta gösterilmez).
export function barSegments(b) {
  const rows = breakdownRows(b);
  if (rows.length === 0 || !(b.sales > 0)) return [];
  const used = rows.reduce((s, r) => s + r.pct, 0);
  const segs = rows
    .filter(r => r.pct > 0)
    .map(r => ({ key: r.key, pct: r.pct, color: SEGMENT_COLORS[r.key] }));
  const rest = Math.max(0, 100 - used);
  if (rest > 0) segs.push({ key: 'kalan', pct: rest, color: SEGMENT_COLORS.kalan });
  return segs;
}

export function fmtPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `%${Math.round(n).toLocaleString('tr-TR')}`;
}
