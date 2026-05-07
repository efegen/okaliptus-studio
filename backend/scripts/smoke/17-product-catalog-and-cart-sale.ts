/**
 * SMOKE 17 — Product Catalog + Cart Sale (v1.6)
 *
 * Senaryo:
 *   1. Ürün oluştur (barkod + fiyat).
 *   2. Aynı barkod ile tekrar oluşturmaya çalış → BARCODE_CONFLICT.
 *   3. Ürünü güncelle (fiyatı değiştir).
 *   4. Öğrenci yarat.
 *   5. Sepet satışı yap (2 farklı ürün, biri x2 adet). Server total'i hesaplar.
 *      Client'tan gelen totalAmount yok sayılmalı.
 *   6. Satış GET → items dizisi doğru, name_snapshot/unit_price_snapshot var.
 *   7. Ürünü arşivle. Geçmiş satışın items'ı hâlâ okunmalı (snapshot bağımsız).
 *   8. Arşivli ürünü sepete eklemeye çalış → ValidationError.
 *
 * CLEANUP: cleanupSmoke öğrenci & satışı kaldırır; products tablosu kalır
 * (ünikat barkodlar SMOKE17_ prefix'i ile, tekrar koşumda upsert path zorlanır
 * — bu test path'i kullanmadığı için unique violation olmaz, biz testteki
 * barkodları sonda manuel temizliyoruz).
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/17-product-catalog-and-cart-sale.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import {
  archiveProduct,
  createProduct,
  updateProduct,
} from "../../src/services/products.service.js";
import {
  createProductSale,
  getProductSaleById,
} from "../../src/services/product-sales.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual, assertMoney,
  assertRejects, cleanupSmoke, closePool, ok,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const productIds: string[] = [];

  // Test başlangıcında zamanlama-bazlı barkod (paralel testlerle çakışmasın).
  const stamp = Date.now().toString();
  const BARCODE_A = `SMOKE17_A_${stamp}`;
  const BARCODE_B = `SMOKE17_B_${stamp}`;

  try {
    section("SMOKE 17 — Product Catalog + Cart Sale");

    // ── 1. Ürün oluştur ──────────────────────────────────────────────────────
    step("İki ürün oluşturuluyor (barkod + fiyat)...");
    const productA = await createProduct({
      name: "SMOKE_Yoga Matı",
      price: "350.00",
      barcode: BARCODE_A,
      imageUrl: "https://cdn.dsmcdn.com/example/mat.jpg",
    });
    productIds.push(productA.id);
    info("productA.id", productA.id);
    assertMoney(productA.price, "350.00", "productA.price");
    assertEqual(productA.barcode, BARCODE_A, "productA.barcode");

    const productB = await createProduct({
      name: "SMOKE_Su Matarası",
      price: "120.50",
      barcode: BARCODE_B,
    });
    productIds.push(productB.id);

    // ── 2. Barkod çakışması ──────────────────────────────────────────────────
    step("Aynı barkod ile tekrar oluşturma denemesi (409 beklenir)...");
    await assertRejects(
      () => createProduct({
        name: "SMOKE_Duplicate",
        price: "99",
        barcode: BARCODE_A,
      }),
      "PRODUCT_BARCODE_CONFLICT",
      "Aynı barkod ikinci kez kabul edilmemeli",
    );

    // ── 3. Ürünü güncelle ────────────────────────────────────────────────────
    step("Ürün fiyatı 350 → 400 güncelleniyor...");
    const updatedA = await updateProduct(productA.id, { price: "400" });
    assertMoney(updatedA.price, "400.00", "updatedA.price");

    // ── 4. Öğrenci yarat ─────────────────────────────────────────────────────
    step("Test öğrencisi oluşturuluyor...");
    const student = await createStudent({
      fullName: "SMOKE_Student_17",
      phone: "+90 555 017 0001",
    });
    studentIds.push(student.id);
    info("student.id", student.id);

    // ── 5. Sepet satışı ──────────────────────────────────────────────────────
    step("Sepet satışı: productA x2 + productB x1, server total'i hesaplamalı...");
    const sale = await createProductSale({
      studentId: student.id,
      soldAt: new Date().toISOString(),
      // Yanlış totalAmount gönderiyoruz; server items'tan hesaplayıp yok saymalı.
      totalAmount: "999",
      items: [
        { productId: Number(productA.id), quantity: 2 },
        { productId: Number(productB.id), quantity: 1 },
      ],
    });
    info("sale.id", sale.id);
    // 400 * 2 + 120.50 * 1 = 920.50
    assertMoney(sale.total_amount, "920.50", "sale.total_amount = SUM(line_total) (client'tan gelen 999 yok sayıldı)");

    // ── 6. Satış GET → items doğru mu? ───────────────────────────────────────
    step("getProductSaleById ile items dizisi okunuyor...");
    const fetched = await getProductSaleById(sale.id);
    assertEqual(fetched.items.length, 2, "sale.items.length");
    const itemA = fetched.items.find(it => it.product_id === productA.id);
    const itemB = fetched.items.find(it => it.product_id === productB.id);
    assert(!!itemA, "productA için item kaydı var");
    assert(!!itemB, "productB için item kaydı var");
    if (itemA) {
      assertEqual(itemA.quantity, 2, "itemA.quantity");
      assertEqual(itemA.name_snapshot, "SMOKE_Yoga Matı", "itemA.name_snapshot");
      assertMoney(itemA.unit_price_snapshot, "400.00", "itemA.unit_price_snapshot");
      assertMoney(itemA.line_total, "800.00", "itemA.line_total");
    }
    if (itemB) {
      assertEqual(itemB.quantity, 1, "itemB.quantity");
      assertMoney(itemB.line_total, "120.50", "itemB.line_total");
    }

    // ── 7. Ürünü arşivle, geçmiş satış hâlâ okunabilmeli ─────────────────────
    step("productA arşivleniyor...");
    const archivedA = await archiveProduct(productA.id);
    assert(archivedA.archived_at !== null, "archived_at set");

    const refetched = await getProductSaleById(sale.id);
    assertEqual(refetched.items.length, 2, "arşivlenmeden sonra items hâlâ 2");
    const stillA = refetched.items.find(it => it.product_id === productA.id);
    assert(!!stillA, "arşivlenmiş ürünün satır kaydı bağımsız korunuyor");
    if (stillA) {
      assertEqual(stillA.name_snapshot, "SMOKE_Yoga Matı", "name_snapshot snapshot olarak korunuyor");
    }

    // ── 8. Arşivli ürün sepete eklenememeli ──────────────────────────────────
    step("Arşivli ürünü yeni satışa eklemek 400 atmalı...");
    await assertRejects(
      () => createProductSale({
        studentId: student.id,
        soldAt: new Date().toISOString(),
        items: [{ productId: Number(productA.id), quantity: 1 }],
      }),
      "VALIDATION_ERROR",
      "Arşivli ürün sepete eklenememeli",
    );

    ok("\nSMOKE 17 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    // Cleanup: önce öğrenciye bağlı kayıtları temizle, sonra test ürünlerini sil.
    await cleanupSmoke(studentIds);
    if (productIds.length > 0) {
      // Hard delete (test artığı, geçmiş satışlar zaten cleanupSmoke ile soft-delete oldu).
      // product_sale_items satışlar soft-delete olduğu için kalmış olabilir;
      // FK RESTRICT'e takılmamak için önce items'ı temizle.
      await pool.query(
        `DELETE FROM product_sale_items WHERE product_id = ANY($1::bigint[])`,
        [productIds],
      );
      await pool.query(
        `DELETE FROM products WHERE id = ANY($1::bigint[])`,
        [productIds],
      );
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
