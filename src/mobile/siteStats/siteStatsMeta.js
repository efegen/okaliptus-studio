// Site ekranının metin ve biçim yardımcıları. Veri: GET /site-stats/overview
// ve /site-stats/live (bkz. backend/src/services/site-stats.service.ts).

export const PERIODS = [
  { id: 'today', label: 'Bugün', previous: 'Dünden' },
  { id: '7d', label: '7 gün', previous: 'Önceki 7 günden' },
  { id: '30d', label: '30 gün', previous: 'Önceki 30 günden' },
];

export const SECTIONS = [
  { id: 'ozet', label: 'Özet' },
  { id: 'kaynaklar', label: 'Kaynaklar' },
  { id: 'reklamlar', label: 'Reklamlar' },
  { id: 'yapay-zeka', label: 'Yapay zekâ' },
];

// logo: sourceLogos.js anahtarı; yoksa icon (link | globe | search).
const SOURCES = {
  instagram_ad: { label: 'Instagram reklamı', logo: 'instagram' },
  facebook_ad: { label: 'Facebook reklamı', logo: 'meta' },
  google_ad: { label: 'Google reklamı', logo: 'google' },
  instagram: { label: 'Instagram profili ve hikâyeler', short: 'Instagram', logo: 'instagram' },
  facebook: { label: 'Facebook', logo: 'meta' },
  google: { label: 'Google', logo: 'google' },
  bing: { label: 'Bing', icon: 'search' },
  yandex: { label: 'Yandex', icon: 'search' },
  duckduckgo: { label: 'DuckDuckGo', icon: 'search' },
  chatgpt: { label: 'ChatGPT', logo: 'chatgpt' },
  perplexity: { label: 'Perplexity', logo: 'perplexity' },
  gemini: { label: 'Gemini', logo: 'gemini' },
  claude: { label: 'Claude', logo: 'claude' },
  copilot: { label: 'Copilot', icon: 'globe' },
  direct: { label: 'Adresi yazarak', icon: 'link' },
  other: { label: 'Başka siteler', icon: 'globe' },
};

export const AI_SOURCES = ['chatgpt', 'perplexity', 'gemini', 'claude', 'copilot'];

export function sourceMeta(source) {
  return SOURCES[source] ?? { label: source || 'Bilinmiyor', icon: 'globe' };
}

export const isAdSource = (source) => typeof source === 'string' && source.endsWith('_ad');

const nf = new Intl.NumberFormat('tr-TR');
export const num = (n) => nf.format(Math.round(Number(n) || 0));

/** 134000 → "2 dk 14 sn"; 48000 → "48 sn"; 3900000 → "1 sa 5 dk". */
export function duration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (total < 60) return `${total} sn`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m ? `${h} sa ${m} dk` : `${h} sa`;
  return s ? `${m} dk ${String(s).padStart(2, '0')} sn` : `${m} dk`;
}

/** Yüzde, en az 1 (0'dan büyükse): çubuk genişlikleri ve "yüzde N" metinleri. */
export function percent(part, whole) {
  const p = Number(part) || 0;
  const w = Number(whole) || 0;
  if (w <= 0 || p <= 0) return 0;
  return Math.max(1, Math.round((p / w) * 100));
}

/** Önceki döneme göre değişim: { text, tone } ya da null (karşılaştırılacak veri yok). */
export function changeText(current, previous, periodId) {
  const prev = Number(previous) || 0;
  const cur = Number(current) || 0;
  if (prev <= 0) return null;
  const label = PERIODS.find((p) => p.id === periodId)?.previous ?? 'Önceki dönemden';
  const diff = Math.round(((cur - prev) / prev) * 100);
  if (diff === 0) return { text: `${label} farksız`, tone: 'flat' };
  return diff > 0
    ? { text: `${label} %${diff} fazla`, tone: 'up' }
    : { text: `${label} %${Math.abs(diff)} az`, tone: 'down' };
}

const DAY_NAMES = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** "2026-11-23" → { name: "Pzt", day: 23, month: "Kasım" } (saat dilimi kaymadan). */
export function dayParts(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  return { name: DAY_NAMES[date.getUTCDay()], day: d, month: MONTHS[(m || 1) - 1] };
}

