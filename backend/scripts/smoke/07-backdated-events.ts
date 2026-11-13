/**
 * SMOKE 07 — Backdated Events (§7.5)
 *
 * Strateji: delta-based KPI snapshot.
 *   1. kpiBefore al
 *   2. daysAgo(35) ile completed lesson + payment ekle
 *   3. kpiAfter al → cash_inflow + revenue deltası 0 olmalı
 *   4. Cari hafta lesson + payment ekle → delta artmalı. Ders, tamamlanabilmesi
 *      için (MIN_MINUTES_AFTER_START_TO_COMPLETE) 25 dk önce başlar; hafta
 *      sınırına çok yakınsa bu adım atlanır.
 *
 * Geçmiş tarihli olay cari hafta KPI'sine akmaz; cari hafta olay akar.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/07-backdated-events.ts
 */

import { pool } from "../../src/db/connection.js";
import { createStudent } from "../../src/services/students.service.js";
import {
  createLesson,
  completeLesson,
  MIN_MINUTES_AFTER_START_TO_COMPLETE,
} from "../../src/services/lessons.service.js";
import { createCashPayment } from "../../src/services/payments.service.js";
import { getWeeklyKpi } from "../../src/services/kpi.service.js";
import {
  section,
  step,
  info,
  assert,
  assertMoney,
  ok,
  cleanupSmoke,
  closePool,
  daysAgo,
  isoNow,
  overrideDefaultLessonTypePrice,
} from "./_shared.js";

function delta(after: string, before: string): number {
  return parseFloat(after) - parseFloat(before);
}

// completeLesson, ders başladıktan MIN_MINUTES_AFTER_START_TO_COMPLETE dakika
// geçmeden tamamlamayı reddeder; cari hafta dersi bu kadar (+5 dk pay) önce başlar.
const CURRENT_LESSON_OFFSET_MS = -(MIN_MINUTES_AFTER_START_TO_COMPLETE + 5) * 60_000;
const WEEK_BOUNDARY_GUARD_SECONDS = 300;

/**
 * Ciro dersin starts_at'ine, tahsilat paid_at'ine göre haftaya yazılır.
 * Pazartesi 00:00'dan hemen sonra (ders geçen haftada kalır) ya da hafta
 * bitmek üzereyken (ölçümler arası hafta döner) Phase 2 anlamlı değildir.
 */
async function fitsCurrentWeek(startsAt: string): Promise<boolean> {
  const result = await pool.query<{ starts_this_week: boolean; secs_left: string }>(
    `SELECT $1::timestamptz >= (date_trunc('week', now() AT TIME ZONE 'Europe/Istanbul')
                                 AT TIME ZONE 'Europe/Istanbul') AS starts_this_week,
            EXTRACT(EPOCH FROM (
              (date_trunc('week', now() AT TIME ZONE 'Europe/Istanbul')
                AT TIME ZONE 'Europe/Istanbul' + INTERVAL '7 days') - now()
            ))::text AS secs_left`,
    [startsAt],
  );
  const row = result.rows[0];
  return row.starts_this_week && parseFloat(row.secs_left) >= WEEK_BOUNDARY_GUARD_SECONDS;
}

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const restorePrice = await overrideDefaultLessonTypePrice("500");

  try {
    section("SMOKE 07 — Backdated Events (§7.5)");

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: backdated event KPI'ye yansımamalı
    // ─────────────────────────────────────────────────────────────────────────
    section("Phase 1 — daysAgo(35) lesson+payment cari hafta KPI'sine girmemeli");

    const kpi0 = await getWeeklyKpi();
    info("baseline cash_inflow.total", kpi0.cashInflow.total);
    info("baseline revenue.total", kpi0.revenue.total);

    const studentBack = await createStudent({ fullName: "SMOKE07_backdated" });
    studentIds.push(studentBack.id);

    const lessonBack = await createLesson({
      studentId: studentBack.id,
      startsAt: daysAgo(35),
      mode: "onsite",
    });
    await completeLesson(lessonBack.id);
    await createCashPayment({
      targetType: "lesson",
      targetId: lessonBack.id,
      amount: "500",
      source: "cash",
      paidAt: daysAgo(35),
    });

    const kpi1 = await getWeeklyKpi();

    const dCash = delta(kpi1.cashInflow.total, kpi0.cashInflow.total);
    const dRev = delta(kpi1.revenue.total, kpi0.revenue.total);
    assertMoney(
      dCash.toFixed(2),
      "0.00",
      "Phase 1: Δ cash_inflow = 0 (backdated payment cari haftaya akmadı)",
    );
    assertMoney(
      dRev.toFixed(2),
      "0.00",
      "Phase 1: Δ revenue = 0 (backdated lesson cari haftaya akmadı)",
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: cari hafta event KPI'ye akmalı
    // ─────────────────────────────────────────────────────────────────────────
    section("Phase 2 — cari hafta lesson+payment KPI'ye yansır");

    const currentStartsAt = isoNow(CURRENT_LESSON_OFFSET_MS);
    if (!(await fitsCurrentWeek(currentStartsAt))) {
      ok("Phase 2 atlandı: hafta sınırına çok yakın (tamamlanabilir ders bu haftaya düşmüyor)");
      return;
    }

    const studentCur = await createStudent({ fullName: "SMOKE07_current" });
    studentIds.push(studentCur.id);

    const lessonCur = await createLesson({
      studentId: studentCur.id,
      startsAt: currentStartsAt,
      mode: "onsite",
    });
    await completeLesson(lessonCur.id);
    await createCashPayment({
      targetType: "lesson",
      targetId: lessonCur.id,
      amount: "500",
      source: "cash",
      paidAt: isoNow(),
    });

    const kpi2 = await getWeeklyKpi();
    const dCash2 = delta(kpi2.cashInflow.total, kpi1.cashInflow.total);
    const dRev2 = delta(kpi2.revenue.total, kpi1.revenue.total);
    assertMoney(
      dCash2.toFixed(2),
      "500.00",
      "Phase 2: Δ cash_inflow = 500 (cari hafta payment yansıdı)",
    );
    assertMoney(
      dRev2.toFixed(2),
      "500.00",
      "Phase 2: Δ revenue = 500 (cari hafta lesson yansıdı)",
    );

    ok("\nSMOKE 07 — TÜM ADIMLAR BAŞARILI ✓");
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
