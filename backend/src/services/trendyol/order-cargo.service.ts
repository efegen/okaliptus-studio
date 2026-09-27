// v1.6 — Model C / Faz 2: Trendyol kargo firması değiştirme + değişikliğin TAKİBİ.
//
// CANLI TY YAZMASI: bir paketin kargo firmasını değiştirir (PUT cargo-providers).
// Stok'a DOKUNMAZ; sipariş fulfillment yazmasıdır. `marketplaceFulfillmentEnabled`
// flag'i (migration 0248, DEFAULT false) + UI onayı arkasında. Flag kapalıyken 409.
//
// Güvenlik katmanları (kasıtlı, kademeli):
//   1. Flag kontrolü (marketplaceFulfillmentEnabled) — kapalıysa HİÇ yazma denenmez.
//   2. packageId zorunlu (boş → ValidationError, TY'ye gidilmez).
//   3. cargoProvider WHITELIST doğrulaması (cargo-providers.ts) — buggy/kötü bir çağıran
//      bile TY'ye tanımsız bir kod gönderemez.
// YAZMA yeniden DENENMEZ. TY'nin "paket başına 5 dk'da 1 değişiklik" kuralı burada
// önceden UYGULANMAZ (ürün kararı): istek her zaman TY'ye gider, reddederse TY'nin
// hatası kullanıcıya iletilir.
//
// Takip: TY değişikliği ASENKRON uygular — 200 dönmesi "firma değişti" demek değildir.
// Başarılı PUT'tan sonra paket için bir takip kaydı açılır (cargo-change-tracker.ts).
// İstemci getCargoChangeStatuses'ı kısa aralıkla yoklar; her yoklama, aralığı dolmuşsa
// siparişi TY'den HEDEFLİ (orderNumber, tek küçük GET) yeniden çeker ve snapshot'lara
// yamar → yeni firma TY'de görünür görünmez ekrana yansır.

import { AppError, ValidationError } from "../errors.js";
import { getSettings } from "../settings.service.js";
import { MarketplaceFulfillmentDisabledError } from "./order-label.service.js";
import {
  changeCargoProvider as defaultChange,
  type GetOrdersParams,
  type TrendyolOrdersResponse,
} from "./client.js";
import { cargoProviderName, isValidCargoProviderCode } from "./cargo-providers.js";
import {
  CARGO_CHANGE_CONFIRM_TIMEOUT_MS,
  cargoCheckInterval,
  getCargoChange,
  registerCargoChange,
  resolveCargoChange,
  type CargoChangeEntry,
  type CargoChangeView,
} from "./cargo-change-tracker.js";
import {
  findKnownOrder,
  MarketplaceSyncDisabledError,
  refreshOrderPackages,
  type DisplayOrder,
} from "./orders.service.js";

export class CargoProviderNotAllowedError extends AppError {
  constructor(code: string) {
    super("CARGO_PROVIDER_NOT_ALLOWED", `Geçersiz kargo firması kodu: ${code}.`, 422);
  }
}

export type ChangeCargoProviderInput = {
  packageId: string;
  cargoProvider: string; // TY firma KODU (whitelist)
  // İpucu: paket sunucu önbelleğinde yoksa hedefli doğrulama bu numarayla yapılır.
  orderNumber?: string | null;
};

export type ChangeCargoProviderResult = {
  packageId: string;
  cargoProvider: string;
  name: string;           // insanca etiket
  change: CargoChangeView; // takip durumu (çoğunlukla "pending")
};

export type OrderCargoDeps = {
  // Test/izolasyon için enjekte edilebilir. Varsayılan: gerçek client (CANLI yazma).
  changeProvider?: (packageId: string, code: string) => Promise<void>;
};

// Kargo firması değiştirme akışı: doğrula → flag → CANLI PUT → takip kaydı.
export async function changeOrderCargoProvider(
  input: ChangeCargoProviderInput,
  deps: OrderCargoDeps = {},
): Promise<ChangeCargoProviderResult> {
  const packageId = String(input?.packageId ?? "").trim();
  const code = String(input?.cargoProvider ?? "").trim().toUpperCase();
  const orderNumberHint = String(input?.orderNumber ?? "").trim().slice(0, 64) || null;

  if (!packageId) {
    throw new ValidationError("Paket numarası gerekli.");
  }
  if (!code) {
    throw new ValidationError("Kargo firması gerekli.");
  }
  if (!isValidCargoProviderCode(code)) {
    throw new CargoProviderNotAllowedError(code);
  }

  const settings = await getSettings();
  if (!settings.marketplaceFulfillmentEnabled) {
    throw new MarketplaceFulfillmentDisabledError(
      "Pazaryeri sipariş işleme kapalı. Ayarlar › Pazaryeri'nden 'Pazaryeri sipariş işleme'yi açın.",
    );
  }

  const changeProvider = deps.changeProvider ?? defaultChange;
  await changeProvider(packageId, code);

  // İstek anındaki (değişiklik öncesi) paket: "eski firma"yı ve doğrulama için sipariş
  // no/tarihini buradan alırız.
  const known = findKnownOrder({ packageId, orderNumber: orderNumberHint });
  const name = cargoProviderName(code) ?? code;
  const entry = registerCargoChange({
    packageId,
    orderNumber: known?.orderNumber ?? orderNumberHint,
    orderDate: known?.orderDate ?? null,
    fromName: known?.cargoProvider ?? null,
    fromTrackingNumber: known?.cargoTrackingNumber ?? null,
    toCode: code,
    toName: name,
  });
  return { packageId, cargoProvider: code, name, change: resolveCargoChange(entry, known?.cargoProvider) };
}

