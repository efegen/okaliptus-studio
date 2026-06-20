/**
 * SMOKE 28 — Trendyol sipariş → stok senkronu (Model C / Faz 1, v1.6)
 *
 * Ağ YOK: syncTrendyolOrders'a sahte fetcher enjekte edilir. Senkron + idempotensi
 * + iptal/iade/eşleşmeyen kuyrukları gerçek DB ile test edilir. Trendyol'a hiçbir
 * yazma yapılmaz (Faz 1 = pull-only).
 *
 * Senaryo:
 *   1. P1(BC_A, stok 10) + P2(BC_B, stok 10); trendyol channel_listing'leri; flag'ler aç.
 *   2. Created siparişler: O1(BC_A×3), O2(BC_B×2), O3(BC_X×1 eşleşmeyen).
 *      → P1=7, P2=8; kuyrukta 1 eşleşmeyen (BC_X). counted=2, unitsDecremented=5.
 *   3. Aynı veriyle tekrar sync → NO-OP (unitsDecremented=0; P1=7, P2=8).
 *   4. O1→Cancelled (otomatik +3 geri → P1=10), O2→Returned (OTOMATİK DEĞİL →
 *      P2=8 kalır + iade-bekleyen kuyruğu).
 *   5. Operatör P2'yi elle 10'a setStock + kuyruk kalemini resolve → kuyruktan çıkar.
 *   6. Flag KAPALI → sync MARKETPLACE_ORDERS_DISABLED.
 *
 * ÇALIŞTIRMA: cd backend && npx tsx scripts/smoke/28-trendyol-order-sync.ts
 */

