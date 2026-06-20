// v1.6 — Model C / Faz 2: Trendyol kargo etiketi (Ortak Etiket) yazdırma.
//
// CANLI TY YAZMASI: Ortak Etiket OLUŞTURUR (POST common-label) ve getirir (GET).
// Stok'a DOKUNMAZ; sipariş kabul/fulfillment yazmasıdır. `marketplaceFulfillmentEnabled`
// flag'i (migration 0248, DEFAULT false) + UI onayı arkasında. Flag kapalıyken 409.
//
// Etiket oluşturma async olabilir → GET birkaç kez denenir (kısa beklemeyle).
// GET yanıt şekli belgesiz; client.getCommonLabel content-type'a göre json/base64/text
// döndürür, frontend üçünü de ele alır (ilk gerçek yazmada şekil netleşir).

import { AppError, ValidationError } from "../errors.js";
import { getSettings } from "../settings.service.js";
import {
  requestCommonLabel as defaultRequest,
  getCommonLabel as defaultGet,
  type CommonLabelFormat,
  type CommonLabelResult,
} from "./client.js";

export class MarketplaceFulfillmentDisabledError extends AppError {
  constructor(message = "Pazaryeri sipariş işleme kapalı. Ayarlardan 'Kargo etiketi'ni açın.") {
    super("MARKETPLACE_FULFILLMENT_DISABLED", message, 409);
  }
}

export type OrderLabelDeps = {
  // Test/izolasyon için enjekte edilebilir. Varsayılan: gerçek client (CANLI yazma).
  requestLabel?: (ctn: string, format: CommonLabelFormat) => Promise<void>;
  getLabel?: (ctn: string) => Promise<CommonLabelResult>;
  sleep?: (ms: number) => Promise<void>;
};

export type OrderLabelResult = CommonLabelResult & {
  cargoTrackingNumber: string;
  format: CommonLabelFormat;
};

const GET_RETRIES = 3;
const GET_RETRY_DELAY_MS = 900;

// Kargo etiketi akışı: flag kontrol → Ortak Etiket OLUŞTUR (POST) → getir (GET, retry).
export async function getOrderCargoLabel(
  cargoTrackingNumber: string,
  format: CommonLabelFormat = "ZPL",
  deps: OrderLabelDeps = {},
): Promise<OrderLabelResult> {
  const ctn = String(cargoTrackingNumber ?? "").trim();
  if (!ctn) {
    throw new ValidationError("Kargo takip numarası gerekli.");
  }

  const settings = await getSettings();
  if (!settings.marketplaceFulfillmentEnabled) {
    throw new MarketplaceFulfillmentDisabledError();
  }

  const requestLabel = deps.requestLabel ?? defaultRequest;
  const getLabel = deps.getLabel ?? defaultGet;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  // 1) Etiketi oluştur (CANLI yazma).
  await requestLabel(ctn, format);

  // 2) Getir — oluşturma async olabilir, kısa retry.
  let label: CommonLabelResult | null = null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < GET_RETRIES; attempt++) {
    try {
      label = await getLabel(ctn);
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < GET_RETRIES - 1) await sleep(GET_RETRY_DELAY_MS);
    }
  }
  if (!label) {
    throw lastErr instanceof Error ? lastErr : new Error("Kargo etiketi alınamadı.");
  }

  return { ...label, cargoTrackingNumber: ctn, format };
}
