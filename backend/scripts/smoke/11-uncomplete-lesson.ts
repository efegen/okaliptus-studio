/**
 * SMOKE 11 — Uncomplete Lesson (v1.4, §5.7b)
 *
 * Senaryolar:
 *   A. Happy: ödemesiz/paketsiz completed lesson → uncomplete → scheduled,
 *      completed_at NULL, prepaid_package_id NULL, audit lesson_uncompleted.
 *   B. actorUserId taşınması → audit_logs.actor_user_id doğru.
 *   C. Reject: aktif ödeme varken uncomplete denemesi.
 *   D. Reject: 24 saatten eski (Direct SQL ile completed_at backdate).
 *   E. Reject: zaten scheduled olan ders.
 *   F. Bağlı satış (ödemesiz) — uncomplete sonrası satış soft-delete edilir.
 *   G. Reject: bağlı satışın ödemesi varken uncomplete.
 *   H. Paket kredisi iadesi (KRİTİK): paket dersinde uncomplete → kredi geri gelir.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/11-uncomplete-lesson.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import {
  createLesson,
  completeLesson,
  uncompleteLesson,
} from "../../src/services/lessons.service.js";
import {
  createCashPayment,
  deletePayment,
} from "../../src/services/payments.service.js";
import { createPrepaidPackage } from "../../src/services/packages.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  info,
  assert,
  assertEqual,
  assertMoney,
  assertRejects,
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
  const ACTOR_USER_ID = await getActorUserId();
  if (ACTOR_USER_ID === null) {
    throw new Error("SMOKE 11: bootstrap admin yok — testler için actor gerekli");
  }

  try {
    section("SMOKE 11 — Uncomplete Lesson (v1.4)");

    // ─────────────────────────────────────────────────────────────────────────
    // A. Happy path — paymentless, packageless
    // ─────────────────────────────────────────────────────────────────────────
    section("A — Happy path: ödemesiz/paketsiz uncomplete");

    const studentA = await createStudent({ fullName: "SMOKE11_A" });
    studentIds.push(studentA.id);
    const lessonA = await createLesson({
      studentId: studentA.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonA.id);
    info("lessonA.id", lessonA.id);

    const reverted = await uncompleteLesson(lessonA.id, ACTOR_USER_ID);
    assertEqual(reverted.status, "scheduled", "A: status='scheduled' (geri alındı)");
    assertEqual(reverted.completed_at, null, "A: completed_at NULL");
    assertEqual(reverted.prepaid_package_id, null, "A: prepaid_package_id NULL");
    assertMoney(reverted.price_snapshot, "500", "A: price_snapshot korundu");

    await assertAuditLog({
      action: "lesson_uncompleted",
      entityType: "lesson",
      entityId: lessonA.id,
      expectActorUserId: ACTOR_USER_ID,
      expectBeforeContains: { status: "completed" },
      expectAfterContains: { status: "scheduled" },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // B. actor_user_id propagation already tested in A; explicit nullability test
    // ─────────────────────────────────────────────────────────────────────────
    section("B — actor_user_id NULL bırakıldığında audit'a NULL yazılır");

    const studentB = await createStudent({ fullName: "SMOKE11_B" });
    studentIds.push(studentB.id);
    const lessonB = await createLesson({
      studentId: studentB.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonB.id);
    await uncompleteLesson(lessonB.id /* no actor */);
    await assertAuditLog({
      action: "lesson_uncompleted",
      entityType: "lesson",
      entityId: lessonB.id,
      expectActorUserId: null,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // C. Reject — active payment exists
    // ─────────────────────────────────────────────────────────────────────────
    section("C — Aktif ödeme varken uncomplete reddedilir");

    const studentC = await createStudent({ fullName: "SMOKE11_C" });
    studentIds.push(studentC.id);
    const lessonC = await createLesson({
      studentId: studentC.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonC.id);
    const payC = await createCashPayment({
      targetType: "lesson",
      targetId: lessonC.id,
      amount: "500",
      source: "cash",
      paidAt: isoNow(),
    });
    await assertRejects(
      () => uncompleteLesson(lessonC.id, ACTOR_USER_ID),
      "INVALID_STATUS_TRANSITION",
      "C: aktif ödeme varken uncomplete reddedilir",
    );
    // Lesson hâlâ completed
    const cState = await pool.query<{ status: string }>(
      `SELECT status FROM lessons WHERE id = $1`,
      [lessonC.id],
    );
    assertEqual(cState.rows[0].status, "completed", "C: lesson hâlâ completed");

    // Cleanup için ödemeyi sil — sonra uncomplete'e izin verilmeli
    await deletePayment(payC.payment.id);
    const recovered = await uncompleteLesson(lessonC.id, ACTOR_USER_ID);
    assertEqual(recovered.status, "scheduled", "C: ödeme silindikten sonra uncomplete OK");

    // ─────────────────────────────────────────────────────────────────────────
    // D. Reject — older than 24h
    // ─────────────────────────────────────────────────────────────────────────
    section("D — 24 saatten eski tamamlama uncomplete edilemez");

    const studentD = await createStudent({ fullName: "SMOKE11_D" });
    studentIds.push(studentD.id);
    const lessonD = await createLesson({
      studentId: studentD.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonD.id);
    // Direct SQL: completed_at'ı 25 saat öncesine çek
    await pool.query(
      `UPDATE lessons SET completed_at = now() - interval '25 hours' WHERE id = $1`,
      [lessonD.id],
    );
    await assertRejects(
      () => uncompleteLesson(lessonD.id, ACTOR_USER_ID),
      "INVALID_STATUS_TRANSITION",
      "D: 24h+ tamamlama reddedilir",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // E. Reject — already scheduled
    // ─────────────────────────────────────────────────────────────────────────
    section("E — Scheduled (zaten geri alınmış / hiç tamamlanmamış) ders");

    const studentE = await createStudent({ fullName: "SMOKE11_E" });
    studentIds.push(studentE.id);
    const lessonE = await createLesson({
      studentId: studentE.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    // Hiç completeLesson çağrılmadı; status='scheduled'
    await assertRejects(
      () => uncompleteLesson(lessonE.id, ACTOR_USER_ID),
      "INVALID_STATUS_TRANSITION",
      "E: scheduled lesson uncomplete edilemez",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // F. Bağlı ürün satışı (ödemesiz) — uncomplete sonrası soft-delete
    // ─────────────────────────────────────────────────────────────────────────
    section("F — Bağlı ürün satışı (ödemesiz) → uncomplete satışı soft-deletes");

    const studentF = await createStudent({ fullName: "SMOKE11_F" });
    studentIds.push(studentF.id);
    const lessonF = await createLesson({
      studentId: studentF.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    const completeF = await completeLesson(
      lessonF.id,
      { productSale: { totalAmount: "150", note: "SMOKE11_F sale" } },
      ACTOR_USER_ID,
    );
    assert(completeF.product_sale_id !== null, "F: completeLesson product_sale_id döndü");
    info("F: product_sale_id", completeF.product_sale_id);

    await uncompleteLesson(lessonF.id, ACTOR_USER_ID);

    const fSaleState = await pool.query<{ deleted_at: string | null }>(
      `SELECT deleted_at FROM product_sales WHERE id = $1`,
      [completeF.product_sale_id!],
    );
    assert(
      fSaleState.rows[0].deleted_at !== null,
      "F: bağlı product_sale soft-delete edilmiş (deleted_at != null)",
    );

    const fLessonState = await pool.query<{ status: string }>(
      `SELECT status FROM lessons WHERE id = $1`,
      [lessonF.id],
    );
    assertEqual(fLessonState.rows[0].status, "scheduled", "F: lesson scheduled'a döndü");

    // ─────────────────────────────────────────────────────────────────────────
    // G. Reject — bağlı satışın ödemesi var
    // ─────────────────────────────────────────────────────────────────────────
    section("G — Bağlı satışın ödemesi varken uncomplete reddedilir");

    const studentG = await createStudent({ fullName: "SMOKE11_G" });
    studentIds.push(studentG.id);
    const lessonG = await createLesson({
      studentId: studentG.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    const completeG = await completeLesson(
      lessonG.id,
      { productSale: { totalAmount: "200", note: "SMOKE11_G sale" } },
      ACTOR_USER_ID,
    );
    // Satışa ödeme yap
    const payG = await createCashPayment({
      targetType: "product_sale",
      targetId: completeG.product_sale_id!,
      amount: "200",
      source: "cash",
      paidAt: isoNow(),
    });
    await assertRejects(
      () => uncompleteLesson(lessonG.id, ACTOR_USER_ID),
      "INVALID_STATUS_TRANSITION",
      "G: bağlı satış ödemeli iken uncomplete reddedilir",
    );
    // State korundu
    const gLesson = await pool.query<{ status: string }>(
      `SELECT status FROM lessons WHERE id = $1`,
      [lessonG.id],
    );
    assertEqual(gLesson.rows[0].status, "completed", "G: lesson hâlâ completed");

    // Cleanup için ödemeyi sil
    await deletePayment(payG.payment.id);

    // ─────────────────────────────────────────────────────────────────────────
    // H. Paket kredisi iadesi (KRİTİK) — uncomplete sonrası kredi geri gelir
    // ─────────────────────────────────────────────────────────────────────────
    section("H — Paket dersinde uncomplete: kredi geri yüklenir");

    const studentH = await createStudent({ fullName: "SMOKE11_H" });
    studentIds.push(studentH.id);

    const pkgH = await createPrepaidPackage({
      studentId: studentH.id,
      purchasedAt: daysAgo(2),
      creditCount: 2,
      unitPrice: "500",
      totalAmount: "1000",
      source: "cash",
      actorUserId: ACTOR_USER_ID,
    });
    info("pkgH.id", pkgH.prepaidPackage.id);

    const lessonH = await createLesson({
      studentId: studentH.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    const completedH = await completeLesson(lessonH.id, {}, ACTOR_USER_ID);
    assertEqual(
      completedH.lesson.prepaid_package_id,
      pkgH.prepaidPackage.id,
      "H: lesson krediden kapandı (prepaid_package_id set)",
    );

    // Paketten 1 kredi düşmeli → remaining_credits = 1
    const beforeUncomplete = await pool.query<{ remaining_credits: string }>(
      `SELECT remaining_credits FROM v_prepaid_package_status WHERE package_id = $1`,
      [pkgH.prepaidPackage.id],
    );
    assertEqual(
      beforeUncomplete.rows[0].remaining_credits,
      "1",
      "H: completion sonrası remaining_credits = 1",
    );

    // Uncomplete → prepaid_package_id NULL → view yeniden hesaplar → remaining_credits = 2
    const uncompletedH = await uncompleteLesson(lessonH.id, ACTOR_USER_ID);
    assertEqual(uncompletedH.prepaid_package_id, null, "H: uncomplete sonrası prepaid_package_id NULL");
    assertEqual(uncompletedH.status, "scheduled", "H: status scheduled");

    const afterUncomplete = await pool.query<{ remaining_credits: string }>(
      `SELECT remaining_credits FROM v_prepaid_package_status WHERE package_id = $1`,
      [pkgH.prepaidPackage.id],
    );
    assertEqual(
      afterUncomplete.rows[0].remaining_credits,
      "2",
      "H: uncomplete sonrası remaining_credits = 2 (KRİTİK: kredi geri yüklendi)",
    );

    ok("\nSMOKE 11 — TÜM ADIMLAR BAŞARILI ✓");
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
