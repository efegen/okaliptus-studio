/**
 * SMOKE 13 — DB-Level Invariants (§3.8 trigger'lar + CHECK constraint'ler)
 *
 * Servis katmanını BYPASS edip direkt SQL ile trigger'ların ve CHECK
 * constraint'lerin enforce edildiğini doğrular. Defense-in-depth: servis
 * mantığında bug olsa bile DB seviyesinde iş kuralları korunmalı.
 *
 * Senaryolar:
 *   A. Currency mismatch (trg_validate_payment_target) — payment 'USD' lesson 'TRY'
 *   B. Lesson credit coherence (trg_validate_lesson_credit) — başka öğrencinin paketi
 *   C. Package payment non-deletion (trg_block_package_payment_delete) — paket aktif
 *   D. updated_at auto-touch — trigger manuel SET'in üzerine yazıyor
 *   E. studio_settings singleton — id=2 reddedilir
 *   F. FK RESTRICT — student raw DELETE (lesson varken)
 *   G. chk_payments_single_target — lesson_id + product_sale_id ikisi birden
 *   H. chk_lessons_prepaid_no_discount — prepaid_package_id set + discount > 0
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/13-db-invariants.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import { createPrepaidPackage } from "../../src/services/packages.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  info,
  assert,
  assertEqual,
  assertSqlRejects,
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
    section("SMOKE 13 — DB-Level Invariants");

    // ─────────────────────────────────────────────────────────────────────────
    // A. Currency mismatch (trg_validate_payment_target)
    // ─────────────────────────────────────────────────────────────────────────
    section("A — Currency mismatch trigger (USD payment on TRY lesson)");

    const studentA = await createStudent({ fullName: "SMOKE13_A" });
    studentIds.push(studentA.id);
    const lessonA = await createLesson({
      studentId: studentA.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonA.id);

    await assertSqlRejects(
      () =>
        pool.query(
          `INSERT INTO payments (lesson_id, paid_at, amount, currency, source)
           VALUES ($1, now(), 500, 'USD', 'cash')`,
          [lessonA.id],
        ),
      "Currency mismatch",
      "A: USD payment TRY lesson'a → trigger reddediyor",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // B. Lesson credit coherence (trg_validate_lesson_credit)
    // ─────────────────────────────────────────────────────────────────────────
    section("B — Başka öğrencinin paketini lesson'a bağlama denemesi");

    const studentBOwner = await createStudent({ fullName: "SMOKE13_B_pkg_owner" });
    studentIds.push(studentBOwner.id);
    const pkgB = await createPrepaidPackage({
      studentId: studentBOwner.id,
      purchasedAt: daysAgo(2),
      creditCount: 2,
      unitPrice: "500",
      totalAmount: "1000",
      source: "cash",
    });
    info("pkgB.id (sahibi B_owner)", pkgB.prepaidPackage.id);

    const studentBStranger = await createStudent({ fullName: "SMOKE13_B_stranger" });
    studentIds.push(studentBStranger.id);
    const lessonB = await createLesson({
      studentId: studentBStranger.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });

    await assertSqlRejects(
      () =>
        pool.query(
          `UPDATE lessons
              SET prepaid_package_id = $1,
                  status = 'completed',
                  completed_at = now()
            WHERE id = $2`,
          [pkgB.prepaidPackage.id, lessonB.id],
        ),
      "Package student mismatch",
      "B: stranger'ın lesson'ına owner'ın paketi → trigger reddediyor",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // C. Package payment non-deletion (trg_block_package_payment_delete)
    // ─────────────────────────────────────────────────────────────────────────
    section("C — Paket aktifken bağlı payment'ı tek başına soft-delete denemesi");

    const studentC = await createStudent({ fullName: "SMOKE13_C" });
    studentIds.push(studentC.id);
    const pkgC = await createPrepaidPackage({
      studentId: studentC.id,
      purchasedAt: daysAgo(2),
      creditCount: 2,
      unitPrice: "500",
      totalAmount: "1000",
      source: "cash",
    });

    await assertSqlRejects(
      () =>
        pool.query(
          `UPDATE payments SET deleted_at = now()
            WHERE id = $1`,
          [pkgC.payment.id],
        ),
      "Cannot soft-delete payment bound to active prepaid_package",
      "C: paket aktif → payment direct delete reddediliyor",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // D. updated_at auto-touch (trg_touch_updated_at)
    // ─────────────────────────────────────────────────────────────────────────
    section("D — updated_at trigger: manuel SET üzerine yazılır");

    const studentD = await createStudent({ fullName: "SMOKE13_D" });
    studentIds.push(studentD.id);
    const t0Result = await pool.query<{ updated_at: string }>(
      `SELECT updated_at FROM students WHERE id = $1`,
      [studentD.id],
    );
    const t0 = t0Result.rows[0].updated_at;

    // 50ms bekle
    await new Promise(r => setTimeout(r, 50));

    // Manuel '1990-01-01' set + diğer kolon update → trigger now()'a çekmeli
    await pool.query(
      `UPDATE students SET full_name = $1, updated_at = '1990-01-01' WHERE id = $2`,
      ["SMOKE13_D_renamed", studentD.id],
    );
    const t1Result = await pool.query<{ updated_at: string }>(
      `SELECT updated_at FROM students WHERE id = $1`,
      [studentD.id],
    );
    const t1 = t1Result.rows[0].updated_at;

    assert(
      new Date(t1).getTime() > new Date(t0).getTime(),
      "D: updated_at trigger sonrası t1 > t0",
    );
    assert(
      new Date(t1).getFullYear() > 2020,
      `D: trigger '1990-01-01' manuel SET'i ezdi (got year ${new Date(t1).getFullYear()})`,
    );

    // ─────────────────────────────────────────────────────────────────────────
    // E. studio_settings singleton (CHECK id=1)
    // ─────────────────────────────────────────────────────────────────────────
    section("E — studio_settings singleton (id=2 reddedilir)");

    await assertSqlRejects(
      () =>
        pool.query(
          `INSERT INTO studio_settings (id, weekly_capacity) VALUES (2, 50)`,
        ),
      "studio_settings_id_check",
      "E: id=2 INSERT → CHECK constraint reddediyor",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // F. FK RESTRICT — student raw DELETE
    // ─────────────────────────────────────────────────────────────────────────
    section("F — FK RESTRICT: student raw DELETE (lesson referansı varken)");

    const studentF = await createStudent({ fullName: "SMOKE13_F" });
    studentIds.push(studentF.id);
    await createLesson({
      studentId: studentF.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });

    // BEGIN ... ROLLBACK ile sarmala — başarısızlık session'ı bozmasın
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assertSqlRejects(
        () =>
          client.query(
            `DELETE FROM students WHERE id = $1`,
            [studentF.id],
          ),
        "violates foreign key",
        "F: student raw DELETE → FK RESTRICT ihlali",
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // G. chk_payments_single_target (XOR)
    // ─────────────────────────────────────────────────────────────────────────
    section("G — payments XOR: lesson_id + product_sale_id ikisi birden");

    const studentG = await createStudent({ fullName: "SMOKE13_G" });
    studentIds.push(studentG.id);
    const lessonG = await createLesson({
      studentId: studentG.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonG.id);

    // Önce gerçek bir product_sale gerekiyor (FK için)
    const saleG = await pool.query<{ id: string }>(
      `INSERT INTO product_sales (student_id, sold_at, total_amount, currency)
       VALUES ($1, now(), 100, 'TRY') RETURNING id`,
      [studentG.id],
    );

    await assertSqlRejects(
      () =>
        pool.query(
          `INSERT INTO payments (lesson_id, product_sale_id, paid_at, amount, currency, source)
           VALUES ($1, $2, now(), 50, 'TRY', 'cash')`,
          [lessonG.id, saleG.rows[0].id],
        ),
      "chk_payments_single_target",
      "G: lesson_id + product_sale_id birlikte → XOR CHECK reddediyor",
    );

    // Cleanup için sale'ı soft-delete et
    await pool.query(
      `UPDATE product_sales SET deleted_at = now() WHERE id = $1`,
      [saleG.rows[0].id],
    );

    // ─────────────────────────────────────────────────────────────────────────
    // H. chk_lessons_prepaid_no_discount
    // ─────────────────────────────────────────────────────────────────────────
    section("H — Paket dersine discount: chk_lessons_prepaid_no_discount");

    const studentH = await createStudent({ fullName: "SMOKE13_H" });
    studentIds.push(studentH.id);
    const pkgH = await createPrepaidPackage({
      studentId: studentH.id,
      purchasedAt: daysAgo(2),
      creditCount: 2,
      unitPrice: "500",
      totalAmount: "1000",
      source: "cash",
    });
    const lessonH = await createLesson({
      studentId: studentH.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonH.id); // paketten kapanır

    // Şu an prepaid_package_id set, discount=0. discount=50 yapmaya çalış
    await assertSqlRejects(
      () =>
        pool.query(
          `UPDATE lessons SET discount_amount = 50 WHERE id = $1`,
          [lessonH.id],
        ),
      "chk_lessons_prepaid_no_discount",
      "H: paket dersinde discount > 0 → CHECK reddediyor",
    );

    void pkgH;
    ok("\nSMOKE 13 — TÜM DB INVARIANT'LARI DOĞRULANDI ✓");
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
