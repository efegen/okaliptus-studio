// v1.6 — Model C / Faz 1.5: Bundle (paket) bileşen yönetimi.
//
// Bir ürünü paket (is_bundle) yapar ve bileşenlerini (component + adet) yönetir.
// Bundle'ın kendi stoğu yoktur; on_hand v_product_effective_stock'tan türetilir
// (min floor(component/qty)). Satış patlatması stock.service.explodeStockDeltas'ta.
//
// İnvariantlar (DB constraint + buradaki servis doğrulaması birlikte):
//   • İç içe paket YOK: bir paketin bileşeni kendisi paket olamaz; bir ürün başka
//     paketin bileşeniyse paket yapılamaz (tek seviye).
//   • Ürün kendini bileşen olarak içeremez (DB CHECK + burada).
//   • Aynı bileşen iki kez yazılamaz (UNIQUE + burada net mesaj).
//   • Bileşen tek başına da satılabilir (paylaşımlı havuz) — kısıt yok.

import type { PoolClient } from "pg";

import { pool } from "../db/connection.js";
import { ValidationError, toServiceError } from "./errors.js";
import { ProductNotFoundError } from "./products.service.js";
import { insertAuditLog, rollbackQuietly, type EntityId } from "./shared.js";

// Stok sapması koruması (Faz 1.5): bir paketin bileşen yapısı, ona bağlı SAYILMIŞ
// (state='counted') açık Trendyol siparişi varken değiştirilemez. Defter applied_delta
// paket başına net etki tutar; bileşen yapısı değişirse eski sayımlar yeni bileşen
// miktarına göre YENİDEN hesaplanmaz (bu Faz 2) → sessiz stok sapması olurdu. Bu
// yüzden engelle. (POS satışı tek-yön olduğu için sapma yaratmaz; yalnız TY sayımı.)
async function assertNoCountedChannelLines(client: PoolClient, bundleId: string): Promise<void> {
  const counted = await client.query<{ id: string }>(
    `SELECT id FROM channel_order_lines WHERE product_id = $1 AND state = 'counted' LIMIT 1`,
    [bundleId],
  );
  if (counted.rows[0]) {
    throw new ValidationError(
      "Bu pakete bağlı sayılmış açık Trendyol siparişi var; bileşen yapısı değiştirilemez (stok sapması olur). Önce siparişleri kapat ya da Faz 2 yeniden-hesabını bekle.",
    );
  }
}

export type BundleComponentInput = { productId: EntityId; quantity: number };

export type BundleComponentRow = {
  componentProductId: string;
  name: string;
  barcode: string | null;
  quantity: number;
  componentOnHand: number; // bileşenin ham stoğu (v_product_stock)
  archivedAt: string | null;
};

export type BundleView = {
  productId: string;
  isBundle: boolean;
  effectiveStock: number; // türev (min floor); bileşeni yoksa 0
  components: BundleComponentRow[];
};

export async function getBundle(productId: EntityId): Promise<BundleView> {
  const prod = await pool.query<{ id: string; is_bundle: boolean }>(
    `SELECT id, is_bundle FROM products WHERE id = $1`,
    [productId],
  );
  if (!prod.rows[0]) throw new ProductNotFoundError();

  const comps = await pool.query<{
    component_product_id: string; quantity: number; name: string;
    barcode: string | null; archived_at: string | null; on_hand: number;
  }>(
    `SELECT bc.component_product_id, bc.quantity, p.name, p.barcode, p.archived_at,
            COALESCE(vs.on_hand, 0)::int AS on_hand
       FROM bundle_components bc
       JOIN products p ON p.id = bc.component_product_id
       LEFT JOIN v_product_stock vs ON vs.product_id = bc.component_product_id
      WHERE bc.bundle_product_id = $1
      ORDER BY p.name ASC, bc.component_product_id ASC`,
    [productId],
  );

  const eff = await pool.query<{ on_hand: number }>(
    `SELECT on_hand FROM v_product_effective_stock WHERE product_id = $1`,
    [productId],
  );

  return {
    productId: prod.rows[0].id,
    isBundle: prod.rows[0].is_bundle === true,
    effectiveStock: Number(eff.rows[0]?.on_hand ?? 0),
    components: comps.rows.map(r => ({
      componentProductId: r.component_product_id,
      name: r.name,
      barcode: r.barcode,
      quantity: Number(r.quantity),
      componentOnHand: Number(r.on_hand),
      archivedAt: r.archived_at,
    })),
  };
}

