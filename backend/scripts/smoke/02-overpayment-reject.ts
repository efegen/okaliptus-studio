/**
 * SMOKE 02 — Overpayment Reject (§7.2)
 *
 * 500 TL completed lesson + 600 TL ödeme → OVERPAYMENT_NOT_ALLOWED, payment
 * kaydedilmez, remaining=500.
 *
 * Edge'ler:
 *   - 500.001 (kuruş ötesi) → reject
 *   - 0 → ValidationError (must be > 0)
 *   - negatif → ValidationError
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/02-overpayment-reject.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import { createCashPayment } from "../../src/services/payments.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  info,
  assert,
  assertEqual,
  assertRejects,
  assertViewRow,
  ok,
  cleanupSmoke,
  closePool,
  daysAgo,
  isoNow,
  overrideDefaultLessonTypePrice,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const restorePrice = await overrideDefaultLessonTypePrice("500");

  try {
    section("SMOKE 02 — Overpayment Reject");

    const student = await createStudent({ fullName: "SMOKE02_main" });
    studentIds.push(student.id);

    const lesson = await createLesson({
      studentId: student.id,
      startsAt: daysAgo(1),
      mode: "onsite",
    });
    await completeLesson(lesson.id);

    // ─────────────────────────────────────────────────────────────────────────
    // 600 TL > 500 TL net → reject
    // ─────────────────────────────────────────────────────────────────────────
    step("600 TL ödeme (net=500) → OVERPAYMENT_NOT_ALLOWED");
    await assertRejects(
      () =>
        createCashPayment({
          targetType: "lesson",
          targetId: lesson.id,
          amount: "600",
          source: "cash",
          paidAt: isoNow(),
        }),
      "OVERPAYMENT_NOT_ALLOWED",
      "600 > 500 reddedilir",
    );

    const payCount = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM payments WHERE lesson_id = $1 AND deleted_at IS NULL`,
      [lesson.id],
    );
    assertEqual(payCount.rows[0].c, "0", "Hiç payment kaydedilmedi");

    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lesson.id },
      { remaining_receivable: "500" },
      "remaining hâlâ 500",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 500.001 — kuruş ötesi
    // ─────────────────────────────────────────────────────────────────────────
    step("500.01 (kuruş ötesi) → reddedilir");
    await assertRejects(
      () =>
        createCashPayment({
          targetType: "lesson",
          targetId: lesson.id,
          amount: "500.01",
          source: "cash",
          paidAt: isoNow(),
        }),
      "OVERPAYMENT_NOT_ALLOWED",
      "500.01 > 500 reddedilir",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 0 → ValidationError
    // ─────────────────────────────────────────────────────────────────────────
    step("0 TL → ValidationError");
    await assertRejects(
      () =>
        createCashPayment({
          targetType: "lesson",
          targetId: lesson.id,
          amount: "0",
          source: "cash",
          paidAt: isoNow(),
        }),
      "VALIDATION_ERROR",
      "amount=0 ValidationError",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Negatif → ValidationError
    // ─────────────────────────────────────────────────────────────────────────
    step("Negatif (-100) → ValidationError");
    await assertRejects(
      () =>
        createCashPayment({
          targetType: "lesson",
          targetId: lesson.id,
          amount: "-100",
          source: "cash",
          paidAt: isoNow(),
        }),
      "VALIDATION_ERROR",
      "amount<0 ValidationError",
    );

    // Sanity: 500 (tam) kabul edilmeli
    step("500 TL (tam tutar) → kabul edilir (kontrol)");
    await createCashPayment({
      targetType: "lesson",
      targetId: lesson.id,
      amount: "500",
      source: "cash",
      paidAt: isoNow(),
    });
    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lesson.id },
      { remaining_receivable: "0" },
      "500 sonrası remaining=0",
    );

    ok("\nSMOKE 02 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    await cleanupSmoke(studentIds);
    await restorePrice();
    await closePool();
  }
}

run().catch(err => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
