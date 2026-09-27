// Pazaryeri siparişleri — web (src/orders.jsx) ve mobil (src/mobile/MobileOrders*.jsx)
// ekranlarının ORTAK yardımcıları: kargo firma listesi, TY firma adı → kod tanıma, logo
// eşleşmesi ve kargo firması değişikliği TAKİBİ.
//
// Kargo değişikliği takibi: Trendyol değişikliği ASENKRON uygular (PUT 200 dönse de
// getOrders bir süre eski firmayı döndürür). Sunucu her değişikliği izler ve siparişe
// `cargoChange` iliştirir (backend cargo-change-tracker.ts): pending → applied |
// unconfirmed. Ekranlar useCargoChangeWatcher ile bekleyenleri yoklar; dönen durum +
// taze paket verisi buradaki applyCargoChangeStatuses ile sipariş önbelleğine yamanır →
// liste ve detay aynı anda, sayfa yenilemeden güncellenir.

import { getCargoChangeStatuses } from './api';
import { queryKeys } from './hooks/queryKeys';

// Trendyol API yalnız son ~3 ayı döndürür; web + mobil varsayılan pencere.
export const ORDERS_WINDOW_DAYS = 90;

// Trendyol pazaryeri kargo firma KODLARI ("Kargo Firması Değiştir" seçenekleri).
// Backend whitelist'iyle (backend/src/services/trendyol/cargo-providers.ts) SENKRON
// tutulmalı — backend güvenlik sınırıdır, tanımsız kodu 422 ile reddeder. `aliases`,
// TY'nin serbest firma adından ("Yurtiçi Kargo Marketplace") kodu tanımak içindir.
export const CARGO_PROVIDERS = [
  { code: 'YKMP', name: 'Yurtiçi Kargo', aliases: ['yurtici'] },
  { code: 'ARASMP', name: 'Aras Kargo', aliases: ['aras'] },
  { code: 'SURATMP', name: 'Sürat Kargo', aliases: ['surat'] },
  { code: 'HOROZMP', name: 'Horoz Kargo', aliases: ['horoz'] },
  { code: 'PTTMP', name: 'PTT Kargo', aliases: ['ptt'] },
  { code: 'CEVAMP', name: 'CEVA Kargo', aliases: ['ceva'] },
  { code: 'TEXMP', name: 'Trendyol Express', aliases: ['trendyol express', 'tex'] },
  { code: 'DHLECOMMP', name: 'DHL eCommerce', aliases: ['dhl'] },
  { code: 'KOLAYGELSINMP', name: 'Kolay Gelsin', aliases: ['kolay gelsin', 'kolaygelsin'] },
];

// "YURTİÇİ Kargo" / "Yurtici-Kargo" → "yurtici kargo" (Türkçe İ/ı ve aksanlar katlanır).
function foldCargoName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// TY firma adı → whitelist kodu (bütün-kelime eşleşmesi; tanınmazsa null).
export function cargoProviderCodeFromName(name) {
  if (!name) return null;
  const padded = ` ${foldCargoName(name)} `;
  const hit = CARGO_PROVIDERS.find(p => p.aliases.some(a => padded.includes(` ${a} `)));
  return hit ? hit.code : null;
}

// ─── Kargo firması logoları ──────────────────────────────────────────────────
// TY sipariş yanıtında yalnız firma adı (cargoProviderName) geliyor; logo kodu yok.
// Bu yüzden ad → TY CDN logo URL'i eşleştirilir. Logosu olmayan firmalar kısa koda düşer.
const CARGO_LOGOS = {
  ptt: 'https://cdn.dsmcdn.com/seller-center/oms/nexus/cargo-provider/19.png',
  aras: 'https://cdn.dsmcdn.com/seller-center/oms/nexus/cargo-provider/7.png',
};

export function getCargoLogo(provider) {
  if (!provider) return null;
  const lower = provider.toLocaleLowerCase('tr-TR');
  if (lower.includes('ptt')) return CARGO_LOGOS.ptt;
  if (lower.includes('aras')) return CARGO_LOGOS.aras;
  return null;
}

export function cargoCode(provider) {
  if (!provider) return '?';
  return provider.trim().split(/\s+/)[0].slice(0, 3).toLocaleUpperCase('tr-TR');
}

// "14:32" (Europe/Istanbul). Metinde ek almadan kullanılır ("saat 14:32 itibarıyla").
export function fmtClock(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
}

// ─── Kargo firması değişikliği takibi ────────────────────────────────────────

