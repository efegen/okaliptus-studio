/**
 * SMOKE 30 — Trendyol iade (claims) → inceleme kuyruğu senkronu (Model C / Faz 1, v1.6)
 *
 * Ağ YOK: hem orders hem claims fetcher'ları enjekte edilir. "İade kuyruğu boş
 * kalıyor" deliğinin kapandığını gerçek DB ile doğrular. Trendyol'a hiçbir yazma,
 * stok hareketi YOK (iade otomatik +stok YAPMAZ — operatör elle ekler).
 *
 * Saf çekirdek (ağ/DB yok):
 *   classifyClaimStatus / flattenClaims / planClaimReconciliation.
 *
 * DB akışı:
 *   1. P1(BC_A,10)/P2(BC_B,10)/P3(BC_C,10) + trendyol listing'leri + flag'ler aç.
 *   2. Orders: O1(L1 BC_A×2), O2(L2 BC_B×3), O3(L3 BC_C×1) Created → P1=8,P2=7,P3=9 counted.
 *   3. Boş claims → no-op.
 *   4. Claims: CL1(O1/L1 ×2 Accepted) + CL2(O3/L3 Accepted) → O1/L1 + O3/L3 return_pending;
 *      stok DEĞİŞMEZ (P1=8,P3=9); kuyrukta claim üst verisi (sebep/durum/adet) görünür.
 *   5. Aynı claims tekrar → idempotent no-op (returnsRegistered=0, alreadyPending=2).
 *   6. CL3(O2/L2 Cancelled) → iade DEĞİL (inactive); O2/L2 counted kalır, kuyruğa düşmez.
 *   7. STICKY: orders tekrar (hepsi hâlâ Created) → return_pending satırlar GERİ counted'a
 *      DÖNMEZ (kuyruktan düşmez); O2/L2 counted kalır; stok değişmez.
 *   8. Eşleşmeyen claim (phantom sipariş) → unlinked; çökmez, satır uydurulmaz.
 *   9. Operatör: P1'i elle 10'a setStock + O1/L1 kalemini resolve → kuyruktan çıkar;
 *      tekrar claims sync iadeyi YENİDEN AÇMAZ (resolved_at korunur).
 *  10. Flag KAPALI → claims sync MARKETPLACE_ORDERS_DISABLED.
 *
 * ÇALIŞTIRMA: cd backend && npx tsx scripts/smoke/30-trendyol-claims-sync.ts
 */

