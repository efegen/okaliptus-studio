// Hepsiburada Marketplace client.
//
// Kaynak: developers.hepsiburada.com (OpenAPI'ler: katalog v1.0, listeleme v1,
// sipariş v1.0, test siparişi v1.0). Doküman URL'leri test (SIT) ortamınındır;
// canlı URL = aynı adresten "-sit" kaldırılmış hali.
//
// Kimlik (HB'nin entegrasyon maili, 2026-11-16):
//   Authorization: Basic base64(merchantId:secretKey)
//   User-Agent: <developer username>   (HB'nin verdiği, ör. "okaliptusyoga_dev")
//
// Ortam env'den gelir ve varsayılanı SIT'tir (bkz. env.hepsiburadaEnv). Canlıya
// yalnız HEPSIBURADA_ENV=prod açıkça set edilince gidilir.
//
// GET'ler geçici hatalarda (ağ / 429 / 502-504) sınırlı kez yeniden denenir.
// YAZMALAR (POST/PUT/DELETE) ASLA yeniden denenmez: HB tarafında çift işlem
// (çift stok güncellemesi, çift paketleme) yaratabilir.

import { env } from "../../config/env.js";
import { AppError } from "../errors.js";

const GET_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 20_000;
const GET_MAX_ATTEMPTS = 3;
const GET_RETRY_BASE_MS = 400;

export class HepsiburadaNotConfiguredError extends AppError {
  constructor(
    message = "Hepsiburada API kimliği yapılandırılmamış (HEPSIBURADA_MERCHANT_ID / SECRET_KEY / USER_AGENT).",
  ) {
    super("HEPSIBURADA_NOT_CONFIGURED", message, 503);
  }
}

export class HepsiburadaApiError extends AppError {
  readonly upstreamStatus: number;
  readonly correlationId: string | null;
  constructor(upstreamStatus: number, message: string, correlationId: string | null = null) {
    super("HEPSIBURADA_API_ERROR", message, 502);
    this.upstreamStatus = upstreamStatus;
    this.correlationId = correlationId;
  }
}

export function isHepsiburadaConfigured(): boolean {
  return Boolean(env.hepsiburadaMerchantId && env.hepsiburadaSecretKey && env.hepsiburadaUserAgent);
}

// HB servisleri ayrı host'larda yaşar. testOrders yalnız SIT'te vardır.
export type HepsiburadaService = "catalog" | "listing" | "orders" | "testOrders" | "finance";

export function hepsiburadaBaseUrl(service: HepsiburadaService): string {
  const sit = env.hepsiburadaEnv === "sit" ? "-sit" : "";
  switch (service) {
    case "catalog":
      return `https://mpop${sit}.hepsiburada.com/product`;
    case "listing":
      return `https://listing-external${sit}.hepsiburada.com`;
    case "orders":
      return `https://oms-external${sit}.hepsiburada.com`;
    case "finance":
      return `https://mpfinance-external${sit}.hepsiburada.com`;
    case "testOrders":
      if (env.hepsiburadaEnv !== "sit") {
        throw new HepsiburadaApiError(0, "Test siparişi yalnız Hepsiburada test (SIT) ortamında oluşturulabilir.");
      }
      return "https://oms-stub-external-sit.hepsiburada.com";
  }
}

