/**
 * SMOKE 32 — Pazaryeri Siparişleri Görünümü (read-only liste, v1.6)
 *
 * Ağ YOK: gerçek Trendyol'a çıkmaz. listTrendyolOrders'a sahte bir fetcher enjekte
 * edilir; foto (channel_products) + iç ürün eşleşmesi (channel_listings) gerçek DB ile
 * test edilir. statusToTab + buildOrdersList saf fonksiyonları ayrıca izole test edilir.
 *
 * Bu uç SALT-OKUNUR ve STOĞA DOKUNMAZ (order-sync defterinden bağımsız) — yalnız
 * marketplaceSyncEnabled flag'iyle açılır; stok flag'leri (marketplaceOrdersEnabled /
 * push) bu akışta hiç kullanılmaz.
 *
 * Senaryo:
 *   1. statusToTab (saf): TY ham durumları → ekran sekmeleri.
 *   2. buildOrdersList (saf): eşleşme + foto join + tab sayımları + dedupe.
 *   3. Flag KAPALI → listTrendyolOrders MARKETPLACE_SYNC_DISABLED atar.
 *   4. Ürün + trendyol listing + channel_products(image_url) seed, flag aç.
 *   5. Sahte fetcher (ana pencere + Awaiting) → liste foto/eşleşme/tab/sayım doğru.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/32-trendyol-orders-list.ts
 */

