/**
 * SMOKE 03 — Partial Payment (§7.3)
 *
 * Senaryolar:
 *   A. 500 lesson + cash 200 → remaining 300
 *   B. + iban 300 → remaining 0
 *   C. ekstra 1 → reject
 *   D. Yeni lesson 500 + 200 + 301 → reject (state korunur, paid=200)
 *   E. Concurrency: aynı target Promise.all 150+150 → her ikisi serileştirilir, toplam 200+150+150=500
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/03-partial-payment.ts
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
    section("SMOKE 03 — Partial Payment");

    // ─────────────────────────────────────────────────────────────────────────
    // A + B + C: tek lesson üzerinde sıralı kısmi ödemeler
    // ─────────────────────────────────────────────────────────────────────────
    section("A/B/C — 500 lesson + cash 200 + iban 300 + reject 1");

    const studentA = await createStudent({ fullName: "SMOKE03_main" });
    studentIds.push(studentA.id);

    const lessonA = await createLesson({
      studentId: studentA.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonA.id);

    await createCashPayment({
      targetType: "lesson",
      targetId: lessonA.id,
      amount: "200",
      source: "cash",
      paidAt: isoNow(),
    });
    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonA.id },
      { remaining_receivable: "300" },
      "A: cash 200 → remaining 300",
    );

    await createCashPayment({
      targetType: "lesson",
      targetId: lessonA.id,
      amount: "300",
      source: "iban",
      paidAt: isoNow(),
    });
    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonA.id },
      { remaining_receivable: "0" },
      "B: iban 300 → remaining 0",
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
      "C: ekstra 1 TL reddedilir",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // D: 200 sonrası 301 reject, state 200'de
    // ─────────────────────────────────────────────────────────────────────────
    section("D — 200 sonrası 301 reject (>500-200=300), state korunur");

    const studentD = await createStudent({ fullName: "SMOKE03_D" });
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
    await assertRejects(
      () =>
        createCashPayment({
          targetType: "lesson",
          targetId: lessonD.id,
          amount: "301",
          source: "cash",
          paidAt: isoNow(),
        }),
      "OVERPAYMENT_NOT_ALLOWED",
      "D: 301 > 300 remaining, reddedilir",
    );
    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonD.id },
      { remaining_receivable: "300" },
      "D: state korundu (paid=200, remaining=300)",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // E: Concurrency — Promise.all 150+150 (FOR UPDATE serileştirme)
    // Total kapasite = 300 (remaining), ikisi de toplam 300'ü aşmamalı
    // ─────────────────────────────────────────────────────────────────────────
    section("E — Concurrency: Promise.all cash 150 + iban 150 (remaining=300)");

    const results = await Promise.allSettled([
      createCashPayment({
        targetType: "lesson",
        targetId: lessonD.id,
        amount: "150",
        source: "cash",
        paidAt: isoNow(),
      }),
      createCashPayment({
        targetType: "lesson",
        targetId: lessonD.id,
        amount: "150",
        source: "iban",
        paidAt: isoNow(),
      }),
    ]);
    const fulfilled = results.filter(r => r.status === "fulfilled").length;
    const rejected = results.filter(r => r.status === "rejected").length;
    info("fulfilled", fulfilled);
    info("rejected", rejected);
    // İkisinin de fulfilled olması beklenir (toplam 200+150+150=500=net)
    assertEqual(fulfilled, 2, "E: 150+150 ikisi de kabul (FOR UPDATE serileştirme)");
    assertEqual(rejected, 0, "E: hiçbiri overpayment'a düşmedi");

    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: lessonD.id },
      { remaining_receivable: "0" },
      "E: 200+150+150=500 → remaining=0",
    );

    ok("\nSMOKE 03 — TÜM ADIMLAR BAŞARILI ✓");
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
