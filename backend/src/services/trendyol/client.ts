// v1.6 — Trendyol Marketplace read-only client.
//
// YALNIZ sipariş OKUMA (GET). Bu dosya hiçbir yazma (POST/PUT/DELETE) isteği
// yapmaz; collection'daki yazma uçları kapsam dışı.
//
// Kaynak: docs/trendyol-stage-collection.json (KESİN endpoint/method/header
// kaynağı). Collection STAGE; base URL ve kimlik env'den gelir, demo token
// HARDCODE EDİLMEZ. Biz PROD + read-only kullanıyoruz (base URL varsayılanı PROD).
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
export type TrendyolOrderLine = {
  barcode?: string;
  quantity?: number;
  productName?: string;
  merchantSku?: string;
  sku?: string;
  price?: number;
};

export type TrendyolOrder = {
  orderNumber?: string;
  orderDate?: number;
  status?: string;
  grossAmount?: number;
  totalPrice?: number;
  customerFirstName?: string;
  customerLastName?: string;
  lines?: TrendyolOrderLine[];
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
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      // yut
    }
    throw new TrendyolApiError(res.status, `Trendyol siparişleri alınamadı (HTTP ${res.status}). ${body}`);
  }

  return (await res.json()) as TrendyolOrdersResponse;
}
