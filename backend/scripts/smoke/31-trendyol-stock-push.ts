/**
 * SMOKE 31 — Trendyol stok PUSH (Model C / Faz 2, v1.6)
 *
 * Projenin EN RİSKLİ yolu: canlı TY listelerine STOK yazma. Ağ YOK: updateStock +
 * getBatchResult enjekte edilir (gerçek client ASLA çağrılmaz). Tüm kilitleri
 * doğrular:
 *   1) BASELINE INTERLOCK — baseline'sız listeye yazılmaz.
 *   2) DEVRE KESİCİ — kütlesel sıfırlama durur; force aşar.
 *   3) DRY-RUN — TY'ye çağrı YOK; yalnız plan loglanır; listing değişmez.
 *   5) STOK-ONLY — gönderilen kalem yalnız { barcode, quantity } (fiyat YOK).
 *   6) NEGATİF → 0 — eksi efektif stok 0 gönderir.
 *   7) DEĞİŞMEDİYSE PUSH YOK — change-only; başarı sonrası idempotent no-op.
 *   8) BATCH DOĞRULAMA — FAILED kalem başarı SAYILMAZ; last_pushed dokunulmaz (retry).
 *   9) BUNDLE KASKAD — türev efektif stok push'lanır; bileşen değişince yeniden.
 *  10) TEK-UÇUŞ — kilit tutulurken ikinci çalışma 'already_running'.
 *  12) KILL SWITCH — flag kapalı → STOCK_PUSH_DISABLED.
 *
 * Saf çekirdek: computeDesiredQuantity / isDangerousDrop / evaluateCircuitBreaker /
 * classifyBatchResult.
 *
 * ÇALIŞTIRMA: cd backend && npx tsx scripts/smoke/31-trendyol-stock-push.ts
 */

