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
 *   5. Etkinlik katılımı + tahsilatı + arama/profil notu + genel not bahsi +
 *      şoförlük bağlantısı ve hedefe bağlı başka bir misafir oluştur
 *   6. hardDeleteStudent → finansal kayıtlar ile öğrenciye ait etkinlik/not
 *      bağlantıları fiziksel silinmeli; ortak not, araç ve başka öğrenci korunmalı
 *   7. audit_logs'ta student_deleted + kapsamlı 'hard_delete' özeti olmalı
 *
 * FK'ler ON DELETE RESTRICT — silme sırası servis içinde:
 *   payments → product_sales → lessons → prepaid_packages → students.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/19-student-hard-delete.ts
 */

import {
  createStudent,
  getStudentDeleteImpact,
  hardDeleteStudent,
} from "../../src/services/students.service.js";
import { createLesson, completeLesson } from "../../src/services/lessons.service.js";
import { createCashPayment } from "../../src/services/payments.service.js";
import { createProductSale } from "../../src/services/product-sales.service.js";
import { createPrepaidPackage } from "../../src/services/packages.service.js";
import {
  addExistingParticipant,
  addParticipantNote,
  assignParticipantToVehicle,
  createEvent,
  createVehicle,
  markParticipantContacted,
  recordParticipantPayment,
} from "../../src/services/events.service.js";
import { addNote } from "../../src/services/notes.service.js";
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

