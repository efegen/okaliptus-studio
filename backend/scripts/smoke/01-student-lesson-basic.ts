/**
 * SMOKE 01 — Student + Lesson Basic Flow
 *
 * Senaryo (spec §7.1):
 *   1. SMOKE_ prefix'li öğrenci oluştur (fiyat artık öğrencide değil)
 *   2. lesson_type.default_price = 500 sabitle
 *   3. Scheduled lesson oluştur → price_snapshot = 500 olmalı (ders türünden)
 *   4. completeLesson → status = 'completed', completed_at set olmalı
 *   5. Cash payment 500 → lesson tamamen kapanmalı (remaining debt = 0)
 *   6. audit_logs'ta lesson_created + lesson_status_change + payment_created olmalı
 *
 * CLEANUP STRATEJISI:
 *   Script sonunda cleanupSmoke() ile öğrenci ve tüm bağlı kayıtlar soft-delete edilir.
 *   Başarısız olursa student full_name "SMOKE_" ile başlıyor ve manuel silinebilir.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/01-student-lesson-basic.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import { createCashPayment } from "../../src/services/payments.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertMoney, assertEqual, ok,
  cleanupSmoke, closePool, daysAgo, overrideDefaultLessonTypePrice,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const restorePrice = await overrideDefaultLessonTypePrice("500");

  try {
    section("SMOKE 01 — Student + Lesson Basic Flow");

    // ── 1. Öğrenci oluştur ────────────────────────────────────────────────────
    step("Öğrenci oluşturuluyor (SMOKE_Student_01)...");
    console.log("  BEKLENEN: Student kaydı oluşsun, id dönsün, is_active=true");

    const student = await createStudent({
      fullName: "SMOKE_Student_01",
      phone: "+90 555 001 0001",
    });

    studentIds.push(student.id);
    assert(student.full_name === "SMOKE_Student_01", "full_name doğru set edilmiş");
    assert(student.is_active === true, "is_active = true");
    assert(student.deleted_at === null, "deleted_at = null");
    info("student.id", student.id);

    // ── 2. Scheduled lesson oluştur ───────────────────────────────────────────
    step("Scheduled lesson oluşturuluyor...");
    console.log("  BEKLENEN: status='scheduled', price_snapshot = lesson_type.default_price (500)");

    const lesson = await createLesson({
      studentId: student.id,
      startsAt: daysAgo(2),
      mode: "onsite",
    });

    assertEqual(lesson.status, "scheduled", "lesson.status");
    assertMoney(lesson.price_snapshot, "500", "lesson.price_snapshot (lesson_type.default_price'tan kopyalandı)");
    assert(lesson.completed_at === null, "completed_at = null (scheduled'da boş)");
    assert(lesson.prepaid_package_id === null, "prepaid_package_id = null");
    info("lesson.id", lesson.id);

    // ── 3. Lesson tamamla ────────────────────────────────────────────────────
    step("completeLesson() çağrılıyor...");
    console.log("  BEKLENEN: status='completed', completed_at set, prepaid_package_id NULL (paket yok)");

    const completed = await completeLesson(lesson.id);

    assertEqual(completed.status, "completed", "lesson.status");
    assert(completed.completed_at !== null, "completed_at set olmuş");
    assert(completed.prepaid_package_id === null, "prepaid_package_id hâlâ NULL (aktif paket yok)");
    assertMoney(completed.price_snapshot, "500", "price_snapshot değişmemiş");
    info("completed_at", completed.completed_at);

    // ── 4. Cash payment 500 ───────────────────────────────────────────────────
    step("Cash payment 500 TRY oluşturuluyor...");
    console.log("  BEKLENEN: Payment kaydı oluşsun (500 = kalan borç, tam kapanış)");

    const { payment } = await createCashPayment({
      targetType: "lesson",
      targetId: lesson.id,
      amount: "500",
      source: "cash",
      paidAt: daysAgo(1),
    });

    assertMoney(payment.amount, "500", "payment.amount");
    assertEqual(payment.source, "cash", "payment.source");
    assertEqual(payment.lesson_id, lesson.id, "payment.lesson_id");
    info("payment.id", payment.id);

    // ── 5. Remaining debt sıfır mı? ───────────────────────────────────────────
    step("v_lesson_balances'ta remaining_receivable kontrol ediliyor...");
    console.log("  BEKLENEN: remaining_receivable = 0 (ders tamamen kapandı)");

    const balRes = await pool.query<{ remaining_receivable: string }>(
      `SELECT remaining_receivable FROM v_lesson_balances WHERE lesson_id = $1`,
      [lesson.id],
    );

    const remaining = balRes.rows[0]?.remaining_receivable ?? "null";
    assertMoney(remaining, "0", "remaining_receivable (ders kapalı)");

    // ── 6. Audit logs ─────────────────────────────────────────────────────────
    step("audit_logs kontrol ediliyor...");
    console.log("  BEKLENEN: lesson_created + lesson_status_change + payment_created");

    const auditRes = await pool.query<{ action: string }>(
      `SELECT action FROM audit_logs
        WHERE entity_id = $1
          AND entity_type IN ('lesson', 'payment')
        ORDER BY created_at`,
      [lesson.id],
    );

    const actions = auditRes.rows.map((r) => r.action);
    assert(actions.includes("lesson_created"), "audit: lesson_created mevcut");
    assert(actions.includes("lesson_status_change"), "audit: lesson_status_change mevcut");

    const payAudit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE entity_id = $1 AND entity_type = 'payment'`,
      [payment.id],
    );
    assert(
      payAudit.rows.some((r) => r.action === "payment_created"),
      "audit: payment_created mevcut",
    );

    ok("\nSMOKE 01 — TÜM ADIMLAR BAŞARILI ✓");

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