import { createProduct } from "../../src/services/products.service.js";
import { createChannelListing } from "../../src/services/channel-listings.service.js";
import { adjustProductStock } from "../../src/services/stock.service.js";
import { setBundle } from "../../src/services/bundle-components.service.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import {
  runStockPush,
  baselineChannelListings,
  getStockPushStatus,
  computeDesiredQuantity,
  isDangerousDrop,
  evaluateCircuitBreaker,
  classifyBatchResult,
  type PushPlanItem,
} from "../../src/services/trendyol/stock-push.service.js";
import type {
  TrendyolStockItem,
  TrendyolBatchSubmitResponse,
  TrendyolBatchResult,
} from "../../src/services/trendyol/client.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual, assertRejects, closePool, ok, getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const productIds: string[] = [];
  const externalIds: string[] = [];
  const stamp = Date.now().toString();
  const BC_A = `SMK31_A_${stamp}`, BC_B = `SMK31_B_${stamp}`, BC_C = `SMK31_C_${stamp}`;
  const BC_BUN = `SMK31_BUN_${stamp}`;

  const before = await getSettings();
  const orig = {
    stock: before.stockTrackingEnabled,
    sync: before.marketplaceSyncEnabled,
    orders: before.marketplaceOrdersEnabled,
    push: before.marketplaceStockPushEnabled,
    dry: before.marketplaceStockPushDryRun,
  };

  // ── Enjekte client (ağ yok) ───────────────────────────────────────────────
  let captured: TrendyolStockItem[][] = [];       // updateStock'a giden her chunk
  let lastSubmitted: TrendyolStockItem[] = [];
  let batchSeq = 0;
  let batchStatus = "COMPLETED";
  let failBarcodes = new Set<string>();
  let getBatchCalls = 0;

  const fakeUpdateStock = async (items: TrendyolStockItem[]): Promise<TrendyolBatchSubmitResponse> => {
    captured.push(items.map((i) => ({ ...i })));
    lastSubmitted = items.map((i) => ({ ...i }));
    return { batchRequestId: `B${++batchSeq}` };
  };
  const fakeGetBatchResult = async (batchId: string): Promise<TrendyolBatchResult> => {
    getBatchCalls += 1;
    if (batchStatus !== "COMPLETED") return { batchRequestId: batchId, status: batchStatus };
    const items = lastSubmitted.map((it) => ({
      requestItem: { barcode: it.barcode, quantity: it.quantity },
      status: failBarcodes.has(it.barcode) ? "FAILED" : "SUCCESS",
      failureReasons: failBarcodes.has(it.barcode) ? ["Ürün incelemede / kilitli"] : [],
    }));
    return {
      batchRequestId: batchId, status: "COMPLETED",
      itemCount: items.length, failedItemCount: items.filter((i) => i.status !== "SUCCESS").length, items,
    };
  };
  const deps = { updateStock: fakeUpdateStock, getBatchResult: fakeGetBatchResult };
  const resetCapture = () => { captured = []; getBatchCalls = 0; };

  // ── DB helper'ları ────────────────────────────────────────────────────────
  async function eff(productId: string): Promise<number> {
    const r = await pool.query<{ on_hand: number }>(
      `SELECT on_hand FROM v_product_effective_stock WHERE product_id = $1`, [productId]);
    return Number(r.rows[0]?.on_hand ?? NaN);
  }
  async function listing(externalId: string) {
    const r = await pool.query<{
      baselined_at: string | null; last_pushed_quantity: number | null;
      last_push_status: string | null; last_push_error: string | null;
    }>(
      `SELECT baselined_at, last_pushed_quantity, last_push_status, last_push_error
         FROM channel_listings WHERE channel='trendyol' AND external_id=$1`, [externalId]);
    return r.rows[0] ?? null;
  }
  async function logCount(result: string, externalId: string): Promise<number> {
    const r = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM channel_push_log WHERE result=$1 AND external_id=$2`, [result, externalId]);
    return Number(r.rows[0]?.n ?? 0);
  }
  async function seedSnapshot(externalId: string, qty: number): Promise<void> {
    await pool.query(
      `INSERT INTO channel_products (channel, external_id, title, quantity, synced_at)
       VALUES ('trendyol', $1, $2, $3, now())
       ON CONFLICT (channel, external_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [externalId, `SMK31 ${externalId}`, qty]);
  }
  function assertStockOnly(items: TrendyolStockItem[], label: string): void {
    const bad = items.find((i) => "salePrice" in i || "listPrice" in i);
    assert(!bad, `${label}: gönderilen kalemler STOK-ONLY (fiyat alanı yok)`);
  }

  try {
    section("SMOKE 31 — Trendyol stok PUSH (Faz 2)");
    const actorUserId = await getActorUserId();

    // ── PHASE A — saf çekirdek (DB/ağ yok) ───────────────────────────────────
    step("computeDesiredQuantity / isDangerousDrop / evaluateCircuitBreaker / classifyBatchResult...");
    assertEqual(computeDesiredQuantity(5), 5, "5 → 5");
    assertEqual(computeDesiredQuantity(-3), 0, "negatif → 0 (#6)");
    assertEqual(computeDesiredQuantity(0), 0, "0 → 0");
    assert(isDangerousDrop(10, 0) === true, "10→0 sıfırlama tehlikeli");
    assert(isDangerousDrop(10, 4) === true, "10→4 (>=%50, >=3 birim) tehlikeli");
    assert(isDangerousDrop(10, 6) === false, "10→6 (<%50) tehlikeli değil");
    assert(isDangerousDrop(9, 1) === true, "9→1 küçük stok neredeyse-tam düşüş tehlikeli (ölçek bağımsız)");
    assert(isDangerousDrop(2, 1) === false, "2→1 (<3 birim) küçük satış tehlikeli değil (gürültü değil)");
    assert(isDangerousDrop(3, 0) === true, "3→0 küçük sıfırlama tehlikeli");
    assert(isDangerousDrop(null, 0) === false, "referanssız (null) tehlikeli değil");
    assert(isDangerousDrop(5, 7) === false, "artış tehlikeli değil");

    const mkItem = (prev: number | null, desired: number): PushPlanItem => ({
      listingId: "x", productId: "x", externalId: "x", productName: null, isBundle: false,
      prev, effective: desired, desired, delta: prev === null ? null : desired - prev,
    });
    assert(evaluateCircuitBreaker(Array.from({ length: 6 }, () => mkItem(10, 0)), 0, 6, false).tripped,
      "6 tehlikeli düşüş > 5 → kesici tetiklenir");
    assert(evaluateCircuitBreaker([mkItem(10, 0)], 0, 3, false).tripped,
      "1/3 (%33) > %20 → kesici tetiklenir");
    assert(!evaluateCircuitBreaker([mkItem(10, 0)], 0, 10, false).tripped,
      "1/10 (%10) ve windowed<=5 → tetiklenmez");
    // PENCERE (trickle): bu tur az tehlikeli ama pencerede yakın tehlikeli düşüşler birikmiş.
    assert(evaluateCircuitBreaker([mkItem(80, 0), mkItem(80, 0)], 4, 100, false).tripped,
      "2 bu tur + 4 yakın = windowed 6 > 5 → kesici tetiklenir (self-clearing trickle yakalandı)");
    assert(!evaluateCircuitBreaker([mkItem(80, 0), mkItem(80, 0)], 2, 100, false).tripped,
      "2 + 2 = 4 <=5 ve düşük oran → tetiklenmez");
    assert(!evaluateCircuitBreaker(Array.from({ length: 6 }, () => mkItem(10, 0)), 9, 6, true).tripped,
      "force → asla tetiklenmez (pencere dolu olsa bile)");

    const cbAll = classifyBatchResult(
      { status: "COMPLETED", failedItemCount: 1, items: [
        { requestItem: { barcode: "x1" }, status: "SUCCESS" },
        { requestItem: { barcode: "x2" }, status: "FAILED", failureReasons: ["kilitli"] },
      ] }, ["x1", "x2", "x3"]);
    assertEqual(cbAll.get("x1")?.verdict, "success", "x1 SUCCESS");
    assertEqual(cbAll.get("x2")?.verdict, "failed", "x2 FAILED");
    assertEqual(cbAll.get("x3")?.verdict, "pending", "x3 sonuçta yok → pending (başarı UYDURULMAZ, retry)");
    const cbProc = classifyBatchResult({ status: "PROCESSING" }, ["x1"]);
    assertEqual(cbProc.get("x1")?.verdict, "pending", "PROCESSING → pending (200-submit başarı DEĞİL)");
    const cbClean = classifyBatchResult({ status: "COMPLETED", failedItemCount: 0, items: [] }, ["x1"]);
    assertEqual(cbClean.get("x1")?.verdict, "pending", "COMPLETED + boş items[] → pending (boş gövde başarı kanıtı DEĞİL)");

    // ── PHASE B — kurulum + baseline interlock + dry-run + change-only + live ──
    step("P1/P2/P3 + trendyol listing + snapshot (TY: 10/5/8); flag'ler aç (dry-run ON)...");
    const p1 = await createProduct({ name: "SMK31 A", price: "100.00", barcode: BC_A });
    const p2 = await createProduct({ name: "SMK31 B", price: "200.00", barcode: BC_B });
    const p3 = await createProduct({ name: "SMK31 C", price: "300.00", barcode: BC_C });
    productIds.push(p1.id, p2.id, p3.id);
    externalIds.push(BC_A, BC_B, BC_C);
    // Kapsam: tüm reconcile çağrılarını KENDİ ürünlerimize izole et (paylaşımlı dev
    // DB'de gerçek katalog listeleri push'a karışmasın).
    const SCOPE = [p1.id, p2.id, p3.id];
    await updateSettings({ stockTrackingEnabled: true, marketplaceSyncEnabled: true,
      marketplaceStockPushEnabled: true, marketplaceStockPushDryRun: true }, actorUserId);
    await createChannelListing(p1.id, { channel: "trendyol", externalId: BC_A, actorUserId });
    await createChannelListing(p2.id, { channel: "trendyol", externalId: BC_B, actorUserId });
    await createChannelListing(p3.id, { channel: "trendyol", externalId: BC_C, actorUserId });
    await seedSnapshot(BC_A, 10); await seedSnapshot(BC_B, 5); await seedSnapshot(BC_C, 8);

    step("BASELINE INTERLOCK: baseline ÖNCESİ push baseline'sızları ATLAR, TY'ye yazmaz...");
    resetCapture();
    const r0 = await runStockPush({ deps, scopeProductIds: SCOPE });
    assertEqual(r0.skipped.notBaselined, 3, "3 liste baseline'sız → atlandı");
    assertEqual(r0.changedCount, 0, "değişen yok (hepsi eligible dışı)");
    assertEqual(captured.length, 0, "updateStock HİÇ çağrılmadı (#1)");

    step("Baseline al → iç açılış stoğu = TY adedi; last_pushed = TY adedi...");
    const b1 = await baselineChannelListings({ actorUserId, productIds: SCOPE });
    assertEqual(b1.baselined, 3, "3 liste baseline'landı");
    assertEqual(b1.seeded, 3, "3 basit ürün iç stoğu TY adediyle tohumlandı");
    assertEqual(await eff(p1.id), 10, "P1 iç efektif 10 (TY adedi)");
    assertEqual(await eff(p2.id), 5, "P2 iç efektif 5");
    assertEqual(await eff(p3.id), 8, "P3 iç efektif 8");
    assertEqual((await listing(BC_A))!.last_pushed_quantity, 10, "P1 last_pushed=10");

    step("Baseline sonrası DOĞRULAMA: kendi ürünlerimiz için ~0 değişiklik (iç == TY)...");
    // getStockPushStatus özetleri GLOBAL (tüm katalog); kendi ürünlerimizin
    // değişmediğini önizlemede OLMAMALARI + scoped reconcile no-op ile kanıtlarız.
    const st1 = await getStockPushStatus();
    assert(st1.summary.baselined >= 3, "en az 3 baseline'lı (global özet)");
    assert(!st1.preview.some((i) => [BC_A, BC_B, BC_C].includes(i.externalId)),
      "kendi ürünlerimiz push önizlemesinde YOK (baseline doğru → 0 değişiklik)");
    resetCapture();
    const r1 = await runStockPush({ deps, scopeProductIds: SCOPE });
    assertEqual(r1.mode, "noop", "baseline sonrası reconcile no-op");
    assertEqual(captured.length, 0, "updateStock çağrılmadı");

    step("DRY-RUN: P1 satıldı (10→8) → plan gösterir ama TY'ye YAZMAZ...");
    await adjustProductStock({ productId: p1.id, newOnHand: 8, note: "POS satış", actorUserId });
    resetCapture();
    const r2 = await runStockPush({ deps, scopeProductIds: SCOPE });
    assertEqual(r2.mode, "dry_run", "dry-run modu");
    assertEqual(r2.changedCount, 1, "1 kalem değişti (P1)");
    assertEqual(r2.items[0].desired, 8, "P1 desired 8");
    assertEqual(r2.items[0].delta, -2, "delta -2");
    assertEqual(captured.length, 0, "DRY-RUN: updateStock çağrılmadı (#3)");
    assertEqual((await listing(BC_A))!.last_pushed_quantity, 10, "DRY-RUN: last_pushed DEĞİŞMEDİ (hâlâ 10)");
    assert((await logCount("planned", BC_A)) >= 1, "channel_push_log 'planned' yazıldı");

    step("CANLI: dry-run kapat → change-only P1 8 push'lanır (STOK-ONLY)...");
    await updateSettings({ marketplaceStockPushDryRun: false }, actorUserId);
    batchStatus = "COMPLETED"; failBarcodes = new Set();
    resetCapture();
    const r3 = await runStockPush({ deps, scopeProductIds: SCOPE });
    assertEqual(r3.mode, "live", "canlı mod");
    assertEqual(r3.pushedCount, 1, "1 başarılı");
    assertEqual(r3.failedCount, 0, "0 başarısız");
    assertEqual(captured.length, 1, "tek updateStock çağrısı");
    assertEqual(captured[0].length, 1, "tek kalem (yalnız P1 değişti)");
    assertEqual(captured[0][0].barcode, BC_A, "barkod BC_A");
    assertEqual(captured[0][0].quantity, 8, "gönderilen adet 8");
    assertStockOnly(captured[0], "P1 push");
    assert(getBatchCalls >= 1, "batch sonucu DOĞRULANDI (#8)");
    assertEqual((await listing(BC_A))!.last_pushed_quantity, 8, "last_pushed güncellendi → 8");
    assertEqual((await listing(BC_A))!.last_push_status, "success", "durum success");

    step("CHANGE-ONLY idempotent: tekrar push → no-op (TY spam'lenmez #7)...");
    resetCapture();
    const r4 = await runStockPush({ deps, scopeProductIds: SCOPE });
    assertEqual(r4.mode, "noop", "değişiklik yok → no-op");
    assertEqual(captured.length, 0, "updateStock çağrılmadı");

    // ── PHASE C — NEGATİF → 0 (tek-ürün canlı; kesici atlanır) ────────────────
    step("NEGATİF → 0: P2 efektif -2 → tek-ürün canlı push 0 gönderir...");
    await adjustProductStock({ productId: p2.id, newOnHand: -2, note: "fazla satış", actorUserId });
    assertEqual(await eff(p2.id), -2, "P2 efektif -2");
    resetCapture();
    const r5 = await runStockPush({ deps, onlyProductId: p2.id });
    assertEqual(r5.mode, "live", "tek-ürün canlı");
    assertEqual(captured.length, 1, "tek updateStock");
    assertEqual(captured[0][0].quantity, 0, "NEGATİF stok 0 gönderildi (#6), asla -2");
    assertEqual((await listing(BC_B))!.last_pushed_quantity, 0, "P2 last_pushed=0");

    // ── PHASE D — DEVRE KESİCİ ────────────────────────────────────────────────
    step("DEVRE KESİCİ: P1+P3'ü 0'a düşür (2/3 tehlikeli) → reconcile DURUR...");
    await adjustProductStock({ productId: p1.id, newOnHand: 0, note: "stok bitti", actorUserId });
    await adjustProductStock({ productId: p3.id, newOnHand: 0, note: "stok bitti", actorUserId });
    resetCapture();
    const r6 = await runStockPush({ deps, scopeProductIds: SCOPE });
    assertEqual(r6.mode, "breaker_tripped", "kütlesel sıfırlama → DURDU (#2)");
    assert((r6.breaker?.dangerousCount ?? 0) >= 2, "en az 2 tehlikeli düşüş sayıldı");
    assertEqual(captured.length, 0, "DURDU → updateStock çağrılmadı");
    assert((await logCount("skipped_breaker", BC_A)) >= 1, "channel_push_log 'skipped_breaker' yazıldı");
    assertEqual((await listing(BC_A))!.last_pushed_quantity, 8, "P1 last_pushed DEĞİŞMEDİ (8)");

    step("force ile kesici aşılır → P1/P3 0'a push'lanır...");
    resetCapture();
    const r7 = await runStockPush({ deps, force: true, scopeProductIds: SCOPE });
    assertEqual(r7.mode, "live", "force → canlı");
    assertEqual(r7.pushedCount, 2, "2 kalem (P1+P3) push'landı");
    const allBarcodes = captured.flat().map((i) => i.barcode);
    assert(allBarcodes.includes(BC_A) && allBarcodes.includes(BC_C), "P1 ve P3 gönderildi");
    assertEqual((await listing(BC_A))!.last_pushed_quantity, 0, "P1 last_pushed=0");
    assertEqual((await listing(BC_C))!.last_pushed_quantity, 0, "P3 last_pushed=0");

    // ── PHASE E — BATCH-FAIL (200-submit ≠ başarı) ────────────────────────────
    step("BATCH-FAIL: P1 5'e çıkar; batch FAILED → last_pushed DOKUNULMAZ (retry)...");
    await adjustProductStock({ productId: p1.id, newOnHand: 5, note: "tedarik", actorUserId });
    failBarcodes = new Set([BC_A]);
    resetCapture();
    const r8 = await runStockPush({ deps, scopeProductIds: SCOPE });
    assertEqual(r8.mode, "live", "canlı (P1 5>0, tehlikeli değil)");
    assertEqual(r8.failedCount, 1, "1 başarısız");
    assertEqual(r8.pushedCount, 0, "0 başarılı (FAILED başarı SAYILMAZ #8)");
    assertEqual((await listing(BC_A))!.last_pushed_quantity, 0, "last_pushed DEĞİŞMEDİ (0) → retry");
    assertEqual((await listing(BC_A))!.last_push_status, "failed", "durum failed");
    assert(!!(await listing(BC_A))!.last_push_error, "hata mesajı kaydedildi (görünür)");
    const stErr = await getStockPushStatus();
    assert(stErr.errors.some((e) => e.externalId === BC_A), "push hataları görünümünde P1");

    step("Hata düzelince retry başarılı olur → last_pushed=5...");
    failBarcodes = new Set();
    resetCapture();
    const r9 = await runStockPush({ deps, scopeProductIds: SCOPE });
    assertEqual(r9.pushedCount, 1, "retry başarılı");
    assertEqual((await listing(BC_A))!.last_pushed_quantity, 5, "last_pushed=5");
    assertEqual((await listing(BC_A))!.last_push_status, "success", "durum success");
    assert(!(await listing(BC_A))!.last_push_error, "hata temizlendi");

    // ── PHASE F — BUNDLE KASKAD ───────────────────────────────────────────────
    step("Bundle PB(C1×1, C2×2) + listing + snapshot(TY 3); bileşen stoğu 10/10...");
    const pc1 = await createProduct({ name: "SMK31 Bileşen1", price: "10.00", barcode: `${BC_BUN}_c1` });
    const pc2 = await createProduct({ name: "SMK31 Bileşen2", price: "10.00", barcode: `${BC_BUN}_c2` });
    const pb = await createProduct({ name: "SMK31 Paket", price: "50.00", barcode: BC_BUN });
    productIds.push(pc1.id, pc2.id, pb.id);
    externalIds.push(BC_BUN);
    await adjustProductStock({ productId: pc1.id, newOnHand: 10, note: "açılış", actorUserId });
    await adjustProductStock({ productId: pc2.id, newOnHand: 10, note: "açılış", actorUserId });
    await setBundle(pb.id, [{ productId: pc1.id, quantity: 1 }, { productId: pc2.id, quantity: 2 }], actorUserId);
    await createChannelListing(pb.id, { channel: "trendyol", externalId: BC_BUN, actorUserId });
    await seedSnapshot(BC_BUN, 3);
    assertEqual(await eff(pb.id), 5, "PB türev efektif = min(10, floor(10/2)) = 5");

    step("Bundle baseline (seed YOK, last_pushed=TY 3) sonra canlı push → türev 5...");
    const b2 = await baselineChannelListings({ actorUserId, productIds: [pb.id] });
    assertEqual(b2.baselined, 1, "yalnız PB baseline'landı (diğerleri zaten)");
    assertEqual(b2.seeded, 0, "bundle iç stoğu seed EDİLMEDİ (türev)");
    assertEqual((await listing(BC_BUN))!.last_pushed_quantity, 3, "PB last_pushed=TY 3");
    resetCapture();
    const r10 = await runStockPush({ deps, onlyProductId: pb.id });
    assertEqual(r10.pushedCount, 1, "PB push'landı");
    assertEqual(captured[0][0].quantity, 5, "PB türev efektif 5 gönderildi");
    assertEqual((await listing(BC_BUN))!.last_pushed_quantity, 5, "PB last_pushed=5");

    step("KASKAD: bileşen C2 10→4 → türev 5→2; reconcile bundle'ı yeniden push'lar...");
    await adjustProductStock({ productId: pc2.id, newOnHand: 4, note: "bileşen satış", actorUserId });
    assertEqual(await eff(pb.id), 2, "PB türev = min(10, floor(4/2)=2) = 2");
    resetCapture();
    const r11 = await runStockPush({ deps, onlyProductId: pb.id });
    assertEqual(r11.pushedCount, 1, "bileşen değişimi bundle push'unu tetikledi (#9)");
    assertEqual(captured[0][0].quantity, 2, "yeni türev 2 gönderildi");
    assertEqual((await listing(BC_BUN))!.last_pushed_quantity, 2, "PB last_pushed=2");

    // ── PHASE G — TEK-UÇUŞ (single-flight) ────────────────────────────────────
    step("TEK-UÇUŞ: kilit dışarıdan tutulurken push 'already_running' döner...");
    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext($1))", ["trendyol_stock_push"]);
      resetCapture();
      const r12 = await runStockPush({ deps, scopeProductIds: SCOPE });
      assertEqual(r12.mode, "already_running", "kilit meşgul → atlandı (#10)");
      assertEqual(captured.length, 0, "updateStock çağrılmadı");
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext($1))", ["trendyol_stock_push"]);
      holder.release();
    }

    // ── PHASE H — KILL SWITCH ─────────────────────────────────────────────────
    step("KILL SWITCH: push flag kapalı → STOCK_PUSH_DISABLED...");
    await updateSettings({ marketplaceStockPushEnabled: false }, actorUserId);
    await assertRejects(() => runStockPush({ deps }), "STOCK_PUSH_DISABLED", "flag kapalıyken push engellenir");

    ok("\nSMOKE 31 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    try {
      await updateSettings({
        stockTrackingEnabled: orig.stock, marketplaceSyncEnabled: orig.sync,
        marketplaceOrdersEnabled: orig.orders, marketplaceStockPushEnabled: orig.push,
        marketplaceStockPushDryRun: orig.dry,
      });
    } catch { /* yut */ }
    // FK sırası: push_log (SET NULL) → bundle_components/stock_movements → listings → products.
    if (externalIds.length > 0) {
      await pool.query(`DELETE FROM channel_push_log WHERE external_id = ANY($1::text[])`, [externalIds]);
      await pool.query(`DELETE FROM channel_products WHERE external_id = ANY($1::text[])`, [externalIds]);
    }
    if (productIds.length > 0) {
      await pool.query(`DELETE FROM bundle_components WHERE bundle_product_id = ANY($1::bigint[]) OR component_product_id = ANY($1::bigint[])`, [productIds]);
      await pool.query(`DELETE FROM stock_movements WHERE product_id = ANY($1::bigint[])`, [productIds]);
      await pool.query(`DELETE FROM channel_listings WHERE product_id = ANY($1::bigint[])`, [productIds]);
      await pool.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [productIds]);
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
