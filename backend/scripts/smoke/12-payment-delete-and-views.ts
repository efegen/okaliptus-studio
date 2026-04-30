/**
 * SMOKE 12 — Payment Delete + View Consistency (§7.7)
 *
 * Senaryolar:
 *   A. Cash 500 fully paid → deletePayment → remaining=500 (view consistency)
 *   B. v_student_summary.lesson_debt güncellendi
 *   C. getPaymentById(deletedId) → PAYMENT_NOT_FOUND
 *   D. İki kısmi (200+300), 200'lük olanı sil → remaining=200
 *   E. Silinmiş payment'ı tekrar sil → PAYMENT_NOT_FOUND
 *   F. Product sale 300 + iban 300 → deletePayment → remaining=300
 *   G. payment_deleted audit (before tüm payment)
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/12-payment-delete-and-views.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import {
  createCashPayment,
  deletePayment,
  getPaymentById,
} from "../../src/services/payments.service.js";
import { createProductSale } from "../../src/services/product-sales.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  info,
  assert,
  assertEqual,
  assertMoney,
  assertRejects,
  assertViewRow,
  assertAuditLog,
  ok,
  cleanupSmoke,
  closePool,
  daysAgo,
  isoNow,
  nextSlotIso,
  getActorUserId,
  overrideDefaultLessonTypePrice,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const restorePrice = await overrideDefaultLessonTypePrice("500");
  const ACTOR = await getActorUserId();
  if (ACTOR === null) {
    throw new Error("SMOKE 12: bootstrap admin yok — testler için actor gerekli");
  }

  try {
    section("SMOKE 12 — Payment Delete + View Consistency");

    // ─────────────────────────────────────────────────────────────────────────
    // A. Fully paid → delete → remaining=500
    // ─────────────────────────────────────────────────────────────────────────
    section("A — Cash 500 fully paid → deletePayment → remaining=500");

    const studentA = await createStudent({ fullName: "SMOKE12_A" });
    studentIds.push(studentA.id);

    const lessonA = await createLesson({
      studentId: studentA.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonA.id);
    const payA = await createCashPayment({
      targetType: "lesson",
      targetId: lessonA.id,
      amount: "500",
      source: "cash",
      paidAt: isoNow(),
    });

    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonA.id },
      { remaining_receivable: "0" },
      "A: payment öncesi remaining=0",
    );

    await deletePayment(payA.payment.id, ACTOR);

    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonA.id },
      { remaining_receivable: "500" },
      "A: deletePayment sonrası remaining=500",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // B. v_student_summary.lesson_debt güncellendi
    // ─────────────────────────────────────────────────────────────────────────
    section("B — v_student_summary.lesson_debt = 500");

    await assertViewRow(
      "v_student_summary",
      { id: studentA.id },
      { lesson_debt: "500" },
      "B: student summary lesson_debt = 500",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // C. getPaymentById(deleted) → PAYMENT_NOT_FOUND
    // ─────────────────────────────────────────────────────────────────────────
    section("C — getPaymentById(deleted) → PAYMENT_NOT_FOUND");

    await assertRejects(
      () => getPaymentById(payA.payment.id),
      "PAYMENT_NOT_FOUND",
      "C: silinmiş payment getPaymentById ile okunamaz",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // D. İki kısmi (200+300), 200'lük olanı sil → remaining=200
    // ─────────────────────────────────────────────────────────────────────────
    section("D — İki kısmi payment, 200'lük silinince remaining=200");

    const studentD = await createStudent({ fullName: "SMOKE12_D" });
    studentIds.push(studentD.id);

    const lessonD = await createLesson({
      studentId: studentD.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonD.id);

    const payD1 = await createCashPayment({
      targetType: "lesson",
      targetId: lessonD.id,
      amount: "200",
      source: "cash",
      paidAt: isoNow(),
    });
    const payD2 = await createCashPayment({
      targetType: "lesson",
      targetId: lessonD.id,
      amount: "300",
      source: "iban",
      paidAt: isoNow(),
    });

    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonD.id },
      { remaining_receivable: "0" },
      "D: 200+300 ödendi, remaining=0",
    );

    // 200'lük olanı sil
    await deletePayment(payD1.payment.id, ACTOR);

    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonD.id },
      { remaining_receivable: "200" },
      "D: 200'lük silindi, remaining=200",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // E. Silinmiş payment'ı tekrar sil → PAYMENT_NOT_FOUND
    // ─────────────────────────────────────────────────────────────────────────
    section("E — Silinmiş payment'ı tekrar sil → PAYMENT_NOT_FOUND");

    await assertRejects(
      () => deletePayment(payD1.payment.id, ACTOR),
      "PAYMENT_NOT_FOUND",
      "E: zaten silinmiş payment tekrar silinemez",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // F. Product sale 300 + iban 300 → delete → remaining=300
    // ─────────────────────────────────────────────────────────────────────────
    section("F — Product sale 300 + iban 300 → delete → remaining=300");

    const studentF = await createStudent({ fullName: "SMOKE12_F" });
    studentIds.push(studentF.id);

    const saleF = await createProductSale({
      studentId: studentF.id,
      soldAt: daysAgo(1),
      totalAmount: "300",
      note: "SMOKE12_F sale",
    });
    const payF = await createCashPayment({
      targetType: "product_sale",
      targetId: saleF.id,
      amount: "300",
      source: "iban",
      paidAt: isoNow(),
    });

    await assertViewRow(
      "v_product_sale_balances",
      { product_sale_id: saleF.id },
      { remaining_receivable: "0" },
      "F: payment öncesi remaining=0",
    );

    await deletePayment(payF.payment.id, ACTOR);

    await assertViewRow(
      "v_product_sale_balances",
      { product_sale_id: saleF.id },
      { remaining_receivable: "300" },
      "F: payment silindi, remaining=300",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // G. payment_deleted audit
    // ─────────────────────────────────────────────────────────────────────────
    section("G — payment_deleted audit log (actor + before yansıması)");

    await assertAuditLog({
      action: "payment_deleted",
      entityType: "payment",
      entityId: payF.payment.id,
      expectActorUserId: ACTOR,
    });

    ok("\nSMOKE 12 — TÜM ADIMLAR BAŞARILI ✓");
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