function buildHeaders(hasJsonBody: boolean): Record<string, string> {
  if (!isHepsiburadaConfigured()) throw new HepsiburadaNotConfiguredError();
  const token = Buffer.from(`${env.hepsiburadaMerchantId}:${env.hepsiburadaSecretKey}`).toString("base64");
  const headers: Record<string, string> = {
    Authorization: `Basic ${token}`,
    "User-Agent": env.hepsiburadaUserAgent,
    Accept: "application/json",
  };
  if (hasJsonBody) headers["Content-Type"] = "application/json";
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

export type HepsiburadaRequestOptions = {
  query?: Record<string, string | number | boolean | undefined>;
  // JSON gövde. formData ile birlikte verilmez.
  body?: unknown;
  // multipart/form-data gövde (ör. katalog "Ürün Bilgisi Gönderme" .json dosyası).
  // Content-Type'ı (boundary ile) fetch kendisi koyar.
  formData?: FormData;
};

export type HepsiburadaResponse<T> = {
  status: number;
  data: T;
  // HB destek ekibi bir isteği bu kimlikle (son 7 gün) izleyebilir.
  correlationId: string | null;
};

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function hepsiburadaRequest<T = unknown>(
  service: HepsiburadaService,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts: HepsiburadaRequestOptions = {},
): Promise<HepsiburadaResponse<T>> {
  const url = new URL(`${hepsiburadaBaseUrl(service)}${path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const hasBody = opts.body !== undefined;
  const requestBody: FormData | string | undefined = opts.formData ?? (hasBody ? JSON.stringify(opts.body) : undefined);
  const isGet = method === "GET";
  const maxAttempts = isGet ? GET_MAX_ATTEMPTS : 1;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: buildHeaders(hasBody),
        body: requestBody,
        signal: AbortSignal.timeout(isGet ? GET_TIMEOUT_MS : WRITE_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastErr = new HepsiburadaApiError(0, `Hepsiburada'ya bağlanılamadı: ${msg}`);
      if (attempt < maxAttempts) {
        await sleep(GET_RETRY_BASE_MS * attempt);
        continue;
      }
      throw lastErr;
    }

    const correlationId = res.headers.get("x-correlation-id");
    const data = await readBody(res);
    if (!res.ok) {
      const snippet = (typeof data === "string" ? data : JSON.stringify(data ?? "")).slice(0, 800);
      const apiErr = new HepsiburadaApiError(
        res.status,
        `Hepsiburada ${method} ${path} başarısız (HTTP ${res.status}). ${snippet}`,
        correlationId,
      );
      if (isRetryableStatus(res.status) && attempt < maxAttempts) {
        lastErr = apiErr;
        await sleep(GET_RETRY_BASE_MS * attempt);
        continue;
      }
      throw apiErr;
    }
    return { status: res.status, data: data as T, correlationId };
  }
  throw lastErr ?? new HepsiburadaApiError(0, `Hepsiburada ${method} ${path} başarısız.`);
}

const merchantPath = () => encodeURIComponent(env.hepsiburadaMerchantId);

// ── Listeleme ────────────────────────────────────────────────────────────────

// Listing Bilgilerini Sorgulama yanıtı (yalnız kullandığımız alanlar).
export type HepsiburadaListing = {
  listingId?: string;
  hepsiburadaSku?: string;
  merchantSku?: string;
  price?: number;
  availableStock?: number;
  dispatchTime?: number;
  cargoCompany1?: string;
  cargoCompany2?: string;
  cargoCompany3?: string;
  shippingAddressLabel?: string;
  claimAddressLabel?: string;
  shippingProfileName?: string;
  maximumPurchasableQuantity?: number;
  isSalable?: boolean;
  isSuspended?: boolean;
  isLocked?: boolean;
  isFrozen?: boolean;
};

export type HepsiburadaListingsResponse = {
  totalCount?: number;
  limit?: number;
  offset?: number;
  listings?: HepsiburadaListing[];
};

export async function getListings(params: { offset?: number; limit?: number; hbSkuList?: string[] } = {}) {
  return hepsiburadaRequest<HepsiburadaListingsResponse>(
    "listing",
    "GET",
    `/listings/merchantid/${merchantPath()}`,
    {
      query: {
        offset: params.offset ?? 0,
        limit: params.limit ?? 10,
        hbSkuList: params.hbSkuList?.length ? params.hbSkuList.join(",") : undefined,
      },
    },
  );
}

// Toplu güncellemeler ASENKRON: POST bir yükleme id'si döner, sonuç ayrı GET ile
// sorgulanır. Aynı anda en fazla 5 bekleyen yükleme; istek başına ≤ 4000 SKU.
export type HepsiburadaUploadKind = "stock-uploads" | "price-uploads" | "inventory-uploads";

export type HepsiburadaUploadResult = {
  id?: string;
  status?: string; // "Done" | "Failed" | işleniyor
  createdAt?: string;
  total?: number;
  errors?: unknown[] | null;
  priceValidations?: unknown[] | null;
};

export type HepsiburadaStockUpload = { hepsiburadaSku?: string; merchantSku?: string; availableStock: number };
export type HepsiburadaPriceUpload = { hepsiburadaSku?: string; merchantSku?: string; price: number };
export type HepsiburadaInventoryUpload = {
  hepsiburadaSku?: string;
  merchantSku?: string;
  price: number;
  availableStock: number;
  cargoCompany1?: string;
  cargoCompany2?: string;
  cargoCompany3?: string;
  shippingAddressLabel?: string;
  claimAddressLabel?: string;
  maximumPurchasableQuantity?: number;
  shippingProfileName?: string;
};

