// Talepler (web sitesi formları) ekranlarının ortak sözlüğü ve biçimleri.
// Tasarım kaynağı: "Studio Talepler mobil" canvas'ı (Liste, OnKayit, Ders,
// Mesaj, Supheli). Tarihler İstanbul saatine göre.

const TZ = 'Europe/Istanbul';

export const KIND_META = {
  camp: { tag: 'Ön kayıt', title: 'Ön kayıt', convertedButton: 'Kesin kayda dönüştü', converted: 'Kayda dönüştü' },
  lesson: { tag: 'Ders', title: 'Ders talebi', convertedButton: 'Derse başladı', converted: 'Derse başladı' },
  contact: { tag: 'Mesaj', title: 'Mesaj', convertedButton: 'Sonuçlandı', converted: 'Sonuçlandı' },
};

export function kindMeta(kind) {
  return KIND_META[kind] ?? KIND_META.contact;
}

/** Durum rozeti: { label, tone } — tone: new | contacted | converted | muted */
export function statusMeta(status, kind) {
  switch (status) {
    case 'new': return { label: 'Yeni', tone: 'new' };
    case 'contacted': return { label: 'Dönüş yapıldı', tone: 'contacted' };
    case 'converted': return { label: kindMeta(kind).converted, tone: 'converted' };
    case 'closed': return { label: 'Kapandı', tone: 'muted' };
    case 'spam': return { label: 'Spam', tone: 'muted' };
    default: return { label: status || '', tone: 'muted' };
  }
}

export const SUSPECT_REASONS = {
  trap: { label: 'Gizli alan dolu geldi', hint: '' },
  too_fast: { label: 'Çok hızlı gönderildi', hint: 'Tarayıcı formu otomatik doldurmuş olabilir.' },
  no_origin: { label: 'Siteden gelmemiş', hint: '' },
  burst: { label: 'Aynı ağdan kısa sürede çok gönderim', hint: 'Aynı ağdan 10 dakikada 5’ten fazla form geldi.' },
  captcha: { label: 'Robot doğrulamasını geçmedi', hint: '' },
};

export function suspectReason(reason) {
  return SUSPECT_REASONS[reason] ?? { label: 'Şüpheli', hint: '' };
}

// ─── Tarih ──────────────────────────────────────────────────────────────────
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const shortDateFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'short' });
const shortDateYearFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, month: 'long', year: 'numeric' });
const WEEKDAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const WEEKDAY_LONG = ['pazar', 'pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi'];

function toDate(value) {
  if (value instanceof Date) return value;
  // Postgres ::text biçimi "2026-11-22 14:32:05.285496+03" → katı ISO
  // (Safari en fazla 3 haneli kesir ve "+03:00" biçimli dilim kabul eder).
  const s = String(value || '')
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date(value) : d;
}

