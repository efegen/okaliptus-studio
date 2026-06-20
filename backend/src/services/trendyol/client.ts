// v1.6 — Trendyol Marketplace client.
//
// Çoğunlukla OKUMA (GET: getOrders / getApprovedProducts / getClaims). Model C /
// Faz 2 ile TEK bir yazma yolu eklendi: updateStock (price-and-inventory) — yalnız
// STOK alanını gönderir, fiyata dokunmaz. Yazmanın gerçekten uygulandığını
// doğrulamak için getBatchRequestResult (GET) eşlik eder. Diğer yazma uçları
// (ürün oluşturma, fiyat güncelleme, listing aç/kapat) KAPSAM DIŞI.
//
// !!! updateStock CANLI KATALOĞA YAZAR. Bu fonksiyon yalnız stock-push.service
// tarafından, çok katmanlı kilit (baseline + dry-run + circuit-breaker +
// change-only) DOĞRULANDIKTAN sonra çağrılmalı. Geliştirme/smoke'ta ASLA gerçek
// çağrılmaz: stock-push.service enjekte client kullanır (deps.updateStock),
// smoke offline fake enjekte eder.
//
// Kaynak: docs/trendyol-stage-collection.json (KESİN endpoint/method/header
// kaynağı). Collection STAGE; base URL ve kimlik env'den gelir, demo token
// HARDCODE EDİLMEZ. Biz PROD kullanıyoruz (base URL varsayılanı PROD).
//
// Endpoint (collection "Get Order Packages"):
//   GET {base}/integration/order/sellers/{sellerId}/orders
// Header'lar (collection "Create a Test Order" gerçek başlık seti):
//   Authorization: Basic base64(apiKey:apiSecret)
//   SellerID: {sellerId}
//   User-Agent: {sellerId} - SelfIntegration   (collection literal: "2738 ")

import { env } from "../../config/env.js";
import { AppError } from "../errors.js";

const ORDERS_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 20_000;
// Read-only GET'lerde geçici hata (ağ kopması / timeout / 429 / 5xx) sınırlı kez
// yeniden denenir. Railway↔Trendyol arasındaki anlık "fetch failed" kopmaları çoğu
// zaman tek bir denemede geçer; YAZMALAR (updateStock / etiket) ASLA yeniden denenmez.
const GET_MAX_ATTEMPTS = 3;
const GET_RETRY_BASE_MS = 400;

export class TrendyolNotConfiguredError extends AppError {
  constructor(message = "Trendyol API kimliği yapılandırılmamış (TRENDYOL_SELLER_ID / API_KEY / API_SECRET).") {
    super("TRENDYOL_NOT_CONFIGURED", message, 503);
  }
}

export class TrendyolApiError extends AppError {
  readonly upstreamStatus: number;
  constructor(upstreamStatus: number, message: string) {
    super("TRENDYOL_API_ERROR", message, 502);
    this.upstreamStatus = upstreamStatus;
  }
}

export function isTrendyolConfigured(): boolean {
  return Boolean(env.trendyolSellerId && env.trendyolApiKey && env.trendyolApiSecret);
}

