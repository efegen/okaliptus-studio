// v1.6 — Dahili stok servisi (yalnızca elden / POS satış).
//
// stock_movements delta-ledger üzerinde çalışır (migration 0241). on_hand bir
// kolon değil, v_product_stock'tan türetilir. Marketplace senkronu KAPSAM DIŞI.
//
// İki giriş noktası:
//   1) recordSaleStockMovements — satışta otomatik decrement (product-sales
//      transaction'ı içinden çağrılır). Kendi audit'ini YAZMAZ (satışın audit'i
//      zaten var).
//   2) setStock / adjustProductStock — açılış stoğu + elle düzeltme. Burada
//      'stock_adjusted' audit'i YAZILIR.

import type { PoolClient } from "pg";

import { pool } from "../db/connection.js";
import { toServiceError, ValidationError } from "./errors.js";
import { ProductNotFoundError } from "./products.service.js";
import {
  insertAuditLog,
  rollbackQuietly,
  withAdvisoryLock,
  type EntityId,
} from "./shared.js";

// Aynı ürünün eşzamanlı stok yazımlarını seri hale getiren advisory lock key'i.
// completeLesson'ın `student_prepaid_<id>` kalıbıyla aynı stil.
function stockLockKey(productId: EntityId): string {
  return `stock_product_${productId}`;
}

// studio_settings.stock_tracking_enabled okunur. Verilen client transaction'ı
// içinde çalışır; flag kapalıyken çağıranlar tüm stok mantığını atlar.
export async function isStockTrackingEnabled(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ stock_tracking_enabled: boolean }>(
    `SELECT stock_tracking_enabled FROM studio_settings WHERE id = 1`,
  );
  return result.rows[0]?.stock_tracking_enabled === true;
}

// v_product_stock'tan anlık on_hand. Ürün yoksa null (çağıran karar verir).
async function readOnHand(client: PoolClient, productId: EntityId): Promise<number | null> {
  const result = await client.query<{ on_hand: number }>(
    `SELECT on_hand FROM v_product_stock WHERE product_id = $1`,
    [productId],
  );
  const row = result.rows[0];
  return row ? Number(row.on_hand) : null;
}

export type SaleStockItem = {
  productId: EntityId;
  quantity: number;
};

// Satıştaki katalog kalemleri için stok düşümü. createProductSaleWithClient
// içinden, mevcut transaction ile çağrılır.
//
// Deadlock önleme: kilitler item DÖNGÜSÜNDEN ÖNCE, benzersiz product_id'lere göre
// ARTAN SIRADA alınır. Sonra her kalem için -quantity hareketi yazılır.
//
// Yetersiz stok satışı ENGELLEMEZ: on_hand 0/negatif olsa bile hareket yazılır,
// on_hand eksiye düşebilir (kasıtlı sinyal). Stok için AYRI audit yazılmaz.
export async function recordSaleStockMovements(
  client: PoolClient,
  input: { saleId: EntityId; items: SaleStockItem[]; actorUserId?: number | string | null },
): Promise<void> {
  const catalogItems = input.items.filter(it => it.productId !== null && it.productId !== undefined && it.productId !== "");
  if (catalogItems.length === 0) return;

  // Benzersiz product_id'ler, deadlock önleme için artan sırada kilitle.
  const uniqueIds = Array.from(new Set(catalogItems.map(it => String(it.productId)))).sort();
  for (const id of uniqueIds) {
    await withAdvisoryLock(client, stockLockKey(id));
  }

  for (const item of catalogItems) {
    await client.query(
      `INSERT INTO stock_movements (product_id, delta, type, related_sale_id, actor_user_id)
       VALUES ($1, $2, 'sale', $3, $4)`,
      [item.productId, -item.quantity, input.saleId, input.actorUserId ?? null],
    );
  }
}

export type SetStockInput = {
  productId: EntityId;
  newOnHand: number;
  note?: string | null;
  actorUserId?: number | string | null;
};

// Açılış stoğu + elle düzeltme. Hedef on_hand'i mutlak olarak ayarlar:
// current değeri okunur, delta = newOnHand - current hesaplanır, fark 0 ise
// no-op. Aksi halde manual_adjustment hareketi yazılır ve 'stock_adjusted'
// audit'i loglanır. Açık bir transaction içinden, client ile çağrılır.
export async function setStock(client: PoolClient, input: SetStockInput): Promise<{ on_hand: number }> {
  if (!Number.isInteger(input.newOnHand)) {
    throw new ValidationError("Stok adedi tam sayı olmalı.");
  }

  await withAdvisoryLock(client, stockLockKey(input.productId));

  const current = await readOnHand(client, input.productId);
  if (current === null) throw new ProductNotFoundError();

  const delta = input.newOnHand - current;
  if (delta === 0) {
    return { on_hand: current };
  }

  await client.query(
    `INSERT INTO stock_movements (product_id, delta, type, note, actor_user_id)
     VALUES ($1, $2, 'manual_adjustment', $3, $4)`,
    [input.productId, delta, input.note ?? null, input.actorUserId ?? null],
  );

  await insertAuditLog(client, {
    action: "stock_adjusted",
    entityType: "product",
    entityId: input.productId,
    before: { on_hand: current },
    after: { on_hand: input.newOnHand },
    note: input.note ?? null,
    actorUserId: input.actorUserId ?? null,
  });

  return { on_hand: input.newOnHand };
}

// Endpoint sarmalı: setStock'u kendi transaction'ı içinde çalıştırır.
export async function adjustProductStock(input: SetStockInput): Promise<{ on_hand: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await setStock(client, input);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