async function postUpload(kind: HepsiburadaUploadKind, rows: unknown[]) {
  return hepsiburadaRequest<{ id?: string }>("listing", "POST", `/listings/merchantid/${merchantPath()}/${kind}`, { body: rows });
}

export const uploadStock = (rows: HepsiburadaStockUpload[]) => postUpload("stock-uploads", rows);
export const uploadPrice = (rows: HepsiburadaPriceUpload[]) => postUpload("price-uploads", rows);
export const uploadInventory = (rows: HepsiburadaInventoryUpload[]) => postUpload("inventory-uploads", rows);

export async function getUploadResult(kind: HepsiburadaUploadKind, id: string) {
  return hepsiburadaRequest<HepsiburadaUploadResult>(
    "listing",
    "GET",
    `/listings/merchantid/${merchantPath()}/${kind}/id/${encodeURIComponent(id)}`,
  );
}

export async function activateListing(hbSku: string) {
  return hepsiburadaRequest<unknown>("listing", "POST", `/listings/merchantid/${merchantPath()}/sku/${encodeURIComponent(hbSku)}/activate`);
}

export async function deactivateListing(hbSku: string) {
  return hepsiburadaRequest<unknown>("listing", "POST", `/listings/merchantid/${merchantPath()}/sku/${encodeURIComponent(hbSku)}/deactivate`);
}

// Fiyat eşiği dışı güncellemede kilitlenen (MinLock/MaxLock) listinglerin kilidini kaldırır.
export async function bulkUnlock(hbSkus: string[]) {
  return hepsiburadaRequest<unknown>("listing", "POST", `/listings/merchantid/${merchantPath()}/bulk-unlock`, {
    body: { hbSkuList: hbSkus },
  });
}

// ── Katalog (ürün gönderme) ──────────────────────────────────────────────────
// Yanıtlar { success, code, message, data, ... } zarfında döner. code 0 = başarı.

export type HepsiburadaEnvelope<T> = {
  success?: boolean;
  code?: number;
  message?: string;
  data?: T;
  totalElements?: number;
  totalPages?: number;
  number?: number;
};

export type HepsiburadaCategory = {
  categoryId?: number;
  name?: string;
  displayName?: string;
  parentCategoryId?: number;
  paths?: string[];
  leaf?: boolean;
  status?: string;
  available?: boolean;
};

export type HepsiburadaCategoryAttribute = {
  id?: string;
  name?: string;
  mandatory?: boolean;
  type?: string; // "string" | "enum"
  multiValue?: boolean;
};

export type HepsiburadaCategoryAttributes = {
  baseAttributes?: HepsiburadaCategoryAttribute[];
  attributes?: HepsiburadaCategoryAttribute[];
  variantAttributes?: HepsiburadaCategoryAttribute[];
};

export type HepsiburadaImportStatus = {
  merchantSku?: string;
  hbSku?: string;
  barcode?: string;
  productName?: string;
  productStatus?: string;
  importStatus?: string;
  importMessages?: unknown[];
  validationResults?: unknown[];
  rejectReasonsMessages?: unknown[];
  matchedHbProductInfo?: unknown[];
};

export async function getCategories(params: { page?: number; size?: number } = {}) {
  return hepsiburadaRequest<HepsiburadaEnvelope<HepsiburadaCategory[]>>("catalog", "GET", "/api/categories/get-all-categories", {
    query: { leaf: true, status: "ACTIVE", available: true, page: params.page ?? 0, size: params.size ?? 100 },
  });
}

export async function getCategoryAttributes(categoryId: number) {
  return hepsiburadaRequest<HepsiburadaEnvelope<HepsiburadaCategoryAttributes>>(
    "catalog",
    "GET",
    `/api/categories/${categoryId}/attributes`,
  );
}

export async function getCategoryAttributeValues(categoryId: number, attributeId: string, params: { page?: number; size?: number } = {}) {
  return hepsiburadaRequest<HepsiburadaEnvelope<Array<{ id?: string; value?: string }>>>(
    "catalog",
    "GET",
    `/api/categories/${categoryId}/attribute/${encodeURIComponent(attributeId)}/values`,
    { query: { page: params.page ?? 0, size: params.size ?? 100 } },
  );
}