/** "17–23 Kasım" ya da "25 Ekim – 23 Kasım". */
export function rangeLabel(fromIso, toIso) {
  const a = dayParts(fromIso);
  const b = dayParts(toIso);
  if (fromIso === toIso) return `${b.day} ${b.month}`;
  return a.month === b.month ? `${a.day}–${b.day} ${b.month}` : `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

const DEVICES = { phone: 'Telefon', desktop: 'Bilgisayar', tablet: 'Tablet' };
export const deviceLabel = (device) => DEVICES[device] ?? 'Bilinmiyor';

export const regionLabel = (region) => region || 'Bilinmiyor ya da yurt dışı';

/** Sayfanın adı: sitenin gönderdiği kısa ad, yoksa yol. */
export const pageLabel = (item) => item?.title || item?.path || 'Sayfa';

const FORM_LABELS = { camp: 'Ön kayıt', lesson: 'Ders talebi', contact: 'Mesaj' };
const FORM_OPEN_TEXT = { camp: 'Ön kayıt formu açık', lesson: 'Ders formu açık', contact: 'İletişim formu açık' };
export const formOpenText = (label) => FORM_OPEN_TEXT[label] ?? 'Form açık';

/** "6 ön kayıt, 2 ders, 1 mesaj" */
export function inquiryKindsText(byKind = {}) {
  const parts = [];
  if (byKind.camp) parts.push(`${num(byKind.camp)} ön kayıt`);
  if (byKind.lesson) parts.push(`${num(byKind.lesson)} ders`);
  if (byKind.contact) parts.push(`${num(byKind.contact)} mesaj`);
  return parts.join(', ');
}

/** Reklamın ya da canlı ziyaretçinin kaynağı: "Instagram reklamı: Kamp, Video 2". */
export function sourceLine(v) {
  const meta = sourceMeta(v.source);
  const base = meta.short ?? meta.label;
  const tags = [v.campaign, v.content].filter(Boolean).join(', ');
  if (tags) return `${base}: ${tags}`;
  if (v.source === 'other' && v.referrerHost) return v.referrerHost;
  if (AI_SOURCES.includes(v.source)) return `${base} cevabındaki bağlantıdan`;
  if (v.source === 'google') return 'Google araması';
  if (v.source === 'direct') return 'Adresi yazarak geldi';
  return base;
}

/**
 * Bir formun yolu: sayfayı açan → bölümü gören → formu açan → yazmaya başlayan →
 * gönderen. Veri yoksa null. `overview.pages` yalnız en çok açılan sayfaları taşır.
 */
export function funnelFor(overview, kind) {
  const form = overview?.forms?.[kind];
  const pages = overview?.pages ?? [];
  const page = kind === 'camp'
    ? pages.filter((p) => p.path.startsWith('/etkinlikler/')).sort((a, b) => b.visits - a.visits)[0]
    : kind === 'lesson'
      ? pages.find((p) => p.path === '/dersler')
      : null;
  if (!page || (!form && page.visits === 0)) return null;
  const section = kind === 'camp' ? 'giris' : 'form';
  const steps = [
    { label: 'Sayfayı açan', value: page.visits },
    { label: kind === 'camp' ? 'Fiyatı gören' : 'Forma inen', value: page.sections?.[section] ?? 0 },
  ];
  if (kind === 'camp') steps.push({ label: 'Formu açan', value: form?.open ?? 0 });
  steps.push({ label: 'Yazmaya başlayan', value: form?.start ?? 0 });
  steps.push({ label: kind === 'camp' ? 'Ön kayıt gönderen' : 'Talep gönderen', value: form?.submit ?? 0, final: true });
  return { kind, title: kind === 'camp' ? 'Ön kayıt yolu' : 'Ders talebi yolu', page: pageLabel(page), steps, form: FORM_LABELS[kind] };
}

/** Reklam etiketi için Meta'nın "URL parametreleri" alanına yazılacak satır. */
export const AD_URL_PARAMS = 'utm_source=ig&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}';
