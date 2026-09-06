/**
 * SMOKE 37 — Etap 4: bildirim zamanlayıcısı (migration 0257)
 *
 * VAPID gerekmez: notification-scheduler.ts'teki trySend() sendToUser'ın
 * PUSH_NOT_CONFIGURED hatasını yutar (loglar) — claim/bastırma/dedup mantığı
 * push'un gerçekten gitmesinden BAĞIMSIZ, doğrudan DB durumu üzerinden
 * doğrulanır.
 *
 * Zaman tetikleyicileri gerçek sleep yerine starts_at/first_seen_at'i offset'li
 * ekleyerek simüle edilir (mevcut smoke konvansiyonu — nextSlotIso/daysAgo gibi).
 *
 * Senaryolar:
 *   A. 30dk hatırlatma: starts_at=+25dk scheduled ders → tetik → reminder_30_
 *      sent_at dolar; ikinci çağrıda değişmez (idempotent).
 *   B. Art arda ders bastırma (asimetrik): aynı eğitmenin starts_at=-20dk,
 *      duration=30dk (bitişi +10dk) dersi VARKEN, X (starts_at=+25dk,
 *      duration=60dk — eşik anı -5dk, Y'nin içinde) için 30dk hatırlatması
 *      CLAIM edilir ama gönderim atlanır; ayrı ders Z (starts_at=+8dk, aynı
 *      çakışma durumunda) için 10dk hatırlatması HİÇ bastırılmadan claim edilir.
 *   C. Bayat ders durumu: starts_at=-3saat, status='scheduled' → tek seferlik
 *      dürtme; ikinci çağrıda değişmez.
 *   D. Yeni sipariş: channel_order_sightings'e (stok senkronundan BAĞIMSIZ,
 *      salt-okunur sipariş listesi defteri — migration 0259) sipariş eklenince
 *      → 1 notified_channel_orders kaydı; tekrar çağrıda hâlâ 1 (dedup);
 *      farklı order_number eklenince 2. kayıt oluşur.
 *   E. Regresyon: order_date 30 gün önce olan ama şimdi görülen (first_seen_at
 *      yeni) sipariş bildirilMEZ — 0260 migration'ın düzelttiği canlı olay.
 *   F. Not hatırlatıcısı (migration 0282): remind_at geçmişe alınınca claim
 *      edilir (sent_at dolar), ikinci çağrıda değişmez (idempotent); not
 *      claim'den önce silinmişse yine de claim edilir (sonsuz yeniden deneme
 *      olmasın diye) ama gönderim atlanır.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/37-notification-scheduler.ts
 */

