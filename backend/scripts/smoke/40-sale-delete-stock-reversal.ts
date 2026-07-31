/**
 * SMOKE 40 — Ürün satışı silmede stok iadesi (v1.7, sale_cancel telafi hareketi)
 *
 * Tasarım kanıtı: ters-kayıt defteri GERİ OKUR (explodeStockDeltas'ı yeniden
 * çağırmaz). En kritik iki senaryo D ve F — bunlar geçmeden bu iş bitmiş sayılmaz.
 *
 * Senaryolar:
 *   A. Flag açık, basit ürün satışı → on_hand düştü.
 *   B. Satışı sil → on_hand geri geldi + SUM(delta) WHERE related_sale_id = 0.
 *   C. Bundle satışı → sil → bileşenler geri geldi (bundle'ın kendine hareket yok).
 *   D. Bundle bileşimi satıştan SONRA değişti → sil → ESKİ deltalar geri geldi.
 *   E. Flag KAPALIYKEN yapılmış satış → sil → hareket yok, hata yok (no-op).
 *   F. Flag açıkken satış → flag KAPATILDI → sil → yine geri geldi (flag-bağımsız).
 *   G. Ödemesi olan satış → sil → 409 DELETE_CONFLICT, stok DEĞİŞMEDİ.
 *   H. Legacy/serbest satış (katalog kalemi yok) → sil → no-op.
 *   I. Audit: product_sale_deleted var; iade ayrı stok audit'i YAZMAZ.
 *   J. Stok hareketi olan satışlı öğrenciyi kalıcı sil → FK patlamadı; hareketler
 *      related_sale_id IS NULL ile durur; on_hand DEĞİŞMEDİ (0261 FK SET NULL).
 *
 * ÇALIŞTIRMA: cd backend && npx tsx scripts/smoke/40-sale-delete-stock-reversal.ts
 */

import { createStudent, hardDeleteStudent } from "../../src/services/students.service.js";
import { createProduct, getProductById } from "../../src/services/products.service.js";
import {
  createProductSale,
  softDeleteProductSale,
} from "../../src/services/product-sales.service.js";
import { createCashPayment } from "../../src/services/payments.service.js";
import { adjustProductStock } from "../../src/services/stock.service.js";
import { setBundle } from "../../src/services/bundle-components.service.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual, assertRejects,
  cleanupSmoke, closePool, ok, getActorUserId, assertAuditLog,
} from "./_shared.js";

async function onHand(productId: string): Promise<number> {
  const p = await getProductById(productId);
  return Number(p.on_hand ?? 0);
}

async function eff(productId: string): Promise<number> {
  const r = await pool.query<{ on_hand: number }>(
    `SELECT on_hand FROM v_product_effective_stock WHERE product_id = $1`, [productId],
  );
  return Number(r.rows[0]?.on_hand ?? NaN);
}

async function ledgerSum(saleId: string): Promise<number> {
  const r = await pool.query<{ s: string }>(
    `SELECT COALESCE(SUM(delta), 0)::text AS s FROM stock_movements WHERE related_sale_id = $1`,
    [saleId],
  );
  return Number(r.rows[0].s);
}

