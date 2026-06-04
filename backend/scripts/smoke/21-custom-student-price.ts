/**
 * SMOKE 21 — Öğrenci × Ders Türü Bazında Özel (Sabit) Fiyat (migration 0238)
 *
 * Senaryolar:
 *   A. İki ders türü: "Ders" (default 500), "Etkinlik" (default 300). Öğrenci S.
 *   B. "Ders" türüne S için override = 0 (ücretsiz). createLesson(S, Ders) →
 *      price_snapshot = 0. completeLesson → net_amount = 0, borç yok.
 *      v_student_summary.lesson_debt = 0 (ücretsiz ders borç yaratmaz).
 *   C. createLesson(S, Etkinlik) (override yok) → price_snapshot = 300 (tam ücret).
 *   D. Edge: override "Ders" = 250 → yeni ders snapshot=250; sonra override 700'e
 *      → eski scheduled ders DOKUNULMAZ (250 kalır, snapshot invariantı §2.3).
 *   E. CASCADE: override'lı öğrenci hard-delete edilince override satırı da gider.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/21-custom-student-price.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import {
  createLessonType,
  setLessonTypeStudentPrice,
  listLessonTypeStudentPrices,
} from "../../src/services/lesson-types.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  assert,
  assertEqual,
  assertMoney,
  assertViewRow,
  ok,
  cleanupSmoke,
  closePool,
  nextSlotIso,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const typeIds: string[] = [];

  try {
    section("SMOKE 21 — Öğrenci × Ders Türü Özel Fiyat");

    // ─────────────────────────────────────────────────────────────────────────
    // A. İki ders türü + öğrenci
    // ─────────────────────────────────────────────────────────────────────────
    step("A — 'Ders' (500) + 'Etkinlik' (300) türleri, öğrenci S");
    const dersType = await createLessonType({
      name: "SMOKE21_Ders",
      default_duration_minutes: 60,
      default_price: 500,
    });
    const etkinlikType = await createLessonType({
      name: "SMOKE21_Etkinlik",
      default_duration_minutes: 60,
      default_price: 300,
    });
    typeIds.push(dersType.id, etkinlikType.id);

    const student = await createStudent({ fullName: "SMOKE21_main" });
    studentIds.push(student.id);

    // ─────────────────────────────────────────────────────────────────────────
    // B. "Ders" türüne override 0 → ücretsiz ders
    // ─────────────────────────────────────────────────────────────────────────
    step("B — 'Ders' türüne S için override = 0; ders ücretsiz, borç yok");
    await setLessonTypeStudentPrice(dersType.id, student.id, 0);

    const freeLesson = await createLesson({
      studentId: student.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
      lessonTypeId: dersType.id,
    });
    assertMoney(freeLesson.price_snapshot, "0", "B: ücretsiz ders snapshot=0");

    const { lesson: completedFree } = await completeLesson(freeLesson.id);
    assertMoney(completedFree.price_snapshot, "0", "B: tamamlanınca snapshot hâlâ 0");

    await assertViewRow(
      "v_lesson_balances",
      { lesson_id: freeLesson.id },
      { net_amount: "0", remaining_receivable: "0" },
      "B: net_amount=0, remaining_receivable=0 (takvim yeşil → ödeme beklenmez)",
    );

    await assertViewRow(
      "v_student_summary",
      { id: student.id },
      { lesson_debt: "0" },
      "B: lesson_debt=0 (ücretsiz ders borç yaratmaz)",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // C. "Etkinlik" türünde override yok → tam ücret
    // ─────────────────────────────────────────────────────────────────────────
    step("C — Aynı öğrenci 'Etkinlik' türünde override'sız → tam ücret 300");
    const eventLesson = await createLesson({
      studentId: student.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
      lessonTypeId: etkinlikType.id,
    });
    assertMoney(eventLesson.price_snapshot, "300", "C: etkinlik snapshot=300 (tam ücret)");

    // ─────────────────────────────────────────────────────────────────────────
    // D. Edge: override değişimi scheduled dersi etkilemez (snapshot invariantı)
    // ─────────────────────────────────────────────────────────────────────────
    step("D — override 250 → ders 250; override 700 → eski scheduled ders 250 kalır");
    await setLessonTypeStudentPrice(dersType.id, student.id, 250);
    const lesson250 = await createLesson({
      studentId: student.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
      lessonTypeId: dersType.id,
    });
    assertMoney(lesson250.price_snapshot, "250", "D: override 250 → snapshot=250");

    await setLessonTypeStudentPrice(dersType.id, student.id, 700);
    const recheck = await pool.query<{ price_snapshot: string; status: string }>(
      `SELECT price_snapshot, status FROM lessons WHERE id = $1`,
      [lesson250.id],
    );
    assertEqual(recheck.rows[0].status, "scheduled", "D: ders hâlâ scheduled");
    assertMoney(recheck.rows[0].price_snapshot, "250", "D: scheduled snapshot dokunulmaz (250)");

    // Yeni ders artık 700 alır
    const lesson700 = await createLesson({
      studentId: student.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
      lessonTypeId: dersType.id,
    });
    assertMoney(lesson700.price_snapshot, "700", "D: yeni ders güncel override=700 alır");

    // ─────────────────────────────────────────────────────────────────────────
    // E. CASCADE: öğrenci hard-delete → override satırı da silinir
    // ─────────────────────────────────────────────────────────────────────────
    step("E — Override'lı öğrenci hard-delete → override CASCADE ile gider");
    const tempStudent = await createStudent({ fullName: "SMOKE21_cascade" });
    await setLessonTypeStudentPrice(etkinlikType.id, tempStudent.id, 123);

    const before = await listLessonTypeStudentPrices(etkinlikType.id);
    assert(
      before.some((r) => r.student_id === tempStudent.id),
      "E: hard-delete öncesi override mevcut",
    );

    await pool.query(`DELETE FROM students WHERE id = $1`, [tempStudent.id]);

    const leftover = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM lesson_type_student_prices WHERE student_id = $1`,
      [tempStudent.id],
    );
    assertEqual(leftover.rows[0].c, "0", "E: öğrenci silinince override CASCADE ile gitti");

    ok("\nSMOKE 21 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    await cleanupSmoke(studentIds);
    // Test ders türlerini ve override'larını temizle (cleanupSmoke kapsamı dışı).
    if (typeIds.length > 0) {
      await pool.query(
        `DELETE FROM lesson_type_student_prices WHERE lesson_type_id = ANY($1::bigint[])`,
        [typeIds],
      );
      await pool.query(
        `UPDATE lesson_types SET deleted_at = now(), is_active = false WHERE id = ANY($1::bigint[])`,
        [typeIds],
      );
    }
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