import { createProduct } from "../../src/services/products.service.js";
import { createChannelListing } from "../../src/services/channel-listings.service.js";
import {
  statusToTab,
  buildOrdersList,
  listTrendyolOrders,
  type DisplayMatchMap,
  type ChannelInfoMap,
} from "../../src/services/trendyol/orders.service.js";
import type { GetOrdersParams, TrendyolOrdersResponse } from "../../src/services/trendyol/client.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual,
  assertRejects, closePool, ok, getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const productIds: string[] = [];
  const stamp = Date.now().toString();
  const BARCODE = `SMOKE32_${stamp}`;
  const UNMATCHED = `SMOKE32_NOMATCH_${stamp}`;

  const before = await getSettings();
  const originalFlag = before.marketplaceSyncEnabled;

  try {
    section("SMOKE 32 — Pazaryeri Siparişleri Görünümü");

    const actorUserId = await getActorUserId();

    // ── 1. statusToTab saf eşleme ────────────────────────────────────────────
    step("statusToTab durumları doğru sekmeye eşlemeli...");
    assertEqual(statusToTab("Created"), "yeni", "Created→yeni");
    assertEqual(statusToTab("ReadyToShip"), "yeni", "ReadyToShip→yeni (yeni siparişin paket durumu)");
    assertEqual(statusToTab("Picking"), "isleme", "Picking→isleme");
    assertEqual(statusToTab("Invoiced"), "isleme", "Invoiced→isleme");
    assertEqual(statusToTab("Shipped"), "tasima", "Shipped→tasima");
    assertEqual(statusToTab("AtCollectionPoint"), "tasima", "AtCollectionPoint→tasima");
    assertEqual(statusToTab("Delivered"), "teslim", "Delivered→teslim");
    assertEqual(statusToTab("Awaiting"), "aski", "Awaiting→aski");
    assertEqual(statusToTab("Cancelled"), "diger", "Cancelled→diger");
    assertEqual(statusToTab("Returned"), "diger", "Returned→diger");

    // ── 2. buildOrdersList saf (eşleşme + foto + sayım + dedupe) ──────────────
    step("buildOrdersList saf: eşleşme/foto/sekme/dedupe doğru...");
    const matchMap: DisplayMatchMap = new Map([["AAA", { productId: "1", internalName: "İç Ürün" }]]);
    const channelMap: ChannelInfoMap = new Map([["AAA", { imageUrl: "img://aaa", title: "TY AAA", productUrl: "https://ty.example/p/aaa" }]]);
    const pure = buildOrdersList(
      [
        { orderNumber: "O1", shipmentPackageStatus: "Created", id: 11, lines: [
          { id: 1, barcode: "AAA", quantity: 2, price: 10 },
          { id: 2, barcode: "BBB", quantity: 1 },
        ] },
        { orderNumber: "O2", shipmentPackageStatus: "Delivered", id: 12, lines: [{ id: 3, barcode: "AAA", quantity: 1 }] },
        // Aynı (orderNumber, packageId) → tekrar sayılmamalı (dedupe).
        { orderNumber: "O1", shipmentPackageStatus: "Created", id: 11, lines: [] },
      ],
      matchMap,
      channelMap,
    );
    assertEqual(pure.total, 2, "dedupe → 2 sipariş");
    assertEqual(pure.tabCounts.tum, 2, "tabCounts.tum");
    assertEqual(pure.tabCounts.yeni, 1, "tabCounts.yeni (Created)");
    assertEqual(pure.tabCounts.teslim, 1, "tabCounts.teslim (Delivered)");
    const o1 = pure.orders.find(o => o.orderNumber === "O1")!;
    const lineAAA = o1.lines.find(l => l.barcode === "AAA")!;
    assert(lineAAA.matched, "AAA matched=true");
    assertEqual(lineAAA.imageUrl, "img://aaa", "AAA foto channelMap'ten geldi");
    assertEqual(lineAAA.internalName, "İç Ürün", "AAA iç ürün adı");
    const lineBBB = o1.lines.find(l => l.barcode === "BBB")!;
    assert(!lineBBB.matched, "BBB matched=false");
    assertEqual(lineBBB.imageUrl, null, "BBB foto yok");

    // ── 3. Flag KAPALI → reddetmeli ──────────────────────────────────────────
    step("Flag KAPALI iken listTrendyolOrders reddetmeli...");
    await updateSettings({ marketplaceSyncEnabled: false }, actorUserId);
    await assertRejects(
      () => listTrendyolOrders({}, { fetchOrders: async () => ({ content: [] }) }),
      "MARKETPLACE_SYNC_DISABLED",
      "Flag kapalıyken liste engellenmeli",
    );

    // ── 4. Seed: ürün + trendyol listing + channel_products(image_url) ────────
    step("Ürün + trendyol listing + channel_products(foto) seed, flag açılıyor...");
    const product = await createProduct({ name: "SMOKE32 Ürün", price: "149.90", barcode: BARCODE });
    productIds.push(product.id);
    await createChannelListing(product.id, { channel: "trendyol", externalId: BARCODE, actorUserId });
    await pool.query(
      `INSERT INTO channel_products (channel, external_id, title, image_url)
         VALUES ('trendyol', $1, $2, $3)
       ON CONFLICT (channel, external_id)
         DO UPDATE SET title = EXCLUDED.title, image_url = EXCLUDED.image_url`,
      [BARCODE, "TY Başlık", "https://cdn.example/p.jpg"],
    );
    await updateSettings({ marketplaceSyncEnabled: true }, actorUserId);

    // ── 5. Sahte fetcher (ana pencere + Awaiting) ile gerçek DB join ──────────
    step("Sahte fetcher ile liste: foto/eşleşme/tab/sayım doğru...");
    const fakeFetch = async (params: GetOrdersParams): Promise<TrendyolOrdersResponse> => {
      if (params.status === "Awaiting") {
        return {
          totalPages: 1,
          content: [
            { orderNumber: "TY-ASK", shipmentPackageStatus: "Awaiting", id: 90, lines: [{ id: 9, barcode: BARCODE, quantity: 1, price: 50 }] },
          ],
        };
      }
      return {
        totalPages: 1,
        content: [
          {
            orderNumber: "TY-NEW", shipmentPackageStatus: "Created", id: 91,
            customerFirstName: "Ada", customerLastName: "K.",
            shipmentAddress: { city: "İzmir", district: "Konak" },
            cargoProviderName: "Aras Kargo", cargoTrackingNumber: 12345,
            grossAmount: 120, totalDiscount: 20, totalPrice: 100,
            lines: [
              { id: 10, barcode: BARCODE, quantity: 2, price: 50, productName: "TY Ürün", merchantSku: "SKU1", productColor: "Siyah", productSize: "Tek Ebat" },
              { id: 11, barcode: UNMATCHED, quantity: 1, productName: "Bilinmeyen" },
            ],
          },
        ],
      };
    };

    const list = await listTrendyolOrders({}, { fetchOrders: fakeFetch });
    info("orders/tum", `${list.total}/${list.tabCounts.tum}`);
    assertEqual(list.total, 2, "2 sipariş (TY-NEW + TY-ASK)");
    assertEqual(list.tabCounts.yeni, 1, "tabCounts.yeni");
    assertEqual(list.tabCounts.aski, 1, "tabCounts.aski (Awaiting ayrı çekildi)");

    const newOrder = list.orders.find(o => o.orderNumber === "TY-NEW")!;
    assertEqual(newOrder.tab, "yeni", "TY-NEW tab=yeni");
    assertEqual(newOrder.buyerName, "Ada K.", "alıcı adı birleşti");
    assertEqual(newOrder.city, "İzmir", "şehir");
    assertEqual(newOrder.district, "Konak", "ilçe");
    assertEqual(newOrder.cargoProvider, "Aras Kargo", "kargo firması");
    assertEqual(newOrder.cargoTrackingNumber, "12345", "kargo takip no (string'e döndü)");
    assertEqual(newOrder.saleAmount, 120, "satış tutarı (grossAmount)");
    assertEqual(newOrder.discount, 20, "satıcı indirimi (totalDiscount)");
    assertEqual(newOrder.billable, 100, "faturalanacak (totalPrice)");

    const mLine = newOrder.lines.find(l => l.barcode === BARCODE)!;
    assert(mLine.matched, "eşleşen satır matched=true");
    assertEqual(mLine.internalProductId, product.id, "satır iç ürüne çözüldü");
    assertEqual(mLine.imageUrl, "https://cdn.example/p.jpg", "TY fotoğrafı DB'den join'lendi");
    assertEqual(mLine.color, "Siyah", "renk");
    assertEqual(mLine.size, "Tek Ebat", "beden");

    const uLine = newOrder.lines.find(l => l.barcode === UNMATCHED)!;
    assert(!uLine.matched, "eşleşmeyen satır matched=false");
    assertEqual(uLine.imageUrl, null, "eşleşmeyen satır foto yok");

    const askOrder = list.orders.find(o => o.orderNumber === "TY-ASK")!;
    assertEqual(askOrder.tab, "aski", "TY-ASK tab=aski");

    ok("\nSMOKE 32 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    try {
      await updateSettings({ marketplaceSyncEnabled: originalFlag });
    } catch {
      // yut
    }
    try {
      await pool.query(`DELETE FROM channel_products WHERE channel = 'trendyol' AND external_id = ANY($1::text[])`, [[BARCODE]]);
    } catch {
      // yut
    }
    if (productIds.length > 0) {
      await pool.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [productIds]);
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
