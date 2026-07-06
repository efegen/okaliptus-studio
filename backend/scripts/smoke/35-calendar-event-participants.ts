/**
 * SMOKE 35 — Plan Katılımcıları (calendar_event_participants)
 *
 * Kapsam:
 *   1. Katılımcılı plan oluştur → dönen participants doğru
 *   2. Aralık listesi → participants gömülü geliyor
 *   3. participantIds ile tam liste değiştirme
 *   4. participantIds VERİLMEZSE katılımcılar korunur (not güncellemesi)
 *   5. Boş dizi → tüm katılımcılar kalkar
 *   6. İZOLASYON: katılımcı olmak ders/borç YARATMAZ (ders mantığına dokunmaz)
 *   7. Var olmayan öğrenci id'si reddedilir (VALIDATION_ERROR)
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/35-calendar-event-participants.ts
 */

import { createStudent } from "../../src/services/students.service.js";
import {
  createCalendarEvent,
  updateCalendarEvent,
  listCalendarEventsInRange,
  deleteCalendarEvent,
} from "../../src/services/calendar-events.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  info,
  assert,
  assertEqual,
  assertRejects,
  ok,
  cleanupSmoke,
  closePool,
  nextSlotIso,
  getActorUserId,
} from "./_shared.js";

function ids(participants: { id: string }[]): string[] {
  return participants.map(p => String(p.id)).sort();
}

async function lessonCountFor(studentId: string): Promise<number> {
  const r = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM lessons
      WHERE student_id = $1 AND deleted_at IS NULL`,
    [studentId],
  );
  return Number(r.rows[0].count);
}

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const eventIds: string[] = [];
  const actorUserId = await getActorUserId();

  try {
    section("SMOKE 35 — Plan Katılımcıları");

    const a = await createStudent({ fullName: "SMOKE35_Ada" });
    const b = await createStudent({ fullName: "SMOKE35_Bora" });
    const c = await createStudent({ fullName: "SMOKE35_Cem" });
    studentIds.push(a.id, b.id, c.id);

    // ── 1. Katılımcılı oluşturma ────────────────────────────────────────────
    step("Katılımcılı plan oluştur ([Ada, Bora])");
    const startsAt = nextSlotIso();
    const created = await createCalendarEvent({
      eventType: "plan",
      title: "SMOKE35 Atölye",
      startsAt,
      durationMinutes: 60,
      participantIds: [a.id, b.id],
      actorUserId,
    });
    eventIds.push(created.id);
    assertEqual(created.participants.length, 2, "oluşturmada 2 katılımcı döndü");
    assert(
      ids(created.participants).join(",") === [a.id, b.id].map(String).sort().join(","),
      "dönen katılımcılar Ada + Bora",
    );

    // ── 2. Aralık listesi katılımcıları gömüyor ─────────────────────────────
    step("Aralık listesinde participants gömülü mü?");
    const from = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const list = await listCalendarEventsInRange(from, to);
    const listed = list.find(e => String(e.id) === String(created.id));
    assert(!!listed, "oluşturulan plan listede bulundu");
    assertEqual(listed!.participants.length, 2, "listede 2 katılımcı gömülü");

    // ── 3. Tam liste değiştirme ([Cem]) ─────────────────────────────────────
    step("participantIds ile [Cem]'e değiştir");
    const toCem = await updateCalendarEvent(created.id, {
      participantIds: [c.id],
      actorUserId,
    });
    assertEqual(toCem.participants.length, 1, "değiştirmeden sonra 1 katılımcı");
    assertEqual(String(toCem.participants[0].id), String(c.id), "katılımcı Cem");

    // ── 4. participantIds VERİLMEZSE korunur ────────────────────────────────
    step("Sadece not güncelle (participantIds yok) → katılımcı korunur");
    const noteOnly = await updateCalendarEvent(created.id, {
      note: "sadece not değişti",
      actorUserId,
    });
    assertEqual(noteOnly.participants.length, 1, "katılımcı sayısı değişmedi");
    assertEqual(String(noteOnly.participants[0].id), String(c.id), "hâlâ Cem");

    // ── 5. Boş dizi → hepsi kalkar ──────────────────────────────────────────
    step("participantIds: [] → tüm katılımcılar kalkar");
    const cleared = await updateCalendarEvent(created.id, {
      participantIds: [],
      actorUserId,
    });
    assertEqual(cleared.participants.length, 0, "katılımcı listesi boşaldı");

    // ── 6. İZOLASYON: katılımcı olmak finansal değil ────────────────────────
    section("İzolasyon — katılımcı olmak ders/borç yaratmaz");
    await updateCalendarEvent(created.id, { participantIds: [a.id, b.id], actorUserId });
    const adaLessons = await lessonCountFor(a.id);
    const boraLessons = await lessonCountFor(b.id);
    assertEqual(adaLessons, 0, "Ada'nın dersi yok (katılımcılık ders yaratmadı)");
    assertEqual(boraLessons, 0, "Bora'nın dersi yok");
    info("not", "katılımcılık lessons.student_id ile ilişkisizdir");

    // ── 7. Geçersiz öğrenci reddi ───────────────────────────────────────────
    section("Doğrulama — var olmayan öğrenci reddedilir");
    await assertRejects(
      () =>
        createCalendarEvent({
          eventType: "plan",
          title: "SMOKE35 Hatalı",
          startsAt: nextSlotIso(),
          participantIds: [999_999_999],
          actorUserId,
        }),
      "VALIDATION_ERROR",
      "olmayan öğrenci id'si ile plan reddedildi",
    );

    ok("\nSMOKE 35 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    for (const eid of eventIds) {
      await deleteCalendarEvent(eid).catch(() => undefined);
    }
    await cleanupSmoke(studentIds);
    await closePool();
  }
}

run().catch(err => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
