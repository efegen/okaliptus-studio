/**
 * SMOKE 16 — Net Amount Edge Cases (§2.12)
 *
 * Senaryolar:
 *   A. discount = price → net=0; payment 1 → OVERPAYMENT_NOT_ALLOWED
 *   B. payment = net (fully paid): price 500, discount 100 → net 400; payment 400 OK; ekstra 1 → reject
 *   C. paid > net-discount: paid=300, sonra discount=250 dene → DISCOUNT_WOULD_EXCEED_NET; state=0 korunur
 *   D. Çoklu payment + discount: 200 cash + 200 iban → discount 100 (paid=400=net) → kabul
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/16-net-amount-edge-cases.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import {
  createLesson,
  completeLesson,
  setLessonDiscount,
} from "../../src/services/lessons.service.js";
import { createCashPayment } from "../../src/services/payments.service.js";
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
  ok,
  cleanupSmoke,
  closePool,
  daysAgo,
  isoNow,
  nextSlotIso,
  overrideDefaultLessonTypePrice,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const restorePrice = await overrideDefaultLessonTypePrice("500");

  try {
    section("SMOKE 16 — Net Amount Edge Cases");

    // ─────────────────────────────────────────────────────────────────────────
    // A. discount = price → net = 0
    // ─────────────────────────────────────────────────────────────────────────
    section("A — discount=500 = price → net=0; payment 1 reddedilir");

    const studentA = await createStudent({ fullName: "SMOKE16_A" });
    studentIds.push(studentA.id);

    const lessonA = await createLesson({
      studentId: studentA.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonA.id);
    await setLessonDiscount({ lessonId: lessonA.id, discountAmount: "500" });

    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonA.id },
      { net_amount: "0", remaining_receivable: "0" },
      "A: net_amount=0, remaining=0",
    );

    await assertRejects(
      () =>
        createCashPayment({
          targetType: "lesson",
          targetId: lessonA.id,
          amount: "1",
          source: "cash",
          paidAt: isoNow(),
        }),
      "OVERPAYMENT_NOT_ALLOWED",
      "A: net=0 derse 1 TL ödeme reddedilir",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // B. payment = net (fully paid)
    // ─────────────────────────────────────────────────────────────────────────
    section("B — discount=100 → net=400; payment 400 OK, ekstra 1 reddedilir");

    const studentB = await createStudent({ fullName: "SMOKE16_B" });
    studentIds.push(studentB.id);

    const lessonB = await createLesson({
      studentId: studentB.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonB.id);
    await setLessonDiscount({ lessonId: lessonB.id, discountAmount: "100" });

    await createCashPayment({
      targetType: "lesson",
      targetId: lessonB.id,
      amount: "400",
      source: "cash",
      paidAt: isoNow(),
    });
    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonB.id },
      { remaining_receivable: "0" },
      "B: payment=net=400, remaining=0",
    );

    await assertRejects(
      () =>
        createCashPayment({
          targetType: "lesson",
          targetId: lessonB.id,
          amount: "1",
          source: "cash",
          paidAt: isoNow(),
        }),
      "OVERPAYMENT_NOT_ALLOWED",
      "B: ekstra 1 TL → reject",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // C. paid > net-discount: discount artırma denemesi reddedilir
    // ─────────────────────────────────────────────────────────────────────────
    section("C — paid=300, discount 250 → DISCOUNT_WOULD_EXCEED_NET; state korunur");

    const studentC = await createStudent({ fullName: "SMOKE16_C" });
    studentIds.push(studentC.id);

    const lessonC = await createLesson({
      studentId: studentC.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonC.id);
    await createCashPayment({
      targetType: "lesson",
      targetId: lessonC.id,
      amount: "300",
      source: "cash",
      paidAt: isoNow(),
    });

    await assertRejects(
      () => setLessonDiscount({ lessonId: lessonC.id, discountAmount: "250" }),
      "DISCOUNT_WOULD_EXCEED_NET",
      "C: paid=300, discount 250 → net 250 < paid 300 reddedilir",
    );

    // State: discount hâlâ 0
    const cState = await pool.query<{ discount_amount: string }>(
      `SELECT discount_amount FROM lessons WHERE id = $1`,
      [lessonC.id],
    );
    assertMoney(cState.rows[0].discount_amount, "0", "C: red sonrası discount 0'da kalır");

    // ─────────────────────────────────────────────────────────────────────────
    // D. Çoklu payment + discount tam eşitlik
    // ─────────────────────────────────────────────────────────────────────────
    section("D — 200 cash + 200 iban → discount 100 (paid=400=net) kabul");

    const studentD = await createStudent({ fullName: "SMOKE16_D" });
    studentIds.push(studentD.id);

    const lessonD = await createLesson({
      studentId: studentD.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonD.id);

    await createCashPayment({
      targetType: "lesson",
      targetId: lessonD.id,
      amount: "200",
      source: "cash",
      paidAt: isoNow(),
    });
    await createCashPayment({
      targetType: "lesson",
      targetId: lessonD.id,
      amount: "200",
      source: "iban",
      paidAt: isoNow(),
    });

    await setLessonDiscount({ lessonId: lessonD.id, discountAmount: "100" });
    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonD.id },
      { net_amount: "400", remaining_receivable: "0" },
      "D: paid=400=net, remaining=0",
    );

    ok("\nSMOKE 16 — TÜM ADIMLAR BAŞARILI ✓");
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