// Bekleyen değişiklik varken sunucu bu aralıkla yoklanır (sunucu TY'ye kendi
// aralığıyla gider; bu yoklama ucuzdur, TY'ye her seferinde çıkmaz).
export const CARGO_WATCH_INTERVAL_MS = 3000;

// Onayı beklenen paketlerin numaraları (sıralı, tekil).
export function pendingCargoPackageIds(orders) {
  const ids = new Set();
  for (const o of orders || []) {
    if (o && o.packageId && o.cargoChange && o.cargoChange.status === 'pending') ids.add(o.packageId);
  }
  return [...ids].sort();
}

// Açılmış bir siparişin listedeki güncel hâli: id → paket no → (tek paketliyse) sipariş no.
// TY kargo değişikliğinde paketi yeniden numaralandırsa bile detay kaybolmaz.
export function findOrderIn(orders, ref) {
  if (!ref || !Array.isArray(orders)) return null;
  const byId = orders.find(o => o.id === ref.id);
  if (byId) return byId;
  if (ref.packageId) {
    const byPackage = orders.find(o => o.packageId === ref.packageId);
    if (byPackage) return byPackage;
  }
  const same = orders.filter(o => o.orderNumber === ref.orderNumber);
  return same.length === 1 ? same[0] : null;
}

// Saf: { orders, tabCounts, total } listesine durum yanıtlarını uygular
// ([{ packageId, change, order }]). Değişen bir şey yoksa AYNI nesneyi döndürür.
// `order` varsa paket taze veriyle değiştirilir; `change` null ise takip bilgisi kalkar.
export function patchOrdersList(data, statuses) {
  if (!data || !Array.isArray(data.orders) || !Array.isArray(statuses)) return data;
  let orders = data.orders;
  let tabCounts = data.tabCounts;
  for (const s of statuses) {
    if (!s || !s.packageId) continue;
    const idx = orders.findIndex(o => o.packageId === s.packageId);
    if (idx < 0) continue;
    const cur = orders[idx];
    const next = { ...(s.order || cur) };
    if (s.change) next.cargoChange = s.change;
    else delete next.cargoChange;
    if (JSON.stringify(next) === JSON.stringify(cur)) continue;
    if (orders === data.orders) orders = orders.slice();
    orders[idx] = next;
    if (next.tab !== cur.tab && tabCounts) {
      tabCounts = { ...tabCounts };
      tabCounts[cur.tab] = Math.max(0, (tabCounts[cur.tab] || 0) - 1);
      tabCounts[next.tab] = (tabCounts[next.tab] || 0) + 1;
    }
  }
  return orders === data.orders ? data : { ...data, orders, tabCounts };
}

// Tüm sipariş önbelleklerine (web dönemleri + mobil pencere) durum yanıtlarını yamar.
// Listenin "Son güncelleme" zamanı korunur (tek paket yaması tüm listeyi taze yapmaz).
// Paket hiçbir önbellekte yoksa false döner.
export function applyCargoChangeStatuses(queryClient, statuses) {
  let found = false;
  for (const [key, data] of queryClient.getQueriesData({ queryKey: queryKeys.trendyolOrders() })) {
    if (!data || !Array.isArray(data.orders)) continue;
    if (statuses.some(s => s && data.orders.some(o => o.packageId === s.packageId))) found = true;
    const next = patchOrdersList(data, statuses);
    if (next !== data) {
      queryClient.setQueryData(key, next, { updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt });
    }
  }
  return found;
}

// Başarılı "Kargo Firması Değiştir" sonrası: siparişi hemen "onay bekleniyor"a çeker
// (watcher yoklamayı başlatır). Paket önbellekte yoksa listeyi sunucudan tazeler —
// sunucu yanıtı zaten cargoChange taşır.
export function markCargoChangeRequested(queryClient, order, change) {
  if (!order || !order.packageId || !change) return;
  const found = applyCargoChangeStatuses(queryClient, [{ packageId: order.packageId, change, order: null }]);
  if (!found) queryClient.invalidateQueries({ queryKey: queryKeys.trendyolOrders() });
}

// "Tekrar kontrol et": sunucuya TY'den hemen hedefli kontrol yaptırır ve sonucu yamar.
export async function recheckCargoChange(queryClient, packageId) {
  const statuses = await getCargoChangeStatuses([packageId], { check: true });
  applyCargoChangeStatuses(queryClient, statuses);
  const hit = statuses.find(s => s.packageId === packageId);
  return hit ? hit.change : null;
}