// İstanbul'daki takvim günü → UTC gece yarısı (gün farkı hesabı için).
function dayStamp(date) {
  const [y, m, d] = dayFmt.format(date).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function weekdayIndex(date) {
  return new Date(dayStamp(date)).getUTCDay();
}

/** Bugünden kaç takvim günü önce (İstanbul). */
export function daysAgo(value, now = new Date()) {
  return Math.round((dayStamp(now) - dayStamp(toDate(value))) / 86400000);
}

// Pazartesi başlangıçlı hafta farkı: 0 bu hafta, 1 geçen hafta.
function weeksAgo(value, now) {
  const mondayOf = (date) => dayStamp(date) - ((weekdayIndex(date) + 6) % 7) * 86400000;
  return Math.round((mondayOf(now) - mondayOf(toDate(value))) / (7 * 86400000));
}

/** Liste grubu: Bugün, Dün, Bu hafta, Geçen hafta, "Kasım 2026". */
export function groupLabel(value, now = new Date()) {
  const d = toDate(value);
  const days = daysAgo(d, now);
  if (days <= 0) return 'Bugün';
  if (days === 1) return 'Dün';
  const weeks = weeksAgo(d, now);
  if (weeks === 0) return 'Bu hafta';
  if (weeks === 1) return 'Geçen hafta';
  const label = monthFmt.format(d);
  return label.charAt(0).toLocaleUpperCase('tr-TR') + label.slice(1);
}

/** Satırın sağındaki kısa zaman: 14:32 · Per · 14 Kas. */
export function rowTime(value, now = new Date()) {
  const d = toDate(value);
  const days = daysAgo(d, now);
  if (days <= 1) return timeFmt.format(d);
  if (days < 7) return WEEKDAY_SHORT[weekdayIndex(d)];
  const sameYear = dayFmt.format(d).slice(0, 4) === dayFmt.format(now).slice(0, 4);
  return (sameYear ? shortDateFmt : shortDateYearFmt).format(d);
}

/** Detay başlığı: Bugün 14:32 · Dün 18:40 · 14 Kas 09:12. */
export function longTime(value, now = new Date()) {
  const d = toDate(value);
  const days = daysAgo(d, now);
  if (days <= 0) return `Bugün ${timeFmt.format(d)}`;
  if (days === 1) return `Dün ${timeFmt.format(d)}`;
  return `${shortDateFmt.format(d)} ${timeFmt.format(d)}`;
}

/** Cümle içi zaman: bugün 14:40 · dün 14:05 · perşembe 16:20 · 14 Kas. */
function inlineTime(value, now) {
  const d = toDate(value);
  const days = daysAgo(d, now);
  if (days <= 0) return `bugün ${timeFmt.format(d)}`;
  if (days === 1) return `dün ${timeFmt.format(d)}`;
  if (days < 7) return `${WEEKDAY_LONG[weekdayIndex(d)]} ${timeFmt.format(d)}`;
  return shortDateFmt.format(d);
}

const HANDLED_VERBS = {
  contacted: ['dönüş yaptın', 'dönüş yaptı'],
  closed: ['kapattın', 'kapattı'],
  spam: ['spam olarak işaretledin', 'spam olarak işaretledi'],
};
const CONVERTED_VERBS = {
  camp: ['kesin kayda dönüştürdün', 'kesin kayda dönüştürdü'],
  lesson: ['derse başladı olarak işaretledin', 'derse başladı olarak işaretledi'],
  contact: ['sonuçlandı olarak işaretledin', 'sonuçlandı olarak işaretledi'],
};

/** "Sen dönüş yaptın, dün 14:05" — durum "yeni" ise ya da işleyen yoksa boş. */
export function handledText(inquiry, meId, now = new Date()) {
  if (!inquiry?.handledBy || !inquiry.handledAt || inquiry.status === 'new') return '';
  const verbs = inquiry.status === 'converted'
    ? CONVERTED_VERBS[inquiry.kind] ?? CONVERTED_VERBS.contact
    : HANDLED_VERBS[inquiry.status];
  if (!verbs) return '';
  const isMe = meId != null && String(inquiry.handledBy.id) === String(meId);
  const who = isMe ? 'Sen' : (inquiry.handledBy.name || 'Biri');
  return `${who} ${isMe ? verbs[0] : verbs[1]}, ${inlineTime(inquiry.handledAt, now)}`;
}

// ─── İletişim bağlantıları ──────────────────────────────────────────────────
export function telHref(phone) {
  const clean = String(phone || '').replace(/[^+\d]/g, '');
  return clean ? `tel:${clean}` : null;
}

/** wa.me numarası: 0532… / 532… → 90532…; +90… / 0090… → 90… */
export function whatsappHref(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = `90${digits.slice(1)}`;
  else if (digits.length === 10 && digits.startsWith('5')) digits = `90${digits}`;
  return `https://wa.me/${digits}`;
}

export function mailHref(email) {
  return email ? `mailto:${email}` : null;
}

/** Mesajın tek satırlık başı (liste satırı için). */
export function excerpt(text, max = 90) {
  if (!text) return '';
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const points = [...flat];
  return points.length > max ? `${points.slice(0, max).join('').trimEnd()}…` : flat;
}

/** Detaydaki bilgi satırları: [{ label, value, sub? }] */
export function detailRows(kind, details = {}) {
  const s = (k) => (typeof details[k] === 'string' && details[k].trim() ? details[k].trim() : null);
  if (kind === 'camp') {
    const people = Number(details.people);
    return [
      { label: 'Etkinlik', value: s('eventTitle') ?? s('event'), sub: s('eventDate') },
      { label: 'Giriş', value: s('entryLabel') ?? s('entry') },
      { label: 'Kişi sayısı', value: Number.isInteger(people) && people > 0 ? `${people} kişi, kendisi dahil` : null },
      { label: 'Oda tercihi', value: s('roomLabel') ?? s('room') },
      { label: 'Gördüğü fiyat', value: s('price') },
    ].filter((r) => r.value);
  }
  if (kind === 'lesson') {
    const mode = s('modeLabel') ?? (details.mode === 'online' ? 'Online' : details.mode === 'studyo' ? 'Stüdyoda, yüz yüze' : s('mode'));
    return [
      { label: 'Nerede', value: mode },
      { label: 'Şehir', value: s('city') },
    ].filter((r) => r.value);
  }
  return [{ label: 'Konu', value: s('topicLabel') ?? s('topic') }].filter((r) => r.value);
}
