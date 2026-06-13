// v1.6 — Trendyol sipariş önizleme (read-only + eşleştirme).
//
// Kapsam: Trendyol'dan GET ile siparişleri çek, her sipariş satırını
// channel_listings (channel='trendyol', external_id = barkod) üzerinden iç ürüne
// EŞLEŞTİR ve ÖNİZLEME döndür. DB'ye sipariş YAZILMAZ; satış/stok'a DOKUNULMAZ.
//
// marketplace_sync_enabled (migration 0242) arkasında: flag kapalıyken önizleme
// ucu MarketplaceSyncDisabledError döner.

import { pool } from "../../db/connection.js";
import { AppError } from "../errors.js";
import { getSettings } from "../settings.service.js";
import {
  getOrders as defaultGetOrders,
  type GetOrdersParams,
  type TrendyolOrder,
  type TrendyolOrdersResponse,
} from "./client.js";

export class MarketplaceSyncDisabledError extends AppError {
  constructor(message = "Pazaryeri senkronu kapalı. Ayarlardan 'Kanal eşleştirme'yi açın.") {
    super("MARKETPLACE_SYNC_DISABLED", message, 409);
  }
}

export type PreviewLine = {
  barcode: string | null;
  quantity: number;
  channelProductName: string | null; // Trendyol'dan gelen ad
  matched: boolean;
  productId: string | null;          // eşleşen iç ürün
  internalName: string | null;       // iç ürün adı (channel_listings → products)
};

export type PreviewOrder = {
  orderNumber: string | null;
  status: string | null;
  orderDate: number | null;
  customerName: string | null;
  lines: PreviewLine[];
};

export type OrderPreview = {
  summary: {
    totalOrders: number;
    totalLines: number;
    matchedLines: number;
    unmatchedLines: number;
    unmatchedBarcodes: string[];
  };
  orders: PreviewOrder[];
};

// barcode → { productId, internalName } eşleme tablosu.
export type MatchMap = Map<string, { productId: string; internalName: string }>;

// Saf eşleştirme: Trendyol siparişleri + eşleme tablosu → önizleme. Ağ/DB yok,
// bu yüzden offline test edilebilir.
export function buildOrderPreview(orders: TrendyolOrder[], matchMap: MatchMap): OrderPreview {
  let totalLines = 0;
  let matchedLines = 0;
  const unmatchedBarcodes = new Set<string>();

  const previewOrders: PreviewOrder[] = orders.map(order => {
    const lines = (order.lines ?? []).map((line): PreviewLine => {
      const barcode = line.barcode ? String(line.barcode) : null;
      const quantity = Number.isFinite(line.quantity) ? Number(line.quantity) : 1;
      totalLines += 1;

      const hit = barcode ? matchMap.get(barcode) : undefined;
      if (hit) {
        matchedLines += 1;
      } else if (barcode) {
        unmatchedBarcodes.add(barcode);
      }

      return {
        barcode,
        quantity,
        channelProductName: line.productName ?? null,
        matched: Boolean(hit),
        productId: hit?.productId ?? null,
        internalName: hit?.internalName ?? null,
      };
    });

    const customerName =
      [order.customerFirstName, order.customerLastName].filter(Boolean).join(" ").trim() || null;

    return {
      orderNumber: order.orderNumber ?? null,
      status: order.status ?? null,
      orderDate: typeof order.orderDate === "number" ? order.orderDate : null,
      customerName,
      lines,
    };
  });

  return {
    summary: {
      totalOrders: previewOrders.length,
      totalLines,
      matchedLines,
      unmatchedLines: totalLines - matchedLines,
      unmatchedBarcodes: [...unmatchedBarcodes],
    },
    orders: previewOrders,
  };
}

// Verilen barkodlar için channel_listings (trendyol) → products eşleme tablosu.
async function loadMatchMap(barcodes: string[]): Promise<MatchMap> {
  const map: MatchMap = new Map();
  if (barcodes.length === 0) return map;

  const result = await pool.query<{ external_id: string; product_id: string; name: string }>(
    `SELECT cl.external_id, cl.product_id, p.name
       FROM channel_listings cl
       JOIN products p ON p.id = cl.product_id
      WHERE cl.channel = 'trendyol'
        AND cl.external_id = ANY($1::text[])`,
    [barcodes],
  );
  for (const row of result.rows) {
    map.set(row.external_id, { productId: row.product_id, internalName: row.name });
  }
  return map;
}

export type PreviewDeps = {
  // Test/izolasyon için enjekte edilebilir. Varsayılan: gerçek Trendyol client.
  fetchOrders?: (params: GetOrdersParams) => Promise<TrendyolOrdersResponse>;
};

// Önizleme akışı: flag kontrol → siparişleri çek → barkodları topla → eşleme
// tablosunu yükle → saf eşleştir. Hiçbir kayıt yazmaz.
export async function previewTrendyolOrders(
  params: GetOrdersParams = {},
  deps: PreviewDeps = {},
): Promise<OrderPreview> {
  const settings = await getSettings();
  if (!settings.marketplaceSyncEnabled) {
    throw new MarketplaceSyncDisabledError();
  }

  const fetchOrders = deps.fetchOrders ?? defaultGetOrders;
  const response = await fetchOrders(params);
  const orders = response.content ?? [];

  const barcodes = [
    ...new Set(
      orders
        .flatMap(o => o.lines ?? [])
        .map(l => (l.barcode ? String(l.barcode) : ""))
        .filter(Boolean),
    ),
  ];

  const matchMap = await loadMatchMap(barcodes);
  return buildOrderPreview(orders, matchMap);
}
