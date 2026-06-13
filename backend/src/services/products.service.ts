// v1.6 — Ürün katalog servisi.
// Stoksuz, tek fiyatlı, image URL tabanlı.
// Soft-retire (archived_at) — geçmiş satışlar product_sale_items.name_snapshot
// üzerinden bağımsız okunabilir kalır.

import type { PoolClient } from "pg";

import { pool } from "../db/connection.js";
import {
  AppError,
  DeleteConflictError,
  ValidationError,
  toServiceError,
} from "./errors.js";
import {
  insertAuditLog,
  normalizeMoneyInput,
  normalizeOptionalText,
  normalizeRequiredText,
  rollbackQuietly,
  type EntityId,
  type MoneyInput,
} from "./shared.js";

export type ProductRow = {
  id: string;
  barcode: string | null;
  name: string;
  price: string;
  image_url: string | null;
  ty_listing_url: string | null;
  hb_listing_url: string | null;
  notes: string | null;
  parent_product_code: string | null;
  variant_label: string | null;
  category: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  // v_product_stock'tan LEFT JOIN ile gelir (migration 0241). Stok takibi
  // flag'inden bağımsız her zaman döner; UI flag'e göre gösterir/gizler.
  // Hareketi olmayan ürün 0 döner. Yetersiz stok satışı engellenmediği için
  // eksi olabilir.
  on_hand?: number;
};

export class ProductNotFoundError extends AppError {
  constructor(message = "Ürün bulunamadı.") {
    super("PRODUCT_NOT_FOUND", message, 404);
  }
}

export class BarcodeConflictError extends AppError {
  constructor(message = "Bu barkod başka bir üründe kayıtlı.") {
    super("PRODUCT_BARCODE_CONFLICT", message, 409);
  }
}

export type CreateProductInput = {
  name: string;
  price: MoneyInput;
  barcode?: string | null;
  imageUrl?: string | null;
  tyListingUrl?: string | null;
  hbListingUrl?: string | null;
  notes?: string | null;
  parentProductCode?: string | null;
  variantLabel?: string | null;
  category?: string | null;
  actorUserId?: number | string | null;
};

export type UpdateProductInput = {
  name?: string;
  price?: MoneyInput;
  barcode?: string | null;
  imageUrl?: string | null;
  tyListingUrl?: string | null;
  hbListingUrl?: string | null;
  notes?: string | null;
  parentProductCode?: string | null;
  variantLabel?: string | null;
  category?: string | null;
};

export type ListProductsOptions = {
  search?: string;
  includeArchived?: boolean;
  category?: string;
};