async function auditCount(action: string, entityId: string): Promise<number> {
  const r = await pool.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM audit_logs WHERE action = $1 AND entity_id = $2`,
    [action, entityId],
  );
  return Number(r.rows[0].c);
}

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const productIds: string[] = [];
  const stamp = Date.now().toString();

  const before = await getSettings();
  const origStock = before.stockTrackingEnabled;

  try {
    section("SMOKE 40 — Ürün satışı silmede stok iadesi");
    const actorUserId = await getActorUserId();

    await updateSettings({ stockTrackingEnabled: true }, actorUserId);

    // ── A + B: basit ürün satışı → sil → geri gel ────────────────────────────
    section("A/B — Basit ürün: sat → on_hand düştü → sil → geri geldi");
    const pA = await createProduct({ name: "SMK40 Mum", price: "100.00", barcode: `SMK40A_${stamp}` });
    productIds.push(pA.id);
    await adjustProductStock({ productId: pA.id, newOnHand: 10, note: "açılış", actorUserId });

    const sA = await createStudent({ fullName: "SMK40_A", phone: "+90 555 040 0001" });
    studentIds.push(sA.id);
    const saleA = await createProductSale({
      studentId: sA.id, soldAt: new Date().toISOString(),
      items: [{ productId: Number(pA.id), quantity: 3 }], actorUserId,
    });
    assertEqual(await onHand(pA.id), 7, "A: satış sonrası on_hand=7");

    await softDeleteProductSale(saleA.id, actorUserId);
    assertEqual(await onHand(pA.id), 10, "B: silme sonrası on_hand geri=10");
    assertEqual(await ledgerSum(saleA.id), 0, "B: SUM(delta) WHERE related_sale_id = 0 (tam ters)");

    // ── C: bundle satışı → sil → bileşenler geri ─────────────────────────────
    section("C — Bundle: sat → sil → bileşenler geri, bundle'a hareket yok");
    const c1 = await createProduct({ name: "SMK40 C1", price: "50.00" });
    const c2 = await createProduct({ name: "SMK40 C2", price: "30.00" });
    productIds.push(c1.id, c2.id);
    await adjustProductStock({ productId: c1.id, newOnHand: 10, note: "açılış", actorUserId });
    await adjustProductStock({ productId: c2.id, newOnHand: 6, note: "açılış", actorUserId });
    const bC = await createProduct({ name: "SMK40 Paket C", price: "200.00", barcode: `SMK40C_${stamp}` });
    productIds.push(bC.id);
    await setBundle(bC.id, [{ productId: c1.id, quantity: 1 }, { productId: c2.id, quantity: 2 }], actorUserId);

    const sC = await createStudent({ fullName: "SMK40_C", phone: "+90 555 040 0002" });
    studentIds.push(sC.id);
    const saleC = await createProductSale({
      studentId: sC.id, soldAt: new Date().toISOString(),
      items: [{ productId: Number(bC.id), quantity: 2 }], actorUserId,
    });
    assertEqual(await eff(c1.id), 8, "C: satış C1 10→8");
    assertEqual(await eff(c2.id), 2, "C: satış C2 6→2");
    // Bundle'ın kendisine 'sale' hareketi yazılmamalı.
    const bundleMoves = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM stock_movements WHERE product_id = $1`, [bC.id],
    );
    assertEqual(Number(bundleMoves.rows[0].c), 0, "C: bundle product_id'sine hiç hareket yok");

    await softDeleteProductSale(saleC.id, actorUserId);
    assertEqual(await eff(c1.id), 10, "C: silme C1 geri=10");
    assertEqual(await eff(c2.id), 6, "C: silme C2 geri=6");
    assertEqual(await ledgerSum(saleC.id), 0, "C: bileşen deltaları toplamı 0");

    // ── D: bileşim satıştan SONRA değişti → sil → ESKİ deltalar geri ─────────
    section("D — Bileşim değişti → sil → ESKİ deltalar (geri-okumanın kanıtı)");
    const d1 = await createProduct({ name: "SMK40 D1", price: "50.00" });
    const d2 = await createProduct({ name: "SMK40 D2", price: "30.00" });
    productIds.push(d1.id, d2.id);
    await adjustProductStock({ productId: d1.id, newOnHand: 10, note: "açılış", actorUserId });
    await adjustProductStock({ productId: d2.id, newOnHand: 6, note: "açılış", actorUserId });
    const bD = await createProduct({ name: "SMK40 Paket D", price: "200.00", barcode: `SMK40D_${stamp}` });
    productIds.push(bD.id);
    await setBundle(bD.id, [{ productId: d1.id, quantity: 1 }, { productId: d2.id, quantity: 2 }], actorUserId);

    const sD = await createStudent({ fullName: "SMK40_D", phone: "+90 555 040 0003" });
    studentIds.push(sD.id);
    const saleD = await createProductSale({
      studentId: sD.id, soldAt: new Date().toISOString(),
      items: [{ productId: Number(bD.id), quantity: 2 }], actorUserId,
    });
    // Satış anındaki gerçek deltalar: D1 -2, D2 -4. D1 10→8, D2 6→2.
    assertEqual(await eff(d1.id), 8, "D: satış D1 10→8");
    assertEqual(await eff(d2.id), 2, "D: satış D2 6→2");

    // Bileşimi DEĞİŞTİR: artık B sadece [D1×5]. (POS satışı counted TY siparişi
    // olmadığı için setBundle serbest.)
    await setBundle(bD.id, [{ productId: d1.id, quantity: 5 }], actorUserId);

    await softDeleteProductSale(saleD.id, actorUserId);
    // Geri-okuma ESKİ deltaları (D1+2, D2+4) yazar → açılışa döner.
    // Yeniden patlatma olsaydı D1+10 (=18, YANLIŞ) yazar, D2'ye hiç dokunmazdı (=2).
    assertEqual(await eff(d1.id), 10, "D: silme D1 geri=10 (yeniden patlatma olsa 18 olurdu)");
    assertEqual(await eff(d2.id), 6, "D: silme D2 geri=6 (yeniden patlatma olsa 2 kalırdı)");
    assertEqual(await ledgerSum(saleD.id), 0, "D: toplam 0");

    // ── E: flag KAPALIYKEN satış → sil → no-op ──────────────────────────────
    section("E — Flag kapalıyken satış → sil → hareket yok, hata yok");
    const pE = await createProduct({ name: "SMK40 E", price: "100.00", barcode: `SMK40E_${stamp}` });
    productIds.push(pE.id);
    await adjustProductStock({ productId: pE.id, newOnHand: 5, note: "açılış", actorUserId });
    await updateSettings({ stockTrackingEnabled: false }, actorUserId);
    const sE = await createStudent({ fullName: "SMK40_E", phone: "+90 555 040 0004" });
    studentIds.push(sE.id);
    const saleE = await createProductSale({
      studentId: sE.id, soldAt: new Date().toISOString(),
      items: [{ productId: Number(pE.id), quantity: 3 }], actorUserId,
    });
    assertEqual(await onHand(pE.id), 5, "E: flag kapalı, satış on_hand'i değiştirmedi (5)");
    await softDeleteProductSale(saleE.id, actorUserId); // no-op, atmamalı
    assertEqual(await onHand(pE.id), 5, "E: silme no-op, on_hand sabit (5)");
    assertEqual(await ledgerSum(saleE.id), 0, "E: hiç hareket yok (0)");
    await updateSettings({ stockTrackingEnabled: true }, actorUserId);

    // ── F: flag açıkken satış → flag KAPAT → sil → yine geri (flag-bağımsız) ──
    section("F — Flag açıkken satış → flag KAPAT → sil → yine geri geldi");
    const pF = await createProduct({ name: "SMK40 F", price: "100.00", barcode: `SMK40F_${stamp}` });
    productIds.push(pF.id);
    await adjustProductStock({ productId: pF.id, newOnHand: 10, note: "açılış", actorUserId });
    const sF = await createStudent({ fullName: "SMK40_F", phone: "+90 555 040 0005" });
    studentIds.push(sF.id);
    const saleF = await createProductSale({
      studentId: sF.id, soldAt: new Date().toISOString(),
      items: [{ productId: Number(pF.id), quantity: 3 }], actorUserId,
    });
    assertEqual(await onHand(pF.id), 7, "F: satış (flag açık) on_hand=7");
    await updateSettings({ stockTrackingEnabled: false }, actorUserId); // flag KAPAT
    await softDeleteProductSale(saleF.id, actorUserId);
    assertEqual(await onHand(pF.id), 10, "F: flag kapalı olsa da iade çalıştı, on_hand=10");
    assertEqual(await ledgerSum(saleF.id), 0, "F: toplam 0");
    await updateSettings({ stockTrackingEnabled: true }, actorUserId);

    // ── G: ödemesi olan satış → sil → 409, stok değişmedi ────────────────────
    section("G — Ödemeli satış → sil → DELETE_CONFLICT, stok DEĞİŞMEDİ");
    const pG = await createProduct({ name: "SMK40 G", price: "100.00", barcode: `SMK40G_${stamp}` });
    productIds.push(pG.id);
    await adjustProductStock({ productId: pG.id, newOnHand: 10, note: "açılış", actorUserId });
    const sG = await createStudent({ fullName: "SMK40_G", phone: "+90 555 040 0006" });
    studentIds.push(sG.id);
    const saleG = await createProductSale({
      studentId: sG.id, soldAt: new Date().toISOString(),
      items: [{ productId: Number(pG.id), quantity: 2 }], actorUserId,
    });
    assertEqual(await onHand(pG.id), 8, "G: satış on_hand=8");
    await createCashPayment({
      targetType: "product_sale", targetId: saleG.id,
      amount: "100", source: "iban", paidAt: new Date().toISOString(), actorUserId,
    });
    await assertRejects(
      () => softDeleteProductSale(saleG.id, actorUserId),
      "DELETE_CONFLICT", "G: ödemeli satış silinemez",
    );
    assertEqual(await onHand(pG.id), 8, "G: red sonrası stok değişmedi (8)");

    // ── H: legacy satış (katalog kalemi yok) → sil → no-op ───────────────────
    section("H — Legacy satış (items yok) → sil → no-op");
    const sH = await createStudent({ fullName: "SMK40_H", phone: "+90 555 040 0007" });
    studentIds.push(sH.id);
    const saleH = await createProductSale({
      studentId: sH.id, soldAt: new Date().toISOString(), totalAmount: "150", note: "legacy",
    });
    await softDeleteProductSale(saleH.id, actorUserId); // atmamalı
    assertEqual(await ledgerSum(saleH.id), 0, "H: legacy satışta hiç hareket yok (0)");

    // ── I: audit — product_sale_deleted var, ayrı stok audit'i yok ──────────
    section("I — Audit: product_sale_deleted var, iade ayrı audit yazmaz");
    await assertAuditLog({
      action: "product_sale_deleted",
      entityType: "product_sale",
      entityId: saleA.id,
      expectActorUserId: actorUserId,
    });
    // saleA silinince pA için yeni bir stock_adjusted audit'i OLUŞMAMALI (yalnız
    // açılış stoğunun stock_adjusted'ı olmalı = 1). Ters-kayıt audit yazmaz.
    assertEqual(await auditCount("stock_adjusted", pA.id), 1,
      "I: iade ayrı stock_adjusted audit'i yazmadı (yalnız açılış = 1)");

    // ── J: stok hareketli satışlı öğrenciyi kalıcı sil → FK patlamamalı ──────
    section("J — hardDeleteStudent (FK SET NULL): patlamadı, hareketler durdu");
    const pJ = await createProduct({ name: "SMK40 J", price: "100.00", barcode: `SMK40J_${stamp}` });
    productIds.push(pJ.id);
    await adjustProductStock({ productId: pJ.id, newOnHand: 10, note: "açılış", actorUserId });
    const sJ = await createStudent({ fullName: "SMK40_J", phone: "+90 555 040 0008" });
    const saleJ = await createProductSale({
      studentId: sJ.id, soldAt: new Date().toISOString(),
      items: [{ productId: Number(pJ.id), quantity: 3 }], actorUserId,
    });
    assertEqual(await onHand(pJ.id), 7, "J: satış on_hand=7");
    // FK NO ACTION olsaydı bu satır foreign_key_violation atardı.
    await hardDeleteStudent(sJ.id, actorUserId);
    // Hareketler defterde kalır, bağ null'lanır; on_hand değişmez.
    assertEqual(await onHand(pJ.id), 7, "J: kalıcı silme sonrası on_hand sabit (7)");
    const orphan = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM stock_movements WHERE related_sale_id = $1`, [saleJ.id],
    );
    assertEqual(Number(orphan.rows[0].c), 0, "J: satışa bağlı hareket kalmadı (related_sale_id null'landı)");
    const nulled = await pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM stock_movements WHERE product_id = $1 AND related_sale_id IS NULL AND type = 'sale'`,
      [pJ.id],
    );
    assert(Number(nulled.rows[0].c) >= 1, "J: hareketler related_sale_id IS NULL ile durdu");

    ok("\nSMOKE 40 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    try {
      await updateSettings({ stockTrackingEnabled: origStock });
    } catch { /* yut */ }
    await cleanupSmoke(studentIds); // J öğrencisi zaten hard-delete → no-op
    if (productIds.length > 0) {
      await pool.query(`UPDATE product_sale_items SET product_id = NULL WHERE product_id = ANY($1::bigint[])`, [productIds]);
      await pool.query(`DELETE FROM stock_movements WHERE product_id = ANY($1::bigint[])`, [productIds]);
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
