/**
 * SMOKE 43 — Etkinlik günü ekranı (migration 0284)
 *
 * Kapıda tutulan düz giriş listesinin sunucu tarafı:
 *   - fiyatların etkinliğin ücret kalemlerinden türetilmesi,
 *   - kayıtlı öğrenci / hafif kayıt ekleme; hafif kaydın ana öğrenci listesine
 *     düşmemesi; TR cep telefonu normalizasyonu ve reddi,
 *   - para kuralları: tutar varsa yöntem şart, 0 ₺'de yöntem yok, kahvaltı
 *     bize ödendiyse yarım ödenemez,
 *   - aynı öğrencinin iki kez yazılamaması (servis + DB kısmi unique index),
 *   - "ödeme OK" tiki: para alanı değişince kalkar, not değişince kalır,
 *   - soft delete + geri al, geri almada tekrar çakışması,
 *   - özet: kasa ve kahvaltı sayıları, restorana ödenecek tutar,
 *   - arama: Türkçe karakter duyarsız isim, son 4 hane, numaranın başı,
 *   - öğrenci kalıcı silinince satırın adıyla kalması,
 *   - HTTP uçlarının asistan rolüne açık olması,
 *   - kahvaltı fişi onayı (migration 0285): "restorana kendi öder" kayıt
 *     anında değil, fiş gösterilince onaylanır; yalnız bu kahvaltı türünde
 *     geçerlidir, tür değişince kendiliğinden düşer,
 *   - sadece kahvaltı misafiri (migration 0286): derse hiç katılmayan,
 *     öğrenci olamayan bir kahvaltı-only satır; oluşturulduktan sonra
 *     değişmez; "N kişi" ve kahvaltı özetine dahildir.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/43-event-day.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createStudent, hardDeleteStudent } from "../../src/services/students.service.js";
import { addExistingParticipant, createEvent } from "../../src/services/events.service.js";
import {
  createEventDayEntry,
  deleteEventDayEntry,
  getEventDay,
  restoreEventDayEntry,
  searchEventDay,
  updateEventDayEntry,
} from "../../src/services/event-day.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  assert,
  assertEqual,
  assertMoney,
  assertRejects,
  assertSqlRejects,
  getActorUserId,
  ok,
  fail,
  closePool,
  cleanupSmoke,
  seedAdminUser,
} from "./_shared.js";

async function run(): Promise<void> {
  const studentIds: string[] = [];
  const eventIds: string[] = [];

  async function cleanupEvents(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const targets = await client.query<{ id: string }>(
        `SELECT id FROM events WHERE id = ANY($1::bigint[]) OR name LIKE 'SMOKE43 %'`,
        [eventIds],
      );
      const targetIds = targets.rows.map((row) => row.id);
      if (targetIds.length > 0) {
        await client.query(
          `DELETE FROM audit_logs
            WHERE entity_type = 'event_day_entry'
              AND entity_id IN (SELECT id FROM event_day_entries WHERE event_id = ANY($1::bigint[]))`,
          [targetIds],
        );
        await client.query(`DELETE FROM event_day_entries WHERE event_id = ANY($1::bigint[])`, [targetIds]);
        await client.query(`DELETE FROM audit_logs WHERE event_id = ANY($1::bigint[])`, [targetIds]);
        await client.query(
          `DELETE FROM event_participant_fees WHERE participant_id IN (
             SELECT id FROM event_participants WHERE event_id = ANY($1::bigint[])
           )`,
          [targetIds],
        );
        await client.query(`DELETE FROM event_participants WHERE event_id = ANY($1::bigint[])`, [targetIds]);
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
    section("SMOKE 43 — Etkinlik günü ekranı");

    const actorUserId = await getActorUserId();
    if (actorUserId === null) {
      fail("Aktif kullanıcı yok — önce `npm run db:bootstrap` çalıştırın.");
      process.exit(1);
    }

    // ── A. Kurulum ────────────────────────────────────────────────────────────
    section("A — Kurulum: fiyatlar ücret kalemlerinden türetilir");
    const event = await createEvent({
      name: "SMOKE43 Etkinlik günü",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      feeItems: [
        { label: "Ders ücreti", amount: "1050.00", isLessonFee: true },
        { label: "Kahvaltı", amount: "650.00", isPassThrough: true },
      ],
      actorUserId,
    });
    eventIds.push(event.id);

    const ayse = await createStudent({ fullName: "SMOKE43 Ayşe Işık", phone: "0532 111 22 33", actorUserId });
    const mert = await createStudent({ fullName: "SMOKE43 Mert", actorUserId });
    studentIds.push(ayse.id, mert.id);
    await addExistingParticipant(event.id, { studentId: ayse.id, actorUserId });

    let day = await getEventDay(event.id);
    assertMoney(day.pricing.lessonFee ?? "NaN", "1050.00", "A: ders ücreti ücret kaleminden geldi");
    assertMoney(day.pricing.breakfastFee ?? "NaN", "650.00", "A: kahvaltı ücreti dışarıya ödenen kalemden geldi");
    assertEqual(day.entries.length, 0, "A: liste boş başlar");
    assertEqual(day.summary.people, 0, "A: özet sıfırdan başlar");

    // ── B. Arama ──────────────────────────────────────────────────────────────
    section("B — Arama: Türkçe karakter duyarsız isim, son 4 hane, numaranın başı");
    let results = await searchEventDay(event.id, "smoke43 ayse isik");
    const ayseHit = results.find((row) => row.student_id === ayse.id);
    assert(Boolean(ayseHit), "B: 'ayse isik' yazınca 'Ayşe Işık' bulunur");
    assertEqual(ayseHit!.pre_registered, true, "B: eski katılımcı listesindeki kişi ön kayıtlı işaretli");
    assertEqual(ayseHit!.entry_id, null, "B: henüz etkinlik günü listesinde değil");
    results = await searchEventDay(event.id, "ISIK SMOKE43");
    assert(results.some((row) => row.student_id === ayse.id), "B: kelime sırası ve büyük harf fark etmez");
    results = await searchEventDay(event.id, "2233");
    assert(results.some((row) => row.student_id === ayse.id), "B: son 4 hane ile bulunur");
    results = await searchEventDay(event.id, "0532 111");
    assert(results.some((row) => row.student_id === ayse.id), "B: numaranın başıyla bulunur");

    // ── C. Kayıtlı öğrenci ────────────────────────────────────────────────────
    section("C — Kayıtlı öğrenci eklenir, ikinci kez eklenemez");
    const e1 = await createEventDayEntry(
      event.id,
      { studentId: ayse.id, amount: "1700", paymentMethod: "cash", breakfast: "paid_to_us" },
      actorUserId,
    );
    assertEqual(e1.is_light, false, "C: kayıtlı öğrenci satırı");
    assertEqual(e1.pre_registered, true, "C: ön kayıt bilgisi satıra yansıdı");
    assertEqual(e1.full_name, "SMOKE43 Ayşe Işık", "C: ad öğrenci kaydından geldi");
    assertMoney(e1.amount, "1700.00", "C: tutar");
    assert(Boolean(e1.created_by_name), "C: ekleyen kullanıcının adı çözülüyor");
    await assertRejects(
      () => createEventDayEntry(event.id, { studentId: ayse.id, amount: "0" }, actorUserId),
      "DUPLICATE_EVENT_DAY_ENTRY",
      "C: aynı öğrenci ikinci kez yazılamaz",
    );
    results = await searchEventDay(event.id, "ayşe ışık");
    assertEqual(
      results.find((row) => row.student_id === ayse.id)?.entry_id ?? null,
      e1.id,
      "C: aramada 'listede' olarak işaretli",
    );

    // ── D. Hafif kayıt ────────────────────────────────────────────────────────
    section("D — Hafif kayıt: öğrenci listesine düşmez, telefon TR cep olarak normalize edilir");
    const e2 = await createEventDayEntry(
      event.id,
      {
        fullName: "  SMOKE43   Zeynep  ",
        phone: "0 (544) 987 65 43",
        amount: "1050",
        paymentMethod: "card",
        breakfast: "paid_to_restaurant",
      },
      actorUserId,
    );
    assertEqual(e2.is_light, true, "D: hafif kayıt");
    assertEqual(e2.full_name, "SMOKE43 Zeynep", "D: ad boşlukları temizlendi");
    assertEqual(e2.phone, "5449876543", "D: telefon ulusal 10 haneye indirgendi");
    const leaked = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM students WHERE full_name LIKE 'SMOKE43 Zeynep%'`,
    );
    assertEqual(leaked.rows[0].count, "0", "D: hafif kayıt ana öğrenci listesine düşmedi");
    const plus90 = await createEventDayEntry(
      event.id,
      { fullName: "SMOKE43 Artı", phone: "+90 555 000 11 22", amount: "0" },
      actorUserId,
    );
    assertEqual(plus90.phone, "5550001122", "D: +90 ön eki atıldı");
    await assertRejects(
      () => createEventDayEntry(event.id, { fullName: "SMOKE43 Sabit", phone: "0212 123 45 67", amount: "0" }, actorUserId),
      "VALIDATION_ERROR",
      "D: 5 ile başlamayan numara reddedilir",
    );
    await assertRejects(
      () => createEventDayEntry(event.id, { fullName: "SMOKE43 Eksik", phone: "0544 987 65", amount: "0" }, actorUserId),
      "VALIDATION_ERROR",
      "D: eksik numara reddedilir",
    );
    await assertRejects(
      () => createEventDayEntry(event.id, { fullName: "   ", amount: "0" }, actorUserId),
      "VALIDATION_ERROR",
      "D: ad soyad zorunlu",
    );
    results = await searchEventDay(event.id, "6543");
    assert(
      results.some((row) => row.kind === "entry" && row.entry_id === e2.id),
      "D: hafif kayıt da son 4 haneyle bulunur",
    );
    results = await searchEventDay(event.id, "zeynep");
    assert(
      results.some((row) => row.kind === "entry" && row.entry_id === e2.id),
      "D: hafif kayıt isimle bulunur",
    );

    // ── E. Para kuralları ─────────────────────────────────────────────────────
    section("E — Para kuralları: yöntem, 0 ₺, kahvaltı yarım ödenemez");
    await assertRejects(
      () => createEventDayEntry(
        event.id,
        { fullName: "SMOKE43 Yarım", amount: "600", paymentMethod: "cash", breakfast: "paid_to_us" },
        actorUserId,
      ),
      "VALIDATION_ERROR",
      "E: kahvaltı bize ödendiyse tutar kahvaltı fiyatının altında olamaz",
    );
    await assertRejects(
      () => createEventDayEntry(event.id, { fullName: "SMOKE43 Yöntemsiz", amount: "500" }, actorUserId),
      "VALIDATION_ERROR",
      "E: tutar varsa ödeme yöntemi zorunlu",
    );
    await assertRejects(
      () => createEventDayEntry(event.id, { fullName: "SMOKE43 Tutarsız" }, actorUserId),
      "VALIDATION_ERROR",
      "E: tutar boş bırakılamaz (ücretsizse 0)",
    );
    const e3 = await createEventDayEntry(
      event.id,
      { studentId: mert.id, amount: "650", paymentMethod: "iban", breakfast: "paid_to_us" },
      actorUserId,
    );
    assertMoney(e3.amount, "650.00", "E: ders bedava, kahvaltı tam ödendi");
    const e4 = await createEventDayEntry(
      event.id,
      { fullName: "SMOKE43 Bedava", amount: "0", paymentMethod: "cash", breakfast: "free" },
      actorUserId,
    );
    assertEqual(e4.payment_method, null, "E: 0 ₺ kayıtta ödeme yöntemi tutulmaz");
    assertEqual(e4.breakfast, "free", "E: bedava kahvaltı listeye girer");

    // ── F. Özet ───────────────────────────────────────────────────────────────
    section("F — Özet: kasa ve kahvaltı");
    day = await getEventDay(event.id);
    const summary = day.summary;
    assertEqual(summary.people, 5, "F: kişi sayısı");
    assertMoney(summary.cash, "1700.00", "F: nakit");
    assertMoney(summary.card, "1050.00", "F: kart");
    assertMoney(summary.iban, "650.00", "F: IBAN");
    assertMoney(summary.total, "3400.00", "F: toplam");
    assertEqual(summary.breakfastCount, 4, "F: kahvaltı fişi sayısı");
    assertEqual(summary.breakfastPaidToUs, 2, "F: kahvaltıyı bize ödeyen");
    assertEqual(summary.breakfastPaidToRestaurant, 1, "F: restorana kendisi ödeyen");
    assertEqual(summary.breakfastFree, 1, "F: bedava kahvaltı");
    assertMoney(summary.breakfastCollected, "1300.00", "F: kasadaki kahvaltı parası (restoranın)");
    assertMoney(summary.restaurantOwed, "1950.00", "F: restorana ödenecek = (bize + bedava) × 650");
    assertEqual(day.entries[0].id, e4.id, "F: en yeni kayıt en üstte");

    // ── G. Tik ve düzenleme ───────────────────────────────────────────────────
    section("G — 'Ödeme OK' tiki ve düzenleme");
    let updated = await updateEventDayEntry(e1.id, { checked: true }, actorUserId);
    assert(updated.checked_at !== null, "G: tik kondu");
    assert(Boolean(updated.checked_by_name), "G: tikleyen kullanıcı adıyla görünüyor");
    updated = await updateEventDayEntry(e1.id, { note: "SMOKE43 not" }, actorUserId);
    assert(updated.checked_at !== null, "G: yalnız not değişince tik kalır");
    assertEqual(updated.note, "SMOKE43 not", "G: not kaydedildi");
    updated = await updateEventDayEntry(e1.id, { amount: "1500" }, actorUserId);
    assertEqual(updated.checked_at, null, "G: tutar değişince tik kendiliğinden kalktı");
    assertMoney(updated.amount, "1500.00", "G: tutar güncellendi");
    assert(Boolean(updated.updated_by_name), "G: son değiştiren kullanıcı görünüyor");
    updated = await updateEventDayEntry(
      e1.id,
      { paymentMethod: "card", breakfast: "paid_to_restaurant", amount: "1050", checked: true },
      actorUserId,
    );
    assert(updated.checked_at !== null, "G: aynı istekte checked:true gelirse tik yeniden konur");
    assertEqual(updated.payment_method, "card", "G: yöntem kart oldu");
    updated = await updateEventDayEntry(e1.id, { checked: false }, actorUserId);
    assertEqual(updated.checked_at, null, "G: tik elle kaldırılabilir");
    await assertRejects(
      () => updateEventDayEntry(e1.id, { fullName: "Başka İsim" }, actorUserId),
      "VALIDATION_ERROR",
      "G: kayıtlı öğrencinin adı buradan değişmez",
    );
    updated = await updateEventDayEntry(e2.id, { fullName: "SMOKE43 Zeynep Kaya", phone: "" }, actorUserId);
    assertEqual(updated.full_name, "SMOKE43 Zeynep Kaya", "G: hafif kaydın adı düzenlenir");
    assertEqual(updated.phone, null, "G: hafif kaydın telefonu silinebilir");
    await assertRejects(
      () => updateEventDayEntry(e3.id, { amount: "400" }, actorUserId),
      "VALIDATION_ERROR",
      "G: düzenlemede de kahvaltı yarım ödenemez",
    );
    updated = await updateEventDayEntry(e3.id, { amount: "0", breakfast: "free" }, actorUserId);
    assertEqual(updated.payment_method, null, "G: tutar 0'a inince yöntem temizlendi");

    // ── H. Silme ve geri alma ─────────────────────────────────────────────────
    section("H — Soft delete ve geri al");
    await deleteEventDayEntry(e4.id, actorUserId);
    day = await getEventDay(event.id);
    assertEqual(day.entries.some((entry) => entry.id === e4.id), false, "H: silinen kayıt listeden düştü");
    assertEqual(day.summary.people, 4, "H: özet silineni saymıyor");
    const restored = await restoreEventDayEntry(e4.id, actorUserId);
    assertEqual(restored.id, e4.id, "H: kayıt geri getirildi");
    assertEqual((await getEventDay(event.id)).summary.people, 5, "H: geri gelen kayıt yeniden sayılıyor");
    await deleteEventDayEntry(e3.id, actorUserId);
    const e3again = await createEventDayEntry(event.id, { studentId: mert.id, amount: "0" }, actorUserId);
    assert(e3again.id !== e3.id, "H: silinen öğrenci yeniden eklenebilir");
    await assertRejects(
      () => restoreEventDayEntry(e3.id, actorUserId),
      "DUPLICATE_EVENT_DAY_ENTRY",
      "H: öğrenci yeniden eklenmişse eski kayıt geri gelmez",
    );
    await assertRejects(
      () => updateEventDayEntry(e3.id, { note: "x" }, actorUserId),
      "EVENT_DAY_ENTRY_NOT_FOUND",
      "H: silinmiş kayıt düzenlenemez",
    );

    // ── I. DB kısıtları ───────────────────────────────────────────────────────
    section("I — DB kısıtları servis dışından da korunur");
    await assertSqlRejects(
      () => pool.query(
        `INSERT INTO event_day_entries (event_id, full_name, amount) VALUES ($1, 'SMOKE43 SQL', 100)`,
        [event.id],
      ),
      "event_day_entries_method_matches_amount",
      "I: tutar varken yöntemsiz satır DB'de reddedilir",
    );
    await assertSqlRejects(
      () => pool.query(
        `INSERT INTO event_day_entries (event_id, full_name, phone) VALUES ($1, 'SMOKE43 SQL', '2121234567')`,
        [event.id],
      ),
      "event_day_entries_phone_check",
      "I: 5 ile başlamayan telefon DB'de reddedilir",
    );
    await assertSqlRejects(
      () => pool.query(
        `INSERT INTO event_day_entries (event_id, student_id, full_name) VALUES ($1, $2, 'SMOKE43 SQL')`,
        [event.id, ayse.id],
      ),
      "event_day_entries_one_per_student_idx",
      "I: aynı öğrenci DB'de de ikinci kez yazılamaz",
    );
    await assertSqlRejects(
      () => pool.query(
        `INSERT INTO event_day_entries (event_id, full_name, breakfast, breakfast_confirmed_at)
         VALUES ($1, 'SMOKE43 SQL', 'paid_to_us', now())`,
        [event.id],
      ),
      "event_day_entries_breakfast_confirm_scope",
      "I: kahvaltı fişi onayı yalnız 'restorana kendi öder' dışında DB'de reddedilir",
    );

    // ── J. Öğrenci kalıcı silinirse ───────────────────────────────────────────
    section("J — Öğrenci kalıcı silinince satır adıyla kalır");
    const temp = await createStudent({ fullName: "SMOKE43 Silinecek", actorUserId });
    const e6 = await createEventDayEntry(event.id, { studentId: temp.id, amount: "0" }, actorUserId);
    await hardDeleteStudent(temp.id, actorUserId);
    const orphan = (await getEventDay(event.id)).entries.find((entry) => entry.id === e6.id);
    assert(Boolean(orphan), "J: satır listede kaldı");
    assertEqual(orphan!.student_id, null, "J: öğrenci bağı koptu");
    assertEqual(orphan!.full_name, "SMOKE43 Silinecek", "J: satır ad kopyasıyla görünüyor");

    // ── K. HTTP + asistan ─────────────────────────────────────────────────────
    section("K — HTTP uçları asistan rolüne açık");
    const admin = seedAdminUser();
    if (!admin) {
      ok("K: BOOTSTRAP_ADMINS yok, HTTP kontrolü atlandı (servis katmanı doğrulandı)");
    } else {
      const server: Server = createServer(createApp());
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const token = await login(admin.username, admin.password);
      const previousRole = await pool.query<{ role: string }>(
        `SELECT role FROM users WHERE username = $1`,
        [admin.username],
      );
      try {
        if (!token) {
          fail("K: login başarısız");
          process.exit(1);
        }
        await pool.query(`UPDATE users SET role = 'assistant' WHERE username = $1`, [admin.username]);
        const headers = { Cookie: `session=${token}`, "Content-Type": "application/json" };

        const dayRes = await fetch(`${base}/events/${event.id}/day`, { headers });
        assertEqual(dayRes.status, 200, "K: asistan etkinlik günü ekranını açar");
        const dayBody = await dayRes.json();
        assert(typeof dayBody.data?.summary?.total === "string", "K: asistan toplamları da görür");

        const createRes = await fetch(`${base}/events/${event.id}/day/entries`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            fullName: "SMOKE43 Asistan",
            phone: "05321234567",
            amount: "1700",
            paymentMethod: "cash",
            breakfast: "paid_to_us",
          }),
        });
        assertEqual(createRes.status, 201, "K: asistan kayıt ekler");
        const created = (await createRes.json()).data as { id: string };

        const patchRes = await fetch(`${base}/events/day-entries/${created.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ checked: true }),
        });
        assertEqual(patchRes.status, 200, "K: asistan tik atar");

        const searchRes = await fetch(
          `${base}/events/${event.id}/day/search?q=${encodeURIComponent("asistan")}`,
          { headers },
        );
        const searchBody = await searchRes.json();
        assert(
          searchBody.data.some((row: { entry_id: string | null }) => row.entry_id === created.id),
          "K: arama HTTP üzerinden çalışır",
        );

        const badRes = await fetch(`${base}/events/${event.id}/day/entries`, {
          method: "POST",
          headers,
          body: JSON.stringify({ fullName: "SMOKE43 Hatalı", amount: "600", paymentMethod: "cash", breakfast: "paid_to_us" }),
        });
        assertEqual(badRes.status, 400, "K: kural ihlali 400 döner");
        assert(JSON.stringify(await badRes.json()).includes("Kahvaltı"), "K: hata mesajı Türkçe ve açıklayıcı");

        const deleteRes = await fetch(`${base}/events/day-entries/${created.id}`, { method: "DELETE", headers });
        assertEqual(deleteRes.status, 200, "K: asistan kayıt siler");
        const restoreRes = await fetch(`${base}/events/day-entries/${created.id}/restore`, { method: "POST", headers });
        assertEqual(restoreRes.status, 200, "K: asistan silineni geri alır");
      } finally {
        await pool.query(`UPDATE users SET role = $2 WHERE username = $1`, [
          admin.username,
          previousRole.rows[0].role,
        ]);
        if (token) await logout(token).catch(() => undefined);
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    // ── L. Kahvaltı fişi onayı ───────────────────────────────────────────────
    // "Restorana kendi öder" kapıda bir niyettir, kahvaltı verildi demek
    // değildir — kişi fişini getirip gösterince ayrıca onaylanır.
    section("L — 'Restorana kendi öder': kayıt anında değil, fiş gösterince onaylanır");
    const e7 = await createEventDayEntry(
      event.id,
      { fullName: "SMOKE43 Fişli", amount: "0", breakfast: "paid_to_restaurant" },
      actorUserId,
    );
    assertEqual(e7.breakfast_confirmed_at, null, "L: yeni kayıt kahvaltı fişi onaysız başlar");

    await assertRejects(
      () => updateEventDayEntry(
        e7.id,
        { breakfast: "paid_to_us", amount: "650", paymentMethod: "cash", breakfastConfirmed: true },
        actorUserId,
      ),
      "VALIDATION_ERROR",
      "L: onay yalnız 'restorana kendi öder' kahvaltısında verilebilir",
    );

    let confirmed = await updateEventDayEntry(e7.id, { breakfastConfirmed: true }, actorUserId);
    assert(confirmed.breakfast_confirmed_at !== null, "L: fiş görülünce onaylanır");
    assert(Boolean(confirmed.breakfast_confirmed_by_name), "L: onaylayan kullanıcı adıyla görünüyor");

    confirmed = await updateEventDayEntry(
      e7.id,
      { breakfast: "paid_to_us", amount: "650", paymentMethod: "cash" },
      actorUserId,
    );
    assertEqual(confirmed.breakfast_confirmed_at, null, "L: kahvaltı türü değişince eski onay kendiliğinden düşer");

    confirmed = await updateEventDayEntry(
      e7.id,
      { breakfast: "paid_to_restaurant", amount: "0", paymentMethod: null },
      actorUserId,
    );
    assertEqual(confirmed.breakfast_confirmed_at, null, "L: yeniden 'restorana kendi öder'e dönünce onay sıfırdan başlar");
    confirmed = await updateEventDayEntry(e7.id, { breakfastConfirmed: true }, actorUserId);
    assert(confirmed.breakfast_confirmed_at !== null, "L: yeniden onaylanabilir");
    confirmed = await updateEventDayEntry(e7.id, { breakfastConfirmed: false }, actorUserId);
    assertEqual(confirmed.breakfast_confirmed_at, null, "L: onay elle geri alınabilir");

    const e8 = await createEventDayEntry(
      event.id,
      { fullName: "SMOKE43 Baştan Onaylı", amount: "0", breakfast: "paid_to_restaurant", breakfastConfirmed: true },
      actorUserId,
    );
    assert(e8.breakfast_confirmed_at !== null, "L: fiş elde hazırsa kayıtla aynı anda da onaylanabilir");

    await assertRejects(
      () => createEventDayEntry(
        event.id,
        { fullName: "SMOKE43 Hatalı Onay", amount: "650", paymentMethod: "cash", breakfast: "paid_to_us", breakfastConfirmed: true },
        actorUserId,
      ),
      "VALIDATION_ERROR",
      "L: kayıt sırasında da onay yalnız 'restorana kendi öder'de kabul edilir",
    );

    // ── M. Sadece kahvaltı misafiri ──────────────────────────────────────────
    section("M — Sadece kahvaltı misafiri (migration 0286)");
    const freshStudent = await createStudent({ fullName: "SMOKE43 Taze Öğrenci", actorUserId });
    studentIds.push(freshStudent.id);
    await assertRejects(
      () => createEventDayEntry(
        event.id,
        { studentId: freshStudent.id, amount: "0", breakfast: "paid_to_us", breakfastOnly: true },
        actorUserId,
      ),
      "VALIDATION_ERROR",
      "M: öğrenci sadece kahvaltı misafiri olarak eklenemez",
    );
    await assertRejects(
      () => createEventDayEntry(
        event.id,
        { fullName: "SMOKE43 Kahvaltısız Misafir", amount: "0", breakfast: "none", breakfastOnly: true },
        actorUserId,
      ),
      "VALIDATION_ERROR",
      "M: sadece kahvaltı misafiri kahvaltısız eklenemez",
    );

    const beforeGuest = await getEventDay(event.id);
    const guest = await createEventDayEntry(
      event.id,
      {
        fullName: "SMOKE43 Kahvaltı Misafiri",
        phone: "05329998877",
        amount: "650",
        paymentMethod: "cash",
        breakfast: "paid_to_us",
        breakfastOnly: true,
      },
      actorUserId,
    );
    assertEqual(guest.breakfast_only, true, "M: satır sadece-kahvaltı olarak işaretlendi");
    assertEqual(guest.student_id, null, "M: öğrenciye bağlı değil");

    const afterGuest = await getEventDay(event.id);
    assertEqual(
      afterGuest.summary.people,
      beforeGuest.summary.people + 1,
      "M: 'N kişi' toplamı sadece-kahvaltı misafirini de sayar",
    );
    assertEqual(
      afterGuest.summary.breakfastPaidToUs,
      beforeGuest.summary.breakfastPaidToUs + 1,
      "M: kahvaltı özeti misafiri de sayar",
    );

    await assertRejects(
      () => updateEventDayEntry(guest.id, { breakfast: "none" }, actorUserId),
      "VALIDATION_ERROR",
      "M: düzenlemede de kahvaltı 'Almayacak' yapılamaz",
    );
    const guestUpdated = await updateEventDayEntry(guest.id, { amount: "700", paymentMethod: "card" }, actorUserId);
    assertEqual(guestUpdated.breakfast_only, true, "M: bayrak düzenlemeden sonra da true kalır (değiştirilemez)");
    assertMoney(guestUpdated.amount, "700.00", "M: diğer alanlar normal şekilde düzenlenebilir");

    await deleteEventDayEntry(guest.id, actorUserId);
    const afterGuestDelete = await getEventDay(event.id);
    assertEqual(
      afterGuestDelete.summary.people,
      beforeGuest.summary.people,
      "M: silinince 'N kişi' toplamı eski haline döner",
    );
    const guestRestored = await restoreEventDayEntry(guest.id, actorUserId);
    assertEqual(guestRestored.breakfast_only, true, "M: geri gelen kayıt da sadece-kahvaltı olarak kalır");

    await assertSqlRejects(
      () => pool.query(
        `INSERT INTO event_day_entries (event_id, student_id, full_name, breakfast, breakfast_only)
         VALUES ($1, $2, 'SMOKE43 SQL Misafir', 'paid_to_us', true)`,
        [event.id, mert.id],
      ),
      "event_day_entries_breakfast_only_no_student",
      "M: sadece-kahvaltı + öğrenci kombinasyonu DB'de de reddedilir",
    );
    await assertSqlRejects(
      () => pool.query(
        `INSERT INTO event_day_entries (event_id, full_name, breakfast, breakfast_only)
         VALUES ($1, 'SMOKE43 SQL Misafir', 'none', true)`,
        [event.id],
      ),
      "event_day_entries_breakfast_only_has_breakfast",
      "M: sadece-kahvaltı + kahvaltısız kombinasyonu DB'de de reddedilir",
    );

    ok("\nSMOKE 43 — ETKİNLİK GÜNÜ TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    await cleanupEvents();
    const staleStudents = await pool.query<{ id: string }>(
      `SELECT id FROM students WHERE full_name LIKE 'SMOKE43 %' AND deleted_at IS NULL`,
    );
    await cleanupSmoke([...new Set([...studentIds, ...staleStudents.rows.map((row) => row.id)])]);
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
