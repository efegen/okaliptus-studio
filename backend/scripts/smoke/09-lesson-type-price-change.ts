/**
 * SMOKE 09 — Lesson Type Price Change (§7.6)
 *
 * Senaryolar:
 *   A. lesson_type.default_price = 500. L1 (scheduled) snapshot=500.
 *   B. completeLesson(L1) → snapshot hâlâ 500.
 *   C. Direct SQL ile fiyat 600. L1 snapshot dokunulmadı (completed).
 *   D. Yeni L2 oluştur → snapshot=600 (yeni fiyat).
 *   E. L2 hâlâ scheduled iken fiyat 700'e → L2 snapshot DOKUNULMAZ (scheduled
 *      snapshot da değişmez — §2.3, spec §7.6).
 *   F. Edge: fiyatı 0'a çek + discount=50 → ValidationError (discount > price).
 *
 * Tek aktif type pasifleştirme senaryosu (§7.11.4) burada test edilmez —
 * bootstrap default seed'i kontaminate etmemek için. SMOKE 13/14'e bırakıldı.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/09-lesson-type-price-change.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import {
  createLesson,
  completeLesson,
  setLessonDiscount,
} from "../../src/services/lessons.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  info,
  assert,
  assertEqual,
  assertMoney,
  assertRejects,
  ok,
  cleanupSmoke,
  closePool,
  daysAgo,
  nextSlotIso,
  overrideDefaultLessonTypePrice,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const restorePrice = await overrideDefaultLessonTypePrice("500");

  try {
    section("SMOKE 09 — Lesson Type Price Change");

    const student = await createStudent({ fullName: "SMOKE09_main" });
    studentIds.push(student.id);

    // ─────────────────────────────────────────────────────────────────────────
    // A. L1 scheduled @ 500
    // ─────────────────────────────────────────────────────────────────────────
    step("A — L1 scheduled, snapshot=500");
    const lessonL1 = await createLesson({
      studentId: student.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    assertMoney(lessonL1.price_snapshot, "500", "A: L1 snapshot=500");

    // ─────────────────────────────────────────────────────────────────────────
    // B. Complete L1 — snapshot hâlâ 500
    // ─────────────────────────────────────────────────────────────────────────
    step("B — completeLesson(L1) → snapshot dokunulmaz");
    const { lesson: completedL1 } = await completeLesson(lessonL1.id);
    assertMoney(completedL1.price_snapshot, "500", "B: L1 completed snapshot=500");

    // ─────────────────────────────────────────────────────────────────────────
    // C. Fiyatı 600'e çek — L1 snapshot dokunulmaz (completed)
    // ─────────────────────────────────────────────────────────────────────────
    step("C — Direct SQL: lesson_types.default_price=600 → L1 snapshot=500");
    const typeIdRes = await pool.query<{ id: string }>(
      `SELECT id FROM lesson_types WHERE is_active AND deleted_at IS NULL ORDER BY id LIMIT 1`,
    );
    const typeId = typeIdRes.rows[0].id;

    await pool.query(
      `UPDATE lesson_types SET default_price = 600 WHERE id = $1`,
      [typeId],
    );

    const l1Recheck = await pool.query<{ price_snapshot: string }>(
      `SELECT price_snapshot FROM lessons WHERE id = $1`,
      [lessonL1.id],
    );
    assertMoney(l1Recheck.rows[0].price_snapshot, "500", "C: L1 snapshot dokunulmadı");

    // ─────────────────────────────────────────────────────────────────────────
    // D. Yeni L2 → snapshot=600
    // ─────────────────────────────────────────────────────────────────────────
    step("D — Yeni L2 createLesson → snapshot=600 (yeni fiyat)");
    const lessonL2 = await createLesson({
      studentId: student.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    assertMoney(lessonL2.price_snapshot, "600", "D: L2 snapshot=600");

    // ─────────────────────────────────────────────────────────────────────────
    // E. Fiyatı 700'e çek — L2 (scheduled) snapshot dokunulmaz
    // ─────────────────────────────────────────────────────────────────────────
    step("E — Fiyat 700; L2 scheduled snapshot=600 (dokunulmaz)");
    await pool.query(
      `UPDATE lesson_types SET default_price = 700 WHERE id = $1`,
      [typeId],
    );

    const l2Recheck = await pool.query<{ price_snapshot: string; status: string }>(
      `SELECT price_snapshot, status FROM lessons WHERE id = $1`,
      [lessonL2.id],
    );
    assertEqual(l2Recheck.rows[0].status, "scheduled", "E: L2 hâlâ scheduled");
    assertMoney(l2Recheck.rows[0].price_snapshot, "600", "E: L2 scheduled snapshot=600 dokunulmaz");

    // ─────────────────────────────────────────────────────────────────────────
    // F. Edge: fiyat 0 + discount=50 → ValidationError (discount > price)
    // ─────────────────────────────────────────────────────────────────────────
    step("F — Fiyat 0 + completed lesson + discount=50 → ValidationError");
    await pool.query(
      `UPDATE lesson_types SET default_price = 0 WHERE id = $1`,
      [typeId],
    );

    const studentF = await createStudent({ fullName: "SMOKE09_F" });
    studentIds.push(studentF.id);
    const lessonL3 = await createLesson({
      studentId: studentF.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    assertMoney(lessonL3.price_snapshot, "0", "F: L3 snapshot=0");
    await completeLesson(lessonL3.id);

    await assertRejects(
      () => setLessonDiscount({ lessonId: lessonL3.id, discountAmount: "50" }),
      "VALIDATION_ERROR",
      "F: discount 50 > price 0 reddedilir",
    );

    ok("\nSMOKE 09 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    await cleanupSmoke(studentIds);
    // overrideDefaultLessonTypePrice restore: orijinal default_price'a döner
    await restorePrice();
    await closePool();
  }
}

run().catch(err => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
