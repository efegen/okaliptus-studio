// v1.6 — Trendyol ürün snapshot senkronu (read-only).
//
// "Senkronize et" butonu bunu çağırır: TÜM onaylı ürünleri sayfa sayfa çeker,
// variants[] düzleştirir ve channel_products tablosuna upsert eder; bu senkronda
// görülmeyen eski trendyol satırları temizlenir (snapshot güncel kalsın).
//
// Manuel tetikleme; poller/cron YOK. marketplace_sync_enabled arkasında.
// Hiçbir yazma isteği Trendyol'a gitmez (yalnız GET).

import { pool } from "../../db/connection.js";
import { getSettings } from "../settings.service.js";
import { MarketplaceSyncDisabledError } from "./orders.service.js";
import {
  getApprovedProducts as defaultGetApprovedProducts,
  type GetApprovedProductsParams,
  type TrendyolProductsResponse,
} from "./client.js";

const PAGE_SIZE = 100; // Trendyol approved-products üst sınırı 100
const MAX_PAGES = 200; // güvenlik tavanı (100×200 = 20k varyant)

type FlatVariant = {
  externalId: string;
  productMainId: string | null;
  title: string | null;
  quantity: number | null;
  listPrice: number | null;
  salePrice: number | null;
  onSale: boolean | null;
  archived: boolean | null;
  productUrl: string | null;
  imageUrl: string | null;
  raw: unknown;
};

function flatten(response: TrendyolProductsResponse): FlatVariant[] {
  const out: FlatVariant[] = [];
  for (const product of response.content ?? []) {
    const imageUrl = product.images?.[0]?.url ?? null;
    for (const v of product.variants ?? []) {
      const barcode = v.barcode ? String(v.barcode) : "";
      if (!barcode) continue;
      out.push({
        externalId: barcode,
        productMainId: product.productMainId ?? null,
        title: product.title ?? null,
        quantity: typeof v.stock?.quantity === "number" ? v.stock.quantity : null,
        listPrice: typeof v.price?.listPrice === "number" ? v.price.listPrice : null,
        salePrice: typeof v.price?.salePrice === "number" ? v.price.salePrice : null,
        onSale: typeof v.onSale === "boolean" ? v.onSale : null,
        archived: typeof v.archived === "boolean" ? v.archived : null,
        productUrl: v.productUrl ?? null,
        imageUrl,
        raw: v,
      });
    }
  }
  return out;
}

export type SyncResult = {
  synced: number;
  pages: number;
  pruned: number;
};

export type SyncDeps = {
  // Test/izolasyon için enjekte edilebilir sayfa çekici.
  fetchPage?: (params: GetApprovedProductsParams) => Promise<TrendyolProductsResponse>;
};

export async function syncTrendyolProducts(deps: SyncDeps = {}): Promise<SyncResult> {
  const settings = await getSettings();
  if (!settings.marketplaceSyncEnabled) {
    throw new MarketplaceSyncDisabledError();
  }

  const fetchPage = deps.fetchPage ?? defaultGetApprovedProducts;

  // Tüm sayfaları çek + düzleştir.
  const all: FlatVariant[] = [];
  let page = 0;
  let pages = 0;
  while (page < MAX_PAGES) {
    const resp = await fetchPage({ page, size: PAGE_SIZE });
    pages += 1;
    all.push(...flatten(resp));
    const totalPages = resp.totalPages ?? 1;
    page += 1;
    if (page >= totalPages || (resp.content ?? []).length === 0) break;
  }

  // Aynı senkronda dublike barkod gelebilir; son görüleni tut.
  const byBarcode = new Map<string, FlatVariant>();
  for (const v of all) byBarcode.set(v.externalId, v);
  const rows = [...byBarcode.values()];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const r of rows) {
      await client.query(
        `INSERT INTO channel_products
           (channel, external_id, product_main_id, title, quantity,
            list_price, sale_price, on_sale, archived, product_url, image_url, raw, synced_at)
         VALUES ('trendyol', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT (channel, external_id) DO UPDATE SET
           product_main_id = EXCLUDED.product_main_id,
           title           = EXCLUDED.title,
           quantity        = EXCLUDED.quantity,
           list_price      = EXCLUDED.list_price,
           sale_price      = EXCLUDED.sale_price,
           on_sale         = EXCLUDED.on_sale,
           archived        = EXCLUDED.archived,
           product_url     = EXCLUDED.product_url,
           image_url       = EXCLUDED.image_url,
           raw             = EXCLUDED.raw,
           synced_at       = now()`,
        [
          r.externalId, r.productMainId, r.title, r.quantity,
          r.listPrice, r.salePrice, r.onSale, r.archived, r.productUrl, r.imageUrl,
          JSON.stringify(r.raw),
        ],
      );
    }

    // Bu senkronda görülmeyen eski trendyol satırlarını temizle (snapshot güncel).
    const seen = rows.map(r => r.externalId);
    const prune = await client.query(
      `DELETE FROM channel_products
        WHERE channel = 'trendyol'
          AND NOT (external_id = ANY($1::text[]))`,
      [seen.length > 0 ? seen : [""]],
    );

    await client.query("COMMIT");
    return { synced: rows.length, pages, pruned: prune.rowCount ?? 0 };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* yut */ }
    throw error;
  } finally {
    client.release();
  }
}
