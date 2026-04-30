/**
 * SMOKE 07 — Backdated Events (§7.5)
 *
 * Strateji: delta-based KPI snapshot.
 *   1. kpiBefore al
 *   2. daysAgo(35) ile completed lesson + payment ekle
 *   3. kpiAfter al → cash_inflow + revenue deltası 0 olmalı
 *   4. Cari hafta lesson + payment ekle → delta artmalı
 *
 * Geçmiş tarihli olay cari hafta KPI'sine akmaz; cari hafta olay akar.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/07-backdated-events.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
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

    const studentCur = await createStudent({ fullName: "SMOKE07_current" });
    studentIds.push(studentCur.id);

    const lessonCur = await createLesson({
      studentId: studentCur.id,
      startsAt: isoNow(-60_000),
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
