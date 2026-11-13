// Başarılı her yazma isteğinden (POST/PUT/PATCH/DELETE) sonra hangi önbellek
// gruplarının tazeleneceğini TEK yerde tanımlar. Eskiden her ekran kendi
// listesini tutuyordu ve bazıları eksikti (ör. takvimden tahsilat öğrenci
// profilini tazelemiyordu). Artık api.js her başarılı yazmadan sonra buraya
// sorar; ekranlardaki eski invalidate çağrıları zararsız şekilde yerinde kalır.
//
// Bilerek DIŞARIDA bırakılanlar (kendi dikkatli tazeleme mantıkları var):
// notlar (iyimser güncelleme + görüldü takibi), Trendyol (kargo değişikliği
// snapshot yaması; bazı POST'lar salt okuma), etkinliklerin kendi anahtarları,
// kullanıcı/bildirim/push/oturum/aktivite uçları.
//
// Aynı eşleme başka kullanıcıların yazmaları için de kullanılır (canlı senkron,
// hooks/useLiveSync.js). Sunucunun sinyal ürettiği kök listesi
// backend/src/services/live-sync.service.ts → signalCapability ile aynı tutulmalı.
import { queryClient as defaultQueryClient } from '../queryClient';

// Ders, ödeme, satış ve borç rakamlarını gösteren her şey. Yalnız ekranda
// açık olan sorgular hemen yeniden çekilir; diğerleri "bayat" işaretlenir ve
// açıldıklarında çekilir — fazla geniş tutmanın maliyeti düşük.
const LESSONS_AND_MONEY = [
  ['weekLessons'],
  ['weeklyKpi'],
  ['financeFlow'],
  ['occupancyFlow'],
  ['students'],
  ['studentsKpi'],
  ['debtors'],
  ['student'],
  ['movements'],
  ['productSale'],
];

const PRODUCTS = [['products'], ['product'], ['mapping']];

// Etkinlik ödemeleri/ücretleri öğrenci bakiyesine ve finansa yansır. Etkinliğin
// kendi ekran anahtarlarına dokunulmaz (kendi akışları tazeliyor).
const EVENT_MONEY = [['student'], ['weeklyKpi'], ['financeFlow'], ['movements']];

// Canlı senkron kaldığı yerden devam edemezse (sunucu değişti, aradaki
// sinyaller kayboldu) tazelenecek her şey: aşağıdaki eşlemedeki tüm gruplar.
export const SYNCED_QUERY_KEYS = [
  ...LESSONS_AND_MONEY,
  ...PRODUCTS,
  ['calendarEvents'],
  ['settings'],
  ['instructors'],
  ['lessonTypes'],
];

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function splitPath(path) {
  const clean = String(path || '').split(/[?#]/)[0];
  return clean.split('/').filter(Boolean);
}

function normalizePath(path) {
  return `/${splitPath(path).join('/')}`;
}

// ── Kendi yazmalarımız ────────────────────────────────────────────────────
// Sunucu her yazmayı yazan dahil herkese yayınlar. Bu cihazın kendi yazması
// zaten yukarıdaki invalidateAfterWrite ile tazelendi; aynı sinyal ikinci bir
// yeniden çekme başlatmasın diye istek ATILIRKEN not edilir (sinyal yanıttan
// önce de gelebilir) ve canlı akışta ilk eşleşen sinyal bir kez yutulur.
// Sekme başına bellek: aynı tarayıcıdaki başka sekme sinyali normal işler.
const OWN_WRITE_TTL_MS = 15_000;
const OWN_WRITE_MAX = 50;
const ownWrites = [];

function pruneOwnWrites(now) {
  while (ownWrites.length > 0 && now - ownWrites[0].at > OWN_WRITE_TTL_MS) ownWrites.shift();
  while (ownWrites.length > OWN_WRITE_MAX) ownWrites.shift();
}

export function rememberOwnWrite(method, path, now = Date.now()) {
  const m = String(method || 'GET').toUpperCase();
  if (!WRITE_METHODS.has(m)) return;
  pruneOwnWrites(now);
  ownWrites.push({ method: m, path: normalizePath(path), at: now });
}

/** Sinyal bu cihazın yakın zamanlı bir yazmasıysa kaydı düşer ve true döner. */
export function consumeOwnWrite(method, path, now = Date.now()) {
  pruneOwnWrites(now);
  const m = String(method || '').toUpperCase();
  const p = normalizePath(path);
  const idx = ownWrites.findIndex((w) => w.method === m && w.path === p);
  if (idx === -1) return false;
  ownWrites.splice(idx, 1);
  return true;
}

/**
 * Bir yazma isteğinin etkilediği sorgu anahtarı önekleri.
 * GET ya da tanınmayan uçlar için boş liste döner.
 */
export function queryKeysForWrite(method, path) {
  if (!WRITE_METHODS.has(String(method || 'GET').toUpperCase())) return [];
  const segments = splitPath(path);
  const [root] = segments;

  switch (root) {
    case 'lessons':
    case 'payments':
    case 'packages':
      return LESSONS_AND_MONEY;
    case 'product-sales':
      // Satış stok düşürür → ürün listeleri de.
      return [...LESSONS_AND_MONEY, ...PRODUCTS];
    case 'students':
      // Silinen öğrencinin kendi sorguları yeniden çekilmesin (404 olur);
      // diğer öğrencilerin verisi bu silmeden etkilenmez.
      if (String(method).toUpperCase() === 'DELETE' && segments.length === 2) {
        return LESSONS_AND_MONEY.filter(([key]) => key !== 'student');
      }
      return LESSONS_AND_MONEY;
    case 'calendar-events':
      return [['calendarEvents']];
    case 'settings':
      return [['settings'], ['weeklyKpi'], ['financeFlow'], ['occupancyFlow']];
    case 'instructors':
      return [['instructors'], ['weekLessons']];
    case 'lesson-types':
      // Öğrenciye özel fiyatlar profilde görünür.
      return [['lessonTypes'], ['weekLessons'], ['student']];
    case 'products':
    case 'channels':
    case 'mapping':
      return PRODUCTS;
    case 'events':
      return EVENT_MONEY;
    default:
      return [];
  }
}

/**
 * Başarılı yazmadan sonra etkilenen sorguları tazeler.
 *
 * setTimeout(0): çağıran ekranın kendi invalidate'leri (await'ten hemen sonra,
 * mikro-görevlerde) önce çalışsın. cancelRefetch:false: o çağrıların başlattığı
 * istekler iptal edilip yeniden atılmaz — aynı veri iki kez çekilmez.
 */
export function invalidateAfterWrite(method, path, client = defaultQueryClient) {
  const keys = queryKeysForWrite(method, path);
  if (keys.length === 0) return;
  setTimeout(() => {
    for (const queryKey of keys) {
      client.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  }, 0);
}