function buildHeaders(): Record<string, string> {
  const token = Buffer.from(`${env.trendyolApiKey}:${env.trendyolApiSecret}`).toString("base64");
  return {
    Authorization: `Basic ${token}`,
    SellerID: env.trendyolSellerId,
    "User-Agent": `${env.trendyolSellerId} - SelfIntegration`,
    Accept: "application/json",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 429 / 5xx geçici sayılır (yeniden denenir); diğer 4xx kalıcı (kimlik/parametre
// hatası — yeniden denemek anlamsız, hemen fırlatılır).
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

// Read-only GET → JSON, timeout + geçici hatalarda yeniden deneme ile. Ağ/timeout
// hatası TrendyolApiError(0)'a, 2xx olmayan yanıt TrendyolApiError(status)'a sarılır
// (eski davranışla aynı tipler). `errLabel` 2xx-olmayan yanıtın kullanıcı mesajıdır.
async function trendyolGetJson<T>(url: URL, errLabel: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= GET_MAX_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: buildHeaders(),
        signal: AbortSignal.timeout(ORDERS_TIMEOUT_MS),
      });
    } catch (err) {
      // Ağ/timeout — geçici say, kısa backoff ile yeniden dene.
      const msg = err instanceof Error ? err.message : String(err);
      lastErr = new TrendyolApiError(0, `Trendyol'a bağlanılamadı: ${msg}`);
      if (attempt < GET_MAX_ATTEMPTS) {
        await sleep(GET_RETRY_BASE_MS * attempt);
        continue;
      }
      throw lastErr;
    }

    if (!res.ok) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 500);
      } catch {
        // yut
      }
      const apiErr = new TrendyolApiError(res.status, `${errLabel} (HTTP ${res.status}). ${body}`);
      if (isRetryableStatus(res.status) && attempt < GET_MAX_ATTEMPTS) {
        lastErr = apiErr;
        await sleep(GET_RETRY_BASE_MS * attempt);
        continue;
      }
      throw apiErr;
    }

    return (await res.json()) as T;
  }
  // Döngü her zaman ya döner ya fırlatır; teorik olarak ulaşılmaz.
  throw lastErr ?? new TrendyolApiError(0, `${errLabel} başarısız.`);
}

export type GetOrdersParams = {
  status?: string;
  // ms epoch (Trendyol startDate/endDate ms cinsindendir)
  startDate?: number;
  endDate?: number;
  page?: number;
  size?: number;
  orderByField?: string;
  orderByDirection?: "ASC" | "DESC";
};

// Trendyol orders yanıtı (yalnız kullandığımız alanlar; yanıt daha geniş olabilir).
// id = orderLineId: satır granülerliğinde idempotensi anahtarı (kısmi iptal olur).
// orderLineItemStatusName = satır bazlı status; paket status'undan farklı olabilir
// (bir pakette bir satır iptal, diğeri canlı olabilir) → varsa bunu kullanırız.
export type TrendyolOrderLine = {
  id?: number | string;
  barcode?: string;
  quantity?: number;
  productName?: string;
  merchantSku?: string;
  sku?: string;
  price?: number;
  amount?: number;          // satır toplam tutarı (genelde price × quantity)
  discount?: number;        // satıcı indirimi (satır)
  productSize?: string;     // beden
  productColor?: string;    // renk
  orderLineItemStatusName?: string;
};

// Sipariş teslimat/fatura adresi (yalnız görünümde kullandığımız alanlar).
export type TrendyolAddress = {
  city?: string;
  district?: string;
  neighborhood?: string;
  fullAddress?: string;
  fullName?: string;
};

export type TrendyolOrder = {
  orderNumber?: string;
  orderDate?: number;
  status?: string;
  shipmentPackageStatus?: string;
  grossAmount?: number;
  totalPrice?: number;
  totalDiscount?: number;
  customerFirstName?: string;
  customerLastName?: string;
  lines?: TrendyolOrderLine[];
  // ── Görünüm alanları (aynı getOrders yanıtında gelir; stok akışı kullanmaz) ──
  id?: number | string;            // shipmentPackageId
  shipmentPackageId?: number | string;
  cargoTrackingNumber?: number | string;
  cargoProviderName?: string;
  cargoTrackingLink?: string;
  invoiceLink?: string;
  agreedDeliveryDate?: number;       // ms — "kalan süre" hesabı
  estimatedDeliveryStartDate?: number;
  estimatedDeliveryEndDate?: number;
  lastModifiedDate?: number;
  shipmentAddress?: TrendyolAddress;
  invoiceAddress?: TrendyolAddress;
};

export type TrendyolOrdersResponse = {
  page?: number;
  size?: number;
  totalPages?: number;
  totalElements?: number;
  content?: TrendyolOrder[];
};

