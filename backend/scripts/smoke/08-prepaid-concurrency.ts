/**
 * SMOKE 08 — Prepaid Package Concurrency
 *
 * Senaryo (spec §2.4, §5.5):
 *   PostgreSQL advisory xact lock (`student_prepaid_<id>`) ile aynı öğrenci için
 *   paralel completeLesson çağrılarının race condition'ı önlemesi test edilir.
 *
 *   Akış:
 *   1. lesson_type.default_price = 800'e kur (paket unit_price'tan farklı)
 *   2. Öğrenci oluştur
 *   3. Prepaid package: 1 kredi × 500 TRY
 *   4. 2 adet scheduled lesson oluştur (A ve B)
 *   5. 2 paralel completeLesson(A) + completeLesson(B) fırlat
 *
 * BEKLENEN SONUÇ:
 *   - Her iki çağrı da BAŞARILI döner (ikisi de completed'a geçer).
 *   - SADECE BİRİ paketten kredi alır:
 *       • prepaid_package_id = pkg.id + price_snapshot = 500 (paket unit_price)
 *   - DİĞERİ kredi bulamaz, normal fiyatla tamamlanır:
 *       • prepaid_package_id = NULL + price_snapshot = 800 (lesson_type default)
 *   - Paket remaining_credits = 0 (aşırı tüketim YOK)
 *   - Lock olmasa, her iki işlem de remaining_credits = 1 görürdü
 *     ve paket TÜKENMİŞ olmasına rağmen 2 × kredi tahsisi yapabilir,
 *     invariant'ı bozardı.
 *
 * CLEANUP: script sonunda tüm veriler soft-delete edilir.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/08-prepaid-concurrency.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import { createPrepaidPackage, getPrepaidPackageStatus } from "../../src/services/packages.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, ok, assert, assertMoney, assertEqual,
  cleanupSmoke, closePool, daysAgo, overrideDefaultLessonTypePrice,
} from "./_shared.js";

type LessonRow = {
  id: string;
  prepaid_package_id: string | null;
  price_snapshot: string;
  status: string;
};

type CompleteOutcome =
  | { ok: true; lesson: LessonRow }
  | { ok: false; lessonId: string; code: string; message: string };

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const restorePrice = await overrideDefaultLessonTypePrice("800");

  try {
    section("SMOKE 08 — Prepaid Package Concurrency");

    // ── 1. Öğrenci ────────────────────────────────────────────────────────────
    step("Öğrenci oluşturuluyor (SMOKE_Student_08)...");
    const student = await createStudent({
      fullName: "SMOKE_Student_08",
    });
    studentIds.push(student.id);
    info("student.id", student.id);

    // ── 2. 1 kredili paket ────────────────────────────────────────────────────
    step("Prepaid package oluşturuluyor (1 kredi × 500 TRY)...");
    console.log("  BEKLENED: 1 kredi, unit_price=500");
    const { prepaidPackage: pkg } = await createPrepaidPackage({
      studentId: student.id,
      purchasedAt: daysAgo(5),
      creditCount: 1,
      unitPrice: "500",
      totalAmount: "500",
      source: "cash",
      note: "SMOKE concurrency test package",
    });
    assertEqual(pkg.credit_count, 1, "package.credit_count = 1");
    assertMoney(pkg.unit_price, "500", "package.unit_price = 500");
    info("package.id", pkg.id);

    const s0 = await getPrepaidPackageStatus(pkg.id);
    assertEqual(Number(s0.remaining_credits), 1, "remaining_credits = 1 (henüz kullanım yok)");

    // ── 3. 2 scheduled lesson ─────────────────────────────────────────────────
    step("2 adet scheduled lesson oluşturuluyor (A ve B)...");
    const lessonA = await createLesson({
      studentId: student.id,
      startsAt: daysAgo(3),
      mode: "onsite",
    });
    const lessonB = await createLesson({
      studentId: student.id,
      startsAt: daysAgo(2),
      mode: "online",
    });
    info("lessonA.id", lessonA.id);
    info("lessonB.id", lessonB.id);

    // ── 4. 2 paralel completeLesson ───────────────────────────────────────────
    step("2 paralel completeLesson fırlatılıyor (A ve B aynı anda)...");
    console.log("  BEKLENED: Her ikisi de başarılı (completed), ama sadece biri paketten kredi alır");
    console.log("  → Advisory lock (student_prepaid_<id>) seri hale getirir");
    console.log("  → İlk complete: prepaid_package_id=set, price_snapshot=500");
    console.log("  → İkinci complete: prepaid_package_id=NULL, price_snapshot=800 (normal fiyat)");

    const results = await Promise.allSettled([
      completeLesson(lessonA.id).then(
        (lesson) => ({ ok: true, lesson } as const),
      ).catch(
        (err: unknown) => ({
          ok: false,
          lessonId: lessonA.id,
          code: (err as { code?: string }).code ?? "UNKNOWN",
          message: (err as Error).message ?? "",
        } as const),
      ),
      completeLesson(lessonB.id).then(
        (lesson) => ({ ok: true, lesson } as const),
      ).catch(
        (err: unknown) => ({
          ok: false,
          lessonId: lessonB.id,
          code: (err as { code?: string }).code ?? "UNKNOWN",
          message: (err as Error).message ?? "",
        } as const),
      ),
    ]);

    const outcomes = results.map((r): CompleteOutcome => {
      if (r.status === "fulfilled") return r.value;
      return {
        ok: false,
        lessonId: "unknown",
        code: "PROMISE_REJECTED",
        message: String(r.reason),
      };
    });

    console.log("\n  Sonuçlar:");
    for (const o of outcomes) {
      if (o.ok) {
        const pkgLabel = o.lesson.prepaid_package_id ? `paket (pkg_id=${o.lesson.prepaid_package_id})` : "paket YOK (normal fiyat)";
        console.log(`    ✓ lesson ${o.lesson.id} → completed | ${pkgLabel} | price_snapshot=${o.lesson.price_snapshot}`);
      } else {
        console.log(`    ✗ lesson ${o.lessonId} → BAŞARISIZ (code: ${o.code}): ${o.message}`);
      }
    }

    // ── 5. Doğrulama ───────────────────────────────────────────────────────────
    step("Sonuçları doğruluyoruz...");

    const successes = outcomes.filter((o) => o.ok);
    const failures = outcomes.filter((o) => !o.ok);

    assert(
      failures.length === 0,
      `Her iki completeLesson da başarılı olmalı (failures: ${failures.length})`,
    );
    assert(
      successes.length === 2,
      `2 başarılı completeLesson bekleniyor (actual: ${successes.length})`,
    );

    // Hangi lesson paketi aldı?
    const withPackage = successes.filter(
      (o) => o.ok && o.lesson.prepaid_package_id !== null,
    );
    const withoutPackage = successes.filter(
      (o) => o.ok && o.lesson.prepaid_package_id === null,
    );

    assert(
      withPackage.length === 1,
      `Paketten kredi alan ders sayısı = 1 (actual: ${withPackage.length})`,
    );
    assert(
      withoutPackage.length === 1,
      `Normal fiyatla tamamlanan ders sayısı = 1 (actual: ${withoutPackage.length})`,
    );

    // Paketi alan ders: price_snapshot = 500 (paket unit_price)
    if (withPackage[0]?.ok) {
      assertMoney(
        withPackage[0].lesson.price_snapshot,
        "500",
        "Paketi alan ders: price_snapshot = 500 (paket unit_price)",
      );
      assertEqual(
        withPackage[0].lesson.prepaid_package_id,
        pkg.id,
        "Paketi alan ders: prepaid_package_id = pkg.id",
      );
    }

    // Normal fiyatlı ders: price_snapshot = 800 (lesson_type default)
    if (withoutPackage[0]?.ok) {
      assertMoney(
        withoutPackage[0].lesson.price_snapshot,
        "800",
        "Normal ders: price_snapshot = 800 (lesson_type.default_price)",
      );
    }

    // ── 6. Paket remaining_credits = 0 ────────────────────────────────────────
    step("Paket remaining_credits kontrol ediliyor...");
    console.log("  BEKLENED: remaining_credits = 0 (1 kredi tüketildi, aşırı tahsis YOK)");

    const finalStatus = await getPrepaidPackageStatus(pkg.id);
    assertEqual(
      Number(finalStatus.remaining_credits),
      0,
      "remaining_credits = 0 (race condition olmadı, kredi aşılmadı)",
    );
    assertEqual(
      Number(finalStatus.used_credits),
      1,
      "used_credits = 1 (sadece 1 tahsis yapıldı)",
    );

    // ── 7. DB'den teyit ───────────────────────────────────────────────────────
    step("DB'de ders kayıtları doğrudan kontrol ediliyor...");
    const dbRes = await pool.query<{
      id: string;
      prepaid_package_id: string | null;
      price_snapshot: string;
    }>(
      `SELECT id, prepaid_package_id, price_snapshot::text
         FROM lessons
        WHERE id IN ($1, $2)
          AND deleted_at IS NULL
        ORDER BY id`,
      [lessonA.id, lessonB.id],
    );

    const pkgLinkedCount = dbRes.rows.filter((r) => r.prepaid_package_id !== null).length;
    const normalCount = dbRes.rows.filter((r) => r.prepaid_package_id === null).length;

    assert(pkgLinkedCount === 1, `DB: pakete bağlı ders sayısı = 1 (actual: ${pkgLinkedCount})`);
    assert(normalCount === 1, `DB: normal ders sayısı = 1 (actual: ${normalCount})`);

    info("DB lesson A", `pkg_id=${dbRes.rows.find((r) => r.id === lessonA.id)?.prepaid_package_id ?? "NULL"}, price=${dbRes.rows.find((r) => r.id === lessonA.id)?.price_snapshot}`);
    info("DB lesson B", `pkg_id=${dbRes.rows.find((r) => r.id === lessonB.id)?.prepaid_package_id ?? "NULL"}, price=${dbRes.rows.find((r) => r.id === lessonB.id)?.price_snapshot}`);

    ok("\nSMOKE 08 — TÜM ADIMLAR BAŞARILI ✓");
    console.log(
      "   Advisory lock (student_prepaid_<id>) credit double-allocation'ı önledi.",
    );

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
