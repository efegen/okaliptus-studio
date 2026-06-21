/**
 * SEED MOCK DATA — geçici demo verisi (ekran görüntüsü / sunum için).
 *
 * Gerçekçi Türkçe öğrenciler, bu haftaya yayılmış dersler (tamamlanan/iptal/
 * gelmedi/planlı), kısmi & tam ödemeler (borçlu öğrenciler dahil), ön ödemeli
 * paketler, ürün kataloğu + sepet satışları ve birkaç öğrenciye özel fiyat üretir.
 *
 * Tüm yazımlar gerçek SERVİS katmanından geçer → fiyat snapshot, net hesap,
 * paket transaction, borç gibi invariantlar korunur (CLAUDE.md).
 *
 * Görünür isimlerde "MOCK_" öneki YOKTUR (ekran görüntüsü temiz görünsün diye).
 * Bunun yerine oluşturulan tüm ID'ler bir MANIFEST dosyasına yazılır; --clear
 * tam olarak o kayıtları geri alır.
 *
 * KULLANIM (backend/ klasöründen):
 *   npx tsx scripts/seed-mock-data.ts            # demo verisini ekle
 *   npx tsx scripts/seed-mock-data.ts --clear    # eklenen demo verisini geri al
 *
 * UYARI: Yerel/staging DB için. .env'deki DATABASE_URL'i kullanır.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool, closeDatabaseConnection } from "../src/db/connection.js";
import { createStudent } from "../src/services/students.service.js";
import {
  createLesson,
  completeLesson,
  changeLessonStatus,
} from "../src/services/lessons.service.js";
import { createCashPayment } from "../src/services/payments.service.js";
import { createPrepaidPackage } from "../src/services/packages.service.js";
import { createProduct } from "../src/services/products.service.js";
import { createProductSale } from "../src/services/product-sales.service.js";
import {
  createLessonType,
  listActiveLessonTypes,
  setLessonTypeStudentPrice,
} from "../src/services/lesson-types.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, ".mock-seed-manifest.json");

type Manifest = {
  createdAt: string;
  studentIds: string[];
  productIds: string[];
  lessonTypeIds: string[];
  createdInstructorId: string | null;
};

// Modül seviyesinde: kısmi hata olsa bile finally bunu diske yazabilsin
// (→ --clear her durumda yarım kalan veriyi geri alabilir).
let currentManifest: Manifest | null = null;

function persistManifest(): void {
  if (currentManifest) {
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(currentManifest, null, 2), "utf8");
  }
}

// ─── küçük yardımcılar ──────────────────────────────────────────────────────

const G = "\x1b[32m";
const Y = "\x1b[33m";
const C = "\x1b[36m";
const X = "\x1b[0m";
const log = (m: string) => console.log(m);
const ok = (m: string) => console.log(`  ${G}✓${X} ${m}`);
const step = (m: string) => console.log(`\n${C}→${X} ${m}`);

/** Bu haftanın Pazartesi 00:00'ı (yerel saat = TZ=Europe/Istanbul). */
function mondayThisWeek(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Paz..6=Cmt
  const diff = dow === 0 ? -6 : 1 - dow; // Pazartesi'ye geri
  d.setDate(d.getDate() + diff);
  return d;
}

