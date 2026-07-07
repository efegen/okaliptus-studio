/**
 * SMOKE 39 — Bildirim ayar modülü (migration 0258)
 *
 * notification_settings config-driven scheduler'ı doğrular: şablon render,
 * sessiz saat penceresi, güncelleme + validasyon, alıcı temizleme, kapalıyken
 * claim YAPILMAMASI, ayarlanabilir dakika penceresi ve HTTP kapısı (owner-only).
 *
 * DİKKAT: notification_settings GLOBAL (singleton-benzeri). Başta snapshot
 * alınır, finally'de geri yüklenir. Ama assertion hatası process.exit() çağırır
 * ve finally ATLANIR → bozuk config kalır; o durumda `npm run smoke:reset`.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/39-notification-settings.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createUser } from "../../src/services/users.service.js";
import { createStudent } from "../../src/services/students.service.js";
import {
  renderTemplate,
  isWithinQuietHours,
  updateNotificationSetting,
  listNotificationSettings,
} from "../../src/services/notification-settings.service.js";
import { check30MinReminders } from "../../src/services/notification-scheduler.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  assert,
  assertEqual,
  ok,
  fail,
  closePool,
  cleanupSmoke,
  seedAdminUser,
} from "./_shared.js";

const FULL_LR_CONFIG = (earlyMinutes: number, earlySuppress: boolean) => ({
  early: { enabled: true, minutes: earlyMinutes, suppressIfBusy: earlySuppress },
  late: { enabled: true, minutes: 10, suppressIfBusy: false },
  titleTemplate: "Ders başlıyor",
  bodyTemplate: "{student} ile dersiniz {minutes} dakika sonra başlıyor.",
});

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 39 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  async function req(method: string, path: string, opts: { token?: string | null; body?: unknown } = {}) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.token) headers.Cookie = `session=${opts.token}`;
    const r = await fetch(base + path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let json: any = null;
    try { json = await r.json(); } catch { /* boş gövde */ }
    return { status: r.status, json };
  }

  const studentIds: string[] = [];
  const createdUserIds: string[] = [];
  const tokensToCleanup: string[] = [];
  let originalRole: string | null = null;
  let ownerId: string | null = null;

  // Config snapshot (finally'de geri yüklenir)
  const snapshot = await pool.query<{
    key: string; enabled: boolean; recipient_user_ids: string[] | null; config: unknown;
  }>(`SELECT key, enabled, recipient_user_ids, config FROM notification_settings`);

  try {
    section("SMOKE 39 — Bildirim ayar modülü");

    // ── A. renderTemplate ─────────────────────────────────────────────────────
    section("A — renderTemplate: değişken ikamesi");
    assertEqual(
      renderTemplate("{student} ile {minutes} dk", { student: "Ada", minutes: 30 }),
      "Ada ile 30 dk",
      "A: bilinen değişkenler ikame edildi",
    );
    assertEqual(
      renderTemplate("{yok} kalır", { student: "x" }),
      "{yok} kalır",
      "A: bilinmeyen değişken aynen kalır",
    );

    // ── B. isWithinQuietHours ─────────────────────────────────────────────────
    section("B — Sessiz saat penceresi (aynı gün + gece yarısı saran)");
    const TZ = "Europe/Istanbul";
    // Gece yarısını saran 22:00–08:00: 03:00 İÇİNDE, 12:00 DIŞINDA.
    const at = (hh: number, mm = 0) => new Date(Date.UTC(2026, 0, 1, hh, mm)); // UTC — TZ dönüşümü fonksiyonda
    // UTC 00:00 → Istanbul 03:00 (yaz/kış farkı olsa da 03:00 pencere içi kalır)
    assert(isWithinQuietHours(at(0, 0), "22:00", "08:00", TZ), "B: gece (saran pencere) içinde");
    // UTC 10:00 → Istanbul 13:00 → dışında
    assert(!isWithinQuietHours(at(10, 0), "22:00", "08:00", TZ), "B: gündüz (saran pencere) dışında");
    // Eşit sınır → pencere yok
    assert(!isWithinQuietHours(at(0, 0), "09:00", "09:00", TZ), "B: eşit sınır → pencere yok");

    // ── C. updateNotificationSetting + validasyon ─────────────────────────────
    section("C — Güncelleme + validasyon");
    const upd = await updateNotificationSetting("lesson_reminder", {
      enabled: true,
      config: FULL_LR_CONFIG(30, true),
    });
    assertEqual(upd.enabled, true, "C: enabled true kaydedildi");
    assertEqual((upd.config as any).early.minutes, 30, "C: config.early.minutes 30");

    let rejectedMinutes = false;
    try {
      await updateNotificationSetting("lesson_reminder", { config: FULL_LR_CONFIG(0, false) });
    } catch { rejectedMinutes = true; }
    assert(rejectedMinutes, "C: geçersiz dakika (0) reddedildi");

    let rejectedEmpty = false;
    try {
      await updateNotificationSetting("new_order", { config: { titleTemplate: "", bodyTemplate: "x" } });
    } catch { rejectedEmpty = true; }
    assert(rejectedEmpty, "C: boş başlık şablonu reddedildi");

    // ── D. Alıcı temizleme: yalnız var olan kullanıcı id'leri ─────────────────
    section("D — recipientUserIds: bogus id atılır, geçerli kalır");
    const seedRow = await pool.query<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE username = $1`, [admin.username],
    );
    if (!seedRow.rows[0]) { fail("Setup: seed admin yok"); process.exit(1); }
    originalRole = seedRow.rows[0].role;
    ownerId = seedRow.rows[0].id;

    const dUpd = await updateNotificationSetting("stale_lesson", {
      recipientUserIds: [ownerId, "999999999"], // biri gerçek, biri bogus
    });
    assert(
      dUpd.recipientUserIds.includes(String(ownerId)) && !dUpd.recipientUserIds.includes("999999999"),
      "D: yalnız var olan kullanıcı id'si saklandı",
    );

    // ── Setup: instructor + lesson_type + student (check fonksiyonu için) ──────
    const instr = await pool.query<{ id: string }>(
      `SELECT id FROM instructors WHERE is_active AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`);
    const lt = await pool.query<{ id: string }>(
      `SELECT id FROM lesson_types WHERE is_active AND deleted_at IS NULL ORDER BY id ASC LIMIT 1`);
    if (!instr.rows[0] || !lt.rows[0]) { fail("Setup: instructor/lesson_type yok"); process.exit(1); }
    const student = await createStudent({ fullName: "SMOKE39_main" });
    studentIds.push(student.id);

    async function insertLesson(offsetMinutes: number): Promise<string> {
      const startsAt = new Date(Date.now() + offsetMinutes * 60_000).toISOString();
      const r = await pool.query<{ id: string }>(
        `INSERT INTO lessons (student_id, instructor_id, lesson_type_id, starts_at, mode, status, duration_minutes, price_snapshot)
         VALUES ($1,$2,$3,$4,'onsite','scheduled',60,'100.00') RETURNING id`,
        [student.id, instr.rows[0].id, lt.rows[0].id, startsAt]);
      return r.rows[0].id;
    }
    const stamp = async (id: string) => (await pool.query<{ v: string | null }>(
      `SELECT reminder_30_sent_at::text AS v FROM lessons WHERE id = $1`, [id])).rows[0].v;

    // ── E. Kapalıyken claim YOK; açıkken claim VAR ────────────────────────────
    section("E — enabled=false → claim yok; enabled=true → claim var");
    await updateNotificationSetting("lesson_reminder", { enabled: false, config: FULL_LR_CONFIG(30, false) });
    const lessonE = await insertLesson(25);
    await check30MinReminders();
    assert((await stamp(lessonE)) === null, "E: kapalıyken reminder_30_sent_at NULL");

    await updateNotificationSetting("lesson_reminder", { enabled: true, config: FULL_LR_CONFIG(30, false) });
    await check30MinReminders();
    assert((await stamp(lessonE)) !== null, "E: açıldıktan sonra damga basıldı");

    // ── F. Ayarlanabilir dakika penceresi ─────────────────────────────────────
    section("F — early.minutes=45 → +40 dk içeride, +50 dk dışarıda");
    await updateNotificationSetting("lesson_reminder", { enabled: true, config: FULL_LR_CONFIG(45, false) });
    const lessonIn = await insertLesson(40);  // 45 dk penceresi içinde
    const lessonOut = await insertLesson(50); // 45 dk penceresi dışında
    await check30MinReminders();
    assert((await stamp(lessonIn)) !== null, "F: +40 dk ders 45'lik pencerede claim edildi");
    assert((await stamp(lessonOut)) === null, "F: +50 dk ders pencere dışında, claim edilmedi");

    // ── G. HTTP kapısı: owner-only ────────────────────────────────────────────
    section("G — /notification-settings: assistant 403, owner 200");
    await pool.query(`UPDATE users SET role='owner' WHERE id=$1 AND role<>'owner'`, [ownerId]);
    const tokenOwner = await login(admin.username, admin.password);
    if (!tokenOwner) { fail("G: owner login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenOwner);

    const asst = await createUser(
      { username: "smoke39_assistant", displayName: "S39 Assistant", password: "Smoke39Assist1", role: "assistant" }, ownerId);
    createdUserIds.push(asst.id);
    const tokenAsst = await login("smoke39_assistant", "Smoke39Assist1");
    if (!tokenAsst) { fail("G: assistant login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenAsst);

    assertEqual((await req("GET", "/notification-settings", { token: tokenAsst })).status, 403, "G: assistant → 403");
    const gOwner = await req("GET", "/notification-settings", { token: tokenOwner });
    assertEqual(gOwner.status, 200, "G: owner → 200");
    assert(Array.isArray(gOwner.json?.data) && gOwner.json.data.length >= 4, "G: owner listede 4+ satır (3 tür + _global)");

    ok("\nSMOKE 39 — BİLDİRİM AYAR MODÜLÜ TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    for (const token of tokensToCleanup) await logout(token).catch(() => undefined);
    // Config geri yükle (global tablo — sonraki testler varsayılana güvenir)
    for (const r of snapshot.rows) {
      await pool.query(
        `UPDATE notification_settings SET enabled=$2, recipient_user_ids=$3::bigint[], config=$4::jsonb, updated_at=now() WHERE key=$1`,
        [r.key, r.enabled, r.recipient_user_ids ?? [], JSON.stringify(r.config)],
      ).catch(() => undefined);
    }
    if (createdUserIds.length > 0) {
      await pool.query(`DELETE FROM audit_logs WHERE entity_id = ANY($1::bigint[]) AND entity_type='user'`, [createdUserIds]).catch(() => undefined);
      await pool.query(`DELETE FROM audit_logs WHERE actor_user_id = ANY($1::bigint[])`, [createdUserIds]).catch(() => undefined);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [createdUserIds]).catch(() => undefined);
    }
    if (ownerId && originalRole) {
      await pool.query(`UPDATE users SET role=$1 WHERE id=$2`, [originalRole, ownerId]).catch(() => undefined);
    }
    await cleanupSmoke(studentIds);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