export async function listProducts(
  options: ListProductsOptions = {},
): Promise<ProductRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (!options.includeArchived) {
    conditions.push("archived_at IS NULL");
  }

  const search = options.search?.trim();
  if (search) {
    values.push(`%${search}%`);
    const idx = values.length;
    conditions.push(`(name ILIKE $${idx} OR barcode ILIKE $${idx} OR parent_product_code ILIKE $${idx})`);
  }

  const category = options.category?.trim();
  if (category) {
    values.push(category);
    conditions.push(`category = $${values.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Aynı parent_product_code'u paylaşan varyantların yan yana gelmesi için
  // sıralama: önce parent code (NULL'lar sona), sonra ad, sonra id.
  const result = await pool.query<ProductRow>(
    `SELECT products.*, COALESCE(ps.on_hand, 0)::int AS on_hand
       FROM products
       LEFT JOIN v_product_stock ps ON ps.product_id = products.id
       ${where}
     ORDER BY parent_product_code IS NULL, parent_product_code ASC, name ASC, id ASC`,
    values,
  );
  return result.rows;
}

// Aktif (arşivlenmemiş) ürünlerin kategorilerini, ürün sayımıyla birlikte
// döndürür. Kategori filtre dropdown'ları için kullanılır.
export async function listCategories(): Promise<Array<{ category: string; count: number }>> {
  const result = await pool.query<{ category: string; count: string }>(
    `SELECT category, COUNT(*)::text AS count
       FROM products
      WHERE category IS NOT NULL AND archived_at IS NULL
      GROUP BY category
      ORDER BY category ASC`,
  );
  return result.rows.map(r => ({ category: r.category, count: Number(r.count) }));
}

export async function getProductById(productId: EntityId): Promise<ProductRow> {
  const result = await pool.query<ProductRow>(
    `SELECT products.*, COALESCE(ps.on_hand, 0)::int AS on_hand
       FROM products
       LEFT JOIN v_product_stock ps ON ps.product_id = products.id
      WHERE products.id = $1`,
    [productId],
  );
  const product = result.rows[0];
  if (!product) throw new ProductNotFoundError();
  return product;
}

export async function createProduct(input: CreateProductInput): Promise<ProductRow> {
  const name = normalizeRequiredText(input.name, "name");
  const price = normalizeMoneyInput(input.price, "price");
  const barcode = normalizeOptionalText(input.barcode);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (barcode !== null) {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM products WHERE barcode = $1 LIMIT 1`,
        [barcode],
      );
      if (existing.rows[0]) throw new BarcodeConflictError();
    }

    const result = await client.query<ProductRow>(
      `INSERT INTO products (
         name, price, barcode, image_url, ty_listing_url, hb_listing_url, notes,
         parent_product_code, variant_label, category
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        name,
        price,
        barcode,
        normalizeOptionalText(input.imageUrl),
        normalizeOptionalText(input.tyListingUrl),
        normalizeOptionalText(input.hbListingUrl),
        normalizeOptionalText(input.notes),
        normalizeOptionalText(input.parentProductCode),
        normalizeOptionalText(input.variantLabel),
        normalizeOptionalText(input.category),
      ],
    );
    const row = result.rows[0];

    await insertAuditLog(client, {
      action: "product_created",
      entityType: "product",
      entityId: row.id,
      after: row,
      actorUserId: input.actorUserId ?? null,
    });

    await client.query("COMMIT");
    return row;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function updateProduct(
  productId: EntityId,
  input: UpdateProductInput,
  actorUserId: number | string | null = null,
): Promise<ProductRow> {
  if (Object.keys(input).length === 0) {
    throw new ValidationError("Güncellenecek alan yok.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<ProductRow>(
      `SELECT * FROM products WHERE id = $1 FOR UPDATE`,
      [productId],
    );
    const before = beforeResult.rows[0];
    if (!before) throw new ProductNotFoundError();

    const sets: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      values.push(normalizeRequiredText(input.name, "name"));
      sets.push(`name = $${values.length}`);
    }
    if (input.price !== undefined) {
      values.push(normalizeMoneyInput(input.price, "price"));
      sets.push(`price = $${values.length}`);
    }
    if (input.barcode !== undefined) {
      const nextBarcode = normalizeOptionalText(input.barcode);
      if (nextBarcode !== null && nextBarcode !== before.barcode) {
        const conflict = await client.query<{ id: string }>(
          `SELECT id FROM products WHERE barcode = $1 AND id <> $2 LIMIT 1`,
          [nextBarcode, productId],
        );
        if (conflict.rows[0]) throw new BarcodeConflictError();
      }
      values.push(nextBarcode);
      sets.push(`barcode = $${values.length}`);
    }
    if (input.imageUrl !== undefined) {
      values.push(normalizeOptionalText(input.imageUrl));
      sets.push(`image_url = $${values.length}`);
    }
    if (input.tyListingUrl !== undefined) {
      values.push(normalizeOptionalText(input.tyListingUrl));
      sets.push(`ty_listing_url = $${values.length}`);
    }
    if (input.hbListingUrl !== undefined) {
      values.push(normalizeOptionalText(input.hbListingUrl));
      sets.push(`hb_listing_url = $${values.length}`);
    }
    if (input.notes !== undefined) {
      values.push(normalizeOptionalText(input.notes));
      sets.push(`notes = $${values.length}`);
    }
    if (input.parentProductCode !== undefined) {
      values.push(normalizeOptionalText(input.parentProductCode));
      sets.push(`parent_product_code = $${values.length}`);
    }
    if (input.variantLabel !== undefined) {
      values.push(normalizeOptionalText(input.variantLabel));
      sets.push(`variant_label = $${values.length}`);
    }
    if (input.category !== undefined) {
      values.push(normalizeOptionalText(input.category));
      sets.push(`category = $${values.length}`);
    }

    if (sets.length === 0) {
      await client.query("COMMIT");
      return before;
    }

    values.push(productId);
    const updateResult = await client.query<ProductRow>(
      `UPDATE products SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values,
    );
    const updated = updateResult.rows[0];

    await insertAuditLog(client, {
      action: "product_updated",
      entityType: "product",
      entityId: updated.id,
      before,
      after: updated,
      actorUserId,
    });

    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function archiveProduct(
  productId: EntityId,
  actorUserId: number | string | null = null,
): Promise<ProductRow> {
  return setArchived(productId, true, actorUserId);
}

