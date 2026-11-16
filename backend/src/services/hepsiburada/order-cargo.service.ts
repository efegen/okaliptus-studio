// Hepsiburada kargo firması değiştirme + değişikliğin TAKİBİ — Trendyol'daki
// (trendyol/order-cargo.service.ts) akışın HB eşi; ekranlar aynı görünümü
// (DisplayOrder.cargoChange: pending → applied | unconfirmed) kullanır.
//
// CANLI HB YAZMASI: PUT /packages/.../packagenumber/{n}/changecargocompany. Stoğa
// DOKUNMAZ. Güvenlik katmanları (Trendyol'la aynı):
//   1. marketplaceFulfillmentEnabled kapalıysa HİÇ yazma denenmez (409).
//   2. Paket no + firma kodu zorunlu.
//   3. Whitelist: kod, HB'nin O PAKET İÇİN o an döndürdüğü aktif seçeneklerden biri
//      olmalı (GET changablecargocompanies). HB listesi pakete göre değiştiği için
//      sabit bir liste yerine canlı liste kullanılır. Tanımsız kod → 422.
// Yazma yeniden DENENMEZ.
//
// Takip: HB'nin değişikliği anında mı yoksa gecikmeli mi uyguladığı test ortamında
// doğrulanamadı (SIT her pakette "DeliveryNotFound" döndürüyor). Bu yüzden Trendyol'daki
// gibi davranılır: başarılı PUT'tan sonra paket takibe alınır, kargo bilgisi
// (GET /packages/.../packagenumber/{n}) hemen ve sonra kısa aralıklarla yeniden okunur;
// yeni firma görününce "applied", 10 dk içinde görünmezse "unconfirmed". Okunan taze
// firma/barkod/takip linki snapshot'lara yamanır → barkod da yenisiyle değişir.

import { AppError, ValidationError } from "../errors.js";
import { getSettings } from "../settings.service.js";
import { MarketplaceFulfillmentDisabledError } from "../trendyol/order-label.service.js";
import { MarketplaceSyncDisabledError, type DisplayOrder } from "../trendyol/orders.service.js";
import {
  CARGO_CHANGE_CONFIRM_TIMEOUT_MS,
  cargoCheckInterval,
  type CargoChangeEntry,
  type CargoChangeView,
} from "../trendyol/cargo-change-tracker.js";
import { foldCargoName } from "../trendyol/cargo-providers.js";
import {
  HepsiburadaApiError,
  changePackageCargoCompany,
  getChangeableCargoCompanies,
  getPackageCargoInfo,
  type HepsiburadaCargoCompanyOption,
  type HepsiburadaPackageCargoInfo,
} from "./client.js";
import { hbCargoTracker } from "./cargo-change.js";
import { findKnownHbOrder, recordPackageCargo } from "./orders.service.js";

export class HbCargoCompanyNotAllowedError extends AppError {
  constructor(code: string) {
    super("CARGO_PROVIDER_NOT_ALLOWED", `Bu paket için geçersiz kargo firması: ${code}.`, 422);
  }
}

export type HbCargoOption = { code: string; name: string; logoUrl: string | null };

export type HbCargoDeps = {
  // Test/izolasyon için enjekte edilebilir. Varsayılan: gerçek HB client.
  getOptions?: (packageNumber: string) => Promise<HepsiburadaCargoCompanyOption[]>;
  change?: (packageNumber: string, shortName: string) => Promise<void>; // CANLI yazma
  cargoInfo?: (packageNumber: string) => Promise<HepsiburadaPackageCargoInfo | null>;
};

export class HbCargoNotChangeableError extends AppError {
  constructor() {
    super(
      "CARGO_NOT_CHANGEABLE",
      "Bu paketin kargo firması artık değiştirilemez (paket kargoya verilmiş olabilir). Hepsiburada satıcı panelinden kontrol edin.",
      409,
    );
  }
}

// HB, değiştirilemeyen pakette (kargoya verilmiş / teslim edilmiş) boş gövdeli 409 döner
// (canlıda doğrulandı) → anlaşılır mesaja çevrilir.
async function notChangeableOn409<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof HepsiburadaApiError && err.upstreamStatus === 409) throw new HbCargoNotChangeableError();
    throw err;
  }
}

