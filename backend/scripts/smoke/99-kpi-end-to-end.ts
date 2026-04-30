/**
 * SMOKE 99 — KPI End-to-End (§7.8) — EN SON ÇALIŞIR
 *
 * Strateji: delta-based.
 *   1. kpiBefore = getWeeklyKpi() snapshot
 *   2. Fixture A/B/C/D oluşturulur (D önceki hafta — KPI dışı kalmalı)
 *   3. kpiAfter = getWeeklyKpi() snapshot
 *   4. (kpiAfter - kpiBefore) deltaları beklenen değerlerle karşılaştırılır
 *
 * Bu sayede önceki test'lerin kalıntısı KPI'yi bozmaz.
 *
 * Hafta sınırı koruması: cari Pazartesi 00:00 (Europe/Istanbul) yakınında
 * çalışırsa fixture insertion ile snapshot arasında hafta dönüşü olabilir.
 * Test başında kalan süreyi kontrol eder; <5 dakika kaldıysa skip + warn.
 *
 * Beklenen deltalar (5 öğrenci, bu hafta + 1 ders önceki hafta):
 *   cash_inflow.total += 5700   (500+200+300+4000+700, cash+iban)
 *   cash_inflow.cash  += 5400   (500+200+4000+700, iban hariç)
 *   cash_inflow.iban  += 300
 *   revenue.lesson    += 2200   (500+500+500+700)
 *   revenue.product   += 300
 *   revenue.total     += 2500
 *   lessonCounts.planned   += 4 (A1, A2, B1, C1; D1 önceki hafta)
 *   lessonCounts.completed += 4
 *   receivable        += 300   (A2 kısmi: 500-200=300)
 *   activeCreditValue += 3500  (B paketi: 8-1=7 × 500)
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/99-kpi-end-to-end.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import {
  createLesson,
  completeLesson,
  setLessonDiscount,
} from "../../src/services/lessons.service.js";
import { createCashPayment } from "../../src/services/payments.service.js";
import { createPrepaidPackage } from "../../src/services/packages.service.js";
import { createProductSale } from "../../src/services/product-sales.service.js";
import { getWeeklyKpi } from "../../src/services/kpi.service.js";
import { pool } from "../../src/db/connection.js";
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
  nextSlotIso,
  overrideDefaultLessonTypePrice,
} from "./_shared.js";

// 5 dakikadan kısa süre kaldıysa hafta dönüşü riski → skip
const WEEK_BOUNDARY_GUARD_SECONDS = 300;

async function checkWeekBoundaryGuard(): Promise<boolean> {
  const result = await pool.query<{ secs_to_next_week: string }>(`
    SELECT EXTRACT(EPOCH FROM (
      (date_trunc('week', now() AT TIME ZONE 'Europe/Istanbul')
        AT TIME ZONE 'Europe/Istanbul' + INTERVAL '7 days')
      - now()
    ))::text AS secs_to_next_week
  `);
  const secs = parseFloat(result.rows[0].secs_to_next_week);
  if (secs < WEEK_BOUNDARY_GUARD_SECONDS) {
    console.log(
      `  ⚠ Hafta sonuna ${Math.floor(secs)}s kaldı — flaky risk; test atlandı.`,
    );
    return false;
  }
  if (secs > 7 * 86400 - WEEK_BOUNDARY_GUARD_SECONDS) {
    // Hafta yeni başladı (Pazartesi 00:00'a yakın)
    console.log(
      `  ⚠ Hafta yeni başladı — flaky risk; test atlandı.`,
    );
    return false;
  }
  return true;
}

function delta(after: string, before: string): number {
  return parseFloat(after) - parseFloat(before);
}

function deltaInt(after: string, before: string): number {
  return parseInt(after, 10) - parseInt(before, 10);
}

async function run(): Promise<void> {
  const studentIds: string[] = [];
  // Default 500. C senaryosunda 900'e çekip geri 500'e döneceğiz (lokal scope).
  const restorePrice = await overrideDefaultLessonTypePrice("500");

  try {
    section("SMOKE 99 — KPI End-to-End (§7.8)");

    if (!(await checkWeekBoundaryGuard())) {
      ok("Skipped due to week boundary guard.");
      return;
    }

    // ── Baseline ────────────────────────────────────────────────────────────
    step("kpiBefore snapshot alınıyor...");
    const kpiBefore = await getWeeklyKpi();
    info("weekStart", kpiBefore.weekStart);
    info("baseline cash_inflow.total", kpiBefore.cashInflow.total);
    info("baseline revenue.total", kpiBefore.revenue.total);

    // ── Fixture A: 1 fully paid + 1 partial ─────────────────────────────────
    section("Fixture A — fully paid 500 + partial 200/500");

    const studentA = await createStudent({ fullName: "SMOKE99_A" });
    studentIds.push(studentA.id);

    const lessonA1 = await createLesson({
      studentId: studentA.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonA1.id);
    await createCashPayment({
      targetType: "lesson",
      targetId: lessonA1.id,
      amount: "500",
      source: "cash",
      paidAt: isoNow(),
    });

    const lessonA2 = await createLesson({
      studentId: studentA.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    await completeLesson(lessonA2.id);
    await createCashPayment({
      targetType: "lesson",
      targetId: lessonA2.id,
      amount: "200",
      source: "cash",
      paidAt: isoNow(),
    });

    // ── Fixture B: product sale + prepaid package + 1 lesson from package ──
    section("Fixture B — product sale 300 (iban) + paket 8x500 (cash) + 1 paket dersi");

    const studentB = await createStudent({ fullName: "SMOKE99_B" });
    studentIds.push(studentB.id);

    const saleB = await createProductSale({
      studentId: studentB.id,
      soldAt: isoNow(-60_000),
      totalAmount: "300",
    });
    await createCashPayment({
      targetType: "product_sale",
      targetId: saleB.id,
      amount: "300",
      source: "iban",
      paidAt: isoNow(),
    });

    const pkgB = await createPrepaidPackage({
      studentId: studentB.id,
      purchasedAt: isoNow(-30_000),
      creditCount: 8,
      unitPrice: "500",
      totalAmount: "4000",
      source: "cash",
    });
    info("pkgB.id", pkgB.prepaidPackage.id);

    const lessonB1 = await createLesson({
      studentId: studentB.id,
      startsAt: nextSlotIso(),
      mode: "onsite",
    });
    const completedB1 = await completeLesson(lessonB1.id);
    assert(
      completedB1.lesson.prepaid_package_id === pkgB.prepaidPackage.id,
      "B1 paketten kredi düştü",
    );
    assertMoney(completedB1.lesson.price_snapshot, "500", "B1 price_snapshot = unit_price");

    // ── Fixture C: 900 lesson + 200 discount → net 700, fully paid ─────────
    section("Fixture C — 900 lesson + 200 discount → net 700 + cash 700");

    const restoreCPrice = await overrideDefaultLessonTypePrice("900");
    try {
      const studentC = await createStudent({ fullName: "SMOKE99_C" });
      studentIds.push(studentC.id);

      const lessonC1 = await createLesson({
        studentId: studentC.id,
        startsAt: nextSlotIso(),
        mode: "onsite",
      });
      await completeLesson(lessonC1.id);
      await setLessonDiscount({ lessonId: lessonC1.id, discountAmount: "200" });
      await createCashPayment({
        targetType: "lesson",
        targetId: lessonC1.id,
        amount: "700",
        source: "cash",
        paidAt: isoNow(),
      });
    } finally {
      await restoreCPrice();
    }

    // ── Fixture D: önceki hafta (KPI dışı kalmalı) ─────────────────────────
    section("Fixture D — önceki hafta lesson 500 + cash 500 (KPI dışı kalmalı)");

    const studentD = await createStudent({ fullName: "SMOKE99_D" });
    studentIds.push(studentD.id);

    const lessonD1 = await createLesson({
      studentId: studentD.id,
      startsAt: daysAgo(8),
      mode: "onsite",
    });
    await completeLesson(lessonD1.id);
    await createCashPayment({
      targetType: "lesson",
      targetId: lessonD1.id,
      amount: "500",
      source: "cash",
      paidAt: daysAgo(8),
    });

    // D1'in cari hafta filtresine girmediğini doğrula (defense)
    const dCheck = await pool.query<{ in_current_week: boolean }>(
      `SELECT
         (l.starts_at >= (date_trunc('week', now() AT TIME ZONE 'Europe/Istanbul')
                          AT TIME ZONE 'Europe/Istanbul')) AS in_current_week
       FROM lessons l WHERE l.id = $1`,
      [lessonD1.id],
    );
    assert(
      dCheck.rows[0].in_current_week === false,
      "D1 cari hafta penceresi dışında (geçmiş hafta)",
    );

    // ── kpiAfter snapshot + delta assertions ────────────────────────────────
    section("kpiAfter snapshot ve delta doğrulamaları");
    const kpiAfter = await getWeeklyKpi();

    info("kpiAfter cash_inflow.total", kpiAfter.cashInflow.total);
    info("kpiAfter revenue.total", kpiAfter.revenue.total);

    // cash_inflow
    const dCashTotal = delta(kpiAfter.cashInflow.total, kpiBefore.cashInflow.total);
    const dCashCash = delta(kpiAfter.cashInflow.cash, kpiBefore.cashInflow.cash);
    const dCashIban = delta(kpiAfter.cashInflow.iban, kpiBefore.cashInflow.iban);
    assertMoney(dCashTotal.toFixed(2), "5700.00", "Δ cash_inflow.total = 5700 (cash+iban)");
    assertMoney(dCashCash.toFixed(2), "5400.00", "Δ cash_inflow.cash = 5400");
    assertMoney(dCashIban.toFixed(2), "300.00", "Δ cash_inflow.iban = 300");

    // revenue
    const dRevLesson = delta(kpiAfter.revenue.lesson, kpiBefore.revenue.lesson);
    const dRevProduct = delta(kpiAfter.revenue.product, kpiBefore.revenue.product);
    const dRevTotal = delta(kpiAfter.revenue.total, kpiBefore.revenue.total);
    assertMoney(dRevLesson.toFixed(2), "2200.00", "Δ revenue.lesson = 2200 (500+500+500+700)");
    assertMoney(dRevProduct.toFixed(2), "300.00", "Δ revenue.product = 300");
    assertMoney(dRevTotal.toFixed(2), "2500.00", "Δ revenue.total = 2500");

    // lesson counts
    const dPlanned = deltaInt(kpiAfter.lessonCounts.planned, kpiBefore.lessonCounts.planned);
    const dCompleted = deltaInt(kpiAfter.lessonCounts.completed, kpiBefore.lessonCounts.completed);
    assert(dPlanned === 4, `Δ planned = 4 (got ${dPlanned})`);
    assert(dCompleted === 4, `Δ completed = 4 (got ${dCompleted})`);

    // receivable: A2 → 300 açık
    const dReceivable = delta(kpiAfter.receivable, kpiBefore.receivable);
    assertMoney(dReceivable.toFixed(2), "300.00", "Δ receivable = 300 (A2 kısmi)");

    // active credit value: 7 kalan × 500
    const dCredit = delta(kpiAfter.activeCreditValue, kpiBefore.activeCreditValue);
    assertMoney(dCredit.toFixed(2), "3500.00", "Δ activeCreditValue = 3500 (7×500)");

    ok("\nSMOKE 99 — KPI E2E TÜM DELTALAR DOĞRU ✓");
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
