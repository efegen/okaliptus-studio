/**
 * SMOKE 20 — Studio Movements Feed (stüdyo geneli hareket akışı)
 *
 * Senaryo:
 *   1. SMOKE_ prefix'li öğrenci oluştur (lesson_type.default_price = 500 sabit).
 *   2. L1: tamamlanmış + tam ödenmiş ders (cash 500).
 *   3. L2: iptal ders.
 *   4. S1: ürün satışı 300, kısmi ödeme (cash 100).
 *   5. S2: ürün satışı 200, tam ödeme (iban 200) — sonra soft-delete edilecek.
 *
 *   A. listStudioMovements(q=NAME) tüm türleri doğru sayıda + doğru student_name
 *      ile döndürür (lesson_completed/cancelled, product_sale x2, payment x3).
 *   B. summary toplamları doğru (sales_total=500, payments_total=800).
 *   C. type filtreleri (sale/lesson/payment) yalnız ilgili türü döndürür.
 *   D. limit=1 → hasMore=true.
 *   E. S2 satışı soft-delete edilince hem satış satırı hem ona BAĞLI ödeme
 *      listeden düşer (parent soft-delete → COALESCE student join miss).
 *
 * Not: summary global'dir; q=NAME ile öğrenciye sınırlanır (benzersiz isim).
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/20-studio-movements.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import {
  createLesson,
  completeLesson,
  changeLessonStatus,
} from "../../src/services/lessons.service.js";
import { createProductSale } from "../../src/services/product-sales.service.js";
import { createCashPayment } from "../../src/services/payments.service.js";
import {
  listStudioMovements,
  type StudioMovementRow,
} from "../../src/services/movements.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  info,
  assert,
  assertEqual,
  assertMoney,
  ok,
  cleanupSmoke,
  closePool,
  nextSlotIso,
  overrideDefaultLessonTypePrice,
  daysAgo,
} from "./_shared.js";

function countKind(rows: StudioMovementRow[], kind: string): number {
  return rows.filter((r) => r.kind === kind).length;
}

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const restorePrice = await overrideDefaultLessonTypePrice("500");
  const NAME = `SMOKE_Student_20_${Date.now()}`;

  try {
    section("SMOKE 20 — Studio Movements Feed");

    // ── 1. Öğrenci ───────────────────────────────────────────────────────────
    step("Öğrenci oluşturuluyor...");
    const student = await createStudent({ fullName: NAME, phone: "+90 555 020 0001" });
    studentIds.push(student.id);
    info("student.id", student.id);

    // ── 2. L1: tamamlanmış + ödenmiş ders ─────────────────────────────────────
    step("L1: tamamlanmış ders + tam ödeme (cash 500)...");
    const l1 = await createLesson({ studentId: student.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(l1.id);
    await createCashPayment({
      targetType: "lesson", targetId: l1.id, amount: "500", source: "cash", paidAt: daysAgo(1),
    });

    // ── 3. L2: iptal ders ──────────────────────────────────────────────────────
    step("L2: iptal ders...");
    const l2 = await createLesson({ studentId: student.id, startsAt: nextSlotIso(), mode: "online" });
    await changeLessonStatus(l2.id, "cancelled");

    // ── 4. S1: ürün satışı 300, kısmi ödeme 100 ───────────────────────────────
    step("S1: ürün satışı 300 + kısmi ödeme (cash 100)...");
    const s1 = await createProductSale({
      studentId: student.id, soldAt: new Date().toISOString(), totalAmount: "300",
    });
    await createCashPayment({
      targetType: "product_sale", targetId: s1.id, amount: "100", source: "cash", paidAt: daysAgo(1),
    });

    // ── 5. S2: ürün satışı 200, tam ödeme 200 (sonra silinecek) ───────────────
    step("S2: ürün satışı 200 + tam ödeme (iban 200)...");
    const s2 = await createProductSale({
      studentId: student.id, soldAt: new Date().toISOString(), totalAmount: "200",
    });
    const { payment: payS2 } = await createCashPayment({
      targetType: "product_sale", targetId: s2.id, amount: "200", source: "iban", paidAt: daysAgo(1),
    });

    // ── A. Tüm türler ──────────────────────────────────────────────────────────
    section("A — Tüm türler (q=NAME ile sınırlı)");
    const all = await listStudioMovements({ q: NAME, limit: 100 });
    const rows = all.data;
    assertEqual(countKind(rows, "lesson_completed"), 1, "lesson_completed satır sayısı");
    assertEqual(countKind(rows, "lesson_cancelled"), 1, "lesson_cancelled satır sayısı");
    assertEqual(countKind(rows, "product_sale"), 2, "product_sale satır sayısı");
    assertEqual(countKind(rows, "payment"), 3, "payment satır sayısı (L1 + S1 + S2)");
    assert(rows.every((r) => r.student_name === NAME), "tüm satırlar doğru student_name taşıyor");
    assert(
      rows.some((r) => r.kind === "payment" && (r.details as { target?: string }).target === "lesson"),
      "ders ödemesi student_name'i ders üzerinden çözdü",
    );
    assert(
      rows.some((r) => r.kind === "payment" && (r.details as { target?: string }).target === "product_sale"),
      "ürün ödemesi student_name'i satış üzerinden çözdü",
    );

    // ── B. Özet ──────────────────────────────────────────────────────────────
    section("B — Özet toplamları");
    assertEqual(all.summary.sales_count, 2, "summary.sales_count");
    assertEqual(all.summary.lessons_count, 2, "summary.lessons_count (completed + cancelled)");
    assertEqual(all.summary.completed_count, 1, "summary.completed_count");
    assertEqual(all.summary.payments_count, 3, "summary.payments_count");
    assertMoney(all.summary.sales_total, "500", "summary.sales_total (300 + 200)");
    assertMoney(all.summary.payments_total, "800", "summary.payments_total (500 + 100 + 200)");

    // ── C. Tür filtreleri ──────────────────────────────────────────────────────
    section("C — Tür filtreleri");
    const sales = await listStudioMovements({ q: NAME, type: "sale", limit: 100 });
    assert(sales.data.every((r) => r.kind === "product_sale"), "type=sale yalnız product_sale döndürür");
    assertEqual(sales.data.length, 2, "type=sale satır sayısı");

    const lessons = await listStudioMovements({ q: NAME, type: "lesson", limit: 100 });
    assert(lessons.data.every((r) => r.kind.startsWith("lesson_")), "type=lesson yalnız ders döndürür");
    assertEqual(lessons.data.length, 2, "type=lesson satır sayısı");

    const payments = await listStudioMovements({ q: NAME, type: "payment", limit: 100 });
    assert(payments.data.every((r) => r.kind === "payment"), "type=payment yalnız ödeme döndürür");
    assertEqual(payments.data.length, 3, "type=payment satır sayısı");

    // ── D. Sayfalama ───────────────────────────────────────────────────────────
    section("D — Sayfalama (limit=1 → hasMore)");
    const firstPage = await listStudioMovements({ q: NAME, limit: 1 });
    assertEqual(firstPage.data.length, 1, "limit=1 → tek satır");
    assert(firstPage.hasMore === true, "hasMore = true (7 satır > 1)");

    // ── E. Soft-delete dışlama ──────────────────────────────────────────────────
    section("E — S2 silinince satış + bağlı ödeme düşer");
    await pool.query(`UPDATE product_sales SET deleted_at = now() WHERE id = $1`, [s2.id]);
    const afterDel = await listStudioMovements({ q: NAME, limit: 100 });
    assertEqual(countKind(afterDel.data, "product_sale"), 1, "silinen satış (S2) listeden düştü");
    assertEqual(countKind(afterDel.data, "payment"), 2, "S2'ye bağlı ödeme de düştü (parent soft-delete)");
    assert(!afterDel.data.some((r) => r.id === `sale-${s2.id}`), "S2 satış satırı yok");
    assert(!afterDel.data.some((r) => r.id === `pay-${payS2.id}`), "S2 ödeme satırı yok");
    assertMoney(afterDel.summary.sales_total, "300", "summary.sales_total (yalnız S1)");
    assertMoney(afterDel.summary.payments_total, "600", "summary.payments_total (500 + 100)");

    ok("\nSMOKE 20 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    await cleanupSmoke(studentIds);
    await restorePrice();
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