import { createProduct } from "../../src/services/products.service.js";
import { createChannelListing } from "../../src/services/channel-listings.service.js";
import { adjustProductStock } from "../../src/services/stock.service.js";
import {
  syncTrendyolOrders,
  getOrderReviewQueue,
  resolveOrderReviewItem,
  lineKey,
  type ExistingLine,
  type LineState,
} from "../../src/services/trendyol/order-sync.service.js";
import {
  syncTrendyolClaims,
  classifyClaimStatus,
  flattenClaims,
  planClaimReconciliation,
} from "../../src/services/trendyol/claims-sync.service.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual,
  assertRejects, closePool, ok, getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const productIds: string[] = [];
  const stamp = Date.now().toString();
  const BC_A = `SMK30_A_${stamp}`;
  const BC_B = `SMK30_B_${stamp}`;
  const BC_C = `SMK30_C_${stamp}`;
  const O1 = `O1_${stamp}`, O2 = `O2_${stamp}`, O3 = `O3_${stamp}`, OPH = `OPH_${stamp}`;
  const orderNumbers = [O1, O2, O3, OPH];

  const before = await getSettings();
  const origOrders = before.marketplaceOrdersEnabled;
  const origSync = before.marketplaceSyncEnabled;
  const origStock = before.stockTrackingEnabled;

  // Enjekte edilen kaynaklar; adımlar arasında değiştirilir.
  let currentOrders: unknown[] = [];
  let currentClaims: unknown[] = [];
  const fakeOrderFetch = async () => ({
    page: 0, size: 200, totalPages: 1, totalElements: currentOrders.length, content: currentOrders,
  });
  const fakeClaimFetch = async () => ({
    page: 0, size: 200, totalPages: 1, totalElements: currentClaims.length, content: currentClaims,
  });
  const syncOrders = () => syncTrendyolOrders({ fetchOrders: fakeOrderFetch as never });
  const syncClaims = () => syncTrendyolClaims({ fetchClaims: fakeClaimFetch as never });

  const oline = (id: string, barcode: string, quantity: number, status: string) =>
    ({ id, barcode, quantity, orderLineItemStatusName: status });
  const order = (orderNumber: string, lines: unknown[]) =>
    ({ orderNumber, status: "Created", orderDate: Date.now(), customerFirstName: "Smoke", customerLastName: "30", lines });

  // claimLine: orderLine.id orders'taki line.id ile AYNI olmalı (join anahtarı).
  const cstatus = (name: string) => ({
    claimItemStatus: { name },
    trendyolClaimItemReason: { code: "UNDELIVERED", name: "Teslim edilemeyen gönderi" },
  });
  const claimLine = (orderLineId: string, barcode: string, statuses: string[]) =>
    ({ orderLine: { id: orderLineId, barcode, merchantSku: barcode, productName: "X" }, claimItems: statuses.map(cstatus) });
  const claim = (claimId: string, orderNumber: string, items: unknown[]) =>
    ({ claimId, id: claimId, orderNumber, orderDate: Date.now(), claimDate: Date.now(), customerFirstName: "Smoke", customerLastName: "30", items });

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
  async function lineRow(orderNumber: string, lineId: string) {
    const r = await pool.query<{ state: string; applied_delta: number; resolved_at: string | null }>(
      `SELECT state, applied_delta, resolved_at FROM channel_order_lines
        WHERE channel='trendyol' AND order_number=$1 AND line_id=$2`, [orderNumber, lineId],
    );
    return r.rows[0] ?? null;
  }

  try {
    section("SMOKE 30 — Trendyol iade (claims) → kuyruk senkronu (Faz 1)");
    const actorUserId = await getActorUserId();

    // ── Saf çekirdek (ağ/DB yok) ──────────────────────────────────────────────
    step("classifyClaimStatus...");
    assertEqual(classifyClaimStatus("Accepted"), "active", "Accepted → active");
    assertEqual(classifyClaimStatus("Created"), "active", "Created → active");
    assertEqual(classifyClaimStatus("WaitingInAction"), "active", "WaitingInAction → active");
    assertEqual(classifyClaimStatus("Cancelled"), "inactive", "Cancelled → inactive");
    assertEqual(classifyClaimStatus("Rejected"), "inactive", "Rejected → inactive");
    assertEqual(classifyClaimStatus("WeirdUnknown"), "active", "bilinmeyen → active (iadeyi yutma)");

    step("flattenClaims (multi-line + multi-unit + dedup)...");
    const flat = flattenClaims([
      claim("PF1", "100", [claimLine("LA", "B1", ["Accepted", "Cancelled"]), claimLine("LB", "B2", ["Cancelled"])]) as never,
    ]);
    assertEqual(flat.length, 2, "iki orderLine düzleşti");
    const la = flat.find(f => f.lineId === "LA")!;
    const lb = flat.find(f => f.lineId === "LB")!;
    assert(la.isActiveReturn === true && la.returnedQty === 1, "LA aktif (1 Accepted), returnedQty=1");
    assert(lb.isActiveReturn === false, "LB tümü Cancelled → aktif değil");
    const dedup = flattenClaims([
      claim("D1", "200", [claimLine("LX", "BX", ["Cancelled"])]) as never,
      claim("D2", "200", [claimLine("LX", "BX", ["Accepted"])]) as never,
    ]);
    assertEqual(dedup.length, 1, "aynı (sipariş,satır) tek kalır (dedup)");
    assert(dedup[0].isActiveReturn === true, "dedup aktif olanı tutar");

    step("planClaimReconciliation (counted/return_pending/reversed/unmatched/yok)...");
    const mk = (id: string, state: LineState, applied: number, productId: string | null): ExistingLine =>
      ({ id, state, appliedDelta: applied, productId });
    const existing = new Map<string, ExistingLine>([
      [lineKey("300", "C1"), mk("1", "counted", -1, "p")],
      [lineKey("300", "C2"), mk("2", "return_pending", -1, "p")],
      [lineKey("300", "C3"), mk("3", "reversed", 0, "p")],
      [lineKey("300", "C4"), mk("4", "unmatched", 0, null)],
    ]);
    const incoming = flattenClaims([
      claim("PL", "300", [
        claimLine("C1", "b1", ["Accepted"]),   // counted → register
        claimLine("C2", "b2", ["Accepted"]),   // return_pending → alreadyPending
        claimLine("C3", "b3", ["Accepted"]),   // reversed → skippedOther
        claimLine("C4", "b4", ["Cancelled"]),  // inactive
        claimLine("C5", "b5", ["Accepted"]),   // yok → unlinked
      ]) as never,
    ]);
    const plan = planClaimReconciliation(incoming, existing);
    info("plan.summary", JSON.stringify(plan.summary));
    assertEqual(plan.summary.returnsRegistered, 1, "1 counted → register");
    assertEqual(plan.summary.alreadyPending, 1, "1 return_pending → alreadyPending");
    assertEqual(plan.summary.skippedOther, 1, "1 reversed → skippedOther");
    assertEqual(plan.summary.inactiveClaims, 1, "1 Cancelled → inactive");
    assertEqual(plan.summary.unlinkedClaims, 1, "1 eşleşmeyen → unlinked");
    assertEqual(plan.registers[0]?.existingId, "1", "register hedefi counted satır (id=1)");

    // ── DB akışı ──────────────────────────────────────────────────────────────
    step("P1/P2/P3 oluştur (stok 10), trendyol listing, flag'ler aç...");
    const p1 = await createProduct({ name: "SMK30 Ürün A", price: "100.00", barcode: BC_A });
    const p2 = await createProduct({ name: "SMK30 Ürün B", price: "200.00", barcode: BC_B });
    const p3 = await createProduct({ name: "SMK30 Ürün C", price: "300.00", barcode: BC_C });
    productIds.push(p1.id, p2.id, p3.id);
    await updateSettings({ stockTrackingEnabled: true, marketplaceSyncEnabled: true, marketplaceOrdersEnabled: true }, actorUserId);
    for (const p of [p1, p2, p3]) await adjustProductStock({ productId: p.id, newOnHand: 10, note: "açılış", actorUserId });
    await createChannelListing(p1.id, { channel: "trendyol", externalId: BC_A, actorUserId });
    await createChannelListing(p2.id, { channel: "trendyol", externalId: BC_B, actorUserId });
    await createChannelListing(p3.id, { channel: "trendyol", externalId: BC_C, actorUserId });

    step("Orders senkronu (O1 BC_A×2, O2 BC_B×3, O3 BC_C×1 Created)...");
    currentOrders = [
      order(O1, [oline("L1", BC_A, 2, "Created")]),
      order(O2, [oline("L2", BC_B, 3, "Created")]),
      order(O3, [oline("L3", BC_C, 1, "Created")]),
    ];
    const ro = await syncOrders();
    assertEqual(ro.counted, 3, "3 satır sayıldı");
    assertEqual(await onHand(p1.id), 8, "P1 10→8");
    assertEqual(await onHand(p2.id), 7, "P2 10→7");
    assertEqual(await onHand(p3.id), 9, "P3 10→9");
    assertEqual((await myQueue()).length, 0, "kuyruk boş (henüz iade yok)");

    step("Boş claims → no-op...");
    currentClaims = [];
    const c0 = await syncClaims();
    assertEqual(c0.returnsRegistered, 0, "boş claims → kayıt yok");
    assertEqual(c0.claimLinesSeen, 0, "0 claim satırı");

    step("Claims: CL1(O1/L1 ×2 Accepted) + CL2(O3/L3 Accepted) → return_pending...");
    currentClaims = [
      claim("CL1", O1, [claimLine("L1", BC_A, ["Accepted", "Accepted"])]),
      claim("CL2", O3, [claimLine("L3", BC_C, ["Accepted"])]),
    ];
    const c1 = await syncClaims();
    info("claims#1", JSON.stringify(c1));
    assertEqual(c1.returnsRegistered, 2, "2 satır iade-bekliyor'a taşındı");
    assertEqual(c1.unlinkedClaims, 0, "eşleşmeyen claim yok");
    assertEqual(await onHand(p1.id), 8, "P1 iade OTOMATİK eklenmedi (8)");
    assertEqual(await onHand(p3.id), 9, "P3 iade OTOMATİK eklenmedi (9)");
    let queue = await myQueue();
    const q1 = queue.find(i => i.orderNumber === O1 && i.lineId === "L1");
    const q3 = queue.find(i => i.orderNumber === O3 && i.lineId === "L3");
    assert(!!q1 && q1.state === "return_pending", "O1/L1 kuyrukta return_pending");
    assert(!!q3 && q3.state === "return_pending", "O3/L3 kuyrukta return_pending");
    assertEqual(q1!.claimStatus, "Accepted", "claim durumu Accepted gösterildi");
    assertEqual(q1!.claimReason, "Teslim edilemeyen gönderi", "iade sebebi gösterildi");
    assertEqual(q1!.claimQuantity, 2, "iade adedi 2 (multi-unit)");
    assertEqual(q1!.appliedDelta, -2, "stok etkisi düşülü kaldı (-2)");
    assert(!queue.some(i => i.orderNumber === O2), "O2 (henüz iadesiz) kuyrukta değil");

    step("Aynı claims TEKRAR → idempotent no-op...");
    const c2 = await syncClaims();
    assertEqual(c2.returnsRegistered, 0, "ikinci turda yeni kayıt yok");
    assertEqual(c2.alreadyPending, 2, "2 kalem zaten kuyrukta");
    assertEqual(await onHand(p1.id), 8, "P1 değişmedi (8)");

    step("CL3(O2/L2 Cancelled) → iade DEĞİL; O2/L2 counted kalır...");
    currentClaims = [
      claim("CL1", O1, [claimLine("L1", BC_A, ["Accepted", "Accepted"])]),
      claim("CL2", O3, [claimLine("L3", BC_C, ["Accepted"])]),
      claim("CL3", O2, [claimLine("L2", BC_B, ["Cancelled"])]),
    ];
    const c3 = await syncClaims();
    assertEqual(c3.inactiveClaims, 1, "CL3 iptal → inactive (1)");
    assertEqual(c3.returnsRegistered, 0, "iptal iade kuyruğa düşmez");
    assertEqual((await lineRow(O2, "L2"))!.state, "counted", "O2/L2 hâlâ counted");
    assert(!(await myQueue()).some(i => i.orderNumber === O2), "O2 kuyrukta değil");
    assertEqual(await onHand(p2.id), 7, "P2 değişmedi (7)");

    step("STICKY: orders tekrar (hepsi Created) → return_pending GERİ counted olmaz...");
    const rs = await syncOrders();
    assertEqual(rs.unitsDecremented, 0, "ikinci orders turunda düşüm yok");
    assertEqual(rs.unitsRestored, 0, "geri ekleme yok");
    assertEqual((await lineRow(O1, "L1"))!.state, "return_pending", "O1/L1 return_pending KALDI (sticky)");
    assertEqual((await lineRow(O3, "L3"))!.state, "return_pending", "O3/L3 return_pending KALDI (sticky)");
    assertEqual((await lineRow(O2, "L2"))!.state, "counted", "O2/L2 counted kaldı");
    assertEqual(await onHand(p1.id), 8, "P1 stok korunur (8)");
    assert((await myQueue()).filter(i => i.state === "return_pending").length === 2, "kuyrukta hâlâ 2 iade");

    step("Eşleşmeyen claim (phantom sipariş) → unlinked, çökmez...");
    currentClaims = [
      ...currentClaims,
      claim("CLPH", OPH, [claimLine("LPH", `${BC_A}_X`, ["Accepted"])]),
    ];
    const c4 = await syncClaims();
    assert(c4.unlinkedClaims >= 1, "phantom claim unlinked sayıldı");
    assertEqual(c4.returnsRegistered, 0, "phantom için kayıt yok");
    assert((await lineRow(OPH, "LPH")) === null, "phantom için defter satırı UYDURULMADI");

    step("Operatör: P1'i elle 10'a setStock + O1/L1 kalemini resolve...");
    await adjustProductStock({ productId: p1.id, newOnHand: 10, note: "iade malı sağlam, elle eklendi", actorUserId });
    assertEqual(await onHand(p1.id), 10, "P1 elle 10'a çıkarıldı");
    queue = await myQueue();
    const toResolve = queue.find(i => i.orderNumber === O1 && i.lineId === "L1")!;
    await resolveOrderReviewItem(toResolve.id, actorUserId);
    queue = await myQueue();
    assert(!queue.some(i => i.orderNumber === O1 && i.lineId === "L1"), "O1/L1 kuyruktan çıktı");
    assert(queue.some(i => i.orderNumber === O3 && i.lineId === "L3"), "O3/L3 kuyrukta kalır");

    step("Resolve sonrası claims sync iadeyi YENİDEN AÇMAZ (resolved_at korunur)...");
    const c5 = await syncClaims();
    assertEqual(c5.returnsRegistered, 0, "çözülmüş iade yeniden kaydedilmez");
    assert((await lineRow(O1, "L1"))!.resolved_at !== null, "O1/L1 resolved_at korunur (kuyruk dışı)");
    assert(!(await myQueue()).some(i => i.orderNumber === O1 && i.lineId === "L1"), "O1/L1 kuyruğa geri dönmedi");

    step("Flag KAPALI → claims sync reddetmeli...");
    await updateSettings({ marketplaceOrdersEnabled: false }, actorUserId);
    await assertRejects(() => syncClaims(), "MARKETPLACE_ORDERS_DISABLED", "flag kapalıyken claims sync engellenir");

    ok("\nSMOKE 30 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    try {
      await updateSettings({
        marketplaceOrdersEnabled: origOrders,
        marketplaceSyncEnabled: origSync,
        stockTrackingEnabled: origStock,
      });
    } catch { /* yut */ }
    // FK sırası: stock_movements.related_channel_order_line_id → channel_order_lines.
    if (productIds.length > 0) {
      await pool.query(`DELETE FROM stock_movements WHERE product_id = ANY($1::bigint[])`, [productIds]);
    }
    await pool.query(`DELETE FROM channel_order_lines WHERE order_number = ANY($1::text[])`, [orderNumbers]);
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
