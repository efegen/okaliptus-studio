/**
 * SMOKE 40 — Etkinlik (event) takip modülü (migration 0261)
 *
 * (+ migration 0263: ücret kalemi "coverage" — kim ödüyor + ücretsiz kontenjan)
 *
 * events / event_fee_items / event_participants / event_participant_fees /
 * event_vehicles: oluşturma, rol bazlı ücret ön ayarı (davetli = stüdyo üstlenir),
 * kalem bazlı override ve ücretsiz kontenjan (comp) sınırı,
 * kayıtlı/yeni katılımcı ekleme, arama, kapasite sınırı, ödeme dağıtımı (FIFO +
 * aşırı ödeme reddi), araç kapasitesi, öğrenci profili bakiye sorgusu, ve
 * /events HTTP router'ının en azından bağlı olduğunun doğrulanması.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/40-events.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createStudent } from "../../src/services/students.service.js";
import {
  addExistingParticipant,
  addFeeItem,
  addNewParticipant,
  assignParticipantToVehicle,
  createEvent,
  createVehicle,
  deleteEvent,
  getEventById,
  getParticipantById,
  getUpcomingEvent,
  listEventBalancesForStudent,
  listParticipantFees,
  listParticipants,
  listVehicles,
  recordParticipantPayment,
  removeParticipant,
  searchStudentsForEvent,
  updateEvent,
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
    if (eventIds.length === 0) return;
    await pool.query(
      `DELETE FROM event_participant_fees WHERE participant_id IN (
         SELECT id FROM event_participants WHERE event_id = ANY($1::bigint[])
       )`,
      [eventIds],
    );
    await pool.query(`DELETE FROM event_participants WHERE event_id = ANY($1::bigint[])`, [eventIds]);
    await pool.query(`DELETE FROM event_vehicles WHERE event_id = ANY($1::bigint[])`, [eventIds]);
    await pool.query(`DELETE FROM event_fee_items WHERE event_id = ANY($1::bigint[])`, [eventIds]);
    await pool.query(`DELETE FROM events WHERE id = ANY($1::bigint[])`, [eventIds]);
  }

  try {
    section("SMOKE 40 — Etkinlik modülü");

    // ── A. Etkinlik oluşturma + ücret kalemleri ───────────────────────────────
    section("A — createEvent: ücret kalemleriyle birlikte");
    const event = await createEvent({
      name: "SMOKE40 Bahçe Yogası + Kahvaltı",
      startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      location: "Fide Bahçe",
      capacityLimit: 2,
      transportEnabled: true,
      feeItems: [
        { label: "Ders ücreti", amount: "350.00" },
        // Kahvaltı: restorana ödenecek geçiş kalemi, 1 kişilik ücretsiz kontenjanla.
        { label: "Kahvaltı", amount: "150.00", isPassThrough: true, compQuota: 1 },
      ],
    });
    eventIds.push(event.id);
    assertEqual(event.status, "upcoming", "A: yeni etkinlik status=upcoming");

    const loaded = await getEventById(event.id);
    assertEqual(loaded.feeItems.length, 2, "A: 2 ücret kalemi kaydedildi");
    const breakfastItem = loaded.feeItems.find((i) => i.label === "Kahvaltı")!;
    const lessonItem = loaded.feeItems.find((i) => i.label === "Ders ücreti")!;
    assertEqual(breakfastItem.is_pass_through, true, "A: kahvaltı geçiş kalemi olarak işaretlendi");
    assertEqual(breakfastItem.comp_quota, 1, "A: kahvaltı ücretsiz kontenjanı 1");
    assertEqual(breakfastItem.comp_used, 0, "A: kontenjan henüz kullanılmadı");
    assertEqual(lessonItem.comp_quota, null, "A: ders ücretinde kontenjan yok");
    assertEqual(loaded.totalParticipants, 0, "A: liste boş başlıyor (auto-seed yok)");

    const upcoming = await getUpcomingEvent();
    assertEqual(upcoming?.id, event.id, "A: getUpcomingEvent en yakın etkinliği döner");

    // ── B. Kayıtlı öğrenci ekleme + rol bazlı ücret ───────────────────────────
    section("B — addExistingParticipant: normal vs davetli ücretlendirmesi");
    const studentA = await createStudent({ fullName: "SMOKE40 Ayşe Normal" });
    studentIds.push(studentA.id);
    const studentB = await createStudent({ fullName: "SMOKE40 Deniz Davetli" });
    studentIds.push(studentB.id);

    const participantA = await addExistingParticipant(event.id, {
      studentId: studentA.id,
      role: "regular",
      rsvpStatus: "coming",
    });
    assertMoney(participantA.total_due, "500.00", "B: normal katılımcı 350+150 borçlu");

    const participantB = await addExistingParticipant(event.id, {
      studentId: studentB.id,
      role: "invited",
      rsvpStatus: "coming",
    });
    assertMoney(participantB.total_due, "0.00", "B: davetliden hiç ücret alınmaz");
    assertMoney(participantB.total_studio_covered, "500.00", "B: davetlinin bedelini stüdyo üstlenir");

    const feesB = await listParticipantFees(participantB.id);
    assert(
      feesB.every((f) => f.coverage === "studio"),
      "B: davetlinin tüm kalemleri coverage=studio",
    );
    // Davetli ücret ödemez ama kahvaltıyı YER — restorana verilecek kişi sayısına
    // dahildir, 0261'de bu bilgi kayboluyordu.
    assert(feesB.every((f) => f.included), "B: davetli kalemleri kişi sayımında kalır");

    // ── C. Aynı öğrenciyi ikinci kez eklemek reddedilir ───────────────────────
    section("C — Yinelenen katılımcı reddi");
    await assertRejects(
      () => addExistingParticipant(event.id, { studentId: studentA.id }),
      "DUPLICATE_PARTICIPANT",
      "C: aynı öğrenci aynı etkinliğe ikinci kez eklenemez",
    );

    // ── D. Kapasite sınırı ─────────────────────────────────────────────────────
    section("D — Kontenjan sınırı (capacityLimit=2)");
    const studentC = await createStudent({ fullName: "SMOKE40 Cem Kontenjan" });
    studentIds.push(studentC.id);
    await assertRejects(
      () => addExistingParticipant(event.id, { studentId: studentC.id }),
      "VALIDATION_ERROR",
      "D: dolu kontenjana yeni katılımcı eklenemez",
    );

    // ── E. Yeni kişi oluşturup etkinliğe ekleme (6c) ──────────────────────────
    section("E — addNewParticipant: öğrenci listesine de kaydedilir");
    await pool.query(`UPDATE events SET capacity_limit = NULL WHERE id = $1`, [event.id]);
    const participantNew = await addNewParticipant(event.id, {
      fullName: "SMOKE40 Deren Yeni",
      role: "volunteer",
      rsvpStatus: "unsure",
      guestOfParticipantId: participantA.id,
    });
    studentIds.push(participantNew.student_id);
    assertEqual(participantNew.guest_of_name, studentA.full_name, "E: guest_of bağlantısı doğru öğrenciye işaret ediyor");

    const newStudentRow = await pool.query<{ id: string }>(
      `SELECT id FROM students WHERE id = $1 AND deleted_at IS NULL`,
      [participantNew.student_id],
    );
    assert(!!newStudentRow.rows[0], "E: yeni kişi ana öğrenci listesine de kaydedildi");

    // ── F. Arama: zaten listede olan işaretlenir ──────────────────────────────
    section("F — searchStudentsForEvent: already_in_event bayrağı");
    const searchResults = await searchStudentsForEvent(event.id, "SMOKE40 Ayşe");
    const foundA = searchResults.find((r) => r.id === studentA.id);
    assert(foundA?.already_in_event === true, "F: listede olan öğrenci already_in_event=true");

    // ── G. Rol değişimi ücreti yeniden hesaplar ───────────────────────────────
    section("G — updateParticipant: rol değişince ücret yeniden hesaplanır");
    const promoted = await updateParticipant(participantB.id, { role: "regular" });
    assertMoney(promoted.total_due, "500.00", "G: davetliden normale geçince tam ücret oluşur");

    // ── G2. Özet sayaçları katılımcı başına DISTINCT olmalı ───────────────────
    // (her katılımcının 2 ücret kalemi var — event_participant_fees join'i satır
    // çoğaltır, COUNT(*) yerine COUNT(DISTINCT p.id) kullanılmazsa 2x sayılır.)
    section("G2 — getEventById: özet sayaçları kalem sayısından etkilenmemeli");
    const summary = await getEventById(event.id);
    assertEqual(summary.coming, 2, "G2: 2 kişi geliyor (A, B) — kalem başına çoğalmamış");
    assertEqual(summary.unsure, 1, "G2: 1 kişi belirsiz (Deren)");
    assertEqual(summary.totalParticipants, 3, "G2: toplam 3 katılımcı");
    assertEqual(summary.registeredCount, 2, "G2: 2 kayıtlı (guest_of yok)");
    assertEqual(summary.guestCount, 1, "G2: 1 misafir (Deren, Ayşe'nin misafiri)");
    // Deren gönüllü: bedelini stüdyo üstlenir, potansiyel tahsilata girmez.
    assertMoney(summary.potentialAmount, "1000.00", "G2: potansiyel kazanç yalnız öğrenciye yazılan kalemlerden (500×2)");
    assertMoney(summary.studioCoveredAmount, "500.00", "G2: gönüllünün bedeli stüdyo üstlenimi olarak ayrı sayılır");

    // ── H. Ödeme: FIFO dağıtım + aşırı ödeme reddi ────────────────────────────
    section("H — recordParticipantPayment: kısmi dağıtım ve aşırı ödeme reddi");
    await recordParticipantPayment(participantA.id, "400.00");
    const feesA = await listParticipantFees(participantA.id);
    const lessonFee = feesA.find((f) => f.label === "Ders ücreti");
    const breakfastFee = feesA.find((f) => f.label === "Kahvaltı");
    assertMoney(lessonFee!.paid_amount, "350.00", "H: önce ders ücreti tam kapanır");
    assertMoney(breakfastFee!.paid_amount, "50.00", "H: kalan tutar kahvaltıya kısmi yansır");

    await assertRejects(
      () => recordParticipantPayment(participantA.id, "1000.00"),
      "OVERPAYMENT_NOT_ALLOWED",
      "H: kalan borcu aşan ödeme reddedilir",
    );

    // ── I. Araç/ulaşım: koltuk kapasitesi ──────────────────────────────────────
    section("I — Araç kapasitesi");
    const vehicle = await createVehicle(event.id, {
      vehicleType: "student_car",
      driverStudentId: studentA.id,
      passengerSeats: 1,
    });
    await assignParticipantToVehicle(participantB.id, vehicle.id);
    await assertRejects(
      () => assignParticipantToVehicle(participantNew.id, vehicle.id),
      "VEHICLE_FULL",
      "I: dolu araca üçüncü kişi eklenemez",
    );
    const vehicles = await listVehicles(event.id);
    assertEqual(vehicles.find((v) => v.id === vehicle.id)?.seats_taken, 1, "I: seats_taken doğru sayılıyor");

    // ── J. Öğrenci profili bakiye özeti — ana borca karışmaz ──────────────────
    section("J — listEventBalancesForStudent: ayrı bir defter");
    const balances = await listEventBalancesForStudent(studentA.id);
    const balanceRow = balances.find((b) => b.event_id === event.id);
    assertMoney(balanceRow!.total_due, "500.00", "J: öğrenci profili etkinlik borcunu görüyor");
    assertMoney(balanceRow!.total_paid, "400.00", "J: öğrenci profili tahsilatı görüyor");

    const summaryRow = await pool.query<{ lesson_debt: string; product_debt: string }>(
      `SELECT lesson_debt, product_debt FROM v_student_summary WHERE id = $1`,
      [studentA.id],
    );
    assertMoney(summaryRow.rows[0].lesson_debt, "0.00", "J: ana borç (lesson_debt) etkilenmedi");
    assertMoney(summaryRow.rows[0].product_debt, "0.00", "J: ana borç (product_debt) etkilenmedi");

    // ── K. Ek kalem sonradan eklenince mevcut katılımcılara da yansır ─────────
    section("K — addFeeItem: mevcut katılımcılara geriye dönük satır açar");
    await addFeeItem(event.id, { label: "Ekipman", amount: "50.00" });
    const feesAfter = await listParticipantFees(participantA.id);
    assert(feesAfter.some((f) => f.label === "Ekipman"), "K: yeni kalem mevcut katılımcıya da eklendi");

    const participantsList = await listParticipants(event.id);
    assertEqual(participantsList.length, 3, "K: toplam 3 katılımcı (A, B, Deren — Cem kontenjan dolu diye reddedildi)");

    // ── M. Kalem bazlı coverage + ücretsiz kontenjan ─────────────────────────
    section("M — coverage override'ları ve comp kontenjan sınırı");
    const studentM = await createStudent({ fullName: "SMOKE40 Mert Karma" });
    studentIds.push(studentM.id);

    // "Derse para ödemiyor, sadece kahvaltıya geliyor ve kahvaltısı da ücretsiz
    // kontenjandan" — ekipmanı kendi öder.
    const participantM = await addExistingParticipant(event.id, {
      studentId: studentM.id,
      role: "regular",
      rsvpStatus: "coming",
      fees: [
        { feeItemId: lessonItem.id, coverage: "none" },
        { feeItemId: breakfastItem.id, coverage: "comp" },
      ],
    });
    assertMoney(participantM.total_due, "50.00", "M: yalnız ekipman borcu oluşur (350 ve 150 değil)");

    const feesM = await listParticipantFees(participantM.id);
    assertEqual(
      feesM.find((f) => f.label === "Ders ücreti")!.coverage,
      "none",
      "M: derse katılmıyor — kalem kişi sayımından da çıkar",
    );
    assertEqual(
      feesM.find((f) => f.label === "Ders ücreti")!.included,
      false,
      "M: coverage=none satırı included=false ile senkron (CHECK kısıtı)",
    );
    assertEqual(
      feesM.find((f) => f.label === "Kahvaltı")!.coverage,
      "comp",
      "M: kahvaltı ücretsiz kontenjandan karşılanır",
    );

    const afterComp = await getEventById(event.id);
    assertEqual(
      afterComp.feeItems.find((i) => i.label === "Kahvaltı")!.comp_used,
      1,
      "M: kontenjan kullanımı 1'e çıktı",
    );

    // Kontenjan 1 kişilik: ikinci comp reddedilir (aşırı dağıtım = etkinlik günü
    // sürprizi, bu yüzden sert hata).
    await assertRejects(
      () =>
        addExistingParticipant(event.id, {
          studentId: studentC.id,
          fees: [{ feeItemId: breakfastItem.id, coverage: "comp" }],
        }),
      "COMP_QUOTA_EXCEEDED",
      "M: dolu ücretsiz kontenjandan ikinci kişiye verilemez",
    );
    const stillThree = await listParticipants(event.id);
    assertEqual(stillThree.length, 4, "M: reddedilen ekleme katılımcı satırı bırakmadı (rollback)");

    // Kontenjan tanımsız kaleme comp verilemez.
    await assertRejects(
      () => updateParticipantFee(participantM.id, lessonItem.id, { coverage: "comp" }),
      "VALIDATION_ERROR",
      "M: kontenjanı olmayan kaleme comp atanamaz",
    );

    // Kontenjanı bırak → stüdyo üstlensin; slot serbest kalır.
    await updateParticipantFee(participantM.id, breakfastItem.id, { coverage: "studio" });
    const freed = await getEventById(event.id);
    assertEqual(
      freed.feeItems.find((i) => i.label === "Kahvaltı")!.comp_used,
      0,
      "M: coverage değişince kontenjan slotu serbest kalır",
    );
    assertMoney(
      (await listParticipants(event.id)).find((p) => p.id === participantM.id)!.total_studio_covered,
      "150.00",
      "M: kahvaltı bedeli stüdyonun üstlendiği tutara yazıldı",
    );

    // Serbest kalan slot artık başkasına verilebilir.
    const participantC = await addExistingParticipant(event.id, {
      studentId: studentC.id,
      rsvpStatus: "coming",
      fees: [{ feeItemId: breakfastItem.id, coverage: "comp" }],
    });
    assertMoney(participantC.total_due, "400.00", "M: comp kahvaltı borcu 350+50'ye düşürür");

    // Tahsil edilmiş kalem başkasının üstlenmesine çevrilemez.
    await assertRejects(
      () => updateParticipantFee(participantA.id, lessonItem.id, { coverage: "studio" }),
      "VALIDATION_ERROR",
      "M: ödemesi alınmış kalem stüdyoya devredilemez",
    );

    const finalSummary = await getEventById(event.id);
    // Stüdyonun üstlendiği: Deren (gönüllü, 3 kalem = 550) + Mert'in kahvaltısı (150).
    assertMoney(
      finalSummary.studioCoveredAmount,
      "700.00",
      "M: özet, stüdyonun üstlendiği toplamı ayrı raporluyor",
    );

    // ── N. Etkinlik ayarları: kontenjan indirimi + durum geçişleri ────────────
    section("N — updateEvent: kontenjan indirimi ve durum geçişleri (Etkinlik ayarları)");
    await assertRejects(
      () => updateEvent(event.id, { capacityLimit: 2 }),
      "VALIDATION_ERROR",
      "N: kontenjan, mevcut katılımcı sayısının altına düşürülemez",
    );
    const cancelledEvent = await updateEvent(event.id, { status: "cancelled" });
    assertEqual(cancelledEvent.status, "cancelled", "N: etkinlik iptal edilebilir");
    const reopenedEvent = await updateEvent(event.id, { status: "upcoming" });
    assertEqual(reopenedEvent.status, "upcoming", "N: iptal geri alınıp yaklaşana dönebilir");

    // ── O. Etkinlik ayarları: silme — ödeme varsa reddedilir ──────────────────
    section("O — deleteEvent: tahsilatlı etkinlik silinemez, temiz etkinlik silinebilir");
    await assertRejects(
      () => deleteEvent(event.id),
      "EVENT_HAS_PAYMENTS",
      "O: tahsilat yapılmış (400 TL) etkinlik silinemez",
    );
    const disposableEvent = await createEvent({
      name: "SMOKE40 Silinecek Etkinlik",
      startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    eventIds.push(disposableEvent.id);
    await deleteEvent(disposableEvent.id);
    await assertRejects(
      () => getEventById(disposableEvent.id),
      "EVENT_NOT_FOUND",
      "O: silinen etkinlik artık görünmüyor (soft delete)",
    );

    // ── P. is_lesson_fee: ders ücretinde "stüdyo karşılar" standart olarak yok ──
    // (migration 0265) Ders ücreti stüdyonun kendi geliridir — davetli/gönüllü
    // için bile "studio" değil "none"a düşer; explicit override de reddedilir.
    // Kahvaltı gibi ders-dışı kalemlerde (is_pass_through'tan bağımsız) "studio"
    // normal şekilde çalışmaya devam eder.
    section("P — is_lesson_fee: ders ücretinde stüdyo karşılar sunulmaz");
    const eventP = await createEvent({
      name: "SMOKE40 Ders Ücreti Kısıtı",
      startsAt: new Date(Date.now() + 12 * 86_400_000).toISOString(),
      feeItems: [
        { label: "Ders ücreti", amount: "300.00", isLessonFee: true },
        // Dışarıya ödenmiyor (isPassThrough yok) ama yine de stüdyo karşılayabilmeli.
        { label: "Ekstra malzeme", amount: "80.00" },
      ],
    });
    eventIds.push(eventP.id);
    const loadedP = await getEventById(eventP.id);
    const lessonItemP = loadedP.feeItems.find((i) => i.label === "Ders ücreti")!;
    const extraItemP = loadedP.feeItems.find((i) => i.label === "Ekstra malzeme")!;
    assertEqual(lessonItemP.is_lesson_fee, true, "P: ders ücreti kalemi is_lesson_fee=true ile kaydedildi");
    assertEqual(extraItemP.is_lesson_fee, false, "P: diğer kalem is_lesson_fee=false");

    const studentP = await createStudent({ fullName: "SMOKE40 Pınar Davetli" });
    studentIds.push(studentP.id);
    const participantP = await addExistingParticipant(eventP.id, {
      studentId: studentP.id,
      role: "invited",
      rsvpStatus: "coming",
    });
    const feesP = await listParticipantFees(participantP.id);
    assertEqual(
      feesP.find((f) => f.label === "Ders ücreti")!.coverage,
      "none",
      "P: davetli için ders ücreti 'studio' değil 'none'a düşer",
    );
    assertEqual(
      feesP.find((f) => f.label === "Ekstra malzeme")!.coverage,
      "studio",
      "P: pass-through olmayan diğer kalemde davetli ön ayarı yine 'studio'",
    );

    await assertRejects(
      () =>
        addExistingParticipant(eventP.id, {
          studentId: studentC.id,
          fees: [{ feeItemId: lessonItemP.id, coverage: "studio" }],
        }),
      "VALIDATION_ERROR",
      "P: ders ücretine explicit 'studio' override'ı reddedilir",
    );

    const participantPRegular = await addExistingParticipant(eventP.id, {
      studentId: studentC.id,
      role: "regular",
      rsvpStatus: "coming",
    });
    await assertRejects(
      () => updateParticipantFee(participantPRegular.id, lessonItemP.id, { coverage: "studio" }),
      "VALIDATION_ERROR",
      "P: mevcut katılımcıda da ders ücreti 'studio'ya çevrilemez",
    );

    const promotedP = await updateParticipant(participantPRegular.id, { role: "volunteer" });
    const feesPromotedP = await listParticipantFees(promotedP.id);
    assertEqual(
      feesPromotedP.find((f) => f.label === "Ders ücreti")!.coverage,
      "none",
      "P: rol gönüllüye değişince de ders ücreti 'studio' yerine 'none'a düşer",
    );

    section("P2 — Katılımcıya özel ders ücreti: toplamlar, sıfırlama ve ödeme kilidi");
    await assertRejects(
      () => updateParticipantFee(participantPRegular.id, lessonItemP.id, { amount: "200.00" }),
      "VALIDATION_ERROR", "P2: alınmayan dersin tutarı değiştirilemez",
    );
    await updateParticipant(participantPRegular.id, { role: "regular" });
    await updateParticipantFee(participantPRegular.id, lessonItemP.id, { amount: "225.50" });
    const customFees = await listParticipantFees(participantPRegular.id);
    assertMoney(customFees.find((f) => f.fee_item_id === lessonItemP.id)!.base_amount_snapshot, "300.00", "P2: asıl ders fiyatı korunur");
    assertMoney(customFees.find((f) => f.fee_item_id === lessonItemP.id)!.amount_snapshot, "225.50", "P2: özel ders tutarı kaydedilir");
    assertMoney((await getParticipantById(participantPRegular.id)).total_due, "305.50", "P2: katılımcı toplamı özel tutarı kullanır");
    assertMoney((await getEventById(eventP.id)).potentialAmount, "305.50", "P2: etkinlik toplamı özel tutarı kullanır");
    assertMoney((await getEventById(eventP.id)).feeItems.find((f) => f.id === lessonItemP.id)!.amount, "300.00", "P2: etkinliğin genel fiyatı korunur");
    assertMoney((await listEventBalancesForStudent(studentC.id)).find((e) => e.event_id === eventP.id)!.total_due, "305.50", "P2: öğrenci profili özel tutarı kullanır");
    await updateParticipantFee(participantPRegular.id, lessonItemP.id, { coverage: "student" });
    assertMoney((await getParticipantById(participantPRegular.id)).total_due, "305.50", "P2: aynı kapsam özel tutarı korur");
    await assertRejects(
      () => updateParticipantFee(participantPRegular.id, extraItemP.id, { amount: "10.00" }),
      "VALIDATION_ERROR", "P2: ders dışı maliyet değiştirilemez",
    );
    for (const amount of ["-1", "1.001", "NaN", "", "10000000000"]) {
      await assertRejects(
        () => updateParticipantFee(participantPRegular.id, lessonItemP.id, { amount }),
        "VALIDATION_ERROR", `P2: geçersiz tutar reddedilir (${amount})`,
      );
    }
    await updateParticipantFee(participantPRegular.id, lessonItemP.id, { amount: "0" });
    assertMoney((await getParticipantById(participantPRegular.id)).total_due, "80.00", "P2: sıfır ders ücreti geçerlidir");
    await updateParticipantFee(participantPRegular.id, lessonItemP.id, { amount: "400.25" });
    assertMoney((await getParticipantById(participantPRegular.id)).total_due, "480.25", "P2: özel tutar artırılabilir");
    await updateParticipantFee(participantPRegular.id, lessonItemP.id, { coverage: "none" });
    await updateParticipantFee(participantPRegular.id, lessonItemP.id, { coverage: "student" });
    assertMoney((await getParticipantById(participantPRegular.id)).total_due, "380.00", "P2: kapsam değişince standart tutar geri gelir");
    await updateParticipantFee(participantPRegular.id, lessonItemP.id, { amount: "200" });
    await updateParticipant(participantPRegular.id, { role: "invited" });
    await updateParticipant(participantPRegular.id, { role: "regular" });
    assertMoney((await getParticipantById(participantPRegular.id)).total_due, "380.00", "P2: rol değişince özel tutar sıfırlanır");
    await updateParticipantFee(participantPRegular.id, lessonItemP.id, { amount: "225.50" });
    await assertRejects(
      () => recordParticipantPayment(participantPRegular.id, "305.51"),
      "OVERPAYMENT_NOT_ALLOWED", "P2: fazla ödeme özel tutara göre reddedilir",
    );
    await recordParticipantPayment(participantPRegular.id, "25.50");
    await assertRejects(
      () => updateParticipantFee(participantPRegular.id, lessonItemP.id, { amount: "200.00" }),
      "VALIDATION_ERROR", "P2: kısmi ödeme sonrası özel tutar değiştirilemez",
    );
    await updateParticipantFee(participantPRegular.id, lessonItemP.id, { coverage: "student" });
    await updateParticipant(participantPRegular.id, { role: "invited" });
    assertMoney((await getParticipantById(participantPRegular.id)).total_due, "225.50", "P2: rol değişikliği ödenmiş özel tutarı korur");

    // ── Q. removeParticipant: RSVP'de "gelmiyor" yok, kaldırma bunun yerine ────
    // (migration 0267) Gelmeyecek kişi işaretlenmez, doğrudan silinir. Ödemesi
    // tahsil edilmiş ya da misafiri olan katılımcı silinemez.
    section("Q — removeParticipant: ödemesi/misafiri olan silinemez, temiz katılımcı silinebilir");
    const eventQ = await createEvent({
      name: "SMOKE40 Kaldırma Testi",
      startsAt: new Date(Date.now() + 15 * 86_400_000).toISOString(),
      feeItems: [{ label: "Ders ücreti", amount: "200.00" }],
    });
    eventIds.push(eventQ.id);

    const studentQ1 = await createStudent({ fullName: "SMOKE40 Kaan Kaldırılacak" });
    studentIds.push(studentQ1.id);
    const participantQ1 = await addExistingParticipant(eventQ.id, {
      studentId: studentQ1.id,
      role: "regular",
      rsvpStatus: "unsure",
    });
    await removeParticipant(participantQ1.id);
    await assertRejects(
      () => getParticipantById(participantQ1.id),
      "EVENT_PARTICIPANT_NOT_FOUND",
      "Q: kaldırılan katılımcı artık bulunamıyor",
    );

    const studentQ2 = await createStudent({ fullName: "SMOKE40 Sena Ödemeli" });
    studentIds.push(studentQ2.id);
    const participantQ2 = await addExistingParticipant(eventQ.id, {
      studentId: studentQ2.id,
      role: "regular",
      rsvpStatus: "coming",
    });
    await recordParticipantPayment(participantQ2.id, "100.00");
    await assertRejects(
      () => removeParticipant(participantQ2.id),
      "EVENT_PARTICIPANT_HAS_PAYMENTS",
      "Q: ödemesi tahsil edilmiş katılımcı kaldırılamaz",
    );

    const studentQ3 = await createStudent({ fullName: "SMOKE40 Tuna Misafirli" });
    studentIds.push(studentQ3.id);
    const participantQ3 = await addExistingParticipant(eventQ.id, {
      studentId: studentQ3.id,
      role: "regular",
      rsvpStatus: "coming",
    });
    const participantQ3Guest = await addNewParticipant(eventQ.id, {
      fullName: "SMOKE40 Tuna Misafiri",
      role: "regular",
      rsvpStatus: "unsure",
      guestOfParticipantId: participantQ3.id,
    });
    studentIds.push(participantQ3Guest.student_id);
    await assertRejects(
      () => removeParticipant(participantQ3.id),
      "EVENT_PARTICIPANT_HAS_GUESTS",
      "Q: misafiri olan katılımcı kaldırılamaz",
    );
    await removeParticipant(participantQ3Guest.id);
    await removeParticipant(participantQ3.id);
    assertEqual((await listParticipants(eventQ.id)).length, 1, "Q: yalnız ödemeli katılımcı geriye kaldı");

    await assertRejects(
      () => removeParticipant("999999999"),
      "EVENT_PARTICIPANT_NOT_FOUND",
      "Q: var olmayan katılımcı kaldırma isteği reddedilir",
    );

    // ── L. HTTP router bağlantı kontrolü ──────────────────────────────────────
    section("L — /events HTTP router bağlı ve erişilebilir (tüm roller açık)");
    const admin = seedAdminUser();
    if (!admin) {
      ok("L: BOOTSTRAP_ADMINS yok, HTTP kontrolü atlandı (servis katmanı zaten doğrulandı)");
    } else {
      const server: Server = createServer(createApp());
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as AddressInfo).port;
      const base = `http://127.0.0.1:${port}`;
      const token = await login(admin.username, admin.password);
      const feePatch = await fetch(`${base}/events/participants/${participantPRegular.id}/fees/${lessonItemP.id}`, {
        method: "PATCH",
        headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: "150" }),
      });
      assertEqual(feePatch.status, 400, "L: HTTP tutar güncellemesi ödeme kilidini uygular");
      try {
        if (!token) {
          fail("L: login başarısız");
          process.exit(1);
        }
        const res = await fetch(`${base}/events/${event.id}`, {
          headers: { Cookie: `session=${token}` },
        });
        assertEqual(res.status, 200, "L: GET /events/:id → 200");
        const body = await res.json();
        assertEqual(body.data.id, event.id, "L: HTTP yanıtı doğru etkinliği döndürüyor");
      } finally {
        if (token) await logout(token).catch(() => undefined);
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }

    ok("\nSMOKE 40 — ETKİNLİK MODÜLÜ TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    await cleanupEvents();
    await cleanupSmoke(studentIds);
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
