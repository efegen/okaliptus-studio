// v1.6 — Ürün eşleştirme kokpiti (overview + adopt).
//
// İç katalog (products) + kanal eşlemeleri (channel_listings) + kanal snapshot'ı
// (channel_products) birleştirilip "iç ürün ↔ Trendyol ↔ Hepsiburada" görünümü
// üretilir. Eşleşmeyen Trendyol ürünleri (orphan) barkod ile otomatik önerilir.
//
// adopt: bir orphan kanal ürününü ya mevcut iç ürüne BAĞLAR ya da ondan tek tıkla
// YENİ iç ürün oluşturup bağlar. Hepsiburada manuel (channel_listings, PR2 uçları).
//
// Hepsi marketplace_sync_enabled arkasında. Dış API çağrısı YOK (yalnız DB).

import { pool } from "../../db/connection.js";
import { ValidationError, toServiceError } from "../errors.js";
import { getSettings } from "../settings.service.js";
import { ProductNotFoundError } from "../products.service.js";
import { ChannelListingConflictError } from "../channel-listings.service.js";
import { isStockTrackingEnabled, setStock } from "../stock.service.js";
import {
  centsToMoney,
  insertAuditLog,
  moneyToCents,
  normalizeRequiredText,
  rollbackQuietly,
  type EntityId,
} from "../shared.js";
import { MarketplaceSyncDisabledError } from "./orders.service.js";

async function assertEnabled(): Promise<void> {
  const settings = await getSettings();
  if (!settings.marketplaceSyncEnabled) throw new MarketplaceSyncDisabledError();
}