/** dayOffset (0=Pzt) ve saat için ISO timestamp. */
function slotIso(monday: Date, dayOffset: number, hour: number, minute = 0): string {
  const d = new Date(monday);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function ensureInstructorSql(name: string): Promise<{ id: string; created: boolean }> {
  return pool
    .query<{ id: string }>(
      `SELECT id FROM instructors WHERE is_active AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`,
    )
    .then(async (r) => {
      if (r.rows[0]) return { id: r.rows[0].id, created: false };
      const ins = await pool.query<{ id: string }>(
        `INSERT INTO instructors (full_name, is_active) VALUES ($1, true) RETURNING id`,
        [name],
      );
      return { id: ins.rows[0].id, created: true };
    });
}

// ─── SEED ───────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  if (fs.existsSync(MANIFEST_PATH)) {
    log(
      `${Y}⚠  Zaten bir manifest var (${path.basename(MANIFEST_PATH)}). Önce 'npx tsx scripts/seed-mock-data.ts --clear' çalıştır, sonra tekrar ekle.${X}`,
    );
    return;
  }

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    studentIds: [],
    productIds: [],
    lessonTypeIds: [],
    createdInstructorId: null,
  };
  currentManifest = manifest;

  log(`${C}━━━ Demo verisi ekleniyor ━━━${X}`);

  // ── Eğitmen ───────────────────────────────────────────────────────────────
  step("Aktif eğitmen kontrol ediliyor...");
  const instr = await ensureInstructorSql("Selin Aydın");
  if (instr.created) {
    manifest.createdInstructorId = instr.id;
    ok(`Eğitmen oluşturuldu (#${instr.id})`);
  } else {
    ok(`Mevcut eğitmen kullanılıyor (#${instr.id})`);
  }

  // ── Ders türleri ────────────────────────────────────────────────────────────
  step("Ders türleri ekleniyor...");
  const typeDefs = [
    { name: "Hatha Yoga", default_duration_minutes: 60, default_price: 600 },
    { name: "Vinyasa Akış", default_duration_minutes: 75, default_price: 750 },
    { name: "Mat Pilates", default_duration_minutes: 50, default_price: 550 },
    { name: "Birebir Özel Ders", default_duration_minutes: 60, default_price: 1200 },
  ];
  const createdTypes = [];
  for (const t of typeDefs) {
    const lt = await createLessonType(t);
    manifest.lessonTypeIds.push(lt.id);
    createdTypes.push(lt);
  }
  // Var olan aktif türlerle birlikte ders atamada kullanacağımız havuz
  const allTypes = await listActiveLessonTypes();
  ok(`${createdTypes.length} ders türü eklendi (toplam aktif: ${allTypes.length})`);

  // ── Öğrenciler ──────────────────────────────────────────────────────────────
  step("Öğrenciler oluşturuluyor...");
  const studentDefs = [
    { fullName: "Ayşe Yılmaz", nickname: "Ayşe", phone: "+90 532 111 2233", preferredMode: "onsite" as const },
    { fullName: "Mehmet Demir", phone: "+90 533 222 3344", preferredMode: "onsite" as const },
    { fullName: "Zeynep Kaya", nickname: "Zeyno", phone: "+90 535 333 4455", preferredMode: "online" as const },
    { fullName: "Elif Şahin", phone: "+90 536 444 5566", preferredMode: "onsite" as const },
    { fullName: "Can Öztürk", phone: "+90 537 555 6677", preferredMode: "onsite" as const },
    { fullName: "Fatma Çelik", phone: "+90 538 666 7788", preferredMode: "online" as const },
    { fullName: "Burak Aydın", phone: "+90 539 777 8899", preferredMode: "onsite" as const },
    { fullName: "Selin Arslan", nickname: "Selin", phone: "+90 542 888 9900", preferredMode: "onsite" as const },
    { fullName: "Deniz Koç", phone: "+90 543 999 0011", preferredMode: "online" as const },
    { fullName: "Merve Doğan", phone: "+90 544 100 1122", preferredMode: "onsite" as const },
    { fullName: "Ece Yıldız", phone: "+90 545 200 2233", preferredMode: "onsite" as const },
    { fullName: "Ali Vural", phone: "+90 546 300 3344", preferredMode: "onsite" as const },
  ];
  const students = [];
  for (const s of studentDefs) {
    const created = await createStudent({
      fullName: s.fullName,
      nickname: s.nickname ?? null,
      phone: s.phone,
      preferredMode: s.preferredMode,
      joinedAt: new Date(Date.now() - (30 + students.length * 9) * 86_400_000).toISOString(),
    });
    students.push(created);
    manifest.studentIds.push(created.id);
  }
  ok(`${students.length} öğrenci oluşturuldu`);

  // ── Ön ödemeli paketler (öğrencinin dersi tamamlanırken FIFO tüketilir) ──────
  step("Ön ödemeli paketler oluşturuluyor...");
  // Paket, ilgili öğrencinin dersleri tamamlanmadan ÖNCE açılmalı (kredi tüketimi
  // completeLesson içinde olur). Ayşe (#0) ve Zeynep (#2) paketli olsun.
  await createPrepaidPackage({
    studentId: students[0].id,
    purchasedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    creditCount: 10,
    unitPrice: 500,
    totalAmount: 5000,
    source: "iban",
    note: "10 derslik paket",
  });
  await createPrepaidPackage({
    studentId: students[2].id,
    purchasedAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
    creditCount: 8,
    unitPrice: 550,
    totalAmount: 4400,
    source: "cash",
    note: "8 derslik paket",
  });
  ok("2 ön ödemeli paket oluşturuldu (Ayşe 10, Zeynep 8 kredi)");

  // ── Öğrenciye özel fiyat ──────────────────────────────────────────────────────
  step("Öğrenciye özel fiyatlar ayarlanıyor...");
  // Elif (#3) Hatha Yoga'da indirimli; Ali (#11) Birebir'de özel fiyat.
  const hatha = createdTypes.find((t) => t.name === "Hatha Yoga")!;
  const birebir = createdTypes.find((t) => t.name === "Birebir Özel Ders")!;
  await setLessonTypeStudentPrice(hatha.id, students[3].id, 450);
  await setLessonTypeStudentPrice(birebir.id, students[11].id, 900);
  ok("2 özel fiyat ayarlandı (Elif/Hatha 450, Ali/Birebir 900)");

  // ── Dersler (bu haftaya yayılmış) ───────────────────────────────────────────
  step("Bu haftanın takvimi dolduruluyor...");
  const monday = mondayThisWeek();
  const now = Date.now();

  // Her satır: gün (0=Pzt..6=Paz), saat, öğrenci index, ders türü index (allTypes),
  // sonuç. Tek eğitmen olduğu için saatler gün içinde ≥2 saat aralıklı (çakışma yok).
  type Outcome = "completed_paid" | "completed_partial" | "completed_unpaid" | "scheduled" | "cancelled" | "no_show";
  const lessonPlan: Array<[number, number, number, number, Outcome]> = [
    // Pazartesi
    [0, 9, 0, 0, "completed_paid"],
    [0, 11, 4, 1, "completed_paid"],
    [0, 18, 6, 2, "completed_unpaid"],
    [0, 20, 7, 0, "cancelled"],
    // Salı
    [1, 9, 2, 0, "completed_paid"],
    [1, 11, 9, 1, "completed_partial"],
    [1, 17, 3, 0, "completed_paid"],
    [1, 19, 10, 2, "no_show"],
    // Çarşamba
    [2, 10, 0, 0, "completed_paid"],
    [2, 12, 5, 3, "completed_unpaid"],
    [2, 18, 11, 3, "completed_paid"],
    // Perşembe
    [3, 9, 1, 2, "completed_partial"],
    [3, 11, 8, 1, "completed_paid"],
    [3, 19, 2, 0, "completed_paid"],
    // Cuma — bugüne yakın karışım
    [4, 9, 6, 0, "scheduled"],
    [4, 11, 4, 1, "scheduled"],
    [4, 18, 3, 0, "scheduled"],
    [4, 20, 0, 0, "scheduled"],
    // Cumartesi (genelde gelecek)
    [5, 10, 7, 2, "scheduled"],
    [5, 12, 9, 1, "scheduled"],
    [5, 14, 5, 3, "scheduled"],
    // Pazar
    [6, 11, 11, 3, "scheduled"],
    [6, 13, 10, 0, "scheduled"],
  ];

  let completedCount = 0;
  let scheduledCount = 0;
  let otherCount = 0;
  const completedLessonIds: Array<{ id: string; studentIdx: number; outcome: Outcome; price: string; coveredByPackage: boolean }> = [];

  let skippedCount = 0;
  // Dev DB'de aynı saatte gerçek ders olabilir → çakışmada dakikayı kaydırıp
  // tekrar dene; birkaç denemede de olmazsa o slotu atla (seed çökmesin).
  const MINUTE_NUDGES = [0, 7, 17, 33, 47];

  for (const [day, hour, sIdx, tIdx, outcome] of lessonPlan) {
    const lessonType = allTypes[tIdx % allTypes.length];

    let lesson: Awaited<ReturnType<typeof createLesson>> | null = null;
    let usedStartMs = 0;
    for (const nudge of MINUTE_NUDGES) {
      const startsAt = slotIso(monday, day, hour, nudge);
      try {
        lesson = await createLesson({
          studentId: students[sIdx].id,
          startsAt,
          mode: sIdx % 3 === 2 ? "online" : "onsite",
          instructorId: instr.id,
          lessonTypeId: lessonType.id,
        });
        usedStartMs = new Date(startsAt).getTime();
        break;
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "LESSON_CONFLICT") continue;
        throw err;
      }
    }
    if (!lesson) {
      skippedCount += 1;
      continue;
    }

    const startMs = usedStartMs;
    const completable = now > startMs + 25 * 60 * 1000;

    if (outcome.startsWith("completed")) {
      if (completable) {
        const { lesson: done } = await completeLesson(lesson.id);
        completedCount += 1;
        completedLessonIds.push({
          id: done.id,
          studentIdx: sIdx,
          outcome,
          price: done.price_snapshot,
          coveredByPackage: done.prepaid_package_id !== null,
        });
      } else {
        // Gelecekteki slot tamamlanamaz → planlı bırak.
        scheduledCount += 1;
      }
    } else if (outcome === "cancelled") {
      await changeLessonStatus(lesson.id, "cancelled");
      otherCount += 1;
    } else if (outcome === "no_show") {
      if (completable) {
        await changeLessonStatus(lesson.id, "no_show");
      }
      otherCount += 1;
    } else {
      scheduledCount += 1;
    }
  }
  ok(`${lessonPlan.length - skippedCount}/${lessonPlan.length} ders eklendi (tamamlanan ${completedCount}, planlı ${scheduledCount}, iptal/gelmedi ${otherCount}${skippedCount ? `, çakışma nedeniyle atlanan ${skippedCount}` : ""})`);

  // ── Tamamlanan derslere ödeme (bazıları kısmi → borç görünür) ────────────────
  step("Ders ödemeleri işleniyor...");
  let payCount = 0;
  for (const c of completedLessonIds) {
    const priceNum = parseFloat(c.price);
    // Paket kredisiyle kapanmış dersler zaten ödenmiş sayılır (ödeme reddedilir).
    if (c.coveredByPackage || priceNum <= 0) continue;

    if (c.outcome === "completed_paid") {
      await createCashPayment({
        targetType: "lesson",
        targetId: c.id,
        amount: c.price,
        source: c.studentIdx % 2 === 0 ? "cash" : "iban",
        paidAt: new Date().toISOString(),
      });
      payCount += 1;
    } else if (c.outcome === "completed_partial") {
      // Yarısını öde → kalan borç görünür.
      const half = (Math.round(priceNum * 50) / 100).toFixed(2);
      await createCashPayment({
        targetType: "lesson",
        targetId: c.id,
        amount: half,
        source: "cash",
        paidAt: new Date().toISOString(),
      });
      payCount += 1;
    }
    // completed_unpaid → ödeme yok, tam borç görünür.
  }
  ok(`${payCount} ders ödemesi işlendi (bazı öğrencilerde kalan borç bırakıldı)`);

  // ── Ürün kataloğu ────────────────────────────────────────────────────────────
  step("Ürün kataloğu oluşturuluyor...");
  const stamp = Date.now().toString().slice(-6);
  const productDefs = [
    { name: "Premium Yoga Matı", price: "850.00", category: "Mat", barcode: `OKY${stamp}01` },
    { name: "Mantar Yoga Bloğu", price: "180.00", category: "Aksesuar", barcode: `OKY${stamp}02` },
    { name: "Yoga Kayışı", price: "120.00", category: "Aksesuar", barcode: `OKY${stamp}03` },
    { name: "Çelik Termos Şişe 750ml", price: "320.00", category: "İçecek", barcode: `OKY${stamp}04` },
    { name: "Meditasyon Minderi", price: "640.00", category: "Aksesuar", barcode: `OKY${stamp}05` },
    { name: "Pilates Topu 25cm", price: "210.00", category: "Aksesuar", barcode: `OKY${stamp}06` },
    { name: "Direnç Bandı Seti", price: "260.00", category: "Aksesuar", barcode: `OKY${stamp}07` },
    { name: "Lavanta Esans Yağı", price: "150.00", category: "Wellness", barcode: `OKY${stamp}08` },
  ];
  const products = [];
  for (const p of productDefs) {
    const created = await createProduct(p);
    products.push(created);
    manifest.productIds.push(created.id);
  }
  ok(`${products.length} ürün eklendi`);

  // ── Ürün satışları (bazıları ödenmemiş → borç) ──────────────────────────────
  step("Ürün satışları işleniyor...");
  const saleDefs: Array<{ sIdx: number; items: Array<[number, number]>; pay: "full" | "none" | "partial" }> = [
    { sIdx: 1, items: [[0, 1], [3, 1]], pay: "full" },
    { sIdx: 4, items: [[1, 2], [2, 1]], pay: "full" },
    { sIdx: 5, items: [[4, 1]], pay: "none" },
    { sIdx: 8, items: [[5, 1], [6, 1], [7, 2]], pay: "partial" },
    { sIdx: 10, items: [[0, 1]], pay: "full" },
    { sIdx: 3, items: [[7, 3]], pay: "none" },
  ];
  let saleCount = 0;
  for (const sd of saleDefs) {
    const sale = await createProductSale({
      studentId: students[sd.sIdx].id,
      soldAt: new Date(Date.now() - sd.sIdx * 36 * 3600 * 1000).toISOString(),
      items: sd.items.map(([pIdx, qty]) => ({ productId: Number(products[pIdx].id), quantity: qty })),
    });
    saleCount += 1;
    const total = parseFloat(sale.total_amount);
    if (sd.pay === "full") {
      await createCashPayment({
        targetType: "product_sale",
        targetId: sale.id,
        amount: sale.total_amount,
        source: sd.sIdx % 2 === 0 ? "cash" : "iban",
        paidAt: new Date().toISOString(),
      });
    } else if (sd.pay === "partial") {
      await createCashPayment({
        targetType: "product_sale",
        targetId: sale.id,
        amount: (Math.round(total * 60) / 100).toFixed(2),
        source: "cash",
        paidAt: new Date().toISOString(),
      });
    }
  }
  ok(`${saleCount} ürün satışı işlendi`);

  // ── Manifest yaz ──────────────────────────────────────────────────────────────
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf8");

  log(`\n${G}✓ Demo verisi hazır.${X}`);
  log(`  Öğrenci: ${manifest.studentIds.length}, Ders türü: ${manifest.lessonTypeIds.length}, Ürün: ${manifest.productIds.length}`);
  log(`  Manifest: ${MANIFEST_PATH}`);
  log(`  Geri almak için: ${C}npx tsx scripts/seed-mock-data.ts --clear${X}\n`);
}