// Hızlı Ürün Yükleme: yalnız HB kataloğunda zaten olan (global barkodlu) ürünler.
export type HepsiburadaFastListingItem = {
  merchantSku: string;
  productName: string;
  barcode?: string;
  hbSku?: string;
  price?: string;
  stock?: string;
};

export async function fastListing(items: HepsiburadaFastListingItem[]) {
  const body = items.map((item) => ({ merchant: env.hepsiburadaMerchantId, ...item }));
  return hepsiburadaRequest<HepsiburadaEnvelope<unknown> & { trackingId?: string }>("catalog", "POST", "/api/products/fastlisting", { body });
}

// Ürün Bilgisi Gönderme: ürünler .json DOSYASI olarak multipart ile gider.
export async function importProducts(products: unknown[]) {
  const form = new FormData();
  form.append("file", new Blob([JSON.stringify(products)], { type: "application/json" }), "integrator.json");
  return hepsiburadaRequest<HepsiburadaEnvelope<{ trackingId?: string }> & { trackingId?: string }>(
    "catalog",
    "POST",
    "/api/products/import",
    { formData: form },
  );
}

export async function getProductStatus(trackingId: string, params: { page?: number; size?: number } = {}) {
  return hepsiburadaRequest<HepsiburadaEnvelope<HepsiburadaImportStatus[]>>(
    "catalog",
    "GET",
    `/api/products/status/${encodeURIComponent(trackingId)}`,
    { query: { page: params.page ?? 0, size: params.size ?? 100 } },
  );
}

// Eşleşen statüdeki ürünü onayla / reddet (merchantSku listesiyle).
export async function approvePrematch(merchantSkus: string[]) {
  return hepsiburadaRequest<unknown>("catalog", "POST", "/api/products/approve-prematch", {
    body: [{ merchant: env.hepsiburadaMerchantId, merchantSkuList: merchantSkus }],
  });
}

export async function rejectPrematch(merchantSkus: string[]) {
  return hepsiburadaRequest<unknown>("catalog", "POST", "/api/products/reject-prematch", {
    body: [{ merchant: env.hepsiburadaMerchantId, merchantSkuList: merchantSkus }],
  });
}

// ── Sipariş ──────────────────────────────────────────────────────────────────
// Canlı mağazada otomatik paketleme AÇIK (tek paket): HB siparişi ~15 dk içinde
// kendisi paketler; asıl akış "paketleri listele" (GET /packages) üzerinden okur.
// "Ödemesi tamamlanmış siparişler" + API ile paketleme yalnız otomatik paketleme
// kapalıysa (ya da test ortamında) gerekir.

export type HepsiburadaMoney = { amount?: number; currency?: string };

export type HepsiburadaOrderItem = {
  id?: string; // lineItemId
  orderNumber?: string;
  orderDate?: string;
  sku?: string;
  merchantSku?: string;
  name?: string;
  quantity?: number;
  status?: string;
  unitPrice?: HepsiburadaMoney;
  totalPrice?: HepsiburadaMoney;
  cargoCompany?: string;
  customerName?: string;
};

export type HepsiburadaPaged<T> = {
  items?: T[];
  totalCount?: number;
  limit?: number;
  offset?: number;
  pageCount?: number;
};

// Ürün özelliği (ör. { name: "Renk", value: "Kırmızı" }).
export type HepsiburadaProperty = { name?: string; value?: string; displayName?: string };

