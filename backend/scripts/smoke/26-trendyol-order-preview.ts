/**
 * SMOKE 26 — Trendyol Sipariş Önizleme (read-only eşleştirme, v1.6)
 *
 * Ağ YOK: gerçek Trendyol'a çıkmaz. previewTrendyolOrders'a sahte bir fetcher
 * enjekte edilir; eşleştirme channel_listings (trendyol) üzerinden gerçek DB ile
 * test edilir. buildOrderPreview saf fonksiyonu ayrıca izole test edilir.
 *
 * Senaryo:
 *   1. buildOrderPreview (saf): eşleşen + eşleşmeyen satır sayımı doğru.
 *   2. Flag KAPALI → previewTrendyolOrders MARKETPLACE_SYNC_DISABLED atar.
 *   3. Ürün + trendyol channel_listing (external_id=barkod) seed et, flag aç.
 *   4. Sahte fetcher (1 eşleşen barkod + 1 eşleşmeyen) → önizleme doğru eşleştirir.
 *   5. Kimlik yokken gerçek client getOrders → TRENDYOL_NOT_CONFIGURED (ağ'a çıkmaz).
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/26-trendyol-order-preview.ts
 */

import { createProduct } from "../../src/services/products.service.js";
import { createChannelListing } from "../../src/services/channel-listings.service.js";
import {
  buildOrderPreview,
  previewTrendyolOrders,
  type MatchMap,
} from "../../src/services/trendyol/orders.service.js";
import { getOrders, isTrendyolConfigured } from "../../src/services/trendyol/client.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual,
  assertRejects, closePool, ok, getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const productIds: string[] = [];
  const stamp = Date.now().toString();
  const BARCODE = `SMOKE26_${stamp}`;
  const UNMATCHED = `SMOKE26_NOMATCH_${stamp}`;

  const before = await getSettings();
  const originalFlag = before.marketplaceSyncEnabled;

  try {
    section("SMOKE 26 — Trendyol Sipariş Önizleme");

    const actorUserId = await getActorUserId();

    // ── 1. Saf buildOrderPreview ─────────────────────────────────────────────
    step("buildOrderPreview saf fonksiyonu sayımı doğru yapmalı...");
    const matchMap: MatchMap = new Map([["AAA", { productId: "1", internalName: "İç Ürün" }]]);
    const pure = buildOrderPreview(
      [
        { orderNumber: "O1", lines: [{ barcode: "AAA", quantity: 2 }, { barcode: "BBB", quantity: 1 }] },
        { orderNumber: "O2", lines: [{ barcode: "AAA", quantity: 1 }] },
      ],
      matchMap,
    );
    assertEqual(pure.summary.totalOrders, 2, "totalOrders");
    assertEqual(pure.summary.totalLines, 3, "totalLines");
    assertEqual(pure.summary.matchedLines, 2, "matchedLines (AAA × 2)");
    assertEqual(pure.summary.unmatchedLines, 1, "unmatchedLines (BBB)");
    assertEqual(pure.summary.unmatchedBarcodes.join(","), "BBB", "unmatchedBarcodes");

    // ── 2. Flag KAPALI → reddetmeli ──────────────────────────────────────────
    step("Flag KAPALI iken previewTrendyolOrders reddetmeli...");
    await updateSettings({ marketplaceSyncEnabled: false }, actorUserId);
    await assertRejects(
      () => previewTrendyolOrders({}, { fetchOrders: async () => ({ content: [] }) }),
      "MARKETPLACE_SYNC_DISABLED",
      "Flag kapalıyken önizleme engellenmeli",
    );

    // ── 3. Seed: ürün + trendyol listing, flag aç ────────────────────────────
    step("Ürün + trendyol channel_listing seed ediliyor, flag açılıyor...");
    const product = await createProduct({
      name: "SMOKE_Trendyol Ürün",
      price: "149.90",
      barcode: BARCODE,
    });
    productIds.push(product.id);
    await createChannelListing(product.id, {
      channel: "trendyol",
      externalId: BARCODE,
      actorUserId,
    });
    await updateSettings({ marketplaceSyncEnabled: true }, actorUserId);

    // ── 4. Sahte fetcher ile önizleme ────────────────────────────────────────
    step("Sahte fetcher (1 eşleşen + 1 eşleşmeyen barkod) ile önizleme...");
    const fakeOrders = {
      content: [
        {
          orderNumber: "TY-1001",
          status: "Created",
          customerFirstName: "Ayşe",
          customerLastName: "Y.",
          lines: [
            { barcode: BARCODE, quantity: 2, productName: "TY Adı" },
            { barcode: UNMATCHED, quantity: 1, productName: "Bilinmeyen" },
          ],
        },
      ],
    };
    const preview = await previewTrendyolOrders({ status: "Created" }, { fetchOrders: async () => fakeOrders });
    info("matched/total", `${preview.summary.matchedLines}/${preview.summary.totalLines}`);
    assertEqual(preview.summary.totalOrders, 1, "preview.totalOrders");
    assertEqual(preview.summary.matchedLines, 1, "preview.matchedLines (BARCODE eşleşti)");
    assertEqual(preview.summary.unmatchedLines, 1, "preview.unmatchedLines (UNMATCHED)");

    const matchedLine = preview.orders[0].lines.find(l => l.barcode === BARCODE);
    assert(!!matchedLine && matchedLine.matched, "eşleşen satır matched=true");
    assertEqual(matchedLine?.productId, product.id, "eşleşen satır iç ürüne çözüldü");
    assertEqual(matchedLine?.internalName, "SMOKE_Trendyol Ürün", "iç ürün adı geldi");
    assert(preview.summary.unmatchedBarcodes.includes(UNMATCHED), "unmatchedBarcodes UNMATCHED içeriyor");

    // ── 5. Kimlik yok → gerçek client ağ'a çıkmadan reddetmeli ───────────────
    step("Kimlik yapılandırılmamışken getOrders ağ'a çıkmadan reddetmeli...");
    if (isTrendyolConfigured()) {
      info("not", "TRENDYOL kimliği env'de tanımlı; bu adım atlanıyor.");
    } else {
      await assertRejects(
        () => getOrders({ status: "Created" }),
        "TRENDYOL_NOT_CONFIGURED",
        "Kimlik yokken getOrders ağ denemeden reddetmeli",
      );
    }

    ok("\nSMOKE 26 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    try {
      await updateSettings({ marketplaceSyncEnabled: originalFlag });
    } catch {
      // yut
    }
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
