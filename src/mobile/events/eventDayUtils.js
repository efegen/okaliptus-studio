// Etkinlik günü ekranının saf yardımcıları (bkz. MobileEventDay.jsx,
// EventDayEntrySheet.jsx). Bileşenlerden ayrı tutulur ki test edilebilsin.
import { fmtTL } from '../../data';

export const PAYMENT_METHODS = [
  { id: 'cash', label: 'Nakit' },
  { id: 'card', label: 'Kart' },
  { id: 'iban', label: 'IBAN' },
];

export const PAYMENT_METHOD_LABEL = { cash: 'Nakit', card: 'Kart', iban: 'IBAN' };

// Kahvaltı durumu tek, düz seçim listesi — "almayacak" da (none) diğerleri
// gibi doğrudan seçilebilir bir seçenek, ayrı bir aç/kapa anahtarı yok.
// "Restorana kendi öder" bilinçli olarak geçmiş zaman değil ("ödedi" değil) —
// kapıdaki ilk kayıt anında bu ödeme henüz gerçekleşmemiştir, kaydedilen şey
// bir niyet/sorumluluktur. "Stüdyo öder" kahvaltıda kişiden ücret alınmaz,
// ama restorana yine biz (stüdyo) öderiz — bedava değil, ödeyen değişir.
export const BREAKFAST_OPTIONS = [
  { id: 'paid_to_us', label: 'Bize ödedi' },
  { id: 'paid_to_restaurant', label: 'Restorana kendi öder' },
  { id: 'free', label: 'Stüdyo öder' },
  { id: 'none', label: 'Almayacak' },
];

// Sadece kahvaltı misafiri (derse hiç katılmıyor, bkz. MobileEventDayBreakfast)
// için "Almayacak" anlamsız — bu satırı açmanın tek sebebi kahvaltı.
export function breakfastOptionsFor(breakfastOnly) {
  return breakfastOnly ? BREAKFAST_OPTIONS.filter((option) => option.id !== 'none') : BREAKFAST_OPTIONS;
}

export const BREAKFAST_SHORT_LABEL = {
  paid_to_us: 'Kahvaltı bize',
  paid_to_restaurant: 'Kahvaltı restoranda',
  free: 'Kahvaltı stüdyo öder',
};

const TR_FOLD = {
  Ç: 'c', Ğ: 'g', İ: 'i', I: 'i', Ö: 'o', Ş: 's', Ü: 'u',
  ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u',
  Â: 'a', â: 'a', Î: 'i', î: 'i', Û: 'u', û: 'u',
};

// "Ayşe" ile "ayse" aynı sayılsın diye Türkçe harfleri ASCII küçük harfe
// katlar (sunucudaki foldTr ile aynı tablo).
export function foldTr(value) {
  return String(value ?? '').replace(/[ÇĞİIÖŞÜçğıöşüÂâÎîÛû]/g, (ch) => TR_FOLD[ch]).toLowerCase();
}

export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Maskeli telefon alanı: yalnız TR cep, ulusal 10 hane (5XXXXXXXXX). Her
// değişiklikte ham metinden rakamlar yeniden çıkarılır; baştaki 0 / +90
// atılır, 5 ile başlamayan giriş kabul edilmez.
export function phoneDigitsFromInput(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.slice(1);
  else if (digits.startsWith('90') && digits.length > 10) digits = digits.slice(2);
  if (digits && digits[0] !== '5') return '';
  return digits.slice(0, 10);
}

export function formatPhoneMask(digits) {
  const d = String(digits ?? '');
  if (!d) return '';
  let out = `0 (${d.slice(0, 3)}`;
  if (d.length > 3) out += `) ${d.slice(3, 6)}`;
  if (d.length > 6) out += ` ${d.slice(6, 8)}`;
  if (d.length > 8) out += ` ${d.slice(8, 10)}`;
  return out;
}

export function isCompletePhone(digits) {
  return /^5\d{9}$/.test(String(digits ?? ''));
}

// Kayıtlı öğrencinin telefonu serbest metin olabilir; ulusal 10 haneye
// indirgenebiliyorsa o hane dizisi, değilse null.
export function nationalDigits(phone) {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

export function formatPhoneDisplay(phone) {
  if (!phone) return '';
  const digits = nationalDigits(phone);
  return digits ? formatPhoneMask(digits) : String(phone).trim();
}

export function samePhone(phone, digits) {
  return Boolean(digits) && nationalDigits(phone) === digits;
}

// Arama kutusuna yalnız rakam/telefon biçim karakteri yazıldıysa telefon
// araması sayılır (sunucudaki searchEventDay ile aynı kural).
export function isPhoneQuery(query) {
  const text = String(query ?? '').trim();
  return /^[\d\s()+-]+$/.test(text) && text.replace(/\D/g, '').length >= 2;
}

// Alınan tutar: yalnız tam lira, rakam dışı her şey atılır. 6 hane (999.999 ₺)
// tavanı fazladan bir sıfır/hane yazan fat-finger hatalarını en baştan keser.
export function amountDigits(raw) {
  return String(raw ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 6);
}

// "Tam ödeme" = ders ücreti + (kahvaltı bize ödendiyse) kahvaltı ücreti.
// Sadece kahvaltı misafiri (skipLesson) derse katılmadığı için ders ücreti
// hiç hesaba girmez.
export function fullAmountFor(pricing, breakfast, { skipLesson = false } = {}) {
  const lesson = skipLesson ? 0 : toNumber(pricing?.lessonFee);
  return lesson + (breakfast === 'paid_to_us' ? toNumber(pricing?.breakfastFee) : 0);
}

// Kartla ödeyen kahvaltıyı restorana kendisi öder; nakit/IBAN'da kahvaltı
// parası bize gelir. Kullanıcı kahvaltı seçimine elle dokunmadıysa yöntem
// seçimi bu varsayılanı uygular.
export function defaultBreakfastFor(method) {
  return method === 'card' ? 'paid_to_restaurant' : 'paid_to_us';
}

// Kaydet'i kapatan ilk sorun ya da null. `code` arayüzün mesajı ne kadar
// vurgulayacağını seçer: kural ihlalleri (breakfast/phone) kırmızı, eksik
// alanlar sade ipucu olarak gösterilir.
export function validateEntryDraft({ amount, method, breakfast, pricing, isLight, name = '', phone = '' }) {
  if (isLight && !String(name).trim()) return { code: 'name', message: 'Ad soyad girin.' };
  if (isLight && phone && !isCompletePhone(phone)) {
    return { code: 'phone', message: 'Telefon numarası eksik — 10 hane olmalı.' };
  }
  if (amount === '' || amount == null) return { code: 'amount', message: 'Alınan tutarı girin (ücretsizse 0).' };
  const value = toNumber(amount);
  if (value > 0 && !method) return { code: 'method', message: 'Ödeme yöntemini seçin.' };
  if (breakfast === 'paid_to_us' && pricing?.breakfastFee != null && value < toNumber(pricing.breakfastFee)) {
    return {
      code: 'breakfast',
      message: `Kahvaltı ücreti (${fmtTL(toNumber(pricing.breakfastFee))}) tam alınmalı.`,
    };
  }
  return null;
}