import { createProduct } from "../../src/services/products.service.js";
import { createChannelListing } from "../../src/services/channel-listings.service.js";
import { adjustProductStock } from "../../src/services/stock.service.js";
import {
  syncTrendyolOrders,
  getOrderReviewQueue,
  resolveOrderReviewItem,
  classifyTrendyolStatus,
} from "../../src/services/trendyol/order-sync.service.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual,
  assertRejects, closePool, ok, getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const productIds: string[] = [];
  const stamp = Date.now().toString();
  const BC_A = `SMK28_A_${stamp}`;
  const BC_B = `SMK28_B_${stamp}`;
  const BC_X = `SMK28_X_${stamp}`;
  const O1 = `O1_${stamp}`;
  const O2 = `O2_${stamp}`;
  const O3 = `O3_${stamp}`;
  const orderNumbers = [O1, O2, O3];

  const before = await getSettings();
  const origOrders = before.marketplaceOrdersEnabled;
  const origSync = before.marketplaceSyncEnabled;
  const origStock = before.stockTrackingEnabled;

  // Enjekte edilen sipariş kaynağı; adımlar arasında değiştirilir.
  let currentOrders: unknown[] = [];
  const fakeFetch = async () => ({
    page: 0, size: 200, totalPages: 1, totalElements: currentOrders.length, content: currentOrders,
  });
  const sync = () => syncTrendyolOrders({ fetchOrders: fakeFetch as never });

  const line = (id: string, barcode: string, quantity: number, status: string) =>
    ({ id, barcode, quantity, orderLineItemStatusName: status });
  const order = (orderNumber: string, lines: unknown[]) =>
    ({ orderNumber, status: "Created", orderDate: Date.now(), customerFirstName: "Smoke", customerLastName: "28", lines });

  async function onHand(productId: string): Promise<number> {
    const r = await pool.query<{ on_hand: number }>(
      `SELECT on_hand FROM v_product_stock WHERE product_id = $1`, [productId],
    );
    return Number(r.rows[0]?.on_hand ?? NaN);
  }
  async function myQueue() {
    const q = await getOrderReviewQueue();
    return q.items.filter(i => orderNumbers.includes(i.orderNumber));
  }

  try {
    section("SMOKE 28 — Trendyol sipariş → stok senkronu (Faz 1)");
    const actorUserId = await getActorUserId();

    // Saf sınıflandırıcı sağlaması (ağ/DB yok).
    step("classifyTrendyolStatus...");
    assertEqual(classifyTrendyolStatus("Created"), "sold", "Created → sold");
    assertEqual(classifyTrendyolStatus("Shipped"), "sold", "Shipped → sold");
    assertEqual(classifyTrendyolStatus("Cancelled"), "cancelled", "Cancelled → cancelled");
    assertEqual(classifyTrendyolStatus("UnSupplied"), "cancelled", "UnSupplied → cancelled");
    assertEqual(classifyTrendyolStatus("Returned"), "returned", "Returned → returned");
    assertEqual(classifyTrendyolStatus("WeirdUnknown"), "sold", "bilinmeyen → sold (yalnız açık iptalde geri al)");

    step("P1/P2 oluştur, açılış stoğu 10, trendyol eşlemesi, flag'ler aç...");
    const p1 = await createProduct({ name: "SMK28 Ürün A", price: "100.00", barcode: BC_A });
    const p2 = await createProduct({ name: "SMK28 Ürün B", price: "200.00", barcode: BC_B });
    productIds.push(p1.id, p2.id);
    await updateSettings({ stockTrackingEnabled: true, marketplaceSyncEnabled: true, marketplaceOrdersEnabled: true }, actorUserId);
    await adjustProductStock({ productId: p1.id, newOnHand: 10, note: "açılış", actorUserId });
    await adjustProductStock({ productId: p2.id, newOnHand: 10, note: "açılış", actorUserId });
    await createChannelListing(p1.id, { channel: "trendyol", externalId: BC_A, actorUserId });
    await createChannelListing(p2.id, { channel: "trendyol", externalId: BC_B, actorUserId });
    assertEqual(await onHand(p1.id), 10, "P1 açılış stoğu");
    assertEqual(await onHand(p2.id), 10, "P2 açılış stoğu");

    step("Created siparişler senkronu (O1 BC_A×3, O2 BC_B×2, O3 BC_X×1 eşleşmeyen)...");
    currentOrders = [
      order(O1, [line("L1", BC_A, 3, "Created")]),
      order(O2, [line("L2", BC_B, 2, "Created")]),
      order(O3, [line("L3", BC_X, 1, "Created")]),
    ];
    const r1 = await sync();
    info("sync#1", JSON.stringify(r1));
    assertEqual(await onHand(p1.id), 7, "P1 stok 3 düştü (10→7)");
    assertEqual(await onHand(p2.id), 8, "P2 stok 2 düştü (10→8)");
    assertEqual(r1.counted, 2, "2 satır sayıldı");
    assertEqual(r1.unitsDecremented, 5, "toplam 5 adet düşüldü");
    let queue = await myQueue();
    assertEqual(queue.length, 1, "kuyrukta 1 kalem (eşleşmeyen)");
    assertEqual(queue[0].state, "unmatched", "kalem durumu unmatched");
    assertEqual(queue[0].barcode, BC_X, "eşleşmeyen barkod BC_X");

    step("Aynı veriyle TEKRAR sync → idempotent no-op...");
    const r2 = await sync();
    info("sync#2", JSON.stringify(r2));
    assertEqual(r2.unitsDecremented, 0, "ikinci turda hiç düşüm yok (idempotent)");
    assertEqual(r2.unitsRestored, 0, "ikinci turda hiç geri ekleme yok");
    assertEqual(await onHand(p1.id), 7, "P1 stok değişmedi (7)");
    assertEqual(await onHand(p2.id), 8, "P2 stok değişmedi (8)");

    step("O1→Cancelled (otomatik geri), O2→Returned (otomatik DEĞİL)...");
    currentOrders = [
      order(O1, [line("L1", BC_A, 3, "Cancelled")]),
      order(O2, [line("L2", BC_B, 2, "Returned")]),
      order(O3, [line("L3", BC_X, 1, "Created")]),
    ];
    const r3 = await sync();
    info("sync#3", JSON.stringify(r3));
    assertEqual(await onHand(p1.id), 10, "P1 iptalde 3 geri eklendi (7→10)");
    assertEqual(await onHand(p2.id), 8, "P2 iade OTOMATİK eklenmedi (8 kaldı)");
    queue = await myQueue();
    const ret = queue.find(i => i.state === "return_pending");
    assert(!!ret && ret.productId === p2.id, "P2 için iade-bekleyen kuyruk kalemi var");
    assert(queue.some(i => i.state === "unmatched" && i.barcode === BC_X), "eşleşmeyen kalem kuyrukta kalır");

    step("Operatör: P2'yi elle 10'a setStock + iade kalemini resolve...");
    await adjustProductStock({ productId: p2.id, newOnHand: 10, note: "iade malı sağlam, elle eklendi", actorUserId });
    assertEqual(await onHand(p2.id), 10, "P2 elle 10'a çıkarıldı");
    await resolveOrderReviewItem(ret!.id, actorUserId);
    queue = await myQueue();
    assert(!queue.some(i => i.state === "return_pending"), "iade kalemi kuyruktan çıktı");
    assert(queue.some(i => i.state === "unmatched"), "eşleşmeyen kalem hâlâ kuyrukta");

    step("resolve idempotensi: aynı kalem ikinci kez → reddedilir...");
    await assertRejects(() => resolveOrderReviewItem(ret!.id, actorUserId), "VALIDATION_ERROR", "çözülmüş kalem tekrar resolve edilemez");

    step("Flag KAPALI → sync reddetmeli...");
    await updateSettings({ marketplaceOrdersEnabled: false }, actorUserId);
    await assertRejects(() => sync(), "MARKETPLACE_ORDERS_DISABLED", "flag kapalıyken sync engellenir");

    ok("\nSMOKE 28 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    try {
      await updateSettings({
        marketplaceOrdersEnabled: origOrders,
        marketplaceSyncEnabled: origSync,
        stockTrackingEnabled: origStock,
      });
    } catch { /* yut */ }
    // FK sırası: stock_movements.related_channel_order_line_id → channel_order_lines.
    // Önce hareketleri, sonra defteri, sonra ürünleri sil.
    if (productIds.length > 0) {
      await pool.query(`DELETE FROM stock_movements WHERE product_id = ANY($1::bigint[])`, [productIds]);
    }
    await pool.query(`DELETE FROM channel_order_lines WHERE order_number = ANY($1::text[])`, [orderNumbers]);
    if (productIds.length > 0) {
      // channel_listings ON DELETE CASCADE (product).
      await pool.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [productIds]);
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