const defaultDeps: Required<HbCargoDeps> = {
  getOptions: async pn => {
    const rows = (await notChangeableOn409(() => getChangeableCargoCompanies(pn))).data;
    return Array.isArray(rows) ? rows : [];
  },
  change: async (pn, code) => {
    await notChangeableOn409(() => changePackageCargoCompany(pn, code));
  },
  cargoInfo: async pn => {
    const rows = (await getPackageCargoInfo(pn)).data;
    return (Array.isArray(rows) ? rows.find(r => r.packageNumber === pn) ?? rows[0] : null) ?? null;
  },
};

function activeOptions(rows: HepsiburadaCargoCompanyOption[]): HbCargoOption[] {
  const out: HbCargoOption[] = [];
  for (const r of rows) {
    const code = String(r.ShortName ?? "").trim().toUpperCase();
    const name = String(r.Name ?? "").trim();
    if (!code || !name || r.IsActive === false) continue;
    out.push({ code, name, logoUrl: r.LogoUrl ? String(r.LogoUrl) : null });
  }
  return out;
}

const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && foldCargoName(a) === foldCargoName(b);

export type HbCargoOptionsResult = { packageId: string; options: HbCargoOption[]; currentCode: string | null };

// "Kargo Firması Değiştir" modalının seçenekleri: paketin şu an geçebileceği aktif
// firmalar + mevcut firmanın kodu (addan). Salt-okuma; flag liste ekranıyla aynı.
export async function getHepsiburadaCargoOptions(packageId: string, deps: HbCargoDeps = {}): Promise<HbCargoOptionsResult> {
  const pn = String(packageId ?? "").trim();
  if (!pn) throw new ValidationError("Paket numarası gerekli.");
  const settings = await getSettings();
  if (!settings.marketplaceSyncEnabled) throw new MarketplaceSyncDisabledError();

  const options = activeOptions(await (deps.getOptions ?? defaultDeps.getOptions)(pn));
  const known = findKnownHbOrder({ packageId: pn });
  const current = options.find(o => sameName(o.name, known?.cargoProvider));
  return { packageId: pn, options, currentCode: current?.code ?? null };
}

// Paketin kargo bilgisini HB'den okur, snapshot'lara yamar. Hata SIZMAZ (durum
// "pending" kalır, sonraki yoklama yeniden dener). Eşzamanlı yoklamalar tek isteği paylaşır.
function checkHbCargoChange(entry: CargoChangeEntry, deps: HbCargoDeps): Promise<void> {
  if (entry.checking) return entry.checking;
  entry.lastCheckedAt = Date.now();
  entry.checking = (async () => {
    const startedAt = Date.now();
    try {
      const info = await (deps.cargoInfo ?? defaultDeps.cargoInfo)(entry.packageId);
      if (info) {
        recordPackageCargo(
          entry.packageId,
          {
            cargoCompany: info.cargoCompany ? String(info.cargoCompany) : null,
            barcode: info.barcode ? String(info.barcode) : null,
            trackingInfoUrl: info.trackingInfoUrl ? String(info.trackingInfoUrl) : null,
          },
          startedAt,
        );
      }
    } catch (err) {
      console.error(`[hb-cargo] ${entry.packageId} doğrulaması başarısız:`, err instanceof Error ? err.message : err);
    } finally {
      entry.checking = null;
    }
  })();
  return entry.checking;
}

// Yoklama HB kontrolünü en fazla bu kadar bekler (yavaş HB yoklamayı kilitlemesin).
const STATUS_WAIT_MS = 4_000;

async function waitAtMost(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })]);
  if (timer) clearTimeout(timer);
}

function viewFor(entry: CargoChangeEntry, now = Date.now()): { change: CargoChangeView; order: DisplayOrder | null } {
  const order = findKnownHbOrder({ packageId: entry.packageId, orderNumber: entry.orderNumber });
  const change = hbCargoTracker.resolve(entry, order?.cargoProvider, now);
  return { change, order: order ? { ...order, cargoChange: change } : null };
}

export type ChangeHbCargoInput = {
  packageId: string;
  cargoCompany: string; // HB ShortName ("AR")
  orderNumber?: string | null;
};

export type ChangeHbCargoResult = {
  packageId: string;
  cargoProvider: string;
  name: string;
  change: CargoChangeView;
  order: DisplayOrder | null;
};