// GET sipariş paketleri. Read-only. Yapılandırma yoksa veya yanıt 2xx değilse
// tipli hata fırlatır. Ağ/timeout hatası da TrendyolApiError'a sarılır.
export async function getOrders(params: GetOrdersParams = {}): Promise<TrendyolOrdersResponse> {
  if (!isTrendyolConfigured()) {
    throw new TrendyolNotConfiguredError();
  }

  const url = new URL(
    `${env.trendyolApiBaseUrl}/integration/order/sellers/${env.trendyolSellerId}/orders`,
  );
  if (params.status) url.searchParams.set("status", params.status);
  if (params.startDate !== undefined) url.searchParams.set("startDate", String(params.startDate));
  if (params.endDate !== undefined) url.searchParams.set("endDate", String(params.endDate));
  if (params.page !== undefined) url.searchParams.set("page", String(params.page));
  if (params.size !== undefined) url.searchParams.set("size", String(params.size));
  if (params.orderByField) url.searchParams.set("orderByField", params.orderByField);
  if (params.orderByDirection) url.searchParams.set("orderByDirection", params.orderByDirection);

  return trendyolGetJson<TrendyolOrdersResponse>(url, "Trendyol siparişleri alınamadı");
}

// ── Ürün listesi (read-only) ────────────────────────────────────────────────
//
// GET {base}/integration/product/sellers/{sellerId}/products/approved
// Yanıt: { totalElements, totalPages, page, size, content: [ { productMainId,
//   title, images, variants: [ { barcode, stockCode, stock:{quantity},
//   price:{salePrice,listPrice}, onSale, archived, productUrl } ] } ] }
// barkod/stok/fiyat ürün üstünde DEĞİL, variants[] içindedir.

export type TrendyolVariant = {
  barcode?: string;
  stockCode?: string;
  onSale?: boolean;
  archived?: boolean;
  productUrl?: string;
  stock?: { quantity?: number };
  price?: { salePrice?: number; listPrice?: number; priceSeenByCustomer?: number };
};

export type TrendyolProduct = {
  productMainId?: string;
  title?: string;
  brand?: string;
  category?: string;
  images?: Array<{ url?: string }>;
  variants?: TrendyolVariant[];
};

export type TrendyolProductsResponse = {
  totalElements?: number;
  totalPages?: number;
  page?: number;
  size?: number;
  content?: TrendyolProduct[];
};

export type GetApprovedProductsParams = {
  page?: number;
  size?: number;
};

export async function getApprovedProducts(
  params: GetApprovedProductsParams = {},
): Promise<TrendyolProductsResponse> {
  if (!isTrendyolConfigured()) {
    throw new TrendyolNotConfiguredError();
  }

  const url = new URL(
    `${env.trendyolApiBaseUrl}/integration/product/sellers/${env.trendyolSellerId}/products/approved`,
  );
  url.searchParams.set("page", String(params.page ?? 0));
  url.searchParams.set("size", String(params.size ?? 50));

  return trendyolGetJson<TrendyolProductsResponse>(url, "Trendyol ürünleri alınamadı");
}

// ── İadeler / claims (read-only) ────────────────────────────────────────────
//
// GET {base}/integration/order/sellers/{sellerId}/claims  (collection
//   "Returned Orders Integration → Getting Returned Orders").
// PROD'a yapılan canlı read-only çağrıyla doğrulanan yanıt şekli:
//   { totalElements, totalPages, page, size, content: [ {
//       claimId, orderNumber, claimDate (ms), items: [ {
//         orderLine: { id, barcode, merchantSku, productName },  // id = orderLineId
//         claimItems: [ { id, orderLineItemId, claimItemStatus:{name},
//                         trendyolClaimItemReason:{code,name}, resolved } ]
//   } ] } ] }
// ÖNEMLİ: pencere `startDate`/`endDate` (ms) ile CLAIM TARİHİNE göre süzülür
// (orders gibi `beginDate`/`endDate` DEĞİL — onlar yok sayılıp hepsini döndürür).
// items[].orderLine.id, orders ucundaki lines[].id ile AYNI uzaydadır → iade,
// (orderNumber, orderLine.id) ile sayılmış sipariş satırına bağlanır.

export type TrendyolClaimOrderLine = {
  id?: number | string; // orderLineId — orders lines[].id ile eşleşir
  barcode?: string;
  merchantSku?: string;
  productName?: string;
};

export type TrendyolClaimReason = {
  id?: number;
  name?: string;
  code?: string;
  externalReasonId?: number;
};

