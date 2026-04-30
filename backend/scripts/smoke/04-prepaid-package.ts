/**
 * SMOKE 04 — Prepaid Package + Credit Consumption
 *
 * Senaryo (spec §2.4, §5.5, §7.4):
 *   1. lesson_type.default_price = 600 geçici olarak kur (paket unit_price'tan farklı)
 *   2. Öğrenci oluştur
 *   3. Paket: 3 kredi × 500 = 1500 TRY (cash) — unit_price lesson_type'tan farklı
 *   4. Paket oluşturulunca payment otomatik INSERT edilmeli
 *   5. audit_logs: prepaid_package_created + payment_created
 *   6. v_prepaid_package_status: remaining_credits = 3
 *   7. Lesson 1 complete → FIFO ile paketten düşülmeli
 *      - lesson.prepaid_package_id set
 *      - lesson.price_snapshot = 500 (paket unit_price, lesson_type default 600 değil!)
 *      - remaining_credits = 2
 *   8. Lesson 2 + 3 complete → remaining_credits = 0 (paket tükendi)
 *   9. Lesson 4 complete → paket kredi yok → prepaid_package_id NULL, price_snapshot=600
 *  10. Paket payment'ı tek başına silmeye çalış → PackagePaymentDeleteForbiddenError
 *
 * CLEANUP: script sonunda tüm veriler soft-delete edilir.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/04-prepaid-package.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import {
  createPrepaidPackage,
  getPrepaidPackageStatus,
} from "../../src/services/packages.service.js";
import { deletePayment } from "../../src/services/payments.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertMoney, assertEqual, assertRejects,
  cleanupSmoke, closePool, daysAgo, nextSlotIso, overrideDefaultLessonTypePrice,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  // lesson_type.default_price=600; paketin unit_price'ı 500 — snapshot override test.
  const restorePrice = await overrideDefaultLessonTypePrice("600");

  try {
    section("SMOKE 04 — Prepaid Package + Credit Consumption");

    // ── 1. Öğrenci ────────────────────────────────────────────────────────────
    step("Öğrenci oluşturuluyor (SMOKE_Student_04)...");
    const student = await createStudent({
      fullName: "SMOKE_Student_04",
    });
    studentIds.push(student.id);
    info("student.id", student.id);

    // ── 2. Paket oluştur (3 kredi × 500 = 1500) ───────────────────────────────
    step("Prepaid package oluşturuluyor (3 kredi × 500 TRY = 1500 TRY, cash)...");
    console.log("  BEKLENED: package + payment atomik olarak oluşturulsun, total = 3×500 = 1500");

    const { prepaidPackage: pkg, payment: pkgPayment } = await createPrepaidPackage({
      studentId: student.id,
      purchasedAt: daysAgo(10),
      creditCount: 3,
      unitPrice: "500",
      totalAmount: "1500", // 3 × 500 = 1500
      source: "cash",
      note: "SMOKE paket",
    });

    assertMoney(pkg.total_amount, "1500", "package.total_amount");
    assertEqual(pkg.credit_count, 3, "package.credit_count");
    assertMoney(pkg.unit_price, "500", "package.unit_price");
    assert(pkg.deleted_at === null, "package aktif");
    assertMoney(pkgPayment.amount, "1500", "payment.amount (atomik olarak oluştu)");
    assertEqual(pkgPayment.source, "cash", "payment.source");
    assertEqual(pkgPayment.prepaid_package_id, pkg.id, "payment.prepaid_package_id");
    info("package.id", pkg.id);
    info("pkgPayment.id", pkgPayment.id);

    // ── 3. audit_logs kontrolü ────────────────────────────────────────────────
    step("audit_logs: prepaid_package_created + payment_created var mı?");
    const auditRes = await pool.query<{ action: string }>(
      `SELECT action FROM audit_logs
        WHERE (entity_type = 'prepaid_package' AND entity_id = $1)
           OR (entity_type = 'payment'          AND entity_id = $2)
        ORDER BY created_at`,
      [pkg.id, pkgPayment.id],
    );
    const auditActions = auditRes.rows.map((r) => r.action);
    assert(auditActions.includes("prepaid_package_created"), "audit: prepaid_package_created");
    assert(auditActions.includes("payment_created"), "audit: payment_created");

    // ── 4. remaining_credits = 3 ─────────────────────────────────────────────
    step("v_prepaid_package_status: remaining_credits = 3...");
    const s0 = await getPrepaidPackageStatus(pkg.id);
    assertEqual(Number(s0.remaining_credits), 3, "remaining_credits = 3 (kullanım yok)");
    assertMoney(String(parseFloat(s0.remaining_value)), "1500", "remaining_value = 1500");

    // ── 5. Lesson 1 complete → FIFO kredi tahsisi ─────────────────────────────
    step("Lesson 1 oluşturup tamamlanıyor (FIFO kredi tahsisi bekleniyor)...");
    console.log("  BEKLENED: prepaid_package_id set, price_snapshot=500 (paket fiyatı, not 600)");

    const lesson1 = await createLesson({
      studentId: student.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    const { lesson: done1 } = await completeLesson(lesson1.id);

    assertEqual(done1.prepaid_package_id, pkg.id, "lesson1.prepaid_package_id = pkg.id");
    assertMoney(done1.price_snapshot, "500", "lesson1.price_snapshot = 500 (paket unit_price override)");

    const s1 = await getPrepaidPackageStatus(pkg.id);
    assertEqual(Number(s1.remaining_credits), 2, "remaining_credits = 2");
    assertEqual(Number(s1.used_credits), 1, "used_credits = 1");
    info("lesson1.id", lesson1.id);

    // ── 6. Lesson 2 + 3 complete → paket tükendi ─────────────────────────────
    step("Lesson 2 + Lesson 3 tamamlanıyor (paket kredi tükenecek)...");

    const lesson2 = await createLesson({ studentId: student.id, startsAt: nextSlotIso(), mode: "onsite" });
    const { lesson: done2 } = await completeLesson(lesson2.id);
    assertEqual(done2.prepaid_package_id, pkg.id, "lesson2.prepaid_package_id = pkg.id");

    const lesson3 = await createLesson({ studentId: student.id, startsAt: nextSlotIso(), mode: "online" });
    const { lesson: done3 } = await completeLesson(lesson3.id);
    assertEqual(done3.prepaid_package_id, pkg.id, "lesson3.prepaid_package_id = pkg.id");

    const s3 = await getPrepaidPackageStatus(pkg.id);
    assertEqual(Number(s3.remaining_credits), 0, "remaining_credits = 0 (paket tükendi)");
    assertEqual(Number(s3.used_credits), 3, "used_credits = 3");
    assertMoney(s3.remaining_value, "0", "remaining_value = 0");
    console.log("  → Paket tamamen tüketildi");

    // ── 7. Lesson 4 → paket kredi yok, normal fiyat ───────────────────────────
    step("Lesson 4 tamamlanıyor (paket kredi yok → normal fiyat bekleniyor)...");
    console.log("  BEKLENED: prepaid_package_id NULL, price_snapshot = 600 (lesson_type.default_price)");

    const lesson4 = await createLesson({ studentId: student.id, startsAt: nextSlotIso(), mode: "onsite" });
    const { lesson: done4 } = await completeLesson(lesson4.id);

    assert(done4.prepaid_package_id === null, "lesson4.prepaid_package_id = NULL");
    assertMoney(done4.price_snapshot, "600", "lesson4.price_snapshot = 600 (lesson_type.default_price)");
    info("lesson4.id", lesson4.id);

    // ── 8. Paket payment'ını tek başına silmeye çalış → YASAK ─────────────────
    step("Paket payment'ını deletePayment() ile silmeye çalışıyoruz...");
    console.log("  BEKLENED: PackagePaymentDeleteForbiddenError");

    await assertRejects(
      () => deletePayment(pkgPayment.id),
      "PACKAGE_PAYMENT_DELETE_FORBIDDEN",
      "paket payment'ı tek başına silinemez",
    );

    // ── 9. Ciro hesabı (completed dersler, package dahil) ─────────────────────
    step("Bu haftaki dersler için ciro kontrolü...");
    console.log("  BEKLENED: 4 completed lesson price_snapshot toplamı doğru olmalı");
    console.log("  → 3 lesson × 500 (paket) + 1 lesson × 600 (normal) = 2100");

    const revenue = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(price_snapshot), 0)::text AS total
         FROM lessons
        WHERE student_id = $1
          AND status = 'completed'
          AND deleted_at IS NULL`,
      [student.id],
    );
    assertMoney(revenue.rows[0]!.total, "2100", "toplam ciro = 3×500 + 1×600 = 2100");

    console.log("\n✅ SMOKE 04 — TÜM ADIMLAR BAŞARILI");

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
