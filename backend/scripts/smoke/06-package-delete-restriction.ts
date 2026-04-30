/**
 * SMOKE 06 — Package Delete Restriction
 *
 * Senaryo (spec §2.4, §2.9, §5.9, §5.9b):
 *   KURAL: Kredisi tüketilmiş paket silinemez (PackageHasUsedCreditsError).
 *   KURAL: Pakete bağlı payment tek başına silinemez (PackagePaymentDeleteForbiddenError).
 *   SERBEST: Kredi kullanımı olmayan paket deletePrepaidPackage() ile silinebilir.
 *
 *   1. 3 kredili paket oluştur
 *   2. 1 lesson complete → paketten kredi düşüldü
 *   3. deletePrepaidPackage() → PackageHasUsedCreditsError (kredi kullanıldı)
 *   4. deletePayment(pkgPayment.id) → PackagePaymentDeleteForbiddenError
 *   5. Paket ve payment hâlâ aktif mi? Kontrol.
 *   6. Yeni: kredisiz (kullanılmamış) başka bir paket oluştur
 *   7. deletePrepaidPackage() → BAŞARILI (kredi kullanımı yok)
 *   8. Silinen paketin payment'ı da silinmiş mi? (atomik)
 *
 * CLEANUP: Script sonunda Lesson 1 için ayrı cleanup (§5.9b nedeniyle servis
 *   kullanılamıyor). cleanupSmoke() direkt SQL ile tüm kayıtları temizler.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/06-package-delete-restriction.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import {
  createPrepaidPackage,
  deletePrepaidPackage,
} from "../../src/services/packages.service.js";
import { deletePayment, getPaymentById } from "../../src/services/payments.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual, assertRejects,
  cleanupSmoke, closePool, daysAgo, nextSlotIso,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];

  try {
    section("SMOKE 06 — Package Delete Restriction");

    step("Öğrenci oluşturuluyor (SMOKE_Student_06)...");
    const student = await createStudent({
      fullName: "SMOKE_Student_06",
    });
    studentIds.push(student.id);
    info("student.id", student.id);

    // ── 1. Paket oluştur (3 kredi) ─────────────────────────────────────────────
    step("3 kredili paket oluşturuluyor (3 × 500 = 1500)...");
    const { prepaidPackage: pkg1, payment: pkg1Pay } = await createPrepaidPackage({
      studentId: student.id,
      purchasedAt: daysAgo(10),
      creditCount: 3,
      unitPrice: "500",
      totalAmount: "1500",
      source: "cash",
      note: "SMOKE paket - silme testi",
    });
    info("pkg1.id", pkg1.id);
    info("pkg1Pay.id", pkg1Pay.id);

    // ── 2. Lesson complete → kredi düşüldü ──────────────────────────────────
    step("Lesson oluşturup tamamlanıyor (1 kredi tüketilecek)...");
    const lesson = await createLesson({
      studentId: student.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    const { lesson: done } = await completeLesson(lesson.id);
    assertEqual(done.prepaid_package_id, pkg1.id, "lesson paketten kredi düştü");
    info("lesson.id (pkg1'den kredi kullandı)", lesson.id);

    // ── 3. deletePrepaidPackage → YASAK (kredi kullanımı var) ─────────────────
    step("deletePrepaidPackage(pkg1) deneniyor — kredi kullanımı olduğu için yasak...");
    console.log("  BEKLENED: PackageHasUsedCreditsError");
    await assertRejects(
      () => deletePrepaidPackage(pkg1.id),
      "PACKAGE_HAS_USED_CREDITS",
      "kredisi tüketilmiş paket silinemez",
    );

    // ── 4. deletePayment → YASAK (pakete bağlı payment) ──────────────────────
    step("deletePayment(pkg1Pay.id) deneniyor — pakete bağlı olduğu için yasak...");
    console.log("  BEKLENED: PackagePaymentDeleteForbiddenError");
    await assertRejects(
      () => deletePayment(pkg1Pay.id),
      "PACKAGE_PAYMENT_DELETE_FORBIDDEN",
      "pakete bağlı payment tek başına silinemez",
    );

    // ── 5. Paket + payment hâlâ aktif ────────────────────────────────────────
    step("Paket ve payment hâlâ aktif mi kontrol ediliyor...");
    console.log("  BEKLENED: her ikisi de deleted_at = NULL");

    const pkgCheck = await pool.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM prepaid_packages WHERE id = $1`,
      [pkg1.id],
    );
    const payCheck = await pool.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM payments WHERE id = $1`,
      [pkg1Pay.id],
    );

    assert(pkgCheck.rows[0]?.deleted_at === null, "pkg1.deleted_at = NULL (silinmedi)");
    assert(payCheck.rows[0]?.deleted_at === null, "pkg1Pay.deleted_at = NULL (silinmedi)");

    // ── 6. Kredisiz yeni paket oluştur ────────────────────────────────────────
    step("Kredisiz (kullanılmamış) 2. paket oluşturuluyor...");
    const { prepaidPackage: pkg2, payment: pkg2Pay } = await createPrepaidPackage({
      studentId: student.id,
      purchasedAt: daysAgo(8),
      creditCount: 2,
      unitPrice: "500",
      totalAmount: "1000",
      source: "iban",
      note: "SMOKE paket 2 - silinecek",
    });
    info("pkg2.id (kullanılmamış)", pkg2.id);
    info("pkg2Pay.id", pkg2Pay.id);

    // ── 7. deletePrepaidPackage → BAŞARILI (kredi kullanımı yok) ────────────
    step("deletePrepaidPackage(pkg2) çağrılıyor — kredi kullanımı yok → başarılı...");
    console.log("  BEKLENED: paket + payment atomik olarak soft-delete edilmeli");

    const { prepaidPackage: delPkg, payment: delPay } = await deletePrepaidPackage(pkg2.id);

    assert(delPkg.deleted_at !== null, "pkg2.deleted_at set (silinmiş)");
    assert(delPay.deleted_at !== null, "pkg2Pay.deleted_at set (atomik silindi)");
    info("pkg2.deleted_at", delPkg.deleted_at);

    // ── 8. audit_logs'ta silme kaydı var mı? ─────────────────────────────────
    step("audit_logs: prepaid_package_deleted + payment_deleted var mı?");
    const delAudit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_logs
        WHERE (entity_type = 'prepaid_package' AND entity_id = $1)
           OR (entity_type = 'payment'          AND entity_id = $2)
        ORDER BY created_at DESC
        LIMIT 4`,
      [pkg2.id, pkg2Pay.id],
    );
    const delActions = delAudit.rows.map((r) => r.action);
    assert(delActions.includes("prepaid_package_deleted"), "audit: prepaid_package_deleted");
    assert(delActions.includes("payment_deleted"), "audit: payment_deleted (atomik)");

    // ── 9. getPaymentById → silinmiş payment artık bulunamaz ────────────────
    step("getPaymentById(pkg2Pay.id) → PaymentNotFoundError bekleniyor...");
    await assertRejects(
      () => getPaymentById(pkg2Pay.id),
      "PAYMENT_NOT_FOUND",
      "silinmiş package payment artık getPaymentById ile bulunamaz",
    );

    console.log("\n✅ SMOKE 06 — TÜM ADIMLAR BAŞARILI");

  } finally {
    // cleanupSmoke: pkg2 zaten silinmiş (deletePrepaidPackage ile),
    // pkg1 + lesson1 kaldı — cleanupSmoke doğrudan SQL ile temizler.
    await cleanupSmoke(studentIds);
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
