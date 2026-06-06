// Makbuz (Teşekkür Makbuzu) veri modeli — saf, React'siz, test edilebilir çekirdek.
//
// İki giriş noktasından (satış anı cart'ı + profil items[] payload'u) gelen şekli
// TEK normalize modele indirger. Makbuz bilinçli olarak ödeme/finansal bilgi
// içermez (resmi fatura değil); tüm içerik satış kaydından türetilir, böylece
// görüntü saklamadan istendiğinde yeniden üretilebilir.

const FOOTER_CONTACT = '@okaliptusyoga · okaliptusyoga.com';

// tr-TR: binlik ayracı nokta, ondalık virgül. Makbuz formal belge → HER ZAMAN
// iki ondalık (örn. "4.640,00 TL", "125,50 TL"). Sistem geneli fmtTL (₺,
// yuvarlak) ayrı bir bağlam; makbuz bilinçli olarak 2 haneye tamamlar.
const TL_FRACTION = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Tarih + saat Europe/Istanbul'a sabit: makbuz hangi cihazda/zaman diliminde
// yeniden üretilirse üretilsin aynı tarih/saati gösterir (işletme TZ'i).
const DATE_FMT = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul' });
const TIME_FMT = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Istanbul' });

export function fmtReceiptTL(value) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return `${TL_FRACTION.format(safe)} TL`;
}

export function fmtReceiptDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return DATE_FMT.format(d);
}

// Saat — 24 saat "15:00" (Europe/Istanbul). Geçersiz tarihte boş döner.
export function fmtReceiptTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return TIME_FMT.format(d);
}

// Deterministik makbuz numarası: yıl + 4 haneli satış id'si. Aynı satış her zaman
// aynı numarayı üretir (yeniden üretim için şart).
export function receiptNo(saleId, soldAt) {
  const year = soldAt && !Number.isNaN(new Date(soldAt).getTime())
    ? new Date(soldAt).getFullYear()
    : new Date().getFullYear();
  const digits = String(saleId ?? '').replace(/\D/g, '') || '0';
  return `OK-${year}-${digits.padStart(4, '0')}`;
}

function normalizedItem({ name, qty, lineValue, imageUrl, variantLabel }) {
  const desc = variantLabel != null ? String(variantLabel).trim() : '';
  return {
    name: (name ?? '').toString(),
    // Varyant etiketi (örn. "Büyük" / "Küçük") — ürün adının altında ikincil
    // satır. Aynı ada sahip varyantları (tuz lambası büyük/küçük) ayırır.
    desc: desc || null,
    qty: Number(qty) || 0,
    lineText: fmtReceiptTL(lineValue),
    // Aday görsel URL'i; rasterize öncesi data URL'e çözülür, başarısızsa placeholder.
    thumbSrc: imageUrl || null,
  };
}

// Giriş A — satış anı. cart: Map<any, { product, quantity }>.
export function buildModelFromCart({ cart, student, saleId, soldAt }) {
  const entries = cart instanceof Map ? Array.from(cart.values()) : Array.isArray(cart) ? cart : [];
  let total = 0;
  const items = entries.map((it) => {
    const qty = Number(it?.quantity) || 0;
    const unit = Number(it?.product?.price) || 0;
    const line = unit * qty;
    total += line;
    return normalizedItem({
      name: it?.product?.name,
      qty,
      lineValue: line,
      imageUrl: it?.product?.image_url,
      variantLabel: it?.product?.variant_label,
    });
  });
  const totalText = fmtReceiptTL(total);
  return {
    receiptNo: receiptNo(saleId, soldAt),
    customerName: (student?.full_name ?? '').toString(),
    dateText: fmtReceiptDate(soldAt),
    timeText: fmtReceiptTime(soldAt),
    items,
    subtotalText: totalText, // ürün satışında indirim yok → ara toplam = toplam
    totalText,
    footerContact: FOOTER_CONTACT,
  };
}

// Giriş B — profilden yeniden üretim. sale: v_product_sale_balances satırı +
// items[] (name_snapshot, unit_price_snapshot, quantity, line_total, image_url).
export function buildModelFromSale({ sale, student }) {
  const rawItems = Array.isArray(sale?.items) ? sale.items : [];
  const items = rawItems.map((it) => normalizedItem({
    name: it?.name_snapshot,
    qty: it?.quantity,
    lineValue: it?.line_total,
    imageUrl: it?.image_url,
    variantLabel: it?.variant_label,
  }));
  const totalText = fmtReceiptTL(sale?.total_amount);
  return {
    receiptNo: receiptNo(sale?.product_sale_id, sale?.sold_at),
    customerName: (student?.full_name ?? '').toString(),
    dateText: fmtReceiptDate(sale?.sold_at),
    timeText: fmtReceiptTime(sale?.sold_at),
    items,
    subtotalText: totalText,
    totalText,
    footerContact: FOOTER_CONTACT,
  };
}
