/**
 * SMOKE 19 — Student Hard Delete (geçmişiyle birlikte)
 *
 * Karar (2026-05-29): geçmişi olan öğrenci de kalıcı (fiziksel) silinebilir.
 * Bu test, tam finansal ayak izi olan bir öğrenci kurar ve hardDeleteStudent
 * sonrası her şeyin gerçekten gittiğini doğrular.
 *
 * Senaryo:
 *   1. Öğrenci oluştur
 *   2. completed + ödenmiş ders (lesson payment)
 *   3. kalemli ürün satışı + ödeme (sale payment + product_sale_items)
 *   4. ön ödemeli paket + ödeme (package payment)
 *   5. hardDeleteStudent → öğrenci + lessons + product_sales (+ items) +
 *      prepaid_packages + ilgili payments fiziksel silinmeli
 *   6. audit_logs'ta student_deleted + note 'hard_delete' özeti olmalı
 *
 * FK'ler ON DELETE RESTRICT — silme sırası servis içinde:
 *   payments → product_sales → lessons → prepaid_packages → students.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/19-student-hard-delete.ts
 */

import { createStudent, hardDeleteStudent } from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import { createCashPayment } from "../../src/services/payments.service.js";
import { createProductSale } from "../../src/services/product-sales.service.js";
import { createPrepaidPackage } from "../../src/services/packages.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section, step, info, assert, assertEqual, ok,
  cleanupSmoke, closePool, daysAgo, nextSlotIso, overrideDefaultLessonTypePrice, getActorUserId,
} from "./_shared.js";

async function countByStudent(table: string, studentId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table} WHERE student_id = $1`,
    [studentId],
  );
  return Number(r.rows[0].n);
}

async function rowExists(sql: string, params: unknown[]): Promise<boolean> {
  const r = await pool.query(sql, params);
  return r.rows.length > 0;
}

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const restorePrice = await overrideDefaultLessonTypePrice("500");

  try {
    section("SMOKE 19 — Student Hard Delete (geçmişiyle birlikte)");

    const actorUserId = await getActorUserId();

    // ── 1. Öğrenci + tam geçmiş ────────────────────────────────────────────────
    step("Öğrenci ve tam finansal geçmiş kuruluyor...");
    const student = await createStudent({ fullName: "SMOKE_HardDelete_19" });
    studentIds.push(student.id);
    info("student.id", student.id);

    // completed + ödenmiş ders
    const lesson = await createLesson({ studentId: student.id, startsAt: nextSlotIso(), mode: "onsite" });
    await completeLesson(lesson.id);
    const { payment: lessonPayment } = await createCashPayment({
      targetType: "lesson", targetId: lesson.id, amount: "500", source: "cash", paidAt: daysAgo(1),
    });

    // kalemli ürün satışı + ödeme
    const sale = await createProductSale({
      studentId: student.id,
      soldAt: daysAgo(1),
      items: [{ name: "SMOKE_Ürün", unitPrice: "200", quantity: 1 }],
      note: "SMOKE sale",
    });
    const { payment: salePayment } = await createCashPayment({
      targetType: "product_sale", targetId: sale.id, amount: "200", source: "cash", paidAt: daysAgo(1),
    });

    // ön ödemeli paket + ödeme (paket + ilk payment aynı transaction)
    const { prepaidPackage, payment: packagePayment } = await createPrepaidPackage({
      studentId: student.id, purchasedAt: daysAgo(2), creditCount: 4, unitPrice: "100", totalAmount: "400", source: "cash",
    });
    info("paket.id", prepaidPackage.id);

    // ── 2. Silmeden önce: her şey yerinde mi? ──────────────────────────────────
    step("Silmeden önce kayıtlar doğrulanıyor...");
    assertEqual(await countByStudent("lessons", student.id), 1, "ders sayısı (önce)");
    assertEqual(await countByStudent("product_sales", student.id), 1, "ürün satışı sayısı (önce)");
    assertEqual(await countByStudent("prepaid_packages", student.id), 1, "paket sayısı (önce)");
    assert(await rowExists(`SELECT 1 FROM product_sale_items WHERE sale_id = $1`, [sale.id]), "satış kalemi mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM payments WHERE id = $1`, [lessonPayment.id]), "ders ödemesi mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM payments WHERE id = $1`, [salePayment.id]), "satış ödemesi mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM payments WHERE id = $1`, [packagePayment.id]), "paket ödemesi mevcut (önce)");

    // ── 3. Hard delete ─────────────────────────────────────────────────────────
    step("hardDeleteStudent() çağrılıyor...");
    console.log("  BEKLENEN: öğrenci + tüm bağlı kayıtlar fiziksel silinsin (RESTRICT FK ihlali olmadan)");
    const deleted = await hardDeleteStudent(student.id, actorUserId);
    assertEqual(deleted.id, student.id, "dönen kayıt silinen öğrenci");

    // ── 4. Silmeden sonra: hiçbir şey kalmamış mı? ─────────────────────────────
    step("Silme sonrası tüm kayıtların gittiği doğrulanıyor...");
    assert(!(await rowExists(`SELECT 1 FROM students WHERE id = $1`, [student.id])), "öğrenci satırı fiziksel silinmiş");
    assertEqual(await countByStudent("lessons", student.id), 0, "ders kalmamış");
    assertEqual(await countByStudent("product_sales", student.id), 0, "ürün satışı kalmamış");
    assertEqual(await countByStudent("prepaid_packages", student.id), 0, "paket kalmamış");
    assert(!(await rowExists(`SELECT 1 FROM product_sale_items WHERE sale_id = $1`, [sale.id])), "satış kalemleri CASCADE ile silinmiş");
    assert(!(await rowExists(`SELECT 1 FROM payments WHERE id = $1`, [lessonPayment.id])), "ders ödemesi silinmiş");
    assert(!(await rowExists(`SELECT 1 FROM payments WHERE id = $1`, [salePayment.id])), "satış ödemesi silinmiş");
    assert(!(await rowExists(`SELECT 1 FROM payments WHERE id = $1`, [packagePayment.id])), "paket ödemesi silinmiş");

    // ── 5. Audit ───────────────────────────────────────────────────────────────
    step("audit_logs kontrol ediliyor (student_deleted + hard_delete notu)...");
    const audit = await pool.query<{ action: string; note: string | null }>(
      `SELECT action, note FROM audit_logs
        WHERE entity_type = 'student' AND entity_id = $1 AND action = 'student_deleted'
        ORDER BY id DESC LIMIT 1`,
      [student.id],
    );
    assert(audit.rows.length === 1, "student_deleted audit kaydı var");
    assert((audit.rows[0]?.note ?? "").includes("hard_delete"), "audit note 'hard_delete' özeti içeriyor");
    info("audit.note", audit.rows[0]?.note);

    // Öğrenci fiziksel silindi → cleanup için takipten çıkar (residue yok).
    studentIds.length = 0;

    ok("\nSMOKE 19 — TÜM ADIMLAR BAŞARILI ✓");
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