export type TrendyolClaimItem = {
  id?: string; // claimItemId (birim bazlı)
  orderLineItemId?: number | string; // birim bazlı id (orderLine.id'den AYRI uzay)
  claimItemStatus?: { name?: string }; // Accepted / Cancelled / Rejected / WaitingInAction …
  trendyolClaimItemReason?: TrendyolClaimReason;
  customerClaimItemReason?: TrendyolClaimReason;
  resolved?: boolean;
};

export type TrendyolClaimLine = {
  orderLine?: TrendyolClaimOrderLine;
  claimItems?: TrendyolClaimItem[];
};

export type TrendyolClaim = {
  id?: string;
  claimId?: string;
  orderNumber?: string;
  orderDate?: number;
  claimDate?: number; // ms epoch — pencere bu alana göre süzülür
  customerFirstName?: string;
  customerLastName?: string;
  items?: TrendyolClaimLine[];
};

export type TrendyolClaimsResponse = {
  page?: number;
  size?: number;
  totalPages?: number;
  totalElements?: number;
  content?: TrendyolClaim[];
};

export type GetClaimsParams = {
  // ms epoch (claimDate penceresi; orders ile aynı param adları)
  startDate?: number;
  endDate?: number;
  page?: number;
  size?: number;
  claimItemStatus?: string; // sunucu-taraflı süzme; biz kullanmıyoruz (istemcide sınıflandırıyoruz)
  orderByField?: string;
  orderByDirection?: "ASC" | "DESC";
};

// GET iadeler. Read-only. Orders ile aynı kimlik/timeout/hata sarmalama.
export async function getClaims(params: GetClaimsParams = {}): Promise<TrendyolClaimsResponse> {
  if (!isTrendyolConfigured()) {
    throw new TrendyolNotConfiguredError();
  }

  const url = new URL(
    `${env.trendyolApiBaseUrl}/integration/order/sellers/${env.trendyolSellerId}/claims`,
  );
  if (params.startDate !== undefined) url.searchParams.set("startDate", String(params.startDate));
  if (params.endDate !== undefined) url.searchParams.set("endDate", String(params.endDate));
  if (params.page !== undefined) url.searchParams.set("page", String(params.page));
  if (params.size !== undefined) url.searchParams.set("size", String(params.size));
  if (params.claimItemStatus) url.searchParams.set("claimItemStatus", params.claimItemStatus);
  if (params.orderByField) url.searchParams.set("orderByField", params.orderByField);
  if (params.orderByDirection) url.searchParams.set("orderByDirection", params.orderByDirection);

  return trendyolGetJson<TrendyolClaimsResponse>(url, "Trendyol iadeleri alınamadı");
}

// ── Stok güncelleme / YAZMA (Model C / Faz 2) ───────────────────────────────
//
// POST {base}/integration/inventory/sellers/{sellerId}/products/price-and-inventory
// Collection "Stock and Price Update (Stok ve Fiyat Güncelleme)" gövdesi:
//   { "items": [ { "barcode", "quantity", "salePrice"?, "listPrice"? } ] }
// Yanıt async batch: { "batchRequestId": "..." }. Asıl uygulanma sonucu AYRI
// uçtan (getBatchRequestResult) sorgulanır; 2xx-submit "uygulandı" DEMEK DEĞİLDİR.
//
// STOK-ONLY: yalnız { barcode, quantity }. Tip salePrice/listPrice TAŞIMAZ ve
// updateStock gövdeyi bu iki alana indirgeyerek kurar (whitelist) → buggy/kötü bir
// çağıran bile TY'ye fiyat gönderemez (#5 ağ sınırında zorlanır). Fiyat TY'de
// yönetilir; ileride fiyat-passthrough gerekirse AYRI ve açık bir metot eklenir.
export type TrendyolStockItem = {
  barcode: string;
  quantity: number;
};

export type TrendyolBatchSubmitResponse = {
  batchRequestId?: string;
};