// Ürünü paket yapar (is_bundle=true) ve bileşenlerini ATOMİK olarak değiştirir
// (tam liste; mevcutlar silinip yeniden yazılır). Boş components[] → "kurulum
// bekliyor" durumundaki paket (geçerli; operatör sonra doldurur). Tüm invariantlar
// burada doğrulanır.
export async function setBundle(
  bundleProductId: EntityId,
  components: BundleComponentInput[],
  actorUserId: number | string | null = null,
): Promise<BundleView> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const prod = await client.query<{ id: string }>(
      `SELECT id FROM products WHERE id = $1 FOR UPDATE`,
      [bundleProductId],
    );
    if (!prod.rows[0]) throw new ProductNotFoundError();
    const bundleId = prod.rows[0].id;

    // Stok sapması koruması: sayılmış açık TY siparişi varken bileşen değiştirilemez.
    await assertNoCountedChannelLines(client, bundleId);

    // Bu ürün başka bir paketin bileşeni mi? Öyleyse paket yapılamaz (iç içe yasak).
    const asComponent = await client.query<{ id: string }>(
      `SELECT id FROM bundle_components WHERE component_product_id = $1 LIMIT 1`,
      [bundleId],
    );
    if (asComponent.rows[0]) {
      throw new ValidationError("Bu ürün başka bir paketin bileşeni; paket yapılamaz (iç içe paket yok).");
    }

    // Bileşenleri normalize + doğrula.
    const seen = new Set<string>();
    const normalized: { productId: string; quantity: number }[] = [];
    for (const c of components) {
      const cid = String(c.productId ?? "");
      if (!cid) throw new ValidationError("Geçersiz bileşen ürün.");
      if (cid === String(bundleId)) throw new ValidationError("Paket kendini bileşen olarak içeremez.");
      if (seen.has(cid)) throw new ValidationError("Aynı bileşen iki kez eklenemez.");
      if (!Number.isInteger(c.quantity) || c.quantity <= 0) {
        throw new ValidationError("Bileşen adedi pozitif tam sayı olmalı.");
      }
      seen.add(cid);
      normalized.push({ productId: cid, quantity: c.quantity });
    }

    if (normalized.length > 0) {
      const ids = normalized.map(n => n.productId);
      const found = await client.query<{ id: string; is_bundle: boolean }>(
        `SELECT id, is_bundle FROM products WHERE id = ANY($1::bigint[])`,
        [ids],
      );
      const foundMap = new Map(found.rows.map(r => [r.id, r]));
      for (const n of normalized) {
        const f = foundMap.get(n.productId);
        if (!f) throw new ValidationError(`Bileşen ürün bulunamadı (id=${n.productId}).`);
        if (f.is_bundle === true) {
          throw new ValidationError("Bir paket başka bir paketi bileşen olarak içeremez (iç içe paket yok).");
        }
      }
    }

    await client.query(`UPDATE products SET is_bundle = true WHERE id = $1`, [bundleId]);
    await client.query(`DELETE FROM bundle_components WHERE bundle_product_id = $1`, [bundleId]);
    for (const n of normalized) {
      await client.query(
        `INSERT INTO bundle_components (bundle_product_id, component_product_id, quantity)
         VALUES ($1, $2, $3)`,
        [bundleId, n.productId, n.quantity],
      );
    }

    await insertAuditLog(client, {
      action: "product_updated",
      entityType: "product",
      entityId: bundleId,
      after: { is_bundle: true, components: normalized },
      note: "paket bileşenleri güncellendi",
      actorUserId,
    });

    await client.query("COMMIT");
    return await getBundle(bundleId);
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}

// Paketi çözer: is_bundle=false + tüm bileşenleri sil (basit ürüne döner).
export async function clearBundle(
  productId: EntityId,
  actorUserId: number | string | null = null,
): Promise<BundleView> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const prod = await client.query<{ id: string }>(
      `SELECT id FROM products WHERE id = $1 FOR UPDATE`,
      [productId],
    );
    if (!prod.rows[0]) throw new ProductNotFoundError();

    // Paketi çözmek de bileşen yapısını boşaltır → sayılmış TY siparişi varken yasak.
    await assertNoCountedChannelLines(client, prod.rows[0].id);

    await client.query(`DELETE FROM bundle_components WHERE bundle_product_id = $1`, [productId]);
    await client.query(`UPDATE products SET is_bundle = false WHERE id = $1`, [productId]);

    await insertAuditLog(client, {
      action: "product_updated",
      entityType: "product",
      entityId: String(productId),
      after: { is_bundle: false },
      note: "paket çözüldü (basit ürün)",
      actorUserId,
    });

    await client.query("COMMIT");
    return await getBundle(productId);
  } catch (error) {
    await rollbackQuietly(client);
    throw toServiceError(error);
  } finally {
    client.release();
  }
}
