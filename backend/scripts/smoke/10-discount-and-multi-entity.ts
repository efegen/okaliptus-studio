/**
 * SMOKE 10 — Multi-entity + Discount end-to-end
 *
 * A: basic lesson create (instructor/type/duration defaults)
 * B: completed + exact payment
 * C: partial payment
 * D: overpayment reject
 * E: discount apply → net, remaining, payment caps
 * F: discount edge case after partial payment
 * G: discount remove + audit trail
 * H: prepaid package (credit-covered, no payment allowed, discount forbidden)
 * I: KPI lesson_revenue uses net
 * J: activity feed includes lesson_discount_updated
 */

import { createStudent } from "../../src/services/students.service.js";
import {
  createLesson,
  completeLesson,
  setLessonDiscount,
} from "../../src/services/lessons.service.js";
import {
  createCashPayment,
  deletePayment,
} from "../../src/services/payments.service.js";
import { createPrepaidPackage } from "../../src/services/packages.service.js";
import { listStudentMovements } from "../../src/services/students.service.js";
import { getWeeklyKpi } from "../../src/services/kpi.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  info,
  assert,
  assertMoney,
  assertEqual,
  assertRejects,
  ok,
  cleanupSmoke,
  closePool,
  isoNow,
  daysAgo,
  nextSlotIso,
  overrideDefaultLessonTypePrice,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  // A–H senaryoları 900 TL baz fiyat üzerine kurulu; I senaryosunda 1000'e çıkıp geri dönüyoruz.
  const restorePrice = await overrideDefaultLessonTypePrice("900");

  try {
    section("SMOKE 10 — Multi-entity + Discount");

    // ─── Preflight: default seed ─────────────────────────────────────────────
    step("Default instructor + lesson_type seed kontrolü...");
    const seedCheck = await pool.query(`
      SELECT
        (SELECT id FROM instructors WHERE is_active AND deleted_at IS NULL ORDER BY id LIMIT 1) AS instr_id,
        (SELECT full_name FROM instructors WHERE is_active AND deleted_at IS NULL ORDER BY id LIMIT 1) AS instr_name,
        (SELECT id FROM lesson_types WHERE is_active AND deleted_at IS NULL ORDER BY id LIMIT 1) AS type_id,
        (SELECT name FROM lesson_types WHERE is_active AND deleted_at IS NULL ORDER BY id LIMIT 1) AS type_name,
        (SELECT default_duration_minutes FROM lesson_types WHERE is_active AND deleted_at IS NULL ORDER BY id LIMIT 1) AS default_dur
    `);
    const seed = seedCheck.rows[0];
    // Default instructor full_name PII'dir; bootstrap'ta .env üzerinden atanır.
    // Smoke test buna isim olarak değil, varlık olarak baksın yeter.
    assertEqual(typeof seed.instr_name, "string", "default instructor full_name (any string)");
    assertEqual(seed.type_name, "Yoga & Meditasyon", "default lesson_type name");
    assertEqual(Number(seed.default_dur), 60, "default lesson_type duration_minutes");

    // ─── A: Basic lesson create ──────────────────────────────────────────────
    section("A — Basic lesson create");
    const studentA = await createStudent({
      fullName: "SMOKE10_A",
    });
    studentIds.push(studentA.id);

    const lessonA = await createLesson({
      studentId: studentA.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    assertEqual(lessonA.instructor_id, seed.instr_id, "lesson.instructor_id = default");
    assertEqual(lessonA.lesson_type_id, seed.type_id, "lesson.lesson_type_id = default");
    assertEqual(Number(lessonA.duration_minutes), 60, "lesson.duration_minutes = 60");
    assertMoney(lessonA.discount_amount, "0", "lesson.discount_amount default 0");
    assertMoney(lessonA.price_snapshot, "900", "lesson.price_snapshot = lesson_type.default_price");

    // ─── B: Completed + exact payment ────────────────────────────────────────
    section("B — Completed + exact 900 TL payment");
    const studentB = await createStudent({ fullName: "SMOKE10_B"});
    studentIds.push(studentB.id);
    const lessonB = await createLesson({ studentId: studentB.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(lessonB.id);
    await createCashPayment({
      targetType: "lesson",
      targetId: lessonB.id,
      amount: "900",
      source: "cash",
      paidAt: isoNow(),
    });
    const balB = await pool.query<{ remaining_receivable: string; net_amount: string }>(
      `SELECT remaining_receivable, net_amount FROM v_lesson_balances WHERE lesson_id = $1`,
      [lessonB.id],
    );
    assertMoney(balB.rows[0].remaining_receivable, "0", "B: remaining_receivable = 0");
    assertMoney(balB.rows[0].net_amount, "900", "B: net_amount = 900");

    // ─── C: Partial payment ──────────────────────────────────────────────────
    section("C — Partial 300 TL payment → remaining 600");
    const studentC = await createStudent({ fullName: "SMOKE10_C"});
    studentIds.push(studentC.id);
    const lessonC = await createLesson({ studentId: studentC.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(lessonC.id);
    await createCashPayment({
      targetType: "lesson",
      targetId: lessonC.id,
      amount: "300",
      source: "iban",
      paidAt: isoNow(),
    });
    const balC = await pool.query<{ remaining_receivable: string }>(
      `SELECT remaining_receivable FROM v_lesson_balances WHERE lesson_id = $1`,
      [lessonC.id],
    );
    assertMoney(balC.rows[0].remaining_receivable, "600", "C: remaining_receivable = 600");

    // ─── D: Overpayment reject ───────────────────────────────────────────────
    section("D — Overpayment reject (901 > 900)");
    const studentD = await createStudent({ fullName: "SMOKE10_D"});
    studentIds.push(studentD.id);
    const lessonD = await createLesson({ studentId: studentD.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(lessonD.id);
    await assertRejects(
      () =>
        createCashPayment({
          targetType: "lesson",
          targetId: lessonD.id,
          amount: "901",
          source: "cash",
          paidAt: isoNow(),
        }),
      "OVERPAYMENT_NOT_ALLOWED",
      "D: 901 TL ödeme 900 TL dersi aşar",
    );
    const payCountD = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM payments WHERE lesson_id = $1 AND deleted_at IS NULL`,
      [lessonD.id],
    );
    assertEqual(payCountD.rows[0].c, "0", "D: hiç payment kaydedilmemiş");

    // ─── E: Discount apply ───────────────────────────────────────────────────
    section("E — Discount 200 TL → net 700, 700 kabul, 701 red");
    const studentE = await createStudent({ fullName: "SMOKE10_E"});
    studentIds.push(studentE.id);
    const lessonE = await createLesson({ studentId: studentE.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(lessonE.id);
    const dE = await setLessonDiscount({ lessonId: lessonE.id, discountAmount: "200" });
    assertMoney(dE.lesson.discount_amount, "200", "E: discount_amount = 200");
    const balE1 = await pool.query<{ net_amount: string; remaining_receivable: string }>(
      `SELECT net_amount, remaining_receivable FROM v_lesson_balances WHERE lesson_id = $1`,
      [lessonE.id],
    );
    assertMoney(balE1.rows[0].net_amount, "700", "E: net_amount = 700");
    assertMoney(balE1.rows[0].remaining_receivable, "700", "E: remaining_receivable = 700");

    await createCashPayment({
      targetType: "lesson",
      targetId: lessonE.id,
      amount: "700",
      source: "cash",
      paidAt: isoNow(),
    });
    ok("E: 700 TL ödeme kabul edildi");

    // After 700 paid, remaining = 0 so even 1 TL would overpay. Using a second
    // lesson to verify the 701 rejection cleanly.
    const lessonE2 = await createLesson({ studentId: studentE.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(lessonE2.id);
    await setLessonDiscount({ lessonId: lessonE2.id, discountAmount: "200" });
    await assertRejects(
      () =>
        createCashPayment({
          targetType: "lesson",
          targetId: lessonE2.id,
          amount: "701",
          source: "cash",
          paidAt: isoNow(),
        }),
      "OVERPAYMENT_NOT_ALLOWED",
      "E: 701 TL ödeme net 700 TL'yi aşar",
    );

    // ─── F: Discount edge case after partial payment ─────────────────────────
    section("F — paid=800: 100 TL discount kabul, 200 TL discount red");
    const studentF = await createStudent({ fullName: "SMOKE10_F"});
    studentIds.push(studentF.id);
    const lessonF = await createLesson({ studentId: studentF.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(lessonF.id);
    await createCashPayment({
      targetType: "lesson",
      targetId: lessonF.id,
      amount: "800",
      source: "cash",
      paidAt: isoNow(),
    });
    // 100 discount: net = 800 = paid → OK
    const dF1 = await setLessonDiscount({ lessonId: lessonF.id, discountAmount: "100" });
    assertMoney(dF1.lesson.discount_amount, "100", "F: 100 discount uygulandı");
    const balF1 = await pool.query<{ remaining_receivable: string }>(
      `SELECT remaining_receivable FROM v_lesson_balances WHERE lesson_id = $1`,
      [lessonF.id],
    );
    assertMoney(balF1.rows[0].remaining_receivable, "0", "F: 800 paid = 800 net, remaining = 0");

    // 200 discount: net = 700 < paid 800 → reject
    await assertRejects(
      () => setLessonDiscount({ lessonId: lessonF.id, discountAmount: "200" }),
      "DISCOUNT_WOULD_EXCEED_NET",
      "F: 200 discount → net 700 < paid 800 reddedilir",
    );
    // State unchanged
    const dFState = await pool.query<{ discount_amount: string }>(
      `SELECT discount_amount FROM lessons WHERE id = $1`,
      [lessonF.id],
    );
    assertMoney(dFState.rows[0].discount_amount, "100", "F: red sonrası discount hâlâ 100");

    // ─── G: Discount remove + audit ──────────────────────────────────────────
    section("G — Discount remove (0) + audit_logs event");
    const studentG = await createStudent({ fullName: "SMOKE10_G"});
    studentIds.push(studentG.id);
    const lessonG = await createLesson({ studentId: studentG.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(lessonG.id);
    await setLessonDiscount({ lessonId: lessonG.id, discountAmount: "150" });
    await setLessonDiscount({ lessonId: lessonG.id, discountAmount: "0" });
    const gRow = await pool.query<{ discount_amount: string }>(
      `SELECT discount_amount FROM lessons WHERE id = $1`,
      [lessonG.id],
    );
    assertMoney(gRow.rows[0].discount_amount, "0", "G: discount 0'a düşürüldü");

    const gAudits = await pool.query<{
      action: string;
      before: Record<string, string>;
      after: Record<string, string>;
    }>(
      `SELECT action, before, after FROM audit_logs
       WHERE entity_type = 'lesson' AND entity_id = $1
         AND action = 'lesson_discount_updated'
       ORDER BY id`,
      [lessonG.id],
    );
    assertEqual(gAudits.rows.length, 2, "G: 2 adet lesson_discount_updated audit satırı");
    assertMoney(gAudits.rows[0].before.discount_amount, "0", "G: ilk event before=0");
    assertMoney(gAudits.rows[0].after.discount_amount, "150", "G: ilk event after=150");
    assertMoney(gAudits.rows[1].before.discount_amount, "150", "G: ikinci event before=150");
    assertMoney(gAudits.rows[1].after.discount_amount, "0", "G: ikinci event after=0 (kaldırma)");

    // ─── H: Prepaid package ──────────────────────────────────────────────────
    section("H — Prepaid package: atomic create, credit-covered lesson, no payment, no discount");
    const studentH = await createStudent({ fullName: "SMOKE10_H"});
    studentIds.push(studentH.id);
    const pkg = await createPrepaidPackage({
      studentId: studentH.id,
      purchasedAt: daysAgo(5),
      creditCount: 2,
      unitPrice: "450",
      totalAmount: "900",
      source: "cash",
    });
    info("package.id", pkg.prepaidPackage.id);
    // Atomic: package + payment created in one call
    const pkgPay = await pool.query<{ id: string }>(
      `SELECT id FROM payments WHERE prepaid_package_id = $1 AND deleted_at IS NULL`,
      [pkg.prepaidPackage.id],
    );
    assertEqual(pkgPay.rows.length, 1, "H: package + payment atomik oluştu");

    const lessonH = await createLesson({
      studentId: studentH.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    const { lesson: completedH } = await completeLesson(lessonH.id);
    assertEqual(completedH.prepaid_package_id, pkg.prepaidPackage.id, "H: ders krediden kapandı");
    assertMoney(completedH.price_snapshot, "450", "H: price_snapshot = paket unit_price");
    assertMoney(completedH.discount_amount, "0", "H: paket dersinde discount=0");

    await assertRejects(
      () =>
        createCashPayment({
          targetType: "lesson",
          targetId: lessonH.id,
          amount: "10",
          source: "cash",
          paidAt: isoNow(),
        }),
      "PAYMENT_TARGET_MISMATCH",
      "H: kredi ile kapalı derse payment eklenemez",
    );

    await assertRejects(
      () => setLessonDiscount({ lessonId: lessonH.id, discountAmount: "50" }),
      "DISCOUNT_NOT_ALLOWED",
      "H: prepaid derse discount uygulanamaz",
    );

    // ─── I: KPI — lesson_revenue uses net ───────────────────────────────────
    section("I — KPI lesson revenue uses price_snapshot - discount_amount");
    // Use a brand-new student this week with a 1000 price lesson + 300 discount
    const studentI = await createStudent({ fullName: "SMOKE10_I"});
    studentIds.push(studentI.id);

    // Lesson starts_at must be within current ISO week (Europe/Istanbul) so KPI picks it up.
    // Use now-minus-1min to avoid future scheduling edge case but still in week.
    const lessonI = await createLesson({
      studentId: studentI.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonI.id);
    const kpiBefore = await getWeeklyKpi();
    await setLessonDiscount({ lessonId: lessonI.id, discountAmount: "300" });
    const kpiAfter = await getWeeklyKpi();
    const deltaLesson =
      parseFloat(kpiAfter.revenue.lesson) - parseFloat(kpiBefore.revenue.lesson);
    assertMoney(deltaLesson.toFixed(2), "-300.00", "I: discount 300 TL → lesson_revenue -300");
    assert(
      !("current_balance" in (kpiAfter as unknown as Record<string, unknown>)) &&
        !("studentLiability" in (kpiAfter as unknown as Record<string, unknown>)),
      "I: KPI payload'ında current_balance / studentLiability yok",
    );

    // ─── J: Activity feed includes discount events ──────────────────────────
    section("J — Activity feed (hareketler) includes lesson_discount_updated");
    const movements = await listStudentMovements(studentG.id);
    const discountEvents = movements.filter((m) => m.kind === "lesson_discount_updated");
    assertEqual(
      discountEvents.length,
      2,
      "J: G öğrencisinin hareketlerinde 2 discount olayı",
    );
    // Ensure each event has old_discount + new_discount in details
    for (const ev of discountEvents) {
      const d = ev.details as Record<string, unknown>;
      assert(
        typeof d.old_discount === "string" && typeof d.new_discount === "string",
        "J: discount event details has old_discount + new_discount",
      );
    }
    // Chronological order check — first event should be "uygulandı" (0→150),
    // second should be "kaldırıldı" (150→0); feed sorted DESC so [0] is latest.
    const [latest, earliest] = discountEvents;
    const ld = latest.details as Record<string, string>;
    const ed = earliest.details as Record<string, string>;
    assertMoney(ed.old_discount, "0", "J: ilk uygulama before=0");
    assertMoney(ed.new_discount, "150", "J: ilk uygulama after=150");
    assertMoney(ld.old_discount, "150", "J: kaldırma before=150");
    assertMoney(ld.new_discount, "0", "J: kaldırma after=0");

    // Cleanup note: we intentionally leave the discount-applied KPI lesson in
    // place until cleanupSmoke() runs — no further assertions need the data.
    void deletePayment;

    ok("\nSMOKE 10 — TÜM ADIMLAR BAŞARILI ✓");
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