export async function updateStock(items: TrendyolStockItem[]): Promise<TrendyolBatchSubmitResponse> {
  if (!isTrendyolConfigured()) {
    throw new TrendyolNotConfiguredError();
  }
  if (items.length === 0) {
    // Boş gönderim anlamsız; çağıran zaten boşsa hiç çağırmamalı (savunmacı).
    return {};
  }

  const url = new URL(
    `${env.trendyolApiBaseUrl}/integration/inventory/sellers/${env.trendyolSellerId}/products/price-and-inventory`,
  );

  // STOK-ONLY whitelist: gövdeyi yalnız barcode+quantity ile yeniden kur; gelen
  // nesnedeki başka HİÇBİR alan (özellikle fiyat) tele çıkmaz.
  const safeItems = items.map((i) => ({ barcode: i.barcode, quantity: i.quantity }));

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { ...buildHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ items: safeItems }),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TrendyolApiError(0, `Trendyol'a bağlanılamadı: ${msg}`);
  }

  if (!res.ok) {
    let body = "";
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      // yut
    }
    throw new TrendyolApiError(res.status, `Trendyol stok güncellemesi gönderilemedi (HTTP ${res.status}). ${body}`);
  }

  return (await res.json()) as TrendyolBatchSubmitResponse;
}

// GET {base}/integration/product/sellers/{sellerId}/products/batch-requests/{batchRequestId}
// Yazmanın gerçekten uygulanıp uygulanmadığını DOĞRULAR. Trendyol'un kanonik batch
// sonucu şekli (yanıt collection'da boş döndüğü için savunmacı/hepsi opsiyonel):
//   { status, batchRequestId, itemCount, failedItemCount, items: [
//       { requestItem: { barcode, quantity, ... }, status: 'SUCCESS'|'FAILED'|...,
//         failureReasons: ["..."] } ] }
// status üst seviyede 'COMPLETED' olunca itemlar kesinleşir; 'PROCESSING' ise
// henüz hazır değil (çağıran tekrar poll'lar).
export type TrendyolBatchItem = {
  requestItem?: { barcode?: string; quantity?: number; sellerId?: number };
  status?: string; // SUCCESS / FAILED / INVALID …
  failureReasons?: string[];
};

export type TrendyolBatchResult = {
  batchRequestId?: string;
  status?: string; // COMPLETED / PROCESSING …
  itemCount?: number;
  failedItemCount?: number;
  items?: TrendyolBatchItem[];
};

export async function getBatchRequestResult(batchRequestId: string): Promise<TrendyolBatchResult> {
  if (!isTrendyolConfigured()) {
    throw new TrendyolNotConfiguredError();
  }

  const url = new URL(
    `${env.trendyolApiBaseUrl}/integration/product/sellers/${env.trendyolSellerId}/products/batch-requests/${encodeURIComponent(batchRequestId)}`,
  );

  return trendyolGetJson<TrendyolBatchResult>(url, "Trendyol batch sonucu alınamadı");
}

// ── Kargo etiketi / Ortak Etiket (Common Label) — Faz 2 (YAZMA) ──────────────
//
// POST {base}/integration/sellers/{sellerId}/common-label/{cargoTrackingNumber}
//   body: { format: "ZPL" | "PDF", boxQuantity?, volumetricHeight? } → etiketi OLUŞTURUR.
// GET  aynı path → oluşan etiketi DÖNDÜRÜR (oluşturma async olabilir → çağıran retry'lar).
// Kaynak: docs/trendyol-stage-collection.json "Common Label Integration".
//
// !!! requestCommonLabel CANLI TY'ye yazar (etiket/barkod oluşturur). Yalnız
// order-label.service tarafından (marketplaceFulfillmentEnabled flag + UI onayı)
// çağrılmalı. Smoke offline enjekte client kullanır.
//
// GET yanıt şekli collection'da BELGELENMEMİŞ (boş örnek). Bu yüzden getCommonLabel
// content-type'a göre savunmacı döndürür: json | base64(binary: PDF/ZPL/png) | text.
// İlk gerçek yazmada şekil netleşir; frontend üç biçimi de ele alır.

export type CommonLabelFormat = "ZPL" | "PDF";