async function cleanupOperationalFixtures(eventIds: string[], noteIds: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const noteId of noteIds) {
      await client.query(`DELETE FROM notes WHERE id = $1`, [noteId]);
    }
    for (const eventId of eventIds) {
      await client.query(
        `DELETE FROM event_payment_allocations
          WHERE payment_id IN (SELECT id FROM event_payments WHERE event_id = $1)`,
        [eventId],
      );
      await client.query(`DELETE FROM event_payments WHERE event_id = $1`, [eventId]);
      await client.query(`DELETE FROM event_participant_interactions WHERE event_id = $1`, [eventId]);
      await client.query(`DELETE FROM event_participants WHERE event_id = $1`, [eventId]);
      await client.query(`DELETE FROM event_vehicles WHERE event_id = $1`, [eventId]);
      await client.query(`DELETE FROM event_fee_items WHERE event_id = $1`, [eventId]);
      await client.query(`DELETE FROM events WHERE id = $1`, [eventId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("⚠️  Etkinlik/not fixture cleanup başarısız:", error);
  } finally {
    client.release();
  }
}

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const eventIds: string[] = [];
  const noteIds: string[] = [];
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

    // Etkinlik/not FK kapsamı: hedef katılımcı ve şoför; ona bağlı başka bir
    // öğrenci misafir/yolcu olarak kalacak. Hard-delete yalnız hedefin kişisel
    // ayak izini temizlemeli, diğer kişinin operasyon planını bozmamalı.
    const otherStudent = await createStudent({ fullName: "SMOKE_HardDelete_19_Diğer" });
    studentIds.push(otherStudent.id);
    const event = await createEvent({
      name: "SMOKE_HardDelete_19_Etkinlik",
      startsAt: nextSlotIso(),
      transportEnabled: true,
      feeItems: [{ label: "SMOKE katılım", amount: "100" }],
      actorUserId,
    });
    eventIds.push(event.id);
    const targetParticipant = await addExistingParticipant(event.id, {
      studentId: student.id,
      rsvpStatus: "coming",
      actorUserId,
    });
    const otherParticipant = await addExistingParticipant(event.id, {
      studentId: otherStudent.id,
      rsvpStatus: "coming",
      guestOfParticipantId: targetParticipant.id,
      actorUserId,
    });
    await markParticipantContacted(targetParticipant.id, { note: "SMOKE arama" }, actorUserId);
    const participantNote = await addParticipantNote(
      targetParticipant.id,
      "SMOKE katılımcı profili notu",
      actorUserId,
    );
    const eventPayment = await recordParticipantPayment(
      targetParticipant.id,
      "100",
      actorUserId,
      "cash",
      `smoke-19-${student.id}`,
    );
    const vehicle = await createVehicle(event.id, {
      vehicleType: "student_car",
      driverStudentId: student.id,
      driverName: student.full_name,
      driverPhone: "05550000019",
      passengerSeats: 2,
      actorUserId,
    });
    await assignParticipantToVehicle(otherParticipant.id, vehicle.id, actorUserId);
    const generalNote = await addNote({
      body: "SMOKE hard-delete mention bağlantısı",
      actorUserId,
      mentionedStudentIds: [student.id],
    });
    noteIds.push(generalNote.id);

    // ── 2. Silmeden önce: her şey yerinde mi? ──────────────────────────────────
    step("Silmeden önce kayıtlar doğrulanıyor...");
    assertEqual(await countByStudent("lessons", student.id), 1, "ders sayısı (önce)");
    assertEqual(await countByStudent("product_sales", student.id), 1, "ürün satışı sayısı (önce)");
    assertEqual(await countByStudent("prepaid_packages", student.id), 1, "paket sayısı (önce)");
    assert(await rowExists(`SELECT 1 FROM product_sale_items WHERE sale_id = $1`, [sale.id]), "satış kalemi mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM payments WHERE id = $1`, [lessonPayment.id]), "ders ödemesi mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM payments WHERE id = $1`, [salePayment.id]), "satış ödemesi mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM payments WHERE id = $1`, [packagePayment.id]), "paket ödemesi mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM event_participants WHERE id = $1`, [targetParticipant.id]), "etkinlik katılımı mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM event_payment_allocations WHERE payment_id = $1`, [eventPayment.id]), "etkinlik ödeme dağılımı mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM event_participant_interactions WHERE student_id = $1`, [student.id]), "etkinlik etkileşim geçmişi mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM event_participant_notes WHERE id = $1`, [participantNote.id]), "katılımcı profil notu mevcut (önce)");
    assert(await rowExists(`SELECT 1 FROM note_mentions WHERE note_id = $1 AND student_id = $2`, [generalNote.id, student.id]), "genel not bahsi mevcut (önce)");

    const impact = await getStudentDeleteImpact(student.id);
    assertEqual(impact.lessons, 1, "silme etkisi: ders");
    assertEqual(impact.productSales, 1, "silme etkisi: ürün satışı");
    assertEqual(impact.prepaidPackages, 1, "silme etkisi: paket");
    assertEqual(impact.eventParticipations, 1, "silme etkisi: etkinlik katılımı");
    assertEqual(impact.eventPayments, 1, "silme etkisi: etkinlik tahsilatı");
    assertEqual(impact.eventPaymentAllocations, 1, "silme etkisi: etkinlik dağılımı");
    assertEqual(impact.eventInteractions, 1, "silme etkisi: etkinlik etkileşimi");
    assertEqual(impact.participantNotes, 1, "silme etkisi: katılımcı notu");
    assertEqual(impact.noteMentions, 1, "silme etkisi: genel not bahsi");
    assertEqual(impact.drivenVehicles, 1, "silme etkisi: şoför bağlantısı");

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

    assert(!(await rowExists(`SELECT 1 FROM event_participants WHERE id = $1`, [targetParticipant.id])), "hedef etkinlik katılımı silinmiş");
    assert(!(await rowExists(`SELECT 1 FROM event_payments WHERE id = $1`, [eventPayment.id])), "etkinlik tahsilatı silinmiş");
    assert(!(await rowExists(`SELECT 1 FROM event_payment_allocations WHERE payment_id = $1`, [eventPayment.id])), "etkinlik ödeme dağılımı silinmiş");
    assert(!(await rowExists(`SELECT 1 FROM event_participant_interactions WHERE student_id = $1`, [student.id])), "hard-delete istisnasında kişisel etkileşim geçmişi silinmiş");
    assert(!(await rowExists(`SELECT 1 FROM event_participant_notes WHERE id = $1`, [participantNote.id])), "katılımcı profil notu cascade ile silinmiş");
    assert(!(await rowExists(`SELECT 1 FROM note_mentions WHERE note_id = $1 AND student_id = $2`, [generalNote.id, student.id])), "genel not bahis bağlantısı silinmiş");
    assert(await rowExists(`SELECT 1 FROM notes WHERE id = $1`, [generalNote.id]), "başka kullanıcılara ait ortak genel not korunmuş");
    assert(await rowExists(
      `SELECT 1 FROM event_participants
        WHERE id = $1 AND student_id = $2 AND guest_of_participant_id IS NULL AND vehicle_id = $3`,
      [otherParticipant.id, otherStudent.id, vehicle.id],
    ), "başka öğrencinin katılımı/yolcu ataması korunup misafir bağı çözülmüş");
    assert(await rowExists(
      `SELECT 1 FROM event_vehicles
        WHERE id = $1 AND driver_student_id IS NULL
          AND driver_name = 'Silinmiş öğrenci' AND driver_phone IS NULL`,
      [vehicle.id],
    ), "araç korunup silinen şoförün kişisel alanları anonimleştirilmiş");

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
    assert((audit.rows[0]?.note ?? "").includes("event_payments=1"), "audit note etkinlik tahsilatı sayısını içeriyor");
    assert((audit.rows[0]?.note ?? "").includes("note_mentions=1"), "audit note bahis sayısını içeriyor");
    info("audit.note", audit.rows[0]?.note);

    // Öğrenci fiziksel silindi → cleanup için takipten çıkar (residue yok).
    studentIds.length = 0;

    ok("\nSMOKE 19 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    await cleanupOperationalFixtures(eventIds, noteIds);
    await cleanupSmoke(studentIds);
    await restorePrice();
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
