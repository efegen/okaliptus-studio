// v1.6 — Model C / Faz 2: Trendyol kargo firması değiştirme.
//
// CANLI TY YAZMASI: bir paketin kargo firmasını değiştirir (PUT cargo-providers).
// Stok'a DOKUNMAZ; sipariş fulfillment yazmasıdır. `marketplaceFulfillmentEnabled`
// flag'i (migration 0248, DEFAULT false) + UI onayı arkasında. Flag kapalıyken 409.
//
// Güvenlik katmanları (kasıtlı, kademeli):
//   1. Flag kontrolü (marketplaceFulfillmentEnabled) — kapalıysa HİÇ yazma denenmez.
//   2. packageId zorunlu (boş → ValidationError, TY'ye gidilmez).
//   3. cargoProvider WHITELIST doğrulaması — buggy/kötü bir çağıran bile TY'ye
//      tanımsız bir kod gönderemez (TY tarafı zaten reddeder ama #4 ağ sınırında durur).
// TY kısıtı: paket başına 5 dk'da yalnız 1 değişiklik; bu yüzden YAZMA yeniden DENENMEZ.

import { AppError, ValidationError } from "../errors.js";
import { getSettings } from "../settings.service.js";
import { MarketplaceFulfillmentDisabledError } from "./order-label.service.js";
import { changeCargoProvider as defaultChange } from "./client.js";

// Trendyol pazaryeri kargo firma KODLARI (developers.trendyol.com getProviders +
// "Paket Kargo Firması Değiştirme"). `code` TY'ye gönderilir; `name` yalnız UI etiketi.
// Frontend (orders.jsx CARGO_PROVIDERS) bu listeyle SENKRON tutulmalı; backend
// güvenlik sınırıdır (geçerli kod doğrulaması burada yapılır).
export const TRENDYOL_CARGO_PROVIDERS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "YKMP", name: "Yurtiçi Kargo" },
  { code: "ARASMP", name: "Aras Kargo" },
  { code: "SURATMP", name: "Sürat Kargo" },
  { code: "HOROZMP", name: "Horoz Kargo" },
  { code: "MNGMP", name: "MNG Kargo" },
  { code: "PTTMP", name: "PTT Kargo" },
  { code: "CEVAMP", name: "CEVA Kargo" },
  { code: "TEXMP", name: "Trendyol Express" },
  { code: "DHLECOMMP", name: "DHL eCommerce" },
  { code: "SENDEOMP", name: "Sendeo" },
];

const CARGO_PROVIDER_CODES = new Set(TRENDYOL_CARGO_PROVIDERS.map(p => p.code));

export function isValidCargoProviderCode(code: string): boolean {
  return CARGO_PROVIDER_CODES.has(code);
}

export class CargoProviderNotAllowedError extends AppError {
  constructor(code: string) {
    super("CARGO_PROVIDER_NOT_ALLOWED", `Geçersiz kargo firması kodu: ${code}.`, 422);
  }
}

export type ChangeCargoProviderInput = {
  packageId: string;
  cargoProvider: string; // TY firma KODU (whitelist)
};

export type ChangeCargoProviderResult = {
  packageId: string;
  cargoProvider: string;
  name: string | null; // insanca etiket (varsa)
};

export type OrderCargoDeps = {
  // Test/izolasyon için enjekte edilebilir. Varsayılan: gerçek client (CANLI yazma).
  changeProvider?: (packageId: string, code: string) => Promise<void>;
};

// Kargo firması değiştirme akışı: doğrula → flag kontrol → CANLI PUT.
export async function changeOrderCargoProvider(
  input: ChangeCargoProviderInput,
  deps: OrderCargoDeps = {},
): Promise<ChangeCargoProviderResult> {
  const packageId = String(input?.packageId ?? "").trim();
  const code = String(input?.cargoProvider ?? "").trim().toUpperCase();

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

  const name = TRENDYOL_CARGO_PROVIDERS.find(p => p.code === code)?.name ?? null;
  return { packageId, cargoProvider: code, name };
}