export async function unarchiveProduct(
  productId: EntityId,
  actorUserId: number | string | null = null,
): Promise<ProductRow> {
  return setArchived(productId, false, actorUserId);
}

async function setArchived(
  productId: EntityId,
  archive: boolean,
  actorUserId: number | string | null,
): Promise<ProductRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<ProductRow>(
      `SELECT * FROM products WHERE id = $1 FOR UPDATE`,
      [productId],
    );
    const before = beforeResult.rows[0];
    if (!before) throw new ProductNotFoundError();

    const updateResult = await client.query<ProductRow>(
      `UPDATE products SET archived_at = $1 WHERE id = $2 RETURNING *`,
      [archive ? new Date() : null, productId],
    );
    const updated = updateResult.rows[0];

    await insertAuditLog(client, {
      action: archive ? "product_archived" : "product_unarchived",
      entityType: "product",
      entityId: updated.id,
      before,
      after: updated,
      actorUserId,
    });

    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Kalıcı silme. Yalnız arşivlenmiş ürünler silinebilir (archived_at IS NOT NULL);
// aktif ürün silinmek istenirse 409 → önce arşivle. Satılmış ürünlerin
// product_sale_items satırları korunur (name_snapshot/unit_price_snapshot ile
// rapor immutable kalır); FK RESTRICT'e takılmamak için product_id NULL'a düşer.
// product_images CASCADE ile otomatik silinir (0234).
export async function deleteProduct(
  productId: EntityId,
  actorUserId: number | string | null = null,
): Promise<{ id: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<ProductRow>(
      `SELECT * FROM products WHERE id = $1 FOR UPDATE`,
      [productId],
    );
    const before = beforeResult.rows[0];
    if (!before) throw new ProductNotFoundError();
    if (before.archived_at === null) {
      throw new DeleteConflictError(
        "Yalnızca arşivlenmiş ürünler silinebilir. Önce ürünü arşivleyin.",
      );
    }

    await client.query(
      `UPDATE product_sale_items SET product_id = NULL WHERE product_id = $1`,
      [productId],
    );
    await client.query(`DELETE FROM products WHERE id = $1`, [productId]);

    await insertAuditLog(client, {
      action: "product_deleted",
      entityType: "product",
      entityId: before.id,
      before,
      actorUserId,
    });

    await client.query("COMMIT");
    return { id: before.id };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// ─── Toplu işlem (bulk) ─────────────────────────────────────────────────────
//
// Tek transaction'da birden fazla ürünün durumunu/kategorisini değiştirir.
// Her satır için ayrı UPDATE + audit log; aynı transaction içinde işlenir.
// Geçmiş satışların name_snapshot'ları DEĞİŞMEZ — sepet/rapor immutable kalır.

export type BulkOperationResult = {
  affected: number;
};

async function applyBulkOperation(
  ids: EntityId[],
  apply: (client: PoolClient, id: string, before: ProductRow) => Promise<{ after: ProductRow | null; action: string }>,
  actorUserId: number | string | null,
): Promise<BulkOperationResult> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError("En az bir ürün seçilmeli.");
  }

  const client = await pool.connect();
  let affected = 0;
  try {
    await client.query("BEGIN");

    for (const rawId of ids) {
      const id = String(rawId);
      const beforeResult = await client.query<ProductRow>(
        `SELECT * FROM products WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const before = beforeResult.rows[0];
      if (!before) continue;

      const { after, action } = await apply(client, id, before);
      // No-op kayıtlar (zaten arşivli ürün arşivlenmek istendiğinde) audit
      // çöplüğüne yazılmaz; sadece gerçek değişimler loglanır.
      if (!after) continue;

      await insertAuditLog(client, {
        action,
        entityType: "product",
        entityId: after.id,
        before,
        after,
        actorUserId,
      });
      affected += 1;
    }

    await client.query("COMMIT");
    return { affected };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function bulkArchiveProducts(
  ids: EntityId[],
  actorUserId: number | string | null = null,
): Promise<BulkOperationResult> {
  return applyBulkOperation(
    ids,
    async (client, id) => {
      const r = await client.query<ProductRow>(
        `UPDATE products SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING *`,
        [id],
      );
      return { after: r.rows[0] ?? null, action: "product_archived" };
    },
    actorUserId,
  );
}

export async function bulkUnarchiveProducts(
  ids: EntityId[],
  actorUserId: number | string | null = null,
): Promise<BulkOperationResult> {
  return applyBulkOperation(
    ids,
    async (client, id) => {
      const r = await client.query<ProductRow>(
        `UPDATE products SET archived_at = NULL WHERE id = $1 AND archived_at IS NOT NULL RETURNING *`,
        [id],
      );
      return { after: r.rows[0] ?? null, action: "product_unarchived" };
    },
    actorUserId,
  );
}

// Toplu fiyat güncellemesi.
//   mode='set'      → her ürünün fiyatı = value
//   mode='add'      → her ürünün fiyatı = price + value (negatif olabilir)
//   mode='multiply' → her ürünün fiyatı = price × (1 + value/100)  (yüzde)
//
// Hesaplanan yeni fiyat ≤ 0 ise o ürün ATLANIR (skipped'a yazılır), tüm batch
// reddedilmez. price > 0 CHECK kısıtlaması korunur.
export type BulkPriceMode = "set" | "add" | "multiply";

export type BulkPriceUpdateResult = {
  affected: number;
  skipped: number;
};

export async function bulkUpdatePrice(
  ids: EntityId[],
  mode: BulkPriceMode,
  value: number,
  actorUserId: number | string | null = null,
): Promise<BulkPriceUpdateResult> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ValidationError("En az bir ürün seçilmeli.");
  }
  if (!Number.isFinite(value)) {
    throw new ValidationError("Geçerli bir sayı girilmeli.");
  }
  if (mode === "set" && value <= 0) {
    throw new ValidationError("Sabit fiyat sıfırdan büyük olmalı.");
  }

  const client = await pool.connect();
  let affected = 0;
  let skipped = 0;
  try {
    await client.query("BEGIN");

    for (const rawId of ids) {
      const id = String(rawId);
      const beforeResult = await client.query<ProductRow>(
        `SELECT * FROM products WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const before = beforeResult.rows[0];
      if (!before) continue;

      const currentPrice = Number(before.price);
      let nextPrice: number;
      if (mode === "set") {
        nextPrice = value;
      } else if (mode === "add") {
        nextPrice = currentPrice + value;
      } else {
        nextPrice = currentPrice * (1 + value / 100);
      }

      // 2 ondalığa yuvarla (price kolonu numeric(10,2)).
      nextPrice = Math.round(nextPrice * 100) / 100;

      if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
        skipped += 1;
        continue;
      }
      if (nextPrice === currentPrice) {
        // No-op
        continue;
      }

      const r = await client.query<ProductRow>(
        `UPDATE products SET price = $1 WHERE id = $2 RETURNING *`,
        [nextPrice.toFixed(2), id],
      );
      const after = r.rows[0];

      await insertAuditLog(client, {
        action: "product_updated",
        entityType: "product",
        entityId: after.id,
        before,
        after,
        note: `bulk price ${mode}=${value}`,
        actorUserId,
      });
      affected += 1;
    }

    await client.query("COMMIT");
    return { affected, skipped };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function bulkSetCategory(
  ids: EntityId[],
  category: string | null,
  actorUserId: number | string | null = null,
): Promise<BulkOperationResult> {
  const next = normalizeOptionalText(category);
  return applyBulkOperation(
    ids,
    async (client, id) => {
      const r = await client.query<ProductRow>(
        `UPDATE products SET category = $1 WHERE id = $2 RETURNING *`,
        [next, id],
      );
      return { after: r.rows[0] ?? null, action: "product_updated" };
    },
    actorUserId,
  );
}

// ─── Kategori yönetimi ──────────────────────────────────────────────────────
// Trendyol kategori isimlerini yerel olarak elden gözden geçirmek istediğin
// için: rename (tüm ürünlerin category alanını topluca değiştirir), delete
// (tüm ürünlerin category alanını NULL yapar). FK tablosu yok, free-text üzerinde
// SQL UPDATE.

export async function renameCategory(
  from: string,
  to: string | null,
  actorUserId: number | string | null = null,
): Promise<BulkOperationResult> {
  const fromNormalized = normalizeRequiredText(from, "from");
  const toNormalized = normalizeOptionalText(to);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const targets = await client.query<ProductRow>(
      `SELECT * FROM products WHERE category = $1 FOR UPDATE`,
      [fromNormalized],
    );

    if (targets.rows.length === 0) {
      await client.query("COMMIT");
      return { affected: 0 };
    }

    for (const before of targets.rows) {
      const r = await client.query<ProductRow>(
        `UPDATE products SET category = $1 WHERE id = $2 RETURNING *`,
        [toNormalized, before.id],
      );
      await insertAuditLog(client, {
        action: "product_updated",
        entityType: "product",
        entityId: before.id,
        before,
        after: r.rows[0],
        note: `category rename: "${fromNormalized}" → "${toNormalized ?? "(silindi)"}"`,
        actorUserId,
      });
    }

    await client.query("COMMIT");
    return { affected: targets.rows.length };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Trendyol Excel import için helper: barkod ile UPSERT.
// import script'inden çağrılır; route üzerinden expose edilmez.
//
// Update davranışı: name/price/parent_product_code/variant_label/category her
// zaman üzerine yazılır (Trendyol'un en güncel değeri otoriter). image_url ve
// ty_listing_url COALESCE ile boş ise atanır — kullanıcı yerel olarak elle
// düzenlediğini import sıfırlamasın diye. archived_at sıfırlanır (re-import
// "geri al" anlamına gelir).
export type UpsertByBarcodeInput = {
  barcode: string;
  name: string;
  price: MoneyInput;
  imageUrl?: string | null;
  tyListingUrl?: string | null;
  parentProductCode?: string | null;
  variantLabel?: string | null;
  category?: string | null;
};

export type UpsertByBarcodeResult = {
  product: ProductRow;
  created: boolean;
};

export async function upsertProductByBarcode(
  input: UpsertByBarcodeInput,
): Promise<UpsertByBarcodeResult> {
  const barcode = normalizeRequiredText(input.barcode, "barcode");
  const name = normalizeRequiredText(input.name, "name");
  const price = normalizeMoneyInput(input.price, "price");
  const imageUrl = normalizeOptionalText(input.imageUrl);
  const tyListingUrl = normalizeOptionalText(input.tyListingUrl);
  const parentProductCode = normalizeOptionalText(input.parentProductCode);
  const variantLabel = normalizeOptionalText(input.variantLabel);
  const category = normalizeOptionalText(input.category);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query<ProductRow>(
      `SELECT * FROM products WHERE barcode = $1 FOR UPDATE`,
      [barcode],
    );

    if (existing.rows[0]) {
      const before = existing.rows[0];
      const updateResult = await client.query<ProductRow>(
        `UPDATE products
            SET name = $1,
                price = $2,
                image_url = COALESCE($3, image_url),
                ty_listing_url = COALESCE($4, ty_listing_url),
                parent_product_code = COALESCE($5, parent_product_code),
                variant_label = COALESCE($6, variant_label),
                category = COALESCE($7, category),
                archived_at = NULL
          WHERE id = $8
        RETURNING *`,
        [
          name,
          price,
          imageUrl,
          tyListingUrl,
          parentProductCode,
          variantLabel,
          category,
          before.id,
        ],
      );
      await client.query("COMMIT");
      return { product: updateResult.rows[0], created: false };
    }

    const insertResult = await client.query<ProductRow>(
      `INSERT INTO products (
         barcode, name, price, image_url, ty_listing_url,
         parent_product_code, variant_label, category
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        barcode,
        name,
        price,
        imageUrl,
        tyListingUrl,
        parentProductCode,
        variantLabel,
        category,
      ],
    );
    await client.query("COMMIT");
    return { product: insertResult.rows[0], created: true };
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// ─── Görsel yükleme (kendi barındırma) ──────────────────────────────────────
//
// Bytes ayrı product_images tablosunda (SELECT *'ı şişirmemek için). Görsel
// yüklenince products.image_url'a servis endpoint'inin tam URL'i + versiyon
// (?v=updated_at ms) yazılır; böylece tüm <img> tüketicileri değişmez ve
// immutable cache güvenle kullanılabilir (URL her güncellemede değişir).

const ALLOWED_IMAGE_MIME = new Set(["image/webp", "image/jpeg", "image/png"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Byte'ların gerçekten belirtilen MIME türüne ait olduğunu imza (magic byte)
// baytlarıyla doğrular. Böylece content-type sahteciliğiyle keyfi byte
// yüklenemez. Tanınan türde imza tutmazsa false döner.
function matchesImageSignature(mime: string, bytes: Buffer): boolean {
  switch (mime) {
    case "image/jpeg":
      // FF D8 FF
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      // 89 50 4E 47 0D 0A 1A 0A
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case "image/webp":
      // bayt 0..3 = "RIFF" VE bayt 8..11 = "WEBP"
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    default:
      return false;
  }
}

export type ProductImageData = {
  mime: string;
  bytes: Buffer;
  byteSize: number;
  updatedAt: string;
};

export async function getProductImage(productId: EntityId): Promise<ProductImageData | null> {
  const result = await pool.query<{
    mime: string;
    bytes: Buffer;
    byte_size: number;
    updated_at: string;
  }>(
    `SELECT mime, bytes, byte_size, updated_at FROM product_images WHERE product_id = $1`,
    [productId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    mime: row.mime,
    bytes: row.bytes,
    byteSize: row.byte_size,
    updatedAt: row.updated_at,
  };
}

export async function setProductImage(
  productId: EntityId,
  mime: string,
  bytes: Buffer,
  publicBaseUrl: string,
  actorUserId: number | string | null = null,
): Promise<ProductRow> {
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    throw new ValidationError("Desteklenmeyen görsel türü. Yalnız WebP, JPEG veya PNG.");
  }
  if (!bytes || bytes.length === 0) {
    throw new ValidationError("Görsel verisi boş.");
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ValidationError("Görsel 5MB sınırını aşıyor.");
  }
  if (!matchesImageSignature(mime, bytes)) {
    throw new ValidationError("Görsel içeriği belirtilen türle uyuşmuyor.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<ProductRow>(
      `SELECT * FROM products WHERE id = $1 FOR UPDATE`,
      [productId],
    );
    const before = beforeResult.rows[0];
    if (!before) throw new ProductNotFoundError();

    const imgResult = await client.query<{ updated_at: string }>(
      `INSERT INTO product_images (product_id, mime, bytes, byte_size, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (product_id) DO UPDATE
         SET mime = EXCLUDED.mime,
             bytes = EXCLUDED.bytes,
             byte_size = EXCLUDED.byte_size,
             updated_at = now()
       RETURNING updated_at`,
      [productId, mime, bytes, bytes.length],
    );
    const version = new Date(imgResult.rows[0].updated_at).getTime();
    const imageUrl = `${publicBaseUrl}/products/${productId}/image?v=${version}`;

    const updateResult = await client.query<ProductRow>(
      `UPDATE products SET image_url = $1 WHERE id = $2 RETURNING *`,
      [imageUrl, productId],
    );
    const after = updateResult.rows[0];

    await insertAuditLog(client, {
      action: "product_updated",
      entityType: "product",
      entityId: after.id,
      before,
      after,
      note: "görsel yüklendi",
      actorUserId,
    });

    await client.query("COMMIT");
    return after;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

export async function deleteProductImage(
  productId: EntityId,
  actorUserId: number | string | null = null,
): Promise<ProductRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeResult = await client.query<ProductRow>(
      `SELECT * FROM products WHERE id = $1 FOR UPDATE`,
      [productId],
    );
    const before = beforeResult.rows[0];
    if (!before) throw new ProductNotFoundError();

    await client.query(`DELETE FROM product_images WHERE product_id = $1`, [productId]);

    // image_url yalnız bizim servis endpoint'imize işaret ediyorsa temizlenir;
    // Trendyol CDN gibi harici URL'i silmeyiz (kullanıcı oraya geri dönebilsin).
    let after = before;
    const pointsToOurImage = before.image_url?.includes(`/products/${productId}/image`) ?? false;
    if (pointsToOurImage) {
      const updateResult = await client.query<ProductRow>(
        `UPDATE products SET image_url = NULL WHERE id = $1 RETURNING *`,
        [productId],
      );
      after = updateResult.rows[0];
    }

    await insertAuditLog(client, {
      action: "product_updated",
      entityType: "product",
      entityId: after.id,
      before,
      after,
      note: "görsel kaldırıldı",
      actorUserId,
    });

    await client.query("COMMIT");
    return after;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
