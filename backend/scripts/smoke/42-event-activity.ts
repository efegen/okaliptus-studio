/**
 * SMOKE 42 — Etkinlik hareketleri + geri alma (migration 0279)
 *
 * Mobil etkinlik detayındaki "Hareketler" ekranının sunucu tarafı:
 *   - audit_logs.event_id ile etkinliğe göre akış (listEventActivity),
 *   - işlemi yapan kullanıcının adının kayda yansıması,
 *   - geri alma (revertEventActivity): katılımcı ekleme/kaldırma, arandı kaydı,
 *     RSVP güncellemesi, ücret kapsamı, tahsilat, araç;
 *   - geri almanın SİLMEDİĞİ — orijinal satır "geri alındı" damgası alır,
 *     telafi işlemi kendi hareketini yazar ve aynı kayıt iki kez geri alınamaz;
 *   - geri alınamayan hareketlerin nedeniyle birlikte reddi;
 *   - /events/:id/activity HTTP uçlarının asistan rolüne kapalı olması.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/42-event-activity.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createStudent } from "../../src/services/students.service.js";
import {
  addExistingParticipant,
  createEvent,
  createVehicle,
  getEventById,
  listEventActivity,
  listParticipantFees,
  listParticipants,
  listVehicles,
  markParticipantContacted,
  recordParticipantPayment,
  removeParticipant,
  revertEventActivity,
  updateParticipant,
  updateParticipantFee,
} from "../../src/services/events.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  assert,
  assertEqual,
  assertMoney,
  assertRejects,
  getActorUserId,
  ok,
  fail,
  closePool,
  cleanupSmoke,
  seedAdminUser,
} from "./_shared.js";

type Activity = Awaited<ReturnType<typeof listEventActivity>>[number];

function findActivity(rows: Activity[], action: string, entityId?: string): Activity {
  const found = rows.find((row) => row.action === action && (!entityId || row.entity_id === entityId));
  if (!found) {
    fail(`Hareket bulunamadı: ${action}${entityId ? ` (entity ${entityId})` : ""}`);
    process.exit(1);
  }
  return found;
}

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const eventIds: string[] = [];

  async function cleanupEvents(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const targets = await client.query<{ id: string }>(
        `SELECT id FROM events WHERE id = ANY($1::bigint[]) OR name LIKE 'SMOKE42 %'`,
        [eventIds],
      );
      const targetIds = targets.rows.map((row) => row.id);
      if (targetIds.length > 0) {
        // Hareket akışı audit_logs'ta durduğu için etkinlik satırı silinmeden
        // önce FK'ları temizlenir (event_id ON DELETE SET NULL, ama testin
        // artığı da bırakılmasın).
        await client.query(`DELETE FROM audit_logs WHERE event_id = ANY($1::bigint[])`, [targetIds]);
        await client.query(
          `DELETE FROM event_payment_allocations WHERE payment_id IN (
             SELECT id FROM event_payments WHERE event_id = ANY($1::bigint[])
           )`,
          [targetIds],
        );
        await client.query(`DELETE FROM event_payments WHERE event_id = ANY($1::bigint[])`, [targetIds]);
        await client.query(
          `DELETE FROM event_participant_interactions WHERE event_id = ANY($1::bigint[])`,
          [targetIds],
        );
        await client.query(
          `DELETE FROM event_participant_fees WHERE participant_id IN (
             SELECT id FROM event_participants WHERE event_id = ANY($1::bigint[])
           )`,
          [targetIds],
        );
        await client.query(`DELETE FROM event_participants WHERE event_id = ANY($1::bigint[])`, [targetIds]);
        await client.query(`DELETE FROM event_vehicles WHERE event_id = ANY($1::bigint[])`, [targetIds]);
        await client.query(`DELETE FROM event_fee_items WHERE event_id = ANY($1::bigint[])`, [targetIds]);
        await client.query(`DELETE FROM events WHERE id = ANY($1::bigint[])`, [targetIds]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  try {
    section("SMOKE 42 — Etkinlik hareketleri ve geri alma");

    const actorUserId = await getActorUserId();
    if (actorUserId === null) {
      fail("Aktif kullanıcı yok — önce `npm run db:bootstrap` çalıştırın.");
      process.exit(1);
    }

    // ── A. Kurulum ────────────────────────────────────────────────────────────
    section("A — Etkinlik, katılımcı ve hareket akışının kurulması");
    const event = await createEvent({
      name: "SMOKE42 Hareketler",
      startsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      location: "Stüdyo",
      transportEnabled: true,
      feeItems: [
        { label: "Ders ücreti", amount: "400.00", isLessonFee: true },
        { label: "Kahvaltı", amount: "100.00", isPassThrough: true },
      ],
      actorUserId,
    });
    eventIds.push(event.id);

    const ayse = await createStudent({ fullName: "SMOKE42 Ayşe", actorUserId });
    const mert = await createStudent({ fullName: "SMOKE42 Mert", actorUserId });
    studentIds.push(ayse.id, mert.id);

    const pAyse = await addExistingParticipant(event.id, {
      studentId: ayse.id, rsvpStatus: "unsure", actorUserId,
    });
    const pMert = await addExistingParticipant(event.id, {
      studentId: mert.id, rsvpStatus: "coming", actorUserId,
    });

    let activity = await listEventActivity(event.id);
    assert(activity.length >= 3, "A: etkinlik + iki katılımcı hareketi akışta");
    const addRow = findActivity(activity, "event_participant_added", pAyse.id);
    assertEqual(addRow.subject_name, "SMOKE42 Ayşe", "A: hareket ilgili kişiyle eşleşiyor");
    assert(Boolean(addRow.actor_name), "A: işlemi yapan kullanıcının adı kayda yansıyor");
    assertEqual(addRow.revertable, true, "A: katılımcı ekleme geri alınabilir");
    assertEqual(addRow.participant_id, pAyse.id, "A: listede duran kişi 'Düzelt' için çözülüyor");

    // Başka bir etkinliğin hareketleri bu akışa sızmamalı.
    const otherEvent = await createEvent({
      name: "SMOKE42 Başka Etkinlik",
      startsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(),
      actorUserId,
    });
    eventIds.push(otherEvent.id);
    activity = await listEventActivity(event.id);
    assert(
      activity.every((row) => row.event_id === event.id),
      "A: akış yalnız bu etkinliğin hareketlerini içeriyor",
    );

    // ── B. Katılımcı güncellemesinin geri alınması ────────────────────────────
    section("B — RSVP değişikliği geri alınınca eski değere döner");
    await updateParticipant(pAyse.id, { rsvpStatus: "coming" }, actorUserId);
    activity = await listEventActivity(event.id);
    const updateRow = findActivity(activity, "event_participant_updated", pAyse.id);
    assertEqual(updateRow.revertable, true, "B: güncelleme geri alınabilir");

    const reverted = await revertEventActivity(event.id, updateRow.id, actorUserId);
    assertEqual(reverted.revertable, false, "B: geri alınan kayıt tekrar geri alınamaz");
    assert(Boolean(reverted.reverted_at), "B: orijinal kayıt 'geri alındı' damgası aldı");
    assert(Boolean(reverted.reverted_by_name), "B: geri almayı yapan kullanıcı adıyla kaydedildi");

    const ayseAfterRevert = (await listParticipants(event.id)).find((p) => p.id === pAyse.id)!;
    assertEqual(ayseAfterRevert.rsvp_status, "unsure", "B: RSVP eski değerine döndü");

    await assertRejects(
      () => revertEventActivity(event.id, updateRow.id, actorUserId),
      "EVENT_ACTIVITY_NOT_REVERTIBLE",
      "B: aynı hareket ikinci kez geri alınamaz",
    );

    // Kayıt silinmedi; telafi de kendi hareketi olarak akışta duruyor.
    activity = await listEventActivity(event.id);
    assert(
      activity.some((row) => row.id === updateRow.id),
      "B: geri alınan kayıt akıştan silinmedi",
    );
    assertEqual(
      activity.filter((row) => row.action === "event_participant_updated" && row.entity_id === pAyse.id).length,
      2,
      "B: telafi işlemi kendi hareketini yazdı",
    );

    // ── C. "Arandı" kaydının geri alınması ────────────────────────────────────
    section("C — Yanlış girilen arama kaydı geri alınır");
    await markParticipantContacted(pAyse.id, { note: "SMOKE42 yanlış kayıt" }, actorUserId);
    let ayseRow = (await listParticipants(event.id)).find((p) => p.id === pAyse.id)!;
    assertEqual(Number(ayseRow.contact_count), 1, "C: arama sayacı 1");

    activity = await listEventActivity(event.id);
    const contactRow = findActivity(activity, "event_participant_contacted", pAyse.id);
    await revertEventActivity(event.id, contactRow.id, actorUserId);

    ayseRow = (await listParticipants(event.id)).find((p) => p.id === pAyse.id)!;
    assertEqual(Number(ayseRow.contact_count), 0, "C: arama kaydı geri alındı, sayaç düştü");

    // ── D. Ücret kapsamı geri alma ────────────────────────────────────────────
    section("D — Ücret kaleminin 'kim öder' değişikliği geri alınır");
    const feeItems = (await getEventById(event.id)).feeItems;
    const breakfast = feeItems.find((i) => i.label === "Kahvaltı")!;
    await updateParticipantFee(pMert.id, breakfast.id, { coverage: "studio" }, actorUserId);
    let mertFees = await listParticipantFees(pMert.id);
    assertEqual(
      mertFees.find((f) => f.fee_item_id === breakfast.id)!.coverage,
      "studio",
      "D: kalem stüdyoya devredildi",
    );

    activity = await listEventActivity(event.id);
    const feeRow = findActivity(activity, "event_participant_fee_updated", pMert.id);
    await revertEventActivity(event.id, feeRow.id, actorUserId);

    mertFees = await listParticipantFees(pMert.id);
    const breakfastFee = mertFees.find((f) => f.fee_item_id === breakfast.id)!;
    assertEqual(breakfastFee.coverage, "student", "D: kapsam eski değerine döndü");
    assertMoney(breakfastFee.amount_snapshot, "100.00", "D: tutar da eski değerine döndü");

    // ── E. Tahsilatın geri alınması ───────────────────────────────────────────
    section("E — Yanlış girilen tahsilat geri alınınca iptal edilir");
    const payment = await recordParticipantPayment(pMert.id, "100.00", actorUserId, "cash");
    activity = await listEventActivity(event.id);
    const paymentRow = findActivity(activity, "event_participant_payment_recorded", payment.id);
    assertEqual(paymentRow.participant_id, pMert.id, "E: tahsilat hareketi kişiye bağlandı");

    await revertEventActivity(event.id, paymentRow.id, actorUserId);
    const cancelled = await pool.query<{ cancelled_at: string | null }>(
      `SELECT cancelled_at FROM event_payments WHERE id = $1`,
      [payment.id],
    );
    assert(cancelled.rows[0].cancelled_at !== null, "E: tahsilat silinmedi, iptal edildi");
    mertFees = await listParticipantFees(pMert.id);
    assertMoney(
      mertFees.find((f) => f.fee_item_id === breakfast.id)!.paid_amount,
      "0.00",
      "E: ödenen tutar geri düştü",
    );

    // İptal kaydının kendisi geri alınamaz — nedeni kullanıcıya söylenir.
    activity = await listEventActivity(event.id);
    const cancelRow = findActivity(activity, "event_participant_payment_cancelled", payment.id);
    assertEqual(cancelRow.revertable, false, "E: tahsilat iptali geri alınamaz");
    assert(
      (cancelRow.revert_blocked_reason ?? "").includes("Tahsilat iptali"),
      "E: geri alınamama nedeni Türkçe açıklanıyor",
    );

    // ── F. Katılımcı ekleme / kaldırma geri alma ──────────────────────────────
    section("F — Yanlış eklenen kişi kaldırılır, yanlış kaldırılan kişi geri gelir");
    activity = await listEventActivity(event.id);
    const mertAddRow = findActivity(activity, "event_participant_added", pMert.id);
    await revertEventActivity(event.id, mertAddRow.id, actorUserId);
    assertEqual(
      (await listParticipants(event.id)).some((p) => p.id === pMert.id),
      false,
      "F: yanlış eklenen kişi listeden çıktı",
    );

    activity = await listEventActivity(event.id);
    const removeRow = findActivity(activity, "event_participant_removed", pMert.id);
    assertEqual(removeRow.subject_name, "SMOKE42 Mert", "F: silinen katılımcının adı yine de çözülüyor");
    assertEqual(removeRow.participant_id, null, "F: listede olmayan kişi için 'Düzelt' kapalı");

    await revertEventActivity(event.id, removeRow.id, actorUserId);
    const mertBack = (await listParticipants(event.id)).find((p) => p.student_id === mert.id);
    assert(Boolean(mertBack), "F: kaldırma geri alınınca kişi listeye döndü");
    assertEqual(mertBack!.rsvp_status, "coming", "F: eski RSVP durumuyla geri geldi");

    // ── G. Araç hareketleri ───────────────────────────────────────────────────
    section("G — Yanlış eklenen araç geri alınınca silinir");
    const vehicle = await createVehicle(event.id, {
      vehicleType: "student_car",
      driverName: "SMOKE42 Şoför",
      passengerSeats: 3,
      actorUserId,
    });
    activity = await listEventActivity(event.id);
    const vehicleRow = findActivity(activity, "event_vehicle_created", vehicle.id);
    assertEqual(vehicleRow.vehicle_label, "SMOKE42 Şoför", "G: araç hareketi şoför adıyla görünüyor");

    await revertEventActivity(event.id, vehicleRow.id, actorUserId);
    assertEqual(
      (await listVehicles(event.id)).some((v) => v.id === vehicle.id),
      false,
      "G: araç geri alma ile silindi",
    );

    // ── H. Geri alınamayan hareketler ─────────────────────────────────────────
    section("H — Telafisi olmayan hareketler nedeniyle birlikte reddedilir");
    activity = await listEventActivity(event.id);
    const createdRow = findActivity(activity, "event_created", event.id);
    assertEqual(createdRow.revertable, false, "H: etkinlik oluşturma geri alınamaz");
    await assertRejects(
      () => revertEventActivity(event.id, createdRow.id, actorUserId),
      "EVENT_ACTIVITY_NOT_REVERTIBLE",
      "H: geri alınamaz hareket reddedilir",
    );

    // Başka etkinliğin kaydı bu etkinlikten geri alınamaz.
    const otherActivity = await listEventActivity(otherEvent.id);
    await assertRejects(
      () => revertEventActivity(event.id, otherActivity[0].id, actorUserId),
      "EVENT_ACTIVITY_NOT_FOUND",
      "H: başka etkinliğin hareketi bu etkinlikten geri alınamaz",
    );

    // ── I. HTTP + rol kontrolü ────────────────────────────────────────────────
    section("I — /events/:id/activity HTTP ucu ve asistan kısıtı");
    const admin = seedAdminUser();
    if (!admin) {
      ok("I: BOOTSTRAP_ADMINS yok, HTTP kontrolü atlandı (servis katmanı doğrulandı)");
    } else {
      const server: Server = createServer(createApp());
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;
      const base = `http://127.0.0.1:${port}`;
      const token = await login(admin.username, admin.password);
      try {
        if (!token) {
          fail("I: login başarısız");
          process.exit(1);
        }
        const res = await fetch(`${base}/events/${event.id}/activity`, {
          headers: { Cookie: `session=${token}` },
        });
        assertEqual(res.status, 200, "I: GET /events/:id/activity → 200");
        const body = await res.json();
        assert(Array.isArray(body.data) && body.data.length > 0, "I: HTTP akışı dolu döndü");
        assert(
          body.data.every((row: { actor_name: string | null }) => row.actor_name !== undefined),
          "I: her satırda işlemi yapan kullanıcı alanı var",
        );

        // Asistan rolü hem akışı hem geri almayı görmemeli.
        const previousRole = await pool.query<{ role: string }>(
          `SELECT role FROM users WHERE username = $1`,
          [admin.username],
        );
        await pool.query(`UPDATE users SET role = 'assistant' WHERE username = $1`, [admin.username]);
        try {
          const denied = await fetch(`${base}/events/${event.id}/activity`, {
            headers: { Cookie: `session=${token}` },
          });
          assertEqual(denied.status, 403, "I: asistan hareket akışını göremez");
          const deniedRevert = await fetch(`${base}/events/${event.id}/activity/${createdRow.id}/revert`, {
            method: "POST",
            headers: { Cookie: `session=${token}` },
          });
          assertEqual(deniedRevert.status, 403, "I: asistan geri alma yapamaz");
        } finally {
          await pool.query(`UPDATE users SET role = $2 WHERE username = $1`, [
            admin.username,
            previousRole.rows[0].role,
          ]);
        }
      } finally {
        if (token) await logout(token).catch(() => undefined);
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    ok("\nSMOKE 42 — ETKİNLİK HAREKETLERİ TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    await cleanupEvents();
    const staleStudents = await pool.query<{ id: string }>(
      `SELECT id FROM students WHERE full_name LIKE 'SMOKE42 %' AND deleted_at IS NULL`,
    );
    await cleanupSmoke([...new Set([...studentIds, ...staleStudents.rows.map((row) => row.id)])]);
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