// Snapshot'ın raw variant JSON'ından kullanılabilir bir pozitif fiyat çıkarır.
// Eski senkronlarda sale_price/list_price kolonları boş kalmış olabilir ama
// ham veri priceSeenByCustomer'ı taşır → adopt yeniden senkron beklemeden çalışsın.
function rawPriceFallback(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const price = (raw as { price?: unknown }).price;
  if (!price || typeof price !== "object") return null;
  const p = price as Record<string, unknown>;
  for (const key of ["salePrice", "priceSeenByCustomer", "listPrice"] as const) {
    const v = p[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

type ChannelSnapshot = {
  title: string | null;
  quantity: number | null;
  sale_price: string | null;
  on_sale: boolean | null;
  archived: boolean | null;
  product_url: string | null;
};

export type MappingChannelCell = {
  listingId: string;
  externalId: string;
  channelPrice: string | null;
  isListed: boolean;
  snapshot: ChannelSnapshot | null; // yalnız trendyol'da dolabilir (HB snapshot yok)
};

export type MappingProductRow = {
  id: string;
  name: string;
  barcode: string | null;
  price: string;
  imageUrl: string | null;
  archivedAt: string | null;
  trendyol: MappingChannelCell | null;
  hepsiburada: MappingChannelCell | null;
};

export type OrphanTrendyol = {
  channelProductId: string;
  externalId: string;
  productMainId: string | null;
  title: string | null;
  quantity: number | null;
  salePrice: string | null;
  onSale: boolean | null;
  archived: boolean | null;
  productUrl: string | null;
  imageUrl: string | null;
  suggestProductId: string | null;   // barkod eşitliğiyle otomatik öneri
  suggestProductName: string | null;
};

export type MappingOverview = {
  summary: {
    internalProducts: number;
    trendyolMapped: number;
    hepsiburadaMapped: number;
    orphanTrendyol: number;
    snapshotSyncedAt: string | null;
  };
  products: MappingProductRow[];
  orphanTrendyol: OrphanTrendyol[];
};

export async function getMappingOverview(): Promise<MappingOverview> {
  await assertEnabled();

  // 1) İç ürünler (aktif). Arşivliyi gizliyoruz; eşleştirme aktif katalog üzerine.
  const productsRes = await pool.query<{
    id: string; name: string; barcode: string | null; price: string; image_url: string | null; archived_at: string | null;
  }>(
    `SELECT id, name, barcode, price, image_url, archived_at
       FROM products
      WHERE archived_at IS NULL
      ORDER BY name ASC, id ASC`,
  );

  const products: MappingProductRow[] = productsRes.rows.map(p => ({
    id: p.id,
    name: p.name,
    barcode: p.barcode,
    price: p.price,
    imageUrl: p.image_url,
    archivedAt: p.archived_at,
    trendyol: null,
    hepsiburada: null,
  }));
  const byId = new Map(products.map(p => [p.id, p]));

  // 2) Bu ürünlerin kanal eşlemeleri + trendyol snapshot bilgisi.
  if (products.length > 0) {
    const ids = products.map(p => p.id);
    const listingsRes = await pool.query<{
      id: string; product_id: string; channel: string; external_id: string;
      channel_price: string | null; is_listed: boolean;
      cp_title: string | null; cp_quantity: number | null; cp_sale_price: string | null;
      cp_on_sale: boolean | null; cp_archived: boolean | null; cp_product_url: string | null;
    }>(
      `SELECT cl.id, cl.product_id, cl.channel, cl.external_id, cl.channel_price, cl.is_listed,
              cp.title AS cp_title, cp.quantity AS cp_quantity, cp.sale_price AS cp_sale_price,
              cp.on_sale AS cp_on_sale, cp.archived AS cp_archived, cp.product_url AS cp_product_url
         FROM channel_listings cl
         LEFT JOIN channel_products cp
           ON cp.channel = cl.channel AND cp.external_id = cl.external_id
        WHERE cl.product_id = ANY($1::bigint[])`,
      [ids],
    );

    for (const l of listingsRes.rows) {
      const row = byId.get(l.product_id);
      if (!row) continue;
      const cell: MappingChannelCell = {
        listingId: l.id,
        externalId: l.external_id,
        channelPrice: l.channel_price,
        isListed: l.is_listed,
        snapshot: l.channel === "trendyol"
          ? {
              title: l.cp_title,
              quantity: l.cp_quantity,
              sale_price: l.cp_sale_price,
              on_sale: l.cp_on_sale,
              archived: l.cp_archived,
              product_url: l.cp_product_url,
            }
          : null,
      };
      if (l.channel === "trendyol") row.trendyol = cell;
      else if (l.channel === "hepsiburada") row.hepsiburada = cell;
    }
  }

  // 3) Eşleşmeyen Trendyol ürünleri (channel_listing'i olmayan snapshot satırları)
  //    + barkod eşitliğiyle otomatik öneri.
  const orphanRes = await pool.query<{
    id: string; external_id: string; product_main_id: string | null; title: string | null;
    quantity: number | null; sale_price: string | null; on_sale: boolean | null;
    archived: boolean | null; product_url: string | null; image_url: string | null;
    suggest_id: string | null; suggest_name: string | null;
  }>(
    `SELECT cp.id, cp.external_id, cp.product_main_id, cp.title, cp.quantity, cp.sale_price,
            cp.on_sale, cp.archived, cp.product_url, cp.image_url,
            p.id AS suggest_id, p.name AS suggest_name
       FROM channel_products cp
       LEFT JOIN channel_listings cl
         ON cl.channel = 'trendyol' AND cl.external_id = cp.external_id
       LEFT JOIN products p
         ON p.barcode = cp.external_id AND p.archived_at IS NULL
      WHERE cp.channel = 'trendyol'
        AND cl.id IS NULL
      ORDER BY cp.product_main_id ASC, cp.external_id ASC`,
  );

  const orphanTrendyol: OrphanTrendyol[] = orphanRes.rows.map(o => ({
    channelProductId: o.id,
    externalId: o.external_id,
    productMainId: o.product_main_id,
    title: o.title,
    quantity: o.quantity,
    salePrice: o.sale_price,
    onSale: o.on_sale,
    archived: o.archived,
    productUrl: o.product_url,
    imageUrl: o.image_url,
    suggestProductId: o.suggest_id,
    suggestProductName: o.suggest_name,
  }));

  const syncedRes = await pool.query<{ synced_at: string | null }>(
    `SELECT max(synced_at) AS synced_at FROM channel_products WHERE channel = 'trendyol'`,
  );

  return {
    summary: {
      internalProducts: products.length,
      trendyolMapped: products.filter(p => p.trendyol).length,
      hepsiburadaMapped: products.filter(p => p.hepsiburada).length,
      orphanTrendyol: orphanTrendyol.length,
      snapshotSyncedAt: syncedRes.rows[0]?.synced_at ?? null,
    },
    products,
    orphanTrendyol,
  };
}

// Barkodla toplu otomatik eşleme: external_id (TY barkodu) == products.barcode
// olan ve henüz TY eşlemesi olmayan her çift için channel_listing oluşturur.
// Mevcut iç ürünü bağlar (stoğa dokunmaz). Tek transaction; her bağ için audit.
export async function autoMatchByBarcode(
  actorUserId: number | string | null = null,
): Promise<{ matched: number; links: Array<{ productId: string; externalId: string }> }> {
  await assertEnabled();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Eşleşme adayları: barkodu bir TY snapshot satırına eşit aktif iç ürünler,
    // o external_id için henüz TY listing yokken.
    const pairs = await client.query<{
      external_id: string; product_id: string; sale_price: string | null; archived: boolean | null;
    }>(
      `SELECT cp.external_id, p.id AS product_id, cp.sale_price, cp.archived
         FROM channel_products cp
         JOIN products p ON p.barcode = cp.external_id AND p.archived_at IS NULL
         LEFT JOIN channel_listings cl ON cl.channel = 'trendyol' AND cl.external_id = cp.external_id
        WHERE cp.channel = 'trendyol' AND cl.id IS NULL`,
    );

    const links: Array<{ productId: string; externalId: string }> = [];
    for (const row of pairs.rows) {
      // Bu ürünün zaten (farklı barkodla) bir TY eşlemesi varsa atla — çift TY
      // listing oluşmasın. (products.barcode UNIQUE olduğundan normalde olmaz.)
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM channel_listings WHERE product_id = $1 AND channel = 'trendyol' LIMIT 1`,
        [row.product_id],
      );
      if (existing.rows[0]) continue;

      const isListed = row.archived === true ? false : true;
      const ins = await client.query<{ id: string }>(
        `INSERT INTO channel_listings (product_id, channel, external_id, channel_price, is_listed)
         VALUES ($1, 'trendyol', $2, $3, $4) RETURNING id`,
        [row.product_id, row.external_id, row.sale_price ?? null, isListed],
      );
      await insertAuditLog(client, {
        action: "channel_listing_changed",
        entityType: "product",
        entityId: row.product_id,
        after: { id: ins.rows[0].id, channel: "trendyol", external_id: row.external_id, source: "auto-match" },
        note: "barkodla otomatik eşleme",
        actorUserId,
      });
      links.push({ productId: row.product_id, externalId: row.external_id });
    }

    await client.query("COMMIT");
    return { matched: links.length, links };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export type AdoptInput = {
  channelProductId: EntityId;
  mode: "link" | "create";
  productId?: EntityId | null; // mode='link' için zorunlu
  // mode='create' için opsiyonel kullanıcı override'ları. name verilmezse snapshot
  // başlığı kullanılır; price verilmezse snapshot fiyatına (sale/list/raw) düşülür.
  // İlanın hiçbir fiyatı yoksa price ZORUNLU olur (products.price > 0 CHECK).
  name?: string | null;
  price?: number | string | null;
  actorUserId?: number | string | null;
};

export type AdoptResult = {
  productId: string;
  listingId: string;
  created: boolean; // yeni iç ürün oluşturuldu mu
};

// Bir Trendyol snapshot ürününü iç kataloga "benimser": ya mevcut ürüne bağlar
// ya da ondan yeni iç ürün oluşturup bağlar. channel_listings + (create'te)
// products + audit aynı transaction'da.
export async function adoptChannelProduct(input: AdoptInput): Promise<AdoptResult> {
  await assertEnabled();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const cpRes = await client.query<{
      id: string; external_id: string; title: string | null; sale_price: string | null;
      list_price: string | null; archived: boolean | null; image_url: string | null;
      quantity: number | null; raw: unknown;
    }>(
      `SELECT id, external_id, title, sale_price, list_price, archived, image_url, quantity, raw
         FROM channel_products
        WHERE id = $1 AND channel = 'trendyol'
        FOR UPDATE`,
      [input.channelProductId],
    );
    const cp = cpRes.rows[0];
    if (!cp) throw new ValidationError("Kanal ürünü bulunamadı (senkron gerekebilir).");

    // Bu external_id zaten bir trendyol eşlemesinde mi?
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM channel_listings WHERE channel = 'trendyol' AND external_id = $1 LIMIT 1`,
      [cp.external_id],
    );
    if (existing.rows[0]) throw new ChannelListingConflictError();

    let productId: string;
    let created = false;

    if (input.mode === "link") {
      if (input.productId === undefined || input.productId === null || input.productId === "") {
        throw new ValidationError("Bağlanacak iç ürün (productId) gerekli.");
      }
      const prod = await client.query<{ id: string }>(
        `SELECT id FROM products WHERE id = $1`,
        [input.productId],
      );
      if (!prod.rows[0]) throw new ProductNotFoundError();
      productId = prod.rows[0].id;
    } else {
      // create: snapshot'tan yeni iç ürün. Fiyat önceliği: kullanıcı override →
      // sale_price → list_price → ham veriden priceSeenByCustomer. Hiçbiri yoksa
      // (override de yoksa) hata; artık kullanıcı fiyat girerek bunu aşabilir.
      const userPrice =
        input.price === undefined || input.price === null || input.price === ""
          ? null
          : input.price;
      const priceSource = userPrice ?? cp.sale_price ?? cp.list_price ?? rawPriceFallback(cp.raw);
      const priceCents = priceSource != null ? moneyToCents(priceSource, "price") : 0n;
      if (priceCents <= 0n) {
        throw new ValidationError("Bu ilanın fiyatı yok; lütfen bir fiyat gir.");
      }
      // İsim: kullanıcı override'ı → snapshot başlığı → barkod.
      const nameSource =
        typeof input.name === "string" && input.name.trim() !== ""
          ? input.name
          : cp.title ?? cp.external_id;
      const name = normalizeRequiredText(nameSource, "name");

      // Barkod çakışması: aynı barkodlu iç ürün varsa create değil link gerekir.
      const barcodeClash = await client.query<{ id: string }>(
        `SELECT id FROM products WHERE barcode = $1 LIMIT 1`,
        [cp.external_id],
      );
      if (barcodeClash.rows[0]) {
        throw new ValidationError("Bu barkodlu iç ürün zaten var; 'Bağla' ile eşle.");
      }

      const insP = await client.query<{ id: string; name: string }>(
        `INSERT INTO products (name, price, barcode, image_url)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name`,
        [name, centsToMoney(priceCents), cp.external_id, cp.image_url],
      );
      productId = insP.rows[0].id;
      created = true;

      await insertAuditLog(client, {
        action: "product_created",
        entityType: "product",
        entityId: productId,
        after: insP.rows[0],
        note: "kanal eşleştirmeden oluşturuldu (trendyol)",
        actorUserId: input.actorUserId ?? null,
      });

      // Açılış stoğu: stok takibi açıksa, yeni ürünün iç stoğunu Trendyol adediyle
      // tohumla — aksi halde iç stok 0, Trendyol 5 gibi yanıltıcı tutarsızlık olur.
      // (İki stok ayrı kavram; bu yalnız oluşturma anındaki en iyi tahmin. Sonra
      // otomatik senkron YOK.) qty null/0 ise setStock no-op'tur.
      if (cp.quantity !== null && Number.isInteger(cp.quantity) && (await isStockTrackingEnabled(client))) {
        await setStock(client, {
          productId,
          newOnHand: cp.quantity,
          note: "Trendyol eşleştirmesinden açılış stoğu",
          actorUserId: input.actorUserId ?? null,
        });
      }
    }

    // channel_listing oluştur (eşleme). channel_price = snapshot satış fiyatı,
    // is_listed = arşivli değilse true.
    const channelPrice = cp.sale_price ?? null;
    const isListed = cp.archived === true ? false : true;
    const insL = await client.query<{ id: string }>(
      `INSERT INTO channel_listings (product_id, channel, external_id, channel_price, is_listed)
       VALUES ($1, 'trendyol', $2, $3, $4)
       RETURNING id`,
      [productId, cp.external_id, channelPrice, isListed],
    );
    const listingId = insL.rows[0].id;

    await insertAuditLog(client, {
      action: "channel_listing_changed",
      entityType: "product",
      entityId: productId,
      after: { id: listingId, channel: "trendyol", external_id: cp.external_id, source: "adopt", mode: input.mode },
      note: created ? "adopt: yeni ürün + trendyol eşleme" : "adopt: mevcut ürüne trendyol eşleme",
      actorUserId: input.actorUserId ?? null,
    });

    await client.query("COMMIT");
    return { productId, listingId, created };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
