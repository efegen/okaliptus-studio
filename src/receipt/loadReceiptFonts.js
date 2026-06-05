// Capture öncesi makbuz fontlarının (Cormorant Garamond + Jost) decode'unu
// garanti eder. @font-face kuralları receipt.css'te tanımlı; burada
// document.fonts.load'u TÜRKÇE örnek metinle çağırınca tarayıcı hem latin hem
// latin-ext alt kümelerini (ş ğ İ Ş Ğ latin-ext'te) indirir. Memoize edilir.

const SAMPLE = 'Teşekkür Makbuzu AİIıŞşĞğÇçÖöÜü 0123456789 TL';

const SPECS = [
  "600 16px 'Cormorant Garamond'",
  "700 16px 'Cormorant Garamond'",
  "italic 600 16px 'Cormorant Garamond'",
  "300 16px 'Jost'",
  "400 16px 'Jost'",
  "500 16px 'Jost'",
];

let cached = null;

export function loadReceiptFonts() {
  if (cached) return cached;
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  cached = Promise.all(SPECS.map((spec) => document.fonts.load(spec, SAMPLE).catch(() => null)))
    .then(() => document.fonts.ready)
    .catch(() => undefined);
  return cached;
}
