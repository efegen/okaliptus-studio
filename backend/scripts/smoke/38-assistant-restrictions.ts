/**
 * SMOKE 38 — Etap 2: asistan backend yetki kısıtları
 *
 * permissions.ts capability haritası + router requireCan kapıları + KPI
 * field-stripping'i gerçek HTTP (createApp) üzerinden doğrular.
 *
 * Bootstrap admin (BOOTSTRAP_ADMINS) owner'a terfi edilir; admin + assistant
 * test kullanıcıları yaratılır. Rol-bazlı erişim matrisi:
 *   A. Pazaryeri (/channels /trendyol /mapping) + /movements + /audit-logs →
 *      assistant 403; güvenli DB uçlarında (movements/audit) admin erişebilir.
 *   B. /kpi/finance-flow → assistant 403, admin 200.
 *   C. /kpi/weekly → assistant 200 ama finansal alanlar (revenue/cashInflow/
 *      receivable) soyulmuş; admin tam veri.
 *   D. /kpi/occupancy-flow → assistant 200 ama kova başına ders cirosu (revenue)
 *      soyulmuş, doluluk (pct) korunur; admin tam.
 *   E. /settings → GET açık (takvim saatleri), PATCH assistant 403 / admin 200.
 *   F. Katalog → GET açık (dropdown), yazma (POST /instructors, POST /lesson-
 *      types, GET/PATCH /lesson-types/:id/prices) assistant 403.
 *   G. Öğrenci → liste + öğrenci-bazlı hareket açık; kalıcı silme assistant 403,
 *      owner 200.
 *   H. /products → assistant açık (katalog yönetimi, kullanıcı kararı).
 *
 * Bastırma DEĞİL erişim kapısı test edilir; gerçek push/harici çağrı yok.
 *
 * ÇALIŞTIRMA:
 *   cd backend && npx tsx scripts/smoke/38-assistant-restrictions.ts
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createApp } from "../../src/server/app.js";
import { login, logout } from "../../src/services/auth.service.js";
import { createUser } from "../../src/services/users.service.js";
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
  seedAdminUser,
} from "./_shared.js";

async function run(): Promise<void> {
  const admin = seedAdminUser();
  if (!admin) {
    section("SMOKE 38 — SKIPPED (BOOTSTRAP_ADMINS bulunamadı)");
    await closePool();
    return;
  }

  const server: Server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  async function req(
    method: string,
    path: string,
    opts: { token?: string | null; body?: unknown } = {},
  ): Promise<{ status: number; json: any }> {
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

  const createdUserIds: string[] = [];
  const tokensToCleanup: string[] = [];
  let originalRole: string | null = null;
  let ownerId: string | null = null;
  let studentId: string | null = null;

  try {
    section("SMOKE 38 — Etap 2: asistan backend yetki kısıtları");

    // ── Setup: seed admin → owner terfisi + admin/assistant test kullanıcıları ──
    const seedRow = await pool.query<{ id: string; role: string }>(
      `SELECT id, role FROM users WHERE username = $1`,
      [admin.username],
    );
    if (!seedRow.rows[0]) { fail("Setup: seed admin satırı bulunamadı"); process.exit(1); }
    originalRole = seedRow.rows[0].role;
    ownerId = seedRow.rows[0].id;

    await pool.query(`UPDATE users SET role = 'owner' WHERE id = $1 AND role <> 'owner'`, [ownerId]);

    const tokenOwner = await login(admin.username, admin.password);
    if (!tokenOwner) { fail("Setup: owner login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenOwner);

    const adminUser = await createUser(
      { username: "smoke38_admin", displayName: "Smoke38 Admin", password: "Smoke38Admin1", role: "admin" },
      ownerId,
    );
    createdUserIds.push(adminUser.id);
    const tokenAdmin = await login("smoke38_admin", "Smoke38Admin1");
    if (!tokenAdmin) { fail("Setup: admin login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenAdmin);

    const assistantUser = await createUser(
      { username: "smoke38_assistant", displayName: "Smoke38 Assistant", password: "Smoke38Assist1", role: "assistant" },
      ownerId,
    );
    createdUserIds.push(assistantUser.id);
    const tokenAssistant = await login("smoke38_assistant", "Smoke38Assist1");
    if (!tokenAssistant) { fail("Setup: assistant login başarısız"); process.exit(1); }
    tokensToCleanup.push(tokenAssistant);

    const student = await createStudent({ fullName: "SMOKE38_main" });
    studentId = student.id;

    // ── A. Pazaryeri + stüdyo hareketleri + denetim: assistant 403 ─────────────
    section("A — Pazaryeri/hareketler/denetim: assistant 403");
    for (const path of ["/channels", "/trendyol", "/mapping", "/movements", "/audit-logs"]) {
      const a = await req("GET", path, { token: tokenAssistant });
      assertEqual(a.status, 403, `A: assistant GET ${path} → 403`);
      assertEqual(a.json?.error?.code, "FORBIDDEN", `A: ${path} error.code = FORBIDDEN`);
    }
    // Pozitif kontrol yalnız güvenli (harici çağrısız) DB uçlarında:
    assert((await req("GET", "/movements", { token: tokenAdmin })).status !== 403, "A: admin GET /movements → 403 DEĞİL");
    assert((await req("GET", "/audit-logs", { token: tokenAdmin })).status !== 403, "A: admin GET /audit-logs → 403 DEĞİL");

    // ── B. /kpi/finance-flow: assistant 403, admin 200 ────────────────────────
    section("B — /kpi/finance-flow: assistant 403, admin 200");
    assertEqual((await req("GET", "/kpi/finance-flow", { token: tokenAssistant })).status, 403, "B: assistant → 403");
    assertEqual((await req("GET", "/kpi/finance-flow", { token: tokenAdmin })).status, 200, "B: admin → 200");

    // ── C. /kpi/weekly field-stripping ────────────────────────────────────────
    section("C — /kpi/weekly: assistant finansal alanlar soyulmuş, admin tam");
    const cA = await req("GET", "/kpi/weekly", { token: tokenAssistant });
    assertEqual(cA.status, 200, "C: assistant → 200");
    assert(cA.json?.data?.revenue === undefined, "C: assistant yanıtında revenue YOK");
    assert(cA.json?.data?.cashInflow === undefined, "C: assistant yanıtında cashInflow YOK");
    assert(cA.json?.data?.receivable === undefined, "C: assistant yanıtında receivable YOK");
    assert(cA.json?.data?.lessonCounts !== undefined, "C: assistant operasyonel lessonCounts VAR");
    assert(cA.json?.data?.occupancyRatio !== undefined, "C: assistant occupancyRatio VAR");
    const cM = await req("GET", "/kpi/weekly", { token: tokenAdmin });
    assert(cM.json?.data?.revenue !== undefined, "C: admin yanıtında revenue VAR");
    assert(cM.json?.data?.cashInflow !== undefined, "C: admin yanıtında cashInflow VAR");

    // ── D. /kpi/occupancy-flow field-stripping (kova başına revenue) ──────────
    section("D — /kpi/occupancy-flow: assistant ders cirosu soyulmuş, admin tam");
    const dA = await req("GET", "/kpi/occupancy-flow", { token: tokenAssistant });
    assertEqual(dA.status, 200, "D: assistant → 200");
    const dABucket = dA.json?.data?.week?.series?.[0];
    assert(dABucket !== undefined, "D: assistant hafta serisi kovası VAR");
    assert(dABucket.revenue === undefined, "D: assistant kovada revenue YOK");
    assert(dABucket.pct !== undefined, "D: assistant kovada pct (doluluk) VAR");
    const dM = await req("GET", "/kpi/occupancy-flow", { token: tokenAdmin });
    assert(dM.json?.data?.week?.series?.[0]?.revenue !== undefined, "D: admin kovada revenue VAR");

    // ── E. /settings: GET açık, PATCH gated ───────────────────────────────────
    section("E — /settings: GET açık, PATCH assistant 403 / admin 200");
    assertEqual((await req("GET", "/settings", { token: tokenAssistant })).status, 200, "E: assistant GET /settings → 200 (açık)");
    assertEqual((await req("PATCH", "/settings", { token: tokenAssistant, body: {} })).status, 403, "E: assistant PATCH /settings → 403");
    assertEqual((await req("PATCH", "/settings", { token: tokenAdmin, body: {} })).status, 200, "E: admin PATCH /settings (boş, mutasyonsuz) → 200");

    // ── F. Katalog: GET açık, yazma gated ─────────────────────────────────────
    section("F — katalog: GET açık, yazma assistant 403");
    assertEqual((await req("GET", "/instructors", { token: tokenAssistant })).status, 200, "F: assistant GET /instructors → 200 (dropdown)");
    assertEqual((await req("GET", "/lesson-types", { token: tokenAssistant })).status, 200, "F: assistant GET /lesson-types → 200 (dropdown)");
    assertEqual((await req("POST", "/instructors", { token: tokenAssistant, body: { full_name: "Smoke38 Eğitmen" } })).status, 403, "F: assistant POST /instructors → 403");
    assertEqual((await req("POST", "/lesson-types", { token: tokenAssistant, body: { name: "Smoke38", default_duration_minutes: 60, default_price: 100 } })).status, 403, "F: assistant POST /lesson-types → 403");
    assertEqual((await req("GET", "/lesson-types/1/prices", { token: tokenAssistant })).status, 403, "F: assistant GET /lesson-types/1/prices → 403");
    assert((await req("GET", "/lesson-types/1/prices", { token: tokenAdmin })).status !== 403, "F: admin GET /lesson-types/1/prices → 403 DEĞİL");

    // ── G. Öğrenci: liste/hareket açık, kalıcı silme gated ────────────────────
    section("G — öğrenci: liste/hareket açık, kalıcı silme assistant 403 / owner 200");
    assertEqual((await req("GET", "/students", { token: tokenAssistant })).status, 200, "G: assistant GET /students → 200");
    assertEqual((await req("GET", `/students/${studentId}/movements`, { token: tokenAssistant })).status, 200, "G: assistant GET /students/:id/movements → 200");
    assertEqual((await req("DELETE", `/students/${studentId}`, { token: tokenAssistant })).status, 403, "G: assistant DELETE /students/:id → 403");
    const stillThere = await pool.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [studentId]);
    assert(stillThere.rowCount === 1, "G: assistant reddedildikten sonra öğrenci hâlâ mevcut");
    assertEqual((await req("DELETE", `/students/${studentId}`, { token: tokenOwner })).status, 200, "G: owner DELETE /students/:id → 200");
    studentId = null; // hard-delete edildi, cleanup gerekmez

    // ── H. /products: assistant açık (katalog yönetimi) ───────────────────────
    section("H — /products: assistant açık (katalog yönetimi)");
    assertEqual((await req("GET", "/products", { token: tokenAssistant })).status, 200, "H: assistant GET /products → 200");

    ok("\nSMOKE 38 — ASİSTAN KISITLARI TÜM ADIMLAR BAŞARILI ✓");
  } finally {
    for (const token of tokensToCleanup) {
      await logout(token).catch(() => undefined);
    }
    if (studentId) {
      await cleanupSmoke([studentId]);
    }
    if (createdUserIds.length > 0) {
      // smoke 36 ile aynı: test kullanıcılarının login/logout audit satırlarını
      // ÖNCE sil (ON DELETE SET NULL, yoksa smoke 14'ün "auth audit actor dolu"
      // değişmezi kalıcı bozulur), sonra kullanıcıyı sil.
      await pool.query(
        `DELETE FROM audit_logs WHERE entity_id = ANY($1::bigint[]) AND entity_type = 'user'`,
        [createdUserIds],
      ).catch(() => undefined);
      await pool.query(
        `DELETE FROM audit_logs WHERE actor_user_id = ANY($1::bigint[])`,
        [createdUserIds],
      ).catch(() => undefined);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [createdUserIds]).catch(() => undefined);
    }
    if (ownerId && originalRole) {
      await pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [originalRole, ownerId]).catch(() => undefined);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }
}

run().catch((err) => {
  console.error("\n💥 Beklenmeyen hata:", err);
  process.exit(1);
});
