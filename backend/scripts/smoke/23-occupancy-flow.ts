/**
 * SMOKE 23 — Doluluk · Akış (/kpi/occupancy-flow)
 *
 * İki bölüm:
 *   A) Cari hafta kovası deltaları (delta-based, kalıntıya dayanıklı):
 *        +1 tamamlanan, +1 iptal, +1 no_show, +1 scheduled →
 *        planned += 3 (iptal hariç), completed += 1, cancelled += 1, revenue += 500.
 *   B) "Temposu düşenler" roster mantığı:
 *        - DECLINE: ~3 hafta önce tek ders, sonrası boş → roster'da, son 2 hafta
 *          "ders yok", tek "geldi".
 *        - REGULAR: 7/14/21 gün önce düzenli → roster'da DEĞİL (gap<2, kaçırma yok).
 *
 * Hafta sınırı koruması: cari Pazartesi 00:00 (Europe/Istanbul) yakınında
 * çalışırsa snapshot/fixture arası hafta dönebilir; <5 dk kaldıysa skip.
 *
 * ÇALIŞTIRMA:  cd backend && npx tsx scripts/smoke/23-occupancy-flow.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import {
  createLesson,
  completeLesson,
  changeLessonStatus,
} from "../../src/services/lessons.service.js";
import { getOccupancyFlow } from "../../src/services/kpi.service.js";
import type { OccupancyBucket } from "../../src/services/kpi.service.js";
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
  nextSlotIso,
  overrideDefaultLessonTypePrice,
} from "./_shared.js";

const WEEK_BOUNDARY_GUARD_SECONDS = 300;

async function weekBoundaryOk(): Promise<boolean> {
  const result = await pool.query<{ secs: string }>(`
    SELECT EXTRACT(EPOCH FROM (
      (date_trunc('week', now() AT TIME ZONE 'Europe/Istanbul')
        AT TIME ZONE 'Europe/Istanbul' + INTERVAL '7 days') - now()
    ))::text AS secs
  `);
  const secs = parseFloat(result.rows[0].secs);
  if (secs < WEEK_BOUNDARY_GUARD_SECONDS || secs > 7 * 86400 - WEEK_BOUNDARY_GUARD_SECONDS) {
    console.log(`  ⚠ Hafta sınırına yakın (${Math.floor(secs)}s) — flaky risk; test atlandı.`);
    return false;
  }
  return true;
}

function current(series: OccupancyBucket[]): OccupancyBucket {
  return series.find((b) => b.current) ?? series[series.length - 1];
}
const dInt = (after: string, before: string) => parseInt(after, 10) - parseInt(before, 10);
const dNum = (after: string, before: string) => parseFloat(after) - parseFloat(before);

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const restorePrice = await overrideDefaultLessonTypePrice("500");

  try {
    section("SMOKE 23 — Doluluk · Akış (/kpi/occupancy-flow)");

    if (!(await weekBoundaryOk())) {
      ok("Skipped due to week boundary guard.");
      return;
    }

    step("occBefore snapshot alınıyor...");
    const before = await getOccupancyFlow();
    const curBefore = current(before.week.series);
    info("week series uzunluğu", before.week.series.length);
    info("month series uzunluğu", before.month.series.length);
    info("capacity", String(before.capacity));

    // ── A) Cari hafta kovası fixtureları ────────────────────────────────────
    section("A — cari hafta: complete + cancel + no_show + scheduled");

    const sP = await createStudent({ fullName: "SMOKE23_PLANNED" });
    studentIds.push(sP.id);
    const lP = await createLesson({ studentId: sP.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(lP.id); // +1 planned, +1 completed, +500 revenue

    const sC = await createStudent({ fullName: "SMOKE23_CANCEL" });
    studentIds.push(sC.id);
    const lC = await createLesson({ studentId: sC.id, startsAt: nextSlotIso(), mode: "onsite" });
    await changeLessonStatus(lC.id, "cancelled"); // +1 cancelled, planned değişmez

    const sN = await createStudent({ fullName: "SMOKE23_NOSHOW" });
    studentIds.push(sN.id);
    const lN = await createLesson({ studentId: sN.id, startsAt: nextSlotIso(), mode: "onsite" });
    await changeLessonStatus(lN.id, "no_show"); // +1 planned (no_show ∈ planlı), completed değişmez

    const sS = await createStudent({ fullName: "SMOKE23_SCHEDULED" });
    studentIds.push(sS.id);
    await createLesson({ studentId: sS.id, startsAt: nextSlotIso(), mode: "onsite" }); // scheduled → +1 planned

    // ── B) Temposu düşenler fixtureları ─────────────────────────────────────
    section("B — roster: DECLINE (3 hafta önce tek ders) + REGULAR (7/14/21 gün)");

    const sDecline = await createStudent({ fullName: "SMOKE23_DECLINE" });
    studentIds.push(sDecline.id);
    const lDecline = await createLesson({ studentId: sDecline.id, startsAt: daysAgo(20), mode: "onsite" });
    await completeLesson(lDecline.id);

    const sRegular = await createStudent({ fullName: "SMOKE23_REGULAR" });
    studentIds.push(sRegular.id);
    for (const d of [7, 14, 21]) {
      const l = await createLesson({ studentId: sRegular.id, startsAt: daysAgo(d), mode: "onsite" });
      await completeLesson(l.id);
    }

    // ── Snapshot + doğrulamalar ─────────────────────────────────────────────
    section("occAfter snapshot ve doğrulamalar");
    const after = await getOccupancyFlow();
    const curAfter = current(after.week.series);

    // Yapısal
    assert(after.week.series.length === 8, `week series 8 bar (got ${after.week.series.length})`);
    assert(after.month.series.length === 6, `month series 6 bar (got ${after.month.series.length})`);
    assert(typeof after.today === "string" && after.today.length === 10, "today 'YYYY-MM-DD'");

    // A) Cari hafta deltaları
    assert(dInt(curAfter.planned, curBefore.planned) === 3, `Δ planned = 3 (got ${dInt(curAfter.planned, curBefore.planned)})`);
    assert(dInt(curAfter.completed, curBefore.completed) === 1, `Δ completed = 1 (got ${dInt(curAfter.completed, curBefore.completed)})`);
    assert(dInt(curAfter.cancelled, curBefore.cancelled) === 1, `Δ cancelled = 1 (got ${dInt(curAfter.cancelled, curBefore.cancelled)})`);
    assertMoney(dNum(curAfter.revenue, curBefore.revenue).toFixed(2), "500.00", "Δ ders cirosu = 500");

    // B) Roster
    const decline = after.roster.find((r) => r.name === "SMOKE23_DECLINE");
    assert(!!decline, "DECLINE roster'da (temposu düştü)");
    if (decline) {
      info("DECLINE att", JSON.stringify(decline.att));
      const geldi = decline.att.filter((v) => v === 1).length;
      assert(geldi === 1, `DECLINE tek 'geldi' (got ${geldi})`);
      assert(decline.att[4] === 3 && decline.att[5] === 3, "DECLINE son 2 hafta 'ders yok' (gap≥2)");
      assert(/\d/.test(decline.slot), `DECLINE slot biçimi dolu (got "${decline.slot}")`);
    }
    const regular = after.roster.find((r) => r.name === "SMOKE23_REGULAR");
    assert(!regular, "REGULAR roster'da DEĞİL (düzenli geliyor, gap<2)");

    ok("\nSMOKE 23 — DOLULUK AKIŞ DOĞRULAMALARI TAMAM ✓");
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
