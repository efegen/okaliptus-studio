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
// completeLesson'ın `student_prepaid_<id>` kalıbıyla aynı stil. Pazaryeri sipariş
// senkronu da bu key ile kilitler → POS satışı ile kanal düşümü aynı ürün için
// asla iç içe geçmez.
export function stockLockKey(productId: EntityId): string {
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

// ── Bundle patlatma (Faz 1.5) ───────────────────────────────────────────────
// Bir stok hareketini GERÇEK hedeflerine çevirir. Bundle ürün ise bileşenlerine
// "patlar" (her bileşen için signedQty × component_qty); basit ürün ise kendisi.
// signedQty: satışta NEGATİF (düşüm), iptal/iadede POZİTİF (geri ekleme).
//
// Bundle'ın KENDİ stoğu yoktur → asla bundle product_id'sine hareket yazılmaz.
// Bileşeni olmayan bundle → targets boş + hasComponents=false (çağıran karar verir:
// POS sessiz geçer, TY 'setup_pending' kuyruğuna düşer).
export type StockDelta = { productId: string; delta: number };
export type ExplodeResult = { targets: StockDelta[]; isBundle: boolean; hasComponents: boolean };

export async function explodeStockDeltas(
  client: PoolClient,
  productId: EntityId,
  signedQty: number,
): Promise<ExplodeResult> {
  const prod = await client.query<{ is_bundle: boolean }>(
    `SELECT is_bundle FROM products WHERE id = $1`,
    [productId],
  );
  const isBundle = prod.rows[0]?.is_bundle === true;
  if (!isBundle) {
    return { targets: [{ productId: String(productId), delta: signedQty }], isBundle: false, hasComponents: false };
  }
  const comps = await client.query<{ component_product_id: string; quantity: number }>(
    `SELECT component_product_id, quantity FROM bundle_components WHERE bundle_product_id = $1`,
    [productId],
  );
  if (comps.rows.length === 0) {
    return { targets: [], isBundle: true, hasComponents: false };
  }
  const targets = comps.rows.map(c => ({
    productId: String(c.component_product_id),
    delta: signedQty * Number(c.quantity),
  }));
  return { targets, isBundle: true, hasComponents: true };
}

// Satıştaki katalog kalemleri için stok düşümü. createProductSaleWithClient
// içinden, mevcut transaction ile çağrılır.
//
// Bundle (Faz 1.5): satılan kalem bir paket ise stok BİLEŞENLERE patlatılır
// (explodeStockDeltas); paketin kendisine hareket yazılmaz. Basit ürün eskisi gibi.
// Bileşeni tanımlanmamış bir bundle satılırsa hareket yazılmaz (sessiz; on_hand
// zaten 0 türeri) — POS'ta kuyruk yok, operatör sorumluluğu.
//
// Deadlock önleme: kilitler yazımdan ÖNCE, gerçek hedef product_id'lere göre
// ARTAN SIRADA alınır (POS + TY senkronu aynı stockLockKey'i kullanır).
//
// Yetersiz stok satışı ENGELLEMEZ: on_hand 0/negatif olsa bile hareket yazılır,
// on_hand eksiye düşebilir (kasıtlı sinyal). Stok için AYRI audit yazılmaz.
export async function recordSaleStockMovements(
  client: PoolClient,
  input: { saleId: EntityId; items: SaleStockItem[]; actorUserId?: number | string | null },
): Promise<void> {
  const catalogItems = input.items.filter(it => it.productId !== null && it.productId !== undefined && it.productId !== "");
  if (catalogItems.length === 0) return;

  // Her kalemi gerçek stok hedeflerine patlat (bundle → bileşenler).
  const targets: StockDelta[] = [];
  for (const item of catalogItems) {
    const { targets: t } = await explodeStockDeltas(client, item.productId, -item.quantity);
    targets.push(...t);
  }
  if (targets.length === 0) return;

  // Benzersiz hedef product_id'ler, deadlock önleme için artan sırada kilitle.
  const uniqueIds = Array.from(new Set(targets.map(t => t.productId))).sort();
  for (const id of uniqueIds) {
    await withAdvisoryLock(client, stockLockKey(id));
  }

  for (const t of targets) {
    if (t.delta === 0) continue;
    await client.query(
      `INSERT INTO stock_movements (product_id, delta, type, related_sale_id, actor_user_id)
       VALUES ($1, $2, 'sale', $3, $4)`,
      [t.productId, t.delta, input.saleId, input.actorUserId ?? null],
    );
  }
}

// Satış silmede stok iadesi (Faz 1.5+). softDeleteProductSale içinden, mevcut
// transaction ile çağrılır. recordSaleStockMovements'in tersi.
//
// Defteri GERİ OKUR, yeniden patlatmaz: satış anındaki gerçek bileşen deltaları
// (bundle → bileşen granülerliğinde) related_sale_id ile birlikte zaten kayıtlı.
// explodeStockDeltas yeniden çağrılsa, satıştan SONRA bundle bileşimi değişmişse
// yanlış sonuç verirdi — geri okuma bu senaryodan bağışıktır.
//
// Flag KONTROLÜ YOK (bilinçli): flag açıkken satış → flag kapatıldı → satış silindi
// senaryosunda flag'e bağlansaydı defter kalıcı dengesiz kalırdı. Geri okuma zaten
// flag kapalıyken yapılmış satışta (hiç 'sale' satırı yok) doğal no-op olur.
//
// Deadlock önleme: kilitler yazımdan ÖNCE, hedef product_id'lere göre ARTAN SIRADA
// (recordSaleStockMovements ile aynı sıra; POS + TY senkronu aynı stockLockKey'i
// kullanır). Ayrı audit YAZILMAZ — satışın product_sale_deleted audit'i kapsar.
//
// İnvariant: tam geri alınmış satış için SUM(delta) WHERE related_sale_id = saleId
// = 0 (order-sync'in applied_delta = 0 "reversed" invariantının ikizi).
export async function reverseSaleStockMovements(
  client: PoolClient,
  input: { saleId: EntityId; actorUserId?: number | string | null },
): Promise<void> {
  const originals = await client.query<{ product_id: string; delta: number }>(
    `SELECT product_id, delta FROM stock_movements
     WHERE related_sale_id = $1 AND type = 'sale'`,
    [input.saleId],
  );
  if (originals.rows.length === 0) return;

  // Benzersiz hedef product_id'ler, deadlock önleme için artan sırada kilitle.
  const uniqueIds = Array.from(new Set(originals.rows.map(r => String(r.product_id)))).sort();
  for (const id of uniqueIds) {
    await withAdvisoryLock(client, stockLockKey(id));
  }

  for (const row of originals.rows) {
    if (Number(row.delta) === 0) continue;
    await client.query(
      `INSERT INTO stock_movements (product_id, delta, type, related_sale_id, actor_user_id)
       VALUES ($1, $2, 'sale_cancel', $3, $4)`,
      [row.product_id, -Number(row.delta), input.saleId, input.actorUserId ?? null],
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

  // Bundle'ın stoğu bileşenlerinden TÜREr; elle ayarlanamaz (Faz 1.5).
  const bundleCheck = await client.query<{ is_bundle: boolean }>(
    `SELECT is_bundle FROM products WHERE id = $1`,
    [input.productId],
  );
  if (bundleCheck.rows[0]?.is_bundle === true) {
    throw new ValidationError("Paket ürünün stoğu elle ayarlanamaz; bileşenlerinin stoğunu düzenleyin.");
  }

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