// Paketlenmiş (kargoya hazır) paket — GET /packages. Tarihler saat dilimsiz
// İstanbul saatidir ("2026-11-16T14:56:30.4"). Tutarlar { currency, amount }.
export type HepsiburadaPackage = {
  id?: string;
  packageNumber?: string;
  barcode?: string;           // kargo barkodu (etikette basılan)
  status?: string;            // ör. "Open"
  cargoCompany?: string;      // firma ADI ("Yurtiçi Kargo")
  orderDate?: string;
  dueDate?: string;           // kargoya teslim son tarihi
  customerName?: string;
  recipientName?: string;
  shippingCity?: string;
  shippingTown?: string;      // ilçe
  shippingDistrict?: string;  // mahalle/semt (HB'de ilçe "town")
  totalPrice?: HepsiburadaMoney;
  isCargoChangable?: boolean;
  items?: Array<{
    orderNumber?: string;
    orderDate?: string;
    orderLineId?: string;
    lineItemId?: string;
    sku?: string;
    hbSku?: string;
    merchantSku?: string;
    productName?: string;
    name?: string;
    quantity?: number;
    price?: HepsiburadaMoney;
    totalPrice?: HepsiburadaMoney;
    totalMerchantDiscount?: HepsiburadaMoney;
    commissionRate?: number;
    vatRate?: number;
    productBarcode?: string;
    productImageUrlFormat?: string; // "{size}" yer tutucusu içerir
    properties?: HepsiburadaProperty[] | null;
  }>;
};

// Kargoya verilen / teslim edilen / teslim edilemeyen paket listeleri İNCE kayıt
// döner (PascalCase): ürün, müşteri, tutar YOK → sipariş detayından tamamlanır.
export type HepsiburadaPackageEvent = {
  Id?: string;
  Barcode?: string;
  PackageNumber?: string;
  OrderNumber?: string;
  OrderNumbers?: string[];
  ShippedDate?: string;
  DeliveredDate?: string;
  UndeliveredDate?: string;
  UndeliveredReason?: string;
  HasInvoice?: boolean;
};

export type HepsiburadaPackageEventKind = "shipped" | "delivered" | "undelivered";

export type HepsiburadaAddress = {
  name?: string;
  city?: string;
  town?: string;
  district?: string;
};

// Sipariş detayı — GET /orders/.../ordernumber/{n}. Her kalem kendi paket no,
// durum ve kargo firmasını taşır (bir sipariş birden çok pakete bölünebilir).
export type HepsiburadaOrderDetail = {
  orderNumber?: string;
  orderDate?: string;
  customer?: { customerId?: string; name?: string };
  deliveryAddress?: HepsiburadaAddress;
  items?: Array<{
    id?: string;
    orderNumber?: string;
    orderDate?: string;
    dueDate?: string;
    lastStatusUpdateDate?: string;
    name?: string;
    sku?: string;
    merchantSKU?: string;
    quantity?: number;
    unitPrice?: HepsiburadaMoney;
    totalPrice?: HepsiburadaMoney;
    merchantDiscount?: { totalPrice?: HepsiburadaMoney; unitPrice?: HepsiburadaMoney };
    commissionRate?: number;
    vatRate?: number;
    customerName?: string;
    status?: string;            // "InTransit", "Delivered", …
    cargoCompany?: string;
    cargoCompanyModel?: { id?: number; name?: string; shortName?: string; logoUrl?: string } | null;
    isCargoChangable?: boolean;
    packageNumber?: string;
    barcode?: string;
    hasInvoice?: boolean;
    productBarcode?: string;
    productImageUrlFormat?: string;
    properties?: HepsiburadaProperty[] | null;
    shippingAddress?: HepsiburadaAddress;
  }>;
};

// Paketin kargo bilgisi — GET /packages/.../packagenumber/{n} (dizi döner).
export type HepsiburadaPackageCargoInfo = {
  packageNumber?: string;
  status?: string;
  cargoCompany?: string;
  trackingInfoCode?: string;  // kargo firmasının takip no'su (ör. PTT "KP…")
  trackingInfoUrl?: string;
  barcode?: string;
  estimatedArrivalDate?: string;
};

const ordersPath = () => `/orders/merchantid/${merchantPath()}`;
const packagesPath = () => `/packages/merchantid/${merchantPath()}`;

// Test Siparişi Oluşturma (yalnız SIT). Gövde HB'nin stub modelidir (PascalCase).
export type HepsiburadaTestOrderLine = {
  listingId: string;
  merchantSku: string;
  hbSku: string;
  quantity: number;
  unitPrice: number;
  vatRate: number; // ör. 20
};