// ── Değişiklik durumu yoklaması ──────────────────────────────────────────────

export type CargoChangeStatusItem = {
  packageId: string;
  change: CargoChangeView | null;  // null = takip kaydı yok (süresi doldu / süreç yeniden başladı)
  order: DisplayOrder | null;      // elimizdeki en taze paket (cargoChange iliştirilmiş)
};

export type CargoStatusDeps = {
  // Test/izolasyon için enjekte edilebilir. Varsayılan: gerçek client (salt-okuma GET).
  fetchOrders?: (params: GetOrdersParams) => Promise<TrendyolOrdersResponse>;
};

const STATUS_MAX_PACKAGES = 20;
// Yoklama hedefli TY kontrolünü en fazla bu kadar bekler; uzarsa kontrol arka planda
// sürer ve sonucu bir sonraki yoklamada görünür (yavaş TY yoklamayı kilitlemesin).
const STATUS_WAIT_MS = 4_000;

async function waitAtMost(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })]);
  if (timer) clearTimeout(timer);
}

// Paketi TY'den hedefli yeniden çeker (snapshot'lara yamar). Aynı kayıt için eşzamanlı
// yoklamalar tek TY isteğini paylaşır. Hata SIZMAZ: durum "pending" kalır, sonraki
// yoklama yeniden dener.
function checkCargoChange(entry: CargoChangeEntry, deps: CargoStatusDeps): Promise<void> {
  if (entry.checking) return entry.checking;
  const orderNumber = entry.orderNumber;
  if (!orderNumber) return Promise.resolve();
  entry.lastCheckedAt = Date.now();
  entry.checking = (async () => {
    try {
      await refreshOrderPackages({ orderNumber, orderDate: entry.orderDate }, deps);
    } catch (err) {
      console.error(
        `[trendyol-cargo] ${entry.packageId} doğrulaması başarısız:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      entry.checking = null;
    }
  })();
  return entry.checking;
}

// Paketlerin kargo değişikliği durumu + en taze paket verisi. Bekleyen kayıtlar için
// aralığı dolduysa TY'den hedefli kontrol yapılır; `check` (kullanıcının "Tekrar kontrol
// et"i) aralığı ve zaman aşımını beklemeden kontrol eder. Salt-okuma; flag
// marketplaceSyncEnabled (liste ekranıyla aynı).
export async function getCargoChangeStatuses(
  packageIds: string[],
  opts: { check?: boolean } = {},
  deps: CargoStatusDeps = {},
): Promise<CargoChangeStatusItem[]> {
  const settings = await getSettings();
  if (!settings.marketplaceSyncEnabled) {
    throw new MarketplaceSyncDisabledError();
  }

  const ids = [...new Set(packageIds.map(id => String(id ?? "").trim()).filter(Boolean))]
    .slice(0, STATUS_MAX_PACKAGES);

  const now = Date.now();
  const checks: Promise<void>[] = [];
  for (const id of ids) {
    const entry = getCargoChange(id, now);
    if (!entry || entry.appliedAt !== null) continue;
    const pending = now < entry.requestedAt + CARGO_CHANGE_CONFIRM_TIMEOUT_MS;
    const due =
      entry.checking !== null ||
      entry.lastCheckedAt === null ||
      now - entry.lastCheckedAt >= cargoCheckInterval(entry, now);
    if (opts.check || (pending && due)) checks.push(checkCargoChange(entry, deps));
  }
  if (checks.length > 0) await waitAtMost(Promise.all(checks), STATUS_WAIT_MS);

  const at = Date.now();
  return ids.map((packageId): CargoChangeStatusItem => {
    const entry = getCargoChange(packageId, at);
    const order = findKnownOrder({ packageId, orderNumber: entry?.orderNumber });
    const change = entry ? resolveCargoChange(entry, order?.cargoProvider, at) : null;
    return {
      packageId,
      change,
      order: order && change ? { ...order, cargoChange: change } : order,
    };
  });
}