// Değiştirme akışı: doğrula → flag → canlı seçeneklerle whitelist → CANLI PUT →
// takip kaydı → hemen bir kontrol (HB anında uyguladıysa yanıt zaten "applied").
export async function changeHepsiburadaCargoCompany(input: ChangeHbCargoInput, deps: HbCargoDeps = {}): Promise<ChangeHbCargoResult> {
  const packageId = String(input?.packageId ?? "").trim();
  const code = String(input?.cargoCompany ?? "").trim().toUpperCase();
  const orderNumberHint = String(input?.orderNumber ?? "").trim().slice(0, 64) || null;
  if (!packageId) throw new ValidationError("Paket numarası gerekli.");
  if (!code) throw new ValidationError("Kargo firması gerekli.");

  const settings = await getSettings();
  if (!settings.marketplaceFulfillmentEnabled) {
    throw new MarketplaceFulfillmentDisabledError(
      "Pazaryeri sipariş işleme kapalı. Ayarlar › Pazaryeri'nden 'Pazaryeri sipariş işleme'yi açın.",
    );
  }

  const options = activeOptions(await (deps.getOptions ?? defaultDeps.getOptions)(packageId));
  const target = options.find(o => o.code === code);
  if (!target) throw new HbCargoCompanyNotAllowedError(code);

  const known = findKnownHbOrder({ packageId, orderNumber: orderNumberHint });
  if (sameName(known?.cargoProvider, target.name)) {
    throw new ValidationError(`Paket zaten ${target.name} ile gönderiliyor.`);
  }

  await (deps.change ?? defaultDeps.change)(packageId, code);

  const entry = hbCargoTracker.register({
    packageId,
    orderNumber: known?.orderNumber ?? orderNumberHint,
    orderDate: known?.orderDate ?? null,
    fromName: known?.cargoProvider ?? null,
    fromTrackingNumber: known?.cargoTrackingNumber ?? null,
    toCode: code,
    toName: target.name,
  });
  await waitAtMost(checkHbCargoChange(entry, deps), STATUS_WAIT_MS);
  const { change, order } = viewFor(entry);
  return { packageId, cargoProvider: code, name: target.name, change, order };
}

export type HbCargoChangeStatusItem = {
  packageId: string;
  change: CargoChangeView | null; // null = takip kaydı yok (süresi doldu / süreç yeniden başladı)
  order: DisplayOrder | null;
};

const STATUS_MAX_PACKAGES = 20;

// Bekleyen değişikliklerin durumu + en taze paket verisi. Aralığı dolan bekleyen kayıt
// için HB'den hedefli kontrol yapılır; check=true ("Tekrar kontrol et") beklemeden
// kontrol eder. Salt-okuma; flag liste ekranıyla aynı.
export async function getHepsiburadaCargoChangeStatuses(
  packageIds: string[],
  opts: { check?: boolean } = {},
  deps: HbCargoDeps = {},
): Promise<HbCargoChangeStatusItem[]> {
  const settings = await getSettings();
  if (!settings.marketplaceSyncEnabled) throw new MarketplaceSyncDisabledError();

  const ids = [...new Set(packageIds.map(id => String(id ?? "").trim()).filter(Boolean))].slice(0, STATUS_MAX_PACKAGES);
  const now = Date.now();
  const checks: Promise<void>[] = [];
  for (const id of ids) {
    const entry = hbCargoTracker.get(id, now);
    if (!entry || entry.appliedAt !== null) continue;
    const pending = now < entry.requestedAt + CARGO_CHANGE_CONFIRM_TIMEOUT_MS;
    const due =
      entry.checking !== null || entry.lastCheckedAt === null || now - entry.lastCheckedAt >= cargoCheckInterval(entry, now);
    if (opts.check || (pending && due)) checks.push(checkHbCargoChange(entry, deps));
  }
  if (checks.length > 0) await waitAtMost(Promise.all(checks), STATUS_WAIT_MS);

  const at = Date.now();
  return ids.map(packageId => {
    const entry = hbCargoTracker.get(packageId, at);
    if (!entry) return { packageId, change: null, order: findKnownHbOrder({ packageId }) };
    const { change, order } = viewFor(entry, at);
    return { packageId, change, order };
  });
}
