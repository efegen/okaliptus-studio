/**
 * SMOKE 25 — Kanal Eşleştirme (channel_listings, v1.6)
 *
 * Senaryo:
 *   1. Ürün oluştur (barkod ile).
 *   2. Kanal listing oluştur (trendyol, external_id=barkod) → audit yazılmalı.
 *   3. listByProduct → 1 satır, alanlar doğru.
 *   4. Aynı (channel, external_id) ikinci ürüne → CHANNEL_LISTING_CONFLICT.
 *   5. update (channel_price + is_listed) → audit before/after.
 *   6. Farklı kanal (hepsiburada) aynı external_id ile → ÇAKIŞMAMALI (channel ayrı).
 *   7. remove → liste boşalır, audit yazılır.
 *   8. Seed idempotency: INSERT ... ON CONFLICT DO NOTHING ikinci kez 0 satır ekler.
 *
 * CLEANUP: channel_listings ON DELETE CASCADE (products silinince düşer); test
 * ürünleri finally'de hard-delete edilir.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/25-channel-listings.ts
 */

import { createProduct } from "../../src/services/products.service.js";
import {
  createChannelListing,
  listByProduct,
  removeChannelListing,
  updateChannelListing,
} from "../../src/services/channel-listings.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual, assertMoney,
  assertRejects, closePool, ok, getActorUserId, assertAuditLog,
} from "./_shared.js";

async function run(): Promise<void> {
  const productIds: string[] = [];
  const stamp = Date.now().toString();
  const EXT_A = `SMOKE25_EXT_${stamp}`;

  try {
    section("SMOKE 25 — Kanal Eşleştirme (channel_listings)");

    const actorUserId = await getActorUserId();

    // ── 1. İki ürün ──────────────────────────────────────────────────────────
    step("İki ürün oluşturuluyor...");
    const productA = await createProduct({
      name: "SMOKE_Kanal Ürün A",
      price: "199.90",
      barcode: `SMOKE25_A_${stamp}`,
    });
    productIds.push(productA.id);
    const productB = await createProduct({
      name: "SMOKE_Kanal Ürün B",
      price: "59.00",
      barcode: `SMOKE25_B_${stamp}`,
    });
    productIds.push(productB.id);
    info("productA.id", productA.id);

    // ── 2. Listing oluştur ───────────────────────────────────────────────────
    step("Trendyol listing oluşturuluyor (external_id=EXT_A)...");
    const listing = await createChannelListing(productA.id, {
      channel: "trendyol",
      externalId: EXT_A,
      channelPrice: "210.00",
      isListed: true,
      actorUserId,
    });
    info("listing.id", listing.id);
    assertEqual(listing.channel, "trendyol", "listing.channel");
    assertEqual(listing.external_id, EXT_A, "listing.external_id");
    assertMoney(listing.channel_price, "210.00", "listing.channel_price");
    assertEqual(listing.is_listed, true, "listing.is_listed");
    await assertAuditLog({
      action: "channel_listing_changed",
      entityType: "product",
      entityId: productA.id,
      expectActorUserId: actorUserId,
      expectAfterContains: { external_id: EXT_A, channel: "trendyol" },
    });

    // ── 3. listByProduct ─────────────────────────────────────────────────────
    step("listByProduct ile okunuyor...");
    const rows = await listByProduct(productA.id);
    assertEqual(rows.length, 1, "productA için 1 listing");

    // ── 4. UNIQUE (channel, external_id) çakışması ───────────────────────────
    step("Aynı (trendyol, EXT_A) ikinci ürüne eklenmeye çalışılıyor → 409...");
    await assertRejects(
      () => createChannelListing(productB.id, {
        channel: "trendyol",
        externalId: EXT_A,
        actorUserId,
      }),
      "CHANNEL_LISTING_CONFLICT",
      "Aynı kanalda aynı external_id ikinci ürüne eklenememeli",
    );

    // ── 5. update ────────────────────────────────────────────────────────────
    step("Listing güncelleniyor (price→250, is_listed→false)...");
    const updated = await updateChannelListing(listing.id, {
      channelPrice: "250.00",
      isListed: false,
      actorUserId,
    });
    assertMoney(updated.channel_price, "250.00", "updated.channel_price");
    assertEqual(updated.is_listed, false, "updated.is_listed");
    await assertAuditLog({
      action: "channel_listing_changed",
      entityType: "product",
      entityId: productA.id,
      expectBeforeContains: { is_listed: true },
      expectAfterContains: { is_listed: false },
    });

    // ── 6. Farklı kanal, aynı external_id → çakışmamalı ──────────────────────
    step("Hepsiburada (aynı external_id) eklenebilmeli (channel ayrı)...");
    const hbListing = await createChannelListing(productA.id, {
      channel: "hepsiburada",
      externalId: EXT_A,
      actorUserId,
    });
    assertEqual(hbListing.channel, "hepsiburada", "hbListing.channel");
    assertEqual(hbListing.channel_price, null, "hbListing.channel_price NULL (verilmedi)");
    assertEqual((await listByProduct(productA.id)).length, 2, "productA artık 2 listing");

    // ── 7. remove ────────────────────────────────────────────────────────────
    step("Trendyol listing siliniyor...");
    await removeChannelListing(listing.id, actorUserId);
    const afterRemove = await listByProduct(productA.id);
    assertEqual(afterRemove.length, 1, "silme sonrası 1 listing kaldı");
    assert(afterRemove[0].channel === "hepsiburada", "kalan listing hepsiburada");
    await assertAuditLog({
      action: "channel_listing_changed",
      entityType: "product",
      entityId: productA.id,
      expectBeforeContains: { channel: "trendyol" },
    });

    // ── 8. Seed idempotency (ON CONFLICT DO NOTHING) ─────────────────────────
    step("Seed kalıbı: aynı satırı ON CONFLICT DO NOTHING ile tekrar eklemek 0 satır...");
    const seedSql = `INSERT INTO channel_listings (product_id, channel, external_id, is_listed)
                     VALUES ($1, 'hepsiburada', $2, true)
                     ON CONFLICT (channel, external_id) DO NOTHING
                     RETURNING id`;
    const second = await pool.query(seedSql, [productA.id, EXT_A]);
    assertEqual(second.rowCount ?? 0, 0, "çakışan seed satırı eklenmedi (idempotent)");

    ok("\nSMOKE 25 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    if (productIds.length > 0) {
      // channel_listings ON DELETE CASCADE ile products silininde düşer.
      await pool.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [productIds]);
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