// ─── CLEAR ─────────────────────────────────────────────────────────────────

async function clear(): Promise<void> {
  if (!fs.existsSync(MANIFEST_PATH)) {
    log(`${Y}⚠  Manifest bulunamadı (${path.basename(MANIFEST_PATH)}). Temizlenecek demo verisi yok.${X}`);
    return;
  }
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  log(`${C}━━━ Demo verisi geri alınıyor ━━━${X}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const sid of manifest.studentIds) {
      // 1. paket-dışı ödemeler (ders + ürün satışı)
      await client.query(
        `UPDATE payments SET deleted_at = now()
          WHERE deleted_at IS NULL AND prepaid_package_id IS NULL
            AND ( lesson_id IN (SELECT id FROM lessons WHERE student_id = $1)
               OR product_sale_id IN (SELECT id FROM product_sales WHERE student_id = $1) )`,
        [sid],
      );
      // 2. paketler (ödeme silmeden önce → trigger izin versin)
      await client.query(
        `UPDATE prepaid_packages SET deleted_at = now() WHERE student_id = $1 AND deleted_at IS NULL`,
        [sid],
      );
      // 3. paket ödemeleri
      await client.query(
        `UPDATE payments SET deleted_at = now()
          WHERE deleted_at IS NULL
            AND prepaid_package_id IN (SELECT id FROM prepaid_packages WHERE student_id = $1)`,
        [sid],
      );
      // 4. dersler  5. satışlar  6. öğrenci
      await client.query(`UPDATE lessons SET deleted_at = now() WHERE student_id = $1 AND deleted_at IS NULL`, [sid]);
      await client.query(`UPDATE product_sales SET deleted_at = now() WHERE student_id = $1 AND deleted_at IS NULL`, [sid]);
      await client.query(`UPDATE students SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [sid]);
      // öğrenciye özel fiyatlar (hard delete — geçmişe etki etmez)
      await client.query(`DELETE FROM lesson_type_student_prices WHERE student_id = $1`, [sid]);
    }

    // Ürünler: satış satırları + stok hareketleri + kanal kayıtları → sonra ürün (hard delete)
    if (manifest.productIds.length > 0) {
      const ids = manifest.productIds;
      await client.query(`DELETE FROM product_sale_items WHERE product_id = ANY($1::bigint[])`, [ids]);
      await client.query(`DELETE FROM stock_movements WHERE product_id = ANY($1::bigint[])`, [ids]).catch(() => undefined);
      await client.query(`DELETE FROM channel_listings WHERE product_id = ANY($1::bigint[])`, [ids]).catch(() => undefined);
      await client.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [ids]);
    }

    // Ders türleri: soft-delete (lessons FK'yi korur)
    if (manifest.lessonTypeIds.length > 0) {
      await client.query(
        `UPDATE lesson_types SET deleted_at = now(), is_active = false WHERE id = ANY($1::bigint[])`,
        [manifest.lessonTypeIds],
      );
    }

    // Bu script'in oluşturduğu eğitmen (varsa) soft-delete
    if (manifest.createdInstructorId) {
      await client.query(
        `UPDATE instructors SET deleted_at = now(), is_active = false WHERE id = $1`,
        [manifest.createdInstructorId],
      );
    }

    await client.query("COMMIT");
    fs.unlinkSync(MANIFEST_PATH);
    log(`\n${G}✓ Demo verisi geri alındı.${X} (öğrenciler/dersler/satışlar/paketler soft-delete; ürünler/özel fiyatlar hard-delete)\n`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error(`${Y}⚠ Temizlik başarısız:${X}`, err);
    throw err;
  } finally {
    client.release();
  }
}

// ─── giriş ────────────────────────────────────────────────────────────────────

const isClear = process.argv.includes("--clear");
(isClear ? clear() : seed())
  .catch((err) => {
    console.error("\n💥 Hata:", err);
    // Kısmi seed olduysa manifesti yine de yaz → --clear geri alabilsin.
    if (!isClear && !fs.existsSync(MANIFEST_PATH)) {
      persistManifest();
      if (currentManifest) {
        console.error(
          `${Y}↺ Kısmi veri manifeste yazıldı. Geri almak için: npx tsx scripts/seed-mock-data.ts --clear${X}`,
        );
      }
    }
    process.exitCode = 1;
  })
  .finally(() => closeDatabaseConnection());