export async function requestCommonLabel(
  cargoTrackingNumber: string,
  format: CommonLabelFormat = "ZPL",
): Promise<void> {
  if (!isTrendyolConfigured()) {
    throw new TrendyolNotConfiguredError();
  }
  const url = new URL(
    `${env.trendyolApiBaseUrl}/integration/sellers/${env.trendyolSellerId}/common-label/${encodeURIComponent(cargoTrackingNumber)}`,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { ...buildHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ format }),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TrendyolApiError(0, `Trendyol'a bağlanılamadı: ${msg}`);
  }

  if (!res.ok) {
    let body = "";
    try { body = (await res.text()).slice(0, 500); } catch { /* yut */ }
    throw new TrendyolApiError(res.status, `Trendyol kargo etiketi oluşturulamadı (HTTP ${res.status}). ${body}`);
  }
  // Yanıt gövdesi genelde anlamsız/boş; yutulur.
}

export type CommonLabelResult = {
  contentType: string;
  base64?: string; // binary yanıt (PDF / octet-stream / image)
  text?: string;   // metin yanıt (ZPL)
  json?: unknown;  // json yanıt (bilinmeyen şekil — frontend ham gösterir)
};

export async function getCommonLabel(cargoTrackingNumber: string): Promise<CommonLabelResult> {
  if (!isTrendyolConfigured()) {
    throw new TrendyolNotConfiguredError();
  }
  const url = new URL(
    `${env.trendyolApiBaseUrl}/integration/sellers/${env.trendyolSellerId}/common-label/${encodeURIComponent(cargoTrackingNumber)}`,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(),
      signal: AbortSignal.timeout(ORDERS_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TrendyolApiError(0, `Trendyol'a bağlanılamadı: ${msg}`);
  }

  if (!res.ok) {
    let body = "";
    try { body = (await res.text()).slice(0, 500); } catch { /* yut */ }
    throw new TrendyolApiError(res.status, `Trendyol kargo etiketi alınamadı (HTTP ${res.status}). ${body}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return { contentType, json: await res.json() };
  }
  if (/pdf|octet-stream|image|zpl/i.test(contentType)) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { contentType, base64: buf.toString("base64") };
  }
  return { contentType, text: await res.text() };
}

// ── Kargo firması değiştirme (Change Cargo Provider) — Faz 2 (YAZMA) ──────────
//
// PUT {base}/integration/order/sellers/{sellerId}/shipment-packages/{packageId}/cargo-providers
//   body: { cargoProvider: "<KOD>" }  → paketin kargo firmasını değiştirir.
// Kaynak: docs/trendyol-stage-collection.json "Change Cargo Provider (Paket Kargo
// Firması Değiştirme)" + developers.trendyol.com. Geçerli KODlar order-cargo.service
// içindeki whitelist'tedir (YKMP/ARASMP/PTTMP/…); client KOD doğrulamaz, sadece gönderir.
//
// !!! changeCargoProvider CANLI TY'ye yazar (gerçek müşteri paketinin kargosunu
// değiştirir). Yalnız order-cargo.service tarafından (marketplaceFulfillmentEnabled
// flag + UI onayı + whitelist doğrulaması) çağrılmalı. Smoke offline enjekte client
// kullanır. YAZMA → ASLA yeniden denenmez (TY: paket başına 5 dk'da yalnız 1 değişiklik).
//
// TY değişikliği async uygulayabilir; çağıran sonradan getOrders ile teyit eder.
export async function changeCargoProvider(
  packageId: string,
  cargoProvider: string,
): Promise<void> {
  if (!isTrendyolConfigured()) {
    throw new TrendyolNotConfiguredError();
  }
  const url = new URL(
    `${env.trendyolApiBaseUrl}/integration/order/sellers/${env.trendyolSellerId}/shipment-packages/${encodeURIComponent(packageId)}/cargo-providers`,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers: { ...buildHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ cargoProvider }),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TrendyolApiError(0, `Trendyol'a bağlanılamadı: ${msg}`);
  }

  if (!res.ok) {
    let body = "";
    try { body = (await res.text()).slice(0, 500); } catch { /* yut */ }
    throw new TrendyolApiError(res.status, `Trendyol kargo firması değiştirilemedi (HTTP ${res.status}). ${body}`);
  }
  // Yanıt gövdesi genelde boş/anlamsız; yutulur.
}