// cargoCompanyId: HB'nin "Sipariş Entegrasyonu Önemli Bilgiler" örneğinde fiziksel
// ürün için 1; dijital ürün testleri için doküman 89100 ister.
export async function createTestOrder(params: { orderNumber: string; lines: HepsiburadaTestOrderLine[]; cargoCompanyId?: number }) {
  const body = {
    OrderNumber: params.orderNumber,
    OrderDate: new Date().toISOString(),
    PaymentStatus: "Paid",
    Customer: { CustomerId: `okaliptus-test-${params.orderNumber}`, Name: "Okaliptus Test Müşteri" },
    DeliveryAddress: {
      AddressId: `okaliptus-test-addr-${params.orderNumber}`,
      Name: "Okaliptus Test Müşteri",
      AddressDetail: "Test adresi, entegrasyon denemesi",
      City: "İzmir",
      District: "Torbalı",
      CountryCode: "TR",
      Email: "test@example.com",
      PhoneNumber: "5000000000",
    },
    LineItems: params.lines.map((l) => {
      const total = Math.round(l.unitPrice * l.quantity * 100) / 100;
      return {
        ListingId: l.listingId,
        MerchantId: env.hepsiburadaMerchantId,
        MerchantSku: l.merchantSku,
        Sku: l.hbSku,
        Quantity: l.quantity,
        Price: { Amount: l.unitPrice, Currency: "TRY" },
        TotalPrice: { Amount: total, Currency: "TRY" },
        Vat: Math.round((total - total / (1 + l.vatRate / 100)) * 100) / 100,
        CargoCompanyId: params.cargoCompanyId ?? 1,
        DeliveryOptionId: 1,
      };
    }),
  };
  return hepsiburadaRequest<unknown>("testOrders", "POST", `/orders/merchantId/${merchantPath()}`, { body });
}

// Ödemesi tamamlanmış (paketlenecek) siparişler.
export async function getPaidOrders(params: { offset?: number; limit?: number } = {}) {
  return hepsiburadaRequest<HepsiburadaPaged<HepsiburadaOrderItem>>("orders", "GET", ordersPath(), {
    query: { offset: params.offset ?? 0, limit: params.limit ?? 50 },
  });
}

export async function getCancelledOrders(params: { offset?: number; limit?: number } = {}) {
  return hepsiburadaRequest<HepsiburadaPaged<HepsiburadaOrderItem>>("orders", "GET", `${ordersPath()}/cancelled`, {
    query: { offset: params.offset ?? 0, limit: params.limit ?? 50 },
  });
}

export async function getOrderDetail(orderNumber: string) {
  return hepsiburadaRequest<HepsiburadaOrderDetail>(
    "orders",
    "GET",
    `${ordersPath()}/ordernumber/${encodeURIComponent(orderNumber)}`,
  );
}

