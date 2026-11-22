/**
 * SMOKE 54 — Web sitesi formları: POST /public/inquiries (site) + /site-inquiries (panel)
 *
 * Ağ YOK: Turnstile kapalı (TURNSTILE_SECRET_KEY boş), push gönderilmez
 * (bildirim claim'i boş alıcı listesiyle çalıştırılır). Uygulama geçici bir
 * portta ayağa kaldırılır; her istek ayrı bir X-Forwarded-For ile gelir, istek
 * sınırı testleri dışında IP sayaçları birbirine karışmaz.
 *
 * Senaryo:
 *   1. Yardımcılar: metin temizleme (yön işaretleri, kontrol karakterleri,
 *      kırpma), telefon anahtarı, özet.
 *   2. CORS: sitenin adresi izinli (çerezsiz), başka adres 403; panelin
 *      ALLOWED_ORIGINS'i gerekmez.
 *   3. Doğrulama: eksik ad / geçersiz telefon / bilinmeyen form 422 + alan
 *      mesajı; bozuk JSON 400; 16 KB üstü 413.
 *   4. Kayıt: temiz ön kayıt saklanır, detaylar süzülür, bildirim bekler.
 *      Aynı client_id tekrar → yeni satır yok. Aynı telefon + etkinlik →
 *      bağlı tekrar, bildirimsiz.
 *   5. Şüpheli: tuzak alan, çok hızlı, Origin yok → kaydedilir, bildirimsiz,
 *      yanıt temizle aynı.
 *   6. IP sınırları: 10 dakikada 5'ten sonrası şüpheli, 20'den sonrası 429.
 *   7. Günlük tavanlar: temiz tavan dolunca 503, şüpheli yine kaydedilir;
 *      şüpheli tavanı dolunca sessizce kaydedilmez (yanıt yine 201).
 *   8. Kapatma anahtarı: SITE_FORMS_ENABLED=false → 404.
 *   9. Panel: oturumsuz 401; kutular, sayaçlar, öğrenci eşleşmesi, ilgili
 *      talepler, durum/not/şüphe güncellemesi, hatalı girişler.
 *  10. Bildirim: claim yalnız bekleyen temiz talepleri damgalar; ayar satırı ve
 *      canlı senkron eşlemesi.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/54-site-inquiries.ts
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { cleanText, inquirySummary, phoneKeyOf } from "../../src/services/site-inquiries.service.js";
import { checkNewSiteInquiries, INQUIRY_LIST_URL, inquiryUrl } from "../../src/services/notification-scheduler.js";
import { listNotificationSettings, loadNotificationConfig } from "../../src/services/notification-settings.service.js";
import { signalCapability } from "../../src/services/live-sync.service.js";
import { pool } from "../../src/db/connection.js";
import { env } from "../../src/config/env.js";
import { section, step, assert, assertEqual, closePool, seedAdminUser } from "./_shared.js";

const P = "SMOKE54";
const SITE = "https://www.okaliptusyoga.com";
const ENV_KEYS = [
  "SITE_FORMS_ENABLED",
  "SITE_FORM_ORIGINS",
  "SITE_FORM_DAILY_LIMIT",
  "SITE_FORM_SUSPECT_DAILY_LIMIT",
  "SITE_FORM_MIN_FILL_MS",
  "TURNSTILE_SECRET_KEY",
] as const;

let ipCounter = 0;
const nextIp = () => `10.54.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

type SendOpts = { origin?: string | null; ip?: string; raw?: string; contentType?: string };

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM site_inquiries WHERE full_name LIKE $1`, [P + "%"]);
  await pool.query(`DELETE FROM students WHERE full_name LIKE $1`, [P + "%"]);
}

async function todayCounts(): Promise<{ clean: number; suspect: number }> {
  const { rows } = await pool.query<{ clean: string; suspect: string }>(
    `SELECT count(*) FILTER (WHERE suspect_reason IS NULL) AS clean,
            count(*) FILTER (WHERE suspect_reason IS NOT NULL) AS suspect
       FROM site_inquiries
      WHERE created_at >= (date_trunc('day', now() AT TIME ZONE $1) AT TIME ZONE $1)`,
    [env.timeZone],
  );
  return { clean: Number(rows[0].clean), suspect: Number(rows[0].suspect) };
}

async function rowByClient(clientId: string): Promise<any> {
  const { rows } = await pool.query(`SELECT * FROM site_inquiries WHERE client_id = $1`, [clientId]);
  return rows[0] ?? null;
}

function camp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientId: randomUUID(),
    kind: "camp",
    name: `${P} Ayşe Yılmaz`,
    phone: "0532 554 00 01",
    email: "ayse@example.com",
    page: "/etkinlikler/pamukkale-yoga-kampi",
    elapsedMs: 12_000,
    trap: "",
    details: {
      event: "pamukkale-yoga-kampi",
      eventTitle: "Pamukkale Yoga Kampı",
      eventDate: "18–20 Aralık 2026",
      entry: "cuma",
      entryLabel: "Cuma girişi",
      people: 2,
      room: "paylasimli",
      roomLabel: "2 ya da 3 kişilik oda",
      price: "Kişi başı 13.500 TL",
    },
    ...overrides,
  };
}

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 54 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];

  // Test sırasında gerçek cihazlara push gitmesin (tavan uyarısı dahil): tür
  // kapatılır, sonunda eski haline döner.
  const savedSetting = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM notification_settings WHERE key = 'site_inquiry'`,
  );
  await pool.query(`UPDATE notification_settings SET enabled = false WHERE key = 'site_inquiry'`);

  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let session: string | null = null;

  async function send(body: unknown, opts: SendOpts = {}) {
    const headers: Record<string, string> = {
      "Content-Type": opts.contentType ?? "application/json",
      "X-Forwarded-For": opts.ip ?? nextIp(),
    };
    const origin = opts.origin === undefined ? SITE : opts.origin;
    if (origin) headers.Origin = origin;
    const r = await fetch(base + "/public/inquiries", {
      method: "POST",
      headers,
      body: opts.raw ?? JSON.stringify(body),
    });
    let json: any = null;
    try { json = await r.json(); } catch { /* boş */ }
    return { status: r.status, json, headers: r.headers };
  }

  async function panel(method: string, path: string, body?: unknown, withSession = true) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (withSession && session) headers.Cookie = `session=${session}`;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json: any = null;
    try { json = await r.json(); } catch { /* boş */ }
    return { status: r.status, json };
  }

  const mine = (items: any[]) => items.filter((i) => String(i.fullName).startsWith(P));

  try {
    section("SMOKE 54 — Web sitesi formları");
    await cleanup();

    // ── 1. Yardımcılar ───────────────────────────────────────────────────────
    step("Metin temizleme, telefon anahtarı ve özet");
    assertEqual(cleanText("  Ayşe‮  Yılmaz\u0007 ", 120), "Ayşe Yılmaz", "yön işareti ve kontrol karakteri atılır, boşluk sadeleşir");
    assertEqual(cleanText("a\r\n\r\n\r\n\r\nb", 50, true), "a\n\nb", "çok satırlıda en fazla bir boş satır kalır");
    assertEqual(cleanText("🙂🙂🙂", 2), "🙂🙂", "kırpma emojiyi yarıda kesmez");
    assertEqual(cleanText("   ", 10), null, "boş metin null");
    assertEqual(phoneKeyOf("+90 (532) 554 00 01"), "5325540001", "telefon anahtarı son 10 hane");
    assertEqual(phoneKeyOf("0532 554 00 01"), "5325540001", "yerel biçim aynı anahtar");
    assertEqual(phoneKeyOf("12345"), null, "7 haneden kısa geçersiz");
    assertEqual(
      inquirySummary("camp", { eventTitle: "Pamukkale Yoga Kampı", people: 2, roomLabel: "Tek kişilik oda" }, null),
      "Pamukkale Yoga Kampı, 2 kişi, Tek kişilik oda",
      "kamp özeti",
    );
    assertEqual(inquirySummary("lesson", { modeLabel: "Stüdyoda", city: "İzmir" }, null), "Stüdyoda, İzmir", "ders özeti");
    assertEqual(inquirySummary("contact", {}, "Merhaba,   iş birliği için yazıyorum."), "Merhaba, iş birliği için yazıyorum.", "konu yoksa mesajın başı");

    // ── 2. CORS ──────────────────────────────────────────────────────────────
    step("Ön kontrol: sitenin adresi izinli, başka adres 403");
    {
      const ok = await fetch(base + "/public/inquiries", {
        method: "OPTIONS",
        headers: { Origin: SITE, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
      });
      assertEqual(ok.status, 204, "site ön kontrolü 204");
      assertEqual(ok.headers.get("access-control-allow-origin"), SITE, "Allow-Origin sitenin adresi");
      assertEqual(ok.headers.get("access-control-allow-credentials"), null, "çerez izni yok");
      assertEqual(ok.headers.get("access-control-max-age"), "7200", "ön kontrol 2 saat hatırlanır");

      const bad = await fetch(base + "/public/inquiries", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
      });
      assertEqual(bad.status, 403, "başka adresin ön kontrolü 403");
      assertEqual(bad.headers.get("access-control-allow-origin"), null, "başka adrese Allow-Origin yok");

      const post = await send(camp(), { origin: "https://evil.example" });
      assertEqual(post.status, 403, "başka adresten gönderim 403");
      assert(!env.allowedOrigins.includes(SITE), "sitenin adresi panelin ALLOWED_ORIGINS listesinde değil");
    }

    // ── 3. Doğrulama ─────────────────────────────────────────────────────────
    step("Eksik ve geçersiz alanlar 422, alan mesajıyla");
    {
      const noName = await send(camp({ name: " " }));
      assertEqual(noName.status, 422, "ad yok → 422");
      assertEqual(noName.json?.error?.fields?.name, "Adınızı ve soyadınızı yazın.", "ad mesajı");
      const badPhone = await send(camp({ phone: "12 34" }));
      assertEqual(badPhone.status, 422, "kısa telefon → 422");
      assertEqual(badPhone.json?.error?.fields?.phone, "Telefon numaranızı kontrol edin.", "telefon mesajı");
      const badKind = await send(camp({ kind: "newsletter" }));
      assertEqual(badKind.status, 422, "bilinmeyen form → 422");
      const notJson = await send(null, { raw: "{bozuk" });
      assertEqual(notJson.status, 400, "bozuk JSON → 400");
      const huge = await send(camp({ message: "x".repeat(20_000) }));
      assertEqual(huge.status, 413, "16 KB üstü → 413");
      const arr = await send([1, 2]);
      assertEqual(arr.status, 422, "dizi gövde → 422");
    }

    // ── 4. Kayıt, tekrar deneme, aynı kişiden tekrar ─────────────────────────
    step("Temiz ön kayıt saklanır, detaylar süzülür");
    const first = camp({
      message: "Merhaba,\r\nkamp için yazıyorum.",
      details: { ...(camp().details as object), people: 50, secret: "atılmalı" },
    });
    {
      const r = await send(first);
      assertEqual(r.status, 201, "temiz gönderim 201");
      assertEqual(JSON.stringify(r.json), JSON.stringify({ data: { received: true } }), "yanıt yalnız received:true");
      const row = await rowByClient(first.clientId as string);
      assert(row !== null, "satır kaydedildi");
      assertEqual(row.suspect_reason, null, "şüpheli değil");
      assertEqual(row.notified_at, null, "bildirim bekliyor");
      assertEqual(row.duplicate_of, null, "tekrar değil");
      assertEqual(row.phone_key, "5325540001", "telefon anahtarı");
      assertEqual(row.details.people, 20, "kişi sayısı 20'ye kırpıldı");
      assert(!("secret" in row.details), "bilinmeyen detay alanı atıldı");
      assertEqual(row.details.roomLabel, "2 ya da 3 kişilik oda", "etiket saklandı");
      assertEqual(row.message, "Merhaba,\nkamp için yazıyorum.", "satır sonları sadeleşti");
    }

    step("Aynı client_id tekrar gelirse yeni satır açılmaz");
    {
      const r = await send(first);
      assertEqual(r.status, 201, "tekrar deneme 201");
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM site_inquiries WHERE client_id = $1`, [first.clientId]);
      assertEqual(rows[0].n, 1, "tek satır");
    }

    step("Aynı telefon + aynı etkinlik → bağlı tekrar, bildirimsiz; başka etkinlik → yeni talep");
    const firstRow = await rowByClient(first.clientId as string);
    {
      const again = camp({ phone: "+90 532 554 0001" });
      assertEqual((await send(again)).status, 201, "ikinci gönderim 201");
      const row = await rowByClient(again.clientId as string);
      assertEqual(String(row.duplicate_of), String(firstRow.id), "ilk talebe bağlandı");
      assert(row.notified_at !== null, "ikinci bildirim yok (damgalı)");

      const other = camp({ details: { ...(camp().details as object), event: "baska-kamp", eventTitle: "Başka Kamp" } });
      assertEqual((await send(other)).status, 201, "başka etkinlik 201");
      const otherRow = await rowByClient(other.clientId as string);
      assertEqual(otherRow.duplicate_of, null, "başka etkinlik tekrar sayılmaz");
      assertEqual(otherRow.notified_at, null, "bildirim bekliyor");
    }

    // ── 5. Şüpheli gönderimler ───────────────────────────────────────────────
    step("Tuzak alan, çok hızlı gönderim ve Origin yokluğu → şüpheli, yanıt aynı");
    for (const [label, body, opts, reason] of [
      ["tuzak alan", camp({ phone: "0532 554 00 11", trap: "http://spam" }), {}, "trap"],
      ["çok hızlı", camp({ phone: "0532 554 00 12", elapsedMs: 300 }), {}, "too_fast"],
      ["süre yok", camp({ phone: "0532 554 00 13", elapsedMs: undefined }), {}, "too_fast"],
      ["Origin yok", camp({ phone: "0532 554 00 14" }), { origin: null }, "no_origin"],
    ] as const) {
      const r = await send(body, opts as SendOpts);
      assertEqual(r.status, 201, `${label}: 201`);
      assertEqual(JSON.stringify(r.json), JSON.stringify({ data: { received: true } }), `${label}: yanıt temizle aynı`);
      const row = await rowByClient(body.clientId as string);
      assertEqual(row?.suspect_reason, reason, `${label}: ${reason}`);
      assert(row?.notified_at !== null, `${label}: bildirimsiz`);
    }

    step("Ders talebi ve genel mesaj da saklanır (text/plain gövde dahil)");
    {
      const lesson = {
        clientId: randomUUID(), kind: "lesson", name: `${P} Zeynep Kaya`, phone: "0532 554 00 21",
        elapsedMs: 9000, details: { mode: "studyo", modeLabel: "Stüdyoda", city: "İzmir" },
      };
      assertEqual((await send(lesson, { contentType: "text/plain;charset=UTF-8" })).status, 201, "ders talebi (text/plain) 201");
      const contact = {
        clientId: randomUUID(), kind: "contact", name: `${P} Ali Demir`, phone: "0532 554 00 22",
        elapsedMs: 9000, message: "Kurumumuz için iş birliği.", details: { topic: "isbirligi", topicLabel: "Sponsorluk ya da iş birliği" },
      };
      assertEqual((await send(contact)).status, 201, "genel mesaj 201");
      const l = await rowByClient(lesson.clientId);
      assertEqual(l.details.city, "İzmir", "şehir saklandı");
      assertEqual(l.suspect_reason, null, "ders talebi temiz");
    }

    // ── 6. IP sınırları ──────────────────────────────────────────────────────
    step("Aynı IP: 5'ten sonrası şüpheli (burst), 20'den sonrası 429");
    {
      const ip = "10.54.250.1";
      const reasons: Array<string | null> = [];
      for (let i = 0; i < 20; i++) {
        const body = camp({ phone: `0533 554 ${String(1000 + i).slice(-4, -2)} ${String(1000 + i).slice(-2)}` });
        const r = await send(body, { ip });
        assertEqual(r.status, 201, `istek ${i + 1}: 201`);
        reasons.push((await rowByClient(body.clientId as string))?.suspect_reason ?? null);
      }
      assert(reasons.slice(0, 5).every((x) => x === null), "ilk 5 temiz");
      assert(reasons.slice(5).every((x) => x === "burst"), "6–20 arası burst");
      const blocked = await send(camp({ phone: "0533 554 99 99" }), { ip });
      assertEqual(blocked.status, 429, "21. istek 429");
      assertEqual(blocked.json?.error?.code, "RATE_LIMITED", "kod RATE_LIMITED");
      const otherIp = await send(camp({ phone: "0533 554 99 98" }));
      assertEqual(otherIp.status, 201, "başka IP etkilenmez");
    }

    // ── 7. Günlük tavanlar ───────────────────────────────────────────────────
    step("Temiz tavan dolunca 503; şüpheli yine kaydedilir");
    {
      const c = await todayCounts();
      process.env.SITE_FORM_DAILY_LIMIT = String(c.clean);
      const busy = await send(camp({ phone: "0534 554 00 01" }));
      assertEqual(busy.status, 503, "temiz gönderim 503");
      assertEqual(busy.json?.error?.code, "BUSY", "kod BUSY");
      const trap = camp({ phone: "0534 554 00 02", trap: "x" });
      assertEqual((await send(trap)).status, 201, "şüpheli 201");
      assert((await rowByClient(trap.clientId as string)) !== null, "şüpheli tavanı temiz tavandan bağımsız: kaydedildi");
      delete process.env.SITE_FORM_DAILY_LIMIT;
    }

    step("Şüpheli tavanı dolunca yeni şüpheli sessizce kaydedilmez");
    {
      const c = await todayCounts();
      process.env.SITE_FORM_SUSPECT_DAILY_LIMIT = String(c.suspect);
      const trap = camp({ phone: "0534 554 00 03", trap: "x" });
      const r = await send(trap);
      assertEqual(r.status, 201, "yanıt yine 201");
      assertEqual(await rowByClient(trap.clientId as string), null, "kaydedilmedi");
      const clean = camp({ phone: "0534 554 00 04" });
      assertEqual((await send(clean)).status, 201, "temiz gönderim etkilenmez");
      assert((await rowByClient(clean.clientId as string)) !== null, "temiz kaydedildi");
      delete process.env.SITE_FORM_SUSPECT_DAILY_LIMIT;
    }

    // ── 8. Kapatma anahtarı ──────────────────────────────────────────────────
    step("SITE_FORMS_ENABLED=false → 404");
    {
      process.env.SITE_FORMS_ENABLED = "false";
      assertEqual((await send(camp({ phone: "0534 554 00 05" }))).status, 404, "gönderim 404");
      const pre = await fetch(base + "/public/inquiries", { method: "OPTIONS", headers: { Origin: SITE } });
      assertEqual(pre.status, 404, "ön kontrol 404");
      delete process.env.SITE_FORMS_ENABLED;
    }

    // ── 9. Panel ─────────────────────────────────────────────────────────────
    step("Panel: oturumsuz 401");
    assertEqual((await panel("GET", "/site-inquiries", undefined, false)).status, 401, "oturumsuz liste 401");

    session = await login(admin.username, admin.password);
    assert(session !== null, "admin girişi");

    await pool.query(
      `INSERT INTO students (full_name, phone) VALUES ($1, '+90 (532) 554 00 01')`,
      [`${P} Kayıtlı Öğrenci`],
    );

    step("Panel: kutular, sayaçlar ve öğrenci eşleşmesi");
    {
      const inbox = await panel("GET", "/site-inquiries?box=new&limit=100");
      assertEqual(inbox.status, 200, "yeni kutusu 200");
      const items = mine(inbox.json.data.items);
      assert(items.length > 0, "yeni talepler listede");
      assert(items.every((i: any) => i.status === "new" && i.suspectReason === null), "yeni kutusunda yalnız temiz yeni talepler");
      const top = items.find((i: any) => i.id === String(firstRow.id));
      assert(top !== undefined, "ilk ön kayıt yeni kutusunda");
      const dupIds = (await pool.query(`SELECT id::text FROM site_inquiries WHERE duplicate_of = $1`, [firstRow.id])).rows.map((r) => r.id);
      assert(dupIds.length === 1, "bir tekrar gönderim var");
      assert(!items.some((i: any) => dupIds.includes(i.id)), "tekrar gönderim listede ayrı satır değil");
      assertEqual(top.submissionCount, 2, "baş satır iki gönderimi sayar");
      assertEqual(top.summary, "Pamukkale Yoga Kampı, 2 kişi, 2 ya da 3 kişilik oda", "özet en son gönderimden");
      assert(top.lastSubmittedAt >= top.createdAt, "son gönderim zamanı");
      assertEqual(top.student?.fullName, `${P} Kayıtlı Öğrenci`, "telefon kayıtlı öğrenciyle eşleşti");
      assert(typeof inbox.json.data.counts.new === "number", "sayaçlar döner");

      const suspects = mine((await panel("GET", "/site-inquiries?box=suspect&limit=100")).json.data.items);
      assert(suspects.length > 0 && suspects.every((i: any) => i.suspectReason !== null), "şüpheli kutusu");

      const lessons = mine((await panel("GET", "/site-inquiries?box=all&kind=lesson")).json.data.items);
      assert(lessons.length === 1 && lessons[0].kind === "lesson", "türe göre süzme");

      const paged = await panel("GET", "/site-inquiries?box=all&limit=2");
      assertEqual(paged.json.data.items.length, 2, "limit 2");
      assert(paged.json.data.nextBefore !== null, "sonraki sayfa imleci");
      const page2 = await panel("GET", `/site-inquiries?box=all&limit=2&before=${paged.json.data.nextBefore}`);
      assert(Number(page2.json.data.items[0].id) < Number(paged.json.data.nextBefore), "ikinci sayfa daha eski");

      assertEqual((await panel("GET", "/site-inquiries?kind=newsletter")).status, 400, "bilinmeyen tür 400");
      const counts = await panel("GET", "/site-inquiries/counts");
      assertEqual(counts.status, 200, "sayaç ucu 200");
    }

    step("Panel: detay, ilgili talepler, güncelleme");
    {
      const detail = await panel("GET", `/site-inquiries/${firstRow.id}`);
      assertEqual(detail.status, 200, "detay 200");
      assertEqual(detail.json.data.submissions.length, 2, "iki gönderim, eskiden yeniye");
      assertEqual(detail.json.data.submissions[0].id, String(firstRow.id), "ilk gönderim önce");
      assertEqual(detail.json.data.submissions[0].details.people, 20, "ilk gönderimin bilgileri korunur");
      assert(detail.json.data.related.length >= 1, "aynı telefondan başka talep (başka etkinlik)");
      assert(
        detail.json.data.related.every((r: any) => r.duplicateOf === null && r.id !== String(firstRow.id)),
        "ilgili talepler yalnız başka baş satırlar",
      );

      const upd = await panel("PATCH", `/site-inquiries/${firstRow.id}`, { status: "contacted", note: "  Aradım, cuma girişi.  " });
      assertEqual(upd.status, 200, "güncelleme 200");
      assertEqual(upd.json.data.status, "contacted", "durum dönüş yapıldı");
      assertEqual(upd.json.data.note, "Aradım, cuma girişi.", "not temizlendi");
      assert(upd.json.data.handledBy !== null && upd.json.data.handledAt !== null, "işleyen kişi ve zaman yazıldı");
      const handledAt = upd.json.data.handledAt;

      const noteOnly = await panel("PATCH", `/site-inquiries/${firstRow.id}`, { note: null });
      assertEqual(noteOnly.json.data.note, null, "not silindi");
      assertEqual(noteOnly.json.data.handledAt, handledAt, "yalnız not değişince işleme zamanı aynı kalır");

      const suspectRow = mine((await panel("GET", "/site-inquiries?box=suspect&limit=100")).json.data.items)[0];
      const cleared = await panel("PATCH", `/site-inquiries/${suspectRow.id}`, { suspect: false });
      assertEqual(cleared.json.data.suspectReason, null, "şüphe kaldırıldı");
      assert(cleared.json.data.notifiedAt !== null, "şüphe kalkınca bildirim yine gitmez");

      assertEqual((await panel("PATCH", `/site-inquiries/${firstRow.id}`, { status: "deleted" })).status, 400, "geçersiz durum 400");
      assertEqual((await panel("PATCH", `/site-inquiries/${firstRow.id}`, { suspect: true })).status, 400, "şüpheli işareti eklenemez");
      assertEqual((await panel("PATCH", `/site-inquiries/${firstRow.id}`, {})).status, 400, "boş güncelleme 400");
      assertEqual((await panel("GET", "/site-inquiries/999999999")).status, 404, "olmayan talep 404");
    }

    // ── 10. Bildirim ve canlı senkron ────────────────────────────────────────
    step("Bildirim claim'i yalnız bekleyen temiz talepleri damgalar");
    {
      const before = await pool.query(
        `SELECT count(*)::int AS n FROM site_inquiries WHERE full_name LIKE $1 AND notified_at IS NULL`,
        [P + "%"],
      );
      assert(before.rows[0].n > 0, "bekleyen temiz talepler var");
      const cfg = await loadNotificationConfig();
      // Alıcı boş: gerçek cihazlara push gitmez, yalnız claim çalışır.
      await checkNewSiteInquiries({ ...cfg, siteInquiry: { ...cfg.siteInquiry, enabled: true, recipients: [] } });
      const after = await pool.query(
        `SELECT count(*)::int AS n FROM site_inquiries WHERE full_name LIKE $1 AND notified_at IS NULL`,
        [P + "%"],
      );
      assertEqual(after.rows[0].n, 0, "hepsi damgalandı");
    }

    step("Bildirim ayarı ve canlı senkron eşlemesi");
    {
      const rows = await listNotificationSettings();
      const si = rows.find((r) => r.key === "site_inquiry");
      assert(si !== undefined, "site_inquiry ayar satırı var");
      assertEqual(si?.config.titleTemplate, "{title}", "varsayılan başlık şablonu");
      assertEqual(signalCapability("POST", "/site-inquiries"), "inquiries.manage", "yeni talep sinyali yetkiye bağlı");
      assertEqual(signalCapability("PATCH", "/site-inquiries/5"), "inquiries.manage", "güncelleme sinyali yetkiye bağlı");
      assertEqual(signalCapability("GET", "/site-inquiries"), undefined, "okuma sinyal üretmez");
      assertEqual(inquiryUrl("42"), "/?talep=42", "bildirim talebin kendisini açar");
      assertEqual(INQUIRY_LIST_URL, "/?talepler=1", "özet bildirimi listeyi açar");
    }
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (session) await logout(session).catch(() => undefined);
    if (savedSetting.rows[0]) {
      await pool.query(`UPDATE notification_settings SET enabled = $1 WHERE key = 'site_inquiry'`, [savedSetting.rows[0].enabled]);
    }
    await cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
