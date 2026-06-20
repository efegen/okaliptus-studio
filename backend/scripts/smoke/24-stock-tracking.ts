/**
 * SMOKE 24 — Dahili Stok Takibi (v1.6, yalnızca elden / POS satış)
 *
 * Senaryo:
 *   1. Stok takibi flag'i KAPALIYKEN satış stok hareketi YAZMAMALI.
 *   2. Flag'i aç (updateSettings stockTrackingEnabled=true).
 *   3. Açılış stoğu gir (setStock → on_hand=10), 'stock_adjusted' audit'i yazılmalı.
 *   4. Satış (3 adet) → on_hand=7, stok için AYRI audit yazılmamalı (satışınki var).
 *   5. Elle düzeltme (setStock → on_hand mutlak 5), audit before/after doğru.
 *   6. No-op düzeltme (aynı değeri set et) → yeni hareket YAZILMAMALI.
 *   7. Yetersiz stok satışı ENGELLENMEMELİ: 8 adet sat → on_hand=-3 (eksiye düşer).
 *   8. Flag'i KAPAT → satış tekrar stok hareketi yazmamalı (on_hand sabit kalır).
 *
 * CLEANUP: flag false'a döndürülür; öğrenci/satış cleanupSmoke ile; stock_movements
 * + product hard-delete finally'de.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/24-stock-tracking.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createProduct, getProductById } from "../../src/services/products.service.js";
import { createProductSale } from "../../src/services/product-sales.service.js";
import { adjustProductStock } from "../../src/services/stock.service.js";
import { getSettings, updateSettings } from "../../src/services/settings.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual,
  cleanupSmoke, closePool, ok, getActorUserId, assertAuditLog,
} from "./_shared.js";

async function onHand(productId: string): Promise<number> {
  const p = await getProductById(productId);
  return Number(p.on_hand ?? 0);
}

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const productIds: string[] = [];
  const stamp = Date.now().toString();

  // Test öncesi flag durumunu sakla, sonda geri yükle.
  const before = await getSettings();
  const originalFlag = before.stockTrackingEnabled;

  try {
    section("SMOKE 24 — Dahili Stok Takibi");

    const actorUserId = await getActorUserId();

    step("Ürün + öğrenci oluşturuluyor...");
    const product = await createProduct({
      name: "SMOKE_Stok Mum",
      price: "100.00",
      barcode: `SMOKE24_${stamp}`,
    });
    productIds.push(product.id);
    info("product.id", product.id);

    const student = await createStudent({
      fullName: "SMOKE_Student_24",
      phone: "+90 555 024 0001",
    });
    studentIds.push(student.id);

    // ── 1. Flag KAPALI iken satış stok hareketi yazmamalı ────────────────────
    step("Flag KAPALI: önce kapalı olduğundan emin ol, sonra satış yap...");
    await updateSettings({ stockTrackingEnabled: false }, actorUserId);
    await createProductSale({
      studentId: student.id,
      soldAt: new Date().toISOString(),
      items: [{ productId: Number(product.id), quantity: 1 }],
    });
    assertEqual(await onHand(product.id), 0, "Flag kapalıyken satış on_hand'i değiştirmemeli (0)");

    // ── 2. Flag'i aç ─────────────────────────────────────────────────────────
    step("Stok takibi flag'i açılıyor...");
    const enabled = await updateSettings({ stockTrackingEnabled: true }, actorUserId);
    assert(enabled.stockTrackingEnabled === true, "stockTrackingEnabled = true");

    // ── 3. Açılış stoğu ──────────────────────────────────────────────────────
    step("Açılış stoğu giriliyor (on_hand=10)...");
    const r1 = await adjustProductStock({ productId: product.id, newOnHand: 10, actorUserId });
    assertEqual(r1.on_hand, 10, "setStock dönüşü on_hand=10");
    assertEqual(await onHand(product.id), 10, "v_product_stock on_hand=10");
    await assertAuditLog({
      action: "stock_adjusted",
      entityType: "product",
      entityId: product.id,
      expectActorUserId: actorUserId,
      expectBeforeContains: { on_hand: 0 },
      expectAfterContains: { on_hand: 10 },
    });

    // ── 4. Satış 3 adet → on_hand=7 ──────────────────────────────────────────
    step("3 adet satış yapılıyor → on_hand 10 → 7...");
    await createProductSale({
      studentId: student.id,
      soldAt: new Date().toISOString(),
      items: [{ productId: Number(product.id), quantity: 3 }],
    });
    assertEqual(await onHand(product.id), 7, "satış sonrası on_hand=7");

    // ── 5. Elle düzeltme → mutlak 5 ──────────────────────────────────────────
    step("Elle düzeltme: hedef on_hand=5 (delta=-2)...");
    const r2 = await adjustProductStock({ productId: product.id, newOnHand: 5, note: "sayım", actorUserId });
    assertEqual(r2.on_hand, 5, "düzeltme sonrası on_hand=5");
    assertEqual(await onHand(product.id), 5, "v_product_stock on_hand=5");
    await assertAuditLog({
      action: "stock_adjusted",
      entityType: "product",
      entityId: product.id,
      expectBeforeContains: { on_hand: 7 },
      expectAfterContains: { on_hand: 5 },
    });

    // ── 6. No-op düzeltme → yeni hareket yazılmamalı ─────────────────────────
    step("No-op düzeltme: aynı değeri (5) set et → hareket sayısı artmamalı...");
    const cntBefore = await movementCount(product.id);
    const r3 = await adjustProductStock({ productId: product.id, newOnHand: 5, actorUserId });
    assertEqual(r3.on_hand, 5, "no-op dönüşü on_hand=5");
    assertEqual(await movementCount(product.id), cntBefore, "no-op yeni hareket yazmamalı");

    // ── 7. Yetersiz stok satışı engellenmemeli (eksiye düşer) ────────────────
    step("8 adet satış (stok 5) → engellenmemeli, on_hand=-3...");
    await createProductSale({
      studentId: student.id,
      soldAt: new Date().toISOString(),
      items: [{ productId: Number(product.id), quantity: 8 }],
    });
    assertEqual(await onHand(product.id), -3, "yetersiz stok satışı geçti, on_hand=-3 (kasıtlı eksi)");

    // ── 8. Flag KAPAT → satış stok hareketi yazmamalı ────────────────────────
    step("Flag kapatılıyor: yeni satış on_hand'i değiştirmemeli...");
    await updateSettings({ stockTrackingEnabled: false }, actorUserId);
    await createProductSale({
      studentId: student.id,
      soldAt: new Date().toISOString(),
      items: [{ productId: Number(product.id), quantity: 2 }],
    });
    assertEqual(await onHand(product.id), -3, "flag kapalıyken on_hand sabit (-3)");

    ok("\nSMOKE 24 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    // Flag'i orijinal durumuna döndür.
    try {
      await updateSettings({ stockTrackingEnabled: originalFlag });
    } catch {
      // yut
    }
    await cleanupSmoke(studentIds);
    if (productIds.length > 0) {
      // stock_movements → product_sale_items → products sırasıyla (FK RESTRICT).
      await pool.query(`DELETE FROM stock_movements WHERE product_id = ANY($1::bigint[])`, [productIds]);
      await pool.query(`DELETE FROM product_sale_items WHERE product_id = ANY($1::bigint[])`, [productIds]);
      await pool.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [productIds]);
    }
    await closePool();
  }
}

async function movementCount(productId: string): Promise<number> {
  const r = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM stock_movements WHERE product_id = $1 AND deleted_at IS NULL`,
    [productId],
  );
  return Number(r.rows[0].c);
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
