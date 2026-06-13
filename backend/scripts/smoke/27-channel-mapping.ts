/**
 * SMOKE 27 — Ürün Eşleştirme kokpiti (sync + overview + adopt, v1.6)
 *
 * Ağ YOK: syncTrendyolProducts'a sahte fetcher enjekte edilir. Eşleştirme/adopt
 * gerçek DB ile test edilir.
 *
 * Senaryo:
 *   1. İç ürün P1 (barcode=BC-A) oluştur, flag aç.
 *   2. Sahte fetcher (BC-A + BC-B varyantları) ile sync → channel_products dolar.
 *   3. overview: 2 orphan; BC-A için P1 otomatik önerilir (barkod eşitliği).
 *   4. adopt BC-B mode=create → yeni iç ürün + trendyol listing.
 *   5. adopt BC-A mode=link (P1) → P1'e trendyol listing.
 *   6. overview: orphan 0, iki ürün de TY eşleşik.
 *   7. adopt BC-A tekrar → CHANNEL_LISTING_CONFLICT.
 *   8. Flag KAPALI → overview/sync/adopt MARKETPLACE_SYNC_DISABLED.
 *
 * ÇALIŞTIRMA: cd backend && npx tsx scripts/smoke/27-channel-mapping.ts
 */

import { createProduct } from "../../src/services/products.service.js";
import { syncTrendyolProducts } from "../../src/services/trendyol/channel-sync.service.js";
import {
  getMappingOverview,
  adoptChannelProduct,
  autoMatchByBarcode,
} from "../../src/services/trendyol/channel-mapping.service.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual,
  assertRejects, closePool, ok, getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const productIds: string[] = [];
  const stamp = Date.now().toString();
  const BC_A = `SMOKE27_A_${stamp}`;
  const BC_B = `SMOKE27_B_${stamp}`;

  const before = await getSettings();
  const originalFlag = before.marketplaceSyncEnabled;
  const originalStockFlag = before.stockTrackingEnabled;

  // Sahte Trendyol ürün sayfası — tek sayfa, iki varyant.
  const fakeFetch = async () => ({
    totalElements: 2, totalPages: 1, page: 0, size: 100,
    content: [
      { productMainId: "SMOKE27-MA", title: "Smoke Ürün A", images: [{ url: "http://x/a.jpg" }],
        variants: [{ barcode: BC_A, stock: { quantity: 5 }, price: { salePrice: 100, listPrice: 120 }, onSale: true, archived: false, productUrl: "http://ty/a" }] },
      { productMainId: "SMOKE27-MB", title: "Smoke Ürün B", images: [],
        variants: [{ barcode: BC_B, stock: { quantity: 3 }, price: { salePrice: 200, listPrice: 200 }, onSale: true, archived: false, productUrl: "http://ty/b" }] },
    ],
  });

  try {
    section("SMOKE 27 — Ürün Eşleştirme kokpiti");
    const actorUserId = await getActorUserId();

    step("İç ürün P1 (barcode=BC_A) oluşturuluyor, flag açılıyor...");
    const p1 = await createProduct({ name: "SMOKE_Mevcut A", price: "150.00", barcode: BC_A });
    productIds.push(p1.id);
    await updateSettings({ marketplaceSyncEnabled: true, stockTrackingEnabled: true }, actorUserId);

    step("Sahte fetcher ile sync...");
    const sync = await syncTrendyolProducts({ fetchPage: fakeFetch });
    info("sync", JSON.stringify(sync));
    assert(sync.synced >= 2, "en az 2 varyant senkronlandı");

    step("overview: orphan + otomatik öneri...");
    let ov = await getMappingOverview();
    const orphanA = ov.orphanTrendyol.find(o => o.externalId === BC_A);
    const orphanB = ov.orphanTrendyol.find(o => o.externalId === BC_B);
    assert(!!orphanA && !!orphanB, "BC_A ve BC_B orphan listesinde");
    assertEqual(orphanA?.suggestProductId, p1.id, "BC_A için P1 otomatik önerildi (barkod eşitliği)");
    assertEqual(orphanB?.suggestProductId ?? null, null, "BC_B için öneri yok");

    step("adopt BC_B mode=create → yeni iç ürün...");
    const created = await adoptChannelProduct({ channelProductId: orphanB!.channelProductId, mode: "create", actorUserId });
    assert(created.created === true, "yeni iç ürün oluşturuldu");
    productIds.push(created.productId);
    // Açılış stoğu Trendyol adedinden (BC_B qty=3) tohumlanmalı (stok takibi açık).
    const onHand = await pool.query<{ on_hand: number }>(`SELECT on_hand FROM v_product_stock WHERE product_id = $1`, [created.productId]);
    assertEqual(Number(onHand.rows[0]?.on_hand), 3, "yeni ürünün iç stoğu Trendyol adediyle (3) tohumlandı");

    step("autoMatchByBarcode → BC_A (barkod=P1.barcode) otomatik bağlanmalı...");
    const am = await autoMatchByBarcode(actorUserId);
    assertEqual(am.matched, 1, "barkodla 1 ürün otomatik eşlendi (BC_A → P1)");
    assertEqual(am.links[0]?.productId, p1.id, "eşleşen ürün P1");

    step("overview tekrar: orphan 0, iki ürün TY eşleşik...");
    ov = await getMappingOverview();
    assertEqual(ov.summary.orphanTrendyol, 0, "orphan kalmadı");
    const p1row = ov.products.find(p => p.id === p1.id);
    assert(!!p1row?.trendyol && p1row.trendyol.externalId === BC_A, "P1 trendyol eşleşik (BC_A)");
    assert(p1row?.trendyol?.snapshot?.quantity === 5, "snapshot stok bilgisi geldi (5)");

    step("adopt BC_A tekrar → conflict...");
    await assertRejects(
      () => adoptChannelProduct({ channelProductId: orphanA!.channelProductId, mode: "link", productId: p1.id, actorUserId }),
      "CHANNEL_LISTING_CONFLICT",
      "Aynı external_id ikinci kez eşlenemez",
    );

    step("Flag KAPALI → overview reddetmeli...");
    await updateSettings({ marketplaceSyncEnabled: false }, actorUserId);
    await assertRejects(() => getMappingOverview(), "MARKETPLACE_SYNC_DISABLED", "Flag kapalıyken overview engellenir");
    await assertRejects(() => syncTrendyolProducts({ fetchPage: fakeFetch }), "MARKETPLACE_SYNC_DISABLED", "Flag kapalıyken sync engellenir");

    ok("\nSMOKE 27 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    try { await updateSettings({ marketplaceSyncEnabled: originalFlag, stockTrackingEnabled: originalStockFlag }); } catch { /* yut */ }
    // channel_products (trendyol smoke) temizle
    await pool.query(`DELETE FROM channel_products WHERE external_id = ANY($1::text[])`, [[BC_A, BC_B]]);
    if (productIds.length > 0) {
      // channel_listings ON DELETE CASCADE; stock_movements FK RESTRICT → önce sil.
      await pool.query(`DELETE FROM stock_movements WHERE product_id = ANY($1::bigint[])`, [productIds]);
      await pool.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [productIds]);
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