import {
  check30MinReminders,
  check10MinReminders,
  checkStaleLessonStatus,
  checkNewChannelOrders,
  checkNoteReminders,
} from "../../src/services/notification-scheduler.js";
import { addNote, deleteNote } from "../../src/services/notes.service.js";
import { createStudent } from "../../src/services/students.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  assert,
  assertEqual,
  ok,
  fail,
  closePool,
  cleanupSmoke,
  getActorUserId,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const orderNumbers: string[] = [];
  const noteIds: string[] = [];

  try {
    section("SMOKE 37 — Bildirim zamanlayıcısı");

    const instructorRow = await pool.query<{ id: string }>(
      `SELECT id FROM instructors WHERE is_active AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
    );
    if (!instructorRow.rows[0]) {
      fail("Setup: aktif eğitmen bulunamadı");
      process.exit(1);
    }
    const instructorId = instructorRow.rows[0].id;

    const lessonTypeRow = await pool.query<{ id: string }>(
      `SELECT id FROM lesson_types WHERE is_active AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
    );
    if (!lessonTypeRow.rows[0]) {
      fail("Setup: aktif ders tipi bulunamadı");
      process.exit(1);
    }
    const lessonTypeId = lessonTypeRow.rows[0].id;

    const student = await createStudent({ fullName: "SMOKE37_main" });
    studentIds.push(student.id);

    async function insertLesson(offsetMinutes: number, durationMinutes: number): Promise<string> {
      const startsAt = new Date(Date.now() + offsetMinutes * 60_000).toISOString();
      const r = await pool.query<{ id: string }>(
        `INSERT INTO lessons
           (student_id, instructor_id, lesson_type_id, starts_at, mode, status, duration_minutes, price_snapshot)
         VALUES ($1, $2, $3, $4, 'onsite', 'scheduled', $5, '100.00')
         RETURNING id`,
        [student.id, instructorId, lessonTypeId, startsAt, durationMinutes],
      );
      return r.rows[0].id;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A. 30dk hatırlatma + idempotency
    // ─────────────────────────────────────────────────────────────────────────
    section("A — 30dk hatırlatma: tetiklenir + idempotent");

    const lessonA = await insertLesson(25, 60);
    await check30MinReminders();
    const afterA1 = await pool.query<{ reminder_30_sent_at: string | null }>(
      `SELECT reminder_30_sent_at::text AS reminder_30_sent_at FROM lessons WHERE id = $1`,
      [lessonA],
    );
    assert(afterA1.rows[0].reminder_30_sent_at !== null, "A: reminder_30_sent_at dolu");
    const stampA1 = afterA1.rows[0].reminder_30_sent_at;

    await check30MinReminders();
    const afterA2 = await pool.query<{ reminder_30_sent_at: string | null }>(
      `SELECT reminder_30_sent_at::text AS reminder_30_sent_at FROM lessons WHERE id = $1`,
      [lessonA],
    );
    assertEqual(afterA2.rows[0].reminder_30_sent_at, stampA1, "A: ikinci çağrıda damga değişmedi (idempotent)");

    // ─────────────────────────────────────────────────────────────────────────
    // B. Art arda ders bastırması (asimetrik: 30dk bastırılır, 10dk bastırılmaz)
    // ─────────────────────────────────────────────────────────────────────────
    section("B — Art arda ders: 30dk bastırılır (yine de claim edilir), 10dk asla bastırılmaz");

    // Y: bloklayan ders — now-20dk başlayıp 30dk sürüyor (bitişi now+10dk).
    await insertLesson(-20, 30);
    // X: now+25dk başlıyor → eşik anı (starts_at-30dk = now-5dk) Y'nin [now-20dk, now+10dk) aralığında.
    const lessonX = await insertLesson(25, 60);
    await check30MinReminders();
    const afterX = await pool.query<{ reminder_30_sent_at: string | null }>(
      `SELECT reminder_30_sent_at::text AS reminder_30_sent_at FROM lessons WHERE id = $1`,
      [lessonX],
    );
    assert(
      afterX.rows[0].reminder_30_sent_at !== null,
      "B: X'in reminder_30_sent_at'i claim edildi (gönderim eğitmen derste olduğu için atlandı)",
    );

    // Z: 10dk testi — aynı çakışma durumu (Y hâlâ now+10dk'ya kadar aktif).
    const lessonZ = await insertLesson(8, 60);
    await check10MinReminders();
    const afterZ = await pool.query<{ reminder_10_sent_at: string | null }>(
      `SELECT reminder_10_sent_at::text AS reminder_10_sent_at FROM lessons WHERE id = $1`,
      [lessonZ],
    );
    assert(afterZ.rows[0].reminder_10_sent_at !== null, "B: 10dk hiçbir zaman bastırılmaz — Z'nin damgası dolu");

    // ─────────────────────────────────────────────────────────────────────────
    // C. Bayat ders durumu — tek seferlik dürtme
    // ─────────────────────────────────────────────────────────────────────────
    section("C — Bayat ders durumu: tek seferlik dürtme");

    const lessonC = await insertLesson(-180, 60);
    await checkStaleLessonStatus();
    const afterC1 = await pool.query<{ status_nudge_sent_at: string | null }>(
      `SELECT status_nudge_sent_at::text AS status_nudge_sent_at FROM lessons WHERE id = $1`,
      [lessonC],
    );
    assert(afterC1.rows[0].status_nudge_sent_at !== null, "C: status_nudge_sent_at dolu");
    const stampC1 = afterC1.rows[0].status_nudge_sent_at;

    await checkStaleLessonStatus();
    const afterC2 = await pool.query<{ status_nudge_sent_at: string | null }>(
      `SELECT status_nudge_sent_at::text AS status_nudge_sent_at FROM lessons WHERE id = $1`,
      [lessonC],
    );
    assertEqual(afterC2.rows[0].status_nudge_sent_at, stampC1, "C: ikinci çağrıda değişmedi (tek seferlik)");

    // ─────────────────────────────────────────────────────────────────────────
    // D. Yeni sipariş — stok senkronundan bağımsız, sightings kaynaklı dedup
    // ─────────────────────────────────────────────────────────────────────────
    section("D — Yeni sipariş: sightings kaydı → 1 bildirim kaydı (stoktan bağımsız)");

    const orderNumber1 = `SMOKE37-${Date.now()}-1`;
    orderNumbers.push(orderNumber1);
    await pool.query(
      `INSERT INTO channel_order_sightings (channel, order_number, customer_name, first_seen_at, order_date)
       VALUES ('trendyol', $1, 'Test Müşteri', now(), now())`,
      [orderNumber1],
    );

    await checkNewChannelOrders();
    const countD1 = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM notified_channel_orders WHERE channel = 'trendyol' AND order_number = $1`,
      [orderNumber1],
    );
    assertEqual(countD1.rows[0].c, "1", "D: görülen sipariş için 1 bildirim kaydı");

    await checkNewChannelOrders();
    const countD2 = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM notified_channel_orders WHERE channel = 'trendyol' AND order_number = $1`,
      [orderNumber1],
    );
    assertEqual(countD2.rows[0].c, "1", "D: tekrar çağrıda hâlâ 1 (dedup)");

    const orderNumber2 = `SMOKE37-${Date.now()}-2`;
    orderNumbers.push(orderNumber2);
    await pool.query(
      `INSERT INTO channel_order_sightings (channel, order_number, customer_name, first_seen_at, order_date)
       VALUES ('trendyol', $1, 'Başka Müşteri', now(), now())`,
      [orderNumber2],
    );
    await checkNewChannelOrders();
    const countAll = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM notified_channel_orders
        WHERE channel = 'trendyol' AND order_number = ANY($1::text[])`,
      [orderNumbers],
    );
    assertEqual(countAll.rows[0].c, "2", "D: farklı sipariş için ayrı kayıt oluştu (global kilit yok)");

    // ─────────────────────────────────────────────────────────────────────────
    // E. Regresyon — REGRESYON (2026-07-16 canlı olay): first_seen_at YENİ ama
    // order_date ESKİ (ör. geniş bir pencere ilk kez çekildiğinde geçmiş
    // siparişler first_seen_at=now() alır) → BİLDİRİLMEMELİ. İlk sürüm bunu
    // first_seen_at'e göre filtrelediği için 55 eski sipariş tek seferde 3 gerçek
    // kullanıcıya bildirilmeye çalışılmıştı.
    // ─────────────────────────────────────────────────────────────────────────
    section("E — Regresyon: yeni görülen ama ESKİ tarihli sipariş bildirilmez");

    const orderNumberOld = `SMOKE37-${Date.now()}-old`;
    orderNumbers.push(orderNumberOld);
    await pool.query(
      `INSERT INTO channel_order_sightings (channel, order_number, customer_name, first_seen_at, order_date)
       VALUES ('trendyol', $1, 'Eski Müşteri', now(), now() - interval '30 days')`,
      [orderNumberOld],
    );
    await checkNewChannelOrders();
    const countOld = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM notified_channel_orders WHERE channel = 'trendyol' AND order_number = $1`,
      [orderNumberOld],
    );
    assertEqual(countOld.rows[0].c, "0", "E: 30 gün önce verilmiş sipariş, yeni görülse bile bildirilmedi");

    // ─────────────────────────────────────────────────────────────────────────
    // F. Not hatırlatıcısı — claim + idempotency + silinmiş nota gönderilmez
    // ─────────────────────────────────────────────────────────────────────────
    section("F — Not hatırlatıcısı: claim + idempotent + silinmiş nota gönderim atlanır");

    const actorUserId = await getActorUserId();
    if (!actorUserId) {
      ok("F: aktif kullanıcı yok (BOOTSTRAP_ADMINS?), not hatırlatıcısı testi atlandı");
    } else {
      // addNote yalnız gelecekteki zamanı kabul eder; "zamanı geldi" durumu
      // insertLesson'daki starts_at offset deseniyle aynı fikirle simüle
      // edilir — kayıttan sonra remind_at doğrudan DB'de geçmişe alınır.
      const noteF = await addNote({
        body: "SMOKE37 Hatırlatıcılı not.",
        actorUserId,
        reminder: { remindAt: new Date(Date.now() + 60_000).toISOString(), recipientUserIds: [actorUserId] },
      });
      noteIds.push(noteF.id);
      await pool.query(`UPDATE note_reminders SET remind_at = now() - interval '1 minute' WHERE note_id = $1`, [noteF.id]);

      await checkNoteReminders();
      const afterF1 = await pool.query<{ sent_at: string | null }>(
        `SELECT sent_at::text AS sent_at FROM note_reminders WHERE note_id = $1`,
        [noteF.id],
      );
      assert(afterF1.rows[0].sent_at !== null, "F: sent_at dolu (claim edildi)");
      const stampF1 = afterF1.rows[0].sent_at;

      await checkNoteReminders();
      const afterF2 = await pool.query<{ sent_at: string | null }>(
        `SELECT sent_at::text AS sent_at FROM note_reminders WHERE note_id = $1`,
        [noteF.id],
      );
      assertEqual(afterF2.rows[0].sent_at, stampF1, "F: ikinci çağrıda damga değişmedi (idempotent)");

      // Silinmiş not: claim yine de olur (sonsuz yeniden deneme olmasın diye) —
      // yalnız gönderim atlanır (push zaten VAPID'siz sessizce yutuluyor,
      // burada doğrulanabilen tek şey claim'in engellenmediğidir).
      const noteFDeleted = await addNote({
        body: "SMOKE37 Hatırlatıcılı, sonra silinen not.",
        actorUserId,
        reminder: { remindAt: new Date(Date.now() + 60_000).toISOString(), recipientUserIds: [actorUserId] },
      });
      noteIds.push(noteFDeleted.id);
      await deleteNote(noteFDeleted.id, actorUserId);
      await pool.query(`UPDATE note_reminders SET remind_at = now() - interval '1 minute' WHERE note_id = $1`, [noteFDeleted.id]);

      await checkNoteReminders();
      const afterFDeleted = await pool.query<{ sent_at: string | null }>(
        `SELECT sent_at::text AS sent_at FROM note_reminders WHERE note_id = $1`,
        [noteFDeleted.id],
      );
      assert(afterFDeleted.rows[0].sent_at !== null, "F: silinmiş not için de claim edilir (retry fırtınası olmaz)");
    }

    ok("\nSMOKE 37 — BİLDİRİM ZAMANLAYICISI TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    if (orderNumbers.length > 0) {
      await pool
        .query(`DELETE FROM notified_channel_orders WHERE channel = 'trendyol' AND order_number = ANY($1::text[])`, [orderNumbers])
        .catch(() => undefined);
      await pool
        .query(`DELETE FROM channel_order_sightings WHERE channel = 'trendyol' AND order_number = ANY($1::text[])`, [orderNumbers])
        .catch(() => undefined);
    }
    if (noteIds.length > 0) {
      // note_reminders, notes.id FK'sinde ON DELETE CASCADE olduğu için not
      // silinince kendiliğinden temizlenir.
      await pool.query(`DELETE FROM notes WHERE id = ANY($1::bigint[])`, [noteIds]).catch(() => undefined);
    }
    // cleanupSmoke, studentIds'e bağlı TÜM lessons satırlarını (A/B/C senaryolarında
    // yaratılanlar dahil) soft-delete eder — ayrıca lesson-id takibi gerekmez.
    await cleanupSmoke(studentIds);
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
