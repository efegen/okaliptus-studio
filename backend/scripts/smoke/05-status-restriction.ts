/**
 * SMOKE 05 — Status Restriction (Yasak Geçişler)
 *
 * Senaryo (spec §2.2, §5.10, §7.10):
 *   1. completed → cancelled   : InvalidStatusTransitionError
 *   2. completed → no_show     : InvalidStatusTransitionError
 *   3. completed → scheduled   : InvalidStatusTransitionError
 *   4. changeLessonStatus ile completed'a geçiş: InvalidStatusTransitionError
 *      (completeLesson() kullanılmalı)
 *   5. scheduled → no_show     : serbest, başarılı
 *   6. scheduled → cancelled   : serbest, başarılı
 *   7. cancelled → completed   : completeLesson() ile serbest
 *   8. no_show → completed     : completeLesson() ile serbest
 *
 * CLEANUP: script sonunda tüm veriler soft-delete edilir.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/05-status-restriction.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import {
  createLesson,
  completeLesson,
  changeLessonStatus,
} from "../../src/services/lessons.service.js";
import {
  section, step, info, assert, assertEqual, assertRejects,
  cleanupSmoke, closePool, daysAgo,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];

  try {
    section("SMOKE 05 — Status Restriction (Yasak Geçişler)");

    step("Öğrenci oluşturuluyor (SMOKE_Student_05)...");
    const student = await createStudent({
      fullName: "SMOKE_Student_05",
    });
    studentIds.push(student.id);
    info("student.id", student.id);

    // ── Completed → cancelled / no_show / scheduled YASAK ─────────────────────
    step("Completed lesson oluşturuluyor (bu lessondan geri dönülemez)...");
    const lessonA = await createLesson({
      studentId: student.id,
      startsAt: daysAgo(5),
      mode: "onsite",
    });
    await completeLesson(lessonA.id);
    info("lessonA.id (completed)", lessonA.id);

    step("completed → cancelled deneniyor...");
    console.log("  BEKLENED: InvalidStatusTransitionError");
    await assertRejects(
      () => changeLessonStatus(lessonA.id, "cancelled"),
      "INVALID_STATUS_TRANSITION",
      "completed → cancelled yasak",
    );

    step("completed → no_show deneniyor...");
    console.log("  BEKLENED: InvalidStatusTransitionError");
    await assertRejects(
      () => changeLessonStatus(lessonA.id, "no_show"),
      "INVALID_STATUS_TRANSITION",
      "completed → no_show yasak",
    );

    step("completed → scheduled deneniyor...");
    console.log("  BEKLENED: InvalidStatusTransitionError");
    await assertRejects(
      () => changeLessonStatus(lessonA.id, "scheduled"),
      "INVALID_STATUS_TRANSITION",
      "completed → scheduled yasak",
    );

    step("changeLessonStatus ile scheduled → completed deneniyor (completeLesson kullanılmalı)...");
    console.log("  BEKLENED: InvalidStatusTransitionError (generic route completed'ı kabul etmez)");
    const lessonA2 = await createLesson({
      studentId: student.id,
      startsAt: daysAgo(4),
      mode: "online",
    });
    await assertRejects(
      () => changeLessonStatus(lessonA2.id, "completed"),
      "INVALID_STATUS_TRANSITION",
      "changeLessonStatus ile completed yasak (completeLesson kullanılmalı)",
    );

    // ── scheduled → no_show: SERBEST ─────────────────────────────────────────
    step("scheduled → no_show (serbest olmalı)...");
    console.log("  BEKLENED: status = 'no_show', completed_at = null");
    const lessonB = await createLesson({
      studentId: student.id,
      startsAt: daysAgo(3),
      mode: "onsite",
    });
    const noShow = await changeLessonStatus(lessonB.id, "no_show");
    assertEqual(noShow.status, "no_show", "lesson.status = 'no_show'");
    assert(noShow.completed_at === null, "completed_at = null (no_show'da boş)");
    info("lessonB.id (no_show)", lessonB.id);

    // ── scheduled → cancelled: SERBEST ────────────────────────────────────────
    step("scheduled → cancelled (serbest olmalı)...");
    console.log("  BEKLENED: status = 'cancelled'");
    const lessonC = await createLesson({
      studentId: student.id,
      startsAt: daysAgo(2),
      mode: "online",
    });
    const cancelled = await changeLessonStatus(lessonC.id, "cancelled");
    assertEqual(cancelled.status, "cancelled", "lesson.status = 'cancelled'");
    info("lessonC.id (cancelled)", lessonC.id);

    // ── cancelled → completed: completeLesson ile SERBEST ─────────────────────
    step("cancelled → completed (completeLesson ile serbest olmalı)...");
    console.log("  BEKLENED: status = 'completed', completed_at set");
    const doneC = await completeLesson(lessonC.id);
    assertEqual(doneC.status, "completed", "lesson.status = 'completed'");
    assert(doneC.completed_at !== null, "completed_at set (geç işaretleme)");
    info("lessonC tamamlandı (geç işaretleme)", doneC.completed_at);

    // ── no_show → completed: completeLesson ile SERBEST ──────────────────────
    step("no_show → completed (completeLesson ile serbest olmalı)...");
    console.log("  BEKLENED: status = 'completed', completed_at set");
    const doneB = await completeLesson(lessonB.id);
    assertEqual(doneB.status, "completed", "lesson.status = 'completed'");
    assert(doneB.completed_at !== null, "completed_at set");
    info("lessonB tamamlandı (no_show'dan döndü)", doneB.completed_at);

    // ── Completed lesson borç üretmedi mi (cancelled/no_show) ────────────────
    step("No_show ve cancelled dersler borç üretmemişti, şimdi completed → borç oluştuktan sonra durum?");
    console.log("  → Bu lesson completed OLDU (completeLesson ile), şimdi borç var.");
    console.log("  BEKLENED: lessonC ve lessonB artık completed, debt oluştu.");
    assertEqual(doneC.status, "completed", "lessonC finally completed");
    assertEqual(doneB.status, "completed", "lessonB finally completed");

    console.log("\n✅ SMOKE 05 — TÜM ADIMLAR BAŞARILI");

  } finally {
    await cleanupSmoke(studentIds);
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
