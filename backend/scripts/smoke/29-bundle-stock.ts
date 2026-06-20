/**
 * SMOKE 29 — Bundle (paket) stok modeli (Model C / Faz 1.5, v1.6)
 *
 * Ağ YOK: TY senkronuna sahte fetcher enjekte edilir. Türev stok + POS bileşen
 * patlatma + TY bileşen patlatma + setStock reddi + iç içe yasağı + kurulum-bekliyor
 * (setup_pending) + sapma koruması gerçek DB ile test edilir.
 *
 * Senaryo:
 *   1. C1(bileşen, stok 10), C2(bileşen, stok 6); flag'ler aç.
 *   2. B(paket) = [C1×1, C2×2] → türev on_hand = min(10, floor(6/2)=3) = 3.
 *   3. setStock(B) → reddedilir (paket stoğu elle ayarlanamaz).
 *   4. POS satışı B×2 → C1 8, C2 2, B min(8,1)=1; satış kalemi PAKET adıyla (bileşen değil).
 *   5. setStock(C1,10) serbest → C1 10, B min(10,1)=1.
 *   6. İç içe yasağı: paketi başka pakete bileşen yapmak + bileşeni paket yapmak → red.
 *   7. Bileşeni olmayan paket → türev on_hand 0.
 *   8. TY: B'ye listing + Created sipariş → counted; C1/C2 bileşen başına düşer; defter B granül.
 *   9. Sapma koruması: sayılmış TY siparişi varken bileşen değişimi → red.
 *  10. TY idempotent re-sync → no-op. Cancel → bileşenler geri.
 *  11. setup_pending: bileşensiz pakete sipariş → decrement YOK, inceleme kuyruğunda.
 *
 * ÇALIŞTIRMA: cd backend && npx tsx scripts/smoke/29-bundle-stock.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createProduct } from "../../src/services/products.service.js";
import { createProductSale, getProductSaleById } from "../../src/services/product-sales.service.js";
import { createChannelListing } from "../../src/services/channel-listings.service.js";
import { adjustProductStock } from "../../src/services/stock.service.js";
import { setBundle, getBundle } from "../../src/services/bundle-components.service.js";
import { syncTrendyolOrders, getOrderReviewQueue } from "../../src/services/trendyol/order-sync.service.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual,
  assertRejects, cleanupSmoke, closePool, ok, getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const productIds: string[] = [];
  const stamp = Date.now().toString();
  const BC_B = `SMK29_B_${stamp}`;   // paket TY barkodu
  const BC_E = `SMK29_E_${stamp}`;   // bileşensiz paket barkodu
  const O1 = `O1_${stamp}`;
  const O2 = `O2_${stamp}`;
  const orderNumbers = [O1, O2];

  const before = await getSettings();
  const origOrders = before.marketplaceOrdersEnabled;
  const origSync = before.marketplaceSyncEnabled;
  const origStock = before.stockTrackingEnabled;

  let currentOrders: unknown[] = [];
  const fakeFetch = async () => ({
    page: 0, size: 200, totalPages: 1, totalElements: currentOrders.length, content: currentOrders,
  });
  const sync = () => syncTrendyolOrders({ fetchOrders: fakeFetch as never });
  const line = (id: string, barcode: string, quantity: number, status: string) =>
    ({ id, barcode, quantity, orderLineItemStatusName: status });
  const order = (orderNumber: string, lines: unknown[]) =>
    ({ orderNumber, status: "Created", orderDate: Date.now(), customerFirstName: "Smoke", customerLastName: "29", lines });

  async function eff(productId: string): Promise<number> {
    const r = await pool.query<{ on_hand: number }>(
      `SELECT on_hand FROM v_product_effective_stock WHERE product_id = $1`, [productId],
    );
    return Number(r.rows[0]?.on_hand ?? NaN);
  }

  try {
    section("SMOKE 29 — Bundle (paket) stok modeli (Faz 1.5)");
    const actorUserId = await getActorUserId();

    step("Bileşenler C1(10), C2(6) + flag'ler...");
    const c1 = await createProduct({ name: "SMK29 Bileşen 1", price: "50.00" });
    const c2 = await createProduct({ name: "SMK29 Bileşen 2", price: "30.00" });
    productIds.push(c1.id, c2.id);
    await updateSettings({ stockTrackingEnabled: true, marketplaceSyncEnabled: true, marketplaceOrdersEnabled: true }, actorUserId);
    await adjustProductStock({ productId: c1.id, newOnHand: 10, note: "açılış", actorUserId });
    await adjustProductStock({ productId: c2.id, newOnHand: 6, note: "açılış", actorUserId });

    step("Paket B = [C1×1, C2×2] → türev on_hand min(10, floor(6/2)=3) = 3...");
    const b = await createProduct({ name: "SMK29 Paket B", price: "200.00", barcode: BC_B });
    productIds.push(b.id);
    const bundleView = await setBundle(b.id, [{ productId: c1.id, quantity: 1 }, { productId: c2.id, quantity: 2 }], actorUserId);
    assertEqual(bundleView.isBundle, true, "B paket oldu");
    assertEqual(bundleView.components.length, 2, "B'nin 2 bileşeni");
    assertEqual(await eff(b.id), 3, "B türev stok = min(10, 3) = 3");

    step("setStock(B) → reddedilir (paket stoğu elle ayarlanamaz)...");
    await assertRejects(
      () => adjustProductStock({ productId: b.id, newOnHand: 5, actorUserId }),
      "VALIDATION_ERROR", "pakete elle setStock yasak",
    );

    step("POS satışı B×2 → bileşenler düşer (C1-2, C2-4)...");
    const student = await createStudent({ fullName: "SMK29_Student", phone: "+90 555 029 0001" });
    studentIds.push(student.id);
    const sale = await createProductSale({
      studentId: student.id,
      soldAt: new Date().toISOString(),
      items: [{ productId: Number(b.id), quantity: 2 }],
      actorUserId,
    });
    assertEqual(await eff(c1.id), 8, "C1 10→8 (paket×2 × 1)");
    assertEqual(await eff(c2.id), 2, "C2 6→2 (paket×2 × 2)");
    assertEqual(await eff(b.id), 1, "B türev min(8, floor(2/2)=1) = 1");
    const saleFull = await getProductSaleById(sale.id);
    assertEqual(saleFull.items.length, 1, "satışta tek kalem");
    assertEqual(String(saleFull.items[0].product_id), String(b.id), "kalem PAKET ürünü (bileşen değil)");

    step("setStock(C1,10) SERBEST (bileşen) → B yeniden türer...");
    await adjustProductStock({ productId: c1.id, newOnHand: 10, note: "yeniden dolum", actorUserId });
    assertEqual(await eff(c1.id), 10, "C1 = 10");
    assertEqual(await eff(b.id), 1, "B min(10, floor(2/2)=1) = 1");

    step("İç içe paket yasağı...");
    const b2 = await createProduct({ name: "SMK29 Paket B2", price: "150.00" });
    productIds.push(b2.id);
    await setBundle(b2.id, [{ productId: c1.id, quantity: 1 }], actorUserId); // B2 de paket (C1 paylaşımlı)
    await assertRejects(
      () => setBundle(b.id, [{ productId: b2.id, quantity: 1 }], actorUserId),
      "VALIDATION_ERROR", "paket başka paketi bileşen olarak içeremez",
    );
    await assertRejects(
      () => setBundle(c1.id, [{ productId: c2.id, quantity: 1 }], actorUserId),
      "VALIDATION_ERROR", "başka paketin bileşeni paket yapılamaz",
    );

    step("Bileşensiz paket → türev on_hand 0...");
    const bEmpty = await createProduct({ name: "SMK29 Boş Paket", price: "99.00", barcode: BC_E });
    productIds.push(bEmpty.id);
    await setBundle(bEmpty.id, [], actorUserId);
    assertEqual(await eff(bEmpty.id), 0, "bileşensiz paket on_hand = 0");

    step("TY: B'ye listing + Created sipariş → bileşenler düşer, defter paket granül...");
    await createChannelListing(b.id, { channel: "trendyol", externalId: BC_B, actorUserId });
    currentOrders = [order(O1, [line("L1", BC_B, 1, "Created")])];
    const r1 = await sync();
    info("sync#1", JSON.stringify(r1));
    assertEqual(r1.counted, 1, "1 paket satırı sayıldı");
    assertEqual(await eff(c1.id), 9, "C1 10→9 (paket×1 × 1)");
    assertEqual(await eff(c2.id), 0, "C2 2→0 (paket×1 × 2)");
    const ledger = await pool.query<{ applied_delta: number; state: string }>(
      `SELECT applied_delta, state FROM channel_order_lines WHERE order_number = $1`, [O1],
    );
    assertEqual(Number(ledger.rows[0]?.applied_delta), -1, "defter paket granül applied_delta = -1");
    assertEqual(ledger.rows[0]?.state, "counted", "defter state counted");
    const moves = await pool.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM stock_movements
        WHERE type = 'channel_sale' AND product_id = ANY($1::bigint[])`, [[c1.id, c2.id]],
    );
    assert(Number(moves.rows[0].cnt) >= 2, "bileşen başına channel_sale hareketi yazıldı (C1+C2)");

    step("Sapma koruması: sayılmış TY siparişi varken bileşen değişimi → red...");
    await assertRejects(
      () => setBundle(b.id, [{ productId: c1.id, quantity: 2 }, { productId: c2.id, quantity: 2 }], actorUserId),
      "VALIDATION_ERROR", "counted TY siparişi varken bileşen değiştirilemez",
    );

    step("TY idempotent re-sync → no-op...");
    const r2 = await sync();
    assertEqual(r2.unitsDecremented, 0, "ikinci tur düşüm yok");
    assertEqual(await eff(c1.id), 9, "C1 sabit 9");

    step("TY iptal → bileşenler geri...");
    currentOrders = [order(O1, [line("L1", BC_B, 1, "Cancelled")])];
    const r3 = await sync();
    info("sync#3", JSON.stringify(r3));
    assertEqual(await eff(c1.id), 10, "C1 9→10 (iptal geri)");
    assertEqual(await eff(c2.id), 2, "C2 0→2 (iptal geri)");

    step("setup_pending: bileşensiz pakete sipariş → decrement YOK, kuyrukta...");
    await createChannelListing(bEmpty.id, { channel: "trendyol", externalId: BC_E, actorUserId });
    currentOrders = [order(O2, [line("L2", BC_E, 1, "Created")])];
    const r4 = await sync();
    info("sync#4", JSON.stringify(r4));
    assert(r4.setupPending >= 1, "kurulum-bekliyor satırı sayıldı");
    assertEqual(await eff(bEmpty.id), 0, "bileşensiz paket düşmedi (0)");
    const queue = await getOrderReviewQueue();
    const setupItem = queue.items.find(i => i.orderNumber === O2 && i.state === "setup_pending");
    assert(!!setupItem, "setup_pending kalemi inceleme kuyruğunda");

    ok("\nSMOKE 29 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    try {
      await updateSettings({
        marketplaceOrdersEnabled: origOrders,
        marketplaceSyncEnabled: origSync,
        stockTrackingEnabled: origStock,
      });
    } catch { /* yut */ }
    // FK sırası: stock_movements → channel_order_lines; product_sale_items.product_id NULL;
    // bundle_components + channel_listings products CASCADE.
    await cleanupSmoke(studentIds); // öğrenci + satış soft-delete
    if (productIds.length > 0) {
      await pool.query(`UPDATE product_sale_items SET product_id = NULL WHERE product_id = ANY($1::bigint[])`, [productIds]);
      await pool.query(`DELETE FROM stock_movements WHERE product_id = ANY($1::bigint[])`, [productIds]);
    }
    await pool.query(`DELETE FROM channel_order_lines WHERE order_number = ANY($1::text[])`, [orderNumbers]);
    if (productIds.length > 0) {
      await pool.query(`DELETE FROM bundle_components WHERE bundle_product_id = ANY($1::bigint[]) OR component_product_id = ANY($1::bigint[])`, [productIds]);
      await pool.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [productIds]);
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
