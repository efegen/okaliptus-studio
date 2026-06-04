/**
 * SMOKE 22 — Ders türü özel fiyatları: HTTP / router katmanı (migration 0238)
 *
 * Diğer smoke'lar servis katmanını doğrudan çağırır; bu test GERÇEK Express
 * uygulamasını (createApp) geçici bir portta ayağa kaldırıp endpoint'leri
 * frontend gibi HTTP üzerinden çağırır. Böylece routing, auth middleware,
 * gövde validasyonu ve yanıt şekli uçtan uca doğrulanır.
 *
 * Senaryolar:
 *   - Auth guard: cookie'siz istek 401.
 *   - GET /lesson-types/:id/prices boş başlar.
 *   - PATCH .../prices/:studentId (0 ve 250) → upsert, yanıt doğru.
 *   - Validation: negatif fiyat → 400.
 *   - POST /lessons → price_snapshot override'ı yansıtır (250).
 *   - DELETE override → 200; ikinci DELETE → 404.
 *   - Override silindikten sonra yeni ders default fiyatı (400) alır.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/22-lesson-type-prices-http.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createStudent } from "../../src/services/students.service.js";
import { createLessonType } from "../../src/services/lesson-types.service.js";
import { pool } from "../../src/db/connection.js";
import {
  section,
  step,
  assert,
  assertEqual,
  assertMoney,
  ok,
  cleanupSmoke,
  closePool,
  nextSlotIso,
  seedAdminUser,
} from "./_shared.js";

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 22 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const studentIds: string[] = [];
  const typeIds: string[] = [];
  let token: string | null = null;

  async function req(
    method: string,
    path: string,
    opts: { auth?: boolean; body?: unknown } = {},
  ): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.auth !== false && token) headers.Cookie = `session=${token}`;
    const r = await fetch(base + path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let json: any = null;
    try { json = await r.json(); } catch { /* boş gövde */ }
    return { status: r.status, json };
  }

  try {
    section("SMOKE 22 — Ders türü özel fiyatları (HTTP/router)");

    token = await login(admin.username, admin.password);
    assert(typeof token === "string" && token.length > 0, "admin login token alındı");

    // ── Auth guard ───────────────────────────────────────────────────────────
    step("Auth: cookie'siz istek 401 döner");
    const noauth = await req("GET", "/lesson-types", { auth: false });
    assertEqual(noauth.status, 401, "cookie yok → 401");

    // ── Kurulum (servisler üzerinden) ─────────────────────────────────────────
    const type = await createLessonType({
      name: "SMOKE22_Ders",
      default_duration_minutes: 60,
      default_price: 400,
    });
    typeIds.push(type.id);
    const student = await createStudent({ fullName: "SMOKE22_main" });
    studentIds.push(student.id);

    // ── GET boş ───────────────────────────────────────────────────────────────
    step("GET /lesson-types/:id/prices boş başlar");
    const g0 = await req("GET", `/lesson-types/${type.id}/prices`);
    assertEqual(g0.status, 200, "GET 200");
    assertEqual(Array.isArray(g0.json?.data) ? g0.json.data.length : -1, 0, "başlangıçta 0 override");

    // ── PATCH override = 0 ──────────────────────────────────────────────────────
    step("PATCH override = 0 (ücretsiz)");
    const p1 = await req("PATCH", `/lesson-types/${type.id}/prices/${student.id}`, { body: { custom_price: 0 } });
    assertEqual(p1.status, 200, "PATCH 200");
    assertMoney(p1.json?.data?.custom_price, "0", "yanıt custom_price=0");

    const g1 = await req("GET", `/lesson-types/${type.id}/prices`);
    assertEqual(g1.json?.data?.length, 1, "1 override listelendi");
    assertEqual(String(g1.json.data[0].student_id), String(student.id), "doğru öğrenci");

    // ── Validation: negatif → 400 ─────────────────────────────────────────────
    step("Validation: negatif fiyat 400");
    const bad = await req("PATCH", `/lesson-types/${type.id}/prices/${student.id}`, { body: { custom_price: -5 } });
    assertEqual(bad.status, 400, "negatif → 400");

    // ── Güncelle: 250 ─────────────────────────────────────────────────────────
    step("PATCH override = 250 (upsert güncelleme)");
    const p2 = await req("PATCH", `/lesson-types/${type.id}/prices/${student.id}`, { body: { custom_price: 250 } });
    assertMoney(p2.json?.data?.custom_price, "250", "güncelleme 250");

    // ── POST /lessons → override fiyatı uygulanır ─────────────────────────────
    step("POST /lessons override fiyatını (250) uygular");
    const l1 = await req("POST", "/lessons", {
      body: { studentId: Number(student.id), startsAt: nextSlotIso(), mode: "onsite", lessonTypeId: Number(type.id) },
    });
    assertEqual(l1.status, 201, "lesson create 201");
    assertMoney(l1.json?.data?.price_snapshot, "250", "ders snapshot=250 (override)");

    // ── DELETE override ───────────────────────────────────────────────────────
    step("DELETE override → 200; tekrar → 404");
    const d1 = await req("DELETE", `/lesson-types/${type.id}/prices/${student.id}`);
    assertEqual(d1.status, 200, "DELETE 200");
    const d2 = await req("DELETE", `/lesson-types/${type.id}/prices/${student.id}`);
    assertEqual(d2.status, 404, "ikinci DELETE 404");

    // ── Silindikten sonra yeni ders default fiyat alır ────────────────────────
    step("Override silindi → yeni ders default 400");
    const l2 = await req("POST", "/lessons", {
      body: { studentId: Number(student.id), startsAt: nextSlotIso(), mode: "onsite", lessonTypeId: Number(type.id) },
    });
    assertMoney(l2.json?.data?.price_snapshot, "400", "snapshot=400 (default)");

    ok("\nSMOKE 22 — TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    if (token) { try { await logout(token); } catch { /* ignore */ } }
    await cleanupSmoke(studentIds);
    if (typeIds.length > 0) {
      await pool.query(`DELETE FROM lesson_type_student_prices WHERE lesson_type_id = ANY($1::bigint[])`, [typeIds]);
      await pool.query(`UPDATE lesson_types SET deleted_at = now(), is_active = false WHERE id = ANY($1::bigint[])`, [typeIds]);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