// HB tarih sorguları "yyyy-MM-dd HH:mm" ister (İstanbul saati; başka biçim →
// 400 WrongDateFormat). Türkiye 2016'dan beri sabit UTC+3.
export function hepsiburadaQueryDate(ms: number): string {
  return new Date(ms + 3 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
}

// Kargoya verilen / teslim edilen / teslim edilemeyen paketler (ince kayıt).
// limit en fazla 50; tarih aralığı olay (kargoya verilme/teslim) tarihine göredir.
export async function getPackageEvents(
  kind: HepsiburadaPackageEventKind,
  params: { beginMs: number; endMs: number; offset?: number; limit?: number },
) {
  return hepsiburadaRequest<HepsiburadaPaged<HepsiburadaPackageEvent>>("orders", "GET", `${packagesPath()}/${kind}`, {
    query: {
      begindate: hepsiburadaQueryDate(params.beginMs),
      enddate: hepsiburadaQueryDate(params.endMs),
      offset: params.offset ?? 0,
      limit: params.limit ?? 50,
    },
  });
}

export async function getPackageCargoInfo(packageNumber: string) {
  return hepsiburadaRequest<HepsiburadaPackageCargoInfo[]>(
    "orders",
    "GET",
    `${packagesPath()}/packagenumber/${encodeURIComponent(packageNumber)}`,
  );
}

export async function getPackageableWith(lineItemId: string) {
  return hepsiburadaRequest<{ lineItems?: Array<{ id?: string; quantity?: number }>; totalDeci?: number }>(
    "orders",
    "GET",
    `/lineitems/merchantid/${merchantPath()}/packageablewith/lineitemid/${encodeURIComponent(lineItemId)}`,
  );
}

// Kalem(ler)i paketle — yalnız otomatik paketleme kapalıyken gerekir.
export async function packLineItems(
  lines: Array<{ id: string; quantity: number }>,
  extra: { cargoCompany?: string; deci?: number; warehouse?: { shippingAddressLabel: string; shippingModel: string } } = {},
) {
  return hepsiburadaRequest<unknown>("orders", "POST", packagesPath(), {
    body: { parcelQuantity: 1, ...extra, lineItemRequests: lines.map((l) => ({ id: l.id, quantity: l.quantity })) },
  });
}

// Paketlenmiş siparişler (otomatik paketleme açıkken ana okuma ucu). HB belgesi
// limit'i en fazla 10 olarak verir; tüm liste için Offset ile sayfalanır.
export async function getPackages(params: { offset?: number; limit?: number } = {}) {
  return hepsiburadaRequest<HepsiburadaPackage[]>("orders", "GET", packagesPath(), {
    query: { Offset: params.offset ?? 0, limit: params.limit ?? 10 },
  });
}

export async function getUnpackedPackages(params: { offset?: number; limit?: number } = {}) {
  return hepsiburadaRequest<HepsiburadaPaged<HepsiburadaPackage>>("orders", "GET", `${packagesPath()}/status/unpacked`, {
    query: { Offset: params.offset ?? 0, limit: params.limit ?? 50 },
  });
}

export async function unpackPackage(packageNumber: string) {
  return hepsiburadaRequest<unknown>("orders", "POST", `${packagesPath()}/packagenumber/${encodeURIComponent(packageNumber)}/unpack`);
}

// Paket bölme: bir kalemi/adedi ayrı pakete ayırır; paket numarası değişir.
export async function splitPackage(packageNumber: string, groups: Array<Array<{ orderLineId: string; quantity: number }>>) {
  return hepsiburadaRequest<unknown>("orders", "POST", `${packagesPath()}/packagenumber/${encodeURIComponent(packageNumber)}/split`, {
    body: { packageDetails: groups.map((lines) => ({ parcelQuantity: 1, lines })) },
  });
}

// Satıcı iptali: kalem paketli OLMAMALI (önce paket bozulur).
// !!! CANLIDA CEZALI: HB sözleşmedeki tutarda ceza faturası keser (ör. 200–1000 TL
// ürün → 100 TL), ürün başka satıcıya devredilir ya da satışa kilitlenir. Günlük
// limit 100. Panelden kullanıcıya açılacaksa açık onay adımı şart.
export async function cancelLineItem(lineItemId: string, reasonId: number) {
  return hepsiburadaRequest<unknown>(
    "orders",
    "POST",
    `/lineitems/merchantid/${merchantPath()}/id/${encodeURIComponent(lineItemId)}/cancelbymerchant`,
    { body: { reasonId } },
  );
}

// E-arşiv faturanın PDF linkini pakete bağlar.
export async function sendInvoiceLink(packageNumber: string, invoiceLink: string) {
  return hepsiburadaRequest<unknown>("orders", "PUT", `${packagesPath()}/packagenumber/${encodeURIComponent(packageNumber)}/invoice`, {
    body: { invoiceLink },
  });
}

// ── Muhasebe (salt okuma) ────────────────────────────────────────────────────
// Kayıt bazlı muhasebe: komisyon, ödeme, kargo katkı payı, stopaj vb. Kayıtlar
// sipariş TESLİM EDİLDİKTEN sonra oluşur. 4 tarih aralığından biri ya da
// orderNumber/packageNumber/sku/referenceDocument zorunlu; Limit ≤ 100.
export type HepsiburadaTransactionsQuery = {
  offset?: number;
  limit?: number;
  transactionTypes?: string; // virgüllü, ör. "Commission,Payment"
  status?: "Paid" | "WillBePaid";
  orderNumber?: string;
  recordDateStart?: string; // YYYY-MM-DD
  recordDateEnd?: string;
};

export async function getFinanceTransactions(q: HepsiburadaTransactionsQuery) {
  return hepsiburadaRequest<unknown>("finance", "GET", `/transactions/merchantid/${merchantPath()}`, {
    query: {
      Offset: q.offset ?? 0,
      Limit: q.limit ?? 100,
      TransactionTypes: q.transactionTypes,
      Status: q.status,
      OrderNumber: q.orderNumber,
      RecordDateStart: q.recordDateStart,
      RecordDateEnd: q.recordDateEnd,
    },
  });
}
